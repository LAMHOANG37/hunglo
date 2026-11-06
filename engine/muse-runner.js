/**
 * MUSE RUNNER — chạy 1 task trên trang Muse (MusePage): gửi lệnh → lưu sessionId → dò phiên → tải file.
 * Không phụ thuộc Electron: `page`, đồng hồ và cách đọc ảnh truyền vào (test bằng page giả).
 */

const fs = require('fs');
const path = require('path');
const { videoAvailabilityError } = require('./video-limit');

const RATIO_LABEL = { '9:16': '9:16 dọc', '16:9': '16:9 ngang', '1:1': '1:1 vuông', '4:3': '4:3 ngang', '3:4': '3:4 dọc' };
const MAX_ATTACH = 8388608; // Muse giới hạn tổng ảnh gửi kèm 8MB
const MAX_POLL_ERRORS = 5; // dò lỗi liên tiếp quá chừng này (~20s) thì bỏ cuộc
const EXT = { 'video/mp4': 'mp4', 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' };
const realSleep = ms => new Promise(r => setTimeout(r, ms));
// Lỗi do Muse trả lời (không ra file / quá giờ) — khác lỗi đường truyền: thử lại bằng chat mới mới có ích
const museError = msg => Object.assign(new Error(msg), { museResult: true });

function buildMessage({ kind, ratio, prompt }) {
  const head = (kind === 'image' ? 'Tạo ảnh' : 'Tạo video') + (RATIO_LABEL[ratio] ? ` · tỷ lệ ${RATIO_LABEL[ratio]}` : '');
  return `${head}\n${prompt}`;
}

// Chưa đăng nhập → hiện Chrome cho người dùng đăng nhập, xong thì ẩn. Hết giờ → false (Chrome vẫn mở để đăng nhập tiếp).
// Trang đang tải → login() lỗi → coi như chưa đăng nhập, dò tiếp.
async function ensureLogin(page, { sleep = realSleep, now = Date.now, waitMs = 15 * 60e3, pollMs = 5000 } = {}) {
  const loggedIn = async () => Boolean((await page.login().catch(() => null))?.loggedIn);
  if (await loggedIn()) return true;
  await page.show();
  const start = now();
  // Người dùng đóng Chrome đăng nhập (đóng cửa sổ / thoát Chrome) = bỏ đăng nhập → dừng, không mở lại Chrome
  while (now() - start < waitMs && !page.removed && page.chrome?.running !== false) {
    await sleep(pollMs);
    if (await loggedIn()) {
      await page.hide();
      return true;
    }
  }
  return false;
}

// Trả đường dẫn file đã lưu; null nếu task bị huỷ giữa chừng; throw Error khi lỗi.
async function runTask(task, { page, accountId = '', update, isLive, outputDir, loadImage, limits = { image: 5, video: 30 }, sleep = realSleep, now = Date.now, pollMs = 4000 }) {
  const what = task.kind === 'image' ? 'ảnh' : 'video';
  let sid = task.sessionId;
  let resultBaseline = task.resultBaseline || [];
  let inThread = false;

  if (!sid) {
    const atts = [];
    for (const [k, img] of task.images.entries()) {
      const { mimeType, dataBase64 } = await loadImage(img);
      atts.push({ filename: `anh_${k + 1}.${EXT[mimeType] || mimeType.split('/')[1]}`, mimeType, dataBase64, category: 'image' });
    }
    if (atts.reduce((n, a) => n + Buffer.byteLength(a.dataBase64, 'base64'), 0) > MAX_ATTACH) throw new Error('Ảnh gửi kèm quá 8MB (giới hạn của Muse). Bớt ảnh hoặc dùng ảnh nhỏ hơn.');
    update({ step: 'Gửi lệnh' });
    // Có chat cũ (vd. chat vừa vẽ storyboard) trên đúng tài khoản → gửi tiếp vào đó; không được thì mở chat mới.
    // Vẫn gắn ảnh: chat cũ có lạc sang chat khác thì Muse vẫn đủ ảnh.
    const thread = task.thread && (!task.pin || task.pin === accountId) ? task.thread.split('/').pop() : '';
    let sent = thread ? await page.send(buildMessage(task), atts, thread).catch(e => ({ ok: false, reason: e.message })) : null;
    inThread = Boolean(sent?.ok && sent.sessionId);
    if (task.kind !== 'image' && !inThread) { const e = videoAvailabilityError(sent?.reason); if (e) throw e; }
    // Không vào được chat storyboard → ghi lý do lại (xem ở task) rồi mở chat mới
    if (thread && !inThread) update({ threadError: `Không gửi được vào chat storyboard (${sent?.reason || 'không rõ lý do'}), làm ở chat mới` });
    if (!inThread) sent = await page.send(buildMessage(task), atts);
    if (!sent?.ok || !sent.sessionId) {
      if (task.kind !== 'image') { const e = videoAvailabilityError(sent?.reason); if (e) throw e; }
      throw museError(`Muse không nhận lệnh: ${sent?.reason || 'không rõ lý do'}`);
    }
    sid = sent.sessionId;
    resultBaseline = sent.resultBaseline || [];
    update({ sessionId: sid, resultBaseline, step: 'Muse đang làm' });
  }

  // Tính giờ từ lúc task bắt đầu → mở lại app vẫn giữ đúng hạn
  const limitMin = Math.max(limits[task.kind === 'image' ? 'image' : 'video'], task.timeoutMin || 0);
  let status;
  // Gửi tiếp vào chat cũ: phiên đang "xong" từ lượt trước → chờ thấy nó chạy lại (tối đa 30s) mới tính là xong
  let seen = !inThread;
  const sentAt = now();
  for (let errors = 0; ;) {
    await sleep(pollMs);
    if (!isLive()) return null;
    try {
      status = await page.status(sid);
      errors = 0;
    } catch (e) {
      if (++errors >= MAX_POLL_ERRORS) throw e;
      status = 'running';
    }
    if (status === 'running') seen = true;
    else if (seen || now() - sentAt > 30e3) break;
    else continue;
    if (now() - task.startedAt > limitMin * 60e3) {
      await page.cancel(sid).catch(() => {});
      throw museError(`Quá ${limitMin} phút Muse chưa làm xong.`);
    }
  }
  if (!isLive()) return null;

  const { files, text } = await page.result(sid, resultBaseline);
  let wanted = files.filter(f => f.mime.startsWith(task.kind === 'image' ? 'image/' : 'video/'));
  if (task.kind === 'image') wanted = wanted.slice(0, task.expect || 1);
  if (!wanted.length) {
    if (task.kind !== 'image') { const e = videoAvailabilityError(text); if (e) throw e; }
    throw museError(text ? `Muse không tạo ${what}. Muse trả lời: "${text}"` : `Muse không trả về ${what} (phiên ${status || 'không thấy'}).`);
  }

  update({ step: 'Tải file' });
  const dir = task.kind === 'image' ? path.join(outputDir, 'storyboard') : outputDir;
  fs.mkdirSync(dir, { recursive: true });
  const saved = [];
  for (const [k, f] of wanted.entries()) {
    const buf = await page.readFile(f.path);
    if (buf.length !== f.byteLen) throw new Error(`Tải file lỗi: ${buf.length}/${f.byteLen} byte`);
    const file = path.join(dir, `Muse_${Date.now()}_${k + 1}.${EXT[f.mime] || f.mime.split('/')[1]}`);
    fs.writeFileSync(file, buf);
    saved.push(file);
  }
  return saved;
}

// Sau lỗi, task (bản mới nhất trong store) → patch. Đã gửi mà lỗi đường truyền → giữ phiên, dò lại, không gửi lại
// (tránh tốn thêm 1 lượt Muse và bỏ rơi video đã xong). Lỗi khác còn lượt → gửi lại bằng chat mới.
function failurePatch(task, e, now = Date.now(), maxAttempts = 2) {
  if (task.attempts >= maxAttempts) return { status: 'failed', error: e.message, finishedAt: now };
  if (task.sessionId && !e.museResult) return { attempts: task.attempts + 1, error: `Lỗi lần ${task.attempts}, đang dò lại phiên: ${e.message}` };
  return { status: 'queued', sessionId: '', error: `Lỗi lần ${task.attempts}, đang thử lại: ${e.message}` };
}

module.exports = { buildMessage, ensureLogin, runTask, failurePatch, RATIO_LABEL };
