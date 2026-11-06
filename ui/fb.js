/**
 * FACEBOOK + API — token Fanpage (thẻ trong Cài đặt), đăng Reels, tab API & log job CRM.
 * Chung 1 file vì thẻ token và tab Đăng FB dùng chung cấu hình Fanpage đang chọn.
 */
(function () {
  'use strict';
  const { api, escapeHtml, toast, goTab } = window.App;
  const crmLogsList = document.getElementById('crm-logs-list');

  let activeUserConfig = {
    fbToken: '',
    fbPages: [],
    selectedPageId: '',
    selectedPageName: '',
    selectedPageAccessToken: '',
    selectedPageAvatar: ''
  };
  let scannedPages = [];
  let tempSelectedPageId = '';

  const btnToggleTokenVis = document.getElementById('btn-toggle-token-vis');
  const btnFetchPages = document.getElementById('btn-cfg-fetch-pages');
  const btnSaveSelectedPage = document.getElementById('btn-cfg-save-selected-page');
  const btnClearFb = document.getElementById('btn-cfg-clear-fb');
  const selFbActivePage = document.getElementById('sel-fb-active-page');

  // Tải cấu hình đã lưu của khách hàng
  async function loadUserSettings() {
    if (!api) return;
    try {
      const cfg = await api.getUserConfig();
      if (cfg) {
        activeUserConfig = { ...activeUserConfig, ...cfg };

        const inputToken = document.getElementById('cfg-fb-token');
        if (inputToken && activeUserConfig.fbToken) {
          inputToken.value = activeUserConfig.fbToken;
        }

        if (Array.isArray(activeUserConfig.fbPages) && activeUserConfig.fbPages.length > 0) {
          scannedPages = activeUserConfig.fbPages;
          tempSelectedPageId = activeUserConfig.selectedPageId || scannedPages[0].id;
          renderScannedPagesList();
          updateFbActivePageDropdown();
        }

        if (activeUserConfig.selectedPageId && activeUserConfig.selectedPageName) {
          applyActiveFanpageUI(activeUserConfig.selectedPageName, activeUserConfig.selectedPageAvatar, activeUserConfig.selectedPageId);
        }
      }
    } catch (err) {
      console.warn('Lỗi đọc cấu hình cài đặt:', err);
    }
  }

  // Cập nhật hiển thị Fanpage đang hoạt động
  function applyActiveFanpageUI(name, avatar, pageId) {
    const activeBanner = document.getElementById('cfg-fb-active-banner');
    const activeAvatar = document.getElementById('cfg-active-avatar');
    const activeName = document.getElementById('cfg-active-name');
    const activeId = document.getElementById('cfg-active-id');

    const bannerAvatar = document.getElementById('fb-banner-avatar');
    const bannerName = document.getElementById('fb-banner-name');
    const bannerId = document.getElementById('fb-banner-id');

    if (name && pageId) {
      if (activeBanner) activeBanner.style.display = 'flex';
      if (activeAvatar) activeAvatar.src = avatar || 'assets/icon48.png';
      if (activeName) activeName.textContent = name;
      if (activeId) activeId.textContent = 'ID: ' + pageId;

      if (bannerName) bannerName.textContent = name;
      if (bannerId) bannerId.textContent = 'Fanpage ID: ' + pageId + ' · sẵn sàng đăng';
      if (bannerAvatar && avatar) bannerAvatar.src = avatar;
    } else {
      if (activeBanner) activeBanner.style.display = 'none';
      if (bannerName) bannerName.textContent = 'Chưa kết nối Fanpage';
      if (bannerId) bannerId.textContent = 'Vào Cài đặt để nhập token Fanpage';
      if (bannerAvatar) bannerAvatar.src = 'assets/icon48.png';
    }
  }

  // Hiển thị danh sách card Fanpage được quét từ Token
  function renderScannedPagesList() {
    const container = document.getElementById('cfg-fb-pages-container');
    const countEl = document.getElementById('cfg-fb-pages-count');
    const listEl = document.getElementById('cfg-fb-pages-list');
    const summaryEl = document.getElementById('cfg-selected-page-summary');

    if (!container || !listEl) return;

    if (scannedPages.length === 0) {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'block';
    if (countEl) countEl.textContent = scannedPages.length;

    listEl.innerHTML = scannedPages.map(p => {
      const isSelected = p.id === tempSelectedPageId;
      return `
        <div class="fb-page-card ${isSelected ? 'selected' : ''}" data-page-id="${escapeHtml(p.id)}">
          <img class="fb-page-avatar" src="${escapeHtml(p.avatarUrl || 'assets/icon48.png')}" alt="Avatar" onerror="this.src='assets/icon48.png'">
          <div class="fb-page-info">
            <div class="fb-page-name">${escapeHtml(p.name)}</div>
            <div class="fb-page-sub">ID: ${escapeHtml(p.id)} ${p.category ? '· ' + escapeHtml(p.category) : ''}</div>
          </div>
          <div class="fb-page-check">${isSelected ? '✓' : ''}</div>
        </div>
      `;
    }).join('');

    // Gán sự kiện click cho từng thẻ Fanpage
    listEl.querySelectorAll('.fb-page-card').forEach(card => {
      card.addEventListener('click', () => {
        tempSelectedPageId = card.getAttribute('data-page-id');
        renderScannedPagesList();
      });
    });

    const activeP = scannedPages.find(p => p.id === tempSelectedPageId);
    if (summaryEl) {
      if (activeP) {
        summaryEl.innerHTML = `Đang chọn: <strong>${escapeHtml(activeP.name)}</strong> (ID: ${escapeHtml(activeP.id)})`;
      } else {
        summaryEl.textContent = 'Chưa chọn Fanpage nào';
      }
    }
  }

  // Cập nhật Dropdown chọn nhanh Page ở Tab Đăng Bài Reels
  function updateFbActivePageDropdown() {
    if (!selFbActivePage) return;
    if (activeUserConfig.fbPages && activeUserConfig.fbPages.length > 0) {
      selFbActivePage.hidden = false;
      selFbActivePage.innerHTML = activeUserConfig.fbPages.map(p =>
        `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`
      ).join('');
      if (activeUserConfig.selectedPageId) {
        selFbActivePage.value = activeUserConfig.selectedPageId;
      }
    } else {
      selFbActivePage.hidden = true;
      selFbActivePage.innerHTML = '';
    }
  }

  if (selFbActivePage) {
    selFbActivePage.addEventListener('change', async () => {
      const pageId = selFbActivePage.value;
      const p = activeUserConfig.fbPages.find(item => item.id === pageId);
      if (p) {
        activeUserConfig.selectedPageId = p.id;
        activeUserConfig.selectedPageName = p.name;
        activeUserConfig.selectedPageAccessToken = p.accessToken;
        activeUserConfig.selectedPageAvatar = p.avatarUrl;
        applyActiveFanpageUI(p.name, p.avatarUrl, p.id);
        await api.saveUserConfig(activeUserConfig);
      }
    });
  }

  // 1. Quét danh sách Fanpage từ Token
  if (btnFetchPages) {
    btnFetchPages.addEventListener('click', async () => {
      const token = document.getElementById('cfg-fb-token').value.trim();
      if (!token) {
        toast('Hãy dán Facebook access token trước khi quét.', 'warn');
        return;
      }

      btnFetchPages.disabled = true;
      btnFetchPages.textContent = 'Đang quét...';

      try {
        const res = await api.fetchFbPages(token);
        if (!res || !res.success) {
          throw new Error(res?.error || 'Không tìm thấy Fanpage nào hoặc Token không hợp lệ');
        }

        scannedPages = res.data;
        if (!scannedPages || scannedPages.length === 0) {
          throw new Error('Token không có quyền quản lý bất kỳ Fanpage nào!');
        }

        activeUserConfig.fbToken = token;
        activeUserConfig.fbPages = scannedPages;

        // Tự động chọn Page cũ hoặc Page đầu tiên
        const exist = scannedPages.find(p => p.id === activeUserConfig.selectedPageId);
        if (exist) {
          tempSelectedPageId = exist.id;
        } else {
          tempSelectedPageId = scannedPages[0].id;
        }

        renderScannedPagesList();
        toast(`Tìm thấy ${scannedPages.length} Fanpage. Chọn trang cần dùng rồi bấm "Lưu Fanpage đã chọn".`, 'ok');
      } catch (err) {
        toast('Lỗi quét Fanpage: ' + err.message, 'danger');
      } finally {
        btnFetchPages.disabled = false;
        btnFetchPages.textContent = 'Quét Fanpage';
      }
    });
  }

  // 2. Lưu Fanpage đã chọn vào máy
  if (btnSaveSelectedPage) {
    btnSaveSelectedPage.addEventListener('click', async () => {
      const p = scannedPages.find(item => item.id === tempSelectedPageId);
      if (!p) {
        toast('Hãy bấm chọn 1 Fanpage trong danh sách.', 'warn');
        return;
      }

      activeUserConfig.selectedPageId = p.id;
      activeUserConfig.selectedPageName = p.name;
      activeUserConfig.selectedPageAccessToken = p.accessToken;
      activeUserConfig.selectedPageAvatar = p.avatarUrl;
      activeUserConfig.fbPages = scannedPages;

      const ok = await api.saveUserConfig(activeUserConfig);
      if (ok) {
        applyActiveFanpageUI(p.name, p.avatarUrl, p.id);
        updateFbActivePageDropdown();
        toast(`Đã lưu Fanpage "${p.name}". Sang mục Đăng Facebook để đăng Reels.`, 'ok');
      } else {
        toast('Lỗi khi lưu cấu hình vào máy.', 'danger');
      }
    });
  }

  // 3. Xóa Token & Danh Sách
  if (btnClearFb) {
    btnClearFb.addEventListener('click', async () => {
      if (!confirm('Bạn có chắc chắn muốn xóa Token và toàn bộ danh sách Fanpage đã lưu trên máy?')) return;

      activeUserConfig = {
        fbToken: '',
        fbPages: [],
        selectedPageId: '',
        selectedPageName: '',
        selectedPageAccessToken: '',
        selectedPageAvatar: ''
      };
      scannedPages = [];
      tempSelectedPageId = '';

      const tokenInput = document.getElementById('cfg-fb-token');
      if (tokenInput) tokenInput.value = '';

      const container = document.getElementById('cfg-fb-pages-container');
      if (container) container.style.display = 'none';

      applyActiveFanpageUI('', '', '');
      updateFbActivePageDropdown();

      await api.saveUserConfig(activeUserConfig);
      toast('Đã xoá token và danh sách Fanpage khỏi máy.', 'ok');
    });
  }

  // 8. Ẩn / Hiện Token mật khẩu
  if (btnToggleTokenVis) {
    btnToggleTokenVis.addEventListener('click', () => {
      const input = document.getElementById('cfg-fb-token');
      if (input.type === 'password') {
        input.type = 'text';
        btnToggleTokenVis.textContent = 'Ẩn';
      } else {
        input.type = 'password';
        btnToggleTokenVis.textContent = 'Hiện';
      }
    });
  }


  // =========================================================================
  // 8. FACEBOOK AUTO-POSTER (REELS UPLOAD)
  // =========================================================================
  let selectedFbVideoPath = '';
  const btnGotoSettings = document.getElementById('btn-goto-settings');
  const selFbVideo = document.getElementById('sel-fb-video');
  const btnBrowseFbVideo = document.getElementById('btn-browse-fb-video');
  const fbSelectedPath = document.getElementById('fb-selected-path');
  const inputFbCaption = document.getElementById('input-fb-caption');
  const btnPublishReels = document.getElementById('btn-publish-reels');
  const fbPublishLoading = document.getElementById('fb-publish-loading');
  const fbPublishStatusText = document.getElementById('fb-publish-status-text');
  const fbPublishedList = document.getElementById('fb-published-list');

  if (btnGotoSettings) {
    btnGotoSettings.addEventListener('click', () => {
      goTab('tab-settings');
    });
  }

  // Video trong kho (thư mục video) cho ô chọn; video mới xong thì main báo qua video-completed
  let completedVideos = [];
  async function loadLibraryVideos() {
    try { const list = await api.getLibraryVideos(); completedVideos = Array.isArray(list) ? list : []; } catch (e) { completedVideos = []; }
    updateFbVideoDropdown();
  }
  function updateFbVideoDropdown() {
    if (!selFbVideo) return;
    const currentVal = selFbVideo.value;
    selFbVideo.innerHTML = '<option value="">— Chọn video trong kho —</option>' +
      completedVideos.map(v => `<option value="${escapeHtml(v.localPath)}">${escapeHtml(v.filename)} (${v.size ? (v.size/1024/1024).toFixed(1) + 'MB' : 'MP4'})</option>`).join('');
    if (currentVal) selFbVideo.value = currentVal;
  }

  window.App.selectVideoForFb = function(filePath) {
    selectedFbVideoPath = filePath;
    if (selFbVideo) selFbVideo.value = filePath;
    if (fbSelectedPath) fbSelectedPath.textContent = 'Đã chọn: ' + filePath;
    goTab('tab-fbpost');
  };

  if (selFbVideo) {
    selFbVideo.addEventListener('change', () => {
      selectedFbVideoPath = selFbVideo.value;
      if (fbSelectedPath) {
        fbSelectedPath.textContent = selectedFbVideoPath ? ('Đã chọn: ' + selectedFbVideoPath) : '';
      }
    });
  }

  if (btnBrowseFbVideo) {
    btnBrowseFbVideo.addEventListener('click', async () => {
      const filePath = await api?.selectVideoFile();
      if (filePath) {
        selectedFbVideoPath = filePath;
        if (selFbVideo) selFbVideo.value = '';
        if (fbSelectedPath) fbSelectedPath.textContent = 'File từ máy: ' + filePath;
      }
    });
  }

  if (btnPublishReels) {
    btnPublishReels.addEventListener('click', async () => {
      const pageId = activeUserConfig.selectedPageId;
      const token = activeUserConfig.selectedPageAccessToken;

      if (!pageId || !token) {
        toast('Chưa chọn Fanpage. Vào Cài đặt, dán token và bấm "Quét Fanpage".', 'warn');
        goTab('tab-settings');
        return;
      }

      if (!selectedFbVideoPath) {
        toast('Hãy chọn 1 video trong kho hoặc bấm "Chọn file khác".', 'warn');
        return;
      }

      const caption = inputFbCaption.value.trim();

      btnPublishReels.disabled = true;
      if (fbPublishLoading) {
        fbPublishLoading.hidden = false;
        if (fbPublishStatusText) fbPublishStatusText.textContent = `Đang kết nối Facebook Graph API v20 cho Fanpage ${activeUserConfig.selectedPageName || pageId}...`;
      }

      try {
        if (fbPublishStatusText) fbPublishStatusText.textContent = 'Đang truyền dữ liệu binary lên rupload.facebook.com...';

        const res = await api.publishFbReels({
          filePath: selectedFbVideoPath,
          caption: caption,
          pageId: pageId,
          token: token
        });

        if (!res || !res.success) {
          throw new Error(res?.error || 'Đăng bài không thành công');
        }

        const data = res.data;
        if (fbPublishStatusText) fbPublishStatusText.textContent = 'Đã đăng xong.';

        addFbHistoryItem({
          videoId: data.videoId,
          postUrl: data.postUrl,
          filePath: selectedFbVideoPath,
          caption: caption,
          timestamp: Date.now()
        });

        toast(`Đã đăng Reels lên ${activeUserConfig.selectedPageName}.\nVideo ID: ${data.videoId}`, 'ok');
      } catch (err) {
        console.error('Lỗi publish Reels:', err);
        toast('Đăng Facebook thất bại: ' + err.message, 'danger');
      } finally {
        btnPublishReels.disabled = false;
        if (fbPublishLoading) fbPublishLoading.hidden = true;
      }
    });
  }

  function addFbHistoryItem(item) {
    if (!fbPublishedList) return;
    const empty = fbPublishedList.querySelector('.queue-empty');
    if (empty) empty.remove();

    const time = new Date(item.timestamp).toLocaleTimeString();
    const el = document.createElement('div');
    el.className = 'log-item';
    el.innerHTML = `
      <div class="row-between">
        <strong>Reels #${escapeHtml(item.videoId)}</strong>
        <span class="muted small">${time}</span>
      </div>
      <p>${escapeHtml(item.caption || '(Không kèm caption)')}</p>
      <div class="row-between">
        <span class="path">${escapeHtml(item.filePath)}</span>
        <a href="${escapeHtml(item.postUrl)}" target="_blank">Xem trên Facebook</a>
      </div>
    `;
    fbPublishedList.prepend(el);
  }

  const apiKeyInput = document.getElementById('api-key');
  const apiTestResult = document.getElementById('api-test-result');
  const API_BASE = 'http://127.0.0.1:48900/api/v1';

  async function loadApiKey(regenerate = false) {
    if (!api) return;
    apiKeyInput.value = await api.getApiKey(regenerate);
    document.getElementById('api-curl').textContent =
`# Ví dụ (thay <KEY> bằng key ở trên)
curl -X POST ${API_BASE}/tasks \
  -H "Authorization: Bearer <KEY>" -H "Content-Type: application/json" \
  -d '{"prompt":"Tạo video chân thực 10s, cận cảnh ly cà phê bốc khói","label":"test"}'

curl ${API_BASE}/tasks/<TASK_ID> -H "Authorization: Bearer <KEY>"
curl -o video.mp4 ${API_BASE}/tasks/<TASK_ID>/file -H "Authorization: Bearer <KEY>"`;
  }

  document.getElementById('btn-api-key-show').addEventListener('click', (e) => {
    const show = apiKeyInput.type === 'password';
    apiKeyInput.type = show ? 'text' : 'password';
    e.target.textContent = show ? 'Ẩn' : 'Hiện';
  });
  document.getElementById('btn-api-key-copy').addEventListener('click', async () => {
    await navigator.clipboard.writeText(apiKeyInput.value);
    toast('Đã copy API key.', 'ok');
  });
  document.getElementById('btn-api-key-new').addEventListener('click', async () => {
    if (!confirm('Đổi API key? Các hệ thống đang dùng key cũ sẽ bị từ chối cho tới khi cập nhật key mới.')) return;
    await loadApiKey(true);
    toast('Đã đổi API key.', 'ok');
  });
  // Chỉ đọc danh sách task, không tạo task → không tốn lượt Muse.
  document.getElementById('btn-api-test').addEventListener('click', async () => {
    apiTestResult.hidden = false;
    apiTestResult.textContent = 'GET /api/v1/tasks?limit=1 ...';
    try {
      const r = await fetch(`${API_BASE}/tasks?limit=1`, { headers: { Authorization: `Bearer ${apiKeyInput.value}` } });
      apiTestResult.textContent = `HTTP ${r.status}\n` + JSON.stringify(await r.json(), null, 2);
    } catch (err) {
      apiTestResult.textContent = 'Lỗi gọi API: ' + err.message;
    }
  });

  function addCrmLog(jobData) {
    const empty = crmLogsList.querySelector('.queue-empty');
    if (empty) empty.remove();

    const time = new Date().toLocaleTimeString();
    const el = document.createElement('div');
    el.className = 'log-item';
    el.innerHTML = `
      <div class="row-between">
        <strong>${escapeHtml(jobData.topicId || 'Kịch bản')}</strong>
        <span class="muted small">${time}</span>
      </div>
      <p>${escapeHtml(jobData.prompt)}</p>
    `;
    crmLogsList.prepend(el);
  }

  if (api) {
    api.onVideoCompleted(item => { completedVideos.unshift(item); updateFbVideoDropdown(); });
    api.onCrmJobReceived(addCrmLog);
    loadUserSettings();
    loadLibraryVideos();
    loadApiKey();
  }
  document.addEventListener('app:tab', e => { if (e.detail === 'tab-fbpost') loadLibraryVideos(); });
})();
