const express = require('express');
const { db, transaction } = require('../db');
const { BLOOD_GROUPS, COMPATIBLE_DONORS, HttpError, today, str } = require('../utils');

const router = express.Router();

const URGENCY_ORDER = `CASE urgency WHEN 'critical' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END`;

router.get('/', (req, res) => {
  const { status, blood_group } = req.query;
  const where = [];
  const params = [];
  if (status) { where.push('status = ?'); params.push(String(status)); }
  if (blood_group) { where.push('blood_group = ?'); params.push(String(blood_group)); }
  const rows = db
    .prepare(
      `SELECT r.*, u.full_name AS resolved_by_name FROM requests r
       LEFT JOIN users u ON u.id = r.resolved_by
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, ${URGENCY_ORDER}, r.requested_at DESC`
    )
    .all(...params);
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(Number(req.params.id));
  if (!request) throw new HttpError(404, 'Request not found');
  const issued = db
    .prepare(
      `SELECT i.*, dn.donation_date, dn.expiry_date FROM issues i
       JOIN donations dn ON dn.id = i.donation_id WHERE i.request_id = ?`
    )
    .all(request.id);
  res.json({ ...request, issued });
});

router.post('/', (req, res) => {
  const r = {
    patient_name: str(req.body.patient_name),
    hospital: str(req.body.hospital),
    contact: str(req.body.contact) || null,
    blood_group: str(req.body.blood_group),
    units: Number(req.body.units),
    urgency: str(req.body.urgency) || 'normal',
    notes: str(req.body.notes) || null,
  };
  if (r.patient_name.length < 2) throw new HttpError(400, 'Patient name is required');
  if (r.hospital.length < 2) throw new HttpError(400, 'Hospital is required');
  if (!BLOOD_GROUPS.includes(r.blood_group)) throw new HttpError(400, `Blood group must be one of ${BLOOD_GROUPS.join(', ')}`);
  if (!Number.isInteger(r.units) || r.units < 1 || r.units > 20) throw new HttpError(400, 'Units must be a whole number between 1 and 20');
  if (!['normal', 'urgent', 'critical'].includes(r.urgency)) throw new HttpError(400, 'Urgency must be normal, urgent or critical');

  const info = db
    .prepare('INSERT INTO requests (patient_name, hospital, contact, blood_group, units, urgency, notes) VALUES (?,?,?,?,?,?,?)')
    .run(r.patient_name, r.hospital, r.contact, r.blood_group, r.units, r.urgency, r.notes);
  res.status(201).json(db.prepare('SELECT * FROM requests WHERE id = ?').get(Number(info.lastInsertRowid)));
});

/**
 * Fulfil a request from stock. Uses earliest-expiry-first (FEFO) and, by default,
 * only the exact blood group. With allowCompatible=true, medically compatible groups
 * are used when the exact group runs short (exact group is always used first).
 */
router.post('/:id/fulfill', (req, res) => {
  const id = Number(req.params.id);
  const allowCompatible = req.body.allowCompatible === true;

  const result = transaction(() => {
    const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(id);
    if (!request) throw new HttpError(404, 'Request not found');
    if (request.status !== 'pending') throw new HttpError(409, `Request is already ${request.status}`);

    const groups = allowCompatible ? COMPATIBLE_DONORS[request.blood_group] : [request.blood_group];
    const t = today();
    const pickStmt = db.prepare(
      `SELECT id, units_remaining FROM donations
       WHERE blood_group = ? AND units_remaining > 0 AND expiry_date >= ?
       ORDER BY expiry_date ASC, id ASC`
    );

    let needed = request.units;
    const picks = []; // { donation_id, blood_group, units }
    for (const g of groups) {
      if (needed === 0) break;
      for (const bag of pickStmt.all(g, t)) {
        if (needed === 0) break;
        const take = Math.min(bag.units_remaining, needed);
        picks.push({ donation_id: bag.id, blood_group: g, units: take });
        needed -= take;
      }
    }

    if (needed > 0) {
      const available = request.units - needed;
      throw new HttpError(
        409,
        `Insufficient stock: ${request.units} unit(s) requested but only ${available} available` +
          (allowCompatible ? ' (including compatible groups).' : ` in ${request.blood_group}.`),
        { requested: request.units, available, allowCompatible }
      );
    }

    const dec = db.prepare('UPDATE donations SET units_remaining = units_remaining - ? WHERE id = ?');
    const ins = db.prepare('INSERT INTO issues (request_id, donation_id, blood_group, units) VALUES (?,?,?,?)');
    for (const p of picks) {
      dec.run(p.units, p.donation_id);
      ins.run(id, p.donation_id, p.blood_group, p.units);
    }
    db.prepare(`UPDATE requests SET status='fulfilled', resolved_at=datetime('now'), resolved_by=? WHERE id=?`).run(req.user.id, id);
    return picks;
  });

  res.json({ message: 'Request fulfilled', issued: result });
});

router.post('/:id/reject', (req, res) => {
  const id = Number(req.params.id);
  const reason = str(req.body.reason);
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(id);
  if (!request) throw new HttpError(404, 'Request not found');
  if (request.status !== 'pending') throw new HttpError(409, `Request is already ${request.status}`);
  const notes = reason ? `${request.notes ? request.notes + ' | ' : ''}Rejected: ${reason}` : request.notes;
  db.prepare(`UPDATE requests SET status='rejected', notes=?, resolved_at=datetime('now'), resolved_by=? WHERE id=?`).run(
    notes, req.user.id, id
  );
  res.json({ message: 'Request rejected' });
});

module.exports = router;
