const express = require('express');
const { db } = require('../db');
const { LOW_STOCK_THRESHOLD, EXPIRING_SOON_DAYS, BLOOD_GROUPS, today, addDays } = require('../utils');

const router = express.Router();

router.get('/', (_req, res) => {
  const t = today();
  const soon = addDays(t, EXPIRING_SOON_DAYS);

  const count = (sql, ...p) => Object.values(db.prepare(sql).get(...p))[0] || 0;

  const totalDonors = count('SELECT COUNT(*) FROM donors');
  const totalDonations = count('SELECT COUNT(*) FROM donations');
  const unitsInStock = count('SELECT COALESCE(SUM(units_remaining),0) FROM donations WHERE expiry_date >= ?', t);
  const expiringSoon = count(
    'SELECT COALESCE(SUM(units_remaining),0) FROM donations WHERE units_remaining > 0 AND expiry_date >= ? AND expiry_date <= ?',
    t, soon
  );
  const expiredUnits = count('SELECT COALESCE(SUM(units_remaining),0) FROM donations WHERE expiry_date < ?', t);
  const pendingRequests = count(`SELECT COUNT(*) FROM requests WHERE status = 'pending'`);
  const criticalPending = count(`SELECT COUNT(*) FROM requests WHERE status = 'pending' AND urgency = 'critical'`);
  const fulfilledRequests = count(`SELECT COUNT(*) FROM requests WHERE status = 'fulfilled'`);

  const stockRows = db
    .prepare('SELECT blood_group, SUM(units_remaining) AS units FROM donations WHERE expiry_date >= ? GROUP BY blood_group')
    .all(t);
  const stockMap = Object.fromEntries(stockRows.map((r) => [r.blood_group, r.units]));
  const stock = BLOOD_GROUPS.map((g) => ({ blood_group: g, units: stockMap[g] || 0 }));
  const lowStock = stock.filter((s) => s.units < LOW_STOCK_THRESHOLD).map((s) => s.blood_group);

  // Donations (units) per month for the last 6 months
  const monthly = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const units = count(
      `SELECT COALESCE(SUM(units),0) FROM donations WHERE substr(donation_date,1,7) = ?`, key
    );
    monthly.push({ month: key, label: d.toLocaleString('en', { month: 'short' }), units });
  }

  const recentDonations = db
    .prepare(
      `SELECT dn.id, dn.blood_group, dn.units, dn.donation_date, d.name AS donor_name
       FROM donations dn JOIN donors d ON d.id = dn.donor_id ORDER BY dn.donation_date DESC, dn.id DESC LIMIT 5`
    )
    .all();
  const pendingList = db
    .prepare(
      `SELECT id, patient_name, hospital, blood_group, units, urgency, requested_at FROM requests
       WHERE status = 'pending'
       ORDER BY CASE urgency WHEN 'critical' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END, requested_at LIMIT 5`
    )
    .all();

  res.json({
    totals: {
      donors: totalDonors,
      donations: totalDonations,
      units_in_stock: unitsInStock,
      expiring_soon: expiringSoon,
      expired_units: expiredUnits,
      pending_requests: pendingRequests,
      critical_pending: criticalPending,
      fulfilled_requests: fulfilledRequests,
    },
    low_stock_threshold: LOW_STOCK_THRESHOLD,
    low_stock: lowStock,
    stock,
    monthly,
    recent_donations: recentDonations,
    pending_requests: pendingList,
  });
});

module.exports = router;
