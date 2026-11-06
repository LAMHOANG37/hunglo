'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { PAGE_SCRIPT, parseQuota } = require('./muse-page');
const { usable } = require('./scheduler');
const payload = { visibleQuota: true, pct: 100, topupUsed: 100, resetLabel: '7 Nov', tokenLabel: '0', tier: 'Muse Free' };
const q = parseQuota(payload);
assert.equal(q.pct, 100); assert.equal(q.topupLeft, 0); assert.equal(q.tokenLabel, '0');
assert.equal(q.source, 'settings-ui'); assert.equal(q.resetsAtApprox, true);
assert.equal(parseQuota({ ...payload, pct: NaN }), null);
const settings = { useTopup: true, keepGoing: false, requireVerified: true };
assert.equal(usable({ enabled: true, loggedIn: true, loginCheckedAt: Date.now(), quota: q }, settings, Date.now()), false);
assert.equal(parseQuota({ ...payload, topupUsed: 42, tokenLabel: '577.29 million' }).topupLeft, .58);

(async () => {
  let opened = false, menuOpen = false, closed = 0;
  const button = (name, click) => ({ innerText: name, getAttribute: k => k === 'aria-label' ? name : null, click });
  const settingsBtn = button('Settings', () => { menuOpen = true; });
  const item = button('Settings Ctrl+,', () => { opened = true; menuOpen = false; });
  const close = button('Close', () => { opened = false; closed++; });
  const dialog = { innerText: 'Settings\nGeneral\nUsage\nFree plan\n100% used\nWeekly limit resets on 7 Nov\nAdditional tokens\nNever expires\n100% used (0 tokens left)',
    querySelectorAll: s => s === 'button' ? [close] : [] };
  const document = { querySelectorAll: s => s === '[role="dialog"]' ? (opened ? [dialog] : [])
    : s === 'button' ? [settingsBtn] : s === '[role="menuitem"]' ? (menuOpen ? [item] : []) : [] };
  const ctx = { window: {}, document, setTimeout: f => f() };
  vm.runInNewContext(PAGE_SCRIPT, ctx);
  const actual = await ctx.window.__mss.quota();
  assert.equal(actual.visibleQuota, true); assert.equal(actual.pct, 100); assert.equal(actual.topupUsed, 100); assert.equal(actual.tokenLabel, '0');
  assert.equal(closed, 1); assert.equal(opened, false);
  opened = true;
  await ctx.window.__mss.quota(); assert.equal(closed, 1); assert.equal(opened, true);
  console.log('Visible Muse quota: exact sample, auto Settings navigation, close owned dialog, preserve user dialog, exhausted-account exclusion PASS');
})().catch(e => { console.error(e); process.exitCode = 1; });
