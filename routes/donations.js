const express = require('express');
const { db, transaction } = require('../db');
const { requireRole } = require('../middleware/auth');
const {
  HttpError, isValidDate, today, addDays, donorEligibility, SHELF_LIFE_DAYS, MIN_HEMOGLOBIN, str,
} = require('../utils');

const router = express.Router();

router.get('/', (req, res) => {
  const { donor_id, blood_group, status } = req.query;
  const where = [];
  const params = [];
  if (donor_id) { where.push('dn.donor_id = ?'); params.push(Number(donor_id)); }
  if (blood_group) { where.push('dn.blood_group = ?'); params.push(String(blood_group)); }
  const t = today();
  if (status === 'available') { where.push('dn.units_remaining > 0 AND dn.expiry_date >= ?'); params.push(t); }
  if (status === 'expired') { where.push('dn.units_remaining > 0 AND dn.expiry_date < ?'); params.push(t); }
  if (status === 'used') { where.push('dn.units_remaining = 0'); }

  const rows = db
    .prepare(
      `SELECT dn.*, d.name AS donor_name FROM donations dn
       JOIN donors d ON d.id = dn.donor_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY dn.donation_date DESC, dn.id DESC`
    )
    .all(...params)
    .map((r) => ({
      ...r,
      status: r.units_remaining === 0 ? 'used' : r.expiry_date < t ? 'expired' : 'available',
    }));
  res.json(rows);
});

router.post('/', (req, res) => {
  const donor_id = Number(req.body.donor_id);
  const units = Number(req.body.units ?? 1);
  const donation_date = str(req.body.donation_date) || today();
  const hemoglobin = req.body.hemoglobin === '' || req.body.hemoglobin == null ? null : Number(req.body.hemoglobin);
  const notes = str(req.body.notes) || null;

  const donor = db.prepare('SELECT * FROM donors WHERE id = ?').get(donor_id);
  if (!donor) throw new HttpError(404, 'Donor not found');
  if (!Number.isInteger(units) || units < 1 || units > 2) throw new HttpError(400, 'Units must be 1 or 2');
  if (!isValidDate(donation_date) || donation_date > today()) throw new HttpError(400, 'Donation date must be a valid date that is not in the future');
  if (hemoglobin !== null && (Number.isNaN(hemoglobin) || hemoglobin < 5 || hemoglobin > 25)) {
    throw new HttpError(400, 'Hemoglobin must be a number between 5 and 25 g/dL');
  }
  if (hemoglobin !== null && hemoglobin < MIN_HEMOGLOBIN) {
    throw new HttpError(422, `Hemoglobin ${hemoglobin} g/dL is below the minimum of ${MIN_HEMOGLOBIN} g/dL; donor is deferred`);
  }

  const elig = donorEligibility(donor, donation_date);
  if (!elig.eligible) throw new HttpError(422, 'Donor is not eligible to donate', { reasons: elig.reasons });

  const result = transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO donations (donor_id, blood_group, units, units_remaining, hemoglobin, donation_date, expiry_date, notes)
         VALUES (?,?,?,?,?,?,?,?)`
      )
      .run(donor.id, donor.blood_group, units, units, hemoglobin, donation_date, addDays(donation_date, SHELF_LIFE_DAYS), notes);
    db.prepare('UPDATE donors SET last_donation_date = ? WHERE id = ?').run(donation_date, donor.id);
    return Number(info.lastInsertRowid);
  });

  res.status(201).json(db.prepare('SELECT * FROM donations WHERE id = ?').get(result));
});

// Remove a donation record that was entered by mistake (only if no units have been issued)
router.delete('/:id', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  const dn = db.prepare('SELECT * FROM donations WHERE id = ?').get(id);
  if (!dn) throw new HttpError(404, 'Donation not found');
  if (dn.units_remaining !== dn.units) throw new HttpError(409, 'Units from this donation have already been issued or discarded');

  transaction(() => {
    db.prepare('DELETE FROM donations WHERE id = ?').run(id);
    const last = db.prepare('SELECT MAX(donation_date) AS d FROM donations WHERE donor_id = ?').get(dn.donor_id);
    db.prepare('UPDATE donors SET last_donation_date = ? WHERE id = ?').run(last.d || null, dn.donor_id);
  });
  res.json({ message: 'Donation deleted' });
});

module.exports = router;
