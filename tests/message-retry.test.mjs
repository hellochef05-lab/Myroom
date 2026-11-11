import assert from 'node:assert/strict';
import { createOutboxFlusher } from '../src/messageOutbox.js';
let queue = [{ id: 'one', localMessage: { id: 'one' }, message: { id: 'one', text: 'hello' } }];
const timers = [];
let requests = 0;
const flush = createOutboxFlusher({
  readQueue: () => queue, writeQueue: value => { queue = value; },
  sendMessage: async message => { if (++requests === 1) throw new Error('temporary timeout'); return { message }; },
  schedule(fn, ms) { const timer = { fn, ms }; timers.push(timer); return timer; },
  cancel(timer) { const index = timers.indexOf(timer); if (index >= 0) timers.splice(index, 1); },
});
await flush();
assert.equal(queue.length, 1);
assert.equal(timers.length, 1, 'a transient send failure must retry without waiting for a new message or network-change event');
assert.equal(timers[0].ms, 500);
await timers.shift().fn();
assert.equal(requests, 2);
assert.equal(queue.length, 0);
flush.dispose?.();
console.log('Transient delivery retries automatically with the same message ID.');
// A websocket echo proves delivery even if the HTTP response is delayed/lost.
queue = ['first', 'second'].map(id => ({ id, localMessage: { id }, message: { text: id } }));
const sent = []; let resolveSlow;
const fastAck = createOutboxFlusher({
  readQueue: () => queue, writeQueue: value => { queue = value; },
  sendMessage: message => {
    sent.push(message);
    if (message.id === 'first') return new Promise(resolve => { resolveSlow = resolve; });
    return Promise.resolve({ message });
  },
});
const delivery = fastAck(); await Promise.resolve();
assert.deepEqual(sent.map(item => item.id), ['first']);
fastAck.acknowledge({ id: 'first', text: 'first' });
await delivery;
assert.deepEqual(sent.map(item => item.id), ['first', 'second']);
assert.equal(queue.length, 0, 'later sends need not wait for a delayed HTTP response after a live acknowledgment');
resolveSlow({ message: { id: 'first' } }); fastAck.dispose();
// A duplicate-ID response means the earlier attempt was accepted.
queue = [{ id: 'duplicate', localMessage: { id: 'duplicate' }, message: { id: 'duplicate' } }];
const duplicate = createOutboxFlusher({ readQueue: () => queue, writeQueue: value => { queue = value; },
  sendMessage: async () => { throw Object.assign(new Error('message already exists'), { code: 4, status: 400 }); },
});
await duplicate(); assert.equal(queue.length, 0); duplicate.dispose();
console.log('Live echo unblocks subsequent sends, and lost-response duplicate IDs settle as sent.');
let allowed = true, attempts = 0;
queue = [{ id: 'retry', localMessage: { id: 'retry' }, message: { id: 'retry' } }];
const retryTimers = [];
const controlled = createOutboxFlusher({
  readQueue: () => queue, writeQueue: value => { queue = value; }, canSend: () => allowed,
  sendMessage: async () => { attempts++; throw new Error('weak connection'); },
  schedule(fn, ms) { const timer = { fn, ms }; retryTimers.push(timer); return timer; },
  cancel(timer) { const index = retryTimers.indexOf(timer); if (index >= 0) retryTimers.splice(index, 1); },
});
await controlled();
for (const expected of [500, 1000, 2000, 4000, 8000, 10000, 10000]) {
  const timer = retryTimers.shift(); assert.equal(timer.ms, expected); await timer.fn();
}
controlled.pause(); assert.equal(retryTimers.length, 0);
const beforePause = attempts; await controlled(); assert.equal(attempts, beforePause);
allowed = false; await controlled.start(); assert.equal(attempts, beforePause);
allowed = true; await controlled.start(); assert.equal(attempts, beforePause + 1);
controlled.dispose(); assert.equal(retryTimers.length, 0);
// Permission/validation failures must not produce an endless retry loop.
const permanentTimers = [], states = [];
const forbidden = createOutboxFlusher({ readQueue: () => queue, writeQueue: value => { queue = value; },
  sendMessage: async () => { throw { status: 403 }; }, updateMessage: value => states.push(value),
  schedule: fn => permanentTimers.push(fn),
});
await forbidden(); assert.equal(permanentTimers.length, 0); assert.equal(states.at(-1).status, 'failed'); forbidden.dispose();
console.log('Delivery backoff is bounded; offline/pause/unmount stop retries, foreground resumes it and permanent errors stop retrying.');
