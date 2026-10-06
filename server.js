const express = require('express');
const cors = require('cors');
const path = require('path');

require('./db');
const { seedIfEmpty } = require('./seed');
const { requireAuth } = require('./middleware/auth');
const { HttpError } = require('./utils');

const app = express();
app.use(cors());
app.use(express.json({ limit: '100kb' }));

// --- API ---
app.use('/api/auth', require('./routes/auth'));
app.use('/api/dashboard', requireAuth, require('./routes/dashboard'));
app.use('/api/donors', requireAuth, require('./routes/donors'));
app.use('/api/donations', requireAuth, require('./routes/donations'));
app.use('/api/inventory', requireAuth, require('./routes/inventory'));
app.use('/api/requests', requireAuth, require('./routes/requests'));
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'API route not found')));

// --- Frontend (static) ---
app.use(express.static(path.join(__dirname, 'public')));

// --- Error handler ---
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message, ...(err.extra || {}) });
});

const PORT = process.env.PORT || 3000;

seedIfEmpty();

if (require.main === module) {
  app.listen(PORT, () => console.log(`Blood Bank Management System running at http://localhost:${PORT}`));
}

module.exports = app;
