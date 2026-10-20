require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { query, initDB } = require('./db');
const { requireRole, optionalAuth, getTokenFromRequest, verifyToken, safeEqual } = require('./middleware/auth');
const adminRoutes = require('./routes/admin');

const app = express();
app.use(express.json({ limit: '256kb' }));
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

// Does the caller (authenticated user OR valid delivery token) have access to a request?
function hasRequestAccess(req, request) {
  if (!request) return false;
  if (req.userRole === 'admin') return true;
  if (req.userRole === 'hospital' && request.hospital_id === req.userId) return true;
  if (req.userRole === 'bloodbank' && request.blood_bank_id === req.userId) return true;
  const token = req.query.t || req.body?.token || req.get('x-delivery-token');
  if (token && request.delivery_token && safeEqual(token, request.delivery_token)) return true;
  return false;
}

io.on('connection', (socket) => {
  socket.on('donor_location', async ({ donorId, lat, lng, token } = {}) => {
    try {
      if (!donorId || lat == null || lng == null) return;
      const { rows } = await query('SELECT id, status, delivery_token FROM request WHERE id = $1', [donorId]);
      const request = rows[0];
      if (!request) return;
      // Require the per-request delivery token. No token -> ignore the update.
      if (!request.delivery_token || !token || !safeEqual(token, request.delivery_token)) return;
      if (!['Acknowledged', 'InTransit'].includes(request.status)) return;
      await query(`
        UPDATE request
        SET tracker_lat = $1, tracker_lng = $2, tracker_updated = CURRENT_TIMESTAMP,
            status = CASE WHEN status = 'Acknowledged' THEN 'InTransit' ELSE status END
        WHERE id = $3
      `, [lat, lng, donorId]);
      io.to(`request_${donorId}`).emit('update_donor_pos', { donorId, lat, lng, requestId: donorId });
    } catch (err) {
      console.error('socket donor_location error:', err.message);
    }
  });

  socket.on('watch_request', async ({ requestId, token } = {}) => {
    try {
      if (!requestId) return;
      const body = verifyToken(token);
      if (!body) return;
      const { rows } = await query('SELECT hospital_id FROM request WHERE id = $1', [requestId]);
      if (!rows.length) return;
      const isOwner = body.role === 'hospital' && rows[0].hospital_id === body.uid;
      if (!isOwner && body.role !== 'admin') return;
      socket.join(`request_${requestId}`);
    } catch (err) {
      console.error('socket watch_request error:', err.message);
    }
  });
});

// ---- Health check ----
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---- Admin routes (login is public, rest require auth) ----
app.post('/api/admin/login', adminRoutes.loginHandler);   // login – NO auth
app.use('/api/admin', adminRoutes);                       // all other admin routes require auth

// ---- Hospital endpoints ----
app.post('/api/hospital/request', requireRole('hospital'), async (req, res) => {
  const { hospitalId, bloodGroup } = req.body;
  if (!hospitalId || !bloodGroup) {
    return res.status(400).json({ error: 'hospitalId and bloodGroup are required' });
  }
  if (parseInt(hospitalId) !== req.userId) return res.status(403).json({ error: 'Access denied' });

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

  if (results.length === 0) return res.json({ message: 'No stock available', banks: [] });
  res.json(results);
});

app.post('/api/hospital/request/confirm', requireRole('hospital'), async (req, res) => {
  const {
    hospitalId, bloodGroup, units, urgency = 'Normal', bankId,
    component, patient_name, patient_age_sex, ward, reg_no,
    doctor_name, contact_no, diagnosis, specific_requirement,
    delivery_name, delivery_phone
  } = req.body;

  if (hospitalId !== req.userId) return res.status(403).json({ error: 'Access denied' });
  const safeUnits = Number.isInteger(units) && units > 0 ? units : 1;

  try {
    await query(`UPDATE request SET status = 'Cancelled' WHERE hospital_id = $1 AND blood_group = $2 AND status = 'Pending'`, [hospitalId, bloodGroup]);
    const { rows: stockRows } = await query('SELECT units FROM inventory WHERE blood_bank_id = $1 AND blood_group = $2', [bankId, bloodGroup]);
    if (!stockRows.length || stockRows[0].units < safeUnits) {
      return res.status(400).json({ error: 'Not enough stock available' });
    }

    const deliveryToken = crypto.randomBytes(18).toString('hex');
    const { rows: reqRows } = await query(`
      INSERT INTO request (hospital_id, blood_group, units, urgency, blood_bank_id,
        component, patient_name, patient_age_sex, ward, reg_no,
        doctor_name, contact_no, diagnosis, specific_requirement,
        delivery_name, delivery_phone, delivery_token)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id
    `, [hospitalId, bloodGroup, safeUnits, urgency, bankId,
        component || 'PRBC', patient_name || null, patient_age_sex || null,
        ward || null, reg_no || null, doctor_name || null,
        contact_no || null, diagnosis || null, specific_requirement || null,
        delivery_name || null, delivery_phone || null, deliveryToken]);

    const requestId = reqRows[0].id;
    const { rowCount } = await query(
      `UPDATE inventory SET units = units - $1, last_updated = CURRENT_TIMESTAMP
       WHERE blood_bank_id = $2 AND blood_group = $3 AND units >= $1`,
      [safeUnits, bankId, bloodGroup]
    );

    if (rowCount === 0) {
      await query('DELETE FROM request WHERE id = $1', [requestId]);
      return res.status(500).json({ error: 'Stock changed, please try again' });
    }

    res.json({ success: true, requestId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/hospital/requests/:hospitalId', requireRole('hospital'), async (req, res) => {
  if (parseInt(req.params.hospitalId) !== req.userId) return res.status(403).json({ error: 'Access denied' });
  const { rows } = await query(`
    SELECT r.*, b.name AS bank_name
    FROM request r
    LEFT JOIN blood_bank b ON r.blood_bank_id = b.id
    WHERE r.hospital_id = $1
    ORDER BY r.created_at DESC
  `, [req.params.hospitalId]);
  res.json(rows);
});

// Accessible to: the owning hospital, the assigned blood bank, an admin,
// or a caller holding the request's delivery token (rider link/QR).
app.get('/api/hospital/request/:id', optionalAuth, async (req, res) => {
  const { rows } = await query(`
    SELECT r.*, h.name AS hospital_name, b.name AS bank_name,
           b.lat AS bank_lat, b.lng AS bank_lng
    FROM request r
    JOIN hospital h ON r.hospital_id = h.id
    LEFT JOIN blood_bank b ON r.blood_bank_id = b.id
    WHERE r.id = $1
  `, [req.params.id]);
  const request = rows[0];
  if (!request) return res.status(404).json({ error: 'Request not found' });

  // Never leak the delivery token through this endpoint.
  const deliveryToken = request.delivery_token;
  delete request.delivery_token;

  if (!hasRequestAccess(req, Object.assign({}, request, { delivery_token: deliveryToken }))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json(request);
});

app.put('/api/hospital/request/:id/cancel', requireRole('hospital'), async (req, res) => {
  const { rows } = await query('SELECT * FROM request WHERE id = $1', [req.params.id]);
  const request = rows[0];
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.hospital_id !== req.userId) return res.status(403).json({ error: 'Access denied' });
  if (!['Pending','Acknowledged','InTransit','OutForDelivery'].includes(request.status))
    return res.status(400).json({ error: 'Cannot cancel' });
  await query("UPDATE request SET status = 'Cancelled' WHERE id = $1", [req.params.id]);
  res.json({ success: true });
});

app.put('/api/hospital/request/:id/delivered', requireRole('hospital'), async (req, res) => {
  const { rows } = await query(`
    SELECT r.*, b.name AS bank_name, h.name AS hospital_name
    FROM request r
    JOIN blood_bank b ON r.blood_bank_id = b.id
    JOIN hospital h ON r.hospital_id = h.id
    WHERE r.id = $1
  `, [req.params.id]);
  const request = rows[0];
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.hospital_id !== req.userId) return res.status(403).json({ error: 'Access denied' });
  if (!['InTransit','OutForDelivery'].includes(request.status))
    return res.status(400).json({ error: 'Must be InTransit or OutForDelivery' });

  // Chain-of-custody: the hospital must enter the bank-generated bag issue
  // code (shown on the rider's bag slip) before delivery can be completed.
  const entered = String(req.body?.issue_code || '').trim().toUpperCase();
  if (!request.issue_code || !entered || !safeEqual(entered, request.issue_code))
    return res.status(400).json({ success: false, error: 'Invalid bag issue code — check the code printed on the bag slip' });

  await query("UPDATE request SET status = 'Delivered', delivered_at = NOW() WHERE id = $1", [req.params.id]);

  // Permanent audit record: which bag, to which hospital, by which rider, how long.
  const deliveredAt = new Date();
  const pickedUpAt = request.ready_at ? new Date(request.ready_at) : null;
  const createdAt = new Date(request.created_at);
  const transitSeconds = pickedUpAt ? Math.max(0, Math.round((deliveredAt - pickedUpAt) / 1000)) : null;
  const totalSeconds = Math.max(0, Math.round((deliveredAt - createdAt) / 1000));
  await query(`
    INSERT INTO delivery_log (request_id, issue_code, blood_bank_id, hospital_id, bank_name, hospital_name,
      blood_group, component, units, rider_name, rider_phone,
      request_created_at, acknowledged_at, picked_up_at, delivered_at, transit_seconds, total_seconds)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
  `, [request.id, request.issue_code, request.blood_bank_id, request.hospital_id, request.bank_name, request.hospital_name,
      request.blood_group, request.component, request.units, request.delivery_name, request.delivery_phone,
      request.created_at, request.acknowledged_at, pickedUpAt, deliveredAt, transitSeconds, totalSeconds]);

  res.json({ success: true, message: 'Delivery confirmed and logged', issueCode: request.issue_code });
});

app.get('/api/hospital/location', requireRole('hospital'), async (req, res) => {
  const { rows } = await query('SELECT lat, lng FROM hospital WHERE id = $1', [req.userId]);
  if (!rows.length) return res.status(404).json({ error: 'Hospital not found' });
  res.json(rows[0]);
});

app.get('/api/hospital/track-request/:id', requireRole('hospital'), async (req, res) => {
  const { rows } = await query('SELECT tracker_lat, tracker_lng, tracker_updated, status FROM request WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Request not found' });
  res.json(rows[0]);
});

// ---- Delivery person endpoints (require the request's delivery token) ----
app.post('/api/delivery/update-location', async (req, res) => {
  const { requestId, lat, lng, token } = req.body;
  if (!requestId || lat == null || lng == null) return res.status(400).json({ error: 'Missing fields' });
  const { rows } = await query('SELECT id, status, delivery_token FROM request WHERE id = $1', [requestId]);
  if (!rows.length) return res.status(404).json({ error: 'Request not found' });
  const reqRow = rows[0];
  if (!reqRow.delivery_token || !token || !safeEqual(token, reqRow.delivery_token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!['Acknowledged','InTransit','Ready','OutForDelivery'].includes(reqRow.status))
    return res.status(400).json({ error: 'Request cannot be tracked at this stage' });
  await query(`
    UPDATE request
    SET tracker_lat = $1, tracker_lng = $2, tracker_updated = CURRENT_TIMESTAMP,
        status = CASE WHEN status = 'Acknowledged' THEN 'InTransit' ELSE status END
    WHERE id = $3
  `, [lat, lng, requestId]);
  res.json({ success: true });
});

app.put('/api/delivery/confirm-pickup/:id', async (req, res) => {
  const token = req.query.t || req.body?.token || req.get('x-delivery-token');
  const { rows } = await query('SELECT id, status, delivery_token FROM request WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Request not found' });
  const request = rows[0];
  if (!request.delivery_token || !token || !safeEqual(token, request.delivery_token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (request.status === 'OutForDelivery') return res.json({ success: true, message: 'Already confirmed' });
  if (request.status !== 'Ready') return res.status(400).json({ error: 'OTP must be verified first' });
  await query("UPDATE request SET status = 'OutForDelivery' WHERE id = $1", [req.params.id]);
  res.json({ success: true });
});

// ---- Mount route modules ----
app.use('/api/bloodbank', require('./routes/bloodbank'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/donors', require('./routes/donors'));

// ---- Error handler (prevents crashes / stack leakage on unexpected errors) ----
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err && err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Server error' });
});

function startServer(port) {
  server.listen(port, () => {
    console.log(`BloodBridge server running on port ${port}`);
  });
}

async function initialize() {
  let attempts = 0;
  const maxAttempts = 5;
  while (attempts < maxAttempts) {
    try {
      await initDB();
      const PORT = process.env.PORT || 3000;
      startServer(PORT);
      return;
    } catch (err) {
      attempts++;
      console.error(`Database init failed (${attempts}/${maxAttempts}):`, err.message);
      if (attempts >= maxAttempts) {
        console.error('Failed to initialize database after multiple attempts. Exiting...');
        process.exit(1);
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

initialize();
