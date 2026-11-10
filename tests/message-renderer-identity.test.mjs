import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { transformSync } from 'esbuild';
const source = fs.readFileSync('src/App.jsx', 'utf8');
let code;
if (source.includes('  const MyMessage = (props) => {')) {
  const start = source.indexOf('  const MyMessage = (props) => {');
  const end = source.indexOf('\n  };', start) + 5;
  code = `function renderApp() { ${source.slice(start, end)}; return MyMessage; }`;
} else {
  const start = source.indexOf('function MyMessage(');
  const end = source.indexOf('\nexport default function App()', start);
  assert.ok(start >= 0 && end > start);
  code = source.slice(start, end) + '\nfunction renderApp() { return MyMessage; }';
}
const { renderApp } = vm.runInNewContext(transformSync(code, { loader: 'jsx' }).code + '\n({renderApp})');
assert.equal(renderApp(), renderApp(), 'unrelated App renders must retain the message component type; changing it remounts all message DOM');
console.log('Message renderer identity stays stable across parent updates.');
