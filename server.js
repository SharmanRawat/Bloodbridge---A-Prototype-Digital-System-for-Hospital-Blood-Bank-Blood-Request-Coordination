require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { query, initDB } = require('./db');
const { requireRole } = require('./middleware/auth');
const adminRoutes = require('./routes/admin');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

const server = http.createServer(app);
const io = new Server(server);

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

io.on('connection', (socket) => {
  socket.on('donor_location', ({ donorId, lat, lng }) => {
    if (!donorId || lat == null || lng == null) return;
    query(`
      UPDATE request
      SET tracker_lat = $1, tracker_lng = $2, tracker_updated = CURRENT_TIMESTAMP,
          status = CASE WHEN status = 'Acknowledged' THEN 'InTransit' ELSE status END
      WHERE id = $3
    `, [lat, lng, donorId]);
    io.to(`request_${donorId}`).emit('update_donor_pos', { donorId, lat, lng, requestId: donorId });
  });

  socket.on('watch_request', ({ requestId }) => {
    socket.join(`request_${requestId}`);
  });
});

// ---- Admin routes (login is public, rest require auth) ----
app.post('/api/admin/login', adminRoutes.loginHandler);
app.use('/api/admin', adminRoutes);

// ---- Hospital endpoints ----
app.post('/api/hospital/request', async (req, res) => {
  const { hospitalId, bloodGroup } = req.body;
  if (!hospitalId || !bloodGroup) {
    return res.status(400).json({ error: 'hospitalId and bloodGroup are required' });
  }
  try {
    const { rows: hospRows } = await query('SELECT lat, lng FROM hospital WHERE id = $1', [hospitalId]);
    const hospital = hospRows[0];
    if (!hospital) return res.status(404).json({ error: 'Hospital not found' });

    const { rows: banks } = await query(`
      SELECT b.id AS "bankId", b.name AS "bankName", b.lat, b.lng, b.phone, i.units AS "unitsAvailable"
      FROM blood_bank b
      JOIN inventory i ON b.id = i.blood_bank_id
      WHERE i.blood_group = $1 AND i.units > 0
    `, [bloodGroup]);

    const results = banks.map(bank => ({
      bankId: bank.bankId,
      bankName: bank.bankName,
      lat: bank.lat,
      lng: bank.lng,
      phone: bank.phone,
      distance: getDistance(hospital.lat, hospital.lng, bank.lat, bank.lng),
      unitsAvailable: bank.unitsAvailable
    })).sort((a, b) => a.distance - b.distance);

    if (results.length === 0) {
      return res.json({ message: 'No stock available', banks: [] });
    }
    res.json(results);
  } catch (err) {
    console.error('Error in /api/hospital/request:', err);
    res.status(500).json({ error: 'Server error' });
  }
});