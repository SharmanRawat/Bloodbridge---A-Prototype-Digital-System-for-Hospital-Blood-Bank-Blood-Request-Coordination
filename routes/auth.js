const express = require('express');
const router = express.Router();
const db = require('../database');

// Register a new hospital or blood bank
router.post('/register', (req, res) => {
  const { role, name, address, lat, lng, password } = req.body;
  if (!role || !name || !password) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  try {
    if (role === 'hospital') {
      const result = db.prepare('INSERT INTO hospital (name, address, lat, lng, password) VALUES (?,?,?,?,?)')
        .run(name, address || null, lat || 0, lng || 0, password);
      return res.json({ success: true, userId: result.lastInsertRowid, role: 'hospital' });
    } else if (role === 'bloodbank') {
      const result = db.prepare('INSERT INTO blood_bank (name, address, lat, lng, password) VALUES (?,?,?,?,?)')
        .run(name, address || null, lat || 0, lng || 0, password);
      return res.json({ success: true, userId: result.lastInsertRowid, role: 'bloodbank' });
    } else {
      return res.status(400).json({ error: 'Invalid role' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', (req, res) => {
  const { role, emailOrId, password } = req.body;
  if (!role || !password) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  try {
    if (role === 'hospital') {
      const hospital = db.prepare('SELECT id, name FROM hospital WHERE name = ? AND password = ?').get(emailOrId, password);
      if (hospital) {
        return res.json({ success: true, userId: hospital.id, role: 'hospital', name: hospital.name });
      }
    } else if (role === 'bloodbank') {
      const bank = db.prepare('SELECT id, name FROM blood_bank WHERE name = ? AND password = ?').get(emailOrId, password);
      if (bank) {
        return res.json({ success: true, userId: bank.id, role: 'bloodbank', name: bank.name });
      }
    }
    res.status(401).json({ error: 'Invalid credentials' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

module.exports = router;
