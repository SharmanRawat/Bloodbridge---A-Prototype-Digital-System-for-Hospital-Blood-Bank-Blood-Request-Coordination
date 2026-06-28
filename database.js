const Database = require('better-sqlite3');
const db = new Database('bloodbridge.db');

db.exec('PRAGMA foreign_keys = ON');

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
    status TEXT DEFAULT 'Pending' CHECK(status IN ('Pending','Acknowledged','Cancelled','InTransit','Delivered','Ready','OutForDelivery')),
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
    patient_ref TEXT,
    registered_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS admin (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  );
`);

// Migrations
const bankColumns = db.prepare("PRAGMA table_info(blood_bank)").all();
if (!bankColumns.some(col => col.name === 'phone')) {
  db.exec('ALTER TABLE blood_bank ADD COLUMN phone TEXT');
}
if (!bankColumns.some(col => col.name === 'flagged')) {
  db.exec('ALTER TABLE blood_bank ADD COLUMN flagged INTEGER DEFAULT 0');
}

const requestColumns = db.prepare("PRAGMA table_info(request)").all();
if (!requestColumns.some(col => col.name === 'pickup_otp')) {
  db.exec('ALTER TABLE request ADD COLUMN pickup_otp TEXT DEFAULT NULL');
}
const patientFields = ['component','patient_name','patient_age_sex','ward','reg_no','doctor_name','contact_no','diagnosis','specific_requirement'];
for (const field of patientFields) {
  if (!requestColumns.some(col => col.name === field)) {
    db.exec(`ALTER TABLE request ADD COLUMN ${field} TEXT DEFAULT NULL`);
  }
}
const trackerFields = ['tracker_lat','tracker_lng','tracker_updated'];
for (const field of trackerFields) {
  if (!requestColumns.some(col => col.name === field)) {
    const type = field === 'tracker_updated' ? 'DATETIME' : 'REAL';
    db.exec(`ALTER TABLE request ADD COLUMN ${field} ${type} DEFAULT NULL`);
  }
}

// Seed real hospitals and blood banks if none exist
const bankCount = db.prepare('SELECT COUNT(*) AS count FROM blood_bank').get();
if (bankCount.count === 0) {
  db.prepare('INSERT INTO hospital (name, address, lat, lng, password) VALUES (?,?,?,?,?)')
    .run('Aashray Hospital', 'Vadodara, Gujarat', 22.323281525618334, 73.13511963833432, 'hospital123');
  db.prepare('INSERT INTO hospital (name, address, lat, lng, password) VALUES (?,?,?,?,?)')
    .run('Bhailal Amin Hospital', 'Vadodara, Gujarat', 22.32578593329923, 73.16325679999954, 'hospital123');

  const banks = [
    { name: 'Red Cross Blood Centre', lat: 22.311375797419654, lng: 73.17930905385647, phone: '9876500001' },
    { name: 'Dhwani Blood Centre', lat: 22.306452605739377, lng: 73.18505970995074, phone: '9876500002' },
    { name: 'Ayush Blood Centre', lat: 22.308120157844115, lng: 73.17527501152172, phone: '9876500003' },
    { name: 'Indu Blood Bank', lat: 22.30414070835396, lng: 73.19348965485375, phone: '9876500004' },
    { name: 'Lions Club Of Baroda Blood Centre', lat: 22.31073752476958, lng: 73.15660991778404, phone: '9876500005' }
  ];
  const insertBank = db.prepare('INSERT INTO blood_bank (name, address, lat, lng, password, phone) VALUES (?,?,?,?,?,?)');
  const insertInventory = db.prepare('INSERT INTO inventory (blood_bank_id, blood_group, units) VALUES (?,?,?)');
  const bloodGroups = ['A+','B+','O+','AB+'];

  for (const bank of banks) {
    const result = insertBank.run(bank.name, 'Vadodara, Gujarat', bank.lat, bank.lng, 'bank123', bank.phone);
    const bankId = result.lastInsertRowid;
    for (const bg of bloodGroups) {
      const units = Math.floor(Math.random() * 5) + 2;
      insertInventory.run(bankId, bg, units);
    }
  }

  db.exec(`INSERT OR IGNORE INTO admin (username, password) VALUES ('admin', 'admin123');`);
}

db.prepare("UPDATE hospital SET password = 'hospital123' WHERE password IS NULL").run();
db.prepare("UPDATE blood_bank SET password = 'bank123' WHERE password IS NULL").run();
db.prepare("UPDATE blood_bank SET phone = '9876500000' WHERE phone IS NULL OR phone = ''").run();

console.log('Database setup complete');
module.exports = db;