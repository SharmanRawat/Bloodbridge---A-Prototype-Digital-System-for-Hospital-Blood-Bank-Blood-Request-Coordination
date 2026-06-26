const express = require('express');
const cors = require('cors');
const db = require('./database');
const { requireRole } = require('./middleware/auth');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

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

// ---- Hospital request search (no auth needed? Actually, we still allow search? The search is used by hospital, but we can leave it open for now. If you want to protect it, add requireRole('hospital') but frontend sends headers. We'll keep it as is for simplicity.)
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

// ---- Hospital request confirm (protected + stock validation + ownership) ----
app.post('/api/hospital/request/confirm', requireRole('hospital'), (req, res) => {
  const { hospitalId, bloodGroup, units, urgency = 'Normal', bankId } = req.body;

  // Ownership check
  if (hospitalId !== req.userId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const safeUnits = Number.isInteger(units) && units > 0 ? units : 1;

  // Transaction: cancel previous pending + insert + deduct stock
  const cancelPrevious = db.prepare(`
    UPDATE request
    SET status = 'Cancelled'
    WHERE hospital_id = ? AND blood_group = ? AND status = 'Pending'
  `);
  const insertRequest = db.prepare(`
    INSERT INTO request (hospital_id, blood_group, units, urgency, blood_bank_id)
    VALUES (?, ?, ?, ?, ?)
  `);
  const updateInventory = db.prepare(`
    UPDATE inventory
    SET units = units - ?, last_updated = CURRENT_TIMESTAMP
    WHERE blood_bank_id = ? AND blood_group = ? AND units >= ?
  `);

  try {
    const requestId = db.transaction(() => {
      cancelPrevious.run(hospitalId, bloodGroup);
      const result = insertRequest.run(hospitalId, bloodGroup, safeUnits, urgency, bankId);
      const updateResult = updateInventory.run(safeUnits, bankId, bloodGroup, safeUnits);
      if (updateResult.changes === 0) {
        throw new Error('INSUFFICIENT_STOCK');
      }
      return result.lastInsertRowid;
    })();
    res.json({ success: true, requestId });
  } catch (err) {
    if (err.message === 'INSUFFICIENT_STOCK') {
      return res.status(400).json({ error: 'Not enough stock available' });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---- Get all requests for a hospital (protected + ownership) ----
app.get('/api/hospital/requests/:hospitalId', requireRole('hospital'), (req, res) => {
  if (parseInt(req.params.hospitalId) !== req.userId) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const requests = db.prepare(`
    SELECT r.id, r.blood_group, r.units, r.urgency, r.status, r.created_at,
           r.pickup_otp,                       -- <-- ADD THIS
           b.name AS bank_name
    FROM request r
    LEFT JOIN blood_bank b ON r.blood_bank_id = b.id
    WHERE r.hospital_id = ?
    ORDER BY r.created_at DESC
  `).all(req.params.hospitalId);
  res.json(requests);
});

// ---- Get single request detail (intentionally open for slip sharing) ----
app.get('/api/hospital/request/:id', (req, res) => {
  const request = db.prepare(`
    SELECT r.*, h.name AS hospital_name, b.name AS bank_name
    FROM request r
    JOIN hospital h ON r.hospital_id = h.id
    LEFT JOIN blood_bank b ON r.blood_bank_id = b.id
    WHERE r.id = ?
  `).get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  res.json(request);
});

// ---- Blood bank routes (imported) ----
const bloodbankRoutes = require('./routes/bloodbank');
app.use('/api/bloodbank', bloodbankRoutes);

// ---- Auth routes ----
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

// ---- Start server ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`BloodBridge server running on port ${PORT}`);
});