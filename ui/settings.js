/**
 * CÀI ĐẶT — thư mục lưu, số lần thử, giới hạn phút ảnh/video. (Token FB + Fanpage nằm ở fb.js.)
 */
(function () {
  'use strict';
  const { api, $, toast } = window.App;
  if (!api) return;

  function fill(s) {
    if (!s) return;
    $('set-out').value = s.outputDir || '';
    $('set-attempts').value = s.maxAttempts ?? '';
    $('set-img-min').value = s.imageTimeoutMin ?? s.limits?.image ?? '';
    $('set-vid-min').value = s.videoTimeoutMin ?? s.limits?.video ?? '';
  }

  $('set-out-pick').addEventListener('click', async () => {
    const dir = await api.selectFolder();
    if (dir) $('set-out').value = dir;
  });
  $('btn-settings-open-finder').addEventListener('click', () => api.openOutputFolder());
  $('set-save').addEventListener('click', async () => {
    const s = await api.saveSettings({
      outputDir: $('set-out').value,
      maxAttempts: Number($('set-attempts').value),
      imageTimeoutMin: Number($('set-img-min').value),
      videoTimeoutMin: Number($('set-vid-min').value),
    });
    fill(s);
    toast('Đã lưu cài đặt.', 'ok');
  });

  document.addEventListener('app:tab', e => { if (e.detail === 'tab-settings') api.getSettings().then(fill); });
  api.getSettings().then(fill);
})();
