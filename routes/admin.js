// routes/admin.js – PostgreSQL version
const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { requireRole } = require('../middleware/auth');

// Protect every route in this file with admin role
router.use(requireRole('admin'));

// ---- GET all hospitals ----
router.get('/hospitals', async (req, res) => {
  const { rows } = await query('SELECT id, name, address, lat, lng FROM hospital ORDER BY id ASC');
  res.json(rows);
});

// ---- GET all blood banks ----
router.get('/bloodbanks', async (req, res) => {
  const { rows } = await query('SELECT id, name, address, phone, lat, lng, flagged FROM blood_bank ORDER BY id ASC');
  res.json(rows);
});

// ---- GET all requests (with hospital and blood bank names) ----
router.get('/requests', async (req, res) => {
  const { status } = req.query;
  let sql = `
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
    sql += ' WHERE r.status = $1';
    params.push(status);
  }
  sql += ' ORDER BY r.created_at DESC';
  const { rows } = await query(sql, params);
  res.json(rows);
});

// ---- GET summary stats ----
router.get('/stats', async (req, res) => {
  const totalHospitals = (await query('SELECT COUNT(*) AS count FROM hospital')).rows[0].count;
  const totalBanks = (await query('SELECT COUNT(*) AS count FROM blood_bank')).rows[0].count;
  const totalRequests = (await query('SELECT COUNT(*) AS count FROM request')).rows[0].count;
  const pending = (await query("SELECT COUNT(*) AS count FROM request WHERE status = 'Pending'")).rows[0].count;
  const acknowledged = (await query("SELECT COUNT(*) AS count FROM request WHERE status = 'Acknowledged'")).rows[0].count;
  const cancelled = (await query("SELECT COUNT(*) AS count FROM request WHERE status = 'Cancelled'")).rows[0].count;
  const ready = (await query("SELECT COUNT(*) AS count FROM request WHERE status = 'Ready'")).rows[0].count;
  const intransit = (await query("SELECT COUNT(*) AS count FROM request WHERE status = 'InTransit'")).rows[0].count;
  const outfordelivery = (await query("SELECT COUNT(*) AS count FROM request WHERE status = 'OutForDelivery'")).rows[0].count;
  res.json({ totalHospitals, totalBanks, totalRequests, pending, acknowledged, cancelled, ready, intransit, outfordelivery });
});

// ---- PUT reset hospital password ----
router.put('/hospitals/:id/reset-password', async (req, res) => {
  const id = parseInt(req.params.id);
  const { rowCount } = await query("UPDATE hospital SET password = 'hospital123' WHERE id = $1", [id]);
  if (rowCount === 0) return res.status(404).json({ error: 'Hospital not found' });
  res.json({ success: true, message: 'Password reset to hospital123' });
});

// ---- PUT reset blood bank password ----
router.put('/bloodbanks/:id/reset-password', async (req, res) => {
  const id = parseInt(req.params.id);
  const { rowCount } = await query("UPDATE blood_bank SET password = 'bank123' WHERE id = $1", [id]);
  if (rowCount === 0) return res.status(404).json({ error: 'Blood bank not found' });
  res.json({ success: true, message: 'Password reset to bank123' });
});

// ---- PUT toggle blood bank flag ----
router.put('/bloodbanks/:id/toggle-flag', async (req, res) => {
  const id = parseInt(req.params.id);
  const { rows } = await query('SELECT flagged FROM blood_bank WHERE id = $1', [id]);
  const bank = rows[0];
  if (!bank) return res.status(404).json({ error: 'Blood bank not found' });
  const newFlag = bank.flagged ? 0 : 1;
  await query('UPDATE blood_bank SET flagged = $1 WHERE id = $2', [newFlag, id]);
  res.json({ success: true, flagged: newFlag });
});

// ---- PUT cancel a request ----
router.put('/requests/:id/cancel', async (req, res) => {
  const id = parseInt(req.params.id);
  const { rowCount } = await query(
    "UPDATE request SET status = 'Cancelled' WHERE id = $1 AND status IN ('Pending','InTransit','OutForDelivery')",
    [id]
  );
  if (rowCount === 0) return res.status(400).json({ error: 'Request not found or not cancellable' });
  res.json({ success: true });
});

// ---- DELETE hospital ----
router.delete('/hospitals/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  await query('DELETE FROM request WHERE hospital_id = $1', [id]);
  const { rowCount } = await query('DELETE FROM hospital WHERE id = $1', [id]);
  if (rowCount === 0) return res.status(404).json({ error: 'Hospital not found' });
  res.json({ success: true });
});

// ---- DELETE blood bank ----
router.delete('/bloodbanks/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  await query('DELETE FROM inventory WHERE blood_bank_id = $1', [id]);
  await query('DELETE FROM request WHERE blood_bank_id = $1', [id]);
  const { rowCount } = await query('DELETE FROM blood_bank WHERE id = $1', [id]);
  if (rowCount === 0) return res.status(404).json({ error: 'Blood bank not found' });
  res.json({ success: true });
});

module.exports = router;

// ---- Separate login handler (no auth middleware) ----
module.exports.loginHandler = async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });
  const { rows } = await query('SELECT * FROM admin WHERE username = $1 AND password = $2', [username, password]);
  if (rows.length === 0) return res.status(401).json({ error: 'Invalid username or password' });
  const admin = rows[0];
  res.json({ success: true, adminId: admin.id, username: admin.username });
};