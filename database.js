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
    status TEXT DEFAULT 'Pending' CHECK(status IN ('Pending','Acknowledged','Cancelled','InTransit','Delivered','Ready')),
    blood_bank_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    pickup_otp TEXT DEFAULT NULL,
    component TEXT DEFAULT 'PRBC',
    patient_name TEXT DEFAULT NULL,
    patient_age_sex TEXT DEFAULT NULL,
    ward TEXT DEFAULT NULL,
    reg_no TEXT DEFAULT NULL,
    doctor_name TEXT DEFAULT NULL,
    contact_no TEXT DEFAULT NULL,
    diagnosis TEXT DEFAULT NULL,
    specific_requirement TEXT DEFAULT NULL,
    tracker_lat REAL,
    tracker_lng REAL,
    tracker_updated DATETIME,
    FOREIGN KEY (hospital_id) REFERENCES hospital(id),
    FOREIGN KEY (blood_bank_id) REFERENCES blood_bank(id)
  );

  CREATE TABLE IF NOT EXISTS donors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    blood_group TEXT CHECK(blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
    phone TEXT,
    city TEXT,
    lat REAL,
    lng REAL,
    registered_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

// Migration for patient details fields
const patientFields = ['component', 'patient_name', 'patient_age_sex', 'ward', 'reg_no', 'doctor_name', 'contact_no', 'diagnosis', 'specific_requirement'];
for (const field of patientFields) {
  if (!requestColumns.some(col => col.name === field)) {
    db.exec(`ALTER TABLE request ADD COLUMN ${field} TEXT DEFAULT NULL`);
  }
}

// Migration for tracker columns
const trackerFields = ['tracker_lat', 'tracker_lng', 'tracker_updated'];
for (const field of trackerFields) {
  if (!requestColumns.some(col => col.name === field)) {
    const type = field === 'tracker_updated' ? 'DATETIME' : 'REAL';
    db.exec(`ALTER TABLE request ADD COLUMN ${field} ${type} DEFAULT NULL`);
  }
}

// Admin table + seed admin account
db.exec(`
  CREATE TABLE IF NOT EXISTS admin (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  );
  INSERT OR IGNORE INTO admin (username, password) VALUES ('admin', 'admin123');
`);

// Add flagged column to blood_bank if missing
const bbCols = db.prepare("PRAGMA table_info(blood_bank)").all();
if (!bbCols.some(col => col.name === 'flagged')) {
  db.exec('ALTER TABLE blood_bank ADD COLUMN flagged INTEGER DEFAULT 0');
}

// Migration for donors table: add columns if they don't exist
const donorColumns = db.prepare("PRAGMA table_info(donors)").all();
if (donorColumns.length > 0) { // only run if donors table exists (it will after creation)
  if (!donorColumns.some(col => col.name === 'phone')) {
    db.exec('ALTER TABLE donors ADD COLUMN phone TEXT');
  }
  if (!donorColumns.some(col => col.name === 'city')) {
    db.exec('ALTER TABLE donors ADD COLUMN city TEXT');
  }
  if (!donorColumns.some(col => col.name === 'lat')) {
    db.exec('ALTER TABLE donors ADD COLUMN lat REAL');
  }
  if (!donorColumns.some(col => col.name === 'lng')) {
    db.exec('ALTER TABLE donors ADD COLUMN lng REAL');
  }
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