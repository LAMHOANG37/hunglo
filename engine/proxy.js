/**
 * PROXY — đọc danh sách proxy (mỗi dòng 1 cái), kiểm tra sống/chết tới muse.ai, chọn proxy cho từng tài khoản.
 * Nhận: ip:port | ip:port:user:pass | user:pass@ip:port, có thể kèm http:// hoặc socks5:// (socks5 không hỗ trợ user/pass — Chrome không làm được).
 * Mỗi tài khoản giữ cố định 1 proxy (đổi IP giữa phiên dễ bị Muse nghi); proxy chết mới chuyển sang cái khác.
 */

const net = require('net');

function parseProxy(line) {
  const raw = String(line || '').trim();
  const m = /^(?:(https?|socks5h?):\/\/)?(?:([^:@\s]+):([^@\s]*)@)?([^:@\s]+):(\d{1,5})(?::([^:\s]+):(\S*))?$/i.exec(raw);
  if (!m) return { line: raw, error: 'Sai định dạng' };
  const scheme = (m[1] || 'http').toLowerCase().replace(/^socks5h$/, 'socks5');
  const [host, port] = [m[4], Number(m[5])];
  const username = m[2] ?? m[6] ?? '', password = m[3] ?? m[7] ?? '';
  if (!port || port > 65535) return { line: raw, error: 'Sai cổng' };
  if (scheme === 'socks5' && username) return { line: raw, error: 'Chrome không dùng được socks5 có mật khẩu — đổi sang http' };
  return { line: raw, scheme, host, port, username, password, server: `${scheme}://${host}:${port}` };
}

// Văn bản nhiều dòng → danh sách proxy (bỏ dòng trống, dòng # ghi chú, dòng trùng)
const parseList = text => [...new Set(String(text || '').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#')))].map(parseProxy);

// Mở đường hầm tới muse.ai:443 qua proxy → { ok, ms, error }
function checkProxy(p, { target = 'muse.ai', port = 443, timeoutMs = 8000 } = {}) {
  if (p.error) return Promise.resolve({ ok: false, ms: 0, error: p.error });
  const t0 = Date.now();
  return new Promise(resolve => {
    const sock = net.connect(p.port, p.host);
    let buf = Buffer.alloc(0), step = 0;
    const done = (ok, error = '') => { sock.destroy(); resolve({ ok, ms: Date.now() - t0, error }); };
    sock.setTimeout(timeoutMs, () => done(false, 'Quá thời gian'));
    sock.on('error', e => done(false, e.code === 'ECONNREFUSED' ? 'Không kết nối được' : e.message));
    sock.on('connect', () => {
      if (p.scheme === 'socks5') return sock.write(Buffer.from([5, 1, 0]));
      const auth = p.username ? `Proxy-Authorization: Basic ${Buffer.from(`${p.username}:${p.password}`).toString('base64')}\r\n` : '';
      sock.write(`CONNECT ${target}:${port} HTTP/1.1\r\nHost: ${target}:${port}\r\n${auth}\r\n`);
    });
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      if (p.scheme !== 'socks5') {
        const code = Number((/^HTTP\/1\.[01] (\d{3})/.exec(buf.toString('latin1')) || [])[1]);
        if (!code) return;
        return done(code === 200, code === 200 ? '' : code === 407 ? 'Sai user/pass' : `Proxy trả ${code}`);
      }
      if (step === 0 && buf.length >= 2) {
        if (buf[0] !== 5 || buf[1] !== 0) return done(false, 'socks5 đòi đăng nhập');
        step = 1; buf = Buffer.alloc(0);
        const h = Buffer.from(target);
        sock.write(Buffer.concat([Buffer.from([5, 1, 0, 3, h.length]), h, Buffer.from([port >> 8, port & 255])]));
      } else if (step === 1 && buf.length >= 2) done(buf[1] === 0, buf[1] === 0 ? '' : `socks5 lỗi ${buf[1]}`);
    });
  });
}

/**
 * Proxy cho 1 tài khoản. acc.proxy: '' = tự chọn, 'none' = không dùng, còn lại = đúng dòng proxy đó.
 * Tự chọn: giữ acc.proxyAuto nếu còn trong danh sách và không chết; không thì lấy proxy sống ít tài khoản dùng nhất.
 * dead = Set các dòng đang chết. Trả { proxy (đã parse) | null, auto (dòng cần lưu vào proxyAuto) }.
 * Danh sách có proxy mà không còn cái nào sống → lỗi (không lặng lẽ dùng IP thật, tránh lộ các tài khoản cùng 1 IP).
 */
function pickProxy(acc, accounts, text, dead = new Set()) {
  const list = parseList(text).filter(p => !p.error);
  if (acc.proxy === 'none') return { proxy: null, auto: acc.proxyAuto || '' };
  if (acc.proxy) {
    const p = parseProxy(acc.proxy);
    if (p.error) throw new Error(`Proxy của ${acc.name} lỗi: ${p.error}`);
    return { proxy: p, auto: acc.proxyAuto || '' };
  }
  if (!list.length) return { proxy: null, auto: '' };
  const live = list.filter(p => !dead.has(p.line));
  const keep = live.find(p => p.line === acc.proxyAuto);
  if (keep) return { proxy: keep, auto: keep.line };
  if (!live.length) throw new Error('Tất cả proxy đều chết — kiểm tra lại danh sách proxy');
  const lineOf = a => (a.proxy === 'none' ? '' : a.proxy || a.proxyAuto || '');
  const used = line => accounts.filter(a => a.id !== acc.id && lineOf(a) === line).length;
  const best = live.reduce((b, p) => (used(p.line) < used(b.line) ? p : b));
  return { proxy: best, auto: best.line };
}

module.exports = { parseProxy, parseList, checkProxy, pickProxy };
