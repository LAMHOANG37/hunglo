// Chạy: node engine/chrome.test.js — mở Chrome thật với profile tạm, kiểm tra CDP qua pipe.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { Chrome } = require('./chrome');

(async () => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mss-'));
  const c = new Chrome({ profileDir, url: 'about:blank' });
  try {
    await c.start();
    assert.strictEqual(c.running, true);
    assert.strictEqual(await c.evaluate('1+1'), 2);
    assert.strictEqual(await c.evaluate('Promise.resolve(3)'), 3);
    await assert.rejects(c.evaluate('(()=>{throw new Error("boom")})()'), /boom/);
    await c.hide();
    await c.show();
    // lệnh treo → hết giờ, không chờ mãi
    await assert.rejects(c.evaluate('new Promise(() => {})', 300), /quá 0.3s/);
    // người dùng đóng tab/cửa sổ (Mac: Chrome vẫn chạy) → mất phiên tab, start() gắn lại tab mới
    await c.cmd('Target.closeTarget', { targetId: c.targetId });
    for (let k = 0; k < 50 && c.running; k++) await new Promise(r => setTimeout(r, 100));
    assert.strictEqual(c.running, false);
    await c.start();
    assert.strictEqual(await c.evaluate('1+1'), 2);
    await c.close();
    assert.strictEqual(c.running, false);
    await assert.rejects(c.evaluate('1'), /Chrome đã đóng/);
    // gọi start() chồng nhau lúc khởi động → chỉ 1 Chrome, cả hai đều dùng được
    await Promise.all([c.start(), c.start()]);
    assert.deepStrictEqual(await Promise.all([c.evaluate('1'), c.evaluate('2')]), [1, 2]);
    await c.close();

    // Proxy có user/pass: Chrome đi qua proxy, đăng nhập proxy bằng CDP Fetch (proxy giả trả trang luôn, không cần mạng)
    const auth = 'Basic ' + Buffer.from('u:p').toString('base64');
    const proxy = http.createServer((req, res) => {
      if (req.headers['proxy-authorization'] !== auth) { res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="x"' }); return res.end(); }
      res.end('<title>qua-proxy</title>');
    }).on('connect', (req, sock) => sock.destroy()).listen(0); // https tự nâng cấp → hỏng → Chrome quay về http
    await new Promise(r => proxy.once('listening', r));
    const port = proxy.address().port;
    const pc = new Chrome({ profileDir, url: 'http://muse.test/', resolveProxy: async () => ({ server: `http://127.0.0.1:${port}`, host: '127.0.0.1', port, username: 'u', password: 'p' }) });
    try {
      await pc.start();
      let title = '';
      for (let k = 0; k < 50 && title !== 'qua-proxy'; k++) { await new Promise(r => setTimeout(r, 200)); title = await pc.evaluate('document.title').catch(() => ''); }
      assert.strictEqual(title, 'qua-proxy');
    } finally {
      await pc.close();
      proxy.close();
    }
    console.log('chrome.test OK');
  } finally {
    if (c.running) await c.close();
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exit(1); });
