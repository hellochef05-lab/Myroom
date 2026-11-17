import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { clampCallWindow } from '../src/callWindow.js';

const room = { left: 10, top: 20, right: 380, bottom: 800 };
const panel = { width: 130, height: 100 };
const viewport = { left: 0, top: 50, right: 390, bottom: 400 };
assert.deepEqual(clampCallWindow({ x: 80, y: 90 }, room, viewport, panel), { x: 80, y: 90 });
assert.deepEqual(clampCallWindow({ x: -100, y: -100 }, room, viewport, panel), { x: 8, y: 38 });
assert.deepEqual(clampCallWindow({ x: 700, y: 700 }, room, viewport, panel), { x: 232, y: 272 });

let position;
const source = readFileSync('src/callWindow.js', 'utf8')
  .replace(/^import .*;\n/, '').replaceAll('export ', '');
const hook = vm.runInNewContext(source + '\nuseMovableCallWindow', {
  useLayoutEffect() {}, useRef: current => ({ current }),
  useState: value => [value, next => { position = next; }],
  window: { innerWidth: 390, innerHeight: 800 },
});
const { roomRef, windowRef, controls, consumeDragClick } = hook(true);
roomRef.current = {
  getBoundingClientRect: () => ({ ...room, bottom: 76 }),
  parentElement: { getBoundingClientRect: () => room },
};
windowRef.current = { getBoundingClientRect: () => ({ ...panel, left: 200, top: 90 }) };
const pointer = (x, y) => ({ pointerId: 1, button: 0, clientX: x, clientY: y, currentTarget: { setPointerCapture() {} } });
controls.onPointerDown(pointer(227, 103));
controls.onPointerMove(pointer(230, 105));
controls.onPointerUp(pointer(230, 105));
assert.equal(consumeDragClick({ detail: 1 }), false, 'a tap still expands the call');
controls.onPointerDown(pointer(227, 103));
controls.onPointerMove(pointer(60, 300));
controls.onPointerUp(pointer(60, 300));
assert.equal(position.x, 23);
assert.equal(position.y, 267, 'the header is only the anchor, not the drag boundary');
assert.equal(consumeDragClick({ detail: 0 }), false, 'keyboard activation remains available');
assert.equal(consumeDragClick({ detail: 1 }), true, 'a drag never expands the call');
console.log('Movable video passed: room and viewport bounds, keyboard resize coordinates, drag and tap distinction.');
