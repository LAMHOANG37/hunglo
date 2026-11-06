// Chạy: node engine/task-store.test.js — thư mục tạm, không cần Electron.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const TaskStore = require('./task-store');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mss-store-'));
// tasks mới nhất ở đầu: C queued, B processing không sessionId, A processing có sessionId
fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify([
  { id: 'C', status: 'queued', images: [] },
  { id: 'B', status: 'processing', sessionId: '', images: [] },
  { id: 'A', status: 'processing', sessionId: 's1', images: [] }
]));
const s = new TaskStore(dir);
assert.strictEqual(s.get('A').status, 'processing');
assert.strictEqual(s.get('B').status, 'queued');
assert.strictEqual(s.nextRunnable, undefined); // scheduler chọn task, store không chọn nữa
const h = s.add({ prompt: 'x', held: true, accountId: 'acc_1' });
assert.strictEqual(h.held, true);
assert.strictEqual(h.accountId, ''); // tài khoản do scheduler gán lúc chạy
assert.strictEqual(s.add({ prompt: 'x' }).held, false);
assert.strictEqual(s.add({ prompt: 'x', ratio: '9:16' }).ratio, '9:16');
assert.strictEqual(s.add({ prompt: 'x', ratio: '2:1' }).ratio, '');
assert.strictEqual(s.add({ prompt: 'x' }).sessionId, '');
assert.deepStrictEqual(TaskStore.RATIOS, ['9:16', '16:9', '1:1', '4:3', '3:4']);
// tắt app ngay sau khi gửi → flush() ghi liền (sessionId không mất), qua file tạm rồi đổi tên
s.update('A', { sessionId: 's-flush' });
s.flush();
assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8')).find(t => t.id === 'A').sessionId, 's-flush');
assert.deepStrictEqual(fs.readdirSync(dir).filter(f => f.includes('tmp')), []);
// Tạo lại / sửa task: ảnh của task cũ được chép riêng → xoá task cũ không làm mất ảnh của task mới
const src = s.add({ prompt: 'p', images: [{ dataUrl: 'data:image/png;base64,AAAA' }] });
const copy = s.add({ prompt: 'p2', images: src.images });
assert.notStrictEqual(copy.images[0].imageLocalPath, src.images[0].imageLocalPath);
s.remove(src.id);
setTimeout(() => assert.ok(fs.existsSync(copy.images[0].imageLocalPath), 'ảnh task mới còn'), 100);
setTimeout(() => fs.rmSync(dir, { recursive: true, force: true }), 300);
// Dự án: lưu theo task, mặc định 'default', id lạ bị làm sạch
{
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mss-store-'));
  const st = new TaskStore(d2);
  assert.strictEqual(st.add({ prompt: 'x' }).project, 'default');
  assert.strictEqual(st.add({ prompt: 'x', project: 'prj_ab12' }).project, 'prj_ab12');
  assert.strictEqual(st.add({ prompt: 'x', project: '../x' }).project, 'default');
  st.flush();
  fs.rmSync(d2, { recursive: true, force: true });
}
console.log('task-store.test OK');
