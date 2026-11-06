/**
 * STUDIO — soạn lệnh | hàng đợi task (mọi nguồn: Studio, Kịch bản, API, CRM) | chi tiết task đang chọn.
 * Task chạy ở main (pool nhiều tài khoản); ở đây chỉ gửi task, xem và thao tác.
 */
(function () {
  'use strict';
  const { api, $, escapeHtml, fileUrl, mmss, fmtTime, chip, toast, remember } = window.App;

  const MAX_REFS = 6;
  const FINISHED = ['succeeded', 'failed', 'cancelled'];
  let kind = 'video';
  let imgMode = 'shared';
  let refs = []; // [{ dataUrl, name }]
  let tasks = [];
  let accNames = {};
  let sort = 'new';
  let focusId = '';
  let q = '';
  let statusF = '';
  const studio = () => window.App.studioData() || { current: 'default', characters: [], templates: [], model: { on: false, images: [] }, rotate: { on: false, images: [], idx: 0 } };
  const checked = new Set();

  // ---------- Soạn lệnh ----------
  const promptEl = $('st-prompt');
  const sepEl = $('st-sep');
  remember($('st-ratio'), 'st.ratio');
  const ratioEl = $('st-ratio');
  const syncRatio = () => $('st-ratio-seg').querySelectorAll('[data-r]').forEach(b => b.classList.toggle('active', b.dataset.r === ratioEl.value));
  $('st-ratio-seg').addEventListener('click', e => {
    const b = e.target.closest('[data-r]');
    if (b) { ratioEl.value = b.dataset.r; ratioEl.dispatchEvent(new Event('change')); syncRatio(); }
  });
  syncRatio();
  remember($('st-n'), 'st.n');
  remember(sepEl, 'st.sep');

  function prompts() {
    const sep = sepEl.value;
    return promptEl.value.split(sep ? sep : /\n\s*\n/).map(s => s.trim()).filter(Boolean);
  }
  function updateCount() {
    const n = prompts().length;
    $('st-count').textContent = n ? `${n} prompt · ${promptEl.value.length} ký tự` : '';
    const names = window.Compose.findCharacters(promptEl.value, studio().characters).map(c => c.name);
    $('st-chars').textContent = names.length ? `Nhân vật nhận ra: ${names.join(', ')}` : '';
  }

  // Mẫu prompt, người mẫu, ảnh luân phiên (dữ liệu ở tab Tư liệu)
  let prjSeen = '';
  window.App.onStudio(d => {
    $('st-tpl').innerHTML = '<option value="">Chèn mẫu prompt…</option>' + d.templates.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
    $('st-model').checked = d.model.on;
    $('st-rotate').checked = d.rotate.on;
    $('st-model-n').textContent = `(${d.model.images.length} ảnh)`;
    $('st-rotate-n').textContent = `(${d.rotate.images.length} ảnh)`;
    if (prjSeen !== d.current) { prjSeen = d.current; checked.clear(); }
    updateCount();
    renderQueue();
  });
  $('st-tpl').addEventListener('change', e => {
    const t = studio().templates.find(x => x.id === e.target.value);
    e.target.value = '';
    if (!t) return;
    const a = promptEl.selectionStart ?? promptEl.value.length;
    promptEl.setRangeText(t.text, a, promptEl.selectionEnd ?? a, 'end');
    promptEl.focus();
    updateCount();
  });
  $('st-tpl-save').addEventListener('click', async () => {
    const text = promptEl.value.trim();
    if (!text) return toast('Ô prompt đang trống.', 'warn');
    const name = await window.App.askName('Tên mẫu prompt', text.slice(0, 40));
    if (!name) return;
    await api.saveStudio({ templates: [...studio().templates, { id: '', name, text }] });
    toast('Đã lưu mẫu.', 'ok');
  });
  $('st-model').addEventListener('change', e => {
    if (e.target.checked && !studio().model.images.length) { e.target.checked = false; toast('Chưa có ảnh người mẫu — thêm ở tab Tư liệu.', 'warn'); return; }
    api.saveStudio({ model: { ...studio().model, on: e.target.checked } });
  });
  $('st-rotate').addEventListener('change', e => {
    if (e.target.checked && !studio().rotate.images.length) { e.target.checked = false; toast('Chưa có ảnh luân phiên — thêm ở tab Tư liệu.', 'warn'); return; }
    api.saveStudio({ rotate: { ...studio().rotate, on: e.target.checked } });
  });
  promptEl.addEventListener('input', updateCount);
  sepEl.addEventListener('input', updateCount);

  document.querySelectorAll('.studio-compose [data-kind]').forEach(b => b.addEventListener('click', () => {
    kind = b.dataset.kind;
    document.querySelectorAll('.studio-compose [data-kind]').forEach(x => x.classList.toggle('active', x === b));
    $('st-n-wrap').hidden = kind !== 'image';
  }));
  document.querySelectorAll('#st-imgmode [data-mode]').forEach(b => b.addEventListener('click', () => {
    imgMode = b.dataset.mode;
    document.querySelectorAll('#st-imgmode [data-mode]').forEach(x => x.classList.toggle('active', x === b));
  }));

  function renderRefs() {
    $('st-refs').innerHTML = refs.map((r, i) => `<div class="thumb-wrap" title="${escapeHtml(r.name)}">
        <img src="${r.dataUrl}" class="queue-item-thumb" alt=""><button type="button" class="thumb-x" data-i="${i}" aria-label="Bỏ ảnh">✕</button></div>`).join('')
      + (refs.length < MAX_REFS ? '<button type="button" class="thumb-add" id="st-ref-add">+ Ảnh</button>' : '');
  }
  function addRefs(list) {
    const room = MAX_REFS - refs.length;
    if (list.length > room) toast(`Tối đa ${MAX_REFS} ảnh tham chiếu.`, 'warn');
    refs = refs.concat(list.slice(0, Math.max(room, 0)));
    renderRefs();
  }
  $('st-refs').addEventListener('click', async e => {
    if (e.target.dataset.i) { refs.splice(+e.target.dataset.i, 1); renderRefs(); return; }
    if (e.target.id !== 'st-ref-add' || !api) return;
    const files = await api.selectImageFile(true);
    addRefs((files || []).map(f => ({ dataUrl: f.dataUrl, name: f.filename })));
  });
  // Kéo thả ảnh vào khung soạn
  const compose = document.querySelector('.studio-compose');
  compose.addEventListener('dragover', e => e.preventDefault());
  compose.addEventListener('drop', async e => {
    e.preventDefault();
    const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
    const read = f => new Promise(r => { const fr = new FileReader(); fr.onload = () => r({ dataUrl: fr.result, name: f.name }); fr.readAsDataURL(f); });
    addRefs(await Promise.all(files.map(read)));
  });

  async function submit(held) {
    const list = prompts();
    if (!list.length) return toast('Nhập ít nhất 1 prompt.', 'warn');
    if (imgMode === 'pair' && refs.length && refs.length < list.length) toast(`Ghép cặp: ${list.length - refs.length} prompt cuối không có ảnh.`, 'warn');
    const n = kind === 'image' ? parseInt($('st-n').value, 10) || 1 : 1;
    const st = studio();
    let count = 0, cut = 0, rotateIdx = st.rotate.idx;
    for (const [i, prompt] of list.entries()) {
      for (let k = 0; k < n; k++) {
        const r = window.Compose.imagesFor({ prompt, index: i, characters: st.characters, model: st.model, rotate: { ...st.rotate, idx: rotateIdx }, refs: refs.map(x => x.dataUrl), mode: imgMode });
        rotateIdx = r.rotateIdx;
        cut = Math.max(cut, r.cut);
        const images = r.images.map(src => src.startsWith('data:') ? { imageBase64: src } : { imageLocalPath: src });
        await api.submitTask({ prompt: window.Compose.untag(prompt, st.characters), kind, ratio: $('st-ratio').value, held, label: prompt.slice(0, 60), images });
        count++;
      }
    }
    if (rotateIdx !== st.rotate.idx) api.saveStudio({ rotate: { ...studio().rotate, idx: rotateIdx } });
    if (cut) toast(`Có task quá ${window.Compose.MAX} ảnh — đã bỏ ${cut} ảnh cuối.`, 'warn');
    toast(held ? `Đã thêm ${count} task vào hàng đợi (chưa chạy).` : `Đã gửi ${count} task.`, 'ok');
    promptEl.value = '';
    updateCount();
  }
  $('st-run').addEventListener('click', () => submit(false));
  $('st-hold').addEventListener('click', () => submit(true));

  // ---------- Hàng đợi ----------
  const STATUS_ORDER = { processing: 0, queued: 1, failed: 2, cancelled: 3, succeeded: 4 };
  function statusChip(t) {
    if (t.status === 'queued') return t.held ? chip('muted', 'Chưa chạy') : chip('info', t.error ? 'Chờ thử lại' : 'Đang chờ', t.error);
    if (t.status === 'processing') return chip('live', t.step || 'Đang chạy');
    if (t.status === 'succeeded') return chip('ok', 'Xong');
    if (t.status === 'failed') return chip('danger', 'Lỗi', t.error);
    return chip('muted', 'Đã huỷ');
  }
  const isImg = p => /\.(png|jpe?g|webp|gif)$/i.test(p);
  function thumb(t) {
    const src = t.files.find(isImg) || t.images.find(i => i.imageLocalPath)?.imageLocalPath;
    if (src) return `<img class="sq-thumb" src="${escapeHtml(fileUrl(src))}" alt="">`;
    return `<div class="sq-thumb">${t.kind === 'image' ? '🖼' : '🎬'}</div>`;
  }
  const SOURCE = { ui: '', api: 'API', crm: 'CRM' };
  function meta(t) {
    return [t.kind === 'image' ? 'Ảnh' : 'Video', t.ratio, SOURCE[t.source] ?? t.source, accNames[t.accountId] || '',
      t.status === 'processing' && t.startedAt ? `<span class="timer" data-since="${t.startedAt}">${mmss(Date.now() - t.startedAt)}</span>` : fmtTime(t.createdAt)]
      .filter(Boolean).join(' · ');
  }
  // Chỉ task của dự án đang mở, qua ô tìm + lọc trạng thái
  const stateOf = t => t.status === 'queued' && t.held ? 'held' : t.status;
  function visible() {
    const cur = studio().current, needle = q.toLowerCase();
    return tasks.filter(t => (t.project || 'default') === cur && (!statusF || stateOf(t) === statusF)
      && (!needle || (t.label + ' ' + t.prompt).toLowerCase().includes(needle)));
  }
  function sorted() {
    const list = visible();
    if (sort === 'old') return list.sort((a, b) => a.createdAt - b.createdAt);
    if (sort === 'status') return list.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.createdAt - a.createdAt);
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }
  function renderQueue() {
    const list = sorted();
    $('sq-count').textContent = checked.size ? `Đã chọn ${checked.size}/${list.length}` : `${list.length} task`;
    $('sq-all').checked = list.length > 0 && list.every(t => checked.has(t.id));
    $('sq-list').innerHTML = list.length ? list.map(t => `<div class="sq-row${t.id === focusId ? ' selected' : ''}" data-id="${t.id}">
        <input type="checkbox" data-check="${t.id}"${checked.has(t.id) ? ' checked' : ''} aria-label="Chọn">
        ${thumb(t)}
        <div class="sq-main"><div class="sq-title">${escapeHtml(t.label || t.prompt)}</div><div class="sq-meta">${meta(t)}</div></div>
        ${statusChip(t)}
      </div>`).join('')
      : '<div class="queue-empty"><strong>Chưa có task</strong>Soạn prompt bên trái rồi bấm Tạo &amp; chạy.</div>';
    const active = tasks.filter(t => !FINISHED.includes(t.status)).length;
    $('badge-active').hidden = !active;
    $('badge-active').textContent = active;
  }
  $('sq-sort').addEventListener('change', e => { sort = e.target.value; renderQueue(); });
  remember($('sq-sort'), 'st.sort');
  sort = $('sq-sort').value;
  $('sq-all').addEventListener('change', e => {
    checked.clear();
    if (e.target.checked) visible().forEach(t => checked.add(t.id));
    renderQueue();
  });
  $('sq-q').addEventListener('input', e => { q = e.target.value.trim(); renderQueue(); });
  $('sq-status').addEventListener('change', e => { statusF = e.target.value; renderQueue(); });
  document.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => {
    checked.clear();
    visible().filter(t => stateOf(t) === b.dataset.pick).forEach(t => checked.add(t.id));
    renderQueue();
  }));
  $('sq-list').addEventListener('click', e => {
    const id = e.target.dataset.check;
    if (id) { e.target.checked ? checked.add(id) : checked.delete(id); renderQueue(); return; }
    const row = e.target.closest('.sq-row');
    if (row) { focusId = row.dataset.id; renderQueue(); renderDetail(); }
  });
  setInterval(() => document.querySelectorAll('#tab-studio [data-since]').forEach(el => { el.textContent = mmss(Date.now() - +el.dataset.since); }), 1000);

  const picked = () => visible().filter(t => checked.has(t.id));
  async function bulk(act) {
    if (act === 'retry-failed') {
      const failed = (checked.size ? picked() : visible()).filter(t => t.status === 'failed');
      if (!failed.length) return toast('Không có task lỗi.', 'info');
      await api.runTasks(failed.map(t => t.id));
      return toast(`Chạy lại ${failed.length} task lỗi.`, 'ok');
    }
    const sel = picked();
    if (!sel.length) return toast('Tích chọn task trước.', 'info');
    if (act === 'run') { await api.runTasks(sel.map(t => t.id)); toast(`Chạy ${sel.length} task.`, 'ok'); }
    if (act === 'stop') {
      const live = sel.filter(t => !FINISHED.includes(t.status));
      for (const t of live) await api.cancelTask(t.id);
      toast(`Đã dừng ${live.length} task.`, 'warn');
    }
    if (act === 'remove') {
      if (!confirm(`Xoá ${sel.length} task khỏi hàng đợi? Task đang chạy sẽ bị huỷ. File đã tải về vẫn giữ.`)) return;
      for (const t of sel) await api.removeTask(t.id);
      checked.clear();
    }
    if (act === 'merge') {
      const vids = sel.filter(t => t.status === 'succeeded').sort((a, b) => a.createdAt - b.createdAt).flatMap(t => t.files.filter(f => f.endsWith('.mp4')));
      if (vids.length < 2) return toast('Chọn ít nhất 2 task video đã xong để ghép.', 'warn');
      window.App.openMerge(vids);
    }
  }
  document.querySelectorAll('[data-bulk]').forEach(b => b.addEventListener('click', () => bulk(b.dataset.bulk).catch(e => toast(e.message, 'danger'))));

  // ---------- Chi tiết ----------
  let detailSig = null;
  function renderDetail() {
    const t = tasks.find(x => x.id === focusId);
    const sig = t ? [t.id, t.status, t.files.join(), t.error, t.prompt].join('|') : '';
    if (sig === detailSig) { // chỉ đổi bước → không vẽ lại (video đang xem không bị tải lại)
      const step = $('sd-step');
      if (step && t) step.textContent = t.step || '';
      return;
    }
    detailSig = sig;
    if (!t) { $('sd').innerHTML = '<div class="preview-empty">Chọn 1 task trong hàng đợi để xem.</div>'; return; }
    const media = t.files.length
      ? t.files.map(f => isImg(f) ? `<img class="preview-media" src="${escapeHtml(fileUrl(f))}" alt="">` : `<video class="preview-media" src="${escapeHtml(fileUrl(f))}" controls preload="metadata"></video>`).join('')
      : `<div class="preview-empty">${t.status === 'processing' ? `<span class="job-step" id="sd-step">${escapeHtml(t.step || 'Đang chạy')}</span>` : t.status === 'queued' ? 'Đang chờ tới lượt.' : 'Chưa có kết quả.'}</div>`;
    const refsHtml = t.images.filter(i => i.imageLocalPath || i.imageUrl)
      .map(i => `<img class="queue-item-thumb" src="${escapeHtml(i.imageLocalPath ? fileUrl(i.imageLocalPath) : i.imageUrl)}" alt="">`).join('');
    $('sd').innerHTML = `${media}
      <div class="row-between">${statusChip(t)}<span class="muted small">${meta(t)}</span></div>
      ${t.error ? `<div class="queue-err">${escapeHtml(t.error)}</div>` : ''}
      <div><span class="label">Prompt</span><div class="prompt-text">${escapeHtml(t.prompt)}</div></div>
      ${refsHtml ? `<div><span class="label">Ảnh tham chiếu</span><div class="img-strip">${refsHtml}</div></div>` : ''}
      <div class="queue-item-actions">
        ${t.files.length ? '<button class="btn-ghost btn-sm" data-d="reveal">Mở file</button>' : ''}
        <button class="btn-ghost btn-sm" data-d="dup">Tạo lại</button>
        <button class="btn-ghost btn-sm" data-d="edit">Chỉnh sửa</button>
      </div>`;
  }
  // Nhân bản task: cùng prompt, ảnh, loại, tỉ lệ (main chép ảnh riêng cho task mới)
  const clone = (t, prompt) => api.submitTask({ prompt, kind: t.kind, ratio: t.ratio, expect: t.expect, project: t.project, label: prompt.slice(0, 60),
    images: t.images.map(i => ({ imageUrl: i.imageUrl, imageLocalPath: i.imageLocalPath })) });
  $('sd').addEventListener('click', async e => {
    const t = tasks.find(x => x.id === focusId);
    const act = e.target.dataset.d;
    if (!t || !act) return;
    if (act === 'reveal') api.revealFile(t.files[0]);
    if (act === 'dup') { await clone(t, t.prompt); toast('Đã tạo lại task.', 'ok'); }
    if (act === 'edit') {
      $('st-edit-text').value = t.prompt;
      $('st-edit').showModal();
    }
  });
  $('st-edit').addEventListener('close', async () => {
    const t = tasks.find(x => x.id === focusId);
    const prompt = $('st-edit-text').value.trim();
    if ($('st-edit').returnValue !== 'save' || !t || !prompt) return;
    const fresh = await clone(t, prompt);
    if (FINISHED.includes(t.status)) await api.removeTask(t.id); // task cũ còn chạy thì giữ, không huỷ ngang
    focusId = fresh.id;
    toast('Đã lưu và chạy lại.', 'ok');
  });

  // ---------- Dữ liệu từ main ----------
  function onTask(task) {
    const i = tasks.findIndex(t => t.id === task.id);
    if (task.removed) { if (i >= 0) tasks.splice(i, 1); checked.delete(task.id); }
    else if (i >= 0) tasks[i] = task;
    else tasks.push(task);
    renderQueue();
    if (task.id === focusId) renderDetail();
  }
  if (api) {
    api.onTaskUpdate(({ task }) => onTask(task));
    api.onAccountsUpdate(v => { accNames = Object.fromEntries(v.accounts.map(a => [a.id, a.name])); });
    api.listTasks().then(r => { tasks = r.tasks; window.App.setBlocked(r.blocked); renderQueue(); renderDetail(); });
    api.listAccounts().then(v => { accNames = Object.fromEntries(v.accounts.map(a => [a.id, a.name])); renderQueue(); });
  }
  renderRefs();
  renderQueue();
  renderDetail();
})();
