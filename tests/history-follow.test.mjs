import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = fs.readFileSync('src/App.jsx', 'utf8');
const begin = source.indexOf('  const beginUserScroll =');
const end = source.indexOf('\n  return (', begin);
const pinned = { current: true }, scrolling = { current: false };
const list = { scrollHeight: 1000, clientHeight: 400, scrollTop: 200 };
const timers = new Map(); let timerId = 0;
const context = {
  pinnedToLatestRef: pinned, userIsScrollingRef: scrolling,
  lastUserScrollTopRef: { current: 0 }, gestureViewportHeightRef: { current: 0 }, resumeAtLatestRef: { current: false },
  listHostRef: { current: { querySelector: () => list } },
  interactionResetTimerRef: { current: 0 }, followFrameRef: { current: 0 },
  initialPositionReady: true, historyPaginationEnabled: true, cancelAnimationFrame() {},
  window: { clearTimeout(id) { timers.delete(id); }, setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; } },
};
const { beginUserScroll, finishUserScroll, recordUserScrollPosition } = vm.runInNewContext(
  source.slice(begin, end) + '\n({beginUserScroll,finishUserScroll,recordUserScrollPosition})', context);
const settle = () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); };
const scroll = () => recordUserScrollPosition({ target: { closest: () => list } });
beginUserScroll(); assert.equal(pinned.current, false);
finishUserScroll(); settle(); assert.equal(scrolling.current, false); assert.equal(pinned.current, false);
// A deliberate downward scroll back to latest re-enables incoming visibility.
beginUserScroll(); list.scrollTop = 600; scroll(); assert.equal(pinned.current, false); settle(); assert.equal(pinned.current, true);
// A tap at latest must not disable incoming visibility indefinitely.
beginUserScroll(); finishUserScroll(); settle(); assert.equal(pinned.current, true);
// A keyboard/viewport resize that makes history appear at bottom cannot opt in.
list.scrollTop = 300; beginUserScroll(); list.clientHeight = 600; list.scrollTop = 400; scroll(); settle(); assert.equal(pinned.current, false);
// Reaching bottom then reversing upward must preserve the final chosen position.
list.clientHeight = 400; list.scrollTop = 200; beginUserScroll(); list.scrollTop = 600; scroll(); list.scrollTop = 500; scroll(); settle(); assert.equal(pinned.current, false);
// No active gesture: a later programmatic scroll cannot opt in.
list.scrollTop = 600; scroll(); assert.equal(pinned.current, false);
let moves = 0;
const sendStart = source.indexOf('    const scrollAfterOwnSend =');
const sendEnd = source.indexOf('    const followIncomingAtLatest =', sendStart);
vm.runInNewContext(source.slice(sendStart, sendEnd) + '\nscrollAfterOwnSend()', { ...context, moveToLatest() { moves++; } });
assert.equal(pinned.current, true); assert.equal(scrolling.current, false); assert.equal(moves, 1);
console.log('Scroll intent passed: preserve history, manual return to bottom, taps, viewport changes, reversal and explicit send.');
