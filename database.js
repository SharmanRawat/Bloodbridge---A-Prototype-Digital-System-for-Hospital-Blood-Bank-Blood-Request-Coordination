const Database = require('better-sqlite3');
const db = new Database('bloodbridge.db');

db.exec('PRAGMA foreign_keys = ON');

// Create tables (only SQL here – no JavaScript)
db.exec(`
  CREATE TABLE IF NOT EXISTS hospital (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address TEXT,
    lat REAL,
    lng REAL,
    password TEXT DEFAULT 'hospital123'
  );

  CREATE TABLE IF NOT EXISTS blood_bank (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address TEXT,
    lat REAL,
    lng REAL,
    password TEXT DEFAULT 'bank123',
    phone TEXT
  );

  CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    blood_bank_id INTEGER,
    blood_group TEXT CHECK(blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
    units INTEGER DEFAULT 0,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (blood_bank_id) REFERENCES blood_bank(id)
  );

  CREATE TABLE IF NOT EXISTS request (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hospital_id INTEGER,
    blood_group TEXT,
    units INTEGER,
    urgency TEXT CHECK(urgency IN ('Normal','Emergency')),
    status TEXT DEFAULT 'Pending' CHECK(status IN ('Pending','Acknowledged','Ready','Cancelled')),
    blood_bank_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    pickup_otp TEXT DEFAULT NULL,
    FOREIGN KEY (hospital_id) REFERENCES hospital(id),
    FOREIGN KEY (blood_bank_id) REFERENCES blood_bank(id)
  );
`);

// Migration: add phone column to blood_bank if the table already existed
const bankColumns = db.prepare("PRAGMA table_info(blood_bank)").all();
if (!bankColumns.some(col => col.name === 'phone')) {
  db.exec('ALTER TABLE blood_bank ADD COLUMN phone TEXT');
}

// Migration: add pickup_otp column to request if the table already existed
const requestColumns = db.prepare("PRAGMA table_info(request)").all();
if (!requestColumns.some(col => col.name === 'pickup_otp')) {
  db.exec('ALTER TABLE request ADD COLUMN pickup_otp TEXT DEFAULT NULL');
}

// Seed data only if no blood banks exist
const bankCount = db.prepare('SELECT COUNT(*) AS count FROM blood_bank').get();
if (bankCount.count === 0) {
  // Insert hospital
  db.prepare('INSERT INTO hospital (name, address, lat, lng) VALUES (?, ?, ?, ?)')
    .run('SVP Hospital Vasad', 'Vasad, Gujarat', 22.4500, 73.1200);

  // Insert blood banks
  const banks = [
    { name: 'Red Cross Vadodara', lat: 22.3072, lng: 73.1812, phone: '9876500001' },
    { name: 'SSG Blood Bank Vadodara', lat: 22.3000, lng: 73.2000, phone: '9876500002' },
    { name: 'GMERS Gotri', lat: 22.3200, lng: 73.1700, phone: '9876500003' }
  ];

  const insertBank = db.prepare('INSERT INTO blood_bank (name, lat, lng, phone) VALUES (?, ?, ?, ?)');
  const insertInventory = db.prepare('INSERT INTO inventory (blood_bank_id, blood_group, units) VALUES (?, ?, ?)');

  const bloodGroups = ['A+', 'B+', 'O+', 'AB+'];

  for (const bank of banks) {
    const result = insertBank.run(bank.name, bank.lat, bank.lng, bank.phone);
    const bankId = result.lastInsertRowid;
    for (const bg of bloodGroups) {
      let units = Math.floor(Math.random() * 6);
      if (bg === 'B+' && bankId === 2) units = 3; // ensure B+ available
      insertInventory.run(bankId, bg, units);
    }
  }
}

// Set default passwords for the existing dummy data
db.prepare("UPDATE hospital SET password = 'hospital123' WHERE password IS NULL").run();
db.prepare("UPDATE blood_bank SET password = 'bank123' WHERE password IS NULL").run();

// Backfill a placeholder phone number for any pre-existing blood banks
db.prepare("UPDATE blood_bank SET phone = '9876500000' WHERE phone IS NULL OR phone = ''").run();

console.log('Database setup complete');
module.exports = db;