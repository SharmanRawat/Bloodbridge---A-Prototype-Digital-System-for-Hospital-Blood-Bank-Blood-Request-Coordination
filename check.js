const db = require('./database');
const banks = db.prepare("SELECT * FROM blood_bank").all();
console.log("Blood Banks:", banks);
const inventory = db.prepare("SELECT * FROM inventory WHERE units > 0").all();
console.log("Stock > 0:", inventory);
