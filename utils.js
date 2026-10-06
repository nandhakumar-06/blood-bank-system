// Shared constants and helpers

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

// For each recipient group: donor groups that can safely give, in order of preference
// (exact match first, then the most "specific" compatible groups, universal donor last).
const COMPATIBLE_DONORS = {
  'O-': ['O-'],
  'O+': ['O+', 'O-'],
  'A-': ['A-', 'O-'],
  'A+': ['A+', 'A-', 'O+', 'O-'],
  'B-': ['B-', 'O-'],
  'B+': ['B+', 'B-', 'O+', 'O-'],
  'AB-': ['AB-', 'A-', 'B-', 'O-'],
  'AB+': ['AB+', 'AB-', 'A+', 'A-', 'B+', 'B-', 'O+', 'O-'],
};

const SHELF_LIFE_DAYS = 42;            // whole blood / red cells
const MIN_DAYS_BETWEEN_DONATIONS = 90; // donor deferral period
const MIN_DONOR_AGE = 18;
const MAX_DONOR_AGE = 65;
const MIN_HEMOGLOBIN = 12.5;           // g/dL
const LOW_STOCK_THRESHOLD = 3;         // units per group
const EXPIRING_SOON_DAYS = 7;

const pad = (n) => String(n).padStart(2, '0');

function toISODate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function today() {
  return toISODate(new Date());
}

function parseDate(str) {
  // Parse YYYY-MM-DD as a local date (avoids timezone shifts)
  const [y, m, d] = String(str).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function isValidDate(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = parseDate(str);
  return !isNaN(d) && toISODate(d) === str;
}

function addDays(str, n) {
  const d = parseDate(str);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

function daysBetween(fromStr, toStr) {
  return Math.round((parseDate(toStr) - parseDate(fromStr)) / 86400000);
}

function ageOn(dob, onDate = today()) {
  const b = parseDate(dob);
  const t = parseDate(onDate);
  let age = t.getFullYear() - b.getFullYear();
  if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) age--;
  return age;
}

/** Returns { eligible, reasons[], nextEligibleDate } for a donor row on a given date. */
function donorEligibility(donor, onDate = today()) {
  const reasons = [];
  const age = ageOn(donor.dob, onDate);
  if (age < MIN_DONOR_AGE) reasons.push(`Donor must be at least ${MIN_DONOR_AGE} years old (currently ${age}).`);
  if (age > MAX_DONOR_AGE) reasons.push(`Donor must be at most ${MAX_DONOR_AGE} years old (currently ${age}).`);

  let nextEligibleDate = null;
  if (donor.last_donation_date) {
    nextEligibleDate = addDays(donor.last_donation_date, MIN_DAYS_BETWEEN_DONATIONS);
    if (nextEligibleDate > onDate) {
      reasons.push(`Last donation was on ${donor.last_donation_date}; next eligible on ${nextEligibleDate}.`);
    }
  }
  return { eligible: reasons.length === 0, reasons, nextEligibleDate, age };
}

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** Trim a string field; returns '' for non-strings. */
const str = (v) => (typeof v === 'string' ? v.trim() : '');

module.exports = {
  BLOOD_GROUPS,
  COMPATIBLE_DONORS,
  SHELF_LIFE_DAYS,
  MIN_DAYS_BETWEEN_DONATIONS,
  MIN_HEMOGLOBIN,
  LOW_STOCK_THRESHOLD,
  EXPIRING_SOON_DAYS,
  today,
  addDays,
  daysBetween,
  isValidDate,
  ageOn,
  donorEligibility,
  HttpError,
  str,
};
