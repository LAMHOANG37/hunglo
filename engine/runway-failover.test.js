'use strict';
const assert = require('node:assert/strict');
const { isRunwayUnavailable, videoAvailabilityError } = require('./video-limit');
const { Pool } = require('./pool');
const { runTask } = require('./muse-runner');
const reply = 'I re-checked Runway just now. It again reports not connected, so no generation was submitted.';
for (const text of [reply, 'Runway is unavailable.', 'Công cụ Runway chưa kết nối.', 'Runway API error 503', 'Runway đang lỗi máy chủ.']) assert.equal(isRunwayUnavailable(text), true, text);
for (const text of ['Runway generated your video.', 'Runway has no connection error.', 'Runway is no longer unavailable.', 'Network timeout while downloading video.', 'Runway rejected the prompt for content policy.', 'Runway không còn bị lỗi.']) assert.equal(isRunwayUnavailable(text), false, text);
assert.equal(videoAvailabilityError(reply).code, 'MUSE_RUNWAY_UNAVAILABLE');
const now = Date.now();
const tick = async () => { for (let i = 0; i < 25; i++) await new Promise(r => setImmediate(r)); };
(async () => {
  const page = { send: async () => ({ ok: true, sessionId: 's' }), status: async () => 'completed', result: async () => ({ files: [], text: reply }) };
  const task = { id: 'v', kind: 'video', prompt: 'original', images: [{ imageLocalPath: 'ref.png' }], attempts: 0, createdAt: now, startedAt: now, status: 'queued' };
  await assert.rejects(runTask({ ...task, images: [] }, { page, update() {}, isLive: () => true, sleep: async () => {}, now: () => now, limits: { video: 30 } }), e => e.code === 'MUSE_RUNWAY_UNAVAILABLE');
  const data = ['a','b','off'].map(id => ({ id, name: id, enabled: id !== 'off', loggedIn: true, threads: 1, lastUsedAt: 0 }));
  const accounts = { settings: { totalThreads: 1, maxAccounts: 5 }, list: () => data, get: id => data.find(a => a.id === id), update: (id,p) => Object.assign(data.find(a => a.id === id),p) };
  const tasks = { list: () => [task], get: () => task, update: (id,p) => Object.assign(task,p) };
  const calls=[];
  const pool = new Pool({ accounts, tasks, pageFor: () => ({ login: async () => ({ loggedIn: true }), quota: async () => null }), gap: () => 0,
    config: () => ({ maxAttempts: 2 }), run: async (t,d) => { calls.push(d.accountId); throw videoAvailabilityError(reply); } });
  pool.pump(); await tick();
  assert.deepEqual(calls,['a','b']); assert.equal(task.status,'queued'); assert.equal(task.attempts,0);
  assert.equal(task.prompt,'original'); assert.equal(task.images[0].imageLocalPath,'ref.png');
  assert.equal(data[0].videoDailyLimit.kind,'runway'); assert.equal(data[1].videoDailyLimit.kind,'runway');
  assert.equal(data[2].videoDailyLimit,undefined); assert.equal(pool.running.size,0);
  console.log('Runway detection and failover: exact refusal, false positives, runner typing, enabled-only rotation, preserved input, all-blocked queue PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
