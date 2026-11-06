/**
 * TƯ LIỆU + DỰ ÁN — nhân vật, mẫu prompt, người mẫu cố định, ảnh luân phiên (lưu ở main: studio.json)
 * và ô chọn dự án trên thanh trên. Tab khác đọc qua App.studioData() / App.onStudio(fn).
 */
(function () {
  'use strict';
  const { api, $, escapeHtml, fileUrl, toast } = window.App;
  let data = null;
  const subs = [];
  const uid = p => p + Math.random().toString(36).slice(2, 10);

  // Hỏi tên (Electron không có window.prompt)
  function askName(title, value = '') {
    const dlg = $('name-dlg');
    $('name-dlg-title').textContent = title;
    $('name-dlg-input').value = value;
    dlg.showModal();
    return new Promise(r => dlg.addEventListener('close', () => r(dlg.returnValue === 'ok' ? $('name-dlg-input').value.trim() : ''), { once: true }));
  }

  async function pickImages(room) {
    const files = await api.selectImageFile(true);
    if ((files || []).length > room) toast(`Chỉ thêm được ${room} ảnh nữa.`, 'warn');
    const out = [];
    for (const f of (files || []).slice(0, Math.max(room, 0))) {
      const p = await api.addStudioImage({ filePath: f.filePath });
      if (p) out.push(p);
    }
    return out;
  }

  const save = patch => api.saveStudio(patch).catch(e => toast(e.message, 'danger'));
  const strip = (list, max, key) => list.map((p, i) => `<div class="thumb-wrap"><img src="${escapeHtml(fileUrl(p))}" alt=""><button type="button" class="thumb-x" data-x="${key}" data-i="${i}" aria-label="Bỏ ảnh">✕</button></div>`).join('')
    + (list.length < max ? `<button type="button" class="thumb-add" data-add="${key}">+ Ảnh</button>` : '');

  // ---------- Dự án ----------
  function renderProjects() {
    const opts = data.projects.map(p => `<option value="${p.id}">${escapeHtml(p.name)}${p.paused ? ' (tạm dừng)' : ''}</option>`).join('');
    $('prj-select').innerHTML = opts;
    $('prj-select').value = data.current;
    $('prj-list').innerHTML = data.projects.map(p => `<div class="prj-row" data-id="${p.id}">
        <input class="input" value="${escapeHtml(p.name)}" data-rename${p.id === 'default' ? ' disabled' : ''}>
        ${p.id === 'default' ? '<span></span><span></span>' : `<button type="button" class="btn-ghost btn-sm" data-pause>${p.paused ? 'Chạy tiếp' : 'Tạm dừng'}</button>
        <button type="button" class="btn-danger btn-sm" data-del>Xoá</button>`}
      </div>`).join('');
  }
  $('prj-select').addEventListener('change', e => api.setProject(e.target.value));
  $('prj-manage').addEventListener('click', () => $('prj-dlg').showModal());
  $('prj-add').addEventListener('click', async () => {
    const name = $('prj-new').value.trim();
    if (!name) return;
    const p = await api.addProject(name);
    $('prj-new').value = '';
    await api.setProject(p.id);
  });
  $('prj-list').addEventListener('change', e => {
    const id = e.target.closest('[data-id]')?.dataset.id;
    if (id && e.target.matches('[data-rename]')) api.updateProject(id, { name: e.target.value });
  });
  $('prj-list').addEventListener('click', async e => {
    const id = e.target.closest('[data-id]')?.dataset.id;
    const p = data.projects.find(x => x.id === id);
    if (!p) return;
    if (e.target.matches('[data-pause]')) api.updateProject(id, { paused: !p.paused });
    if (e.target.matches('[data-del]')) {
      if (!confirm(`Xoá dự án "${p.name}"? Task của dự án sẽ bị huỷ và xoá khỏi hàng đợi (file đã tải về vẫn giữ). Không hoàn tác được.`)) return;
      await api.removeProject(id);
      toast('Đã xoá dự án.', 'ok');
    }
  });

  // ---------- Tư liệu ----------
  function renderAssets() {
    $('as-chars').innerHTML = data.characters.length ? data.characters.map((c, k) => `<div class="as-item" data-k="${k}">
        <div class="as-item-head"><input class="input" value="${escapeHtml(c.name)}" data-f="name" placeholder="Tên (viết trong prompt)"><button type="button" class="btn-ghost btn-sm" data-del="char">Xoá</button></div>
        <div class="img-strip">${strip(c.images, 3, 'char')}</div>
      </div>`).join('') : '<p class="muted small">Chưa có nhân vật. Prompt có tên nhân vật (viết hoa đúng như tên, hoặc @tên) sẽ tự gắn ảnh của họ. Ảnh đẹp ở Thư viện cũng lưu thẳng vào đây được.</p>';
    $('as-tpls').innerHTML = data.templates.length ? data.templates.map((t, k) => `<div class="as-item" data-k="${k}">
        <div class="as-item-head"><input class="input" value="${escapeHtml(t.name)}" data-f="name" placeholder="Tên mẫu"><button type="button" class="btn-ghost btn-sm" data-del="tpl">Xoá</button></div>
        <textarea class="textarea" rows="3" data-f="text" placeholder="Nội dung mẫu">${escapeHtml(t.text)}</textarea>
      </div>`).join('') : '<p class="muted small">Chưa có mẫu. Có thể lưu từ ô prompt ở Studio.</p>';
    $('as-model-on').checked = data.model.on;
    $('as-model').innerHTML = strip(data.model.images, 3, 'model');
    $('as-rotate-on').checked = data.rotate.on;
    $('as-rotate').innerHTML = strip(data.rotate.images, 20, 'rotate');
    const n = data.rotate.images.length;
    $('as-rotate-hint').textContent = `Mỗi task lấy 1 ảnh kế tiếp (tối đa 20 ảnh).${n ? ` Ảnh tiếp theo: #${data.rotate.idx % n + 1}/${n}.` : ''}`;
  }

  const tab = $('tab-assets');
  // Sửa chữ: lưu, không vẽ lại (giữ con trỏ)
  tab.addEventListener('change', e => {
    const f = e.target.dataset.f;
    const k = +e.target.closest('[data-k]')?.dataset.k;
    if (e.target.id === 'as-model-on') return save({ model: { ...data.model, on: e.target.checked } });
    if (e.target.id === 'as-rotate-on') return save({ rotate: { ...data.rotate, on: e.target.checked } });
    if (!f) return;
    const inChars = e.target.closest('#as-chars');
    const list = (inChars ? data.characters : data.templates).map((x, i) => i === k ? { ...x, [f]: e.target.value } : x);
    if (f === 'name' && !e.target.value.trim()) { toast('Tên không được để trống.', 'warn'); return renderAssets(); }
    save(inChars ? { characters: list } : { templates: list });
  });
  tab.addEventListener('click', async e => {
    const t = e.target;
    const k = +t.closest('[data-k]')?.dataset.k;
    if (t.id === 'as-char-add') {
      const name = await askName('Tên nhân vật (viết đúng như trong prompt)');
      if (name) save({ characters: [...data.characters, { id: uid('chr_'), name, images: [] }] });
    }
    if (t.id === 'as-tpl-add') {
      const name = await askName('Tên mẫu prompt');
      if (name) save({ templates: [...data.templates, { id: uid('tpl_'), name, text: '' }] });
    }
    if (t.dataset.del === 'char' && confirm('Xoá nhân vật này?')) save({ characters: data.characters.filter((_, i) => i !== k) });
    if (t.dataset.del === 'tpl' && confirm('Xoá mẫu này?')) save({ templates: data.templates.filter((_, i) => i !== k) });
    const key = t.dataset.add || t.dataset.x;
    if (!key) return;
    const cur = key === 'char' ? data.characters[k].images : data[key].images;
    const max = key === 'rotate' ? 20 : 3;
    const next = t.dataset.add ? cur.concat(await pickImages(max - cur.length)) : cur.filter((_, i) => i !== +t.dataset.i);
    if (key === 'char') save({ characters: data.characters.map((c, i) => i === k ? { ...c, images: next } : c) });
    else save({ [key]: { ...data[key], images: next } });
  });

  function set(d) {
    data = d;
    renderProjects();
    if (!tab.contains(document.activeElement) || document.activeElement.tagName === 'BUTTON') renderAssets();
    subs.forEach(f => f(d));
  }
  window.App.studioData = () => data;
  window.App.onStudio = fn => { subs.push(fn); if (data) fn(data); };
  window.App.askName = askName;
  if (api) {
    api.onStudioUpdate(set);
    api.getStudio().then(set);
  }
})();
