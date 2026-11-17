import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { callTransports, callFailureMessage } from '../src/callSignaling.js';

assert.deepEqual(callTransports('Mozilla Android Instagram 410'), ['polling', 'websocket']);
assert.deepEqual(callTransports('Chrome'), ['websocket', 'polling']);
assert.match(callFailureMessage({ name: 'NotAllowedError' }, 'Instagram'), /Open Sayup in Chrome or Safari/);
assert.match(callFailureMessage({ name: 'NotAllowedError' }, 'Chrome'), /Allow microphone/);

const app = readFileSync('src/App.jsx', 'utf8');
const start = app.indexOf('  const armCallSetupDeadline =');
const end = app.indexOf('  const armConnectionRecovery =', start);
function attempt(peer, cancelled = false) {
  let timeout, deadline, signals = 0, cleaned = 0;
  const alerts = [];
  const callAttemptRef = { current: 1 };
  const schedule = vm.runInNewContext(app.slice(start, end) + '\narmCallSetupDeadline', {
    setTimeout(fn, ms) { timeout = fn; deadline = ms; return 1; },
    callSetupTimerRef: { current: null }, callAttemptRef, pcRef: { current: peer },
    socketRef: { current: { emit(_event, { data }) { assert.equal(data.type, 'hangup'); signals++; } } },
    roomId: 'room', cleanupCall() { cleaned++; },
    window: { alert: message => alerts.push(message) }, navigator: { userAgent: 'Instagram' }, callFailureMessage,
  });
  schedule();
  assert.equal(deadline, 30000);
  if (cancelled) callAttemptRef.current++;
  timeout();
  return { signals, cleaned, alerts };
}
const failed = attempt({ connectionState: 'connecting' });
assert.equal(failed.signals, 1);
assert.equal(failed.cleaned, 1);
assert.match(failed.alerts[0], /Open Sayup in Chrome or Safari/);
assert.equal(attempt({ connectionState: 'connected' }).signals, 0);
assert.equal(attempt({ iceConnectionState: 'completed' }).signals, 0);
assert.equal(attempt({ connectionState: 'connecting' }, true).signals, 0);
console.log('Browser call recovery passed: Instagram transport preference, permission guidance and call-setup deadline.');
