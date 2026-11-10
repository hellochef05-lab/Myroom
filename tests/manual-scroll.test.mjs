import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = fs.readFileSync('src/App.jsx', 'utf8');
const start = source.indexOf('    if (!initialPositionReady) return undefined;');
const end = source.indexOf('  }, [channel, initialPositionReady]);', start);
const listeners = new Map(), frames = [];
const surface = { addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type) { listeners.delete(type); }, clearTimeout() {} };
const list = { scrollTop: 420, scrollHeight: 2500, clientHeight: 600 };
const pinned = { current: true }, scrolling = { current: false };
const context = {
  initialPositionReady: true, listHostRef: { current: { querySelector: () => list } },
  pinnedToLatestRef: pinned, userIsScrollingRef: scrolling, followFrameRef: { current: 0 }, interactionResetTimerRef: { current: 0 },
  window: { ...surface, visualViewport: surface }, document: surface,
  channel: { on: surface.addEventListener, off: surface.removeEventListener },
  requestAnimationFrame(fn) { frames.push(fn); return frames.length; }, cancelAnimationFrame() {},
  // If a resize observer is reintroduced, simulate a keyboard/media resize.
  ResizeObserver: class { constructor(fn) { this.fn = fn; } observe() { this.fn(); } disconnect() {} },
};
const cleanup = vm.runInNewContext('(function(){' + source.slice(start, end) + '})()', context);
const flush = () => { while (frames.length) frames.shift()(); };
flush();
assert.equal(list.scrollTop, 420, 'mount/update must not force bottom once initial position is set');
for (const type of ['focusin', 'resize', 'message.new', 'connection.changed']) { listeners.get(type)?.({ target: { closest: () => true } }); flush(); }
assert.equal(list.scrollTop, 420, 'keyboard/media/incoming/reconnect updates cannot move a reader');
listeners.get('sayup:whatsapp-send-follow')();
flush();
assert.equal(list.scrollTop, 1900, 'explicitly sending can reveal the sent message');
list.scrollTop = 800;
listeners.get('sayup:whatsapp-send-follow')();
// A user's touch/scroll takes priority even over a pending explicit-send frame.
pinned.current = false; scrolling.current = true;
flush();
assert.equal(list.scrollTop, 800);
cleanup();
assert.equal(listeners.size, 0);
console.log('Manual scrolling passed: no forced movement on mount, keyboard, resize, incoming messages or reconnect; user gesture cancels delayed send movement.');
