process.env.NODE_ENV = 'test';
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'poi-test-'));
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { app, db } = require('../app');
const adminHash = bcrypt.hashSync('__TEST_ONLY_FAKE_PASSWORD__', 4);
db.prepare("INSERT INTO users(username,password_hash,role) VALUES ('admin', ?, 'admin')").run(adminHash);
db.prepare("INSERT INTO users(username,password_hash,role) VALUES ('worker', ?, 'worker')").run(adminHash);
const origin = 'http://localhost:3000';
const csrf = req => req.set('Origin', origin);
let admin;
let worker;

test('health works and protected resources reject guests', async () => {
  assert.equal((await request(app).get('/api/health')).status, 200);
  const home = await request(app).get('/');
  assert.equal(home.status, 200);
  assert.match(home.text, /<div id="root"><\/div>/);
  assert.equal((await request(app).get('/api/pois')).status, 401);
});
test('login establishes session; wrong password is rejected', async () => {
  assert.equal((await csrf(request.agent(app).post('/api/auth/login')).send({ username: 'admin', password: 'wrong' })).status, 401);
  admin = request.agent(app);
  assert.equal((await csrf(admin.post('/api/auth/login')).send({ username: 'admin', password: '__TEST_ONLY_FAKE_PASSWORD__' })).status, 200);
});
test('admin can create and retrieve a point POI', async () => {
  const create = await csrf(admin.post('/api/pois')).send({ name: 'Test kiosk', type: 'Kiosk', company: 'lumiere', geometry_type: 'radius', lat: 36.8, lng: 10.1, radius: 100, created_by: 99999 });
  assert.equal(create.status, 201);
  const list = await admin.get('/api/pois');
  assert.equal(list.status, 200);
  assert.equal(list.body.data[0].name, 'Test kiosk');
  assert.notEqual(list.body.data[0].created_by, 99999);
});
test('invalid coordinates are rejected', async () => {
  const response = await csrf(admin.post('/api/pois')).send({ name: 'Bad', type: 'Kiosk', company: 'lumiere', geometry_type: 'radius', lat: 999, lng: 0, radius: 100 });
  assert.equal(response.status, 400);
});
test('worker can add POIs but cannot read admin users or activity', async () => {
  worker = request.agent(app);
  assert.equal((await csrf(worker.post('/api/auth/login')).send({ username: 'worker', password: '__TEST_ONLY_FAKE_PASSWORD__' })).status, 200);
  const create = await csrf(worker.post('/api/pois')).send({ name: 'Polygon', type: 'Magasin', company: 'gias', geometry_type: 'polygon', coordinates: [[36, 10], [36.1, 10], [36.1, 10.1]] });
  assert.equal(create.status, 201);
  assert.equal((await worker.get('/api/users')).status, 403);
  assert.equal((await worker.get('/api/activity')).status, 403);
});
test('session follows current account role and disabled accounts are rejected', async () => {
  db.prepare("UPDATE users SET role='worker' WHERE username='admin'").run();
  assert.equal((await admin.get('/api/users')).status, 403);
  db.prepare("UPDATE users SET role='admin' WHERE username='admin'").run();
  assert.equal((await admin.get('/api/users')).status, 200);
  db.prepare("UPDATE users SET status='disabled' WHERE username='worker'").run();
  assert.equal((await worker.get('/api/pois')).status, 401);
});
test('login POST rejects absent origin and logout revokes session', async () => {
  assert.equal((await request(app).post('/api/auth/login').send({ username: 'admin', password: '__TEST_ONLY_FAKE_PASSWORD__' })).status, 403);
  const preflight = await request(app).options('/api/auth/login').set('Origin', origin).set('Access-Control-Request-Method', 'POST');
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], origin);
  assert.equal((await csrf(admin.post('/api/auth/logout'))).status, 200);
  assert.equal((await admin.get('/api/pois')).status, 401);
});
after(() => { db.close(); });
