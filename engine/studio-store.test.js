// Chạy: node engine/studio-store.test.js — thư mục tạm, không cần Electron.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { StudioStore } = require('./studio-store');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mss-studio-'));
const png = 'data:image/png;base64,' + Buffer.from('x').toString('base64');
const s = new StudioStore(dir);

// Mặc định: dự án 'default', đang mở
assert.deepStrictEqual(s.get().projects, [{ id: 'default', name: 'Mặc định', paused: false }]);
assert.strictEqual(s.get().current, 'default');

// Dự án: thêm, đổi tên, tạm dừng, không xoá được default
const p = s.addProject('  Noel  ');
assert.strictEqual(p.name, 'Noel');
s.updateProject(p.id, { name: 'Noel 2026', paused: true, junk: 1 });
assert.deepStrictEqual(s.get().projects[1], { id: p.id, name: 'Noel 2026', paused: true });
assert.deepStrictEqual([...s.pausedProjects()], [p.id]);
s.setCurrent(p.id);
assert.strictEqual(s.get().current, p.id);
s.setCurrent('khong-co');
assert.strictEqual(s.get().current, p.id);
assert.strictEqual(s.removeProject('default'), false);
assert.strictEqual(s.removeProject(p.id), true);
assert.strictEqual(s.get().current, 'default');
assert.strictEqual(s.get().projects.length, 1);

// Ảnh: data URL hoặc file → chép vào studio-images
const a = s.addImage({ dataUrl: png });
assert.ok(a.startsWith(path.join(dir, 'studio-images')) && fs.existsSync(a));
const src = path.join(dir, 'goc.jpg'); fs.writeFileSync(src, 'y');
const b = s.addImage({ filePath: src });
assert.ok(b.endsWith('.jpg') && fs.readFileSync(b, 'utf8') === 'y');
assert.strictEqual(s.addImage({ dataUrl: 'rác' }), '');

// Nhân vật: tối đa 3 ảnh; tên rỗng bỏ; ảnh ngoài studio-images bị loại
s.save({ characters: [{ id: 'c1', name: ' Lan ', images: [a, b, a, b] }, { id: 'c2', name: '', images: [] }, { id: 'c3', name: 'Minh', images: ['/etc/passwd'] }] });
assert.deepStrictEqual(s.get().characters, [{ id: 'c1', name: 'Lan', images: [a, b, a] }, { id: 'c3', name: 'Minh', images: [] }]);

// Mẫu prompt, người mẫu, luân phiên
s.save({ templates: [{ id: 't1', name: 'Cận cảnh', text: 'zoom chậm' }, { id: 't2', name: '', text: '' }], model: { on: true, images: [a] }, rotate: { on: true, images: [a, b], idx: 5 } });
assert.deepStrictEqual(s.get().templates, [{ id: 't1', name: 'Cận cảnh', text: 'zoom chậm' }]);
assert.deepStrictEqual(s.get().model, { on: true, images: [a] });
assert.deepStrictEqual(s.get().rotate, { on: true, images: [a, b], idx: 5 });

// Bỏ ảnh khỏi mọi danh sách → xoá file chép; còn dùng ở chỗ khác thì giữ
s.save({ characters: [], model: { on: false, images: [] }, rotate: { on: false, images: [a], idx: 0 } });
assert.ok(fs.existsSync(a));
assert.ok(!fs.existsSync(b));

// Lưu xuống đĩa, mở lại còn nguyên
s.flush();
const s2 = new StudioStore(dir);
assert.deepStrictEqual(s2.get().rotate, { on: false, images: [a], idx: 0 });
// File hỏng → mặc định
fs.writeFileSync(path.join(dir, 'studio.json'), '{hỏng');
assert.strictEqual(new StudioStore(dir).get().current, 'default');

fs.rmSync(dir, { recursive: true, force: true });
console.log('studio-store.test OK');
