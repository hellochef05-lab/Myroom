import { mergeRoomPresence } from "../src/presenceState.js";
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const listeners = new Map(), requests = [];
let effect, cleanup, snapshot = { roomId: null, members: [] }, subscriptionRemoved = false;
const client = { wsConnection: { isHealthy: true }, on() { return { unsubscribe() { subscriptionRemoved = true; } }; } };
const surface = { addEventListener(key, callback) { listeners.set(key, callback); }, removeEventListener(key) { listeners.delete(key); } };
const source = fs.readFileSync('src/useRoomPresence.js', 'utf8').replace(/^import .*;\n/gm, '').replaceAll('export function', 'function');
const document = { ...surface, hidden: false };
const hook = vm.runInNewContext(source + '\nuseRoomPresence', {
  useState: () => [snapshot, value => { snapshot = value; }],
  useEffect: fn => { effect = fn; },
  document, window: surface, navigator: { onLine: true },
  crypto: { randomUUID: () => '12345678-1234-1234-1234-123456789abc' },
  AbortSignal, AbortController, Date, Intl, Map, Set, mergeRoomPresence, setTimeout, clearTimeout,
  setInterval() { return 1; }, clearInterval() {},
  fetch: (url, options) => new Promise(resolve => requests.push({ url, body: JSON.parse(options.body), resolve })),
});
hook({ apiBase: '', accessKey: 'a', deviceId: 'd', roomId: 'r', name: 'Alice', client });
cleanup = effect();
assert.equal(requests[0].body.online, true);
const finish = async (request, members) => {
  request.resolve({ ok: true, json: async () => ({ members }) });
  await new Promise(resolve => setImmediate(resolve));
};
await finish(requests[0], [{ name: 'Alice', isOnline: true }]);
assert.equal(snapshot.members[0].name, 'Alice');
listeners.get('online')();
listeners.get('online')();
await finish(requests[2], [{ name: 'Newest' }]);
await finish(requests[1], [{ name: 'Old' }]);
assert.equal(snapshot.members[0].name, 'Newest', 'delayed response cannot overwrite newer status');
document.hidden = true;
listeners.get('visibilitychange')();
assert.equal(requests.at(-1).body.online, false);
document.hidden = false;
listeners.get('visibilitychange')();
assert.equal(requests.at(-1).body.online, true);
cleanup();
assert.equal(requests.at(-1).body.online, false, 'logout/room switch reports leaving');
await finish(requests.at(-2), [{ name: 'After unmount' }]);
assert.equal(snapshot.members[0].name, 'Newest');
assert.equal(subscriptionRemoved, true);
assert.equal(listeners.size, 0);
console.log('Presence client passed: arrival, background/return, stale responses, leave and cleanup.');
