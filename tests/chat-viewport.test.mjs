import assert from 'node:assert/strict';
import { getChatViewportGeometry as geometry } from '../src/chatViewport.js';
// Keyboard closed -> open and panned -> closed again. A stale layout height
// must not cap the restored visual viewport, and panning must retain height.
assert.deepEqual(geometry({height:844,offsetTop:0},844),{height:844,top:0});
assert.deepEqual(geometry({height:480,offsetTop:220},844),{height:480,top:220});
assert.deepEqual(geometry({height:480,offsetTop:100},480),{height:480,top:100});
assert.deepEqual(geometry({height:844,offsetTop:0},480),{height:844,top:0});
assert.deepEqual(geometry({height:390,offsetTop:0},844),{height:390,top:0});
assert.deepEqual(geometry(null,720),{height:720,top:0});
assert.deepEqual(geometry({height:0,offsetTop:-5},720),{height:720,top:0});
assert.deepEqual(geometry(null,0),{height:null,top:0});
console.log('Viewport checks passed: keyboard open/close, panning, stale layout height, rotation and fallback.');

// The Home Screen app can resume with a different visual viewport without
// dispatching resize. The live effect must remeasure on return.
const { readFileSync } = await import('node:fs');
const { runInNewContext } = await import('node:vm');
const app = readFileSync('src/App.jsx', 'utf8');
const start = app.indexOf('function SyncChatViewport(');
const end = app.indexOf('function HiddenBottomIndicator(', start);
const surface = () => new EventTarget();
const values = new Map();
const viewport = Object.assign(surface(), { height: 844, offsetTop: 0 });
const window = Object.assign(surface(), { visualViewport: viewport, innerHeight: 844 });
const document = Object.assign(surface(), {
  visibilityState: 'visible',
  documentElement: {
    classList: { toggle() {}, remove() {} },
    style: { setProperty: (key, value) => values.set(key, value), removeProperty: key => values.delete(key) },
  },
});
let effect;
const frames = [];
const SyncChatViewport = runInNewContext(app.slice(start, end) + '\nSyncChatViewport', {
  useLayoutEffect: callback => { effect = callback; },
  getChatViewportGeometry: geometry,
  requestAnimationFrame: callback => frames.push(callback),
  cancelAnimationFrame() {},
  window,
  document,
});
const flushFrames = () => { while (frames.length) frames.shift()(); };
SyncChatViewport({ channelId: 'room' });
const cleanup = effect();
viewport.height = 500;
viewport.offsetTop = 220;
viewport.dispatchEvent(new Event('resize'));
flushFrames();
assert.equal(values.get('--private-room-visible-height'), '500px');
assert.equal(values.get('--private-room-viewport-top'), '220px');
viewport.height = 844;
viewport.offsetTop = 0;
window.dispatchEvent(new Event('pageshow'));
flushFrames();
assert.equal(values.get('--private-room-visible-height'), '844px', 'reopening the app restores the frame without a resize event');
assert.equal(values.get('--private-room-viewport-top'), '0px');
viewport.height = 800;
document.dispatchEvent(new Event('visibilitychange'));
flushFrames();
assert.equal(values.get('--private-room-visible-height'), '800px', 'foregrounding remeasures the visible height');
cleanup();
window.dispatchEvent(new Event('pageshow'));
assert.equal(frames.length, 0, 'leaving the room removes recovery listeners');

// Closing or unmounting the full call overlay must release the composer.
const callEffectStart = app.indexOf('  useLayoutEffect(() => {\n    if (!fullScreen)');
const callEffectEnd = app.indexOf('\n\n  useEffect(', callEffectStart);
const fullScreenChanges = [];
let blurred = false;
runInNewContext(app.slice(callEffectStart, callEffectEnd), {
  useLayoutEffect: callback => { effect = callback; },
  fullScreen: true,
  onFullscreenChange: value => fullScreenChanges.push(value),
  document: { activeElement: { closest: () => true, blur: () => { blurred = true; } } },
});
const closeCallOverlay = effect();
assert.equal(blurred, true);
assert.deepEqual(fullScreenChanges, [true]);
closeCallOverlay();
assert.deepEqual(fullScreenChanges, [true, false], 'unmounting the call overlay makes the typing bar interactive again');
