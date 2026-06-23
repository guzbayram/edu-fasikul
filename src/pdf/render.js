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
  }
}

/**
 * Tek bir PDF sayfasını render eder (lazy)
 */

async function renderSinglePDFPage(pageNum, pageWrap){
  if(!appState.pdfDoc) return;
  try{
    const page = await appState.pdfDoc.getPage(pageNum);
    const dpr = window.devicePixelRatio || 1;
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
    pageWrap.insertBefore(pdfCanvas, pageWrap.firstChild);

    await page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport }).promise;

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
  const viewportW = Math.max(280, (container?.clientWidth || window.innerWidth) - padX - 2);
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

  const dpr = window.devicePixelRatio || 1;
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
      const baseScale = getReaderFitScale(page, wrap);
      const renderScale = baseScale * dpr;
      const viewport = page.getViewport({scale: renderScale});
      const displayW = viewport.width / dpr;
      const displayH = viewport.height / dpr;
      pageWrap.style.width = displayW + 'px';
      pageWrap.style.height = displayH + 'px';
      pageWrap.style.background = '#fff';
      sizeReaderStage(stage, wrap, displayW, displayH);

      const pdfCanvas = document.createElement('canvas');
      pdfCanvas.width = viewport.width;
      pdfCanvas.height = viewport.height;
      pdfCanvas.style.cssText = 'display:block;position:absolute;top:0;left:0;width:100%;height:100%;';
      pageWrap.appendChild(pdfCanvas);
      await page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport }).promise;

      const drawEl = document.createElement('canvas');
      drawEl.className = 'fabric-draw-canvas';
      drawEl.width = displayW; drawEl.height = displayH;
      drawEl.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
      pageWrap.appendChild(drawEl);
      stage.appendChild(pageWrap);
      wrap.appendChild(stage);
      initFabricForPage(drawEl, displayW, displayH, pageNum);
    } catch(err){
      console.error('Sayfa render hatası:', err);
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
    `;
    document.body.appendChild(menu);

    // Dışarı tıklayınca kapat
    document.addEventListener('click', e=>{
      if(!menu.contains(e.target)) menu.style.display = 'none';
    });
  }

  // Sağ tık
  wrap.addEventListener('contextmenu', e=>{
    e.preventDefault();
    // Aktif modu işaretle
    document.getElementById('ctxSingle')?.classList.toggle('ctx-active', appState.viewMode === 'single');
    document.getElementById('ctxScroll')?.classList.toggle('ctx-active', appState.viewMode === 'scroll');
    // Pozisyon
    const x = Math.min(e.clientX, window.innerWidth - 220);
    const y = Math.min(e.clientY, window.innerHeight - 180);
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.style.display = 'block';
  });
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
window.initPDFContextMenu = initPDFContextMenu;
window.buildMockPageContent = buildMockPageContent;
window.changePage = changePage;
window.goToPage = goToPage;
window.scrollToPage = scrollToPage;
window.updatePageIndicator = updatePageIndicator;
window.promptPageJump = promptPageJump;
window.changeZoom = changeZoom;
window.scheduleCardZoomRender = scheduleCardZoomRender;
window.initCardZoomPan = initCardZoomPan;
