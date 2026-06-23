const express = require('express');
const router = express.Router();
const db = require('../database');

// Get all requests for a blood bank
router.get('/requests/:bankId', (req, res) => {
  const { bankId } = req.params;
  const requests = db.prepare(`
    SELECT r.id, r.hospital_id, h.name as hospital_name, r.blood_group, r.units, r.urgency, r.status, r.created_at
    FROM request r
    JOIN hospital h ON r.hospital_id = h.id
    WHERE r.blood_bank_id = ?
    ORDER BY r.created_at DESC
  `).all(bankId);
  res.json(requests);
});

// Acknowledge a request
router.put('/request/:id/acknowledge', (req, res) => {
  const { id } = req.params;
  db.prepare('UPDATE request SET status = ? WHERE id = ?').run('Acknowledged', id);
  res.json({ success: true, message: 'Request acknowledged' });
});

// Get inventory for a blood bank
router.get('/inventory/:bankId', (req, res) => {
  const { bankId } = req.params;
  const inventory = db.prepare('SELECT blood_group, units, last_updated FROM inventory WHERE blood_bank_id = ?').all(bankId);
  res.json(inventory);
});

// Update inventory
router.put('/inventory/:bankId', (req, res) => {
  const { bankId } = req.params;
  const { bloodGroup, units } = req.body;
  const existing = db.prepare('SELECT id FROM inventory WHERE blood_bank_id = ? AND blood_group = ?').get(bankId, bloodGroup);
  if (existing) {
    db.prepare('UPDATE inventory SET units = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?').run(units, existing.id);
  } else {
    db.prepare('INSERT INTO inventory (blood_bank_id, blood_group, units) VALUES (?, ?, ?)').run(bankId, bloodGroup, units);
  }
  res.json({ success: true, message: 'Inventory updated' });
});

module.exports = router;
