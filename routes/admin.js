// routes/admin.js
// All admin API endpoints for BloodBridge
// Mount in server.js with: app.use('/api/admin', require('./routes/admin'));

const express = require('express');
const router = express.Router();
const db = require('../database');
const { requireRole } = require('../middleware/auth');

// Protect every route in this file with admin role
router.use(requireRole('admin'));

// ---- GET all hospitals ----
router.get('/hospitals', (req, res) => {
  const hospitals = db.prepare(`
    SELECT id, name, address, lat, lng
    FROM hospital
    ORDER BY id ASC
  `).all();
  res.json(hospitals);
});

// ---- GET all blood banks ----
router.get('/bloodbanks', (req, res) => {
  const banks = db.prepare(`
    SELECT id, name, address, phone, lat, lng, flagged
    FROM blood_bank
    ORDER BY id ASC
  `).all();
  res.json(banks);
});

// ---- GET all requests (with hospital and blood bank names) ----
router.get('/requests', (req, res) => {
  const { status } = req.query;
  let query = `
    SELECT r.id, r.blood_group, r.units, r.urgency, r.status,
           r.created_at, r.pickup_otp,
           h.name AS hospital_name,
           b.name AS bank_name
    FROM request r
    LEFT JOIN hospital h ON r.hospital_id = h.id
    LEFT JOIN blood_bank b ON r.blood_bank_id = b.id
  `;
  const params = [];
  if (status) {
    query += ' WHERE r.status = ?';
    params.push(status);
  }
  query += ' ORDER BY r.created_at DESC';
  const requests = db.prepare(query).all(...params);
  res.json(requests);
});

// ---- GET summary stats ----
router.get('/stats', (req, res) => {
  const intransit = db.prepare("SELECT COUNT(*) AS count FROM request WHERE status = 'InTransit'").get().count;
  const outfordelivery = db.prepare("SELECT COUNT(*) AS count FROM request WHERE status = 'OutForDelivery'").get().count;
  const totalHospitals = db.prepare('SELECT COUNT(*) AS count FROM hospital').get().count;
  const totalBanks = db.prepare('SELECT COUNT(*) AS count FROM blood_bank').get().count;
  const totalRequests = db.prepare('SELECT COUNT(*) AS count FROM request').get().count;
  const pending = db.prepare("SELECT COUNT(*) AS count FROM request WHERE status = 'Pending'").get().count;
  const acknowledged = db.prepare("SELECT COUNT(*) AS count FROM request WHERE status = 'Acknowledged'").get().count;
  const cancelled = db.prepare("SELECT COUNT(*) AS count FROM request WHERE status = 'Cancelled'").get().count;
  const ready = db.prepare("SELECT COUNT(*) AS count FROM request WHERE status = 'Ready'").get().count;
  res.json({ totalHospitals, totalBanks, totalRequests, pending, acknowledged, cancelled, ready, intransit, outfordelivery });
});

// ---- POST admin login (no auth needed for this one) ----
// Note: This route is defined BEFORE router.use(requireRole('admin')) takes effect
// because Express processes middleware in order. But since we called router.use() at the top,
// we need to handle login separately. See the exported login handler below.
// We export a separate loginHandler for server.js to mount without auth.

// ---- PUT reset hospital password ----
router.put('/hospitals/:id/reset-password', (req, res) => {
  const id = parseInt(req.params.id);
  const result = db.prepare("UPDATE hospital SET password = 'hospital123' WHERE id = ?").run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'Hospital not found' });
  res.json({ success: true, message: 'Password reset to hospital123' });
});

// ---- PUT reset blood bank password ----
router.put('/bloodbanks/:id/reset-password', (req, res) => {
  const id = parseInt(req.params.id);
  const result = db.prepare("UPDATE blood_bank SET password = 'bank123' WHERE id = ?").run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'Blood bank not found' });
  res.json({ success: true, message: 'Password reset to bank123' });
});

// ---- PUT toggle blood bank flag ----
router.put('/bloodbanks/:id/toggle-flag', (req, res) => {
  const id = parseInt(req.params.id);
  const bank = db.prepare('SELECT flagged FROM blood_bank WHERE id = ?').get(id);
  if (!bank) return res.status(404).json({ error: 'Blood bank not found' });
  const newFlag = bank.flagged ? 0 : 1;
  db.prepare('UPDATE blood_bank SET flagged = ? WHERE id = ?').run(newFlag, id);
  res.json({ success: true, flagged: newFlag });
});

// ---- PUT cancel a request ----
router.put('/requests/:id/cancel', (req, res) => {
  const id = parseInt(req.params.id);
  const result = db.prepare("UPDATE request SET status = 'Cancelled' WHERE id = ? AND status IN ('Pending','InTransit','OutForDelivery')").run(id);
  if (result.changes === 0) return res.status(400).json({ error: 'Request not found or not cancellable' });
  res.json({ success: true });
});

// ---- DELETE hospital ----
router.delete('/hospitals/:id', (req, res) => {
  const id = parseInt(req.params.id);
  db.prepare('DELETE FROM request WHERE hospital_id = ?').run(id);
  const result = db.prepare('DELETE FROM hospital WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'Hospital not found' });
  res.json({ success: true });
});

// ---- DELETE blood bank ----
router.delete('/bloodbanks/:id', (req, res) => {
  const id = parseInt(req.params.id);
  db.prepare('DELETE FROM inventory WHERE blood_bank_id = ?').run(id);
  db.prepare('DELETE FROM request WHERE blood_bank_id = ?').run(id);
  const result = db.prepare('DELETE FROM blood_bank WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'Blood bank not found' });
  res.json({ success: true });
});

module.exports = router;

// ---- Separate login handler (no auth middleware) ----
// In server.js, add BEFORE mounting admin routes:
// app.post('/api/admin/login', require('./routes/admin').loginHandler);
// app.use('/api/admin', require('./routes/admin'));

module.exports.loginHandler = (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });
  const admin = db.prepare('SELECT * FROM admin WHERE username = ? AND password = ?').get(username, password);
  if (!admin) return res.status(401).json({ error: 'Invalid username or password' });
  res.json({ success: true, adminId: admin.id, username: admin.username });
};