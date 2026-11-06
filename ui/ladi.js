/**
 * LADIPAGE — dán link trang bán hàng → lấy thông tin + ảnh → chọn kịch bản → đưa vào hàng đợi Kịch bản.
 * Dùng chung cài đặt và hàng đợi của tab Kịch bản (App.script).
 */
(function () {
  'use strict';
  const { api, $, escapeHtml, toast, goTab } = window.App;
  const { currentCfg, cfgText, estMin, copiesValue, poolAdd, makeJob, addJobs, buildPrompt, buildBoardPrompt, boardVideoPrompt, SCENE_SECS, BOARD_MAX } = window.App.script;
  const [paramDuration, paramRatio, paramVoice, paramPrefix, paramBoard] = ['param-duration', 'param-ratio', 'param-voice', 'param-prefix', 'param-board'].map($);

  const inputLadiUrl = document.getElementById('input-ladi-url');
  const btnScrapeLadi = document.getElementById('btn-scrape-ladi');
  const ladiLoading = document.getElementById('ladi-loading');
  const ladiResults = document.getElementById('ladi-results');
  const resProductName = document.getElementById('res-product-name');
  const resProductFacts = document.getElementById('res-product-facts');
  const resProductUsp = document.getElementById('res-product-usp');
  const resProductRaw = document.getElementById('res-product-raw');
  const resImagesGrid = document.getElementById('res-images-grid');
  const resImgCount = document.getElementById('res-img-count');
  const ladiScriptTabs = document.getElementById('ladi-script-tabs');
  const ladiScriptScenesContainer = document.getElementById('ladi-script-scenes-container');
  const ladiPromptPreview = document.getElementById('ladi-prompt-preview');
  const ladiPromptText = document.getElementById('ladi-prompt-text');
  const ladiSummary = document.getElementById('ladi-summary');
  const btnImportToMuse = document.getElementById('btn-import-to-muse');
  const ladiSkeleton = document.getElementById('ladi-skeleton');
  const ladiSteps = [...document.querySelectorAll('#ladi-steps .step')];

  let currentLadiData = null;
  let selectedScriptIdx = 0;
  let picked = new Set([0]); // kịch bản đã tích để đưa vào hàng đợi (khác tab đang xem)
  let currentLadiImages = [];
  // Ảnh sản phẩm gửi kèm cả video (thử 09/10: 2 ảnh rõ sản phẩm cho kết quả tốt; nhiều ảnh quá Muse dễ lẫn).
  const LADI_REFS_MAX = 3;
  let ladiRefs = [];

  const currentScript = () => currentLadiData && currentLadiData.scripts[selectedScriptIdx];
  // 16s = 2 cảnh × 8s, 24s = 3 cảnh × 8s (lời ngắn, không thừa giọng); còn lại 3 cảnh × 10s.
  const ladiLayout = () => ({ '16s': { scenes: 2, sceneSecs: 8 }, '24s': { scenes: 3, sceneSecs: 8 } })[paramDuration.value] || { scenes: 3, sceneSecs: SCENE_SECS };
  let genLayout = ''; // khung lúc sinh kịch bản; đổi Thời lượng sang khung khác thì sinh lại
  const ladiTotalSecs = n => Math.min(60, n * ladiLayout().sceneSecs);

  // ① link → ② ảnh → ③ kịch bản/cách làm → ④ hàng đợi; mỗi lúc chỉ 1 bước đang làm.
  function updateLadiSteps() {
    const script = currentScript();
    const state = !script ? ['active', '', '', ''] : ladiRefs.length ? ['done', 'done', 'active', ''] : ['done', 'active', '', ''];
    ladiSteps.forEach((el, i) => { el.className = 'step ' + state[i]; });
  }

  // Cảnh → item hàng đợi (dùng chung cho xem trước lệnh và nút "Đưa vào hàng đợi").
  function ladiItems(script) {
    return script.scenes.map(s => ({
      text: String(s.musePrompt || '').trim(),
      voiceover: String(s.voiceover || '').trim(),
      product: currentLadiData.facts?.name || currentLadiData.productName || '',
      img: ''
    }));
  }
  // Gộp 1 lệnh: thời lượng = số cảnh × 10s để lời mỗi cảnh vừa khít 10s (không đổi ô Thời lượng của người dùng).
  // Kèm phong cách "người thật quay review, giữ đúng sản phẩm" do bộ sinh kịch bản đưa ra.
  // Kịch bản không lời (tay review): bỏ giọng + người dẫn, Muse tự thêm nhạc nền theo script.audio.
  const ladiCfg = script => {
    const cfg = { ...currentCfg(), style: script.style || currentLadiData?.style || '', ...(script.silent && { voice: '', host: '', char: '', audio: script.audio }) };
    return cfg.duration === 'each' ? cfg : { ...cfg, duration: `${ladiTotalSecs(script.scenes.length)}s` };
  };

  function updateLadiSummary() {
    const script = currentScript();
    if (!script) return;
    const n = script.scenes.length;
    const cfg = ladiCfg(script);
    ladiSummary.textContent = `${cfgText(cfg, n)} · ${ladiRefs.length ? `gửi kèm ${ladiRefs.length} ảnh sản phẩm` : 'không gửi ảnh sản phẩm'} · ước tính ~${Math.round(estMin(cfg, n))} phút/video`;
    if (ladiPromptPreview.open) {
      const items = ladiItems(script);
      const refs = ladiRefs.map(poolAdd);
      const video = cfg.duration === 'each' ? items.map(it => buildPrompt([it], cfg, refs)).join('\n\n———\n\n') : buildPrompt(items, cfg, refs);
      ladiPromptText.textContent = cfg.board ? `① Vẽ storyboard:\n${buildBoardPrompt(items, cfg, refs)}\n\n② Làm video (gắn lại ảnh storyboard):\n${boardVideoPrompt(items, cfg, Math.min(items.length, BOARD_MAX), true)}` : video;
    }
  }
  ladiPromptPreview.addEventListener('toggle', updateLadiSummary);
  [paramDuration, paramRatio, paramVoice, paramPrefix, paramBoard].forEach(el => el.addEventListener('change', updateLadiSummary));
  paramDuration.addEventListener('change', () => currentLadiData && JSON.stringify(ladiLayout()) !== genLayout && scrapeLadi(true));

  // Giọng Muse đọc ~4,6 chữ/giây (≈45 chữ cho 10s, ≈36 chữ cho 8s): ít hơn ~3,6 chữ/giây thì cuối cảnh chỉ còn nhạc nền, quá ~4,8 chữ/giây thì Muse cắt bớt lời.
  function wordCount(text) {
    const n = String(text || '').trim().split(/\s+/).filter(Boolean).length;
    const secs = ladiLayout().sceneSecs, max = Math.round(secs * 4.8), min = Math.round(secs * 3.6);
    const tone = n > max ? 'danger' : n < min ? 'warn' : '';
    const note = n > max ? ' · dài, Muse sẽ cắt bớt' : n < min ? ' · ngắn, cuối cảnh chỉ còn nhạc nền' : '';
    return { tone, html: `${n} chữ ≈ ${Math.round(n / 4.6)}s / ${secs}s${note}` };
  }

  function renderLadiGallery() {
    resImagesGrid.innerHTML = currentLadiImages.map((img, i) => {
      const k = ladiRefs.indexOf(img);
      return `
      <div class="ladi-img-card ${k >= 0 ? 'selected' : ''}" data-img-idx="${i}" title="${k >= 0 ? 'Bỏ chọn ảnh này' : 'Gửi kèm ảnh này'}">
        <img src="${escapeHtml(img)}" alt="Ảnh ${i + 1}" loading="lazy" onerror="this.style.display='none'; this.parentElement.classList.add('img-error');">
        <span class="ladi-img-badge">${k >= 0 ? k + 1 : ''}</span>
      </div>`;
    }).join('');
    resImgCount.textContent = currentLadiImages.length;
    updateLadiSteps();
    updateLadiSummary();
  }

  function toggleLadiRef(img) {
    if (ladiRefs.includes(img)) ladiRefs = ladiRefs.filter(x => x !== img);
    else if (ladiRefs.length >= LADI_REFS_MAX) return toast(`Chọn tối đa ${LADI_REFS_MAX} ảnh. Bỏ bớt 1 ảnh rồi chọn lại.`, 'warn');
    else ladiRefs.push(img);
    renderLadiGallery();
  }

  resImagesGrid.addEventListener('click', (e) => {
    const card = e.target.closest('[data-img-idx]');
    if (card) toggleLadiRef(currentLadiImages[Number(card.dataset.imgIdx)]);
  });

  document.getElementById('btn-upload-custom-ladi-img').addEventListener('click', async () => {
    const res = await api?.selectImageFile();
    if (res && res.dataUrl) {
      currentLadiImages.unshift(res.dataUrl);
      toggleLadiRef(res.dataUrl);
    }
  });

  const ladiNoPrice = document.getElementById('ladi-no-price');
  // reuse: chỉ sinh lại kịch bản từ trang đã quét (khi đổi tuỳ chọn), không tải lại trang.
  async function scrapeLadi(reuse) {
    const url = inputLadiUrl.value.trim();
    if (!url || !url.startsWith('http')) {
      toast('Link LadiPage chưa hợp lệ (phải bắt đầu bằng https://).', 'warn');
      return;
    }

    btnScrapeLadi.disabled = true;
    ladiLoading.hidden = false;
    ladiSkeleton.hidden = false;
    ladiResults.hidden = true;

    try {
      const layout = ladiLayout();
      const res = await api.scrapeAndAnalyzeLadi(url, { noPrice: ladiNoPrice.checked, reuse, ...layout });
      if (!res || !res.success) {
        throw new Error(res?.error || 'Không thể cào dữ liệu từ đường link này');
      }
      const keep = reuse && { idx: selectedScriptIdx, refs: ladiRefs, imgs: currentLadiImages, picked };
      currentLadiData = res.data;
      genLayout = JSON.stringify(layout);
      renderLadiResults(currentLadiData);
      if (keep) { // sinh lại: giữ ảnh đã chọn và tab kịch bản đang xem
        [ladiRefs, currentLadiImages] = [keep.refs, keep.imgs];
        setPicked(keep.picked);
        (ladiScriptTabs.querySelector(`[data-script-idx="${keep.idx}"]`) || ladiScriptTabs.querySelector('[data-script-idx]')).click();
      }
    } catch (err) {
      toast('Lỗi khi phân tích LadiPage: ' + err.message, 'danger');
    } finally {
      btnScrapeLadi.disabled = false;
      ladiLoading.hidden = true;
      ladiSkeleton.hidden = true;
    }
  }
  btnScrapeLadi.addEventListener('click', () => scrapeLadi(false));
  ladiNoPrice.addEventListener('change', () => currentLadiData && scrapeLadi(true));

  function renderLadiResults(data) {
    const facts = data.facts || {};
    ladiResults.hidden = false;
    resProductName.textContent = facts.name || data.productName;
    resProductFacts.innerHTML = [
      facts.price && `<span class="fact-chip price">${escapeHtml(facts.price)}</span>`,
      ...(facts.offers || []).map(o => `<span class="fact-chip">${escapeHtml(o)}</span>`),
      facts.season && `<span class="fact-chip">Mùa: ${escapeHtml(facts.season)}</span>`
    ].filter(Boolean).join('') || '<span class="muted small">Không tìm thấy giá / ưu đãi trên trang.</span>';
    resProductUsp.textContent = facts.highlights?.length ? 'Điểm nổi bật: ' + facts.highlights.join(' · ') : '';
    resProductRaw.innerHTML = (data.rawLines || []).map(l => `<li>${escapeHtml(l)}</li>`).join('') || '<li>Không có</li>';

    currentLadiImages = [...(data.images || [])];
    ladiRefs = currentLadiImages.slice(0, 2); // 2 ảnh đầu thường là ảnh chính của trang
    btnImportAll.hidden = data.scripts.length < 2;

    ladiScriptTabs.innerHTML = data.scripts.map((sc, i) =>
      `<span class="pick-chip"><input type="checkbox" data-pick="${i}" title="Tích để đưa vào hàng đợi"><button type="button" class="preset-chip ${i ? '' : 'active'}" data-script-idx="${i}">#${i + 1} ${escapeHtml(sc.name)}</button></span>`).join('');
    selectedScriptIdx = 0;
    setPicked(new Set([0]));
    renderScriptScenes(data.scripts[0]);
  }

  // Tích nhiều kịch bản → mỗi kịch bản thành 1 video, hàng đợi làm lần lượt.
  function setPicked(set) {
    const n = currentLadiData.scripts.length;
    picked = new Set([...set].filter(i => i < n));
    ladiScriptTabs.querySelectorAll('[data-pick]').forEach(cb => { cb.checked = picked.has(Number(cb.dataset.pick)); });
    btnImportToMuse.disabled = !picked.size;
    btnImportToMuse.textContent = picked.size ? `Đưa ${picked.size} kịch bản đã tích vào hàng đợi` : 'Tích ít nhất 1 kịch bản';
    btnImportAll.textContent = picked.size === n ? 'Bỏ tích hết' : `Tích cả ${n}`;
  }
  ladiScriptTabs.addEventListener('change', (e) => {
    const i = Number(e.target.dataset.pick);
    if (!currentLadiData || Number.isNaN(i)) return;
    const next = new Set(picked);
    e.target.checked ? next.add(i) : next.delete(i);
    setPicked(next);
  });

  ladiScriptTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-script-idx]');
    if (!btn || !currentLadiData) return;
    ladiScriptTabs.querySelectorAll('.preset-chip').forEach(b => b.classList.toggle('active', b === btn));
    selectedScriptIdx = Number(btn.dataset.scriptIdx);
    renderScriptScenes(currentScript());
  });

  function renderScriptScenes(script) {
    if (!script) return;
    ladiScriptScenesContainer.innerHTML = script.scenes.map(s => {
      const wc = wordCount(s.voiceover);

      return `
        <div class="scene-card">
          <div class="row-between">
            <strong>${escapeHtml(s.time)}</strong>
            <span class="muted small">Cảnh ${s.index}</span>
          </div>
          ${script.silent ? `<div class="muted small">Không lời — chỉ nhạc nền (bỏ qua giọng và người dẫn đã chọn)</div>` : `
          <label class="label">Lời đọc (giọng chọn ở phần cài đặt bên dưới, không hiện chữ trên video)</label>
          <textarea class="textarea" rows="3" data-scene="${s.index}" data-field="voiceover">${escapeHtml(s.voiceover || '')}</textarea>
          <div class="word-count" data-wc="${s.index}" data-tone="${wc.tone}">${wc.html}</div>`}
          <label class="label">Hình ảnh (mô tả cho Muse dựng)</label>
          <textarea class="textarea" rows="3" data-scene="${s.index}" data-field="musePrompt">${escapeHtml(s.musePrompt || '')}</textarea>
        </div>
      `;
    }).join('');
    renderLadiGallery();
  }

  // Sửa lời thoại / prompt ghi thẳng vào kịch bản → đổi tab kịch bản hay đổi ảnh không mất chữ đã sửa.
  ladiScriptScenesContainer.addEventListener('input', (e) => {
    const field = e.target.dataset.field;
    if (!field || !currentLadiData) return;
    const scene = currentScript().scenes.find(sc => String(sc.index) === e.target.dataset.scene);
    if (!scene) return;
    scene[field] = e.target.value;
    if (field === 'voiceover') {
      const el = ladiScriptScenesContainer.querySelector(`[data-wc="${scene.index}"]`);
      const wc = wordCount(scene.voiceover);
      el.dataset.tone = wc.tone;
      el.textContent = wc.html;
    }
    updateLadiSummary();
  });

  // Kịch bản → video trong hàng đợi (theo số bản ở ô "Số bản mỗi video"). null nếu còn cảnh trống.
  function ladiJobs(script) {
    const items = ladiItems(script);
    if (items.some(it => !it.text)) { toast(`${script.name}: còn cảnh chưa có mô tả hình ảnh, điền vào rồi đưa vào hàng đợi.`, 'warn'); return null; }
    const cfg = ladiCfg(script);
    const refs = ladiRefs.map(poolAdd);
    const copies = copiesValue();
    return Array.from({ length: copies }, (_, c) => makeJob({
      title: `${items[0].product || items[0].text.slice(0, 40)} · ${script.name}${copies > 1 ? ` · bản ${c + 1}` : ''}`,
      cfg, refs, scenes: items.map(it => ({ ...it }))
    }));
  }

  function importLadi(scripts) {
    const list = scripts.map(ladiJobs);
    if (list.some(l => !l)) return;
    addJobs(list.flat());
    goTab('tab-script');
  }
  const btnImportAll = document.getElementById('btn-import-all');
  btnImportToMuse.addEventListener('click', () => currentLadiData && picked.size && importLadi([...picked].sort((a, b) => a - b).map(i => currentLadiData.scripts[i])));
  btnImportAll.addEventListener('click', () => {
    if (!currentLadiData) return;
    const n = currentLadiData.scripts.length;
    setPicked(picked.size === n ? new Set() : new Set(currentLadiData.scripts.map((_, i) => i)));
  });
})();
