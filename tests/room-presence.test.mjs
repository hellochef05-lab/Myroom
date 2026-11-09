import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { reportRoomPresence, roomPresenceSnapshot, PRESENCE_TTL_MS } from '../server/roomPresence.js';
const now = Date.parse('2026-11-09T12:00:00Z');
const device = { status: 'active', streamUserId: 'alice' };
const report = (sessionId, sequence, online, at) => reportRoomPresence(device, 'room-a', { sessionId, sequence, online, name: 'Alice' }, at);
const snapshot = at => roomPresenceSnapshot([device], 'room-a', at)[0];
report('tab1', 1, true, now);
assert.equal(snapshot(now).isOnline, true);
assert.equal(snapshot(now).onlineSince, new Date(now).toISOString());
report('tab1', 2, true, now + 15000);
assert.equal(snapshot(now + 15000).onlineSince, new Date(now).toISOString(), 'heartbeat preserves arrival');
report('tab2', 1, true, now + 16000);
report('tab1', 3, false, now + 17000);
assert.equal(snapshot(now + 17000).isOnline, true, 'one background tab cannot mark another offline');
report('tab2', 2, false, now + 18000);
assert.equal(snapshot(now + 18000).isOnline, false);
assert.equal(snapshot(now + 18000).leftAt, new Date(now + 18000).toISOString());
report('tab2', 1, true, now + 19000);
assert.equal(snapshot(now + 19000).isOnline, false, 'late heartbeat cannot resurrect a closed tab');
report('tab1', 4, true, now + 20000);
assert.equal(snapshot(now + 20000).onlineSince, new Date(now + 20000).toISOString());
assert.equal(snapshot(now + 20000 + PRESENCE_TTL_MS).isOnline, false);
assert.equal(snapshot(now + 20000 + PRESENCE_TTL_MS).leftAt, null, 'network loss must not invent an exact exit');
assert.deepEqual(roomPresenceSnapshot([device], 'other-room', now), [], 'room isolation');
assert.deepEqual(roomPresenceSnapshot([{ ...device, status: 'revoked' }], 'room-a', now), []);
const restored = JSON.parse(JSON.stringify(device));
assert.equal(roomPresenceSnapshot([restored], 'room-a', now + 21000)[0].name, 'Alice', 'database round-trip retains times');
// Exercise the production HTTP handler's access checks, not a copy of them.
const source = fs.readFileSync('server/index.js', 'utf8');
const start = source.indexOf('app.post("/api/room-presence"');
const end = source.indexOf('app.post("/api/activity"', start);
let handler;
const db = { devices: [{ ...device, accessKey: 'key-a', deviceId: 'd1' }], rooms: [{ id: 'room-a', accessKey: 'key-a' }] };
vm.runInNewContext(source.slice(start, end), {
  app: { post(path, fn) { handler = fn; } },
  readDB: () => db, writeDB() {},
  getActiveUserByAccessKey: (_, key) => key === 'key-a' ? { user: { accessKey: key } } : { status: 403, error: 'Invalid key' },
  sameValue: (a, b) => a === b, reportRoomPresence, roomPresenceSnapshot,
});
const invoke = body => {
  let status = 200, data;
  const res = { status(value) { status = value; return this; }, json(value) { data = value; return this; }, set() {} };
  handler({ body }, res); return { status, data };
};
const body = { accessKey: 'key-a', deviceId: 'd1', roomId: 'room-a', sessionId: '12345678-1234-1234-1234-123456789abc', sequence: 1, online: true, name: 'Alice' };
assert.equal(invoke(body).status, 200);
assert.equal(invoke({ ...body, accessKey: 'wrong' }).status, 403);
assert.equal(invoke({ ...body, deviceId: 'foreign' }).status, 403);
assert.equal(invoke({ ...body, roomId: 'foreign-room' }).status, 403);
assert.equal(invoke({ ...body, online: 'true' }).status, 400);
console.log('Room presence tests passed: arrival/departure, heartbeat, multiple tabs, reordered reports, network timeout, persistence and access isolation.');
