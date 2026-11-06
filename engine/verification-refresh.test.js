'use strict';
const assert = require('node:assert/strict');
const { Pool } = require('./pool');
const { usable } = require('./scheduler');
const tick = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };
const settings = { maxAccounts: 5, totalThreads: 2, useTopup: true, keepGoing: false, requireVerified: true };
function setup(page) {
  let time = Date.now();
  const account = { id: 'a', enabled: true, loggedIn: true, threads: 1, loginCheckedAt: time - 360000,
    quota: { pct: 10, checkedAt: time - 360000 }, loginError: '', quotaError: '', verificationError: '' };
  const accounts = { settings, list: () => [account], get: () => account, update: (id, p) => Object.assign(account, p) };
  const pool = new Pool({ accounts, tasks: { list: () => [] }, verifyAccounts: true, now: () => time,
    sleep: async () => {}, pageFor: () => page });
  return { pool, account, now: () => time, advance: n => { time += n; } };
}
(async () => {
  let logins = 0, quotas = 0;
  const s = setup({ login: async () => { logins++; return { loggedIn: true, http: 200 }; }, quota: async () => { quotas++; return { pct: 20 }; } });
  s.pool.pump(); await tick();
  assert.equal(logins, 1); assert.equal(quotas, 1);
  assert.equal(usable(s.account, settings, s.now()), true);
  s.advance(301000); s.pool.pump(); s.pool.pump(); await tick();
  assert.equal(logins, 2); assert.equal(quotas, 2); // Idle refresh, deduplicated.

  const q = setup({ login: async () => ({ loggedIn: true, http: 200 }), quota: async () => null });
  q.account.quota.checkedAt = q.now(); q.account.loginCheckedAt = q.now();
  await q.pool.refreshQuota('a'); const quotaError = q.account.quotaError;
  await q.pool.checkLogin('a', 1);
  assert.equal(q.account.quotaError, quotaError); assert.ok(q.account.verificationError);
  assert.equal(usable(q.account, settings, q.now()), false);

  const network = setup({ login: async () => { throw new Error('ETIMEDOUT'); }, quota: async () => ({ pct: 10 }) });
  await network.pool.checkLogin('a', 1);
  assert.equal(network.account.loggedIn, true); assert.equal(network.account.loginError, 'ETIMEDOUT');
  await network.pool.refreshQuota('a'); assert.equal(network.account.loginError, 'ETIMEDOUT');
  assert.equal(usable(network.account, settings, network.now()), false);

  const auth = setup({ login: async () => ({ loggedIn: false, http: 401 }) });
  await auth.pool.checkLogin('a', 1); assert.equal(auth.account.loggedIn, false);
  const loading = setup({ login: async () => ({ loggedIn: false, http: 200 }) });
  await loading.pool.checkLogin('a', 1); assert.equal(loading.account.loggedIn, true); assert.ok(loading.account.loginError);

  let attempts = 0;
  const backoff = setup({ login: async () => { attempts++; throw new Error('offline'); } });
  backoff.pool.pump(); await tick(); const afterFirst = attempts;
  backoff.pool.pump(); await tick(); assert.equal(attempts, afterFirst);
  backoff.advance(60001); backoff.pool.pump(); await tick(); assert.ok(attempts > afterFirst);
  const skip = setup({ login: async () => { throw new Error('Must not run'); } });
  skip.account.enabled = false; skip.pool.pump(); await tick(); assert.equal(skip.account.loginError, '');
  console.log('Verification refresh: idle expiry, deduplication, independent errors, timeout/session preservation, 401, loading, retry backoff, disabled skip PASS');
})().catch(e => { console.error(e); process.exitCode = 1; });
