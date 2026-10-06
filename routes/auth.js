const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { signToken, requireAuth, requireRole } = require('../middleware/auth');
const { HttpError, str } = require('../utils');

const router = express.Router();

// --- Tiny in-memory login throttle: 10 failed attempts / 15 min / IP ---
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function throttled(ip) {
  const rec = attempts.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > WINDOW_MS) {
    attempts.delete(ip);
    return false;
  }
  return rec.count >= MAX_ATTEMPTS;
}
function recordFailure(ip) {
  const rec = attempts.get(ip);
  if (!rec || Date.now() - rec.first > WINDOW_MS) attempts.set(ip, { first: Date.now(), count: 1 });
  else rec.count++;
}

router.post('/login', (req, res) => {
  const ip = req.ip;
  if (throttled(ip)) throw new HttpError(429, 'Too many failed login attempts. Try again later.');

  const username = str(req.body.username);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!username || !password) throw new HttpError(400, 'Username and password are required');

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    recordFailure(ip);
    throw new HttpError(401, 'Invalid username or password');
  }
  attempts.delete(ip);
  res.json({
    token: signToken(user),
    user: { id: user.id, username: user.username, name: user.full_name, role: user.role },
  });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.put('/password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (typeof newPassword !== 'string' || newPassword.length < 6) {
    throw new HttpError(400, 'New password must be at least 6 characters');
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user || !bcrypt.compareSync(String(currentPassword || ''), user.password_hash)) {
    throw new HttpError(400, 'Current password is incorrect');
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), user.id);
  res.json({ message: 'Password updated' });
});

// --- User management (admin only) ---
router.get('/users', requireAuth, requireRole('admin'), (_req, res) => {
  res.json(db.prepare('SELECT id, username, full_name, role, created_at FROM users ORDER BY id').all());
});

router.post('/users', requireAuth, requireRole('admin'), (req, res) => {
  const username = str(req.body.username);
  const full_name = str(req.body.full_name);
  const role = req.body.role === 'admin' ? 'admin' : 'staff';
  const password = req.body.password;
  if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(username)) {
    throw new HttpError(400, 'Username must be 3-30 characters (letters, numbers, . _ -)');
  }
  if (!full_name) throw new HttpError(400, 'Full name is required');
  if (typeof password !== 'string' || password.length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    throw new HttpError(409, 'Username already exists');
  }
  const info = db
    .prepare('INSERT INTO users (username, password_hash, full_name, role) VALUES (?,?,?,?)')
    .run(username, bcrypt.hashSync(password, 10), full_name, role);
  res.status(201).json({ id: Number(info.lastInsertRowid), username, full_name, role });
});

router.delete('/users/:id', requireAuth, requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw new HttpError(400, 'You cannot delete your own account');
  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!target) throw new HttpError(404, 'User not found');
  const used = db.prepare('SELECT 1 FROM requests WHERE resolved_by = ?').get(id);
  if (used) throw new HttpError(409, 'User has resolved requests and cannot be deleted');
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ message: 'User deleted' });
});

module.exports = router;
