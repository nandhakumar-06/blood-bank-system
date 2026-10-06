// End-to-end API tests using Node's built-in test runner. Run: npm test
// Uses a throwaway database so your real data is never touched.
process.env.DB_PATH = require('path').join(require('os').tmpdir(), `bloodbank-test-${process.pid}.db`);
process.env.JWT_SECRET = 'test-secret';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const app = require('../server');
const { seedIfEmpty } = require('../seed');
const { today, addDays } = require('../utils');

let server, base, admin, staff;

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* none */ }
  return { status: res.status, data };
}

before(async () => {
  seedIfEmpty();
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  admin = (await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin123' } })).data.token;
  staff = (await call('POST', '/api/auth/login', { body: { username: 'staff', password: 'staff123' } })).data.token;
});

after(() => {
  server.close();
  for (const f of ['', '-wal', '-shm']) fs.rmSync(process.env.DB_PATH + f, { force: true });
});

test('API requires authentication', async () => {
  assert.equal((await call('GET', '/api/donors')).status, 401);
  assert.equal((await call('GET', '/api/donors', { token: 'garbage' })).status, 401);
});

test('login rejects bad credentials', async () => {
  const r = await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'nope' } });
  assert.equal(r.status, 401);
});

test('staff cannot manage users, admin can', async () => {
  assert.equal((await call('GET', '/api/auth/users', { token: staff })).status, 403);
  assert.equal((await call('GET', '/api/auth/users', { token: admin })).status, 200);
});

test('donor validation: underage, bad group, duplicates', async () => {
  const good = { name: 'Test Donor', dob: '1995-05-05', gender: 'Male', blood_group: 'A+', phone: '9000000001' };
  const young = await call('POST', '/api/donors', { token: staff, body: { ...good, dob: addDays(today(), -365 * 16) } });
  assert.equal(young.status, 400);
  const bad = await call('POST', '/api/donors', { token: staff, body: { ...good, blood_group: 'Z+' } });
  assert.equal(bad.status, 400);
  const ok = await call('POST', '/api/donors', { token: staff, body: good });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.eligible, true);
  const dup = await call('POST', '/api/donors', { token: staff, body: good });
  assert.equal(dup.status, 409);
});

test('donation: updates donor, sets 42-day expiry, enforces 90-day gap and hemoglobin', async () => {
  const donor = (await call('POST', '/api/donors', {
    token: staff, body: { name: 'Gap Tester', dob: '1990-01-01', gender: 'Female', blood_group: 'B-', phone: '9000000002' },
  })).data;

  const low = await call('POST', '/api/donations', { token: staff, body: { donor_id: donor.id, units: 1, hemoglobin: 10 } });
  assert.equal(low.status, 422);

  const first = await call('POST', '/api/donations', { token: staff, body: { donor_id: donor.id, units: 1, hemoglobin: 13.5 } });
  assert.equal(first.status, 201);
  assert.equal(first.data.blood_group, 'B-');
  assert.equal(first.data.expiry_date, addDays(today(), 42));

  const again = await call('POST', '/api/donations', { token: staff, body: { donor_id: donor.id, units: 1 } });
  assert.equal(again.status, 422);

  const future = await call('POST', '/api/donations', { token: staff, body: { donor_id: donor.id, donation_date: addDays(today(), 3) } });
  assert.equal(future.status, 400);

  const d = (await call('GET', `/api/donors/${donor.id}`, { token: staff })).data;
  assert.equal(d.eligible, false);
  assert.equal(d.last_donation_date, today());
});

test('inventory excludes expired units from available stock', async () => {
  const inv = (await call('GET', '/api/inventory', { token: staff })).data;
  const o = inv.groups.find((g) => g.blood_group === 'O+');
  // Seed: O+ has 2 + 3 + 4 = 9 valid units and 2 expired units
  assert.equal(o.available, 9);
  assert.equal(o.expired, 2);
});

test('fulfil request: FEFO, stock decrements, cannot fulfil twice', async () => {
  const before = (await call('GET', '/api/inventory', { token: staff })).data.groups.find((g) => g.blood_group === 'A+').available;
  const req = (await call('POST', '/api/requests', {
    token: staff, body: { patient_name: 'P One', hospital: 'City Hospital', blood_group: 'A+', units: 2, urgency: 'urgent' },
  })).data;

  const ok = await call('POST', `/api/requests/${req.id}/fulfill`, { token: staff, body: {} });
  assert.equal(ok.status, 200);
  // Seed A+ bags: donor 2 (collected 12 days ago, 1u) and donor 10 (40 days ago, 2u, expires first).
  assert.equal(ok.data.issued[0].units, 2, 'earliest-expiry bag (2 units) is used first');

  const after = (await call('GET', '/api/inventory', { token: staff })).data.groups.find((g) => g.blood_group === 'A+').available;
  assert.equal(after, before - 2);

  const twice = await call('POST', `/api/requests/${req.id}/fulfill`, { token: staff, body: {} });
  assert.equal(twice.status, 409);
});

test('fulfil request: insufficient stock changes nothing; compatible groups only when allowed', async () => {
  // AB- has 1 unit. Ask for 3.
  const req = (await call('POST', '/api/requests', {
    token: staff, body: { patient_name: 'P Two', hospital: 'City Hospital', blood_group: 'AB-', units: 3, urgency: 'critical' },
  })).data;
  const stockBefore = (await call('GET', '/api/inventory', { token: staff })).data.total_available;

  const short = await call('POST', `/api/requests/${req.id}/fulfill`, { token: staff, body: {} });
  assert.equal(short.status, 409);
  assert.equal(short.data.available, 1);
  assert.equal((await call('GET', '/api/inventory', { token: staff })).data.total_available, stockBefore, 'failed fulfil must not consume stock');
  assert.equal((await call('GET', `/api/requests/${req.id}`, { token: staff })).data.status, 'pending');

  const compat = await call('POST', `/api/requests/${req.id}/fulfill`, { token: staff, body: { allowCompatible: true } });
  assert.equal(compat.status, 200);
  const groups = compat.data.issued.map((i) => i.blood_group);
  assert.equal(groups[0], 'AB-', 'exact group is used first');
  assert.equal(compat.data.issued.reduce((s, i) => s + i.units, 0), 3);
});

test('reject request and discard expired units', async () => {
  const req = (await call('POST', '/api/requests', {
    token: staff, body: { patient_name: 'P Three', hospital: 'X Hospital', blood_group: 'O-', units: 1 },
  })).data;
  assert.equal((await call('POST', `/api/requests/${req.id}/reject`, { token: staff, body: { reason: 'duplicate' } })).status, 200);
  assert.equal((await call('POST', `/api/requests/${req.id}/fulfill`, { token: staff, body: {} })).status, 409);

  const r = await call('POST', '/api/inventory/discard-expired', { token: staff });
  assert.equal(r.data.discarded, 2);
  const inv = (await call('GET', '/api/inventory', { token: staff })).data;
  assert.equal(inv.groups.reduce((s, g) => s + g.expired, 0), 0);
});

test('only admins can delete donors; donors with donations are protected', async () => {
  const donors = (await call('GET', '/api/donors', { token: staff })).data;
  const withDonations = donors.find((d) => d.donation_count > 0);
  assert.equal((await call('DELETE', `/api/donors/${withDonations.id}`, { token: staff })).status, 403);
  assert.equal((await call('DELETE', `/api/donors/${withDonations.id}`, { token: admin })).status, 409);
});

test('dashboard returns totals', async () => {
  const d = (await call('GET', '/api/dashboard', { token: staff })).data;
  assert.ok(d.totals.donors >= 12);
  assert.equal(d.stock.length, 8);
  assert.equal(d.monthly.length, 6);
});
