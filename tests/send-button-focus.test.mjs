import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

test('tapping the room Send button preserves composer focus and sends once', () => {
  const app = fs.readFileSync('src/App.jsx', 'utf8');
  const componentName = app.match(/<Channel\b[^>]*\bSendButton=\{(\w+)\}/)?.[1];
  const source = componentName && app.match(new RegExp(`^function ${componentName}\\(.*?^}`, 'ms'))?.[0];
  const ownerDocument = {};
  const composer = { ownerDocument };
  const anotherInput = {};
  const useMessageInputContext = () => ({ textareaRef: { current: composer } });
  const { code } = source ? transformSync(source, { loader: 'jsx' }) : { code: '' };
  const button = source ? vm.runInNewContext(`${code}\n${componentName}`, {
    useMessageInputContext,
    StreamSendButton: Symbol('SDK Send button'),
    React: { createElement: (_component, props) => props },
  }) : {};
  let sends = 0;
  const props = source ? button({ sendMessage: () => { sends++; } }) : button;
  const press = (handler, activeElement, button = 0) => {
    ownerDocument.activeElement = activeElement;
    let prevented = false;
    handler?.({ button, preventDefault() { prevented = true; } });
    return prevented;
  };

  assert.equal(press(props.onPointerDown, composer), true, 'touch cannot move focus away');
  assert.equal(press(props.onMouseDown, composer), true, 'mouse fallback preserves focus');
  assert.equal(press(props.onPointerDown, anotherInput), false, 'does not alter focus when the composer is inactive');
  assert.equal(press(props.onPointerDown, composer, 2), false, 'does not interfere with secondary clicks');
  props.sendMessage();
  assert.equal(sends, 1);
});
