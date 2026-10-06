# Lifeline - Blood Bank Management System

A full-stack blood bank app: Node.js + Express REST API, SQLite database, and a single-page web frontend (no build step).

## Quick start

Requires **Node.js 22.13 or newer** (it uses Node's built-in SQLite, so there is no database to install).

```bash
npm install
npm start
```

Open http://localhost:3000. The first start creates `bloodbank.db` and fills it with demo data.

| Role  | Username | Password   |
|-------|----------|------------|
| Admin | `admin`  | `admin123` |
| Staff | `staff`  | `staff123` |

Change these passwords (sidebar -> Change password) before using real data.

## Features

- **Dashboard**: stock by blood group, pending/critical requests, low-stock and expiry alerts, 6-month donation chart.
- **Donors**: register, search, filter by group and eligibility, edit, view donation history.
- **Donations**: record units collected. Expiry is set automatically (42 days).
- **Blood stock**: per-group levels, every unit on the shelf sorted by expiry, one-click discard of expired units.
- **Requests**: hospitals' requests with normal / urgent / critical priority. Fulfil (issues stock) or reject.
- **Accounts**: admins create and delete staff accounts. Staff cannot delete records or manage accounts.

## Business rules (all enforced by the API)

- Donors must be 18-65 years old.
- 90 days must pass between a donor's donations; hemoglobin below 12.5 g/dL is deferred.
- Expired units never count as available stock.
- Fulfilling a request uses **earliest-expiry-first**, and is all-or-nothing: if stock is short, nothing is consumed.
- Optionally uses medically compatible groups (e.g. O- for A+) when the exact group runs short; exact matches are always used first.
- A donor's blood group is locked once they have donations; donors with donations cannot be deleted.

Thresholds (shelf life, gap between donations, low-stock level, etc.) are constants at the top of `utils.js`.

## Project layout

```
server.js            Express app + static file hosting
db.js                SQLite schema and transaction helper
seed.js              Demo data (runs only when the database is empty)
utils.js             Constants, date helpers, eligibility rules
middleware/auth.js   JWT auth and role checks
routes/              auth, donors, donations, inventory, requests, dashboard
public/              Frontend (index.html, css/style.css, js/app.js)
test/api.test.js     End-to-end API tests
```

## API overview

All endpoints except `POST /api/auth/login` need `Authorization: Bearer <token>`.

| Area | Endpoints |
|------|-----------|
| Auth | `POST /api/auth/login`, `GET /api/auth/me`, `PUT /api/auth/password`, `GET/POST/DELETE /api/auth/users` (admin) |
| Donors | `GET/POST /api/donors`, `GET/PUT/DELETE /api/donors/:id` |
| Donations | `GET/POST /api/donations`, `DELETE /api/donations/:id` (admin) |
| Stock | `GET /api/inventory`, `GET /api/inventory/units`, `POST /api/inventory/discard-expired` |
| Requests | `GET/POST /api/requests`, `GET /api/requests/:id`, `POST /api/requests/:id/fulfill`, `POST /api/requests/:id/reject` |
| Dashboard | `GET /api/dashboard` |

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | HTTP port |
| `JWT_SECRET` | insecure dev value | **Set this in production** |
| `DB_PATH` | `./bloodbank.db` | Database file location |
| `TOKEN_TTL` | `8h` | Login session length |

## Tests

```bash
npm test
```

Runs against a temporary database; your data is untouched.

## Before real-world use

This is a solid working system, but a real blood bank also needs HTTPS, a strong `JWT_SECRET`, regular database backups, and an audit/compliance review for your region (donor screening, cross-matching and traceability rules are regulated).
