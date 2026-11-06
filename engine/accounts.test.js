// Chạy: node engine/accounts.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AccountStore, DEFAULT_SETTINGS } = require('./accounts');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mss-acc-'));
try {
  const s = new AccountStore(dir);
  assert.strictEqual(s.list().length, 1);
  assert.deepStrictEqual(
    (({ id, name, enabled, threads }) => ({ id, name, enabled, threads }))(s.list()[0]),
    { id: 'default', name: 'Tài khoản 1', enabled: true, threads: 1 });
  assert.deepStrictEqual(s.settings, DEFAULT_SETTINGS);
  assert.deepStrictEqual(DEFAULT_SETTINGS, { maxAccounts: 2, totalThreads: 2, mode: 'rotate', useTopup: true, keepGoing: false, proxies: '', usePool: false });

  let changes = 0;
  s.on('change', () => changes++);
  const b = s.add('B');
  assert.match(b.id, /^acc_[0-9a-f]{8}$/);
  assert.strictEqual(b.name, 'B');
  assert.strictEqual(s.add('').name, 'Tài khoản 3');
  assert.ok(changes >= 2);

  assert.strictEqual(s.update(b.id, { threads: 9 }).threads, 5);
  assert.strictEqual(s.update(b.id, { threads: 0 }).threads, 1);
  assert.strictEqual(s.update('nope', { threads: 2 }), null);
  assert.deepStrictEqual(s.setSettings({ totalThreads: 0, maxAccounts: 99, mode: 'x' }),
    { maxAccounts: 20, totalThreads: 1, mode: 'rotate', useTopup: true, keepGoing: false, proxies: '', usePool: false });
  assert.strictEqual(s.setSettings({ mode: 'sequential', useTopup: false }).mode, 'sequential');

  // xoá được default khi còn TK khác, không xoá được TK cuối
  assert.strictEqual(s.remove('default'), true);
  for (const a of s.list().slice(1)) s.remove(a.id);
  assert.strictEqual(s.list().length, 1);
  assert.strictEqual(s.remove(s.list()[0].id), false);

  // ghi rồi đọc lại
  s.update(b.id, { name: 'Bé', quota: { pct: 5 } });
  s.flush();
  const s2 = new AccountStore(dir);
  assert.strictEqual(s2.get(b.id).name, 'Bé');
  assert.strictEqual(s2.get(b.id).quota.pct, 5);
  assert.strictEqual(s2.settings.mode, 'sequential');
  assert.strictEqual(s2.settings.useTopup, false);

  // file hỏng → mặc định
  fs.writeFileSync(path.join(dir, 'accounts.json'), '{oops');
  assert.strictEqual(new AccountStore(dir).list()[0].id, 'default');
  // thiếu trường → bổ sung mặc định
  fs.writeFileSync(path.join(dir, 'accounts.json'), JSON.stringify({ accounts: [{ id: 'x' }, { name: 'không id' }] }));
  const s3 = new AccountStore(dir);
  assert.deepStrictEqual(s3.list().map(a => [a.id, a.enabled, a.threads]), [['x', true, 1]]);
  assert.deepStrictEqual(s3.settings, DEFAULT_SETTINGS);
  console.log('accounts.test OK');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
