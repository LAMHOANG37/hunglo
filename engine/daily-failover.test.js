'use strict';
const assert = require('node:assert/strict');
const { Pool } = require('./pool');
const { plan } = require('./scheduler');
const { runTask } = require('./muse-runner');
const { dailyVideoLimitError } = require('./video-limit');
const tick = async () => { for (let i = 0; i < 15; i++) await new Promise(r => setImmediate(r)); };
const refusal = 'Tài khoản vẫn đang chạm giới hạn tạo video trong 24 giờ qua';
const now = Date.now();
const settings = { totalThreads: 1, maxAccounts: 5, useTopup: true, keepGoing: true };
const account = id => ({ id, name: id, enabled: true, loggedIn: true, threads: 1, lastUsedAt: 0, quota: { pct: 100, topupLeft: .8 } });

(async () => {
  // Actual runner: a refusal is typed; a refusal must not turn image jobs into video blocks.
  const page = { send: async () => ({ ok: true, sessionId: 's' }), status: async () => 'completed', result: async () => ({ files: [], text: refusal }) };
  const baseTask = { id: 't', kind: 'video', images: [], prompt: 'original', startedAt: now, attempts: 1, sessionId: '' };
  const deps = { page, update() {}, isLive: () => true, sleep: async () => {}, now: () => now, limits: { video: 30, image: 5 } };
  await assert.rejects(runTask(baseTask, deps), e => e.code === 'MUSE_DAILY_VIDEO_LIMIT');
  await assert.rejects(runTask({ ...baseTask, kind: 'image' }, deps), e => e.code !== 'MUSE_DAILY_VIDEO_LIMIT');

  const a = account('a'), b = account('b');
  const data = [a, b];
  const accounts = { settings, list: () => data, get: id => data.find(x => x.id === id), update: (id, patch) => Object.assign(data.find(x => x.id === id), patch) };
  const task = { ...baseTask, status: 'queued', attempts: 0, thread: 'https://muse.ai/thread/old', pin: 'a', createdAt: now, images: [{ imageLocalPath: 'reference.png' }] };
  const tasks = { list: () => [task], get: () => task, update: (id, patch) => Object.assign(task, patch) };
  const calls = [];
  const pool = new Pool({ tasks, accounts, pageFor: () => ({ login: async () => ({ loggedIn: true }), quota: async () => null }),
    config: () => ({ maxAttempts: 2 }), gap: () => 0,
    run: async (t, d) => { calls.push(d.accountId); if (d.accountId === 'a') throw dailyVideoLimitError(refusal); return ['video.mp4']; }
  });
  pool.pump(); await tick();
  assert.deepEqual(calls, ['a', 'b']);
  assert.equal(task.status, 'succeeded');
  assert.equal(task.prompt, 'original');
  assert.deepEqual(task.images, [{ imageLocalPath: 'reference.png' }]);
  assert.equal(task.thread, ''); assert.equal(task.pin, '');
  assert.equal(task.attempts, 1); assert.ok(a.videoDailyLimit);

  // No eligible accounts: keep queued, no automatic return to the refused account.
  a.videoDailyLimit = { detectedAt: now }; b.enabled = false;
  const schedule = kind => plan({ tasks: [{ id: 'q', kind, status: 'queued', createdAt: now }], accounts: data, settings, running: new Map(), now });
  assert.deepEqual(schedule('video'), []);
  assert.deepEqual(schedule('image'), []);
  console.log('Daily failover: runner detection, cross-account retry, preserved inputs, image eligibility and all-blocked queue passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
