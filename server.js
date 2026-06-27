const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const db = require('./database');
const { requireRole } = require('./middleware/auth');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

const server = http.createServer(app);
const io = new Server(server);

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ---- Socket.IO ----
// ---- Socket.IO ----
io.on('connection', (socket) => {
  socket.on('donor_location', ({ donorId, lat, lng }) => {
    if (!donorId || lat == null || lng == null) return;

    db.prepare(`
      UPDATE request
      SET tracker_lat = ?, tracker_lng = ?, tracker_updated = CURRENT_TIMESTAMP,
          status = CASE WHEN status = 'Acknowledged' THEN 'InTransit' ELSE status END
      WHERE id = ?
    `).run(lat, lng, donorId);

    io.to(`request_${donorId}`).emit('update_donor_pos', { donorId, lat, lng, requestId: donorId });
  });

  socket.on('watch_request', ({ requestId }) => {
    socket.join(`request_${requestId}`);
  });
});

// ---- Hospital endpoints ----
app.post('/api/hospital/request', (req, res) => {
  const { hospitalId, bloodGroup } = req.body;
  const hospital = db.prepare('SELECT lat, lng FROM hospital WHERE id = ?').get(hospitalId);
  if (!hospital) return res.status(404).json({ error: 'Hospital not found' });

  const banks = db.prepare(`
    SELECT b.id AS bankId, b.name AS bankName, b.lat, b.lng, b.phone,
           i.units AS unitsAvailable
    FROM blood_bank b
    JOIN inventory i ON b.id = i.blood_bank_id
    WHERE i.blood_group = ? AND i.units > 0
  `).all(bloodGroup);

  const results = banks.map(bank => ({
    bankId: bank.bankId,
    bankName: bank.bankName,
    lat: bank.lat,
    lng: bank.lng,
    phone: bank.phone,
    distance: getDistance(hospital.lat, hospital.lng, bank.lat, bank.lng),
    unitsAvailable: bank.unitsAvailable
  })).sort((a, b) => a.distance - b.distance);

  if (results.length === 0) {
    return res.json({ message: 'No stock available', banks: [] });
  }
  res.json(results);
});

app.post('/api/hospital/request/confirm', requireRole('hospital'), (req, res) => {
  const {
    hospitalId, bloodGroup, units, urgency = 'Normal', bankId,
    component, patient_name, patient_age_sex, ward, reg_no,
    doctor_name, contact_no, diagnosis, specific_requirement,
    delivery_name, delivery_phone
  } = req.body;

  if (hospitalId !== req.userId) return res.status(403).json({ error: 'Access denied' });

  const safeUnits = Number.isInteger(units) && units > 0 ? units : 1;

  const cancelPrevious = db.prepare(`
    UPDATE request SET status = 'Cancelled'
    WHERE hospital_id = ? AND blood_group = ? AND status = 'Pending'
  `);
  const insertRequest = db.prepare(`
    INSERT INTO request (
      hospital_id, blood_group, units, urgency, blood_bank_id,
      component, patient_name, patient_age_sex, ward, reg_no,
      doctor_name, contact_no, diagnosis, specific_requirement,
      delivery_name, delivery_phone
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateInventory = db.prepare(`
    UPDATE inventory SET units = units - ?, last_updated = CURRENT_TIMESTAMP
    WHERE blood_bank_id = ? AND blood_group = ? AND units >= ?
  `);

  try {
    const requestId = db.transaction(() => {
      cancelPrevious.run(hospitalId, bloodGroup);
      const result = insertRequest.run(
        hospitalId, bloodGroup, safeUnits, urgency, bankId,
        component || 'PRBC', patient_name || null, patient_age_sex || null,
        ward || null, reg_no || null, doctor_name || null,
        contact_no || null, diagnosis || null, specific_requirement || null,
        delivery_name || null, delivery_phone || null
      );
      if (updateInventory.run(safeUnits, bankId, bloodGroup, safeUnits).changes === 0) {
        throw new Error('INSUFFICIENT_STOCK');
      }
      return result.lastInsertRowid;
    })();
    res.json({ success: true, requestId });
  } catch (err) {
    if (err.message === 'INSUFFICIENT_STOCK') return res.status(400).json({ error: 'Not enough stock available' });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});


// ---- Get all requests for a hospital ----
app.get('/api/hospital/requests/:hospitalId', requireRole('hospital'), (req, res) => {
  if (parseInt(req.params.hospitalId) !== req.userId) return res.status(403).json({ error: 'Access denied' });
  const requests = db.prepare(`
    SELECT r.id, r.blood_group, r.units, r.urgency, r.status, r.created_at,
           r.pickup_otp, r.component, r.patient_name, r.patient_age_sex,
           r.ward, r.reg_no, r.doctor_name, r.contact_no, r.diagnosis,
           r.specific_requirement, r.delivery_name, r.delivery_phone,
           b.name AS bank_name
    FROM request r LEFT JOIN blood_bank b ON r.blood_bank_id = b.id
    WHERE r.hospital_id = ? ORDER BY r.created_at DESC
  `).all(req.params.hospitalId);
  res.json(requests);
});

app.get('/api/hospital/request/:id', (req, res) => {
  const request = db.prepare(`
    SELECT r.*, h.name AS hospital_name, b.name AS bank_name
    FROM request r JOIN hospital h ON r.hospital_id = h.id
    LEFT JOIN blood_bank b ON r.blood_bank_id = b.id
    WHERE r.id = ?
  `).get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  res.json(request);
});

app.put('/api/hospital/request/:id/cancel', requireRole('hospital'), (req, res) => {
  const request = db.prepare('SELECT id, hospital_id, status FROM request WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.hospital_id !== req.userId) return res.status(403).json({ error: 'Access denied' });
  if (!['Pending','Acknowledged','InTransit','OutForDelivery'].includes(request.status)) return res.status(400).json({ error: 'Cannot cancel' });
  db.prepare("UPDATE request SET status = 'Cancelled' WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

// ---- Confirm pickup (delivery person) ----
app.put('/api/delivery/confirm-pickup/:id', (req, res) => {
  const request = db.prepare('SELECT id, status FROM request WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });

  // If already confirmed, just return success
  if (request.status === 'OutForDelivery') {
    return res.json({ success: true, message: 'Pickup already confirmed' });
  }

  // Only allow transition from 'Ready' to 'OutForDelivery'
  if (request.status !== 'Ready') {
    return res.status(400).json({ error: 'OTP must be verified first' });
  }

  db.prepare("UPDATE request SET status = 'OutForDelivery' WHERE id = ?").run(req.params.id);
  res.json({ success: true, message: 'Pickup confirmed' });
});


app.put('/api/hospital/request/:id/delivered', requireRole('hospital'), (req, res) => {
  const request = db.prepare('SELECT id, hospital_id, status FROM request WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.hospital_id !== req.userId) return res.status(403).json({ error: 'Access denied' });
  if (!['InTransit','OutForDelivery'].includes(request.status)) return res.status(400).json({ error: 'Must be InTransit or OutForDelivery'});
  db.prepare("UPDATE request SET status = 'Delivered' WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

// ---- Get tracking data for hospital map ----
app.get('/api/hospital/track-request/:id', requireRole('hospital'), (req, res) => {
  const request = db.prepare('SELECT tracker_lat, tracker_lng, tracker_updated, status FROM request WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  res.json({
    lat: request.tracker_lat,
    lng: request.tracker_lng,
    updated: request.tracker_updated,
    status: request.status
  });
});

// ---- Blood bank routes ----
const bloodbankRoutes = require('./routes/bloodbank');
app.use('/api/bloodbank', bloodbankRoutes);

// ---- Auth routes ----
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

// ---- Start ----
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`BloodBridge server running on port ${PORT}`);
});