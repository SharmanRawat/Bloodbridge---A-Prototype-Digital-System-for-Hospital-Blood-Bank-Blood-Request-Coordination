require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { query, initDB } = require('./db');
const { requireRole } = require('./middleware/auth');
const adminRoutes = require('./routes/admin');

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
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

io.on('connection', (socket) => {
  socket.on('donor_location', ({ donorId, lat, lng }) => {
    if (!donorId || lat == null || lng == null) return;
    query(`
      UPDATE request
      SET tracker_lat = $1, tracker_lng = $2, tracker_updated = CURRENT_TIMESTAMP,
          status = CASE WHEN status = 'Acknowledged' THEN 'InTransit' ELSE status END
      WHERE id = $3
    `, [lat, lng, donorId]);
    io.to(`request_${donorId}`).emit('update_donor_pos', { donorId, lat, lng, requestId: donorId });
  });

  socket.on('watch_request', ({ requestId }) => {
    socket.join(`request_${requestId}`);
  });
});

// ---- Admin routes (login is public, rest require auth) ----
app.post('/api/admin/login', adminRoutes.loginHandler);   // login – NO auth
app.use('/api/admin', adminRoutes);                       // all other admin routes require auth

// ---- Hospital endpoints ----
app.post('/api/hospital/request', async (req, res) => {
  const { hospitalId, bloodGroup } = req.body;
  const { rows: hospRows } = await query('SELECT lat, lng FROM hospital WHERE id = $1', [hospitalId]);
  const hospital = hospRows[0];
  if (!hospital) return res.status(404).json({ error: 'Hospital not found' });

  const { rows: banks } = await query(`
    SELECT b.id AS "bankId", b.name AS "bankName", b.lat, b.lng, b.phone, i.units AS "unitsAvailable"
    FROM blood_bank b
    JOIN inventory i ON b.id = i.blood_bank_id
    WHERE i.blood_group = $1 AND i.units > 0
  `, [bloodGroup]);

  const results = banks.map(bank => ({
    bankId: bank.bankId,
    bankName: bank.bankName,
    lat: bank.lat,
    lng: bank.lng,
    phone: bank.phone,
    distance: getDistance(hospital.lat, hospital.lng, bank.lat, bank.lng),
    unitsAvailable: bank.unitsAvailable
  })).sort((a, b) => a.distance - b.distance);

  res.json(results.length ? results : { message: 'No stock available', banks: [] });
});

app.post('/api/hospital/request/confirm', requireRole('hospital'), async (req, res) => {
  const {
    hospitalId, bloodGroup, units, urgency = 'Normal', bankId,
    component, patient_name, patient_age_sex, ward, reg_no,
    doctor_name, contact_no, diagnosis, specific_requirement,
    delivery_name, delivery_phone
  } = req.body;

  if (hospitalId !== req.userId) return res.status(403).json({ error: 'Access denied' });
  const safeUnits = Number.isInteger(units) && units > 0 ? units : 1;

  try {
    await query(`UPDATE request SET status = 'Cancelled' WHERE hospital_id = $1 AND blood_group = $2 AND status = 'Pending'`, [hospitalId, bloodGroup]);
    const { rows: stockRows } = await query('SELECT units FROM inventory WHERE blood_bank_id = $1 AND blood_group = $2', [bankId, bloodGroup]);
    if (!stockRows.length || stockRows[0].units < safeUnits) {
      return res.status(400).json({ error: 'Not enough stock available' });
    }

    const { rows: reqRows } = await query(`
      INSERT INTO request (hospital_id, blood_group, units, urgency, blood_bank_id,
        component, patient_name, patient_age_sex, ward, reg_no,
        doctor_name, contact_no, diagnosis, specific_requirement,
        delivery_name, delivery_phone)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id
    `, [hospitalId, bloodGroup, safeUnits, urgency, bankId,
        component || 'PRBC', patient_name || null, patient_age_sex || null,
        ward || null, reg_no || null, doctor_name || null,
        contact_no || null, diagnosis || null, specific_requirement || null,
        delivery_name || null, delivery_phone || null]);

    const requestId = reqRows[0].id;
    const { rowCount } = await query(
      `UPDATE inventory SET units = units - $1, last_updated = CURRENT_TIMESTAMP
       WHERE blood_bank_id = $2 AND blood_group = $3 AND units >= $1`,
      [safeUnits, bankId, bloodGroup]
    );

    if (rowCount === 0) {
      await query('DELETE FROM request WHERE id = $1', [requestId]);
      return res.status(500).json({ error: 'Stock changed, please try again' });
    }

    res.json({ success: true, requestId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/hospital/requests/:hospitalId', requireRole('hospital'), async (req, res) => {
  if (parseInt(req.params.hospitalId) !== req.userId) return res.status(403).json({ error: 'Access denied' });
  const { rows } = await query(`
    SELECT r.*, b.name AS bank_name
    FROM request r
    LEFT JOIN blood_bank b ON r.blood_bank_id = b.id
    WHERE r.hospital_id = $1
    ORDER BY r.created_at DESC
  `, [req.params.hospitalId]);
  res.json(rows);
});

app.get('/api/hospital/request/:id', async (req, res) => {
  const { rows } = await query(`
    SELECT r.*, h.name AS hospital_name, b.name AS bank_name,
           b.lat AS bank_lat, b.lng AS bank_lng
    FROM request r
    JOIN hospital h ON r.hospital_id = h.id
    LEFT JOIN blood_bank b ON r.blood_bank_id = b.id
    WHERE r.id = $1
  `, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Request not found' });
  res.json(rows[0]);
});

app.put('/api/hospital/request/:id/cancel', requireRole('hospital'), async (req, res) => {
  const { rows } = await query('SELECT * FROM request WHERE id = $1', [req.params.id]);
  const request = rows[0];
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.hospital_id !== req.userId) return res.status(403).json({ error: 'Access denied' });
  if (!['Pending','Acknowledged','InTransit','OutForDelivery'].includes(request.status))
    return res.status(400).json({ error: 'Cannot cancel' });
  await query("UPDATE request SET status = 'Cancelled' WHERE id = $1", [req.params.id]);
  res.json({ success: true });
});

app.put('/api/hospital/request/:id/delivered', requireRole('hospital'), async (req, res) => {
  const { rows } = await query('SELECT * FROM request WHERE id = $1', [req.params.id]);
  const request = rows[0];
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.hospital_id !== req.userId) return res.status(403).json({ error: 'Access denied' });
  if (!['InTransit','OutForDelivery'].includes(request.status))
    return res.status(400).json({ error: 'Must be InTransit or OutForDelivery' });
  await query("UPDATE request SET status = 'Delivered' WHERE id = $1", [req.params.id]);
  res.json({ success: true });
});

app.get('/api/hospital/location', requireRole('hospital'), async (req, res) => {
  const { rows } = await query('SELECT lat, lng FROM hospital WHERE id = $1', [req.userId]);
  if (!rows.length) return res.status(404).json({ error: 'Hospital not found' });
  res.json(rows[0]);
});

app.get('/api/hospital/track-request/:id', requireRole('hospital'), async (req, res) => {
  const { rows } = await query('SELECT tracker_lat, tracker_lng, tracker_updated, status FROM request WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Request not found' });
  res.json(rows[0]);
});

// ---- Delivery person endpoints ----
app.post('/api/delivery/update-location', async (req, res) => {
  const { requestId, lat, lng } = req.body;
  if (!requestId || lat == null || lng == null) return res.status(400).json({ error: 'Missing fields' });
  const { rows } = await query('SELECT id, status FROM request WHERE id = $1', [requestId]);
  if (!rows.length) return res.status(404).json({ error: 'Request not found' });
  const reqRow = rows[0];
  if (!['Acknowledged','InTransit'].includes(reqRow.status))
    return res.status(400).json({ error: 'Request cannot be tracked at this stage' });
  await query(`
    UPDATE request
    SET tracker_lat = $1, tracker_lng = $2, tracker_updated = CURRENT_TIMESTAMP,
        status = CASE WHEN status = 'Acknowledged' THEN 'InTransit' ELSE status END
    WHERE id = $3
  `, [lat, lng, requestId]);
  res.json({ success: true });
});

app.put('/api/delivery/confirm-pickup/:id', async (req, res) => {
  const { rows } = await query('SELECT id, status FROM request WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Request not found' });
  const request = rows[0];
  if (request.status === 'OutForDelivery') return res.json({ success: true, message: 'Already confirmed' });
  if (request.status !== 'Ready') return res.status(400).json({ error: 'OTP must be verified first' });
  await query("UPDATE request SET status = 'OutForDelivery' WHERE id = $1", [req.params.id]);
  res.json({ success: true });
});

// ---- Mount route modules ----
app.use('/api/bloodbank', require('./routes/bloodbank'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/donors', require('./routes/donors'));

// ---- Start server ----
initDB().then(() => {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => console.log(`BloodBridge server running on port ${PORT}`));
}).catch(err => {
  console.error('Database init failed', err);
  process.exit(1);
});