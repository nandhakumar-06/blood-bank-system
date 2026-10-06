const jwt = require('jsonwebtoken');
const { HttpError } = require('../utils');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
if (!process.env.JWT_SECRET) {
  console.warn('[warn] JWT_SECRET is not set; using an insecure development secret. Set JWT_SECRET in production.');
}
const TOKEN_TTL = process.env.TOKEN_TTL || '8h';

function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role, name: user.full_name }, JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  });
}

/** Requires a valid Bearer token; attaches req.user. */
function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Authentication required'));
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    next(new HttpError(401, 'Invalid or expired token'));
  }
}

function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new HttpError(403, 'You do not have permission to perform this action'));
    }
    next();
  };
}

module.exports = { signToken, requireAuth, requireRole };
