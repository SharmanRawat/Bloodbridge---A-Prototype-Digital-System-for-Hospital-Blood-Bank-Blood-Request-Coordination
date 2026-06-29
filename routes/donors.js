const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { requireRole } = require('../middleware/auth');

router.post('/register', async (req, res) => {
  const { name, blood_group, phone, city, lat, lng, patient_ref } = req.body;
  if (!name || !blood_group || !phone) return res.status(400).json({ error: 'Name, blood group, and phone are required.' });
  try {
    const { rows } = await query(
      'INSERT INTO donors (name, blood_group, phone, city, lat, lng, patient_ref) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [name, blood_group, phone, city || null, lat || null, lng || null, patient_ref || null]
    );
    res.json({ success: true, donorId: rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.get('/nearby', requireRole('bloodbank'), async (req, res) => {
  const { blood_group, lat, lng } = req.query;
  if (!blood_group || !lat || !lng) return res.status(400).json({ error: 'Missing parameters' });
  const bankLat = parseFloat(lat), bankLng = parseFloat(lng);
  const { rows } = await query('SELECT * FROM donors WHERE blood_group = $1', [blood_group]);
  function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  const results = rows.map(d => ({
    id: d.id, name: d.name, phone: d.phone, city: d.city,
    distance: d.lat && d.lng ? getDistance(bankLat, bankLng, d.lat, d.lng) : null
  })).sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  res.json(results);
});

module.exports = router;