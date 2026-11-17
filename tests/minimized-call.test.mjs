import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import { transformSync } from 'esbuild';

const app = readFileSync('src/App.jsx', 'utf8');
const start = app.indexOf('function CallOverlay(');
const end = app.indexOf('function SupportModal(', start);
const jsx = transformSync(app.slice(start, end), { loader: 'jsx' }).code;
const icon = () => null;
const CallOverlay = vm.runInNewContext(jsx + '\nCallOverlay', {
  React, Camera: icon, CameraOff: icon, Maximize2: icon, Minimize2: icon,
  Mic: icon, MicOff: icon, Phone: icon, PhoneOff: icon, SwitchCamera: icon,
});

const remoteVideoRef = React.createRef();
const remoteAudioRef = React.createRef();
let toggles = 0;
const props = {
  visible: true, inCall: true, callType: 'video', remoteVideoRef, remoteAudioRef,
  onToggleMinimized: () => toggles++,
};
function find(element, predicate, path = '') {
  if (!React.isValidElement(element)) return undefined;
  if (predicate(element)) return { element, path };
  const children = element.props.children;
  return (Array.isArray(children) ? children : [children])
    .map((child, index) => find(child, predicate, path + '/' + index)).find(Boolean);
}

const full = CallOverlay(props);
const mini = CallOverlay({ ...props, minimized: true });
assert.match(mini.props.className, /is-minimized/);
for (const ref of [remoteVideoRef, remoteAudioRef]) {
  const before = find(full, node => node.props.ref === ref);
  const after = find(mini, node => node.props.ref === ref);
  assert.equal(after.path, before.path, 'minimizing preserves the same media element position and ref');
  assert.equal(after.element.type, before.element.type);
}
const minimize = find(full, node => node.props['aria-label'] === 'Minimize video call and open chat');
const restore = find(mini, node => node.props['aria-label'] === 'Restore full video call');
assert.equal(restore.path, minimize.path, 'the toggle stays mounted so focus is retained');
minimize.element.props.onClick();
restore.element.props.onClick();
assert.equal(toggles, 2);
for (const overrides of [{ callType: 'audio' }, { inCall: false, incoming: { callType: 'audio' } }]) {
  const overlay = CallOverlay({ ...props, ...overrides, minimized: true });
  assert.doesNotMatch(overlay.props.className, /is-minimized/);
  assert.equal(find(overlay, node => node.props.className === 'video-call-size-button'), undefined);
}
const ringing = { ...props, inCall: false, incoming: { callType: 'video' }, answering: false };
assert.ok(find(CallOverlay(ringing), node => node.props['aria-label'] === 'Minimize video call and open chat'),
  'receiver can minimize a ringing video call before tapping Answer');
const ringingMini = CallOverlay({ ...ringing, minimized: true });
assert.match(ringingMini.props.className, /is-minimized/);
assert.match(ringingMini.props.className, /is-ringing/);
for (const label of ['Answer call', 'Decline call']) {
  assert.ok(find(ringingMini, node => node.props['aria-label'] === label), 'call actions remain available');
}
const receiver = { ...props, inCall: false, incoming: { callType: 'video' }, answering: true };
const connectingFull = CallOverlay(receiver);
const connectingMini = CallOverlay({ ...receiver, minimized: true });
assert.ok(find(connectingFull, node => node.props['aria-label'] === 'Minimize video call and open chat'));
assert.match(connectingMini.props.className, /is-minimized/);
assert.equal(find(connectingMini, node => node.props.ref === remoteVideoRef).path,
  find(mini, node => node.props.ref === remoteVideoRef).path, 'receiving video keeps its window when setup completes');
assert.equal(CallOverlay({ ...props, visible: false }), null);
console.log('Call minimization passed: media stays mounted, toggle retains focus, both sides can minimize from ringing through connection, and audio-only calls stay full size.');
