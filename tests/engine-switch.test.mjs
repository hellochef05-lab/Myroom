import assert from 'node:assert/strict';
import middleware from '../middleware.js';
import { createEngineControl } from '../server/engineControl.js';

const normal = new Request('https://sayup-chat.vercel.app/');
const admin = new Request('https://sayup-chat.vercel.app/admin');
const adminHost = new Request('https://sayup-admin.vercel.app/');
let enabled = false;
let calls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  calls++;
  return Response.json({ success: true, database: 'connected', engineEnabled: enabled });
};
try {
  const blocked = await middleware(normal);
  assert.equal(blocked.status, 503);
  assert.match(await blocked.text(), /Sayup is unavailable/);
  assert.equal(blocked.headers.get('Cache-Control'), 'no-store');
  for (const request of [admin, adminHost]) assert.equal((await middleware(request)).headers.get('x-middleware-next'), '1');
  assert.equal(calls, 1, 'admin does not depend on the public gate');
  enabled = true;
  assert.equal((await middleware(normal)).headers.get('x-middleware-next'), '1', 'enabled serves the app normally');
  globalThis.fetch = async () => { throw new Error('Service down'); };
  assert.equal((await middleware(normal)).status, 503, 'an unknown status cannot open the public app');
} finally {
  globalThis.fetch = originalFetch;
}

const db = { devices: [{ streamUserId: 'alice' }, { streamUserId: 'alice' }, { streamUserId: 'bob' }] };
let notices = 0, saved, failWrite = false;
const revoked = [];
const control = createEngineControl({
  readDB: () => db,
  writeDB: async value => { if (failWrite) return false; saved = structuredClone(value); return true; },
  notifyOff() { notices++; },
  async revokeTokens(ids, before) { revoked.push({ ids, before }); },
});
assert.equal(control.enabled(), true, 'existing installations default to on');
assert.deepEqual(await control.update(false), { enabled: false });
assert.equal(control.enabled(), false);
assert.equal(saved.engineEnabled, false);
assert.equal(notices, 1);
assert.deepEqual(revoked[0].ids, ['alice', 'bob']);
assert.equal(revoked[0].before.getTime(), saved.engineTokensRevokedBefore);
assert.deepEqual(await control.update(true), { enabled: true });
assert.equal(control.enabled(), true);
assert.equal(saved.engineEnabled, true);
await control.update(false);
failWrite = true;
assert.equal((await control.update(true)).status, 503);
assert.equal(control.enabled(), false, 'failed reactivation does not reopen public access');
