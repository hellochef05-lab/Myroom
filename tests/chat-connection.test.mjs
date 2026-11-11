import assert from 'node:assert/strict';
import { ensureChannelWatched, createChatConnectionRecovery } from '../src/chatConnection.js';
let releaseWatch, watches = 0;
const first = { watch: async () => { watches++; await new Promise(resolve => { releaseWatch = resolve; }); } };
const a = ensureChannelWatched(first), b = ensureChannelWatched(first);
assert.equal(a, b);
await Promise.resolve(); assert.equal(watches, 1); releaseWatch(); await a;
const timers = []; let connections = 0, attempts = 0, visible = true;
const channel = { initialized: false, watch: async () => { if (++attempts === 1) throw new Error('watch timeout'); channel.initialized = true; } };
const recovery = createChatConnectionRecovery({
  client: { openConnection: async () => { connections++; } }, channel, canRecover: () => visible,
  schedule(fn, ms) { const timer = { fn, ms }; timers.push(timer); return timer; },
  cancel(timer) { const index = timers.indexOf(timer); if (index >= 0) timers.splice(index, 1); },
});
await recovery.resume();
assert.equal(attempts, 1); assert.equal(timers[0].ms, 1000);
await timers.shift().fn(); assert.equal(channel.initialized, true);
await recovery.resume(); assert.equal(attempts, 2, 'foreground must not refetch/reset an initialized message history');
visible = false; const before = connections; await recovery.resume(); assert.equal(connections, before);
recovery.dispose(); visible = true; await recovery.resume(); assert.equal(connections, before);
let resolveConnection, lateWatch = 0;
const late = createChatConnectionRecovery({
  client: { openConnection: () => new Promise(resolve => { resolveConnection = resolve; }) },
  channel: { watch: async () => { lateWatch++; } }, canRecover: () => true,
});
const pending = late.resume(); late.dispose(); resolveConnection(); await pending; assert.equal(lateWatch, 0);
console.log('Chat recovery passed: shared initial watch, retry after timeout, foreground/offline/disposal and no history refetch.');
