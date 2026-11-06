/**
 * MUSE STUDIO PRO - Main Process (Electron for Mac)
 * Điều khiển Main Studio Window, Chrome chạy Muse (CDP) & CRM Server.
 */

const { app, BrowserWindow, ipcMain, shell, dialog, powerSaveBlocker } = require('electron');
const path = require('path');
// Preserve the installed app's data location when changing its displayed name.
app.setPath('userData', path.join(app.getPath('appData'), 'HaoHao'));
app.setPath('sessionData', path.join(app.getPath('appData'), 'HaoHao'));
app.setName('LamMuse');
const fs = require('fs');
const https = require('https');
const http = require('http');
const CrmServer = require('./engine/crm-server');
const { scrapeLadiPage } = require('./engine/ladi-crawler');
const { generateScriptsFromProduct } = require('./engine/product-ai');
const configManager = require('./engine/config-manager');
const TaskStore = require('./engine/task-store');
const { Chrome } = require('./engine/chrome');
const { MusePage } = require('./engine/muse-page');
const { ensureLogin } = require('./engine/muse-runner');
const { AccountStore } = require('./engine/accounts');
const { parseProxy, parseList, checkProxy, pickProxy } = require('./engine/proxy');
const { Pool } = require('./engine/pool');
const { StudioStore } = require('./engine/studio-store');
const merger = require('./engine/merge');
const { usable, pausedUntil, needsCheck } = require('./engine/scheduler');
const { fetchFacebookPages, verifyFacebookPageToken, publishFacebookReels } = require('./engine/facebook-poster');

let mainWindow = null;
let crmServer = null;
let taskStore = null;
let accountStore = null;
let pool = null;
let studioStore = null;
const pages = new Map(); // accountId → MusePage (mỗi tài khoản 1 Chrome, profile riêng)

// Bản cho khách (build kèm -c.extraMetadata.edition=customer): không có tab API, không mở cổng 48900
const CUSTOMER = require('./package.json').edition === 'customer';
const IS_MAC = process.platform === 'darwin';
// Thư mục lưu video mặc định: Mac ~/Movies/MuseStudioPro, Windows Videos\MuseStudioPro
const DEFAULT_OUTPUT = path.join(app.getPath('videos'), 'MuseStudioPro');
// Thư mục lưu đổi được trong Cài đặt (user_config.json: outputDir)
function outDir() {
  const dir = configManager.get().outputDir || DEFAULT_OUTPUT;
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { console.warn('Không thể tạo thư mục lưu:', e.message); }
  return dir;
}
// Cài đặt chạy task: số lần thử, giới hạn phút ảnh/video
function runConfig() {
  const c = configManager.get();
  const n = (v, lo, hi, def) => Math.min(Math.max(parseInt(v, 10) || def, lo), hi);
  return { outputDir: outDir(), maxAttempts: n(c.maxAttempts, 1, 5, 2), limits: { image: n(c.imageTimeoutMin, 1, 60, 5), video: n(c.videoTimeoutMin, 5, 120, 30) } };
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: 1000,
    minHeight: 680,
    ...(IS_MAC ? { titleBarStyle: 'hiddenInset', vibrancy: 'under-window' }
      : { titleBarStyle: 'hidden', titleBarOverlay: { color: '#06160e', symbolColor: '#e8f0ea', height: 48 } }),
    backgroundColor: '#0a0f1d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--mss-edition=${CUSTOMER ? 'customer' : 'pro'}`]
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Muse chạy trong Google Chrome thật (profile riêng từng tài khoản), điều khiển qua CDP. Mở lười khi cần.
function pageFor(id) {
  // Tài khoản không còn (vừa xoá) → trang "đã xoá": mọi lệnh báo lỗi, không mở Chrome
  if (!accountStore.get(id)) return Object.assign(new MusePage(null), { removed: true });
  if (!pages.has(id)) pages.set(id, new MusePage(new Chrome({ profileDir: path.join(app.getPath('userData'), 'profiles', id), url: 'https://muse.ai', resolveProxy: () => proxyFor(id) })));
  return pages.get(id);
}

// Kho proxy dự phòng: tắt công tắc thì coi như kho trống
const poolText = () => (accountStore.settings.usePool ? accountStore.settings.proxies : '');
// PROXY — kết quả kiểm tra gần nhất: dòng proxy → { ok, ms, error, checkedAt }
const proxyHealth = new Map();
const deadProxies = () => new Set([...proxyHealth].filter(([, h]) => !h.ok).map(([line]) => line));
const testProxy = async p => { const h = { ...await checkProxy(p), checkedAt: Date.now() }; proxyHealth.set(p.line, h); pushStatus(); return h; };

// Mỗi lần mở Chrome của tài khoản: chọn proxy (giữ cố định), thử nhanh; chết → đánh dấu, tự chọn cái khác
async function proxyFor(id) {
  for (;;) {
    const acc = accountStore.get(id);
    const { proxy, auto } = pickProxy(acc, accountStore.list(), poolText(), deadProxies());
    if (auto !== acc.proxyAuto) accountStore.update(id, { proxyAuto: auto });
    if (!proxy) return null;
    const h = await testProxy(proxy);
    if (h.ok) return proxy;
    if (acc.proxy) throw new Error(`Proxy ${proxy.host}:${proxy.port} của ${acc.name} không dùng được: ${h.error}`);
  }
}

// Proxy của tài khoản phải đổi (sửa danh sách / chọn khác / proxy chết) → đóng Chrome đang rảnh, lần dùng sau tự mở với proxy mới.
// ponytail: tài khoản đang chạy task thì để nguyên, đổi ở lần mở Chrome sau (hoặc bấm Kiểm tra proxy lại khi rảnh)
function reapplyProxies() {
  for (const [id, page] of pages) {
    const acc = accountStore.get(id);
    if (!acc || !page.chrome.proc || pool.busy(id) || logins.has(id)) continue;
    let want = null;
    try { want = pickProxy(acc, accountStore.list(), poolText(), deadProxies()).proxy; } catch {}
    if ((want?.line || '') !== (page.chrome.proxy?.line || '')) page.chrome.close().catch(() => {});
  }
}

function sendUI(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
}

function accountsView() {
  const running = {};
  for (const id of pool.running.values()) running[id] = (running[id] || 0) + 1;
  const settings = { ...accountStore.settings, requireVerified: true }, now = Date.now();
  // pausedUntil: đang nghỉ vì hết hạn mức tới lúc nào (0 = không nghỉ) → chip "Nghỉ – hết hạn mức (tới dd/mm)"
  // proxyNow: proxy Chrome đang mở thật sự dùng (host:port, không lộ mật khẩu)
  const proxyNow = id => { const c = pages.get(id)?.chrome; return c?.proc && c.proxy ? `${c.proxy.host}:${c.proxy.port}` : ''; };
  // proxyFixed: proxy riêng gõ ở ô Proxy của tài khoản → { label, error, health }
  const proxyFixed = a => {
    if (!a.proxy || a.proxy === 'none') return null;
    const p = parseProxy(a.proxy);
    return { label: p.error ? '' : `${p.host}:${p.port}`, error: p.error || '', health: proxyHealth.get(p.line) || null };
  };
  const accounts = accountStore.list().map(a => ({ ...a, needsCheck: needsCheck(a, now), checking: pool.checking.has(a.id), pausedUntil: pausedUntil(a, settings, now), proxyNow: proxyNow(a.id), proxyFixed: proxyFixed(a) }));
  const proxies = parseList(poolText()).map(p => ({ line: p.line, label: p.error ? p.line : `${p.host}:${p.port}`, error: p.error || '', health: proxyHealth.get(p.line) || null }));
  return { accounts, settings, running, proxies, blocked: blockedReason(), now };
}

// Lý do task đang chờ không chạy được (hiện trên thanh trên); '' = có tài khoản dùng được
function blockedReason() {
  const s = { ...accountStore.settings, requireVerified: true }, now = Date.now();
  const on = accountStore.list().filter(a => a.enabled);
  if (!on.length) return 'Chưa bật tài khoản nào';
  if (on.some(a => !pool.checking.has(a.id) && usable(a, s, now))) return '';
  if (on.every(a => a.loggedIn === false)) return 'Chưa đăng nhập Muse';
  if (pool.checking.size) return 'Đang kiểm tra phiên và hạn mức tài khoản';
  if (on.some(a => !a.videoDailyLimit && a.verificationError)) return 'Chưa kiểm tra được tài khoản; app sẽ tự thử lại. Xem chi tiết tại tab Tài khoản.';
  if (on.some(a => !a.videoDailyLimit && needsCheck(a, now))) return 'Cần cập nhật phiên và hạn mức; app sẽ tự kiểm tra tài khoản đang rảnh';
  if (on.some(a => a.videoDailyLimit)) return 'Chờ tài khoản được bật khác có thể tạo video — tài khoản hiện tại bị giới hạn ngày hoặc Muse báo lỗi Runway. Xem tab Tài khoản.';
  const until = Math.min(...on.map(a => pausedUntil(a, s, now)).filter(Boolean));
  return Number.isFinite(until) ? `Hết hạn mức tới ${new Date(until).toLocaleDateString('vi-VN')}` : 'Hết hạn mức';
}

let pushQueued = false;
function pushStatus() {
  if (pushQueued) return;
  pushQueued = true;
  setImmediate(() => {
    pushQueued = false;
    const view = accountsView();
    const isConnected = view.accounts.some(a => a.enabled && a.loggedIn);
    sendUI('status-update', { isConnected });
    sendUI('accounts-update', view);
    crmServer?.updateStatus({
      isConnected,
      accounts: view.accounts.map(({ id, name, enabled, loggedIn, quota }) => ({ id, name, enabled, loggedIn, quota, running: view.running[id] || 0 }))
    });
  });
}

// Đăng nhập 1 tài khoản: chưa đăng nhập → hiện Chrome của tài khoản đó, dò tới khi xong rồi thu nhỏ
const logins = new Map();
function loginAccount(id) {
  if (logins.has(id)) { pageFor(id).show().catch(() => {}); return logins.get(id); }
  const job = (async () => {
    try {
      const ok = await ensureLogin(pageFor(id));
      if (accountStore.get(id)) accountStore.update(id, { loggedIn: ok });
      if (ok) { await pageFor(id).hide().catch(() => {}); await pool.refreshQuota(id); pool.pump(); }
      return ok;
    } catch (e) {
      console.warn('[Main] Chrome lỗi:', e.message);
      if (accountStore.get(id)) accountStore.update(id, { loggedIn: false });
      return false;
    } finally {
      logins.delete(id);
    }
  })();
  logins.set(id, job);
  return job;
}

// Mở app: Chrome mở ẩn. 1 tài khoản chưa đăng nhập → hiện Chrome để đăng nhập. Nhiều tài khoản → chưa đăng nhập thì
// vẫn ẩn, chờ người dùng bấm Đăng nhập (không bật nhiều cửa sổ một lúc).
async function startAccounts() {
  const on = accountStore.list().filter(a => a.enabled);
  // Dò ngầm trước (trang đang tải thì login() báo chưa) → chỉ hiện Chrome khi thật sự chưa đăng nhập
  const single = accountStore.list().length === 1 && on.length === 1;
  await Promise.all(on.map(async a => {
    const ok = await pool.checkLogin(a.id);
    if (ok) await pool.refreshQuota(a.id);
    else if (single) await loginAccount(a.id);
    // Nhiều tài khoản: tài khoản chưa đăng nhập thì đóng luôn Chrome ẩn của nó (không để Chrome thừa), bấm Đăng nhập mới mở
    else if (!logins.has(a.id)) await pageFor(a.id).chrome?.close().catch(() => {});
  }));
  pool.pump();
  setInterval(() => { pool.pump(); pushStatus(); }, 60e3); // bắt lúc hạn mức đặt lại
}

function handleVideoFinished(localPath, originalUrl) {
  const item = {
    localPath,
    filename: path.basename(localPath),
    originalUrl,
    timestamp: Date.now()
  };

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('video-completed', item);
  }

  if (crmServer) {
    const list = crmServer.museStatus.completedVideos || [];
    crmServer.updateStatus({ completedVideos: [item, ...list] });
  }

}

// =========================================================================
// DÂY CHUYỀN TASK: Pool chạy song song trên các tài khoản (engine/pool.js)
// =========================================================================

// Ảnh gửi kèm → {mimeType, dataBase64}. Ảnh hỏng → lỗi, không lặng lẽ gửi prompt chỉ có chữ.
async function loadImage(img) {
  const src = img.imageLocalPath || img.imageUrl || '(ảnh)';
  if (img.imageLocalPath && fs.existsSync(img.imageLocalPath)) {
    const ext = path.extname(img.imageLocalPath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return { mimeType, dataBase64: fs.readFileSync(img.imageLocalPath).toString('base64') };
  }
  const m = img.imageUrl && /^data:([^;]+);base64,(.*)$/s.exec((await fetchImageAsDataUrl(img.imageUrl)) || '');
  if (!m) throw new Error('Không tải được ảnh: ' + src);
  return { mimeType: m[1], dataBase64: m[2] };
}

const pump = () => setImmediate(() => pool.pump());

// Task vào dự án đang mở (API/CRM cũng vậy), trừ khi chỉ rõ dự án có thật
function submitTask(input) {
  const st = studioStore.get();
  const project = st.projects.some(p => p.id === input.project) ? input.project : st.current;
  const task = taskStore.add({ ...input, project });
  pump();
  return task;
}

function cancelTask(id) {
  return pool.cancel(id);
}

function retryTask(id) {
  const task = taskStore.get(id);
  if (!task || task.status === 'queued' || task.status === 'processing') return task || null;
  taskStore.update(id, { status: 'queued', step: '', error: '', files: [], startedAt: 0, finishedAt: 0, sessionId: '', accountId: '', attempts: 0, held: false });
  pump();
  return task;
}

function removeTask(id) {
  cancelTask(id);
  return taskStore.remove(id);
}

// App lifecycle
app.whenReady().then(() => {
  try {
    powerSaveBlocker.start('prevent-app-suspension');
  } catch (e) {}

  createMainWindow();

  taskStore = new TaskStore();
  accountStore = new AccountStore(app.getPath('userData'));
  studioStore = new StudioStore(app.getPath('userData'));
  studioStore.on('update', data => sendUI('studio-update', data));
  pool = new Pool({
    tasks: taskStore, accounts: accountStore, pageFor, config: runConfig, loadImage, verifyAccounts: true,
    skip: t => studioStore.pausedProjects().has(t.project || 'default'),
    onFiles: files => { for (const f of files) if (f.endsWith('.mp4')) handleVideoFinished(f, 'muse'); }
  });
  taskStore.on('update', task => {
    sendUI('task-update', { task, blocked: blockedReason() });
    pushStatus(); // số task đang chạy của từng tài khoản
  });
  accountStore.on('change', pushStatus);
  startAccounts().catch(e => console.error('[Main] Khởi động tài khoản lỗi:', e));

  // Khởi động Local API Server (CRM cũ + API v1). Job CRM vào chung hàng đợi task,
  // trước đây gửi thẳng vào ô chat Muse → chen ngang task đang chạy.
  if (!CUSTOMER) crmServer = new CrmServer(48900, {
    onJobReceived: (jobData) => {
      console.log('[Main] Nhận job từ CRM:', jobData.topicId);
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('crm-job-received', jobData);
      return submitTask({ prompt: jobData.prompt, source: 'crm', label: jobData.topicId || '' });
    },
    apiKey: () => apiKey(),
    tasks: {
      list: (status) => taskStore.list(status),
      get: (id) => taskStore.get(id),
      submit: (input) => submitTask({ ...input, source: 'api' }),
      cancel: cancelTask,
      retry: retryTask,
      remove: removeTask
    }
  });
  crmServer?.start();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('before-quit', () => {
  taskStore?.flush();
  accountStore?.flush();
  for (const page of pages.values()) page.chrome.close();
});

app.on('window-all-closed', () => {
  if (crmServer) crmServer.stop();
  if (process.platform !== 'darwin') app.quit();
});

// =========================================================================
// IPC HANDLERS
// =========================================================================

// TÀI KHOẢN MUSE
const firstAccount = () => (accountStore.list().find(a => a.enabled) || accountStore.list()[0]).id;
const ACCOUNT_FIELDS = ['name', 'enabled', 'threads', 'proxy'];

ipcMain.handle('accounts-list', () => accountsView());
ipcMain.handle('account-add', (_event, name) => {
  const acc = accountStore.add(name);
  loginAccount(acc.id); // mở Chrome mới để đăng nhập luôn
  return acc;
});
ipcMain.handle('account-update', (_event, id, patch = {}) => {
  const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => ACCOUNT_FIELDS.includes(k)));
  if (patch.clearVideoDailyLimit === true) {
    if (pool.busy(id)) throw new Error('Tài khoản đang chạy task; chờ xong trước khi thử lại hạn mức video.');
    clean.videoDailyLimit = null;
  }
  const acc = accountStore.update(id, clean);
  if ('proxy' in clean) reapplyProxies();
  if (acc?.enabled && acc.loggedIn === null) pool.checkLogin(id).then(ok => ok && pool.refreshQuota(id)).finally(pump);
  pump();
  return acc;
});
ipcMain.handle('account-remove', async (_event, id) => {
  if (!accountStore.get(id)) return { ok: false, error: 'Không có tài khoản này' };
  if (accountStore.list().length <= 1) return { ok: false, error: 'Phải còn ít nhất 1 tài khoản' };
  if (pool.busy(id)) return { ok: false, error: 'Tài khoản đang chạy task. Dừng task trước rồi xoá.' };
  pool.releaseAccount(id);
  accountStore.remove(id);
  const page = pages.get(id);
  pages.delete(id);
  if (page) { page.removed = true; await page.chrome.close().catch(() => {}); }
  // Profile Chrome vào Thùng rác (lấy lại được nếu xoá nhầm)
  const dir = path.join(app.getPath('userData'), 'profiles', id);
  if (fs.existsSync(dir)) await shell.trashItem(dir).catch(e => console.warn('[Main] Không bỏ được profile vào Thùng rác:', e.message));
  pump();
  return { ok: true };
});
ipcMain.handle('account-login', (_event, id) => { loginAccount(id); return true; });
ipcMain.handle('account-show', (_event, id) => pageFor(id).show().then(() => true, () => false));
ipcMain.handle('account-logout', async (_event, id) => {
  if (pool.busy(id)) return { ok: false, error: 'Tài khoản đang chạy task. Dừng task trước.' };
  await pageFor(id).logout();
  accountStore.update(id, { loggedIn: false });
  return { ok: true };
});
ipcMain.handle('accounts-settings', (_event, patch) => {
  const s = accountStore.setSettings(patch || {});
  if ('proxies' in (patch || {}) || 'usePool' in (patch || {})) reapplyProxies();
  pump();
  return s;
});
ipcMain.handle('proxies-check', async () => {
  // kho dự phòng + proxy riêng của từng tài khoản
  const own = accountStore.list().filter(a => a.proxy && a.proxy !== 'none').map(a => parseProxy(a.proxy)).filter(p => !p.error);
  await Promise.all([...new Map([...parseList(poolText()), ...own].map(p => [p.line, p])).values()].map(testProxy));
  reapplyProxies();
  pump();
  return accountsView();
});
ipcMain.handle('accounts-check-quota', async (_event, id) => {
  const ids = id ? [id] : accountStore.list().filter(a => a.enabled).map(a => a.id);
  await Promise.all(ids.map(i => pool.verifyAccount(i)));
  pump();
  return accountsView();
});
ipcMain.handle('accounts-check-login', async () => {
  await Promise.all(accountStore.list().filter(a => a.enabled).map(a => pool.verifyAccount(a.id)));
  pump();
  return accountsView();
});

// Tương thích nút cũ: tài khoản đầu tiên
// Đã đăng nhập → hiện Chrome để xem; chưa → hiện tới khi đăng nhập xong
ipcMain.handle('open-muse-login', () => {
  const id = firstAccount();
  if (accountStore.get(id).loggedIn) pageFor(id).show().catch(() => {}); else loginAccount(id);
  return true;
});
ipcMain.handle('check-muse-status', async () => pool.checkLogin(firstAccount(), 2));

ipcMain.handle('open-output-folder', () => {
  shell.openPath(outDir());
  return true;
});

ipcMain.handle('get-app-config', () => {
  return {
    outputDir: outDir(),
    version: '1.0.0',
    crmEndpoint: 'http://127.0.0.1:48900'
  };
});

// Khoá API v1: tạo 1 lần, lưu trong user_config.json.
function apiKey(regenerate = false) {
  let key = configManager.get().apiKey;
  if (!key || regenerate) {
    key = 'msk_' + require('crypto').randomBytes(20).toString('hex');
    configManager.save({ apiKey: key });
  }
  return key;
}

function fetchImageAsDataUrl(imgUrl) {
  if (!imgUrl) return Promise.resolve(null);
  if (imgUrl.startsWith('data:')) return Promise.resolve(imgUrl);
  return new Promise((resolve) => {
    try {
      const client = imgUrl.startsWith('https') ? https : http;
      // CDN hay chặn request không có User-Agent; redirect có thể là đường dẫn tương đối.
      client.get(imgUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' }, timeout: 20000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          fetchImageAsDataUrl(new URL(res.headers.location, imgUrl).href).then(resolve);
          return;
        }
        if (res.statusCode !== 200) {
          console.warn('[Main] Tải ảnh thất bại HTTP', res.statusCode, imgUrl);
          res.resume();
          resolve(null);
          return;
        }
        const contentType = res.headers['content-type'] || 'image/jpeg';
        if (contentType.includes('text/html')) {
          console.warn('[Main] Tải ảnh trả về text/html thay vì image:', imgUrl);
          res.resume();
          resolve(null);
          return;
        }
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const dataUrl = `data:${contentType};base64,${buffer.toString('base64')}`;
          resolve(dataUrl);
        });
      }).on('timeout', function() {
        this.destroy(new Error('timeout'));
      }).on('error', (err) => {
        console.warn('[Main] Lỗi tải ảnh remote:', err.message);
        resolve(null);
      });
    } catch (e) {
      resolve(null);
    }
  });
}

// Task: UI và API dùng chung 1 hàng đợi
ipcMain.handle('task-submit', (_event, input) => submitTask({ ...input, source: 'ui' }));
ipcMain.handle('task-list', () => ({ tasks: taskStore.list(), blocked: blockedReason() }));
ipcMain.handle('task-cancel', (_event, id) => cancelTask(id));
ipcMain.handle('task-retry', (_event, id) => retryTask(id));
ipcMain.handle('task-remove', (_event, id) => removeTask(id));
ipcMain.handle('task-resume', () => { pump(); return true; });
// Chạy các task đã chọn: task "chỉ thêm vào hàng đợi" thì bỏ cờ giữ, task lỗi/huỷ thì chạy lại
ipcMain.handle('task-run', (_event, ids = []) => {
  for (const id of ids) {
    const t = taskStore.get(id);
    if (t?.status === 'queued' && t.held) taskStore.update(id, { held: false });
    else if (t && t.status !== 'queued' && t.status !== 'processing') retryTask(id);
  }
  pump();
  return true;
});
ipcMain.handle('task-stop-all', () => {
  taskStore.list().filter(t => t.status === 'queued' || t.status === 'processing').forEach(t => cancelTask(t.id));
  return true;
});
ipcMain.handle('task-clear-finished', () => {
  taskStore.list().filter(t => t.status !== 'queued' && t.status !== 'processing').forEach(t => taskStore.remove(t.id));
  return true;
});
ipcMain.handle('reveal-file', (_event, p) => { if (p && fs.existsSync(p)) shell.showItemInFolder(p); return true; });
ipcMain.handle('get-api-key', (_event, regenerate) => apiKey(regenerate));

// Hàng đợi video của màn Tạo video: lưu ra file để tắt app không mất lô đang làm
const queueFile = () => path.join(app.getPath('userData'), 'queue.json');
// Chưa có file → null; file hỏng → {error} để giao diện KHÔNG ghi đè (giữ file cho người dùng/khôi phục)
ipcMain.handle('queue-load', () => {
  if (!fs.existsSync(queueFile())) return null;
  try { return JSON.parse(fs.readFileSync(queueFile(), 'utf8')); } catch (e) { return { error: e.message }; }
});
// File lớn (có ảnh base64): ghi file tạm rồi đổi tên → tắt app giữa chừng không làm cụt file hàng đợi
ipcMain.handle('queue-save', (_event, data) => {
  const tmp = queueFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, queueFile());
  return true;
});

// multi = true: chọn nhiều ảnh 1 lần, trả về mảng
ipcMain.handle('select-image-file', async (_event, multi = false) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn ảnh sản phẩm (từ máy tính hoặc AirDrop điện thoại)',
    filters: [
      { name: 'Image Files (*.jpg, *.png, *.webp, *.jpeg, *.heic)', extensions: ['jpg', 'png', 'webp', 'jpeg', 'heic', 'bmp'] }
    ],
    properties: multi ? ['openFile', 'multiSelections'] : ['openFile']
  });
  if (result.canceled || !result.filePaths?.length) return multi ? [] : null;
  const files = result.filePaths.map(filePath => {
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    return { filePath, filename: path.basename(filePath), dataUrl: `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}` };
  });
  return multi ? files : files[0];
});

// Ghép các video cảnh thành 1 file bằng ffmpeg: ưu tiên bản đóng gói kèm app (resources/bin), rồi Homebrew (app mở từ Finder không có PATH). % gửi qua 'merge-progress'.
const bin = n => [path.join(process.resourcesPath, 'bin'), '/opt/homebrew/bin', '/usr/local/bin']
  .map(d => path.join(d, IS_MAC ? n : n + '.exe')).find(p => fs.existsSync(p));
const NO_FFMPEG = IS_MAC ? 'Chưa cài ffmpeg. Chạy: brew install ffmpeg' : 'Thiếu ffmpeg trong thư mục cài app — cài lại app';
ipcMain.handle('merge-videos', async (_event, paths = [], name = '') => {
  const ffmpeg = bin('ffmpeg');
  if (!ffmpeg) return { success: false, error: NO_FFMPEG };
  const files = paths.filter(p => typeof p === 'string' && fs.existsSync(p));
  if (files.length < 2) return { success: false, error: 'Cần ít nhất 2 video' };
  const r = await merger.merge({
    ffmpeg, ffprobe: bin('ffprobe'), files, out: merger.safeName(outDir(), name), tmpDir: app.getPath('temp'),
    onProgress: pct => sendUI('merge-progress', pct)
  });
  if (r.success) handleVideoFinished(r.path, 'merged');
  return r;
});

// Nhạc nền: bài nhạc người dùng tự bỏ vào thư mục "Nhạc nền" trong thư mục lưu video; mỗi video bốc ngẫu nhiên 1 bài.
const musicDir = () => { const d = path.join(outDir(), 'Nhạc nền'); fs.mkdirSync(d, { recursive: true }); return d; };
ipcMain.handle('open-music-folder', () => { shell.openPath(musicDir()); return merger.musicFiles(musicDir()).length; });
ipcMain.handle('add-music', async (_event, video) => {
  const ffmpeg = bin('ffmpeg'), ffprobe = bin('ffprobe');
  if (!ffmpeg || !ffprobe) return { success: false, error: NO_FFMPEG };
  if (typeof video !== 'string' || !fs.existsSync(video)) return { success: false, error: 'Không thấy file video' };
  const songs = merger.musicFiles(musicDir());
  if (!songs.length) return { success: false, error: 'Thư mục "Nhạc nền" chưa có bài nào (mp3/m4a/wav). Bỏ nhạc vào rồi bấm "Thử lại".' };
  const music = songs[Math.floor(Math.random() * songs.length)];
  const r = await merger.addMusic({ ffmpeg, ffprobe, video, music, out: merger.safeName(path.dirname(video), path.basename(video, path.extname(video)) + ' - nhạc nền') });
  if (r.success) handleVideoFinished(r.path, 'music');
  return r;
});

// Tư liệu (nhân vật, mẫu prompt, người mẫu, ảnh luân phiên) + dự án
ipcMain.handle('studio-get', () => studioStore.get());
ipcMain.handle('studio-save', (_event, patch = {}) => {
  const { characters, templates, model, rotate } = patch;
  return studioStore.save(Object.fromEntries(Object.entries({ characters, templates, model, rotate }).filter(([, v]) => v !== undefined)));
});
ipcMain.handle('studio-add-image', (_event, src) => studioStore.addImage(src));
ipcMain.handle('project-add', (_event, name) => studioStore.addProject(name));
ipcMain.handle('project-update', (_event, id, patch) => { studioStore.updateProject(id, patch); pump(); return studioStore.get(); });
ipcMain.handle('project-current', (_event, id) => { studioStore.setCurrent(id); return studioStore.get(); });
// Xoá dự án: huỷ + xoá task của nó (file đã tải giữ nguyên)
ipcMain.handle('project-remove', (_event, id) => {
  if (!studioStore.removeProject(id)) return false;
  taskStore.list().filter(t => t.project === id).forEach(t => removeTask(t.id));
  return true;
});

ipcMain.handle('fetch-image-base64', async (_event, url) => {
  return await fetchImageAsDataUrl(url);
});

// Giữ trang vừa quét để đổi tuỳ chọn (vd. không đọc giá) thì sinh lại kịch bản ngay, không quét lại.
let lastLadi = null;
ipcMain.handle('scrape-and-analyze-ladi', async (_event, url, opts = {}) => {
  try {
    const rawData = opts.reuse && lastLadi && lastLadi.url === url ? lastLadi.raw : await scrapeLadiPage(url);
    lastLadi = { url, raw: rawData };
    const analyzed = generateScriptsFromProduct(rawData, opts);
    return { success: true, data: analyzed };
  } catch (err) {
    console.error('[Main] Lỗi phân tích LadiPage:', err);
    return { success: false, error: err.message };
  }
});

// CÀI ĐẶT & FACEBOOK POSTER IPC HANDLERS
ipcMain.handle('get-user-config', () => {
  return configManager.get();
});

ipcMain.handle('save-user-config', (_event, cfg) => {
  return configManager.save(cfg);
});

ipcMain.handle('fetch-fb-pages', async (_event, token) => {
  try {
    const pages = await fetchFacebookPages(token);
    return { success: true, data: pages };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('verify-fb-token', async (_event, { pageId, token }) => {
  try {
    const info = await verifyFacebookPageToken(pageId, token);
    return { success: true, data: info };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('publish-fb-reels', async (_event, { filePath, caption, pageId, token }) => {
  try {
    const res = await publishFacebookReels(filePath, caption, pageId, token);
    return { success: true, data: res };
  } catch (err) {
    console.error('[Main] Lỗi đăng bài Facebook:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('logout-muse', async () => {
  const id = firstAccount();
  await pageFor(id).logout();
  accountStore.update(id, { loggedIn: false });
  return true;
});

ipcMain.handle('select-video-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn file video MP4 để đăng lên Facebook Reels',
    defaultPath: outDir(),
    filters: [
      { name: 'Video Files (*.mp4, *.mov)', extensions: ['mp4', 'mov', 'm4v', 'webm'] }
    ],
    properties: ['openFile']
  });
  if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// Thư viện: video ở thư mục lưu + ảnh ở storyboard/, mới nhất trước
ipcMain.handle('list-library', () => {
  const read = (dir, re, kind) => {
    try {
      return fs.readdirSync(dir).filter(f => re.test(f)).map(filename => {
        const localPath = path.join(dir, filename), st = fs.statSync(localPath);
        return { kind, filename, localPath, timestamp: st.mtimeMs, size: st.size };
      });
    } catch { return []; }
  };
  return [...read(outDir(), /\.(mp4|mov|webm|m4v)$/i, 'video'), ...read(path.join(outDir(), 'storyboard'), /\.(png|jpe?g|webp)$/i, 'image')]
    .sort((a, b) => b.timestamp - a.timestamp);
});
// Bỏ vào Thùng rác (chỉ file nằm trong thư mục lưu)
ipcMain.handle('trash-files', async (_event, paths = []) => {
  const root = path.resolve(outDir()) + path.sep;
  let n = 0;
  for (const p of paths) {
    if (typeof p !== 'string' || !path.resolve(p).startsWith(root)) continue;
    await shell.trashItem(p).then(() => n++, e => console.warn('[Main] Không xoá được', p, e.message));
  }
  return n;
});
// Cài đặt chung (user_config.json)
const SETTING_KEYS = ['outputDir', 'maxAttempts', 'imageTimeoutMin', 'videoTimeoutMin'];
ipcMain.handle('get-settings', () => ({ ...runConfig(), ...Object.fromEntries(SETTING_KEYS.map(k => [k, configManager.get()[k]])), outputDir: outDir() }));
ipcMain.handle('save-settings', (_event, patch = {}) => {
  configManager.save(Object.fromEntries(Object.entries(patch).filter(([k]) => SETTING_KEYS.includes(k))));
  return runConfig();
});
ipcMain.handle('select-folder', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'], defaultPath: outDir() });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('get-library-videos', async () => {
  try {
    if (!fs.existsSync(outDir())) return [];
    const files = fs.readdirSync(outDir());
    const videoFiles = files
      .filter(f => /\.(mp4|mov|webm|m4v)$/i.test(f))
      .map(filename => {
        const fullPath = path.join(outDir(), filename);
        const stat = fs.statSync(fullPath);
        return {
          filename,
          localPath: fullPath,
          timestamp: stat.mtimeMs,
          size: stat.size
        };
      })
      .sort((a, b) => b.timestamp - a.timestamp);
    return videoFiles;
  } catch (err) {
    console.error('Lỗi đọc thư mục video:', err);
    return [];
  }
});
