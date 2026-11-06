/**
 * POOL — chạy song song các task trên nhiều tài khoản Muse. Scheduler chọn cặp task → tài khoản,
 * Pool gắn task vào trang Muse của tài khoản đó và chạy runTask (không đổi từ Đợt 1).
 * Không phụ thuộc Electron: store, trang Muse, runTask truyền vào.
 */

const { plan, pausedUntil, needsCheck } = require('./scheduler');
const { runTask, failurePatch } = require('./muse-runner');

const realSleep = ms => new Promise(r => setTimeout(r, ms));
// Nghỉ ngẫu nhiên 15–20s giữa 2 lần gửi trên cùng tài khoản: gửi dồn dập dễ bị Muse nghi là tool.
// ponytail: hằng số cứng, thêm ô cài đặt nếu người dùng cần chỉnh.
const randomGap = () => 15e3 + Math.random() * 5e3;

class Pool {
  // skip(task): true → task chờ chưa được chạy (dự án đang tạm dừng)
  constructor({ tasks, accounts, pageFor, config, loadImage, onFiles = () => {}, run = runTask, sleep = realSleep, now = Date.now, skip = () => false, gap = randomGap, verifyAccounts = false }) {
    Object.assign(this, { tasks, accounts, pageFor, config, loadImage, onFiles, run, sleep, now, skip, gap });
    this.running = new Map(); // taskId → accountId
    this.verifyAccounts = verifyAccounts;
    this.checking = new Map();
  }

  busy(accId) {
    return [...this.running.values()].filter(id => id === accId).length;
  }

  pump() {
    const tasks = this.tasks.list().filter(t => t.status !== 'queued' || !this.skip(t));
    this.maintainAccounts();
    const candidates = this.accounts.list().map(a => this.checking.has(a.id) ? { ...a, verificationError: 'Đang xác minh tài khoản' } : a);
    const pairs = plan({ tasks, accounts: candidates, settings: { ...this.accounts.settings, requireVerified: this.verifyAccounts }, running: this.running, now: this.now() });
    for (const { taskId, accountId } of pairs) this.runOne(this.tasks.get(taskId), accountId);
  }

  maintainAccounts() {
    if (!this.verifyAccounts) return;
    for (const a of this.accounts.list()) {
      if (a.enabled && !this.busy(a.id) && (needsCheck(a, this.now()) || a.verificationError)
        && (a.nextCheckAt || 0) <= this.now()) this.verifyAccount(a.id);
    }
  }

  verificationUpdate(id, patch) {
    const a = this.accounts.get(id);
    if (!a) return;
    const loginError = patch.loginError ?? a.loginError ?? '';
    const quotaError = patch.quotaError ?? a.quotaError ?? (a.loginError ? '' : a.verificationError) ?? '';
    const verificationError = loginError || quotaError;
    this.accounts.update(id, { ...patch, loginError, quotaError, verificationError,
      nextCheckAt: verificationError ? this.now() + 60e3 : 0 });
  }

  verifyAccount(id) {
    if (this.checking.has(id)) return this.checking.get(id);
    if (!this.accounts.get(id)?.enabled || this.busy(id)) return Promise.resolve(false);
    const job = (async () => {
      try {
        if (!await this.checkLogin(id, 2)) return false;
        return Boolean(await this.refreshQuota(id));
      } catch (e) {
        this.verificationUpdate(id, { quotaError: e.message });
        return false;
      }
    })().finally(() => {
      this.checking.delete(id);
      if (this.accounts.get(id)) this.accounts.update(id, {});
      setImmediate(() => this.pump());
    });
    this.checking.set(id, job);
    if (this.accounts.get(id)) this.accounts.update(id, {});
    return job;
  }

  // Trang vừa mở còn đang tải → login() báo chưa; dò thêm ~1 phút trước khi kết luận
  async checkLogin(accId, tries = 20) {
    const page = this.pageFor(accId);
    let last = null, error = '';
    for (let i = 0; i < tries; i++) {
      // Lần đầu được mở Chrome; sau đó người dùng đóng Chrome → thôi dò, KHÔNG mở lại (đóng rồi lại hiện Chrome khác)
      if (i && page.chrome?.running === false) break;
      try { last = await page.login(); error = ''; } catch (e) { last = null; error = e.message; }
      if (last?.loggedIn) {
        this.verificationUpdate(accId, { loggedIn: true, loginCheckedAt: this.now(), loginError: '' });
        return true;
      }
      if (i < tries - 1) await this.sleep(3000);
    }
    const authRequired = last?.http === 401 || last?.authRequired === true || (last?.loggedIn === false && last.http == null);
    this.verificationUpdate(accId, authRequired
      ? { loggedIn: false, loginCheckedAt: this.now(), loginError: 'Muse yêu cầu đăng nhập lại' }
      : { loginError: error || 'Không kiểm tra được kết nối hoặc trang Muse chưa sẵn sàng' });
    return false;
  }

  async refreshQuota(accId) {
    let error = '';
    const q = await this.pageFor(accId).quota({ allowUI: !this.busy(accId) }).catch(e => { error = e.message; return null; });
    this.verificationUpdate(accId, q
      ? { quota: { ...q, checkedAt: this.now() }, quotaError: '' }
      : { quotaError: error || 'Không lấy được hạn mức mới; chưa dùng số liệu cũ để giao việc' });
    return q;
  }

  async runOne(task, accId) {
    const id = task.id;
    this.running.set(id, accId);
    const page = this.pageFor(accId);
    const isLive = () => this.tasks.get(id)?.status === 'processing';
    const cfg = this.config();
    let done = false;
    try {
      if (task.status === 'queued') {
        // giữ chỗ trước khi dò đăng nhập: pump() chạy chồng không lấy lại task này
        this.tasks.update(id, { status: 'processing', accountId: accId, step: 'Kiểm tra đăng nhập', startedAt: this.now(), finishedAt: 0, attempts: task.attempts + 1, error: '', files: [], sessionId: '', held: false });
        if (!(await this.checkLogin(accId))) {
          if (isLive()) this.tasks.update(id, { status: 'queued', accountId: '', step: '', attempts: task.attempts - 1, error: `${this.accounts.get(accId)?.name || accId} chưa đăng nhập Muse` });
          return;
        }
        if (!isLive()) return;
        if (this.verifyAccounts) {
          const a = this.accounts.get(accId);
          if (!a || !a.enabled || a.videoDailyLimit || pausedUntil(a, { ...this.accounts.settings, requireVerified: true }, this.now())) {
            this.tasks.update(id, { status: 'queued', accountId: '', step: 'Chờ tài khoản phù hợp', attempts: Math.max(0, this.tasks.get(id).attempts - 1) });
            return;
          }
        }
        const wait = (this.accounts.get(accId)?.lastUsedAt || 0) + this.gap() - this.now();
        if (wait > 0) {
          this.tasks.update(id, { step: `Nghỉ ~${Math.ceil(wait / 1000)}s rồi mới gửi (tránh gửi dồn)` });
          await this.sleep(wait);
          if (!isLive()) return;
        }
      }
      if (!this.tasks.get(id).sessionId && this.accounts.get(accId)?.videoDailyLimit) {
        this.tasks.update(id, { status: 'queued', accountId: '', step: 'Chờ tài khoản khác', attempts: Math.max(0, this.tasks.get(id).attempts - 1) });
        return;
      }
      const files = await this.run(this.tasks.get(id), { page, accountId: accId, update: p => this.tasks.update(id, p), isLive, outputDir: cfg.outputDir, loadImage: this.loadImage, limits: cfg.limits });
      done = true;
      if (!files || !isLive()) return;
      // Ảnh xong → ghi link chat để video làm tiếp trong cùng chat (link chat Muse = /thread/<sessionId>)
      const sid = this.tasks.get(id).sessionId;
      this.tasks.update(id, { status: 'succeeded', step: `Đã tải ${files.length} file`, finishedAt: this.now(), files,
        ...(task.kind === 'image' && sid ? { thread: `https://muse.ai/thread/${sid}` } : {}) });
      this.onFiles(files);
    } catch (e) {
      if (!isLive()) return;
      if (e.museResult || ['MUSE_DAILY_VIDEO_LIMIT', 'MUSE_RUNWAY_UNAVAILABLE'].includes(e.code)) {
        const acc = this.accounts.get(accId);
        const kind = e.code === 'MUSE_RUNWAY_UNAVAILABLE' ? 'runway' : e.code === 'MUSE_DAILY_VIDEO_LIMIT' ? 'daily' : 'muse';
        if (acc) this.accounts.update(accId, { videoDailyLimit: { detectedAt: this.now(), reason: e.message, kind } });
        const t = this.tasks.get(id);
        this.tasks.update(id, {
          status: 'queued', accountId: '', sessionId: '', resultBaseline: [], thread: '', pin: '',
          step: 'Chờ tài khoản khác có thể nhận việc', startedAt: 0, finishedAt: 0,
          attempts: Math.max(0, t.attempts - 1),
          error: `${acc?.name || accId}: ${kind === 'runway' ? 'Muse báo lỗi Runway' : kind === 'daily' ? 'bị giới hạn video ngày' : 'Muse từ chối hoặc không trả kết quả'}. ${e.message}. Giữ nguyên prompt và ảnh, chuyển sang tài khoản được bật khác.`
        });
        return;
      }
      // Muse không nhận lệnh: có thể do hết hạn mức → đọc hạn mức; tài khoản phải nghỉ thì trả task về hàng đợi, không tốn lượt
      if (/^Muse không nhận lệnh/.test(e.message)) {
        await this.refreshQuota(accId);
        const acc = this.accounts.get(accId);
        if (acc && pausedUntil(acc, this.accounts.settings, this.now())) {
          const t = this.tasks.get(id);
          this.tasks.update(id, { status: 'queued', accountId: '', sessionId: '', step: '', attempts: t.attempts - 1, error: `${acc.name} hết hạn mức, chờ tài khoản khác` });
          return;
        }
      }
      this.tasks.update(id, failurePatch(this.tasks.get(id), e, this.now(), cfg.maxAttempts));
    } finally {
      this.running.delete(id);
      if (this.accounts.get(accId)) {
        this.accounts.update(accId, { lastUsedAt: this.now() });
        if (done) {
          if (this.verifyAccounts) this.verifyAccount(accId);
          else this.refreshQuota(accId);
        }
      }
      setImmediate(() => this.pump());
    }
  }

  cancel(id) {
    const task = this.tasks.get(id);
    if (!task || (task.status !== 'queued' && task.status !== 'processing')) return task || null;
    if (task.status === 'processing' && task.sessionId) this.pageFor(task.accountId || 'default').cancel(task.sessionId).catch(() => {});
    this.tasks.update(id, { status: 'cancelled', error: 'Đã huỷ', finishedAt: this.now() });
    return task;
  }

  // Trước khi xoá tài khoản: task dở của nó không dò tiếp được nữa → gửi lại từ đầu trên tài khoản khác
  releaseAccount(accId) {
    for (const t of this.tasks.list()) {
      if (t.status === 'processing' && (t.accountId || 'default') === accId && !this.running.has(t.id)) {
        this.tasks.update(t.id, { status: 'queued', sessionId: '', accountId: '', step: '', error: 'Tài khoản đã xoá, gửi lại' });
      }
    }
  }
}

module.exports = { Pool };
