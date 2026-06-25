const express = require('express');
const cors = require('cors');
const db = require('./database');
const app = express();

app.use(express.json());
app.use(cors());
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});
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

// ---- Hospital endpoints ----

app.post('/api/hospital/request', (req, res) => {
  const { hospitalId, bloodGroup } = req.body;
  const hospital = db.prepare('SELECT lat, lng FROM hospital WHERE id = ?').get(hospitalId);
  if (!hospital) return res.status(404).json({ error: 'Hospital not found' });

  const banks = db.prepare(`
    SELECT b.id AS bankId, b.name AS bankName, b.lat, b.lng, i.units AS unitsAvailable
    FROM blood_bank b
    JOIN inventory i ON b.id = i.blood_bank_id
    WHERE i.blood_group = ? AND i.units > 0
  `).all(bloodGroup);

  const results = banks.map(bank => ({
    bankId: bank.bankId,
    bankName: bank.bankName,
    lat: bank.lat,           // ← ADD THIS
    lng: bank.lng,           // ← ADD THIS
    distance: getDistance(hospital.lat, hospital.lng, bank.lat, bank.lng),
    unitsAvailable: bank.unitsAvailable
  })).sort((a, b) => a.distance - b.distance);

  if (results.length === 0) {
    return res.json({ message: 'No stock available', banks: [] });
  }
  res.json(results);
});

app.post('/api/hospital/request/confirm', (req, res) => {
  const { hospitalId, bloodGroup, units, urgency = 'Normal', bankId } = req.body;
  
  const insertRequest = db.prepare(`
    INSERT INTO request (hospital_id, blood_group, units, urgency, blood_bank_id)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = insertRequest.run(hospitalId, bloodGroup, units, urgency, bankId);
  const requestId = result.lastInsertRowid;

  const updateInventory = db.prepare(`
    UPDATE inventory
    SET units = units - ?, last_updated = CURRENT_TIMESTAMP
    WHERE blood_bank_id = ? AND blood_group = ? AND units >= ?
  `);
  updateInventory.run(units, bankId, bloodGroup, units);

  res.json({ success: true, requestId });
});

// Get all requests for a hospital (status page)
app.get('/api/hospital/requests/:hospitalId', (req, res) => {
  const { hospitalId } = req.params;
  const requests = db.prepare(`
    SELECT r.id, r.blood_group, r.units, r.urgency, r.status, r.created_at, b.name AS bank_name
    FROM request r
    LEFT JOIN blood_bank b ON r.blood_bank_id = b.id
    WHERE r.hospital_id = ?
    ORDER BY r.created_at DESC
  `).all(hospitalId);
  res.json(requests);
});

// Get single request detail (requisition slip)
app.get('/api/hospital/request/:id', (req, res) => {
  const { id } = req.params;
  const request = db.prepare(`
    SELECT r.*, h.name AS hospital_name, b.name AS bank_name
    FROM request r
    JOIN hospital h ON r.hospital_id = h.id
    LEFT JOIN blood_bank b ON r.blood_bank_id = b.id
    WHERE r.id = ?
  `).get(id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  res.json(request);
});


// ---- Hospital endpoints ----
app.post('/api/hospital/request', (req, res) => {
  const { hospitalId, bloodGroup } = req.body;
  const hospital = db.prepare('SELECT lat, lng FROM hospital WHERE id = ?').get(hospitalId);
  if (!hospital) return res.status(404).json({ error: 'Hospital not found' });

  const banks = db.prepare(`
    SELECT b.id AS bankId, b.name AS bankName, b.lat, b.lng, i.units AS unitsAvailable
    FROM blood_bank b
    JOIN inventory i ON b.id = i.blood_bank_id
    WHERE i.blood_group = ? AND i.units > 0
  `).all(bloodGroup);

  const results = banks.map(bank => ({
    bankId: bank.bankId,
    bankName: bank.bankName,
    lat: bank.lat,
    lng: bank.lng,
    distance: getDistance(hospital.lat, hospital.lng, bank.lat, bank.lng),
    unitsAvailable: bank.unitsAvailable
  })).sort((a, b) => a.distance - b.distance);

  if (results.length === 0) {
    return res.json({ message: 'No stock available', banks: [] });
  }
  res.json(results);
});

app.post('/api/hospital/request/confirm', (req, res) => {
  const { hospitalId, bloodGroup, units, urgency = 'Normal', bankId } = req.body;
  
  const insertRequest = db.prepare(`
    INSERT INTO request (hospital_id, blood_group, units, urgency, blood_bank_id)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = insertRequest.run(hospitalId, bloodGroup, units, urgency, bankId);
  const requestId = result.lastInsertRowid;

  const updateInventory = db.prepare(`
    UPDATE inventory
    SET units = units - ?, last_updated = CURRENT_TIMESTAMP
    WHERE blood_bank_id = ? AND blood_group = ? AND units >= ?
  `);
  updateInventory.run(units, bankId, bloodGroup, units);

  res.json({ success: true, requestId });
});


// ---- Blood bank routes ----
const bloodbankRoutes = require('./routes/bloodbank');
app.use('/api/bloodbank', bloodbankRoutes);

const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

app.get('/ping', (req, res) => {
  res.json({ message: 'Server is alive' });
});

// ---- Start server ----
app.listen(3000, () => {
  console.log('BloodBridge server running on http://localhost:3000');
});
