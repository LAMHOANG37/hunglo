/**
 * STUDIO STORE — dự án, nhân vật, mẫu prompt, người mẫu cố định, ảnh luân phiên.
 * Lưu userData/studio.json; ảnh chép vào userData/studio-images/ (bỏ khỏi mọi danh sách → xoá file chép).
 */
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT = { id: 'default', name: 'Mặc định', paused: false };
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const newId = p => p + crypto.randomBytes(4).toString('hex');

class StudioStore extends EventEmitter {
  constructor(dir) {
    super();
    this.file = path.join(dir, 'studio.json');
    this.imgDir = path.join(dir, 'studio-images');
    let d = {};
    try { d = JSON.parse(fs.readFileSync(this.file, 'utf8')) || {}; } catch {}
    this.data = this.clean(d);
  }

  img(list, max) {
    return (Array.isArray(list) ? list : []).filter(p => typeof p === 'string' && p.startsWith(this.imgDir + path.sep)).slice(0, max);
  }

  clean(d) {
    const projects = [DEFAULT, ...(Array.isArray(d.projects) ? d.projects : [])
      .filter(p => p && /^prj_[\w]+$/.test(p.id))
      .map(p => ({ id: p.id, name: str(p.name, 60) || 'Dự án', paused: p.paused === true }))];
    return {
      projects,
      current: projects.some(p => p.id === d.current) ? d.current : 'default',
      characters: (Array.isArray(d.characters) ? d.characters : []).filter(c => c && str(c.name, 40))
        .map(c => ({ id: str(c.id, 40) || newId('chr_'), name: str(c.name, 40), images: this.img(c.images, 3) })),
      templates: (Array.isArray(d.templates) ? d.templates : []).filter(t => t && str(t.name, 60))
        .map(t => ({ id: str(t.id, 40) || newId('tpl_'), name: str(t.name, 60), text: String(t.text ?? '').slice(0, 5000) })),
      model: { on: d.model?.on === true, images: this.img(d.model?.images, 3) },
      rotate: { on: d.rotate?.on === true, images: this.img(d.rotate?.images, 20), idx: Math.max(0, parseInt(d.rotate?.idx, 10) || 0) }
    };
  }

  refs(d = this.data) {
    return new Set([...d.characters.flatMap(c => c.images), ...d.model.images, ...d.rotate.images]);
  }

  get() { return this.data; }

  // patch: một phần dữ liệu (characters/templates/model/rotate/...); ảnh không còn dùng → xoá
  save(patch = {}) {
    const before = this.refs();
    this.data = this.clean({ ...this.data, ...patch });
    const after = this.refs();
    for (const p of before) if (!after.has(p)) fs.unlink(p, () => {});
    this.flush();
    this.emit('update', this.data);
    return this.data;
  }

  flush() {
    const tmp = this.file + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (e) { console.error('[StudioStore] Không ghi được studio.json:', e.message); }
  }

  addImage({ dataUrl, filePath } = {}) {
    fs.mkdirSync(this.imgDir, { recursive: true });
    const m = /^data:image\/(\w+);base64,(.*)$/s.exec(dataUrl || '');
    if (m) {
      const file = path.join(this.imgDir, newId('img_') + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]));
      fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
      return file;
    }
    if (filePath && fs.existsSync(filePath)) {
      const file = path.join(this.imgDir, newId('img_') + (path.extname(filePath).toLowerCase() || '.jpg'));
      fs.copyFileSync(filePath, file);
      return file;
    }
    return '';
  }

  addProject(name) {
    const p = { id: newId('prj_'), name: str(name, 60) || 'Dự án', paused: false };
    this.save({ projects: [...this.data.projects, p] });
    return p;
  }

  updateProject(id, { name, paused } = {}) {
    this.save({ projects: this.data.projects.map(p => p.id !== id ? p : { ...p, ...(name !== undefined && { name }), ...(paused !== undefined && { paused: paused === true }) }) });
  }

  removeProject(id) {
    if (id === 'default' || !this.data.projects.some(p => p.id === id)) return false;
    this.save({ projects: this.data.projects.filter(p => p.id !== id), current: this.data.current === id ? 'default' : this.data.current });
    return true;
  }

  setCurrent(id) {
    if (this.data.projects.some(p => p.id === id)) this.save({ current: id });
  }

  pausedProjects() {
    return new Set(this.data.projects.filter(p => p.paused).map(p => p.id));
  }
}

module.exports = { StudioStore };
