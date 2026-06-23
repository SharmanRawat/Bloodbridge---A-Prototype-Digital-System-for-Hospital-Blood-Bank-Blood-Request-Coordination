# BloodBridge – Hospital-Blood Bank Coordination Prototype

A web prototype that digitises the emergency blood request workflow between a hospital and nearby blood banks. Built as part of the **GTU Societal Internship (Group 37)** at **SVPIT Vasad**.

## What problem does this solve?
Currently, hospital staff manually call multiple blood banks, find a match, fill a physical form, and send a patient’s relative with it. BloodBridge replaces that with a digital search → digital requisition → real‑time status tracking loop.

## Tech Stack (MUST follow these)
- **Backend:** Node.js + Express
- **Database:** SQLite (file `bloodbridge.db`) using `better-sqlite3`
- **Frontend:** Plain HTML, CSS, and vanilla JavaScript — **no frameworks or libraries** except Bootstrap 5 (CDN)
- **All API calls** use `fetch()` to relative paths (`/api/...`)

#Project Structure:- 
bloodbridge/
├── server.js # Main Express server
├── database.js # Database setup & seed data
├── routes/
│ ├── hospital.js # Hospital routes
│ ├── bloodbank.js # Blood bank routes
│ └── auth.js # (Coming soon)
├── public/
│ ├── index.html # Landing page
│ ├── hospital.html # Hospital dashboard
│ ├── hospital_status.html # Request status page
│ ├── bloodbank.html # Blood bank dashboard
│ ├── requisition.html # Printable slip
│ ├── login.html # (Coming soon)
│ ├── register.html # (Coming soon)
│ └── style.css # (To be created by UI team)
├── package.json
├── .gitignore
└── README.md

## How to Run (for everyone)
1. **Clone** the repo:
   ```bash
   git clone <repo-url>
   cd bloodbridge
Install dependencies (only the first time):

bash
npm install
Create the database & seed data:

bash
node database.js
Start the server:

bash
node server.js
Open in browser: http://localhost:3000

Already Working Features
✅ Hospital can search blood banks by blood group and see distances (Haversine formula)

✅ Hospital can send a digital requisition – stock is deducted

✅ Blood bank can view incoming requests and acknowledge them

✅ Blood bank can manually update inventory

✅ Hospital can track request status (Pending / Acknowledged) with auto‑refresh

✅ Printable requisition slip (open requisition.html?id=<id>)

API Endpoints (for reference)
Method	URL	Description
POST	/api/hospital/request	Search banks for a blood group
POST	/api/hospital/request/confirm	Create request & deduct inventory
GET	/api/hospital/requests/:hospitalId	List all requests for a hospital
GET	/api/hospital/request/:id	Get single request details
GET	/api/bloodbank/requests/:bankId	Get incoming requests for a bank
PUT	/api/bloodbank/request/:id/acknowledge	Acknowledge a request
GET	/api/bloodbank/inventory/:bankId	Get bank inventory
PUT	/api/bloodbank/inventory/:bankId	Update inventory (units)
Mandatory Rules for Frontend Developers
Use plain HTML/CSS/JS only. Do not add React, Vue, or any build tool.

Use the existing Bootstrap 5 CDN (already included in all .html files).

All API calls must be relative – e.g., fetch('/api/hospital/request').

After auth is ready, user ID and role will be stored in localStorage:

localStorage.getItem('userId')

localStorage.getItem('role')

Replace any hardcoded IDs (like hospitalId: 1) with these values.

Keep the existing HTML structure – just add your styles and logic.

Create a branch for your work (git checkout -b your-task) and push it to GitHub. Don't push directly to main until it's tested and reviewed.

Dummy Data (for testing)
Hospital: SVP Hospital Vasad (ID = 1)

Blood banks: Red Cross Vadodara (1), SSG Blood Bank (2), GMERS Gotri (3)

Inventory is randomly seeded each time you run node database.js. Run it again if you need fresh stock.

Upcoming Module: Authentication
One team member is adding login and registration pages. Once ready, you'll use localStorage to get the logged‑in user's ID and role. Until then, you can temporarily use hardcoded IDs for testing (e.g., hospitalId = 1).

Team
Swapnil Pandya (Team Leader)

[Your Name]

[Member 3]

[Member 4]

[Member 5]

License
This project is for educational purposes only.

text

---

### How to use this
- Delete your current `README.md` (if any) with `rm README.md`.
- Then create the new one:
  ```bash
  nano README.md
