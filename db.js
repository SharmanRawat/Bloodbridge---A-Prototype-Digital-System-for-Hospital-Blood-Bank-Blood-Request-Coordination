const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  family: 4          // ← force IPv4
});

async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

async function initDB() {
  await query(`
    CREATE TABLE IF NOT EXISTS hospital (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT,
      lat REAL,
      lng REAL,
      password TEXT DEFAULT 'hospital123'
    );

    CREATE TABLE IF NOT EXISTS blood_bank (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT,
      lat REAL,
      lng REAL,
      password TEXT DEFAULT 'bank123',
      phone TEXT,
      flagged INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id SERIAL PRIMARY KEY,
      blood_bank_id INTEGER REFERENCES blood_bank(id),
      blood_group TEXT CHECK(blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
      units INTEGER DEFAULT 0,
      last_updated TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS request (
      id SERIAL PRIMARY KEY,
      hospital_id INTEGER REFERENCES hospital(id),
      blood_group TEXT,
      units INTEGER,
      urgency TEXT CHECK(urgency IN ('Normal','Emergency')),
      status TEXT DEFAULT 'Pending' CHECK(status IN ('Pending','Acknowledged','Cancelled','InTransit','Delivered','Ready','OutForDelivery')),
      blood_bank_id INTEGER REFERENCES blood_bank(id),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      pickup_otp TEXT,
      component TEXT DEFAULT 'PRBC',
      patient_name TEXT,
      patient_age_sex TEXT,
      ward TEXT,
      reg_no TEXT,
      doctor_name TEXT,
      contact_no TEXT,
      diagnosis TEXT,
      specific_requirement TEXT,
      delivery_name TEXT,
      delivery_phone TEXT,
      tracker_lat REAL,
      tracker_lng REAL,
      tracker_updated TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS donors (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      blood_group TEXT CHECK(blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
      phone TEXT,
      city TEXT,
      lat REAL,
      lng REAL,
      patient_ref TEXT,
      registered_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS admin (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    );
  `);

  const { rows } = await query('SELECT COUNT(*) as count FROM hospital');
  if (parseInt(rows[0].count) === 0) {
    await query(`INSERT INTO hospital (name, address, lat, lng, password) VALUES ($1,$2,$3,$4,$5)`,
      ['Aashray Hospital', 'Vadodara, Gujarat', 22.323281525618334, 73.13511963833432, 'hospital123']);
    await query(`INSERT INTO hospital (name, address, lat, lng, password) VALUES ($1,$2,$3,$4,$5)`,
      ['Bhailal Amin Hospital', 'Vadodara, Gujarat', 22.32578593329923, 73.16325679999954, 'hospital123']);

    const banks = [
      { name: 'Red Cross Blood Centre', lat: 22.311375797419654, lng: 73.17930905385647, phone: '9876500001' },
      { name: 'Dhwani Blood Centre', lat: 22.306452605739377, lng: 73.18505970995074, phone: '9876500002' },
      { name: 'Ayush Blood Centre', lat: 22.308120157844115, lng: 73.17527501152172, phone: '9876500003' },
      { name: 'Indu Blood Bank', lat: 22.30414070835396, lng: 73.19348965485375, phone: '9876500004' },
      { name: 'Lions Club Of Baroda Blood Centre', lat: 22.31073752476958, lng: 73.15660991778404, phone: '9876500005' }
    ];
    const bloodGroups = ['A+','B+','O+','AB+'];
    for (const bank of banks) {
      const { rows: bankRows } = await query(
        `INSERT INTO blood_bank (name, address, lat, lng, password, phone) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [bank.name, 'Vadodara, Gujarat', bank.lat, bank.lng, 'bank123', bank.phone]
      );
      const bankId = bankRows[0].id;
      for (const bg of bloodGroups) {
        const units = Math.floor(Math.random() * 5) + 2;
        await query(`INSERT INTO inventory (blood_bank_id, blood_group, units) VALUES ($1,$2,$3)`, [bankId, bg, units]);
      }
    }
    await query(`INSERT INTO admin (username, password) VALUES ($1,$2)`, ['admin', 'admin123']);
  }

  console.log('Database initialized');
}

module.exports = { query, initDB };