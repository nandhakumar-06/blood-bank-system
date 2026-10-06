const express = require('express');
const { db, transaction } = require('../db');
const {
  BLOOD_GROUPS, LOW_STOCK_THRESHOLD, EXPIRING_SOON_DAYS, today, addDays, daysBetween,
} = require('../utils');

const router = express.Router();

/** Stock summary for every blood group. */
router.get('/', (_req, res) => {
  const t = today();
  const soon = addDays(t, EXPIRING_SOON_DAYS);
  const rows = db
    .prepare(
      `SELECT blood_group,
              SUM(CASE WHEN expiry_date >= ? THEN units_remaining ELSE 0 END) AS available,
              SUM(CASE WHEN expiry_date >= ? AND expiry_date <= ? THEN units_remaining ELSE 0 END) AS expiring_soon,
              SUM(CASE WHEN expiry_date < ? THEN units_remaining ELSE 0 END) AS expired
       FROM donations WHERE units_remaining > 0 GROUP BY blood_group`
    )
    .all(t, t, soon, t);
  const byGroup = Object.fromEntries(rows.map((r) => [r.blood_group, r]));

  const summary = BLOOD_GROUPS.map((g) => {
    const r = byGroup[g] || {};
    const available = r.available || 0;
    return {
      blood_group: g,
      available,
      expiring_soon: r.expiring_soon || 0,
      expired: r.expired || 0,
      level: available === 0 ? 'empty' : available < LOW_STOCK_THRESHOLD ? 'low' : 'ok',
    };
  });
  res.json({
    as_of: t,
    low_stock_threshold: LOW_STOCK_THRESHOLD,
    expiring_soon_days: EXPIRING_SOON_DAYS,
    total_available: summary.reduce((s, r) => s + r.available, 0),
    groups: summary,
  });
});

/** Individual units (bags) currently in stock, soonest-expiring first. */
router.get('/units', (req, res) => {
  const t = today();
  const params = [t];
  let extra = '';
  if (req.query.blood_group) {
    extra = 'AND dn.blood_group = ?';
    params.push(String(req.query.blood_group));
  }
  const rows = db
    .prepare(
      `SELECT dn.id, dn.blood_group, dn.units_remaining, dn.donation_date, dn.expiry_date, d.name AS donor_name
       FROM donations dn JOIN donors d ON d.id = dn.donor_id
       WHERE dn.units_remaining > 0 AND dn.expiry_date >= ? ${extra}
       ORDER BY dn.expiry_date ASC, dn.id ASC`
    )
    .all(...params)
    .map((r) => ({ ...r, days_to_expiry: daysBetween(t, r.expiry_date) }));
  res.json(rows);
});

/** Write off all expired units. */
router.post('/discard-expired', (_req, res) => {
  const t = today();
  const discarded = transaction(() => {
    const { n } = db
      .prepare('SELECT COALESCE(SUM(units_remaining),0) AS n FROM donations WHERE units_remaining > 0 AND expiry_date < ?')
      .get(t);
    db.prepare(
      `UPDATE donations
         SET notes = TRIM(COALESCE(notes,'') || ' [Discarded ' || units_remaining || ' expired unit(s) on ' || ? || ']'),
             units_remaining = 0
       WHERE units_remaining > 0 AND expiry_date < ?`
    ).run(t, t);
    return n;
  });
  res.json({ message: `Discarded ${discarded} expired unit(s)`, discarded });
});

module.exports = router;
