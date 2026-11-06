// Chạy: node engine/muse-runner.test.js — Muse giả, không gửi gì thật.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildMessage, ensureLogin, runTask, failurePatch } = require('./muse-runner');

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mss-run-'));

// page giả: statuses = các lần dò lần lượt (lặp lại phần tử cuối), files/text = kết quả, bytes = số byte readFile trả
function fakePage({ sendResult = { ok: true, sessionId: 's1' }, statuses = ['completed'], files = [], text = '', bytes } = {}) {
  const log = { sent: [], status: [], read: 0, cancel: [], show: 0, hide: 0 };
  let k = 0;
  return {
    log,
    send: async (text, atts, thread = '') => { log.sent.push({ text, atts, thread }); return typeof sendResult === 'function' ? sendResult(thread) : sendResult; },
    status: async sid => {
      log.status.push(sid);
      const s = statuses[Math.min(k++, statuses.length - 1)];
      if (s instanceof Error) throw s;
      return s;
    },
    result: async () => ({ files, text }),
    readFile: async p => { log.read++; return Buffer.alloc(bytes ?? files.find(f => f.path === p).byteLen); },
    cancel: async sid => { log.cancel.push(sid); },
    show: async () => { log.show++; },
    hide: async () => { log.hide++; }
  };
}

// đồng hồ giả: mỗi lần sleep tăng thời gian đúng bằng ms
function deps(page, extra = {}) {
  let t = 1e12;
  const updates = [];
  return {
    updates,
    page, outputDir,
    update: p => updates.push(p),
    isLive: () => true,
    loadImage: async () => ({ mimeType: 'image/png', dataBase64: Buffer.from('png').toString('base64') }),
    sleep: async ms => { t += ms; },
    now: () => t,
    ...extra
  };
}
const task = (o = {}) => ({ kind: 'video', ratio: '', prompt: 'P', images: [], expect: 1, timeoutMin: 2, startedAt: 1e12, sessionId: '', ...o });
const mp4 = { path: 'sandbox:///v.mp4', mime: 'video/mp4', byteLen: 20 };
const webp = n => ({ path: `sandbox:///a${n}.webp`, mime: 'image/webp', byteLen: 10 });

(async () => {
  assert.strictEqual(buildMessage({ kind: 'video', ratio: '9:16', prompt: 'P' }), 'Tạo video · tỷ lệ 9:16 dọc\nP');
  assert.strictEqual(buildMessage({ kind: 'image', ratio: '', prompt: 'P' }), 'Tạo ảnh\nP');

  // thành công: gửi kèm ảnh, lưu sessionId ngay, dò đến khi xong, tải đúng mp4
  {
    const page = fakePage({ statuses: ['running', 'running', 'completed'], files: [mp4, webp(1)] });
    const d = deps(page);
    const files = await runTask(task({ images: [{ imageLocalPath: '/x.png' }] }), d);
    assert.strictEqual(files.length, 1);
    assert.match(path.basename(files[0]), /^Muse_\d+_1\.mp4$/);
    assert.strictEqual(path.dirname(files[0]), outputDir);
    assert.strictEqual(fs.statSync(files[0]).size, 20);
    assert.ok(d.updates.some(u => u.sessionId === 's1'));
    assert.deepStrictEqual(page.log.sent[0].atts, [{ filename: 'anh_1.png', mimeType: 'image/png', dataBase64: Buffer.from('png').toString('base64'), category: 'image' }]);
    assert.strictEqual(page.log.status.length, 3);
  }

  // task ảnh: chỉ lấy image/*, tối đa expect, lưu vào storyboard/
  {
    const page = fakePage({ files: [mp4, webp(1), webp(2), webp(3)] });
    const files = await runTask(task({ kind: 'image', expect: 2 }), deps(page));
    assert.strictEqual(files.length, 2);
    assert.ok(files.every(f => f.startsWith(path.join(outputDir, 'storyboard')) && f.endsWith('.webp')));
  }

  // chỉ có chữ → lỗi kèm lời Muse
  await assert.rejects(runTask(task(), deps(fakePage({ text: 'Tôi cần thêm thông tin' }))), /Muse trả lời: "Tôi cần thêm thông tin"/);

  // sai dung lượng
  await assert.rejects(runTask(task(), deps(fakePage({ files: [mp4], bytes: 19 }))), /19\/20/);

  // Muse không nhận lệnh
  await assert.rejects(runTask(task(), deps(fakePage({ sendResult: { ok: false, reason: 'queue_full' } }))), /queue_full/);

  // quá giờ: task ảnh timeoutMin 2 → dùng 5 phút, huỷ phiên trên Muse
  {
    const page = fakePage({ statuses: ['running'] });
    await assert.rejects(runTask(task({ kind: 'image', timeoutMin: 2 }), deps(page)), /Quá 5 phút/);
    assert.deepStrictEqual(page.log.cancel, ['s1']);
  }

  // giới hạn phút lấy từ Cài đặt
  await assert.rejects(runTask(task({ kind: 'image', timeoutMin: 0 }), deps(fakePage({ statuses: ['running'] }), { limits: { image: 1, video: 30 } })), /Quá 1 phút/);
  await assert.rejects(runTask(task({ timeoutMin: 0 }), deps(fakePage({ statuses: ['running'] }), { limits: { image: 1, video: 3 } })), /Quá 3 phút/);

  // phiên biến mất khỏi sessions.list → vẫn đọc kết quả
  assert.strictEqual((await runTask(task(), deps(fakePage({ statuses: [null], files: [mp4] })))).length, 1);

  // ảnh đính kèm hỏng → lỗi, không gửi prompt chỉ có chữ
  {
    const page = fakePage();
    await assert.rejects(runTask(task({ images: [{ imageUrl: 'https://x/y.jpg' }] }), deps(page, { loadImage: async () => { throw new Error('Không tải được ảnh: https://x/y.jpg'); } })), /Không tải được ảnh/);
    assert.strictEqual(page.log.sent.length, 0);
  }

  // huỷ giữa chừng → null, không tải file
  {
    const page = fakePage({ statuses: ['running', 'completed'], files: [mp4] });
    let live = 2;
    assert.strictEqual(await runTask(task(), deps(page, { isLive: () => live-- > 0 })), null);
    assert.strictEqual(page.log.read, 0);
  }

  // chạy tiếp sau khi mở lại app: đã có sessionId → không gửi lại
  {
    const page = fakePage({ files: [mp4] });
    await runTask(task({ sessionId: 's9' }), deps(page));
    assert.strictEqual(page.log.sent.length, 0);
    assert.deepStrictEqual(page.log.status, ['s9']);
  }

  // ảnh quá 8MB → lỗi trước khi gửi
  {
    const page = fakePage();
    const big = async () => ({ mimeType: 'image/png', dataBase64: Buffer.alloc(4194305).toString('base64') });
    await assert.rejects(runTask(task({ images: [{}, {}] }), deps(page, { loadImage: big })), /8MB/);
    assert.strictEqual(page.log.sent.length, 0);
  }

  // dò lỗi chập chờn (trang tải lại, mạng) → dò tiếp, KHÔNG gửi lại
  {
    const oops = new Error('Execution context was destroyed');
    const page = fakePage({ statuses: [oops, oops, 'completed'], files: [mp4] });
    assert.strictEqual((await runTask(task(), deps(page))).length, 1);
    assert.strictEqual(page.log.sent.length, 1);
  }
  // dò lỗi liên tục → bỏ cuộc, lỗi không phải do Muse trả lời
  {
    const page = fakePage({ statuses: [new Error('Chrome mất tab Muse')] });
    const e = await runTask(task(), deps(page)).catch(e => e);
    assert.match(e.message, /mất tab/);
    assert.ok(!e.museResult);
    assert.strictEqual(page.log.status.length, 5);
  }
  // Muse trả lời nhưng không có file → đánh dấu museResult
  assert.strictEqual((await runTask(task(), deps(fakePage({ text: 'Không' }))).catch(e => e)).museResult, true);

  // failurePatch: quyết định sau lỗi
  {
    const net = new Error('mất tab'), muse = Object.assign(new Error('Muse từ chối'), { museResult: true });
    // đã gửi + lỗi đường truyền → giữ phiên, dò lại (không gửi lại)
    assert.deepStrictEqual(failurePatch({ attempts: 1, sessionId: 's1' }, net, 9),
      { attempts: 2, error: 'Lỗi lần 1, đang dò lại phiên: mất tab' });
    // Muse trả lời không có file → gửi lại bằng chat mới
    assert.deepStrictEqual(failurePatch({ attempts: 1, sessionId: 's1' }, muse, 9),
      { status: 'queued', sessionId: '', error: 'Lỗi lần 1, đang thử lại: Muse từ chối' });
    // chưa gửi được → gửi lại
    assert.strictEqual(failurePatch({ attempts: 1, sessionId: '' }, net, 9).status, 'queued');
    // hết lượt → failed
    assert.deepStrictEqual(failurePatch({ attempts: 2, sessionId: 's1' }, net, 9), { status: 'failed', error: 'mất tab', finishedAt: 9 });
    // số lần thử lấy từ Cài đặt
    assert.strictEqual(failurePatch({ attempts: 3, sessionId: '' }, net, 9, 4).status, 'queued');
    assert.strictEqual(failurePatch({ attempts: 4, sessionId: '' }, net, 9, 4).status, 'failed');
  }

  // ensureLogin: đăng nhập ở lần dò thứ 3 → hiện 1 lần, ẩn 1 lần
  {
    const seq = [false, false, true];
    const page = { ...fakePage(), login: async () => ({ loggedIn: seq.shift() }) };
    const d = deps(page);
    assert.strictEqual(await ensureLogin(page, d), true);
    assert.strictEqual(page.log.show, 1);
    assert.strictEqual(page.log.hide, 1);
  }
  // ensureLogin: không bao giờ đăng nhập → false sau 15 phút giả
  {
    const page = { ...fakePage(), login: async () => ({ loggedIn: false }) };
    assert.strictEqual(await ensureLogin(page, deps(page)), false);
  }
  // xoá tài khoản giữa lúc chờ đăng nhập → dừng dò ngay (không dò tiếp 15 phút, không mở lại Chrome)
  {
    let polls = 0;
    const page = { ...fakePage(), login: async () => { if (++polls === 2) page.removed = true; return { loggedIn: false }; } };
    assert.strictEqual(await ensureLogin(page, deps(page)), false);
    assert.strictEqual(polls, 2);
  }
  // người dùng đóng Chrome đăng nhập → dừng dò, không mở lại
  {
    let polls = 0;
    const chrome = { running: true };
    const page = { ...fakePage(), chrome, login: async () => { if (++polls === 2) chrome.running = false; return { loggedIn: false }; } };
    assert.strictEqual(await ensureLogin(page, deps(page)), false);
    assert.strictEqual(polls, 2);
  }
  // trang chưa tải xong → login() lỗi → coi như chưa đăng nhập, dò tiếp
  {
    const seq = [() => { throw new Error('Execution context was destroyed'); }, () => ({ loggedIn: true })];
    const page = { ...fakePage(), login: async () => seq.shift()() };
    assert.strictEqual(await ensureLogin(page, deps(page)), true);
  }
  // đã đăng nhập sẵn → không hiện Chrome
  {
    const page = { ...fakePage(), login: async () => ({ loggedIn: true }) };
    assert.strictEqual(await ensureLogin(page, deps(page)), true);
    assert.strictEqual(page.log.show, 0);
  }

  // chat cũ (storyboard) đúng tài khoản → gửi tiếp vào chat đó, kèm ảnh; phiên còn "completed" từ lượt trước thì chờ nó chạy lại
  {
    const page = fakePage({ sendResult: { ok: true, sessionId: 'th1' }, statuses: ['completed', 'running', 'completed'], files: [mp4] });
    const files = await runTask(task({ thread: 'https://muse.ai/thread/th1', pin: 'a', images: [{ imageLocalPath: '/x.png' }] }), deps(page, { accountId: 'a' }));
    assert.strictEqual(files.length, 1);
    assert.deepStrictEqual(page.log.sent.map(s => [s.thread, s.atts.length]), [['th1', 1]]);
    assert.strictEqual(page.log.status.length, 3);
  }
  // gửi vào chat cũ lỗi → mở chat mới; khác tài khoản → không đụng chat cũ
  {
    const page = fakePage({ sendResult: th => (th ? { ok: false, reason: 'send_failed' } : { ok: true, sessionId: 'n1' }), files: [mp4] });
    const d = deps(page, { accountId: 'a' });
    await runTask(task({ thread: 'https://muse.ai/thread/th1', pin: 'a' }), d);
    assert.deepStrictEqual(page.log.sent.map(s => s.thread), ['th1', '']);
    assert.ok(d.updates.some(p => /send_failed/.test(p.threadError || '')));
    const other = fakePage({ files: [mp4] });
    await runTask(task({ thread: 'https://muse.ai/thread/th1', pin: 'a' }), deps(other, { accountId: 'b' }));
    assert.deepStrictEqual(other.log.sent.map(s => s.thread), ['']);
  }

  fs.rmSync(outputDir, { recursive: true, force: true });
  console.log('muse-runner.test OK');
})().catch(e => { console.error(e); process.exit(1); });
