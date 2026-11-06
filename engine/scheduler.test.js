// Chạy: node engine/scheduler.test.js
const assert = require('assert');
const { weeklyOut, usable, pausedUntil, plan } = require('./scheduler');

const NOW = 1e12;
const S = (o = {}) => ({ maxAccounts: 5, totalThreads: 10, mode: 'rotate', useTopup: true, keepGoing: false, ...o });
const acc = (id, o = {}) => ({ id, name: id, enabled: true, threads: 1, loggedIn: true, quota: null, lastUsedAt: 0, ...o });
const task = (id, o = {}) => ({ id, status: 'queued', sessionId: '', accountId: '', createdAt: 0, held: false, ...o });
const out = { pct: 100, resetsAt: NOW + 86400e3, status: 'SUFFICIENT', topupLeft: 0 };
const pairs = r => r.map(p => `${p.taskId}>${p.accountId}`);
const run = (tasks, accounts, settings = S(), running = new Map()) => pairs(plan({ tasks, accounts, settings, running, now: NOW }));

// weeklyOut
assert.strictEqual(weeklyOut({ pct: 100 }), true);
assert.strictEqual(weeklyOut({ pct: 50, status: 'SUFFICIENT' }), false);
assert.strictEqual(weeklyOut({ pct: 50, status: 'LOW' }), false);
assert.strictEqual(weeklyOut({ pct: 50, status: 'QUOTA_EXHAUSTED' }), true);
assert.strictEqual(weeklyOut(null), false);

// usable
assert.strictEqual(usable(acc('a', { enabled: false }), S(), NOW), false);
assert.strictEqual(usable(acc('a', { loggedIn: false }), S(), NOW), false);
assert.strictEqual(usable(acc('a', { loggedIn: null }), S(), NOW), true);
assert.strictEqual(usable(acc('a', { quota: { ...out, topupLeft: 0.5 } }), S(), NOW), true);
assert.strictEqual(usable(acc('a', { quota: { ...out, topupLeft: 0.5 } }), S({ useTopup: false }), NOW), false);
assert.strictEqual(usable(acc('a', { quota: out }), S(), NOW), false);
assert.strictEqual(usable(acc('a', { quota: out }), S({ keepGoing: true }), NOW), true);
assert.strictEqual(usable(acc('a', { quota: { ...out, resetsAt: NOW - 1 } }), S(), NOW), true);
assert.strictEqual(pausedUntil(acc('a', { quota: out }), S(), NOW), out.resetsAt);
assert.strictEqual(pausedUntil(acc('a'), S(), NOW), 0);

// 3 task, 2 TK 1 luồng → 2 cặp khác TK, task cũ nhất trước (store: mới nhất ở đầu)
const t3 = [task('t3', { createdAt: 3 }), task('t2', { createdAt: 2 }), task('t1', { createdAt: 1 })];
assert.deepStrictEqual(run(t3, [acc('a'), acc('b')], S({ totalThreads: 2 })), ['t1>a', 't2>b']);
// tổng luồng
assert.deepStrictEqual(run(t3, [acc('a'), acc('b')], S({ totalThreads: 1 })), ['t1>a']);
// 1 TK 2 luồng
assert.deepStrictEqual(run(t3, [acc('a', { threads: 2 })]), ['t1>a', 't2>a']);
// đang chạy sẵn 1 task trên a → còn 1 luồng
assert.deepStrictEqual(run(t3, [acc('a', { threads: 2 })], S(), new Map([['x', 'a']])), ['t1>a']);
// tổng luồng tính cả task đang chạy
assert.deepStrictEqual(run(t3, [acc('a', { threads: 5 })], S({ totalThreads: 2 }), new Map([['x', 'a']])), ['t1>a']);
// maxAccounts 1
assert.deepStrictEqual(run(t3, [acc('a'), acc('b')], S({ maxAccounts: 1 })), ['t1>a']);
// maxAccounts 1, a đã bận hết luồng → b không được nhận
assert.deepStrictEqual(run(t3, [acc('a'), acc('b')], S({ maxAccounts: 1 }), new Map([['x', 'a']])), []);

// task dở về đúng TK, kể cả TK đó hết hạn mức; đi trước task chờ
const dở = task('d', { status: 'processing', sessionId: 's', accountId: 'b', createdAt: 9 });
assert.deepStrictEqual(run([task('q', { createdAt: 1 }), dở], [acc('a'), acc('b', { quota: out })]), ['d>b', 'q>a']);
assert.deepStrictEqual(run([dở], [acc('a'), acc('b', { enabled: false })]), []);
// task dở Đợt 1 không có accountId → default
assert.deepStrictEqual(run([task('d', { status: 'processing', sessionId: 's' })], [acc('a'), acc('default')]), ['d>default']);
// task dở đang chạy trong app → bỏ qua
assert.deepStrictEqual(run([dở], [acc('b')], S(), new Map([['d', 'b']])), []);
// processing không sessionId (đang gửi) → không đụng
assert.deepStrictEqual(run([task('p', { status: 'processing' })], [acc('a')]), []);

// held, đã kết thúc → bỏ qua
assert.deepStrictEqual(run([task('h', { held: true }), task('f', { status: 'failed' })], [acc('a')]), []);

// rotate: chọn TK % thấp hơn; cùng % → lâu chưa dùng
assert.deepStrictEqual(run([task('t')], [acc('a', { quota: { pct: 80 } }), acc('b', { quota: { pct: 10 } })]), ['t>b']);
assert.deepStrictEqual(run([task('t')], [acc('a', { lastUsedAt: 5 }), acc('b', { lastUsedAt: 1 })]), ['t>b']);
// rotate: TK ít bận hơn trước
assert.deepStrictEqual(run([task('t')], [acc('a', { threads: 3 }), acc('b', { threads: 3, quota: { pct: 90 } })], S(), new Map([['x', 'a']])), ['t>b']);
// sequential: lấp TK đầu trước
assert.deepStrictEqual(run(t3, [acc('a', { threads: 2 }), acc('b', { threads: 2 })], S({ mode: 'sequential' })), ['t1>a', 't2>a', 't3>b']);
// TK hết hạn mức bị bỏ qua → TK còn hạn mức nhận việc
assert.deepStrictEqual(run([task('t')], [acc('a', { quota: out }), acc('b', { quota: { pct: 99 } })], S({ mode: 'sequential' })), ['t>b']);
// không TK nào dùng được
assert.deepStrictEqual(run([task('t')], [acc('a', { loggedIn: false })]), []);
// chat cũ thuộc TK b → chờ đúng b (b bận thì task khác vẫn chạy); b hết dùng được → TK khác làm
const th = o => task('v', { thread: 'https://muse.ai/thread/x', pin: 'b', ...o });
assert.deepStrictEqual(run([th(), task('t')], [acc('a'), acc('b')]), ['v>b', 't>a']);
assert.deepStrictEqual(run([th(), task('t')], [acc('a'), acc('b')], S(), new Map([['x', 'b']])), ['t>a']);
assert.deepStrictEqual(run([th()], [acc('a'), acc('b', { loggedIn: false })]), ['v>a']);

console.log('scheduler.test OK');
