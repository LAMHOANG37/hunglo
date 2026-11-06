// Chạy: node engine/proxy.test.js — proxy giả chạy local, không cần mạng ngoài.
const assert = require('assert');
const http = require('http'), net = require('net');
const { parseProxy, parseList, checkProxy, pickProxy } = require('./proxy');

(async () => {
  // Đọc đủ các kiểu ghi proxy
  const p = l => { const { line, ...r } = parseProxy(l); return r; };
  assert.deepStrictEqual(p('1.2.3.4:8080'), { scheme: 'http', host: '1.2.3.4', port: 8080, username: '', password: '', server: 'http://1.2.3.4:8080' });
  assert.deepStrictEqual(p('1.2.3.4:8080:u:p:x'), { scheme: 'http', host: '1.2.3.4', port: 8080, username: 'u', password: 'p:x', server: 'http://1.2.3.4:8080' });
  assert.deepStrictEqual(p('http://u:p@vn.proxy.io:3128'), { scheme: 'http', host: 'vn.proxy.io', port: 3128, username: 'u', password: 'p', server: 'http://vn.proxy.io:3128' });
  assert.strictEqual(p('socks5://1.2.3.4:1080').server, 'socks5://1.2.3.4:1080');
  assert.ok(p('socks5://u:p@1.2.3.4:1080').error);
  assert.ok(p('1.2.3.4').error);
  assert.ok(p('1.2.3.4:99999').error);
  assert.deepStrictEqual(parseList('# ghi chú\n\na:1\na:1\r\nb:2').map(x => x.line), ['a:1', 'b:2']);

  // Tự chọn: chia đều, giữ cố định, chết mới đổi, tất cả chết → lỗi, danh sách rỗng → không proxy
  const list = 'a:1\nb:2\nc:3';
  const accs = [{ id: 'x', proxy: '', proxyAuto: 'a:1' }, { id: 'y', proxy: 'b:2' }, { id: 'z', proxy: '' }];
  assert.strictEqual(pickProxy(accs[2], accs, list).auto, 'c:3');
  assert.strictEqual(pickProxy(accs[0], accs, list).auto, 'a:1');
  assert.strictEqual(pickProxy(accs[0], accs, list, new Set(['a:1'])).auto, 'c:3');
  assert.strictEqual(pickProxy(accs[1], accs, list).proxy.port, 2);
  assert.strictEqual(pickProxy({ id: 'n', proxy: 'none' }, accs, list).proxy, null);
  assert.deepStrictEqual(pickProxy(accs[2], accs, ''), { proxy: null, auto: '' });
  assert.throws(() => pickProxy(accs[2], accs, list, new Set(['a:1', 'b:2', 'c:3'])), /chết/);

  // Kiểm tra sống/chết: proxy giả đòi u:p, chuyển CONNECT tới 1 cổng local
  const target = net.createServer(s => s.end()).listen(0);
  const srv = http.createServer().listen(0);
  srv.on('connect', (req, sock) => {
    if (req.headers['proxy-authorization'] !== 'Basic ' + Buffer.from('u:p').toString('base64')) return sock.end('HTTP/1.1 407 Auth\r\n\r\n');
    sock.end('HTTP/1.1 200 Connection Established\r\n\r\n');
  });
  await new Promise(r => srv.once('listening', r));
  const port = srv.address().port, opt = { target: '127.0.0.1', port: target.address().port };
  assert.strictEqual((await checkProxy(parseProxy(`127.0.0.1:${port}:u:p`), opt)).ok, true);
  assert.strictEqual((await checkProxy(parseProxy(`127.0.0.1:${port}:u:bad`), opt)).error, 'Sai user/pass');
  srv.close();
  const dead = await checkProxy(parseProxy(`127.0.0.1:${port}`), opt);
  assert.strictEqual(dead.ok, false);
  target.close();
  console.log('proxy.test OK');
})().catch(e => { console.error(e); process.exit(1); });
