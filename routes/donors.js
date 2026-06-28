const express = require('express');
const router = express.Router();
const db = require('../database');
const { requireRole } = require('../middleware/auth');

// Public route – anyone can register as a donor
router.post('/register', (req, res) => {
  const { name, blood_group, phone, city, lat, lng, patient_ref } = req.body;
  if (!name || !blood_group || !phone) {
    return res.status(400).json({ error: 'Name, blood group, and phone are required.' });
  }
  try {
    const result = db.prepare(`
      INSERT INTO donors (name, blood_group, phone, city, lat, lng, patient_ref)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(name, blood_group, phone, city || null, lat || null, lng || null, patient_ref || null);
    res.json({ success: true, donorId: result.lastInsertRowid });
  } catch (err) {
    console.error('Donor register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Protected route – only blood banks can search donors
router.get('/nearby', requireRole('bloodbank'), (req, res) => {
  const { blood_group, lat, lng } = req.query;
  if (!blood_group || !lat || !lng) {
    return res.status(400).json({ error: 'blood_group, lat, and lng are required.' });
  }
  // Convert to numbers
  const bankLat = parseFloat(lat);
  const bankLng = parseFloat(lng);
  if (isNaN(bankLat) || isNaN(bankLng)) {
    return res.status(400).json({ error: 'Invalid coordinates.' });
  }

  // Haversine formula (same as server.js)
  function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  const donors = db.prepare(`
    SELECT id, name, phone, city, lat, lng
    FROM donors
    WHERE blood_group = ?
  `).all(blood_group);

  const results = donors
    .map(d => ({
      id: d.id,
      name: d.name,
      phone: d.phone,
      city: d.city,
      distance: d.lat && d.lng ? getDistance(bankLat, bankLng, d.lat, d.lng) : null
    }))
    .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));

  res.json(results);
});

module.exports = router;