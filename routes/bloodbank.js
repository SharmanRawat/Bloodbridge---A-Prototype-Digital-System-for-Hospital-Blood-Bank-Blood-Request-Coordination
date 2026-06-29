const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { requireRole } = require('../middleware/auth');

// Get incoming requests
router.get('/requests/:bankId', requireRole('bloodbank'), async (req, res) => {
  if (parseInt(req.params.bankId) !== req.userId) return res.status(403).json({ error: 'Access denied' });
  const { rows } = await query(`
    SELECT r.*, h.name AS hospital_name
    FROM request r
    JOIN hospital h ON r.hospital_id = h.id
    WHERE r.blood_bank_id = $1
    ORDER BY r.created_at DESC
  `, [req.params.bankId]);
  res.json(rows);
});

// Acknowledge (generate OTP, cancel competitors)
router.put('/request/:id/acknowledge', requireRole('bloodbank'), async (req, res) => {
  const { rows } = await query('SELECT * FROM request WHERE id = $1', [req.params.id]);
  const request = rows[0];
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.blood_bank_id !== req.userId) return res.status(403).json({ error: 'Access denied' });

  const otp = require('crypto').randomInt(1000, 9999).toString();

  await query('UPDATE request SET status = $1, pickup_otp = $2 WHERE id = $3', ['Acknowledged', otp, req.params.id]);
  await query("UPDATE request SET status = 'Cancelled' WHERE hospital_id = $1 AND blood_group = $2 AND id <> $3 AND status = 'Pending'",
    [request.hospital_id, request.blood_group, req.params.id]);

  res.json({ success: true, message: 'Request acknowledged', pickupOtp: otp });
});

// Verify OTP
router.post('/request/:id/verify-pickup', requireRole('bloodbank'), async (req, res) => {
  const { otp } = req.body;
  const { rows } = await query('SELECT * FROM request WHERE id = $1', [req.params.id]);
  const request = rows[0];
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.blood_bank_id !== req.userId) return res.status(403).json({ error: 'Access denied' });
  if (!['Acknowledged','InTransit'].includes(request.status))
    return res.status(400).json({ error: 'Request cannot be verified now' });
  if (String(request.pickup_otp).trim() !== String(otp).trim())
    return res.status(400).json({ success: false, message: 'Invalid OTP' });
  await query("UPDATE request SET status = 'Ready' WHERE id = $1", [req.params.id]);
  res.json({ success: true, message: 'Pickup verified' });
});

// Inventory
router.get('/inventory/:bankId', requireRole('bloodbank'), async (req, res) => {
  if (parseInt(req.params.bankId) !== req.userId) return res.status(403).json({ error: 'Access denied' });
  const { rows } = await query('SELECT * FROM inventory WHERE blood_bank_id = $1', [req.params.bankId]);
  res.json(rows);
});

router.put('/inventory/:bankId', requireRole('bloodbank'), async (req, res) => {
  if (parseInt(req.params.bankId) !== req.userId) return res.status(403).json({ error: 'Access denied' });
  const { bloodGroup, units } = req.body;
  const safeUnits = Math.max(0, units);
  const { rows } = await query('SELECT id FROM inventory WHERE blood_bank_id = $1 AND blood_group = $2', [req.params.bankId, bloodGroup]);
  if (rows.length) {
    await query('UPDATE inventory SET units = $1, last_updated = CURRENT_TIMESTAMP WHERE id = $2', [safeUnits, rows[0].id]);
  } else {
    await query('INSERT INTO inventory (blood_bank_id, blood_group, units) VALUES ($1,$2,$3)', [req.params.bankId, bloodGroup, safeUnits]);
  }
  res.json({ success: true, message: 'Inventory updated' });
});

// Bank location
router.get('/location/:bankId', requireRole('bloodbank'), async (req, res) => {
  if (parseInt(req.params.bankId) !== req.userId) return res.status(403).json({ error: 'Access denied' });
  const { rows } = await query('SELECT lat, lng FROM blood_bank WHERE id = $1', [req.params.bankId]);
  if (!rows.length) return res.status(404).json({ error: 'Bank not found' });
  res.json(rows[0]);
});

// Stats
router.get('/stats/:bankId', requireRole('bloodbank'), async (req, res) => {
  if (parseInt(req.params.bankId) !== req.userId) return res.status(403).json({ error: 'Access denied' });
  const bankId = req.params.bankId;
  const total = (await query('SELECT COUNT(*) as count FROM request WHERE blood_bank_id = $1', [bankId])).rows[0].count;
  const fulfilled = (await query("SELECT COUNT(*) as count FROM request WHERE blood_bank_id = $1 AND status IN ('Acknowledged','InTransit','OutForDelivery','Delivered','Ready')", [bankId])).rows[0].count;
  const pending = (await query("SELECT COUNT(*) as count FROM request WHERE blood_bank_id = $1 AND status = 'Pending'", [bankId])).rows[0].count;
  const topGroups = (await query('SELECT blood_group, COUNT(*) as cnt FROM request WHERE blood_bank_id = $1 GROUP BY blood_group ORDER BY cnt DESC LIMIT 5', [bankId])).rows;
  const daily = (await query("SELECT date(created_at) as day, COUNT(*) as cnt FROM request WHERE blood_bank_id = $1 AND created_at >= NOW() - INTERVAL '7 days' GROUP BY day ORDER BY day DESC", [bankId])).rows;
  res.json({ total, fulfilled, pending, topGroups, daily });
});

module.exports = router;