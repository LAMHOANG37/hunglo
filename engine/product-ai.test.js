// Chạy: node engine/product-ai.test.js — sinh kịch bản từ dữ liệu kiểu trang Christmas Build (LadiPage thật, 12/10).
const assert = require('assert');
const { generateScriptsFromProduct: gen, VOICE_MAX } = require('./product-ai');

const page = {
  title: 'Christmas Build — Hộp Lịch Mùa Vọng Giáng Sinh 24 Mô Hình Lắp Ráp',
  images: ['a.jpg', 'b.jpg', 'c.jpg'],
  prices: ['🎄 ƯU ĐÃI GIÁNG SINH: 1 HỘP 299K (GIÁ GỐC 490K) · COMBO 2 HỘP 549K FREESHIP · KIỂM HÀNG KHI NHẬN', '299.000đ', 'Chỉ 275k/hộp · Miễn phí giao hàng', 'Chỉ 250k/hộp · Miễn phí giao hàng'],
  policies: ['Nhận hàng → kiểm tra hàng → thanh toán'],
  textSnippet: [
    'Hộp Lịch Mùa Vọng Đếm Ngược Giáng Sinh 24 Ngày', 'Mỗi ngày mở 1 ô bí mật, tự tay lắp ghép', '24 mô hình mini',
    'độc đáo treo cây thông Noel. Hoạt động bổ ích gắn kết cả gia đình!', 'Tiết kiệm 39%',
    'Gồm: 1 hộp lịch 24 ô cửa đếm ngược + 24 bộ mảnh ghép nhân vật + 24 móc treo + sơ đồ hướng dẫn.',
    'Combo 2 Hộp (Quà Tặng Bạn Bè &amp; Bé Yêu)', 'Giao toàn quốc', 'Nhận hàng 5-7 ngày',
    '3 Bước Đón Giáng Sinh Cùng Gia Đình',
    'Mở 1 Ô Cửa Mỗi Ngày', 'Từ ngày 1/12 đến đêm Noel 24/12, mỗi ngày bóc một ô số bí mật để nhận các chi tiết gạch ghép mini bất ngờ.',
    'Lắp Ghép Mô Hình', 'Xem tờ hướng dẫn kèm theo, lắp ráp 40–80 mảnh ghép thành một nhân vật Giáng Sinh hoàn chỉnh trong 10-15 phút.',
    'Treo Cây Thông &amp; Sưu Tầm', 'Gắn khoen móc treo lên cây thông Noel, trang trí bàn học hoặc tích luỹ đủ bộ 24 nhân vật mùa đông rực rỡ.',
    '🎬 VIDEO THỰC TẾ',
    'Thay vì nhìn màn hình điện thoại, cả nhà quây quần bên bàn trà cùng lắp ghép những nhân vật Noel đáng yêu mỗi ngày.',
    '24 Mô hình không trùng lặp:', 'Đầy đủ biểu tượng Giáng sinh: Ông già Noel, người tuyết, tuần lộc, xe trượt tuyết, cây thông, nhà bánh gừng.',
    'Khoen treo tiện dụng:', 'Mỗi nhân vật đều có móc treo trên đầu để dễ dàng gắn dây trang trí cây thông Noel.',
    'Vì Sao Nên Chọn Christmas Build?', 'Lịch bánh kẹo / giấy thông thường', 'Trải nghiệm:', 'Mở quà trong vài giây, dễ mau chán',
    'Độ bền &amp; Lưu giữ:', 'Dùng 1 lần rồi bỏ, không giữ lại', 'KHUYÊN DÙNG', 'Christmas Build 2026', 'Trải nghiệm:', 'Hào hứng lắp ráp 15 phút mỗi ngày'
  ].join('\n')
};

const r = gen(page);
const f = r.facts;
assert.strictEqual(f.price, '299K');
assert.strictEqual(f.original, '490K');
assert.strictEqual(f.discount, 39);
assert.strictEqual(f.audience, 'các bố mẹ'); // "Bé Yêu" thắng "xe trượt tuyết"
assert.strictEqual(f.delivery, '5-7 ngày');
assert.deepStrictEqual(f.steps, ['mở 1 ô cửa mỗi ngày', 'lắp ghép mô hình', 'treo cây thông']);
assert.strictEqual(f.pain, 'nhìn màn hình điện thoại');
assert.ok(r.style.includes('giữ đúng'));

const names = r.scripts.map(s => s.name);
assert.deepStrictEqual(names, ['Tình huống & giải pháp', 'Trước & sau', 'Nhìn này! (demo)', 'Test thật tại kho', 'Hàng mới về & mở hộp', 'Quà Giáng Sinh', 'Giá sốc hôm nay', 'Tay review: lắp & bày (không lời)', 'Tay review: mở hộp quà & chi tiết (không lời)']);

// Kịch bản tay review: không lời, nhạc Noel, chỉ thấy tay, cảnh có shot list.
const quiet = r.scripts.filter(s => s.silent);
assert.strictEqual(quiet.length, 2);
for (const sc of quiet) {
  assert.ok(sc.audio.includes('Giáng Sinh') && /Không lời/.test(sc.audio) && /không thấy mặt/.test(sc.style));
  assert.ok(sc.scenes.every(x => x.voiceover === '' && x.musePrompt.includes('Đầu cảnh') && x.image));
}
assert.ok(gen({ title: 'Máy xay mini', textSnippet: '' }).scripts.find(s => s.silent).audio.includes('Giáng Sinh'));

const all = gen(page, { noPrice: true }).scripts.concat(r.scripts).filter(s => !s.silent).flatMap(s => s.scenes);
for (const s of all) {
  const v = s.voiceover;
  const n = v.split(/\s+/).length;
  assert.ok(n >= 34 && n <= VOICE_MAX, `${n} chữ: ${v}`);
  assert.ok(!/[+&→/%]|amp;|\d-\d|Gồm:|nhé.*nhé/.test(v), `ký hiệu TTS đọc vấp: ${v}`);
  assert.ok(s.musePrompt.length > 30 && s.image);
}
// Lời đọc lấy đúng dữ kiện trang: giá gốc → giá bán, combo theo hộp, hạn giao trước lễ, đủ đồ trong hộp, câu ghép bị ngắt dòng.
const text = r.scripts.filter(s => !s.silent).flatMap(s => s.scenes.map(x => x.voiceover)).join('\n');
assert.ok(text.includes('Giá gốc 490 nghìn, hôm nay chỉ còn 299 nghìn, mua combo chỉ còn 250 nghìn một hộp'));
assert.ok(text.includes('kịp trước Noel'));
assert.ok(text.includes('24 móc treo và sơ đồ hướng dẫn'));
assert.ok(text.includes('tự tay lắp ghép 24 mô hình mini độc đáo'));
assert.ok(text.includes('1 tháng 12') || !text.includes('1/12'));

// Không đọc giá: không còn số tiền trong lời, giá để ở link.
const np = gen(page, { noPrice: true });
const npText = np.scripts.flatMap(s => s.scenes.map(x => x.voiceover)).join('\n');
assert.ok(!/\d+\s*nghìn|triệu/.test(npText), npText);
assert.ok(npText.includes('giá ưu đãi mình để ở link'));
assert.strictEqual(np.scripts[6].name, 'Ưu đãi hôm nay');

// Trang nghèo dữ liệu vẫn ra đủ góc cơ bản, lời không rỗng.
const bare = gen({ title: 'Máy xay mini', textSnippet: '' });
assert.ok(bare.scripts.length >= 5 && bare.scripts.every(s => s.silent || s.scenes.every(x => x.voiceover.split(/\s+/).length >= 15)));

// 24s = 3 cảnh × 8s, 16s = 2 cảnh × 8s: lời ngắn lại (32–37 chữ), mốc giờ theo 8s, 16s giữ mở đầu + chốt.
for (const [scenes, want] of [[3, ['0–8s', '8–16s', '16–24s']], [2, ['0–8s', '8–16s']]]) {
  for (const sc of gen(page, { sceneSecs: 8, scenes }).scripts.filter(s => !s.silent)) {
    assert.deepStrictEqual(sc.scenes.map(x => x.time.split(' ')[0]), want, sc.name);
    for (const x of sc.scenes) {
      const n = x.voiceover.split(/\s+/).length;
      assert.ok(n >= 26 && n <= 37, `${sc.name} 8s: ${n} chữ: ${x.voiceover}`);
    }
    if (scenes === 2) assert.ok(/link|đặt|chốt/i.test(sc.scenes[1].voiceover), sc.name);
  }
}
assert.strictEqual(gen(page).scripts[0].scenes[2].time.split(' ')[0], '20–30s'); // gọi sau vẫn về 10s

console.log('product-ai OK');
