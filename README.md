# BloodBridge – Hospital-Blood Bank Coordination Prototype

A web prototype that digitises the emergency blood request workflow between a hospital and nearby blood banks. Built as part of the **GTU Societal Internship (Group 37)** at **SVPIT Vasad**.

## What problem does this solve?
Currently, hospital staff manually call multiple blood banks, find a match, fill a physical form, and send a patient’s relative with it. BloodBridge replaces that with a digital search → digital requisition → real‑time status tracking loop.

## Tech Stack
- **Backend:** Node.js + Express
- **Database:** PostgreSQL
- **Frontend:** Plain HTML, CSS, and vanilla JavaScript — no frameworks or libraries except Bootstrap 5 (CDN)
- **All API calls** use `fetch()` to relative paths (`/api/...`)

## Project Structure
```
├── server.js                # Main Express server
├── db.js                    # PostgreSQL DB config, schema & seed data
├── middleware/
│   └── auth.js
├── routes/
│   ├── admin.js
│   ├── auth.js
│   ├── bloodbank.js
│   └── donors.js
├── public/
│   ├── index.html
│   ├── hospital.html
│   ├── hospital_status.html
│   ├── bloodbank.html
│   ├── requisition.html
│   ├── login.html
│   ├── register.html
│   ├── admin.html
│   ├── admin-login.html
│   ├── delivery.html
│   ├── donor-register.html
│   ├── track-delivery.html
│   └── style.css
├── package.json
└── README.md
```

## Environment Variables
Set the following environment variables before starting the app:
- `DATABASE_URL` - PostgreSQL connection string (e.g., from Neon, Render Postgres, or Supabase). On Render/Supabase use the **connection pooler** string (IPv4).
- `AUTH_SECRET` - a long random string used to sign login sessions. **Set this in production**; if it is missing the app still runs but every restart/redeploy logs users out.
- `PORT` - optional, defaults to `3000`.

Generate a secret with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## How to Run Locally
1. **Clone** the repo:
   ```bash
   git clone <repo-url>
   cd Bloodbridge---A-Prototype-Digital-System-for-Hospital-Blood-Bank-Blood-Request-Coordination
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up environment variables**:
   Create a `.env` file in the root directory with:
   ```env
   DATABASE_URL=postgresql://user:password@host:port/database
   AUTH_SECRET=replace-with-a-long-random-string
   PORT=3000
   ```

4. **Start the server**:
   ```bash
   npm start
   ```

5. **Open in browser**: http://localhost:3000

## API Endpoints (for reference)

**Hospital**
- `POST /api/hospital/request` – Search banks for a blood group
- `POST /api/hospital/request/confirm` – Create request & deduct inventory
- `GET /api/hospital/requests/:hospitalId` – List all requests for a hospital
- `GET /api/hospital/request/:id` – Get single request details

**Blood Bank**
- `GET /api/bloodbank/requests/:bankId` – Get incoming requests
- `PUT /api/bloodbank/request/:id/acknowledge` – Acknowledge a request
- `POST /api/bloodbank/request/:id/verify-pickup` – Verify OTP
- `GET /api/bloodbank/inventory/:bankId` – Get bank inventory
- `PUT /api/bloodbank/inventory/:bankId` – Update inventory

## Notes
- The app automatically creates tables and seeds initial data on first run
- Default credentials are for testing only (not suitable for production)
- Deployments on Render need `DATABASE_URL` set in the service environment variables

## License
This project is for educational purposes only.