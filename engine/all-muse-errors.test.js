'use strict';
const assert = require('node:assert/strict');
const { Pool } = require('./pool');
const { runTask } = require('./muse-runner');
const { usable } = require('./scheduler');
const { AccountStore } = require('./accounts');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const now = Date.now();
const tick = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };
const reply = 'Dhanteras 041 vẫn chưa tạo được. Runway Free cũng không có model video. Đã lưu vào hàng chờ.';
const base = { id: 'v', kind: 'video', prompt: 'original', images: [], attempts: 0, createdAt: now, startedAt: now, status: 'queued' };
const deps = page => ({ page, update() {}, isLive: () => true, sleep: async () => {}, now: () => now, limits: { video: 30, image: 5 } });
(async () => {
  const page = { send: async () => ({ ok: true, sessionId: 's' }), status: async () => 'completed', result: async () => ({ files: [], text: reply }) };
  await assert.rejects(runTask({ ...base }, deps(page)), e => e.museResult === true);
  await assert.rejects(runTask({ ...base, kind: 'image' }, deps({ ...page, result: async () => ({ files: [], text: 'Không tạo được ảnh vì công cụ đang lỗi.' }) })), e => e.museResult === true);
  await assert.rejects(runTask({ ...base }, deps({ ...page, send: async () => ({ ok: false, reason: 'Unrecognized service error' }) })), e => e.museResult === true);
  await assert.rejects(runTask({ ...base, images: [{}] }, { ...deps(page), loadImage: async () => { throw new Error('Local image missing'); } }), e => !e.museResult);
  for (const kind of ['video', 'image']) {
    const data = ['a','b','off'].map(id => ({ id, name: id, enabled: id !== 'off', loggedIn: true, threads: 1, lastUsedAt: 0 }));
    const accounts = { settings: { totalThreads: 1, maxAccounts: 5 }, list: () => data, get: id => data.find(a => a.id === id), update: (id,p) => Object.assign(data.find(a => a.id === id),p) };
    const task = { ...base, kind, images: [{ imageLocalPath: 'ref.png' }], thread: 'https://muse.ai/thread/old', pin: 'a' };
    const tasks = { list: () => [task], get: () => task, update: (id,p) => Object.assign(task,p) };
    const calls=[];
    const pool = new Pool({ accounts, tasks, pageFor: () => ({ login: async () => ({ loggedIn: true }), quota: async () => null }), gap: () => 0,
      config: () => ({ maxAttempts: 2 }), run: async (t,d) => { calls.push(d.accountId); throw Object.assign(new Error(reply), { museResult: true }); } });
    pool.pump(); await tick();
    assert.deepEqual(calls,['a','b']); assert.equal(task.status,'queued'); assert.equal(task.attempts,0);
    assert.equal(task.prompt,'original'); assert.equal(task.images[0].imageLocalPath,'ref.png'); assert.equal(task.thread,''); assert.equal(task.pin,'');
    assert.equal(data[0].videoDailyLimit.kind,'muse'); assert.equal(data[2].videoDailyLimit,undefined);
    assert.equal(usable(data[0],accounts.settings,now,'image'),false);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'lammuse-muse-error-'));
  const st = new AccountStore(dir); st.update('default', { videoDailyLimit: { kind: 'muse', detectedAt: now, reason: reply } }); st.flush();
  assert.equal(new AccountStore(dir).get('default').videoDailyLimit.kind,'muse');
  fs.rmSync(dir,{recursive:true,force:true});
  console.log('All Muse failures: arbitrary refusal, missing output, image failure, rejected send, local error separation, account rotation, waiting and persistence PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
