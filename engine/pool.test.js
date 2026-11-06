// Chạy: node engine/pool.test.js — store thật (thư mục tạm), Muse giả.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const TaskStore = require('./task-store');
const { AccountStore } = require('./accounts');
const { Pool } = require('./pool');

const tick = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const deferred = () => { let resolve, reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };
const out = { pct: 100, resetsAt: Date.now() + 86400e3, status: 'SUFFICIENT', topupLeft: 0 };

function setup({ accounts = ['default'], settings = {}, quota = () => null, login = () => true, skip } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mss-pool-'));
  const tasks = new TaskStore(dir);
  const accs = new AccountStore(dir);
  for (const id of accounts.slice(1)) accs.accounts.push({ ...accs.list()[0], id, name: id });
  if (accounts[0] !== 'default') accs.accounts[0] = { ...accs.list()[0], id: accounts[0], name: accounts[0] };
  accs.setSettings({ maxAccounts: 5, totalThreads: 5, ...settings });
  const runs = [], cancels = [], files = [];
  const page = id => ({ id, login: async () => ({ loggedIn: login(id) }), quota: async () => quota(id), cancel: async sid => cancels.push([id, sid]) });
  const pages = new Map();
  const pool = new Pool({
    tasks, accounts: accs, onFiles: f => files.push(...f), sleep: async () => {}, skip,
    pageFor: id => pages.get(id) || pages.set(id, page(id)).get(id),
    config: () => ({ outputDir: dir, maxAttempts: 2, limits: { image: 5, video: 30 } }),
    loadImage: async () => ({}), gap: () => 60e3,
    run: (task, d) => { const r = { task, d, ...deferred() }; runs.push(r); return r.p; }
  });
  return { dir, tasks, accs, pool, runs, cancels, files, done: () => setTimeout(() => { tasks.flush(); accs.flush(); fs.rmSync(dir, { recursive: true, force: true }); }, 400) };
}

(async () => {
  // 2 TK, 2 task → chạy song song mỗi TK 1 task; xong → succeeded, báo file
  {
    const s = setup({ accounts: ['default', 'b'] });
    const t1 = s.tasks.add({ prompt: '1' }), t2 = s.tasks.add({ prompt: '2' });
    t2.createdAt = t1.createdAt + 1;
    s.pool.pump();
    await tick();
    assert.strictEqual(s.runs.length, 2);
    assert.deepStrictEqual(s.runs.map(r => r.d.page.id).sort(), ['b', 'default']);
    assert.strictEqual(s.tasks.get(t1.id).status, 'processing');
    assert.strictEqual(s.tasks.get(t1.id).attempts, 1);
    assert.ok(s.tasks.get(t1.id).accountId);
    assert.deepStrictEqual(s.runs[0].d.limits, { image: 5, video: 30 });
    // task 1 lỗi → task 2 vẫn chạy, running dọn đúng
    s.runs.find(r => r.task.id === t1.id).reject(new Error('mất tab'));
    await tick();
    assert.strictEqual(s.pool.running.size, 1 + (s.tasks.get(t1.id).status === 'processing' ? 1 : 0));
    assert.ok(s.pool.running.has(t2.id));
    s.runs.find(r => r.task.id === t2.id).resolve(['/x/a.mp4']);
    await tick();
    assert.strictEqual(s.tasks.get(t2.id).status, 'succeeded');
    assert.deepStrictEqual(s.files, ['/x/a.mp4']);
    assert.ok(s.accs.get(s.tasks.get(t2.id).accountId).lastUsedAt > 0);
    s.done();
  }

  // Muse không nhận lệnh + TK hết hạn mức → task về hàng đợi, không tốn lượt, TK nghỉ, TK khác nhận
  {
    const s = setup({ accounts: ['a', 'b'], settings: { totalThreads: 1 }, quota: id => (id === 'a' ? out : { pct: 10 }) });
    s.accs.update('b', { enabled: false });
    const t = s.tasks.add({ prompt: 'x' });
    s.pool.pump();
    await tick();
    assert.strictEqual(s.runs[0].d.page.id, 'a');
    s.runs[0].reject(new Error('Muse không nhận lệnh: quota'));
    await tick(10);
    const tt = s.tasks.get(t.id);
    assert.strictEqual(tt.status, 'queued');
    assert.strictEqual(tt.attempts, 0);
    assert.strictEqual(tt.accountId, '');
    assert.match(tt.error, /hết hạn mức/);
    assert.strictEqual(s.accs.get('a').quota.pct, 100);
    assert.strictEqual(s.runs.length, 1); // không gửi lại vào TK đang nghỉ
    s.accs.update('b', { enabled: true });
    s.pool.pump();
    await tick();
    assert.strictEqual(s.runs[1].d.page.id, 'b');
    s.done();
  }

  // Muse không nhận lệnh nhưng còn hạn mức → thử lại theo failurePatch
  {
    const s = setup({ quota: () => ({ pct: 10 }) });
    const t = s.tasks.add({ prompt: 'x' });
    const errors = [];
    s.tasks.on('update', u => u.error && errors.push(u.error));
    s.pool.pump();
    await tick();
    s.runs[0].reject(new Error('Muse không nhận lệnh: not_ready'));
    await tick(10);
    assert.ok(errors.some(e => /Lỗi lần 1, đang thử lại/.test(e)));
    assert.strictEqual(s.runs.length, 2); // chạy lại lượt 2
    assert.strictEqual(s.tasks.get(t.id).attempts, 2);
    s.done();
  }

  // TK chưa đăng nhập → đánh dấu, task về hàng đợi không tốn lượt, không chạy lại trên TK đó
  {
    const s = setup({ login: () => false });
    const t = s.tasks.add({ prompt: 'x' });
    s.pool.pump();
    await tick(10);
    assert.strictEqual(s.runs.length, 0);
    assert.strictEqual(s.accs.get('default').loggedIn, false);
    assert.strictEqual(s.tasks.get(t.id).status, 'queued');
    assert.strictEqual(s.tasks.get(t.id).attempts, 0);
    s.done();
  }

  // Task dở từ Đợt 1 (không accountId, có sessionId) → dò tiếp trên default, giữ phiên
  {
    const s = setup({ accounts: ['default', 'b'] });
    const t = s.tasks.add({ prompt: 'x' });
    s.tasks.update(t.id, { status: 'processing', sessionId: 's9', attempts: 1, startedAt: 5 });
    s.pool.pump();
    await tick();
    assert.strictEqual(s.runs[0].d.page.id, 'default');
    assert.strictEqual(s.runs[0].task.sessionId, 's9');
    assert.strictEqual(s.tasks.get(t.id).attempts, 1);
    assert.strictEqual(s.tasks.get(t.id).startedAt, 5);
    // huỷ đúng phiên trên đúng TK
    s.pool.cancel(t.id);
    assert.strictEqual(s.tasks.get(t.id).status, 'cancelled');
    await tick();
    assert.deepStrictEqual(s.cancels, [['default', 's9']]);
    s.runs[0].resolve(null);
    await tick();
    assert.strictEqual(s.tasks.get(t.id).status, 'cancelled');
    s.done();
  }

  // Xoá TK: task dở của nó về hàng đợi (bỏ phiên), không kẹt processing; đang chạy thì không cho xoá
  {
    const s = setup({ accounts: ['default', 'b'] });
    const t = s.tasks.add({ prompt: 'x' });
    s.tasks.update(t.id, { status: 'processing', sessionId: 's1', accountId: 'b' });
    assert.strictEqual(s.pool.busy('b'), 0);
    s.pool.releaseAccount('b');
    assert.strictEqual(s.tasks.get(t.id).status, 'queued');
    assert.strictEqual(s.tasks.get(t.id).sessionId, '');
    s.pool.pump();
    await tick();
    assert.strictEqual(s.pool.busy(s.runs[0].d.page.id), 1);
    s.done();
  }

  // refreshQuota lưu vào TK; trang không đọc được (null) → giữ số cũ
  {
    let q = { pct: 42 };
    const s = setup({ quota: () => q });
    await s.pool.refreshQuota('default');
    assert.strictEqual(s.accs.get('default').quota.pct, 42);
    q = null;
    await s.pool.refreshQuota('default');
    assert.strictEqual(s.accs.get('default').quota.pct, 42);
    s.done();
  }
  // Dự án tạm dừng: task chờ của nó không được chạy; task dự án khác vẫn chạy
  {
    let paused = new Set(['p1']);
    const s = setup({ skip: t => paused.has(t.project) });
    const a = s.tasks.add({ prompt: 'a', project: 'p1' });
    const b = s.tasks.add({ prompt: 'b', project: 'p2' });
    s.tasks.update(a.id, { createdAt: 1 }); // a cũ hơn → bình thường sẽ chạy trước
    s.pool.pump();
    await tick();
    assert.deepStrictEqual(s.runs.map(r => r.task.id), [b.id]);
    assert.strictEqual(s.tasks.get(a.id).status, 'queued');
    paused = new Set();
    s.runs[0].resolve(['/x/b.mp4']);
    await tick(10);
    assert.strictEqual(s.runs[1]?.task.id, a.id);
    s.done();
  }
  // Gửi xong 1 task → task sau trên cùng TK nghỉ đủ khoảng giãn rồi mới gửi
  {
    const s = setup({ accounts: ['default'] });
    const naps = [];
    s.pool.sleep = async ms => { if (ms > 3000) naps.push(ms); };
    const a = s.tasks.add({ prompt: 'a' });
    s.pool.pump();
    await tick();
    assert.deepStrictEqual(naps, []); // TK chưa gửi gì → gửi luôn
    const b = s.tasks.add({ prompt: 'b' });
    s.runs[0].resolve(['/x/a.mp4']);
    await tick(10);
    assert.strictEqual(s.runs[1]?.task.id, b.id);
    assert.ok(naps.length === 1 && naps[0] > 55e3 && naps[0] <= 60e3, String(naps));
    s.done();
  }
  // checkLogin: người dùng đóng Chrome sau lần dò đầu → thôi dò, không gọi login() (không mở lại Chrome)
  {
    const s = setup({ accounts: ['default'] });
    let calls = 0;
    const pg = { chrome: { running: true }, login: async () => { calls++; pg.chrome.running = false; return { loggedIn: false }; } };
    s.pool.pageFor = () => pg;
    assert.strictEqual(await s.pool.checkLogin('default'), false);
    assert.strictEqual(calls, 1);
    s.done();
  }
  console.log('pool.test OK');
})().catch(e => { console.error(e); process.exit(1); });
