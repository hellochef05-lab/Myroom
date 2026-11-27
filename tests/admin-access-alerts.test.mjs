import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { recordLoginAttempt, recentAccessAlerts } from '../server/accessAlerts.js';

const now = Date.parse('2026-11-27T12:00:00Z');
const database = {
  accessLoginAlerts: [],
  payments: [
    { id: 'signup', username: 'Asha', contact: 'asha@example.com', planName: 'Monthly',
      createdAt: new Date(now - 1000).toISOString(), upiReference: 'payment-secret', accessKey: '56789' },
  ],
};
recordLoginAttempt(database, { displayName: 'Arun', roomCode: '1101', accessKey: '12345', allowed: true }, now);
recordLoginAttempt(database, { displayName: 'Guest 54321', roomCode: '2202', accessKey: '54321', allowed: false }, now + 1);
const alerts = recentAccessAlerts(database, now + 2);
assert.deepEqual(alerts.map(alert => alert.type), ['login', 'login', 'signup']);
assert.equal(alerts[0].allowed, false);
assert.equal(alerts[0].displayName, 'Guest [redacted]');
assert.equal(alerts[1].roomCode, '1101');
assert.equal(alerts[2].contact, 'asha@example.com');
assert.equal(alerts[2].planName, 'Monthly');
assert.doesNotMatch(JSON.stringify(alerts), /payment-secret|12345|54321|56789|upiReference|accessKey/);
assert.equal(recentAccessAlerts(database, now + 8 * 86400000).length, 0);
for (let i = 0; i < 140; i++) recordLoginAttempt(database, { displayName: 'Arun', roomCode: '1101' }, now + i + 3);
assert.ok(database.accessLoginAlerts.length <= 100);

const server = readFileSync('server/index.js', 'utf8');
const loginStart = server.indexOf('app.post("/api/login"');
const loginEnd = server.indexOf('/*', loginStart);
const loginDB = {
  accessLoginAlerts: [],
  devices: [{ deviceId: 'device', accessKey: '12345', status: 'active' }],
};
let login, saves = 0, batchedDenials = 0;
vm.runInNewContext(server.slice(loginStart, loginEnd), {
  app: { post(_path, handler) { login = handler; } },
  readDB: () => loginDB,
  writeDB() { saves++; },
  getActiveUserByAccessKey: (_db, key) => key === '12345'
    ? { user: { accessKey: key, deviceLimit: 1 } }
    : { status: 401, error: 'Invalid key' },
  recordLoginAttempt,
  saveDeniedLoginAlerts() { batchedDenials++; },
  sameValue: (a, b) => a === b,
  safeId: value => value,
  preferKnownValue: (value, saved) => value || saved,
  getReportedDeviceType: value => value,
});
const submitLogin = (key, deviceId) => login(
  { body: { username: 'Viewer', roomCode: '1101', accessKey: key, deviceId } },
  { status() { return this; }, json() {} },
);
submitLogin('54321', 'device');
submitLogin('12345', 'unregistered');
submitLogin('12345', 'device');
assert.deepEqual(loginDB.accessLoginAlerts.map(e => e.allowed), [false, false, true]);
assert.equal(batchedDenials, 2);
assert.equal(saves, 1, 'successful login persists its alert along with activity');

const start = server.indexOf('app.get("/api/admin/dashboard"');
const end = server.indexOf('app.get("/api/admin/devices"', start);
let dashboard;
const env = { ADMIN_PIN: 'fixture-pin' };
vm.runInNewContext(server.slice(start, end), {
  app: { get(_path, handler) { dashboard = handler; } },
  checkAdminPin: req => req.admin,
  readDB: () => ({ users: [], devices: [], payments: database.payments, supportRequests: [], rooms: [] }),
  recentAccessAlerts: () => alerts,
  process: { env },
  Date,
});
const results = [];
const res = { set() {}, json(data) { results.push(data); } };
dashboard({ admin: false }, res);
assert.equal(results.length, 0, 'the alert feed requires admin authorization');
dashboard({ admin: true }, res);
assert.deepEqual(results[0].accessAlerts, alerts, 'authorized dashboard includes the redacted alert feed');
delete env.ADMIN_PIN;
dashboard({ admin: true }, res);
assert.equal(results[1].accessAlertsEnabled, false);
assert.equal(results[1].accessAlerts.length, 0, 'the default dashboard PIN cannot expose alert details');
