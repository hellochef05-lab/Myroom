import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = fs.readFileSync('src/App.jsx', 'utf8');
const start = source.indexOf('    if (!initialPositionReady) return undefined;');
const end = source.indexOf('  }, [channel, initialPositionReady]);', start);
const listeners = new Map(), frames = [];
const surface = { addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type) { listeners.delete(type); }, clearTimeout() {} };
const list = { scrollTop: 1900, scrollHeight: 2500, clientHeight: 600 };
const pinned = { current: true }, scrolling = { current: false };
const cleanup = vm.runInNewContext('(function(){' + source.slice(start, end) + '})()', {
  initialPositionReady: true, listHostRef: { current: { querySelector: () => list } },
  pinnedToLatestRef: pinned, userIsScrollingRef: scrolling, followFrameRef: { current: 0 }, interactionResetTimerRef: { current: 0 },
  window: surface, channel: { on: surface.addEventListener, off: surface.removeEventListener },
  requestAnimationFrame(fn) { frames.push(fn); return frames.length; }, cancelAnimationFrame() {},
});
const flush = () => { while (frames.length) frames.shift()(); };
listeners.get('message.new')?.({ message: { id: 'incoming' } });
list.scrollHeight += 90; // React commits the received bubble after the event.
flush();
assert.equal(list.scrollTop, 1990, 'incoming bubble must be visible when already at latest');
list.scrollTop = 700; pinned.current = false;
listeners.get('message.new')?.({ message: { id: 'history-reader' } }); list.scrollHeight += 70; flush();
assert.equal(list.scrollTop, 700, 'history readers retain their position');
list.scrollTop = list.scrollHeight - list.clientHeight; pinned.current = true;
listeners.get('message.new')?.({ message: { id: 'touch-race' } }); list.scrollHeight += 80;
scrolling.current = true; pinned.current = false; list.scrollTop -= 200; const chosen = list.scrollTop;
flush(); assert.equal(list.scrollTop, chosen, 'a new gesture cancels pending incoming follow');
scrolling.current = false; pinned.current = true; list.scrollTop = 200;
listeners.get('message.new')?.({ message: { id: 'stale-pin' } }); list.scrollHeight += 60; flush();
assert.equal(list.scrollTop, 200, 'current DOM position overrides a stale pin flag');
cleanup(); assert.equal(listeners.size, 0);
console.log('Incoming visibility passed: reveal only from latest, preserve history and cancel on touch.');
