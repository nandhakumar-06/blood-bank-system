// Database layer: uses Node's built-in SQLite (node:sqlite), no native modules needed.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH =
  process.env.DB_PATH ||
  (process.env.VERCEL ? '/tmp/bloodbank.db' : path.join(__dirname, 'bloodbank.db'));const db = new DatabaseSync(DB_PATH);

if (!process.env.VERCEL) db.exec('PRAGMA journal_mode = WAL;');db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin','staff')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS donors (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT NOT NULL,
  dob                 TEXT NOT NULL,
  gender              TEXT NOT NULL CHECK (gender IN ('Male','Female','Other')),
  blood_group         TEXT NOT NULL CHECK (blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  phone               TEXT NOT NULL,
  email               TEXT,
  address             TEXT,
  last_donation_date  TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS donations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  donor_id        INTEGER NOT NULL REFERENCES donors(id) ON DELETE RESTRICT,
  blood_group     TEXT NOT NULL,
  units           INTEGER NOT NULL CHECK (units > 0),
  units_remaining INTEGER NOT NULL CHECK (units_remaining >= 0),
  hemoglobin      REAL,
  donation_date   TEXT NOT NULL,
  expiry_date     TEXT NOT NULL,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS requests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_name    TEXT NOT NULL,
  hospital        TEXT NOT NULL,
  contact         TEXT,
  blood_group     TEXT NOT NULL CHECK (blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  units           INTEGER NOT NULL CHECK (units > 0),
  urgency         TEXT NOT NULL DEFAULT 'normal' CHECK (urgency IN ('normal','urgent','critical')),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','fulfilled','rejected')),
  notes           TEXT,
  requested_at    TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at     TEXT,
  resolved_by     INTEGER REFERENCES users(id)
);

-- Which donation bags were used to fulfil which request (audit trail)
CREATE TABLE IF NOT EXISTS issues (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id   INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  donation_id  INTEGER NOT NULL REFERENCES donations(id),
  blood_group  TEXT NOT NULL,
  units        INTEGER NOT NULL,
  issued_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_donations_group  ON donations(blood_group);
CREATE INDEX IF NOT EXISTS idx_donations_expiry ON donations(expiry_date);
CREATE INDEX IF NOT EXISTS idx_requests_status  ON requests(status);
`);

/** Run fn inside a transaction; rolls back if it throws. */
function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { db, transaction };
