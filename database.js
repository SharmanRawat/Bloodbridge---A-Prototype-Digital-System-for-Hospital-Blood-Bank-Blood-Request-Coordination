const Database = require('better-sqlite3');
const db = new Database('bloodbridge.db');

db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS hospital (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address TEXT,
    lat REAL,
    lng REAL
  );

  CREATE TABLE IF NOT EXISTS blood_bank (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address TEXT,
    lat REAL,
    lng REAL
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
    status TEXT DEFAULT 'Pending' CHECK(status IN ('Pending','Acknowledged','Ready')),
    blood_bank_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (hospital_id) REFERENCES hospital(id),
    FOREIGN KEY (blood_bank_id) REFERENCES blood_bank(id)
  );
`);

// Only seed if no blood banks exist
const bankCount = db.prepare('SELECT COUNT(*) AS count FROM blood_bank').get();
if (bankCount.count === 0) {
  // Insert hospital
  db.prepare('INSERT INTO hospital (name, address, lat, lng) VALUES (?, ?, ?, ?)')
    .run('SVP Hospital Vasad', 'Vasad, Gujarat', 22.4500, 73.1200);

  // Insert blood banks
  const banks = [
    { name: 'Red Cross Vadodara', lat: 22.3072, lng: 73.1812 },
    { name: 'SSG Blood Bank Vadodara', lat: 22.3000, lng: 73.2000 },
    { name: 'GMERS Gotri', lat: 22.3200, lng: 73.1700 }
  ];

  const insertBank = db.prepare('INSERT INTO blood_bank (name, lat, lng) VALUES (?, ?, ?)');
  const insertInventory = db.prepare('INSERT INTO inventory (blood_bank_id, blood_group, units) VALUES (?, ?, ?)');

  const bloodGroups = ['A+', 'B+', 'O+', 'AB+'];

  for (const bank of banks) {
    const result = insertBank.run(bank.name, bank.lat, bank.lng);
    const bankId = result.lastInsertRowid;
    for (const bg of bloodGroups) {
      let units = Math.floor(Math.random() * 6);
      if (bg === 'B+' && bankId === 2) units = 3; // ensure B+ available
      insertInventory.run(bankId, bg, units);
    }
  }
}

console.log('Database setup complete');
module.exports = db;
