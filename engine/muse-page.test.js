// Chạy: node engine/muse-page.test.js — không cần trình duyệt (Chrome giả).
const assert = require('assert');
const { MusePage, parseResult, parseQuota, CHUNK } = require('./muse-page');

(async () => {
  // parseResult: video trước ảnh, bỏ file missing, nối lời assistant
  const r = parseResult([
    { text: 'Đang làm', images: [], videos: [] },
    { text: 'Xong', images: [{ path: 'sandbox:///a.webp', mime: 'image/webp', byte_len: 10 }, { path: 'x', mime: 'image/png', byte_len: 1, missing: true }],
      videos: [{ path: 'sandbox:///v.mp4', mime: 'video/mp4', byte_len: 20 }] }
  ]);
  assert.deepStrictEqual(r.files, [
    { path: 'sandbox:///v.mp4', mime: 'video/mp4', byteLen: 20 },
    { path: 'sandbox:///a.webp', mime: 'image/webp', byteLen: 10 }
  ]);
  assert.strictEqual(r.text, 'Đang làm\nXong');

  // readFile ghép đủ các đoạn 2MB và luôn đóng file
  const size = CHUNK + 5, calls = [];
  const call = e => JSON.parse(e.slice(e.lastIndexOf('](...') + 5, -1)); // tham số của lời gọi
  const fake = {
    running: true,
    evaluate: async e => {
      calls.push(e);
      if (e.includes('["open"]')) return { id: 1, size };
      if (e.includes('["slice"]')) return Buffer.alloc(call(e)[1] === 1 ? 5 : CHUNK).toString('base64');
      return null;
    }
  };
  const buf = await new MusePage(fake).readFile('sandbox:///v.mp4');
  assert.strictEqual(buf.length, size);
  assert.ok(calls.some(e => e.includes('["closeFile"]')));
  // trang Muse tải lại thì window.__mss mất → mọi lời gọi đều kèm guard nạp lại
  assert.ok(calls.every(e => e.startsWith('(window.__mss ||')));

  // Chrome chưa chạy → tự mở trước khi gọi
  let started = 0;
  const off = { running: false, start: async () => { started++; off.running = true; }, evaluate: async () => 'x' };
  await new MusePage(off).status('s1');
  assert.strictEqual(started, 1);
  // Tài khoản đã xoá → mọi lệnh báo lỗi, KHÔNG mở lại Chrome
  let restarted = 0;
  const gone = Object.assign(new MusePage({ running: false, start: async () => { restarted++; } }), { removed: true });
  await assert.rejects(gone.login(), /đã bị xoá/);
  await assert.rejects(gone.show(), /đã bị xoá/);
  await gone.hide();
  await Object.assign(new MusePage(null), { removed: true }).hide();
  assert.strictEqual(restarted, 0);
  // send chờ Muse sẵn sàng lâu hơn mặc định 60s; lệnh khác dùng mặc định
  const waits = {};
  const t = { running: true, evaluate: async (e, ms) => { waits[e.includes('["send"]') ? 'send' : 'other'] = ms; return {}; } };
  await new MusePage(t).send('x', []);
  await new MusePage(t).status('s1');
  assert.deepStrictEqual(waits, { send: 180e3, other: undefined });
  // parseQuota: số liệu thật đọc từ Muse 2026-10-12
  const sub = {
    tier: { tierId: 'hatch_free', name: 'Muse miễn phí', isPaid: false },
    usage: { state: 'METERED', percentUsed: 5, resetsAt: 1792051239, quotaStatus: 'SUFFICIENT' },
    statusSubtitle: 'Giới hạn hàng tuần sẽ đặt lại vào 15 tháng 10', usageRowValueLabel: 'Đã dùng 5%',
    topupBalance: 40000000, topupTotal: 40000000
  };
  const q = parseQuota(sub);
  assert.ok(typeof q.checkedAt === 'number');
  delete q.checkedAt;
  assert.deepStrictEqual(q, { pct: 5, resetsAt: 1792051239000, status: 'SUFFICIENT', tier: 'Muse miễn phí', paid: false,
    topupLeft: 1, topupBalance: 40000000, topupTotal: 40000000, label: 'Đã dùng 5%', subtitle: 'Giới hạn hàng tuần sẽ đặt lại vào 15 tháng 10' });
  assert.strictEqual(parseQuota(null), null);
  assert.strictEqual(parseQuota({ ...sub, topupBalance: 0, topupTotal: 0 }).topupLeft, null);
  assert.strictEqual(parseQuota({ ...sub, topupBalance: 10, topupTotal: 40 }).topupLeft, 0.25);
  // MusePage.quota(): trang trả subscription → đã quy đổi; không đọc được → null
  const qp = r => new MusePage({ running: true, evaluate: async e => (e.includes('["quota"]') ? r : null) });
  assert.strictEqual((await qp(sub).quota()).pct, 5);
  assert.strictEqual(await qp(null).quota(), null);
  // send gặp not_ready → về trang chủ Muse rồi gửi lại đúng 1 lần
  const nav = [];
  let sends = 0;
  const lost = { running: true, url: 'https://muse.ai', sessionId: 's', cmd: async (m, p) => nav.push([m, p.url]),
    evaluate: async () => (++sends === 1 ? { ok: false, reason: 'not_ready (/thread/x)' } : { ok: true, sessionId: 'n1' }) };
  assert.deepStrictEqual(await new MusePage(lost).send('x', []), { ok: true, sessionId: 'n1' });
  assert.deepStrictEqual(nav, [['Page.navigate', 'https://muse.ai']]);
  assert.strictEqual(sends, 2);
  // trang mới chuyển, chưa có body → không văng lỗi, coi như chưa sẵn sàng
  global.window = {};
  global.document = { body: null, querySelectorAll: () => [] };
  global.location = { pathname: '/thread/x' };
  new Function(require('./muse-page').PAGE_SCRIPT)();
  const realTimeout = setTimeout;
  global.setTimeout = f => f(); // bỏ 20s chờ
  assert.deepStrictEqual(await window.__mss.send('x', []), { ok: false, reason: 'not_ready (/thread/x)' });
  // có thread → gửi thẳng vào chat đó bằng targetRoute, không tạo chat mới; Muse không trả sessionId thì lấy chính thread
  const opts = [];
  window.__hatchEarlyGatewayRuntimeState = { activeRuntime: { getSnapshot: () => ({ sendRequest: async () => ({ chat_events: [] }) }) } };
  global.document = { body: { __reactContainer$x: { memoizedProps: { value: {
    ensureActiveChatSendReady() {}, sendMessage: async (t, a, o) => { opts.push(o); return { ok: true }; } } } } }, querySelectorAll: () => [] };
  assert.deepStrictEqual(await window.__mss.send('x', [], 'th1'), { ok: true, sessionId: 'th1', reason: '', resultBaseline: [] });
  assert.deepStrictEqual(opts[0], { targetRoute: { kind: 'thread', sessionId: 'th1' }, waitForReadiness: true });
  global.setTimeout = realTimeout;
  console.log('muse-page.test OK');
})().catch(e => { console.error(e); process.exit(1); });
