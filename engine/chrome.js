/**
 * CHROME — mở Google Chrome thật của máy (không headless) với profile riêng, điều khiển qua CDP bằng pipe.
 * Pipe: fd 3 = app ghi lệnh, fd 4 = Chrome trả lời; mỗi tin là JSON kết thúc bằng \0. Không mở cổng mạng nào.
 * Chrome 136+ không cho điều khiển profile chính → mỗi tài khoản 1 thư mục profile riêng.
 */

const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

const IS_MAC = process.platform === 'darwin';
// Chrome của máy: Mac trong /Applications; Windows trong Program Files hoặc AppData\Local (cài riêng 1 người dùng)
const CHROME_PATH = IS_MAC ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)
    .map(d => path.join(d, 'Google', 'Chrome', 'Application', 'chrome.exe')).find(p => fs.existsSync(p)) || 'chrome.exe';
// Windows không có "ẩn app" như Mac → đẩy cửa sổ ra ngoài màn hình (vẫn chạy JS bình thường, không bị thu nhỏ)
const OFF = { left: -32000, top: -32000 };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Ẩn/hiện cả app Chrome theo PID (như Cmd+H): không cửa sổ, không thu nhỏ xuống Dock, JS vẫn chạy (đã có cờ chống throttle)
const appProc = (pid, act, done) => execFile('osascript', ['-l', 'JavaScript', '-e',
  `ObjC.import('AppKit'); const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${pid}); app.${act}`], done);
const appCall = (pid, act) => new Promise(r => appProc(pid, act, () => r()));
// Chạy run loop thay vì delay(): app.hidden chỉ cập nhật khi run loop chạy
const TICK = '$.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.25))';
// Chrome ẩn/thu nhỏ: trang tải mới không chạy requestAnimationFrame + báo hidden → Muse (Next.js) không dựng xong, mất client chat.
// Nạp trước mỗi trang: báo luôn "visible", rAF không chạy thì setTimeout 16ms thay.
const VISIBLE_SHIM = `(() => {
  Object.defineProperty(Document.prototype, 'visibilityState', { get: () => 'visible', configurable: true });
  Object.defineProperty(Document.prototype, 'hidden', { get: () => false, configurable: true });
  const raf = window.requestAnimationFrame.bind(window), caf = window.cancelAnimationFrame.bind(window);
  const t = new Map(); let seq = 0;
  window.requestAnimationFrame = cb => {
    const id = ++seq; let done = false;
    const run = ts => { if (done) return; done = true; t.delete(id); cb(ts); };
    t.set(id, [raf(run), setTimeout(() => run(performance.now()), 16)]);
    return id;
  };
  window.cancelAnimationFrame = id => { const v = t.get(id); if (v) { caf(v[0]); clearTimeout(v[1]); t.delete(id); } };
})();`;

class Chrome extends EventEmitter {
  // proxy = { server: 'http://ip:port' | 'socks5://ip:port', username, password } — có user/pass thì trả lời đăng nhập proxy qua CDP Fetch
  // resolveProxy = async () => proxy | null: hỏi lại mỗi lần mở Chrome (đổi proxy chỉ cần đóng Chrome, lần sau tự mở với proxy mới)
  constructor({ profileDir, url, chromePath = CHROME_PATH, proxy = null, resolveProxy = null }) {
    super();
    Object.assign(this, { profileDir, url, chromePath, proxy, resolveProxy });
    this.proc = null;
    this.sessionId = '';
    this.seq = 0;
    this.pending = new Map();
  }

  // Sẵn sàng = Chrome chạy VÀ đang gắn vào 1 tab. Mac: đóng cửa sổ thì Chrome vẫn chạy nhưng mất tab.
  get running() {
    return Boolean(this.proc && this.sessionId);
  }

  // Gọi chồng nhau (lúc khởi động) → dùng chung 1 lần mở
  start() {
    return (this.starting ||= this.launch().finally(() => { this.starting = null; }));
  }

  async launch() {
    if (this.proc) return this.attach();
    if (!fs.existsSync(this.chromePath)) throw new Error('Không tìm thấy Google Chrome — cài Google Chrome rồi mở lại app');
    fs.mkdirSync(this.profileDir, { recursive: true });
    if (this.resolveProxy) this.proxy = await this.resolveProxy();
    const proc = spawn(this.chromePath, [
      `--user-data-dir=${this.profileDir}`,
      '--remote-debugging-pipe',
      '--no-first-run',
      '--no-default-browser-check',
      // Chrome thu nhỏ vẫn phải chạy JS bình thường để dò phiên Muse
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      ...(this.proxy ? [`--proxy-server=${this.proxy.server}`] : []),
      ...(IS_MAC ? [] : [`--window-position=${OFF.left},${OFF.top}`]), // mở sẵn ngoài màn hình, không nháy
      'about:blank' // mở trang trắng, gắn VISIBLE_SHIM rồi mới vào Muse
    ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
    this.proc = proc;
    let buf = '';
    proc.stdio[4].on('data', chunk => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\0')) >= 0) {
        const msg = JSON.parse(buf.slice(0, i));
        buf = buf.slice(i + 1);
        // Tab Muse bị đóng → bỏ phiên tab, lần gọi sau start() gắn lại
        if (msg.method === 'Target.detachedFromTarget' && msg.params.sessionId === this.sessionId) this.sessionId = '';
        if (msg.method?.startsWith('Fetch.')) this.onFetch(msg);
        const p = this.pending.get(msg.id);
        if (!p) continue;
        this.pending.delete(msg.id);
        msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
      }
    });
    proc.stdio[3].on('error', () => {});
    proc.once('exit', () => this.onExit(proc));

    try {
      // Proxy có mật khẩu: bắt yêu cầu đăng nhập proxy ở cấp trình duyệt (mọi tab) rồi trả user/pass
      if (this.proxy?.username) await this.cmd('Fetch.enable', { handleAuthRequests: true, patterns: [{ urlPattern: '*' }] });
      await this.attach();
      await this.hide(); // mở xong ẩn ngay; cần đăng nhập thì show()
      // Chrome mới mở đôi khi tự hiện lại ~1–2s sau (dựng cửa sổ đầu) → canh 10s, hiện lại thì ẩn lại; show() dừng canh
      if (IS_MAC) this.guard = appProc(proc.pid, `hide; for (let i = 0; i < 40; i++) { ${TICK}; if (!app.hidden) app.hide; }`, () => {});
      await this.cmd('Page.navigate', { url: this.url }, this.sessionId);
    } catch (e) {
      await this.close();
      throw e;
    }
  }

  // Gắn vào tab muse.ai (hoặc tab đầu tiên); không còn tab nào → mở tab mới
  async attach() {
    let target;
    for (let k = 0; k < 10 && !target; k++) {
      const { targetInfos } = await this.cmd('Target.getTargets');
      const pages = targetInfos.filter(t => t.type === 'page');
      target = pages.find(t => t.url.includes('muse.ai')) || pages[0];
      if (!target) await sleep(200);
    }
    const targetId = target ? target.targetId : (await this.cmd('Target.createTarget', { url: this.url })).targetId;
    const { sessionId } = await this.cmd('Target.attachToTarget', { targetId, flatten: true });
    await this.cmd('Page.enable', {}, sessionId); // thiếu Page.enable thì script nạp trước không chạy
    await this.cmd('Page.addScriptToEvaluateOnNewDocument', { source: VISIBLE_SHIM }, sessionId);
    Object.assign(this, { targetId, sessionId });
  }

  onFetch({ method, params, sessionId }) {
    const { requestId } = params;
    const reply = method === 'Fetch.authRequired'
      ? this.cmd('Fetch.continueWithAuth', { requestId, authChallengeResponse: params.authChallenge.source === 'Proxy'
        ? { response: 'ProvideCredentials', username: this.proxy.username, password: this.proxy.password || '' }
        : { response: 'Default' } }, sessionId)
      : this.cmd('Fetch.continueRequest', { requestId }, sessionId);
    reply.catch(() => {});
  }

  onExit(proc) {
    if (this.proc !== proc) return;
    this.proc = null;
    this.sessionId = '';
    for (const p of this.pending.values()) p.reject(new Error('Chrome đã đóng'));
    this.pending.clear();
    this.emit('exit');
  }

  // Lệnh CDP; sessionId = lệnh cho tab Muse, không có = lệnh cho cả trình duyệt
  // Quá timeoutMs không trả lời (trang treo) → lỗi, không chờ mãi
  cmd(method, params = {}, sessionId, timeoutMs = 60e3) {
    if (!this.proc) return Promise.reject(new Error('Chrome đã đóng'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Chrome không trả lời ${method} (quá ${timeoutMs / 1000}s)`));
      }, timeoutMs);
      const done = f => v => { clearTimeout(timer); f(v); };
      this.pending.set(id, { resolve: done(resolve), reject: done(reject) });
      this.proc.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
    });
  }

  async evaluate(expression, timeoutMs) {
    if (this.proc && !this.sessionId) throw new Error('Chrome mất tab Muse');
    const r = await this.cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, this.sessionId, timeoutMs);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }

  // Về cửa sổ thường rồi mới đặt vị trí (Chrome không cho đổi vị trí khi đang thu nhỏ/phóng to)
  async setWindow(bounds) {
    const { windowId } = await this.cmd('Browser.getWindowForTarget', { targetId: this.targetId });
    await this.cmd('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    if (bounds) await this.cmd('Browser.setWindowBounds', { windowId, bounds });
  }

  async show() {
    this.guard?.kill();
    if (IS_MAC) await appCall(this.proc.pid, 'unhide');
    await this.setWindow(IS_MAC ? null : { left: 80, top: 40, width: 1200, height: 860 });
    await this.cmd('Target.activateTarget', { targetId: this.targetId });
    if (IS_MAC) await appCall(this.proc.pid, 'activateWithOptions(2)'); // 2 = bỏ qua app khác, đưa Chrome lên trước
  }

  // Mac: Chrome vừa mở chưa khởi động xong thì lệnh hide bị bỏ qua → thử lại tới khi ẩn được (tối đa ~10s)
  hide() {
    if (!this.proc) return Promise.resolve();
    if (!IS_MAC) return this.setWindow(OFF);
    return appCall(this.proc.pid, `hide; for (let i = 0; i < 40 && !app.hidden; i++) { ${TICK}; app.hide; }`);
  }

  async clearSiteData(origin) {
    await this.cmd('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
    await this.cmd('Page.navigate', { url: this.url }, this.sessionId);
  }

  async close() {
    const proc = this.proc;
    if (!proc) return;
    const exited = new Promise(r => proc.once('exit', r));
    this.cmd('Browser.close').catch(() => {});
    const timer = setTimeout(() => proc.kill(), 3000);
    await exited;
    clearTimeout(timer);
  }
}

module.exports = { Chrome, CHROME_PATH };
