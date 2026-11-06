/**
 * TASK STORE — lịch sử task render, lưu ở userData/tasks.json (còn nguyên sau khi tắt app).
 * Trạng thái: queued → processing → succeeded | failed | cancelled.
 * Ảnh dạng data: được ghi ra userData/task-images/ để file JSON nhẹ và chạy lại được sau khi mở lại app.
 */

const { app } = require('electron');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const RATIOS = ['9:16', '16:9', '1:1', '4:3', '3:4'];
const MAX_TASKS = 500; // ponytail: JSON ghi lại cả file mỗi lần đổi; nhiều hơn vài nghìn task thì chuyển sang SQLite.

class TaskStore extends EventEmitter {
  constructor(dir = app.getPath('userData')) {
    super();
    this.file = path.join(dir, 'tasks.json');
    this.imgDir = path.join(dir, 'task-images');
    try { this.tasks = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.tasks = []; }
    // Task dở khi app tắt: đã gửi lên Muse (có sessionId) → dò tiếp phiên đó, không gửi lại; chưa gửi → xếp hàng lại.
    for (const t of this.tasks) {
      if (t.status === 'processing' && !t.sessionId) t.status = 'queued';
    }
    this.save();
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 200);
  }

  // Ghi ngay (gọi cả khi tắt app). File tạm + đổi tên: tắt giữa lúc ghi không làm hỏng tasks.json
  flush() {
    clearTimeout(this.saveTimer);
    const tmp = this.file + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.tasks));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[TaskStore] Không ghi được tasks.json:', e.message);
    }
  }

  list(status) {
    return status ? this.tasks.filter(t => t.status === status) : this.tasks;
  }

  get(id) {
    return this.tasks.find(t => t.id === id);
  }

  // kind 'image': Muse tạo ảnh (storyboard), chờ đủ `expect` ảnh. thread: chạy tiếp trong đoạn chat Muse đã có thay vì mở chat mới.
  // held: chỉ thêm vào hàng đợi, chưa chạy tới khi bấm Chạy. accountId do scheduler gán lúc chạy.
  add({ prompt, images = [], timeoutMin = 10, source = 'ui', label = '', kind = 'video', expect = 1, thread = '', account = '', ratio = '', held = false, project = 'default' }) {
    const id = 'task_' + crypto.randomBytes(8).toString('hex');
    fs.mkdirSync(this.imgDir, { recursive: true });
    const saved = images.map((img, k) => {
      const data = img.imageBase64 || img.dataUrl || '';
      const m = /^data:image\/(\w+);base64,(.*)$/s.exec(data);
      const local = img.imageLocalPath || '';
      // Ảnh của task khác (Tạo lại / Sửa) hoặc của Tư liệu → chép riêng, vì xoá chỗ kia sẽ xoá ảnh
      if (!m && (local.startsWith(this.imgDir) || local.includes(`${path.sep}studio-images${path.sep}`)) && fs.existsSync(local)) {
        const file = path.join(this.imgDir, `${id}_${k}${path.extname(local)}`);
        fs.copyFileSync(local, file);
        return { imageUrl: '', imageLocalPath: file };
      }
      if (!m) return { imageUrl: img.imageUrl || '', imageLocalPath: local };
      const file = path.join(this.imgDir, `${id}_${k}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`);
      fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
      return { imageUrl: '', imageLocalPath: file };
    });
    const task = {
      id, source, label: String(label).slice(0, 120), prompt: String(prompt), images: saved,
      kind: kind === 'image' ? 'image' : 'video', expect: Math.min(Math.max(parseInt(expect, 10) || 1, 1), 6),
      ratio: RATIOS.includes(ratio) ? ratio : '', sessionId: '', accountId: '', held: held === true,
      project: /^[\w-]{1,40}$/.test(project) ? project : 'default',
      thread: /^https:\/\/muse\.ai\/thread\/[\w-]+$/.test(thread) ? thread : '',
      // Tài khoản giữ đoạn chat `thread` (chat thuộc về tài khoản) → scheduler ưu tiên đúng tài khoản đó
      pin: /^[\w-]{1,40}$/.test(account) ? account : '',
      timeoutMin: Math.min(Math.max(Number(timeoutMin) || 10, 2), 60),
      status: 'queued', attempts: 0, createdAt: Date.now(), startedAt: 0, finishedAt: 0, files: [], error: ''
    };
    this.tasks.unshift(task);
    // Bỏ bớt task cũ đã kết thúc khi vượt giới hạn
    while (this.tasks.length > MAX_TASKS) {
      const i = this.tasks.findLastIndex(t => t.status !== 'queued' && t.status !== 'processing');
      if (i < 0) break;
      this.remove(this.tasks[i].id);
    }
    this.save();
    this.emit('update', task);
    return task;
  }

  update(id, patch) {
    const task = this.get(id);
    if (!task) return null;
    Object.assign(task, patch);
    this.save();
    this.emit('update', task);
    return task;
  }

  remove(id) {
    const task = this.get(id);
    if (!task) return false;
    for (const img of task.images) if (img.imageLocalPath.startsWith(this.imgDir)) fs.unlink(img.imageLocalPath, () => {});
    this.tasks = this.tasks.filter(t => t !== task);
    this.save();
    this.emit('update', { id, removed: true });
    return true;
  }
}

module.exports = TaskStore;
module.exports.RATIOS = RATIOS;
