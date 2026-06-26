const express = require('express');
const router = express.Router();
const db = require('../database');
const { requireRole } = require('../middleware/auth');

// Get incoming requests (protected + ownership)
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

// Acknowledge (protected + ownership + cancel competing requests)
router.put('/request/:id/acknowledge', requireRole('bloodbank'), (req, res) => {
  const request = db.prepare('SELECT id, blood_bank_id, hospital_id, blood_group FROM request WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.blood_bank_id !== req.userId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  // Transaction: acknowledge + cancel competitors
  const acknowledgeStmt = db.prepare('UPDATE request SET status = ? WHERE id = ?');
  const cancelStmt = db.prepare(`
    UPDATE request
    SET status = 'Cancelled'
    WHERE hospital_id = ? AND blood_group = ? AND id <> ? AND status = 'Pending'
  `);

  db.transaction(() => {
    acknowledgeStmt.run('Acknowledged', req.params.id);
    cancelStmt.run(request.hospital_id, request.blood_group, req.params.id);
  })();

  res.json({ success: true, message: 'Request acknowledged' });
});

// Inventory (protected + ownership)
router.get('/inventory/:bankId', requireRole('bloodbank'), (req, res) => {
  if (parseInt(req.params.bankId) !== req.userId) return res.status(403).json({ error: 'Access denied' });
  const inventory = db.prepare('SELECT blood_group, units, last_updated FROM inventory WHERE blood_bank_id = ?').all(req.params.bankId);
  res.json(inventory);
});

router.put('/inventory/:bankId', requireRole('bloodbank'), (req, res) => {
  if (parseInt(req.params.bankId) !== req.userId) return res.status(403).json({ error: 'Access denied' });
  const { bloodGroup, units } = req.body;
  const safeUnits = Math.max(0, units);
  const existing = db.prepare('SELECT id FROM inventory WHERE blood_bank_id = ? AND blood_group = ?').get(req.params.bankId, bloodGroup);
  if (existing) {
    db.prepare('UPDATE inventory SET units = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?').run(safeUnits, existing.id);
  } else {
    db.prepare('INSERT INTO inventory (blood_bank_id, blood_group, units) VALUES (?, ?, ?)').run(req.params.bankId, bloodGroup, safeUnits);
  }
  res.json({ success: true, message: 'Inventory updated' });
});

module.exports = router;