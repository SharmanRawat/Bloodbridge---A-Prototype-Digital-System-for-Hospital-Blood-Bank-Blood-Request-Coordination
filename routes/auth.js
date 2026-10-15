const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { signToken } = require('../middleware/auth');
const { hashPassword, verifyPassword } = require('../lib/passwords');

const BLOOD_GROUPS = ['A+','A-','B+','B-','AB+','AB-','O+','O-'];

router.post('/register', async (req, res) => {
  const { role, name, address, lat, lng, password, phone } = req.body;
  if (!role || !name || !password) return res.status(400).json({ error: 'Missing fields' });
  if (role !== 'hospital' && role !== 'bloodbank') return res.status(400).json({ error: 'Invalid role' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  try {
    const hashed = hashPassword(password);
    const safeLat = Number.isFinite(Number(lat)) ? Number(lat) : 0;
    const safeLng = Number.isFinite(Number(lng)) ? Number(lng) : 0;
    if (role === 'hospital') {
      const { rows } = await query(
        'INSERT INTO hospital (name, address, lat, lng, password) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [name, address || null, safeLat, safeLng, hashed]
      );
      return res.json({ success: true, userId: rows[0].id, role: 'hospital' });
    }
    const { rows } = await query(
      'INSERT INTO blood_bank (name, address, lat, lng, password, phone) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [name, address || null, safeLat, safeLng, hashed, phone || null]
    );
    return res.json({ success: true, userId: rows[0].id, role: 'bloodbank' });
  } catch (err) {
    console.error('Registration error:', err.message);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  const { role, emailOrId, password } = req.body;
  if (!role || !password || !emailOrId) return res.status(400).json({ error: 'Missing fields' });
  try {
    if (role === 'hospital') {
      const { rows } = await query('SELECT id, name, password FROM hospital WHERE name = $1', [emailOrId]);
      if (rows.length && verifyPassword(password, rows[0].password)) {
        const token = signToken({ uid: rows[0].id, role: 'hospital' });
        return res.json({ success: true, token, userId: rows[0].id, role: 'hospital', name: rows[0].name });
      }
    } else if (role === 'bloodbank') {
      const { rows } = await query('SELECT id, name, password FROM blood_bank WHERE name = $1', [emailOrId]);
      if (rows.length && verifyPassword(password, rows[0].password)) {
        const token = signToken({ uid: rows[0].id, role: 'bloodbank' });
        return res.json({ success: true, token, userId: rows[0].id, role: 'bloodbank', name: rows[0].name });
      }
    }
    res.status(401).json({ error: 'Invalid credentials' });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

module.exports = router;
module.exports.BLOOD_GROUPS = BLOOD_GROUPS;
