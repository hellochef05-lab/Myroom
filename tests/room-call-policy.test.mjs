import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const server = readFileSync('server/index.js', 'utf8');
const routeStart = server.indexOf('app.patch("/api/admin/rooms/:roomId/calls"');
const routeEnd = server.indexOf('app.delete("/api/admin/rooms/:roomId"', routeStart);
const socketStart = server.indexOf('function roomCallsEnabled(');
const socketEnd = server.indexOf('const PORT =', socketStart);
const db = { rooms: [{ id: 'a' }, { id: 'b' }] };
const broadcasts = [];
let patch, connect;
let persisted;
const io = {
  on(_event, handler) { connect = handler; },
  to(room) { return { emit: (event, data) => broadcasts.push({ room, event, data }) }; },
  sockets: { adapter: { rooms: new Map() } },
};
vm.runInNewContext(server.slice(routeStart, routeEnd) + server.slice(socketStart, socketEnd), {
  io, app: { patch(_path, handler) { patch = handler; } },
  checkAdminPin(req, res) { return req.admin || (res.status(403).json({}), false); },
  readDB: () => db, writeDB: async data => { persisted = JSON.stringify(data); return true; },
  console: { log() {}, error() {} },
});

async function update(roomId, callsEnabled, admin = true) {
  const res = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
  await patch({ admin, params: { roomId }, body: { callsEnabled } }, res);
  return res;
}
const handlers = new Map();
const socket = {
  on: (event, handler) => handlers.set(event, handler),
  join() {}, emit: (event, data) => broadcasts.push({ event, data }), to: io.to,
};
connect(socket);
const signal = (roomId, type) => {
  let result;
  handlers.get('signal')({ roomId, data: { type } }, response => { result = response; });
  return result;
};

assert.equal(signal('a', 'call').ok, true, 'existing rooms default to enabled');
assert.equal((await update('a', false, false)).code, 403);
assert.equal((await update('a', 'false')).code, 400);
assert.equal((await update('missing', false)).code, 404);
assert.equal((await update('a', false)).data.callsEnabled, false);
assert.equal(JSON.parse(persisted).rooms[0].callsEnabled, false);
assert.equal(broadcasts.at(-1).data.type, 'hangup', 'disabling tells open clients to end calls');
handlers.get('join-room')({ roomId: 'a' }, () => {});
assert.equal(broadcasts.at(-2).data.callsEnabled, false, 'new clients receive the room policy on join');
assert.equal(broadcasts.at(-1).data.type, 'hangup', 'reconnecting clients close calls if they missed the setting change');
for (const type of ['call', 'offer', 'answer', 'accept', 'ice']) {
  const count = broadcasts.length;
  assert.equal(signal('a', type).code, 'CALLS_DISABLED');
  assert.equal(broadcasts.length, count, 'blocked signals are never forwarded');
}
assert.equal(signal('b', 'call').ok, true, 'other rooms retain their own setting');
assert.equal((await update('a', true)).data.callsEnabled, true);
assert.equal(signal('a', 'call').ok, true);
console.log('Room call policy passed: admin validation, persistence, live updates, signaling block and room isolation.');
