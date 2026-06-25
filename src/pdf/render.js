import { appState } from '../state/appState.js';

async function loadPDFFile(file){
  const arrayBuffer = await file.arrayBuffer();
  return await loadPDFDocument({data: arrayBuffer}, 1);
}

async function loadPDFUrl(url, targetPage=1){
  return await loadPDFDocument(url, targetPage);
}

async function loadPDFDocument(source, targetPage=1){
  // Loading UI
  const wrap = document.getElementById('readerCanvasWrap');
  document.getElementById('pdfUploadZone').style.display = 'none';
  wrap.style.display = '';
  wrap.innerHTML = '<div class="pdf-loading"><div class="pdf-spinner"></div><div class="pdf-loading-text">PDF yükleniyor\u2026</div></div>';

  try{
    const loadingTask = pdfjsLib.getDocument(source);
    const pdfDoc = await loadingTask.promise;
    appState.pdfDoc = pdfDoc;
    appState.pdfDocFasikulId = appState.aktifFasikul?.id || null;
    const manifestMaxPage = getManifestMaxPage(appState.aktifFasikul);
    const manifestPdfMaxPage = getManifestPdfMaxPage(appState.aktifFasikul);
    appState.visiblePages = getVisibleManifestPages(appState.aktifFasikul);
    appState.totalPages = manifestMaxPage ? Math.min(pdfDoc.numPages, manifestMaxPage) : pdfDoc.numPages;
    appState.pdfTotalPages = manifestPdfMaxPage ? Math.min(pdfDoc.numPages, manifestPdfMaxPage) : pdfDoc.numPages;
    appState.displayTotalPages = appState.visiblePages.length || appState.totalPages;
    appState.currentPage = Math.max(1, Math.min(targetPage || 1, appState.pdfTotalPages));

    document.getElementById('prevPageBtn').disabled = appState.currentPage === 1;
    document.getElementById('nextPageBtn').disabled = appState.currentPage === appState.totalPages;

    renderPages();
    updatePageIndicator();
    showToast('PDF y\u00fcklendi \u2014 ' + appState.displayTotalPages + ' sayfa \u2713','success');
    return true;
  } catch(err){
    wrap.innerHTML = '';
    document.getElementById('pdfUploadZone').style.display = '';
    showToast('PDF y\u00fcklenemedi: ' + err.message,'error');
    console.error('PDF load error:', err);
    return false;
  }
}

// ══════════════════════════════════════════════════════════
// SCROLL-BASED MULTI-PAGE PDF RENDER
// ══════════════════════════════════════════════════════════

// Her sayfa için ayrı Fabric canvas map: { pageNum: fabricInstance }
appState.fabricCanvases = {};
appState._pageObserver = null;
appState._scrollingToPage = false;
appState.viewMode = 'single'; // 'single' | 'scroll'

/**
 * Tüm sayfalar için placeholder div'ler oluşturur,
 * IntersectionObserver ile görünür sayfaları render eder.
 */

async function renderAllPages(){
  const wrap = document.getElementById('readerCanvasWrap');
  wrap.innerHTML = '';

  // Eski Fabric instance'ları temizle
  Object.values(appState.fabricCanvases).forEach(fc=>{ try{fc.dispose();}catch(e){} });
  appState.fabricCanvases = {};
  appState.fabricCanvas = null;

  // Eski observer'ı kapat
  if(appState._pageObserver){ appState._pageObserver.disconnect(); appState._pageObserver = null; }

  const totalPages = appState.totalPages;
  const dpr = window.devicePixelRatio || 1;
  const baseScale = appState.zoom / 100;

  // Her sayfa için önce placeholder oluştur (boyut sonra doldurulacak)
  for(let i = 1; i <= totalPages; i++){
    const pageWrap = document.createElement('div');
    pageWrap.id = 'page-wrap-' + i;
    pageWrap.dataset.pageNum = i;
    pageWrap.style.cssText = 'position:relative;display:flex;align-items:center;justify-content:center;margin:12px auto;flex-shrink:0;';

    // Placeholder boyut (PDF yoksa sabit, PDF varsa ilk sayfa boyutundan tahmin)
    const placeholderH = Math.round(baseScale * 990);
    const placeholderW = Math.round(baseScale * 700);
    pageWrap.style.width = placeholderW + 'px';
    pageWrap.style.height = placeholderH + 'px';
    pageWrap.style.background = 'var(--bg-2)';
    pageWrap.style.borderRadius = '4px';
    pageWrap.style.boxShadow = '0 4px 24px rgba(0,0,0,.4)';

    // Sayfa numarası etiketi
    const numLabel = document.createElement('div');
    numLabel.className = 'page-num-label';
    numLabel.textContent = i;
    numLabel.style.cssText = 'position:absolute;bottom:8px;right:12px;font-size:11px;color:var(--text-muted);background:var(--bg-3);padding:2px 8px;border-radius:99px;border:1px solid var(--border);pointer-events:none;z-index:5;';
    pageWrap.appendChild(numLabel);

    wrap.appendChild(pageWrap);
  }

  // IntersectionObserver: görünür sayfaları lazy render et
  appState._pageObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if(entry.isIntersecting){
        const pn = parseInt(entry.target.dataset.pageNum);
        if(!entry.target.dataset.rendered){
          entry.target.dataset.rendered = '1';
          if(appState.pdfDoc){
            renderSinglePDFPage(pn, entry.target);
          } else {
            renderSingleFallbackPage(pn, entry.target);
          }
        }
      }
    });
  }, { root: wrap, rootMargin: '200px 0px', threshold: 0.01 });

  document.querySelectorAll('#readerCanvasWrap [data-page-num]').forEach(el => {
    appState._pageObserver.observe(el);
  });

  // Scroll listener: mevcut sayfayı takip et
  wrap.onscroll = throttleScrollHandler;

  updatePageIndicator();
}

function throttleScrollHandler(){
  if(appState._scrollThrottle) return;
  appState._scrollThrottle = setTimeout(()=>{
    appState._scrollThrottle = null;
    if(appState._scrollingToPage) return;
    updateCurrentPageFromScroll();
  }, 80);
}

function updateCurrentPageFromScroll(){
  const wrap = document.getElementById('readerCanvasWrap');
  const wrapRect = wrap.getBoundingClientRect();
  const centerY = wrapRect.top + wrapRect.height / 2;
  let closest = 1, minDist = Infinity;
  document.querySelectorAll('#readerCanvasWrap [data-page-num]').forEach(el => {
    const r = el.getBoundingClientRect();
    const elCenterY = r.top + r.height / 2;
    const dist = Math.abs(elCenterY - centerY);
    if(dist < minDist){ minDist = dist; closest = parseInt(el.dataset.pageNum); }
  });
  if(closest !== appState.currentPage){
    appState.currentPage = closest;
    updatePageIndicator();
    document.getElementById('prevPageBtn').disabled = appState.currentPage === 1;
    document.getElementById('nextPageBtn').disabled = appState.currentPage === appState.totalPages;
    syncNavToPage(closest);
    window.publishCanli?.();
  }
}

/**
 * Tek bir PDF sayfasını render eder (lazy)
 */

async function renderSinglePDFPage(pageNum, pageWrap){
  if(!appState.pdfDoc) return;
  try{
    const page = await appState.pdfDoc.getPage(pageNum);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const baseScale = getReaderFitScale(page, document.getElementById('readerCanvasWrap'));
    const renderScale = baseScale * dpr;
    const viewport = page.getViewport({scale: renderScale});
    const displayW = viewport.width / dpr;
    const displayH = viewport.height / dpr;

    pageWrap.style.width = displayW + 'px';
    pageWrap.style.height = displayH + 'px';
    pageWrap.style.background = '#fff';

    // PDF render canvas
    const pdfCanvas = document.createElement('canvas');
    pdfCanvas.width = viewport.width;
    pdfCanvas.height = viewport.height;
    pdfCanvas.style.cssText = 'display:block;position:absolute;top:0;left:0;width:100%;height:100%;border-radius:4px;';
    pdfCanvas.style.background = 'transparent';
    pageWrap.insertBefore(pdfCanvas, pageWrap.firstChild);

    const ctx2d = pdfCanvas.getContext('2d');
    if(!ctx2d) throw new Error('Canvas 2D context alınamadı');
    await page.render({ canvasContext: ctx2d, viewport }).promise;

    // Fabric çizim canvas
    const drawEl = document.createElement('canvas');
    drawEl.className = 'fabric-draw-canvas';
    drawEl.width = displayW;
    drawEl.height = displayH;
    drawEl.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;border-radius:4px;';
    pageWrap.insertBefore(drawEl, pageWrap.querySelector('.page-num-label'));

    initFabricForPage(drawEl, displayW, displayH, pageNum);

  } catch(err){
    console.error('Sayfa render hatası:', err);
    pageWrap.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:300px;flex-direction:column;gap:12px;color:var(--text-muted,#888)">
      <div style="font-size:36px">⚠️</div>
      <div style="font-size:14px;font-weight:600">Sayfa ${pageNum} yüklenemedi</div>
      <button onclick="window.renderPdfPages?.()" style="padding:6px 14px;border-radius:8px;border:1px solid var(--border,#ccc);background:var(--bg-secondary,#f5f5f5);cursor:pointer;font-size:13px">Tekrar Dene</button>
    </div>`;
    window.showToast?.(`Sayfa ${pageNum} yüklenemedi`, 'error');
  }
}

/**
 * PDF olmadığında mock sayfa render eder (lazy)
 */

function renderSingleFallbackPage(pageNum, pageWrap){
  const fas = appState.aktifFasikul;
  if(!fas) return;
  const displayW = Math.round(appState.zoom / 100 * 700);
  const displayH = Math.round(appState.zoom / 100 * 990);
  pageWrap.style.width = displayW + 'px';
  pageWrap.style.height = displayH + 'px';
  pageWrap.style.background = 'transparent';
  pageWrap.style.boxShadow = 'none';

  const mockDiv = document.createElement('div');
  mockDiv.className = 'pdf-page-mock';
  mockDiv.style.cssText = 'width:' + displayW + 'px;min-height:' + displayH + 'px;position:absolute;top:0;left:0;';
  mockDiv.innerHTML = buildMockPageContent(pageNum, fas);
  pageWrap.insertBefore(mockDiv, pageWrap.querySelector('.page-num-label'));

  const drawEl = document.createElement('canvas');
  drawEl.className = 'fabric-draw-canvas';
  drawEl.width = displayW;
  drawEl.height = displayH;
  drawEl.style.cssText = 'position:absolute;top:0;left:0;width:' + displayW + 'px;height:' + displayH + 'px;';
  pageWrap.insertBefore(drawEl, pageWrap.querySelector('.page-num-label'));
  initFabricForPage(drawEl, displayW, displayH, pageNum);
}

/**
 * Belirli bir sayfa için Fabric canvas başlatır, aktif sayfaysa appState.fabricCanvas'a atar
 */

function isNarrowReader(){
  return window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
}

function getReaderFitScale(page, wrap){
  const zoomScale = appState.zoom / 100;
  const container = wrap || document.getElementById('readerCanvasWrap');
  const styles = container ? getComputedStyle(container) : null;
  const padX = styles ? parseFloat(styles.paddingLeft || 0) + parseFloat(styles.paddingRight || 0) : 0;
  // clientWidth=0 olursa layout henüz hazır değil — window.innerWidth'e düş
  const rawW = container?.clientWidth || 0;
  const viewportW = Math.max(280, (rawW > 0 ? rawW : window.innerWidth) - padX - 2);
  const natural = page.getViewport({scale: 1});
  const fitScale = viewportW / natural.width;
  return Math.max(0.35, fitScale * zoomScale);
}

function sizeReaderStage(stage, wrap, displayW, displayH){
  const styles = getComputedStyle(wrap);
  const padX = parseFloat(styles.paddingLeft || 0) + parseFloat(styles.paddingRight || 0);
  const padY = parseFloat(styles.paddingTop || 0) + parseFloat(styles.paddingBottom || 0);
  const viewportW = Math.max(0, wrap.clientWidth - padX);
  const viewportH = Math.max(0, wrap.clientHeight - padY);
  stage.style.width = Math.ceil(Math.max(viewportW, displayW + 32)) + 'px';
  stage.style.height = Math.ceil(Math.max(viewportH, displayH + 32)) + 'px';
}

// ── renderPages: mod'a göre tek sayfa veya scroll

function renderPages(){
  if(appState.viewMode === 'scroll'){
    return renderAllPages().then(()=>{
      appState._renderedZoom = appState.zoom;
      setTimeout(()=>scrollToPage(appState.currentPage, 'auto'), 50);
    });
  } else {
    return renderSinglePageMode(appState.currentPage).then(()=>{
      appState._renderedZoom = appState.zoom;
    });
  }
}

// ── Tek sayfa modu

async function renderSinglePageMode(pageNum){
  const wrap = document.getElementById('readerCanvasWrap');
  wrap.innerHTML = '';

  // Eski Fabric instance'ları temizle
  Object.values(appState.fabricCanvases).forEach(fc=>{ try{fc.dispose();}catch(e){} });
  appState.fabricCanvases = {};
  appState.fabricCanvas = null;
  if(appState._pageObserver){ appState._pageObserver.disconnect(); appState._pageObserver = null; }

  // Cap DPR at 2 — iPad 3x + yüksek zoom birleşimi çok büyük canvas oluşturur
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const baseScale = appState.zoom / 100;

  const stage = document.createElement('div');
  stage.className = 'reader-page-stage';

  const pageWrap = document.createElement('div');
  pageWrap.id = 'page-wrap-' + pageNum;
  pageWrap.dataset.pageNum = pageNum;
  pageWrap.style.cssText = 'position:relative;margin:16px auto;flex-shrink:0;border-radius:4px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.4);';

  if(appState.pdfDoc){
    try{
      const page = await appState.pdfDoc.getPage(pageNum);
      // Force layout reflow before reading clientWidth (Safari timing fix)
      void wrap.getBoundingClientRect();
      const baseScale = getReaderFitScale(page, wrap);
      const renderScale = baseScale * dpr;
      const viewport = page.getViewport({scale: renderScale});
      const displayW = viewport.width / dpr;
      const displayH = viewport.height / dpr;

      pageWrap.style.width = displayW + 'px';
      pageWrap.style.height = displayH + 'px';
      pageWrap.style.background = '#fff';
      sizeReaderStage(stage, wrap, displayW, displayH);

      // DOM'a önce ekle — Safari off-DOM canvas render'ı sessizce başarısız olur
      stage.appendChild(pageWrap);
      wrap.appendChild(stage);

      const pdfCanvas = document.createElement('canvas');
      pdfCanvas.width = viewport.width;
      pdfCanvas.height = viewport.height;
      pdfCanvas.style.cssText = 'display:block;position:absolute;top:0;left:0;width:100%;height:100%;background:transparent;';
      pageWrap.appendChild(pdfCanvas);

      const ctx2d = pdfCanvas.getContext('2d');
      if(!ctx2d) throw new Error('Canvas 2D context alınamadı (bellek yetersiz olabilir)');
      await page.render({ canvasContext: ctx2d, viewport }).promise;

      const drawEl = document.createElement('canvas');
      drawEl.className = 'fabric-draw-canvas';
      drawEl.width = displayW; drawEl.height = displayH;
      drawEl.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:transparent;';
      pageWrap.appendChild(drawEl);
      initFabricForPage(drawEl, displayW, displayH, pageNum);
    } catch(err){
      console.error('Sayfa render hatası:', err);
      showToast('Sayfa ' + pageNum + ' render hatası: ' + err.message, 'error');
    }
  } else {
    const baseScale = appState.zoom / 100;
    const displayW = Math.round(baseScale * 700);
    const displayH = Math.round(baseScale * 990);
    pageWrap.style.width = displayW + 'px';
    pageWrap.style.height = displayH + 'px';
    pageWrap.style.boxShadow = 'none';
    sizeReaderStage(stage, wrap, displayW, displayH);
    const mockDiv = document.createElement('div');
    mockDiv.className = 'pdf-page-mock';
    mockDiv.style.cssText = 'width:' + displayW + 'px;min-height:' + displayH + 'px;';
    mockDiv.innerHTML = buildMockPageContent(pageNum, appState.aktifFasikul);
    pageWrap.appendChild(mockDiv);
    const drawEl = document.createElement('canvas');
    drawEl.className = 'fabric-draw-canvas';
    drawEl.width = displayW; drawEl.height = displayH;
    drawEl.style.cssText = 'position:absolute;top:0;left:0;width:' + displayW + 'px;height:' + displayH + 'px;';
    pageWrap.appendChild(drawEl);
    stage.appendChild(pageWrap);
    wrap.appendChild(stage);
    initFabricForPage(drawEl, displayW, displayH, pageNum);
  }

  updatePageIndicator();
  document.getElementById('prevPageBtn').disabled = pageNum === 1;
  document.getElementById('nextPageBtn').disabled = pageNum === appState.totalPages;
  syncNavToPage(pageNum);
}

// Eski API uyumu

async function renderPDFPage(pageNum){ renderPages(); }

function renderFallbackPage(pageNum){ renderPages(); }

// ── Mod değiştir

function setViewMode(mode){
  appState.viewMode = mode;
  // Context menu'yu kapat
  const cm = document.getElementById('pdfContextMenu');
  if(cm) cm.style.display = 'none';
  // Toolbar butonunu güncelle
  const btn = document.getElementById('viewModeBtn');
  if(btn) btn.textContent = mode === 'scroll' ? '📜' : '📄';
  showToast(mode === 'scroll' ? 'Sürekli kaydırma modu 📜' : 'Tek sayfa modu 📄', 'info');
  renderPages();
}

// ── Context Menu

function initPDFContextMenu(){
  const wrap = document.getElementById('readerCanvasWrap');

  // Context menu DOM
  let menu = document.getElementById('pdfContextMenu');
  if(!menu){
    menu = document.createElement('div');
    menu.id = 'pdfContextMenu';
    menu.style.cssText = `
      position:fixed;z-index:9999;background:var(--bg-2);border:1px solid var(--border-strong);
      border-radius:var(--radius);box-shadow:var(--shadow-xl);padding:6px;min-width:200px;
      display:none;font-family:var(--font-ui);
    `;
    menu.innerHTML = `
      <div class="ctx-label" style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted);padding:4px 10px 6px;">Görünüm Modu</div>
      <button class="ctx-item" id="ctxSingle" onclick="setViewMode('single')">
        <span style="font-size:15px">📄</span>
        <div><div style="font-weight:600;font-size:13px">Tek Sayfa</div><div style="font-size:11px;color:var(--text-muted)">Her seferinde bir sayfa</div></div>
      </button>
      <button class="ctx-item" id="ctxScroll" onclick="setViewMode('scroll')">
        <span style="font-size:15px">📜</span>
        <div><div style="font-weight:600;font-size:13px">Sürekli Kaydırma</div><div style="font-size:11px;color:var(--text-muted)">Tüm sayfalar dikey sırada</div></div>
      </button>
      <div style="height:1px;background:var(--border);margin:6px 0"></div>
      <button class="ctx-item" onclick="promptPageJump();document.getElementById('pdfContextMenu').style.display='none'">
        <span style="font-size:15px">🔢</span>
        <div><div style="font-weight:600;font-size:13px">Sayfaya Git…</div><div style="font-size:11px;color:var(--text-muted)">Sayfa numarası gir</div></div>
      </button>
      <div style="height:1px;background:var(--border);margin:6px 0"></div>
      <button class="ctx-item" id="ctxFullscreen" onclick="window.toggleSolveMode&&window.toggleSolveMode();document.getElementById('pdfContextMenu').style.display='none'">
        <span style="font-size:15px">⛶</span>
        <div><div style="font-weight:600;font-size:13px">Tam Ekran</div><div style="font-size:11px;color:var(--text-muted)">Soru kartı tüm ekranı kaplar</div></div>
      </button>
    `;
    document.body.appendChild(menu);

    // Dışarı tıklayınca kapat
    document.addEventListener('click', e=>{
      if(!menu.contains(e.target)) menu.style.display = 'none';
    });
  }

  // Sağ tık (masaüstü)
  wrap.addEventListener('contextmenu', e=>{
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY);
  });
}

function showContextMenu(x, y){
  const menu = document.getElementById('pdfContextMenu');
  if(!menu) return;
  document.getElementById('ctxSingle')?.classList.toggle('ctx-active', appState.viewMode === 'single');
  document.getElementById('ctxScroll')?.classList.toggle('ctx-active', appState.viewMode === 'scroll');
  const mx = Math.min(x, window.innerWidth - 220);
  const my = Math.min(y, window.innerHeight - 180);
  menu.style.left = mx + 'px';
  menu.style.top = my + 'px';
  menu.style.display = 'block';
}

function openViewModeMenu(e){
  e.stopPropagation();
  const menu = document.getElementById('pdfContextMenu');
  if(menu && menu.style.display === 'block'){
    menu.style.display = 'none';
    return;
  }
  // Butonu altta konumlandır
  const btn = document.getElementById('viewModeBtn');
  if(btn){
    const rect = btn.getBoundingClientRect();
    showContextMenu(rect.left, rect.bottom + 4);
  } else {
    showContextMenu(e.clientX, e.clientY);
  }
}


function buildMockPageContent(pageNum, fas){
  // Find which konu this page belongs to
  let konuInfo = {konu:fas.ad, altAd:'', sorular:[]};
  for(const k of fas.konular){
    if(pageNum>=k.sayfaBasl && pageNum<=k.sayfaBitis){
      konuInfo.konu = k.ad;
      const _mockKartBazli = k._kartBazliKonu || k.altKonular?.some(ak => ak.sorular?.some(s=>!!s.sayfa));
      if(_mockKartBazli){
        // Kart bazlı: sorular içinde sayfa eşleşmesi ara
        const ak = k.altKonular?.[0];
        if(ak){
          const s = ak.sorular?.find(s=>s.sayfa===pageNum);
          if(s){
            konuInfo.altAd = ak.ad;
            konuInfo.sorular = [s]; // o sayfada tek soru var
          }
        }
      } else {
        for(const ak of k.altKonular||[]){
          if(ak.sayfa===pageNum){
            konuInfo.altAd = ak.ad;
            konuInfo.sorular = ak.sorular||[];
          }
        }
      }
      break;
    }
  }

  const dersRenk = appState.aktifDers.id==='mat'?'#4c1d95':appState.aktifDers.id==='fiz'?'#0c4a6e':'#052e16';

  let html = `<div class="pdf-mock-content">
    <div class="pdf-mock-header" style="background:linear-gradient(135deg,${dersRenk},#1e1b4b)">
      <span class="pdf-h-title">${fas.ad}</span>
      <span class="pdf-h-right">Sayfa ${pageNum}</span>
    </div>
    <div class="pdf-topic-title" style="border-bottom-color:${dersRenk};color:${dersRenk}">${konuInfo.konu}</div>`;

  if(pageNum===1 || !konuInfo.altAd){
    html += `<div class="pdf-definition-box">
      <strong>Tanım</strong>
      Düzlemde bir <strong>koordinat sistemi</strong>, birbirine dik iki sayı doğrusunun oluşturduğu yapıdır.
      Yatay eksene <em>x ekseni</em>, dikey eksene <em>y ekseni</em> denir.
      Bu eksenler düzlemi dört bölgeye (çeyreğe) ayırır.
    </div>
    <div class="pdf-formula">d(A,B) = √[(x₂-x₁)² + (y₂-y₁)²]</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <span class="pdf-coord-box">I. Bölge (+,+)</span>
      <span class="pdf-coord-box">II. Bölge (-,+)</span>
      <span class="pdf-coord-box">III. Bölge (-,-)</span>
      <span class="pdf-coord-box">IV. Bölge (+,-)</span>
    </div>`;
  }

  if(konuInfo.sorular.length>0){
    html += `<div style="font-size:11px;font-weight:700;color:${dersRenk};margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">${konuInfo.altAd}</div>`;
    konuInfo.sorular.slice(0,4).forEach(s=>{
      html += `<div class="pdf-q-box">
        <div class="q-header">
          <div class="q-num" style="background:${dersRenk}">${s.no}</div>
          <div class="q-text">${s.onizleme}</div>
        </div>
        <div class="pdf-options">
          <span class="pdf-opt">A</span><span class="pdf-opt">B</span><span class="pdf-opt">C</span><span class="pdf-opt">D</span><span class="pdf-opt">E</span>
        </div>
      </div>`;
    });
  } else {
    // Placeholder content for definition pages
    for(let i=0;i<3;i++){
      html += `<div class="pdf-q-box">
        <div class="q-header">
          <div class="q-num" style="background:${dersRenk}">${i+1+pageNum*3}</div>
          <div class="q-text">Örnek soru metni — sayfa ${pageNum}, soru ${i+1}</div>
        </div>
        <div class="pdf-options">
          <span class="pdf-opt">A</span><span class="pdf-opt">B</span><span class="pdf-opt">C</span><span class="pdf-opt">D</span><span class="pdf-opt">E</span>
        </div>
      </div>`;
    }
  }

  html += `<div class="pdf-page-footer"><span>${fas.ad} · ${appState.aktifDers.ad}</span><span>Sayfa ${pageNum}</span></div></div>`;
  return html;
}

// ── Fabric.js Canvas — PDF canvas üzerine bağlanır

function changePage(delta){
  if(changeQuestionPage(delta)) return;
  const newPage = appState.currentPage + delta;
  if(newPage<1 || newPage>appState.totalPages) return;
  saveDrawing();
  goToPage(newPage);
}

function goToPage(n){
  const maxPage = appState.pdfTotalPages || appState.totalPages;
  appState.currentPage = Math.max(1,Math.min(n,maxPage));
  if(appState.viewMode === 'scroll'){
    // Scroll modunda: sayfa zaten render edilmiş, sadece scroll et
    scrollToPage(appState.currentPage, 'smooth');
  } else {
    renderSinglePageMode(appState.currentPage);
  }
  updatePageIndicator();
  document.getElementById('prevPageBtn').disabled = appState.currentPage===1;
  document.getElementById('nextPageBtn').disabled = appState.currentPage===appState.totalPages;
  window.publishCanli?.();
}

function scrollToPage(pageNum, behavior){
  const el = document.getElementById('page-wrap-' + pageNum);
  if(el){
    appState._scrollingToPage = true;
    el.scrollIntoView({behavior: behavior || 'smooth', block: 'start'});
    setTimeout(()=>{ appState._scrollingToPage = false; }, 600);
  }
}

function updatePageIndicator(){
  const visibleIdx = (appState.visiblePages || []).indexOf(appState.currentPage);
  const isSolutionPage = visibleIdx < 0;
  const displayTotal = appState.displayTotalPages || appState.totalPages;
  document.getElementById('pageIndicator').textContent = isSolutionPage
    ? `Çözüm / ${displayTotal} sayfa`
    : `Sayfa ${visibleIdx + 1} / ${displayTotal}`;
  document.getElementById('rpSure').textContent = formatTime(appState.timerSec);
}

function promptPageJump(){
  const displayTotal = appState.displayTotalPages || appState.totalPages;
  const n = parseInt(prompt(`Sayfa giriniz (1-${displayTotal}):`));
  if(isNaN(n)) return;
  const target = (appState.visiblePages || [])[n - 1] || n;
  goToPage(target);
}

function changeZoom(delta){
  const wrap = document.getElementById('readerCanvasWrap');
  const renderedZoom = appState._renderedZoom || appState.zoom;
  const viewportX = (wrap?.clientWidth || 0) / 2;
  const viewportY = (wrap?.clientHeight || 0) / 2;
  const contentX = (wrap?.scrollLeft || 0) + viewportX;
  const contentY = (wrap?.scrollTop || 0) + viewportY;
  appState.zoom = Math.max(40,Math.min(200,appState.zoom+delta));
  document.getElementById('zoomLabel').textContent = `%${appState.zoom}`;
  scheduleCardZoomRender({
    contentX,
    contentY,
    viewportX,
    viewportY,
    ratio: appState.zoom / renderedZoom
  });
}

function scheduleCardZoomRender(anchor){
  const wrap = document.getElementById('readerCanvasWrap');
  if(!wrap) return;
  if(anchor) appState._zoomAnchor = anchor;
  clearTimeout(appState._zoomRenderTimer);
  wrap.classList.add('zoom-settling');
  appState._zoomRenderTimer = setTimeout(async ()=>{
    const savedAnchor = appState._zoomAnchor;
    appState._zoomAnchor = null;
    const oldScrollBehavior = wrap.style.scrollBehavior;
    wrap.style.scrollBehavior = 'auto';
    await Promise.resolve(renderPages());
    requestAnimationFrame(()=>{
      if(savedAnchor){
        const rect = wrap.getBoundingClientRect();
        wrap.scrollLeft = Math.max(0, savedAnchor.contentX * savedAnchor.ratio - savedAnchor.viewportX);
        wrap.scrollTop = Math.max(0, savedAnchor.contentY * savedAnchor.ratio - savedAnchor.viewportY);
      }
      wrap.style.scrollBehavior = oldScrollBehavior;
      wrap.classList.remove('zoom-settling');
    });
  }, 90);
}

function initCardZoomPan(){
  const wrap = document.getElementById('readerCanvasWrap');
  if(!wrap || wrap.dataset.zoomPanReady) return;
  wrap.dataset.zoomPanReady = '1';
  wrap.classList.add('card-pan-ready');

  let isPanning = false;
  let startX = 0, startY = 0, startScrollLeft = 0, startScrollTop = 0;

  const isCardGestureTarget = (target) =>
    !!target.closest('#readerCanvasWrap') && !target.closest('button,label,input,select,.reader-right,.reader-toolbar,.reader-bottom-bar');

  wrap.addEventListener('wheel', (e)=>{
    if(!document.getElementById('reader-overlay')?.classList.contains('open')) return;
    if(!isCardGestureTarget(e.target)) return;

    // Trackpad pinch on Chrome/Safari arrives as ctrl/meta wheel. Plain wheel remains pan/scroll.
    if(e.ctrlKey || e.metaKey){
      e.preventDefault();
      const beforeLeft = wrap.scrollLeft;
      const beforeTop = wrap.scrollTop;
      const rect = wrap.getBoundingClientRect();
      const viewportX = e.clientX - rect.left;
      const viewportY = e.clientY - rect.top;
      const relX = viewportX + beforeLeft;
      const relY = viewportY + beforeTop;
      const oldZoom = appState.zoom;
      const delta = e.deltaY < 0 ? 5 : -5;
      appState.zoom = Math.max(40, Math.min(200, appState.zoom + delta));
      if(appState.zoom === oldZoom) return;
      document.getElementById('zoomLabel').textContent = `%${appState.zoom}`;
      scheduleCardZoomRender({
        contentX: relX,
        contentY: relY,
        viewportX,
        viewportY,
        ratio: appState.zoom / (appState._renderedZoom || oldZoom)
      });
    }
  }, {passive:false});

  wrap.addEventListener('pointerdown', (e)=>{
    if(e.button !== 0 || !isCardGestureTarget(e.target)) return;
    if(appState.drawTool !== 'select' && e.target.closest('canvas')) return;
    if(appState._touchGestureActive) return; // pinch/pan gesture devam ediyor
    isPanning = true;
    startX = e.clientX; startY = e.clientY;
    startScrollLeft = wrap.scrollLeft; startScrollTop = wrap.scrollTop;
    wrap.classList.add('card-panning');
    wrap.setPointerCapture?.(e.pointerId);
  });

  wrap.addEventListener('pointermove', (e)=>{
    if(!isPanning) return;
    e.preventDefault();
    wrap.scrollLeft = startScrollLeft - (e.clientX - startX);
    wrap.scrollTop = startScrollTop - (e.clientY - startY);
  });

  const stopPan = (e)=>{
    if(!isPanning) return;
    isPanning = false;
    wrap.classList.remove('card-panning');
    try{ wrap.releasePointerCapture?.(e.pointerId); }catch(_e){}
  };
  wrap.addEventListener('pointerup', stopPan);
  wrap.addEventListener('pointercancel', stopPan);
  wrap.addEventListener('pointerleave', stopPan);
}

// ══════════════════════════════════════════════════════════
// TABLET TOUCH GESTURES — Pinch-to-zoom + two-finger pan/scroll
// Capture phase ile Fabric.js'e ulaşmadan 2-parmak olayları yakalar.
// ══════════════════════════════════════════════════════════
function initTouchGestures() {
  const wrap = document.getElementById('readerCanvasWrap');
  if (!wrap || wrap.dataset.touchGestureReady) return;
  wrap.dataset.touchGestureReady = '1';

  let g = null; // gesture state — null means inactive

  function dist(a, b) { return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY); }
  function midpt(a, b) { return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }; }

  // CSS scale on all rendered stages for instant visual feedback
  function applyVisualScale(scale, cx, cy) {
    wrap.querySelectorAll('.reader-page-stage').forEach(stage => {
      const r = stage.getBoundingClientRect();
      stage.style.transformOrigin = `${cx - r.left}px ${cy - r.top}px`;
      stage.style.transform = `scale(${scale})`;
    });
  }
  function clearVisualScale() {
    wrap.querySelectorAll('.reader-page-stage').forEach(s => {
      s.style.transform = '';
      s.style.transformOrigin = '';
    });
  }

  wrap.addEventListener('touchstart', e => {
    if (e.touches.length >= 2) {
      e.preventDefault();
      e.stopPropagation();
      appState._touchGestureActive = true;
      const t0 = e.touches[0], t1 = e.touches[1];
      g = {
        startDist: dist(t0, t1),
        startZoom: appState.zoom,
        startMid: midpt(t0, t1),
        lastMid: midpt(t0, t1),
        lastDist: dist(t0, t1),
        scale: 1,
      };
    } else {
      g = null;
      appState._touchGestureActive = false;
    }
  }, { passive: false, capture: true });

  wrap.addEventListener('touchmove', e => {
    if (!g || e.touches.length < 2) return;
    e.preventDefault();
    e.stopPropagation();

    const t0 = e.touches[0], t1 = e.touches[1];
    const d = dist(t0, t1);
    const m = midpt(t0, t1);

    // İki parmak pan: parmak hareketini scroll'a dönüştür
    wrap.scrollLeft -= (m.x - g.lastMid.x);
    wrap.scrollTop  -= (m.y - g.lastMid.y);

    // Pinch scale (başlangıç mesafesine göre)
    g.scale = d / g.startDist;
    applyVisualScale(g.scale, g.startMid.x, g.startMid.y);

    g.lastMid = m;
    g.lastDist = d;
  }, { passive: false, capture: true });

  const commitGesture = e => {
    if (!g) return;
    if (e.touches.length >= 2) return; // hâlâ 2 parmak

    const newZoom = Math.max(40, Math.min(200, Math.round(g.startZoom * g.scale)));
    const wrapRect = wrap.getBoundingClientRect();
    clearVisualScale();

    if (Math.abs(newZoom - g.startZoom) >= 2) {
      const contentX = g.startMid.x - wrapRect.left + wrap.scrollLeft;
      const contentY = g.startMid.y - wrapRect.top  + wrap.scrollTop;
      appState.zoom = newZoom;
      document.getElementById('zoomLabel').textContent = `%${newZoom}`;
      scheduleCardZoomRender({
        contentX,
        contentY,
        viewportX: g.startMid.x - wrapRect.left,
        viewportY: g.startMid.y - wrapRect.top,
        ratio: newZoom / (appState._renderedZoom || g.startZoom),
      });
    }
    g = null;
    appState._touchGestureActive = false;
  };

  wrap.addEventListener('touchend',    commitGesture, { passive: false, capture: true });
  wrap.addEventListener('touchcancel', commitGesture, { passive: false, capture: true });
}

// ══════════════════════════════════════════════════════════
// TELEFON: tek parmak PAN/scroll · uzun basıp ÇİZ · 2 parmak zoom
// Apple Pencil (touchType='stylus') doğrudan çizer. Serbest çizim
// araçlarında (kalem/tükenmez/fosforlu) Fabric'in tek-parmak çizimini
// devralır: hareket → pan, 250ms basılı tut → fırçayı manuel sür (çiz).
// ══════════════════════════════════════════════════════════
function initLongPressDraw(){
  const wrap = document.getElementById('readerCanvasWrap');
  if(!wrap || wrap.dataset.lpDrawReady) return;
  wrap.dataset.lpDrawReady = '1';

  const FREE_DRAW = new Set(['pen','tukenmez','marker']);
  const MOVE_THRESHOLD = 10;  // px — bu kadar kayma = jest başladı
  const DRAW_HOLD = 250;      // ilk hareket bu süreden önce/sonra → çiz/pan ayrımı
  const MENU_HOLD = 1000;     // 1sn sabit basış → Görünüm Modu menüsü
  const SWIPE_MIN = 90;       // tam ekranda soru geçişi için min kaydırma
  let s = null; // gesture state

  function findFabricAt(x, y){
    const els = document.elementsFromPoint(x, y) || [];
    const all = Object.values(appState.fabricCanvases || {});
    if(appState.fabricCanvas) all.push(appState.fabricCanvas);
    for(const el of els){
      for(const fc of all){
        if(fc && (fc.upperCanvasEl === el || fc.wrapperEl?.contains(el))) return fc;
      }
    }
    return appState.fabricCanvas || null;
  }
  // Fabric brush'u manuel sürerken gerçek/null event geçmek _isMainEvent & getPointer'ı
  // patlatıyor (boş touches). Sahte mouse event + rect tabanlı koordinat kullan.
  const FAKE_E = { button: 0 };
  function pointerFor(fc, clientX, clientY){
    const rect = fc.upperCanvasEl.getBoundingClientRect();
    const sx = rect.width  ? fc.width  / rect.width  : 1;
    const sy = rect.height ? fc.height / rect.height : 1;
    return new fabric.Point((clientX - rect.left) * sx, (clientY - rect.top) * sy);
  }
  function startDraw(){
    s.mode = 'draw';
    s.fc = findFabricAt(s.x0, s.y0);
    if(s.fc?.freeDrawingBrush){
      try{ s.fc.freeDrawingBrush.onMouseDown(pointerFor(s.fc, s.x0, s.y0), { e:FAKE_E }); }catch(_e){}
      navigator.vibrate?.(10);
    }
  }
  function endStroke(){
    if(s && s.mode === 'draw' && s.fc?.freeDrawingBrush){
      try{ s.fc.freeDrawingBrush.onMouseUp({ e: FAKE_E }); }catch(_e){}
    }
  }
  const isSolve = ()=> document.getElementById('reader-overlay')?.classList.contains('solve-mode');

  wrap.addEventListener('touchstart', e => {
    if(e.touches.length !== 1){ if(s){ clearTimeout(s.menuTimer); endStroke(); s = null; } return; }
    const t = e.touches[0];
    if(t.touchType === 'stylus') return;          // Apple Pencil → Fabric doğrudan çizsin
    if(!FREE_DRAW.has(appState.drawTool)) return;  // diğer araçlar mevcut davranış
    e.preventDefault(); e.stopPropagation();        // Fabric bu dokunuşu almasın
    appState._touchGestureActive = true;
    s = { x0:t.clientX, y0:t.clientY, lastX:t.clientX, lastY:t.clientY,
          sl:wrap.scrollLeft, st:wrap.scrollTop, t0:Date.now(),
          mode:'pending', fc:null, inv:isSolve(), menuTimer:null };
    // 1sn sabit basış → Görünüm Modu menüsü (çift-tık yerine — yazarken kazara açılmasın)
    s.menuTimer = setTimeout(()=>{
      if(!s || s.mode !== 'pending') return;
      s.mode = 'menu';
      window.showContextMenu?.(s.x0, s.y0);
      navigator.vibrate?.(15);
    }, MENU_HOLD);
  }, { passive:false, capture:true });

  wrap.addEventListener('touchmove', e => {
    if(!s || e.touches.length !== 1) return;
    e.preventDefault(); e.stopPropagation();        // gesture boyunca Fabric'i bloke et
    const t = e.touches[0];
    s.lastX = t.clientX; s.lastY = t.clientY;
    if(s.mode === 'pending' && Math.hypot(t.clientX - s.x0, t.clientY - s.y0) > MOVE_THRESHOLD){
      clearTimeout(s.menuTimer);
      const fast = (Date.now() - s.t0) < DRAW_HOLD;
      // normal: hızlı=pan, bekleyip-hareket=çiz · tam ekran(inv): hızlı=çiz, bekleyip-hareket=pan
      if(s.inv ? fast : !fast) startDraw(); else s.mode = 'pan';
    }
    if(s.mode === 'pan'){
      wrap.scrollLeft = s.sl - (t.clientX - s.x0);
      wrap.scrollTop  = s.st - (t.clientY - s.y0);
    } else if(s.mode === 'draw' && s.fc?.freeDrawingBrush){
      try{ s.fc.freeDrawingBrush.onMouseMove(pointerFor(s.fc, t.clientX, t.clientY), { e:FAKE_E }); }catch(_e){}
    }
  }, { passive:false, capture:true });

  const onEnd = ()=>{
    if(!s) return;
    clearTimeout(s.menuTimer);
    // Tam ekranda pan ile sağa/yukarı kaydır → sonraki soru (sol/aşağı → önceki)
    if(s.inv && s.mode === 'pan'){
      const dx = s.lastX - s.x0, dy = s.lastY - s.y0;
      if(Math.max(Math.abs(dx), Math.abs(dy)) > SWIPE_MIN){
        if(Math.abs(dx) >= Math.abs(dy)) (dx > 0 ? window.nextQuestion : window.prevQuestion)?.();
        else                              (dy < 0 ? window.nextQuestion : window.prevQuestion)?.();
      }
    }
    endStroke();
    s = null; appState._touchGestureActive = false;
  };
  wrap.addEventListener('touchend',    onEnd, { passive:false, capture:true });
  wrap.addEventListener('touchcancel', onEnd, { passive:false, capture:true });
}


// ── Bu modülün fonksiyonlarını window'a kaydet ──
// main.js ve diğer modüller window.xxx ile çağırabilsin
window.loadPDFFile = loadPDFFile;
window.loadPDFUrl = loadPDFUrl;
window.loadPDFDocument = loadPDFDocument;
window.renderAllPages = renderAllPages;
window.throttleScrollHandler = throttleScrollHandler;
window.updateCurrentPageFromScroll = updateCurrentPageFromScroll;
window.renderSinglePDFPage = renderSinglePDFPage;
window.renderSingleFallbackPage = renderSingleFallbackPage;
window.isNarrowReader = isNarrowReader;
window.getReaderFitScale = getReaderFitScale;
window.sizeReaderStage = sizeReaderStage;
window.renderPages = renderPages;
window.renderSinglePageMode = renderSinglePageMode;
window.renderPDFPage = renderPDFPage;
window.renderFallbackPage = renderFallbackPage;
window.setViewMode = setViewMode;
window.openViewModeMenu = openViewModeMenu;
window.showContextMenu = showContextMenu;
window.initPDFContextMenu = initPDFContextMenu;
window.initTouchGestures = initTouchGestures;
window.initLongPressDraw = initLongPressDraw;
window.buildMockPageContent = buildMockPageContent;
window.changePage = changePage;
window.goToPage = goToPage;
window.scrollToPage = scrollToPage;
window.updatePageIndicator = updatePageIndicator;
window.promptPageJump = promptPageJump;
window.changeZoom = changeZoom;
window.scheduleCardZoomRender = scheduleCardZoomRender;
window.initCardZoomPan = initCardZoomPan;
