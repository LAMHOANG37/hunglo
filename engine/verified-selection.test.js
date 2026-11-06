'use strict';
const assert = require('node:assert/strict');
const { Pool } = require('./pool');
const { usable, needsCheck } = require('./scheduler');
const { parseResult } = require('./muse-page');
const now = Date.now();
const tick = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r)); };
const fresh = { pct: 10, checkedAt: now, resetsAt: now + 86400000, topupLeft: 0 };
const settings = { totalThreads: 1, maxAccounts: 5, useTopup: false, keepGoing: false, requireVerified: true };
const acc = (id, extra = {}) => ({ id, name: id, enabled: true, threads: 1, loggedIn: true, lastUsedAt: 0, quota: null, ...extra });
function setup(data, page) {
  const tasksData = [{ id: 'v', kind: 'video', status: 'queued', attempts: 0, images: [], createdAt: now, prompt: 'unchanged' }];
  const accounts = { settings, list: () => data, get: id => data.find(a => a.id === id), update: (id, p) => Object.assign(data.find(a => a.id === id), p) };
  const tasks = { list: () => tasksData, get: id => tasksData.find(t => t.id === id), update: (id, p) => Object.assign(tasksData.find(t => t.id === id), p) };
  const calls = [];
  const pool = new Pool({ accounts, tasks, verifyAccounts: true, pageFor: page,
    now: () => now, sleep: async () => {}, gap: () => 0, config: () => ({ maxAttempts: 2 }),
    run: async (t, d) => { calls.push(d.accountId); return ['new.mp4']; }
  });
  return { pool, calls, tasksData };
}
(async () => {
  // Stale quota no longer means ready; explicit refresh after reset is required.
  const old = acc('old', { loginCheckedAt: now, quota: { ...fresh, pct: 100, resetsAt: now - 1000, checkedAt: now - 2000 } });
  assert.equal(needsCheck(old, now), true);
  assert.equal(usable(old, settings, now), false);
  assert.equal(usable(acc('fresh', { loginCheckedAt: now, quota: fresh }), settings, now), true);

  // Check all enabled candidates, reject logged-out and quota failures, automatically choose b.
  const data = [acc('a'), acc('b'), acc('c'), acc('off', { enabled: false })];
  const loginCalls = [], quotaCalls = [];
  const s = setup(data, id => ({ login: async () => { loginCalls.push(id); return { loggedIn: id !== 'a' }; },
    quota: async () => { quotaCalls.push(id); return id === 'b' ? fresh : null; } }));
  s.pool.pump(); await tick();
  assert.deepEqual(s.calls, ['b']); assert.equal(s.tasksData[0].status, 'succeeded');
  assert.ok(!loginCalls.includes('off')); assert.ok(!quotaCalls.includes('a'));
  assert.ok(data.find(a => a.id === 'c').verificationError);

  // All verification attempts fail: task waits, no generation and no immediate retry loop.
  let checks = 0;
  const blocked = setup([acc('x'), acc('y')], () => ({ login: async () => { checks++; return { loggedIn: true }; }, quota: async () => null }));
  blocked.pool.pump(); await tick(); blocked.pool.pump(); await tick();
  assert.equal(checks, 2); assert.deepEqual(blocked.calls, []); assert.equal(blocked.tasksData[0].status, 'queued');

  // Snapshot excludes old response AND any old media path repeated in a changed response.
  const oldEvent = { text: 'old', images: [], videos: [{ path: 'old.mp4', mime: 'video/mp4', byte_len: 5 }] };
  const refusal = { text: 'Daily video limit reached', images: [], videos: [] };
  assert.deepEqual(parseResult([oldEvent, refusal], [JSON.stringify(oldEvent)]), { files: [], text: refusal.text });
  const editedOld = { ...oldEvent, text: 'edited old response' };
  assert.deepEqual(parseResult([editedOld, refusal], [JSON.stringify(oldEvent)]).files, []);
  const newEvent = { text: 'new', images: [], videos: [{ path: 'new.mp4', mime: 'video/mp4', byte_len: 8 }] };
  assert.deepEqual(parseResult([oldEvent, newEvent], [JSON.stringify(oldEvent)]).files.map(f => f.path), ['new.mp4']);
  console.log('Verified selection: auto-check, stale reset, disabled/logged-out skip, quota failure waiting, no spin, old-media isolation PASS');
})().catch(e => { console.error(e); process.exitCode = 1; });
