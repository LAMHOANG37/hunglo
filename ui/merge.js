/**
 * HỘP GHÉP VIDEO — dùng chung cho Studio và Thư viện: đổi thứ tự ↑↓, bỏ bớt, đặt tên file, thanh %.
 * App.openMerge(paths, onDone)
 */
(function () {
  'use strict';
  const { api, $, escapeHtml, toast } = window.App;
  const dlg = $('merge-dlg');
  let list = [];
  let done = () => {};
  let busy = false;

  function render() {
    $('merge-list').innerHTML = list.map((p, i) => `<div class="merge-row" data-i="${i}">
        <strong>${i + 1}</strong><span title="${escapeHtml(p)}">${escapeHtml(p.split(/[\\/]/).pop())}</span>
        <div class="row"><button type="button" class="btn-ghost btn-sm" data-m="-1"${i ? '' : ' disabled'} aria-label="Lên">↑</button><button type="button" class="btn-ghost btn-sm" data-m="1"${i < list.length - 1 ? '' : ' disabled'} aria-label="Xuống">↓</button><button type="button" class="btn-ghost btn-sm" data-m="x" aria-label="Bỏ">✕</button></div>
      </div>`).join('');
    $('merge-go').disabled = busy || list.length < 2;
  }
  const bar = pct => { dlg.querySelector('.merge-bar').hidden = pct === null; $('merge-pct').style.width = (pct || 0) + '%'; };

  $('merge-list').addEventListener('click', e => {
    const m = e.target.dataset.m;
    const i = +e.target.closest('[data-i]')?.dataset.i;
    if (!m || busy) return;
    if (m === 'x') list.splice(i, 1);
    else { const j = i + +m; [list[i], list[j]] = [list[j], list[i]]; }
    render();
  });
  $('merge-cancel').addEventListener('click', () => { if (!busy) dlg.close(); });
  dlg.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
  $('merge-go').addEventListener('click', async () => {
    busy = true; render(); bar(0);
    $('merge-go').textContent = 'Đang ghép...';
    const r = await api.mergeVideos(list, $('merge-name').value.trim()).catch(e => ({ success: false, error: e.message }));
    busy = false;
    $('merge-go').textContent = 'Ghép';
    if (!r?.success) { bar(null); render(); return toast('Ghép lỗi: ' + (r?.error || 'không rõ'), 'danger'); }
    toast('Đã ghép: ' + r.path.split(/[\\/]/).pop(), 'ok');
    dlg.close();
    done(r);
  });
  api?.onMergeProgress(pct => { if (busy) bar(pct); });

  window.App.openMerge = (paths, onDone = () => {}) => {
    if (paths.length < 2) return toast('Chọn ít nhất 2 video để ghép.', 'warn');
    list = paths.slice();
    done = onDone;
    $('merge-name').value = '';
    bar(null);
    render();
    dlg.showModal();
  };
})();
