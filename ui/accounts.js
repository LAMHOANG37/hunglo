/**
 * TÀI KHOẢN — danh sách tài khoản Muse (mỗi cái 1 Chrome), cài đặt chia việc, chip trạng thái trên thanh trên.
 * Main gửi lại toàn bộ danh sách qua accounts-update mỗi khi có gì đổi.
 */
(function () {
  'use strict';
  const { api, $, escapeHtml, fmtDate, fmtTime, chip, toast, setBlocked } = window.App;
  if (!api) return;

  const list = $('acc-list');
  const accMax = $('acc-max');
  const accTotal = $('acc-total');
  const accMode = $('acc-mode');
  const accTopup = $('acc-topup');
  const accKeep = $('acc-keep');
  const accProxies = $('acc-proxies');
  let view = { accounts: [], settings: {}, running: {}, proxies: [] };

  // [tone, chữ] của 1 tài khoản — dùng cho chip thanh trên và dòng trong tab
  function state(a) {
    const n = view.running[a.id] || 0;
    if (!a.enabled) return ['muted', 'Tắt'];
    if (n) return ['live', `Đang chạy ${n}`];
    if (a.videoDailyLimit) return ['warn', a.videoDailyLimit.kind === 'runway' ? 'Dừng · lỗi Runway' : a.videoDailyLimit.kind === 'muse' ? 'Dừng · Muse báo lỗi' : 'Dừng · giới hạn ngày'];
    if (a.checking) return ['warn', 'Đang xác minh'];
    if (a.loggedIn === false) return ['warn', 'Chưa đăng nhập'];
    if (a.loginError) return ['warn', 'Lỗi kết nối/kiểm tra phiên'];
    if (a.quotaError || a.verificationError) return ['warn', 'Chưa đọc được hạn mức'];
    if (a.needsCheck || a.loggedIn == null) return ['warn', 'Cần cập nhật'];
    if (a.pausedUntil) return ['danger', `Nghỉ – hết hạn mức${a.pausedUntil < 9e15 ? ` (tới ${fmtDate(a.pausedUntil)})` : ''}`];
    return ['ok', 'Rảnh'];
  }

  // Thanh trên: 1 nút tóm tắt, bấm mở danh sách từng tài khoản
  function renderChips() {
    const st = view.accounts.map(state);
    const run = st.filter(([t]) => t === 'live').length, ready = st.filter(([t]) => t === 'ok').length;
    const [tone, text] = run ? ['live', `${run} đang chạy`] : ready ? ['ok', `${ready}/${st.length} rảnh`] : ['warn', 'không có TK rảnh'];
    $('acc-sum').innerHTML = `${chip(tone, `Tài khoản: ${text}`)}<svg class="acc-menu-caret" viewBox="0 0 12 12" width="12" height="12"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
    $('acc-chips').innerHTML = view.accounts.map((a, i) => chip(st[i][0], `${a.name}: ${st[i][1]}`, `${a.name}: ${st[i][1]}`)).join('');
  }
  const accMenu = $('acc-menu');
  document.addEventListener('click', e => { if (accMenu.open && !accMenu.contains(e.target)) accMenu.open = false; });
  $('acc-menu-manage').addEventListener('click', () => { accMenu.open = false; window.App.goTab('tab-accounts'); });

  // Số API (topupBalance) khác đơn vị số Muse hiện: 40.000.000 ↔ "còn 1 tỷ token" trên trang Muse → nhân 25.
  // ponytail: tỷ lệ suy từ 1 ảnh chụp, Muse đổi đơn vị thì sửa hằng số này.
  const TOKEN_PER_UNIT = 25;
  const fmtTokens = n => new Intl.NumberFormat('vi', { notation: 'compact', compactDisplay: 'long', maximumFractionDigits: 2 }).format(n * TOKEN_PER_UNIT);

  // Hạn mức gọn 1 dòng: thanh mảnh + % · đặt lại · token; chi tiết ở tooltip
  function quotaHtml(q, stale = false) {
    if (!q) return '<div class="muted small">Chưa có số liệu hạn mức</div>';
    const tone = q.pct >= 100 ? 'danger' : q.pct >= 80 ? 'warn' : '';
    const balance = q.source === 'settings-ui' ? (q.tokenLabel || 'chưa rõ số dư') : fmtTokens(q.topupBalance);
    const token = q.topupLeft != null ? `token ${balance} (${Math.round(q.topupLeft * 100)}%)` : '';
    const tip = [q.tier, q.resetLabel || (q.resetsAt && `Đặt lại ${fmtDate(q.resetsAt)}`), token && `Token bổ sung còn ${balance}`, q.source === 'settings-ui' && 'Đọc từ Settings Muse; ngày đặt lại không có giờ chính xác', `kiểm tra ${fmtTime(q.checkedAt)}`].filter(Boolean).join(' · ');
    return `<div class="acc-q" title="${escapeHtml(tip)}">
      <div class="quota-bar"><i style="width:${Math.min(100, Math.max(0, q.pct))}%"${tone ? ` data-tone="${tone}"` : ''}></i></div>
      <div class="small"><strong>${Math.round(q.pct)}% tuần đã dùng</strong><span class="muted">${q.resetsAt ? ` · đặt lại ${fmtDate(q.resetsAt)}` : ''}${token ? ` · ${token}` : ''}${stale ? ' · Số liệu cũ/chưa xác minh' : ''}</span></div></div>`;
  }

  // Dòng proxy tài khoản đang được gán (cố định hoặc tự chọn)
  const proxyOf = a => (a.proxy === 'none' ? '' : a.proxy || a.proxyAuto || '');
  const labelOf = line => view.proxies.find(p => p.line === line)?.label || line.replace(/^.*@/, '').split(':').slice(0, 2).join(':');
  // Ô proxy riêng của tài khoản: gõ/dán proxy hoặc chọn từ kho; trống = tự lấy từ kho (kho trống = không proxy)
  function proxyRow(a) {
    const pool = view.proxies.filter(p => !p.error);
    const f = a.proxyFixed, h = f?.health;
    const [tone, text] = a.proxy === 'none' ? ['muted', 'không dùng proxy']
      : f ? (f.error ? ['danger', f.error] : !h ? ['muted', 'chưa kiểm tra'] : h.ok ? ['ok', `sống · ${h.ms}ms`] : ['danger', `chết · ${h.error}`])
      : pool.length ? ['muted', `tự lấy từ kho${a.proxyAuto ? `: ${labelOf(a.proxyAuto)}` : ''}`] : ['muted', 'không dùng proxy'];
    const val = a.proxy === 'none' ? '' : a.proxy || '';
    const ph = pool.length ? 'Trống = tự lấy từ kho proxy · bấm để chọn' : 'ip:port hoặc ip:port:user:pass — trống = không dùng proxy';
    return `
        <div class="acc-proxy-row">
          <span class="muted small">Proxy</span>
          <input class="input mono" data-f="proxy" list="acc-proxy-pool" value="${escapeHtml(val)}" placeholder="${escapeHtml(ph)}" spellcheck="false" autocomplete="off"
            title="Proxy riêng của tài khoản này — đổi thì Chrome (nếu đang rảnh) mở lại với proxy mới">
          <button class="btn-ghost btn-sm" data-act="proxy-check">Kiểm tra</button>
          <span class="small">${chip(tone, text)}${a.proxyNow ? ` <span class="muted">· Chrome đang qua ${escapeHtml(a.proxyNow)}</span>` : ''}</span>
        </div>`;
  }

  function renderProxies() {
    $('acc-proxy-status').innerHTML = view.proxies.map(p => {
      const h = p.health, users = view.accounts.filter(a => proxyOf(a) === p.line).map(a => escapeHtml(a.name)).join(', ');
      const [tone, text] = p.error ? ['danger', p.error] : !h ? ['muted', 'chưa kiểm tra'] : h.ok ? ['ok', `sống · ${h.ms}ms`] : ['danger', `chết · ${h.error}`];
      return `<span>${chip(tone, `${p.label}: ${text}`)}${users ? ` <span class="muted">→ ${users}</span>` : ''}</span>`;
    }).join('');
    $('acc-proxy-pool').innerHTML = view.proxies.filter(p => !p.error).map(p => `<option value="${escapeHtml(p.line)}">${escapeHtml(p.label)}</option>`).join('');
  }

  function renderList() {
    list.innerHTML = view.accounts.map(a => {
      const [tone, text] = state(a);
      const busy = Boolean(view.running[a.id]);
      const error = a.videoDailyLimit?.reason || a.verificationError || '';
      return `
      <div class="card acc-row" data-id="${escapeHtml(a.id)}">
        <label class="switch" title="Bật / tắt tài khoản"><input type="checkbox" data-f="enabled"${a.enabled ? ' checked' : ''}><span></span></label>
        <input class="input acc-nm" data-f="name" value="${escapeHtml(a.name)}" title="Sửa tên">
        <span class="small acc-state" title="${escapeHtml(a.videoDailyLimit?.reason || a.verificationError || text)}">${chip(tone, text)}</span>
        ${quotaHtml(a.quota, a.needsCheck || Boolean(a.verificationError))}
        <select class="select" data-f="threads" title="Số luồng của tài khoản này">${[1, 2, 3, 4, 5].map(n => `<option value="${n}"${n === a.threads ? ' selected' : ''}>${n} luồng</option>`).join('')}</select>
        ${error ? `<div class="acc-error" role="note"><strong>${a.videoDailyLimit ? 'Lỗi Muse' : 'Lỗi xác minh'}:</strong> ${escapeHtml(error)}</div>` : ''}
        <div class="acc-acts">
          ${a.videoDailyLimit ? `<button class="btn-ghost btn-sm" data-act="video-retry" title="Cho phép tài khoản nhận việc trở lại; nếu Muse vẫn lỗi sẽ chuyển tài khoản khác."${busy ? ' disabled' : ''}>Thử lại tài khoản</button>` : ''}
          ${a.loggedIn ? '<button class="btn-ghost btn-sm" data-act="show">Hiện Chrome</button>' : '<button class="btn btn-sm" data-act="login">Đăng nhập</button>'}
          <button class="btn-ghost btn-sm" data-act="quota"${a.loggedIn ? '' : ' disabled'}>Hạn mức</button>
          <button class="btn-ghost btn-sm" data-act="logout"${a.loggedIn && !busy ? '' : ' disabled'}>Đăng xuất</button>
          <button class="btn-danger btn-sm" data-act="remove"${busy || view.accounts.length < 2 ? ' disabled' : ''}>Xoá</button>
        </div>${proxyRow(a)}
      </div>`;
    }).join('');
  }

  // Ô đang gõ không bị ghi đè khi main gửi cập nhật
  const typing = el => document.activeElement === el;
  function renderSettings() {
    const s = view.settings;
    if (!typing(accMax)) accMax.value = s.maxAccounts ?? '';
    if (!typing(accTotal)) accTotal.value = s.totalThreads ?? '';
    accMode.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === s.mode));
    accTopup.checked = Boolean(s.useTopup);
    accKeep.checked = Boolean(s.keepGoing);
    if (!typing(accProxies)) accProxies.value = s.proxies ?? '';
    $('acc-pool').checked = Boolean(s.usePool);
    $('acc-proxy-box').hidden = !s.usePool;
  }

  let pending = false;
  function render(v) {
    if (v) view = v;
    renderChips();
    renderSettings();
    renderProxies();
    setBlocked(view.blocked);
    // Đang sửa tên / proxy thì để sau khi rời ô mới vẽ lại
    if (list.contains(document.activeElement) && ['name', 'proxy'].includes(document.activeElement.dataset.f)) { pending = true; return; }
    renderList();
  }
  list.addEventListener('focusout', () => { if (pending) { pending = false; setTimeout(renderList); } });

  list.addEventListener('change', async e => {
    const f = e.target.dataset.f;
    const id = e.target.closest('[data-id]')?.dataset.id;
    if (!f || !id) return;
    const value = f === 'enabled' ? e.target.checked : f === 'threads' ? Number(e.target.value) : e.target.value.trim();
    if (f === 'name' && !value) return render();
    await api.updateAccount(id, { [f]: value });
  });

  list.addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.closest('[data-id]').dataset.id;
    const acc = view.accounts.find(a => a.id === id);
    const act = btn.dataset.act;
    if (act === 'video-retry') {
      if (!confirm('Cho phép tài khoản này nhận việc trở lại? Nếu Muse vẫn báo lỗi hoặc không trả kết quả, app sẽ dừng tài khoản và chuyển việc sang tài khoản khác.')) return;
      try { await api.updateAccount(id, { clearVideoDailyLimit: true }); }
      catch (e) { toast(e.message || 'Không thể thử lại', 'danger'); }
      return;
    }
    if (act === 'proxy-check') {
      btn.disabled = true;
      await api.updateAccount(id, { proxy: btn.parentElement.querySelector('[data-f="proxy"]').value.trim() }); // vừa gõ chưa rời ô thì lưu trước
      return render(await api.checkProxies());
    }
    if (act === 'login') { await api.loginAccount(id); toast(`Đã mở Chrome của ${acc.name}. Đăng nhập Muse trong cửa sổ đó.`, 'info'); }
    if (act === 'show' && !await api.showAccount(id)) toast('Không mở được Chrome của tài khoản này.', 'danger');
    if (act === 'quota') { btn.disabled = true; render(await api.checkQuota(id)); }
    if (act === 'logout') {
      if (!confirm(`Đăng xuất ${acc.name}? Muốn dùng lại phải đăng nhập lại.`)) return;
      const r = await api.logoutAccount(id);
      toast(r?.ok ? `Đã đăng xuất ${acc.name}.` : r?.error || 'Không đăng xuất được.', r?.ok ? 'ok' : 'danger');
    }
    if (act === 'remove') {
      if (!confirm(`Xoá ${acc.name}? Phiên đăng nhập Chrome của tài khoản này sẽ được đưa vào Thùng rác.`)) return;
      const r = await api.removeAccount(id);
      toast(r?.ok ? `Đã xoá ${acc.name}.` : r?.error || 'Không xoá được.', r?.ok ? 'ok' : 'danger');
    }
  });

  const saveSettings = patch => api.saveAccountSettings(patch).then(settings => render({ ...view, settings }));
  accMax.addEventListener('change', () => saveSettings({ maxAccounts: Number(accMax.value) }));
  accTotal.addEventListener('change', () => saveSettings({ totalThreads: Number(accTotal.value) }));
  accMode.addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b) saveSettings({ mode: b.dataset.mode }); });
  accTopup.addEventListener('change', () => saveSettings({ useTopup: accTopup.checked }));
  accKeep.addEventListener('change', () => saveSettings({ keepGoing: accKeep.checked }));
  $('acc-pool').addEventListener('change', e => saveSettings({ usePool: e.target.checked }).then(() => api.listAccounts()).then(render));
  accProxies.addEventListener('change', () => saveSettings({ proxies: accProxies.value }).then(() => api.listAccounts()).then(render));

  // Khoá nút tới khi thêm xong: bấm 2 lần không ra 2 tài khoản / 2 Chrome
  $('acc-add').addEventListener('click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const acc = await api.addAccount(`Tài khoản ${view.accounts.length + 1}`);
      toast(`Đã thêm ${acc?.name || 'tài khoản'}. Chrome mới đã mở, đăng nhập Muse trong đó.`, 'ok');
    } finally { btn.disabled = false; }
  });
  const busyBtn = async (btn, fn) => { btn.disabled = true; try { render(await fn()); } finally { btn.disabled = false; } };
  $('acc-check-quota').addEventListener('click', e => busyBtn(e.currentTarget, () => api.checkQuota()));
  $('acc-proxy-check').addEventListener('click', e => busyBtn(e.currentTarget, async () => {
    await saveSettings({ proxies: accProxies.value }); // vừa gõ chưa rời ô thì lưu trước
    return api.checkProxies();
  }));
  $('acc-check-login').addEventListener('click', e => busyBtn(e.currentTarget, () => api.checkLogins()));

  api.onAccountsUpdate(render);
  document.addEventListener('app:tab', e => { if (e.detail === 'tab-accounts') api.listAccounts().then(render); });
  api.listAccounts().then(render);
})();
