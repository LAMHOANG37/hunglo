/**
 * GHÉP ẢNH CHO MỖI PROMPT — người mẫu → nhân vật có tên trong prompt → 1 ảnh luân phiên → ảnh tham chiếu.
 * Thuần (không DOM): dùng ở giao diện (window.Compose) và test bằng node.
 */
(function (root) {
  'use strict';
  const MAX = 6;
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Khớp nguyên từ, có dấu tiếng Việt: viết đúng hoa thường như tên ("Mai" không khớp "ngày mai"), hoặc @tên (hoa thường tuỳ ý)
  const END = '(?=$|[^\\p{L}\\p{N}])';
  function findCharacters(prompt, characters = []) {
    const p = String(prompt).normalize('NFC');
    return characters.filter(c => {
      const n = c.name && esc(c.name.normalize('NFC'));
      return n && (new RegExp(`(^|[^\\p{L}\\p{N}@])${n}${END}`, 'u').test(p) || new RegExp(`@${n}${END}`, 'iu').test(p));
    });
  }
  // Bỏ dấu @ trước tên nhân vật trước khi gửi Muse
  const untag = (prompt, characters = []) => characters.reduce((p, c) => (c.name
    ? p.replace(new RegExp(`@(${esc(c.name.normalize('NFC'))})${END}`, 'giu'), '$1') : p), String(prompt).normalize('NFC'));

  function imagesFor({ prompt, index = 0, characters = [], model, rotate, refs = [], mode = 'shared' }) {
    const chars = findCharacters(prompt, characters);
    const list = [];
    if (model?.on) list.push(...model.images);
    for (const c of chars) list.push(...c.images);
    let rotateIdx = rotate?.idx || 0;
    if (rotate?.on && rotate.images.length) list.push(rotate.images[rotateIdx++ % rotate.images.length]);
    list.push(...(mode === 'pair' ? (refs[index] ? [refs[index]] : []) : refs));
    const uniq = [...new Set(list)];
    return { images: uniq.slice(0, MAX), cut: Math.max(0, uniq.length - MAX), rotateIdx, chars };
  }

  const api = { findCharacters, untag, imagesFor, MAX };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.Compose = api;
})(this);
