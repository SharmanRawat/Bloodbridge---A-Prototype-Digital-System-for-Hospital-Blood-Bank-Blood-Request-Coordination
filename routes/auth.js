const express = require('express');
const router = express.Router();
const { query } = require('../db');

router.post('/register', async (req, res) => {
  const { role, name, address, lat, lng, password, phone } = req.body;
  if (!role || !name || !password) return res.status(400).json({ error: 'Missing fields' });
  try {
    if (role === 'hospital') {
      const { rows } = await query(
        'INSERT INTO hospital (name, address, lat, lng, password) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [name, address || null, lat || 0, lng || 0, password]
      );
      return res.json({ success: true, userId: rows[0].id, role: 'hospital' });
    } else if (role === 'bloodbank') {
      const { rows } = await query(
        'INSERT INTO blood_bank (name, address, lat, lng, password, phone) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [name, address || null, lat || 0, lng || 0, password, phone || null]
      );
      return res.json({ success: true, userId: rows[0].id, role: 'bloodbank' });
    } else {
      return res.status(400).json({ error: 'Invalid role' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  const { role, emailOrId, password } = req.body;
  if (!role || !password) return res.status(400).json({ error: 'Missing fields' });
  try {
    if (role === 'hospital') {
      const { rows } = await query('SELECT id, name FROM hospital WHERE name = $1 AND password = $2', [emailOrId, password]);
      if (rows.length) return res.json({ success: true, userId: rows[0].id, role: 'hospital', name: rows[0].name });
    } else if (role === 'bloodbank') {
      const { rows } = await query('SELECT id, name FROM blood_bank WHERE name = $1 AND password = $2', [emailOrId, password]);
      if (rows.length) return res.json({ success: true, userId: rows[0].id, role: 'bloodbank', name: rows[0].name });
    }
    res.status(401).json({ error: 'Invalid credentials' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

module.exports = router;