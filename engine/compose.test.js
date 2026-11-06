// Chạy: node engine/compose.test.js — ghép ảnh cho từng prompt (ui/compose.js, dùng chung với giao diện).
const assert = require('assert');
const { imagesFor, findCharacters, untag } = require('../ui/compose');

const chars = [{ name: 'Lan', images: ['lan1', 'lan2'] }, { name: 'Minh Anh', images: ['ma'] }, { name: 'An', images: ['an'] }];

// Khớp nguyên từ, đúng hoa thường; @tên thì hoa thường tuỳ ý; có dấu tiếng Việt
assert.deepStrictEqual(findCharacters('Lan đi chợ với @minh anh', chars).map(c => c.name), ['Lan', 'Minh Anh']);
assert.deepStrictEqual(findCharacters('LAN đi chợ, ngày mai', [...chars, { name: 'Mai', images: [] }]), []);
assert.strictEqual(untag('@lan và @Minh Anh, email a@b', chars), 'lan và Minh Anh, email a@b');
assert.deepStrictEqual(findCharacters('Lanh lảnh, Anh đẹp', chars), []);
assert.deepStrictEqual(findCharacters('An.', chars).map(c => c.name), ['An']);

// Thứ tự: người mẫu → nhân vật → luân phiên → tham chiếu; bỏ trùng
let r = imagesFor({ prompt: 'Lan cười', index: 0, characters: chars, model: { on: true, images: ['m'] }, rotate: { on: true, images: ['r0', 'r1'], idx: 1 }, refs: ['x', 'lan1'], mode: 'shared' });
assert.deepStrictEqual(r.images, ['m', 'lan1', 'lan2', 'r1', 'x']);
assert.strictEqual(r.rotateIdx, 2);
assert.strictEqual(r.cut, 0);

// Tắt người mẫu/luân phiên → không gắn, idx giữ nguyên
r = imagesFor({ prompt: 'cảnh biển', index: 0, characters: chars, model: { on: false, images: ['m'] }, rotate: { on: false, images: ['r0'], idx: 7 }, refs: [], mode: 'shared' });
assert.deepStrictEqual(r.images, []);
assert.strictEqual(r.rotateIdx, 7);

// Ghép cặp: prompt i dùng ảnh i
r = imagesFor({ prompt: 'p', index: 1, characters: [], refs: ['a', 'b'], mode: 'pair' });
assert.deepStrictEqual(r.images, ['b']);

// Quá 6 → cắt, báo số bị cắt
r = imagesFor({ prompt: 'p', index: 0, characters: [], model: { on: true, images: ['1', '2', '3'] }, refs: ['4', '5', '6', '7', '8'], mode: 'shared' });
assert.deepStrictEqual(r.images, ['1', '2', '3', '4', '5', '6']);
assert.strictEqual(r.cut, 2);

console.log('compose.test OK');
