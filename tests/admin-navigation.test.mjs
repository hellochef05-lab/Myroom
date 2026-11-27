import assert from 'node:assert/strict';
import { adminViewFromHash, navigateAdminView } from '../src/adminNavigation.js';

assert.equal(adminViewFromHash(''), 'overview');
assert.equal(adminViewFromHash('#access-alerts'), 'access_alerts');
assert.equal(adminViewFromHash('#closed-support'), 'closed_support');
assert.equal(adminViewFromHash('#constructor'), 'overview');

let href = 'https://example.com/admin?mode=test';
let state = { existing: true };
const calls = [];
const browser = {
  location: { get href() { return href; } },
  history: {
    get state() { return state; },
    pushState(value, _title, url) { state = value; href = String(url); calls.push('push'); },
    replaceState(value, _title, url) { state = value; href = String(url); calls.push('replace'); },
    back() { calls.push('back'); },
  },
};
assert.equal(navigateAdminView(browser, 'access_alerts'), 'access_alerts');
assert.equal(href, 'https://example.com/admin?mode=test#access-alerts');
assert.equal(state.existing, true);
assert.equal(navigateAdminView(browser, 'overview'), null);
assert.deepEqual(calls, ['push', 'back']);

href = 'https://example.com/admin#rooms';
state = null;
assert.equal(navigateAdminView(browser, 'overview'), 'overview', 'a shared detail link returns to its own dashboard');
assert.equal(href, 'https://example.com/admin');
assert.equal(calls.at(-1), 'replace');

// Render the actual dashboard with empty fixture data to check that each
// route replaces the overview and keeps a way back.
const { readFileSync } = await import('node:fs');
const { runInNewContext } = await import('node:vm');
const { transformSync } = await import('esbuild');
const { default: React } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');
const { adminViewTitles } = await import('../src/adminNavigation.js');
const app = readFileSync('src/App.jsx', 'utf8');
const adminSource = app.slice(app.indexOf('const inputClass'), app.indexOf('const ChatMessageActionsContext'));
const compiled = transformSync(adminSource, { loader: 'jsx' }).code;
const renderPage = (section, authenticated = true) => {
  let call = 0;
  const Admin = runInNewContext(compiled + '\nAdminDashboard', {
    React, window: { location: { hash: section === 'overview' ? '' : '#' + section.replaceAll('_', '-') } },
    navigator: { onLine: true },
    useState: (initial) => React.useState(++call === 2 ? authenticated : initial),
    useRef: React.useRef,
    useMemo: React.useMemo,
    useCallback: React.useCallback,
    useEffect: React.useEffect,
    useLayoutEffect: React.useLayoutEffect,
    readLocalJson: (_key, fallback) => fallback,
    adminViewFromHash, adminViewTitles, navigateAdminView,
    adminInputStyle: {},
  });
  return renderToStaticMarkup(React.createElement(Admin, { API_BASE: '', onBack() {} }));
};
const overview = renderPage('overview');
assert.match(overview, /Admin Dashboard/);
assert.match(overview, /Back to App/);
assert.match(overview, /admin-stat-grid/);
assert.doesNotMatch(overview, /admin-detail-panel/);
for (const [view, title] of Object.entries(adminViewTitles)) {
  if (view === 'overview') continue;
  const detail = renderPage(view);
  assert.ok(detail.includes(`${title}</h1>`), view + ' uses its own page heading');
  assert.match(detail, /Back to dashboard/);
  assert.match(detail, /admin-detail-panel/);
  assert.doesNotMatch(detail, /admin-stat-grid/);
}
const locked = renderPage('access_alerts', false);
assert.match(locked, /Enter the Admin PIN/);
assert.doesNotMatch(locked, /admin-detail-panel/);
