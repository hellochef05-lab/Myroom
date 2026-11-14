import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
// Exercise the production hook with a failed auxiliary backend but a working
// chat connection. The UI must still learn the other member is online.
const effects = [], requests = [], callbacks = new Map(), memberCallbacks = new Map();
let snapshot = { roomId: null, members: [] };
const source = fs.readFileSync('src/useRoomPresence.js', 'utf8').replace(/^import .*;\n/gm, '').replaceAll('export function', 'function');
const surface = { addEventListener() {}, removeEventListener() {} };
const channel = { state: { members: { bob: { user: { id: 'bob', name: 'Bob' } } } }, on(type, fn) { memberCallbacks.set(type, fn); return { unsubscribe() { memberCallbacks.delete(type); } }; } };
const client = {
  wsConnection: { isHealthy: true },
  on(type, fn) { callbacks.set(type, fn); return { unsubscribe() { callbacks.delete(type); } }; },
  async queryUsers(filter, sort, options) {
    requests.push({ filter, options }); return { users: [{ id: 'bob', name: 'Bob', online: true }] };
  },
};
let merge = (_, history) => history;
if (fs.existsSync('src/presenceState.js')) merge = (await import('../src/presenceState.js')).mergeRoomPresence;
const hook = vm.runInNewContext(source + '\nuseRoomPresence', {
  useState: () => [snapshot, value => { snapshot = value; }], useEffect: fn => effects.push(fn),
  mergeRoomPresence: merge, document: { ...surface, hidden: false }, window: surface,
  navigator: { onLine: true }, crypto: { randomUUID: () => '12345678-1234-1234-1234-123456789abc' },
  AbortSignal, AbortController, Date, Intl, Map, Set,
  setInterval: () => 1, clearInterval() {}, setTimeout: () => 2, clearTimeout() {},
  fetch: async () => ({ ok: false, status: 503 }),
});
hook({ apiBase: '', accessKey: 'a', deviceId: 'd', roomId: 'r', name: 'Alice', client, channel });
const cleanup = effects[0]();
await new Promise(resolve => setImmediate(resolve));
assert.equal(snapshot.members.find(member => member.userId === 'bob')?.isOnline, true,
  'a failed heartbeat must not hide a member confirmed online by the live chat service');
assert.equal(requests[0].options.presence, true);
callbacks.get('user.presence.changed')({ user: { id: 'bob', name: 'Bob', online: false, last_active: '2026-11-14T12:00:00Z' } });
assert.equal(snapshot.members.find(member => member.userId === 'bob').isOnline, false);
let resolveStale;
client.queryUsers = () => new Promise(resolve => { resolveStale = resolve; });
callbacks.get('connection.recovered')();
callbacks.get('user.presence.changed')({ user: { id: 'bob', name: 'Bob', online: false } });
resolveStale({ users: [{ id: 'bob', name: 'Bob', online: true }] });
await new Promise(resolve => setImmediate(resolve));
assert.equal(snapshot.members.find(member => member.userId === 'bob').isOnline, false, 'late query cannot overwrite a newer offline event');
callbacks.get('user.presence.changed')({ user: { id: 'outsider', online: true } });
assert.equal(snapshot.members.some(member => member.userId === 'outsider'), false);
channel.state.members = {};
memberCallbacks.get('member.removed')();
assert.equal(snapshot.members.length, 0, 'former room members must not remain displayed');
cleanup();
assert.equal(callbacks.size, 0);
assert.equal(memberCallbacks.size, 0);
console.log('Presence source passed: live chat works despite backend failure, presence events update immediately and subscriptions clean up.');
