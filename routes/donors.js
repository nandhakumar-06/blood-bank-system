const express = require('express');
const { db } = require('../db');
const { requireRole } = require('../middleware/auth');
const { BLOOD_GROUPS, HttpError, isValidDate, today, ageOn, donorEligibility, str } = require('../utils');

const router = express.Router();

function validateDonor(body) {
  const d = {
    name: str(body.name),
    dob: str(body.dob),
    gender: str(body.gender),
    blood_group: str(body.blood_group),
    phone: str(body.phone),
    email: str(body.email) || null,
    address: str(body.address) || null,
  };
  if (d.name.length < 2) throw new HttpError(400, 'Name is required (min 2 characters)');
  if (!isValidDate(d.dob) || d.dob > today()) throw new HttpError(400, 'A valid date of birth (YYYY-MM-DD, not in the future) is required');
  if (!['Male', 'Female', 'Other'].includes(d.gender)) throw new HttpError(400, 'Gender must be Male, Female or Other');
  if (!BLOOD_GROUPS.includes(d.blood_group)) throw new HttpError(400, `Blood group must be one of ${BLOOD_GROUPS.join(', ')}`);
  if (!/^[0-9+\-\s()]{7,15}$/.test(d.phone)) throw new HttpError(400, 'A valid phone number is required');
  if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) throw new HttpError(400, 'Email address is not valid');
  return d;
}

function withEligibility(donor) {
  const e = donorEligibility(donor);
  return { ...donor, age: e.age, eligible: e.eligible, next_eligible_date: e.nextEligibleDate, ineligible_reasons: e.reasons };
}

router.get('/', (req, res) => {
  const { q, blood_group, eligible } = req.query;
  const where = [];
  const params = [];
  if (q) {
    where.push('(name LIKE ? OR phone LIKE ? OR email LIKE ?)');
    const like = `%${String(q).trim()}%`;
    params.push(like, like, like);
  }
  if (blood_group) {
    where.push('blood_group = ?');
    params.push(String(blood_group));
  }
  const sql = `SELECT d.*, (SELECT COUNT(*) FROM donations WHERE donor_id = d.id) AS donation_count
               FROM donors d ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY d.name`;
  let rows = db.prepare(sql).all(...params).map(withEligibility);
  if (eligible === 'true') rows = rows.filter((r) => r.eligible);
  if (eligible === 'false') rows = rows.filter((r) => !r.eligible);
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const donor = db.prepare('SELECT * FROM donors WHERE id = ?').get(Number(req.params.id));
  if (!donor) throw new HttpError(404, 'Donor not found');
  const history = db
    .prepare('SELECT * FROM donations WHERE donor_id = ? ORDER BY donation_date DESC, id DESC')
    .all(donor.id);
  res.json({ ...withEligibility(donor), donations: history });
});

router.post('/', (req, res) => {
  const d = validateDonor(req.body);
  const age = ageOn(d.dob);
  if (age < 18 || age > 65) throw new HttpError(400, `Donors must be between 18 and 65 years old (this donor is ${age})`);
  const dup = db.prepare('SELECT id FROM donors WHERE phone = ? AND name = ? COLLATE NOCASE').get(d.phone, d.name);
  if (dup) throw new HttpError(409, 'A donor with the same name and phone number already exists');
  const info = db
    .prepare('INSERT INTO donors (name, dob, gender, blood_group, phone, email, address) VALUES (?,?,?,?,?,?,?)')
    .run(d.name, d.dob, d.gender, d.blood_group, d.phone, d.email, d.address);
  const donor = db.prepare('SELECT * FROM donors WHERE id = ?').get(Number(info.lastInsertRowid));
  res.status(201).json(withEligibility(donor));
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM donors WHERE id = ?').get(id);
  if (!existing) throw new HttpError(404, 'Donor not found');
  const d = validateDonor({ ...existing, ...req.body });
  if (d.blood_group !== existing.blood_group) {
    const has = db.prepare('SELECT 1 FROM donations WHERE donor_id = ?').get(id);
    if (has) throw new HttpError(409, 'Blood group cannot be changed once the donor has recorded donations');
  }
  db.prepare(
    'UPDATE donors SET name=?, dob=?, gender=?, blood_group=?, phone=?, email=?, address=? WHERE id=?'
  ).run(d.name, d.dob, d.gender, d.blood_group, d.phone, d.email, d.address, id);
  res.json(withEligibility(db.prepare('SELECT * FROM donors WHERE id = ?').get(id)));
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM donors WHERE id = ?').get(id)) throw new HttpError(404, 'Donor not found');
  if (db.prepare('SELECT 1 FROM donations WHERE donor_id = ?').get(id)) {
    throw new HttpError(409, 'Donor has donation records and cannot be deleted');
  }
  db.prepare('DELETE FROM donors WHERE id = ?').run(id);
  res.json({ message: 'Donor deleted' });
});

module.exports = router;
