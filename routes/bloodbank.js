const express = require('express');
const router = express.Router();
const db = require('../database');
const { requireRole } = require('../middleware/auth');

// Get incoming requests for a bank (protected + ownership)
router.get('/requests/:bankId', requireRole('bloodbank'), (req, res) => {
  if (parseInt(req.params.bankId) !== req.userId) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const requests = db.prepare(`
    SELECT r.id, r.hospital_id, h.name as hospital_name, r.blood_group, r.units, r.urgency, r.status, r.created_at
    FROM request r
    JOIN hospital h ON r.hospital_id = h.id
    WHERE r.blood_bank_id = ?
    ORDER BY r.created_at DESC
  `).all(req.params.bankId);
  res.json(requests);
});

// Acknowledge a request (protected + ownership of request)
router.put('/request/:id/acknowledge', requireRole('bloodbank'), (req, res) => {
  // Verify request belongs to this bank
  const reqRow = db.prepare('SELECT blood_bank_id FROM request WHERE id = ?').get(req.params.id);
  if (!reqRow || reqRow.blood_bank_id !== req.userId) {
    return res.status(403).json({ error: 'Access denied' });
  }
  db.prepare('UPDATE request SET status = ? WHERE id = ?').run('Acknowledged', req.params.id);
  res.json({ success: true, message: 'Request acknowledged' });
});

// Get inventory for a bank (protected + ownership)
router.get('/inventory/:bankId', requireRole('bloodbank'), (req, res) => {
  if (parseInt(req.params.bankId) !== req.userId) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const inventory = db.prepare('SELECT blood_group, units, last_updated FROM inventory WHERE blood_bank_id = ?').all(req.params.bankId);
  res.json(inventory);
});

// Update inventory (protected + ownership)
router.put('/inventory/:bankId', requireRole('bloodbank'), (req, res) => {
  if (parseInt(req.params.bankId) !== req.userId) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const { bloodGroup, units } = req.body;
  const safeUnits = Math.max(0, units); // prevent negative
  const existing = db.prepare('SELECT id FROM inventory WHERE blood_bank_id = ? AND blood_group = ?').get(req.params.bankId, bloodGroup);
  if (existing) {
    db.prepare('UPDATE inventory SET units = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?').run(safeUnits, existing.id);
  } else {
    db.prepare('INSERT INTO inventory (blood_bank_id, blood_group, units) VALUES (?, ?, ?)').run(req.params.bankId, bloodGroup, safeUnits);
  }
  res.json({ success: true, message: 'Inventory updated' });
});

module.exports = router;