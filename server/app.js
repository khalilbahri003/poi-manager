require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const path = require('node:path');
const fs = require('node:fs');
const db = require('./db');
const SQLiteSessionStore = require('./session-store');

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';
const port = Number(process.env.PORT || 5000);
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: isProduction ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: [],
    },
  } : false,
}));
app.use(express.json({ limit: '64kb', strict: true }));
app.use(session({
  name: 'poi.sid',
  secret: process.env.SESSION_SECRET || (isTest ? require('node:crypto').randomBytes(32).toString('hex') : ''),
  store: new SQLiteSessionStore(),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'strict', secure: isProduction, maxAge: 8 * 60 * 60 * 1000 },
}));
if (!isTest && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error('SESSION_SECRET must be at least 32 characters. Generate a random secret and set it in the environment.');
}

const allowedOrigins = (process.env.ALLOWED_ORIGINS || (isProduction ? '' : 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5000,http://127.0.0.1:5000'))
  .split(',').map(value => value.trim()).filter(Boolean);
app.use('/api', (req, res, next) => {
  const origin = req.get('origin');
  const sameOrigin = origin && `${req.protocol}://${req.get('host')}` === origin;
  const originIsAllowed = !origin || allowedOrigins.includes(origin) || (isProduction && sameOrigin);
  if (origin && originIsAllowed) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Credentials', 'true');
    res.vary('Origin');
  }
  if (req.method === 'OPTIONS') {
    if (!origin || !originIsAllowed) return res.status(403).end();
    res.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (!origin) return res.status(403).json({ status: 'error', message: 'Origin header required.' });
  if (!originIsAllowed) return res.status(403).json({ status: 'error', message: 'Request origin is not allowed.' });
  next();
});

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { status: 'error', message: 'Too many login attempts. Try again later.' } });
const logActivity = db.prepare('INSERT INTO activity(user_id, action_type, description) VALUES (?, ?, ?)');
const recordActivity = (userId, action, description) => logActivity.run(userId || null, action, description);
const publicUser = user => ({ id: user.id, username: user.username, role: user.role, status: user.status });
const requireAuth = (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ status: 'error', message: 'Sign in required.' });
  const user = db.prepare('SELECT id, username, role, status FROM users WHERE id = ?').get(req.session.user.id);
  if (!user || user.status !== 'active') {
    return req.session.destroy(() => res.status(401).json({ status: 'error', message: 'Sign in required.' }));
  }
  req.session.user = publicUser(user);
  next();
};
const requireAdmin = (req, res, next) => requireAuth(req, res, () => {
  if (req.session.user.role !== 'admin') return res.status(403).json({ status: 'error', message: 'Administrator access required.' });
  next();
});
const usernamePattern = /^[\p{L}\p{N}_.-]{3,32}$/u;

app.get('/api/health', (_req, res) => res.json({ status: 'success', data: { service: 'poi-api' } }));
app.post('/api/auth/login', loginLimiter, async (req, res, next) => {
  try {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!username || !password || username.length > 32 || password.length > 128) {
      return res.status(400).json({ status: 'error', message: 'Enter a valid username and password.' });
    }
    const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE AND status = ?').get(username, 'active');
    const matches = user ? await bcrypt.compare(password, user.password_hash) : false;
    if (!matches) return res.status(401).json({ status: 'error', message: 'Invalid username or password.' });
    req.session.regenerate(error => {
      if (error) return next(error);
      req.session.user = publicUser(user);
      recordActivity(user.id, 'login', 'Signed in');
      req.session.save(saveError => {
        if (saveError) return next(saveError);
        res.json({ status: 'success', data: { user: req.session.user } });
      });
    });
  } catch (error) { next(error); }
});
app.post('/api/auth/logout', requireAuth, (req, res, next) => {
  const user = req.session.user;
  req.session.destroy(error => {
    if (error) return next(error);
    res.clearCookie('poi.sid', { httpOnly: true, sameSite: 'strict', secure: isProduction });
    recordActivity(user.id, 'logout', 'Signed out');
    res.json({ status: 'success', data: { message: 'Signed out.' } });
  });
});
app.get('/api/auth/me', (req, res) => {
  if (!req.session.user) return res.json({ status: 'success', data: { user: null } });
  const user = db.prepare('SELECT id, username, role, status FROM users WHERE id = ?').get(req.session.user.id);
  if (!user || user.status !== 'active') return req.session.destroy(() => res.json({ status: 'success', data: { user: null } }));
  req.session.user = publicUser(user);
  res.json({ status: 'success', data: { user: req.session.user } });
});

app.get('/api/pois', requireAuth, (_req, res) => {
  const rows = db.prepare(`SELECT id, name, type, company, geometry_type, lat, lng, radius, coordinates, created_by, created_at
    FROM pois ORDER BY id DESC`).all().map(row => ({ ...row, coordinates: row.coordinates ? JSON.parse(row.coordinates) : null }));
  res.json({ status: 'success', data: rows });
});
app.post('/api/pois', requireAuth, (req, res) => {
  const body = req.body || {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const type = typeof body.type === 'string' ? body.type.trim() : '';
  const company = body.company;
  const geometryType = body.geometry_type;
  if (!name || name.length > 120 || !type || type.length > 60 || !['lumiere', 'gias'].includes(company)) {
    return res.status(400).json({ status: 'error', message: 'Name, type, and a supported company are required.' });
  }
  let result;
  if (geometryType === 'radius') {
    const lat = Number(body.lat); const lng = Number(body.lng); const radius = Number(body.radius);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180 || !Number.isFinite(radius) || radius < 10 || radius > 1000) {
      return res.status(400).json({ status: 'error', message: 'Point coordinates or radius are invalid.' });
    }
    result = db.prepare(`INSERT INTO pois(name,type,company,geometry_type,lat,lng,radius,created_by)
      VALUES (?, ?, ?, 'radius', ?, ?, ?, ?)`).run(name, type, company, lat, lng, radius, req.session.user.id);
  } else if (geometryType === 'polygon') {
    const coords = body.coordinates;
    if (!Array.isArray(coords) || coords.length < 3 || coords.length > 1000 || coords.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite) || point[0] < -90 || point[0] > 90 || point[1] < -180 || point[1] > 180)) {
      return res.status(400).json({ status: 'error', message: 'Polygon coordinates are invalid.' });
    }
    result = db.prepare(`INSERT INTO pois(name,type,company,geometry_type,coordinates,created_by)
      VALUES (?, ?, ?, 'polygon', ?, ?)`).run(name, type, company, JSON.stringify(coords), req.session.user.id);
  } else return res.status(400).json({ status: 'error', message: 'Geometry type must be radius or polygon.' });
  recordActivity(req.session.user.id, 'poi_created', `Created ${geometryType}: ${name}`);
  res.status(201).json({ status: 'success', data: { id: result.lastInsertRowid } });
});
app.delete('/api/pois/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ status: 'error', message: 'Invalid POI id.' });
  const poi = db.prepare('SELECT name FROM pois WHERE id = ?').get(id);
  if (!poi) return res.status(404).json({ status: 'error', message: 'POI not found.' });
  db.prepare('DELETE FROM pois WHERE id = ?').run(id);
  recordActivity(req.session.user.id, 'poi_deleted', `Deleted ${poi.name}`);
  res.json({ status: 'success', data: { id } });
});

app.get('/api/users', requireAdmin, (_req, res) => {
  const users = db.prepare('SELECT id, username, role, status, created_at FROM users ORDER BY id').all();
  res.json({ status: 'success', data: users });
});
app.post('/api/users', requireAdmin, async (req, res, next) => {
  try {
    const { username, password, role = 'worker' } = req.body || {};
    if (typeof username !== 'string' || !usernamePattern.test(username.trim())) return res.status(400).json({ status: 'error', message: 'Username must be 3–32 letters, numbers, dot, dash, or underscore.' });
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) return res.status(400).json({ status: 'error', message: 'Password must be 12–128 characters.' });
    if (!['admin', 'worker'].includes(role)) return res.status(400).json({ status: 'error', message: 'Role is invalid.' });
    const hash = await bcrypt.hash(password, 12);
    try {
      const inserted = db.prepare('INSERT INTO users(username,password_hash,role) VALUES (?, ?, ?)').run(username.trim(), hash, role);
      recordActivity(req.session.user.id, 'user_created', `Created ${role} account`);
      res.status(201).json({ status: 'success', data: { id: inserted.lastInsertRowid } });
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ status: 'error', message: 'That username is already in use.' });
      throw error;
    }
  } catch (error) { next(error); }
});
app.delete('/api/users/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ status: 'error', message: 'Invalid user id.' });
  if (id === req.session.user.id) return res.status(400).json({ status: 'error', message: 'You cannot delete your own account.' });
  const target = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ status: 'error', message: 'User not found.' });
  if (target.role === 'admin' && db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND status='active'").get().n <= 1) {
    return res.status(409).json({ status: 'error', message: 'The last active administrator cannot be deleted.' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  recordActivity(req.session.user.id, 'user_deleted', 'Deleted a user account');
  res.json({ status: 'success', data: { id } });
});
app.get('/api/activity', requireAdmin, (_req, res) => {
  const rows = db.prepare(`SELECT a.id, a.action_type, a.description, a.created_at, COALESCE(u.username, '[deleted user]') AS username
    FROM activity a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 200`).all();
  res.json({ status: 'success', data: rows });
});

const buildDir = path.resolve(__dirname, '../build');
if (fs.existsSync(path.join(buildDir, 'index.html'))) {
  app.use(express.static(buildDir, { index: false, maxAge: isProduction ? '1d' : 0 }));
  app.get('*path', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(buildDir, 'index.html'));
  });
}
app.use((req, res) => res.status(404).json({ status: 'error', message: 'Not found.' }));
app.use((error, _req, res, _next) => {
  console.error(error);
  const status = error.status || 500;
  res.status(status).json({ status: 'error', message: status < 500 ? error.message : 'Internal server error.' });
});

if (require.main === module) app.listen(port, () => console.log(`POI API listening on port ${port}`));
module.exports = { app, db, recordActivity };
