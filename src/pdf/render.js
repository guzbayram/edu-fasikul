import { appState } from '../state/appState.js';

// Gerçek kanvas piksel arabelleğinin (width/height, GÖRSEL/CSS boyut değil)
// güvenli tavanı. Zoom%×DPR sınırsız büyürse (ör. %400 zoom + DPR2, iPad'de
// ölçülüp doğrulandı: TEK bir sayfa kanvası 6336×8960≈217MB'a çıkıyor;
// sürekli modda birden çok sayfa + her sayfanın 3 kanvası — PDF render +
// Fabric alt/üst — aynı anda böyle kalınca toplam 1GB'ı aşabiliyor) gerçek
// cihazda WebKit bellek baskısı altında sekmeyi KAPATIYOR ("çok büyük zoom
// hareketi yapınca kapanıyor" olarak bildirildi). PDF vektör olduğundan
// yüksek zoom'da netlik için piksel yoğunluğu gerekir AMA bir tavanı olmalı:
// bu sınırı aşan kısım tarayıcının kendi CSS upscale'ine (görsel boyut AYNI
// kalır — pageWrap/displayW/H hiç değişmez — hafif bulanıklaşabilir ama
// ÇÖKME riski olmaz) bırakılır.
const MAX_CANVAS_DIM = 4096;
const SCROLL_RENDER_RETAIN_PAGES = (navigator.maxTouchPoints || 0) > 0 ? 2 : 3;

async function loadPDFFile(file, targetPage=1){
  const arrayBuffer = await file.arrayBuffer();
  return await loadPDFDocument({data: arrayBuffer}, targetPage);
}

async function loadPDFUrl(url, targetPage=1){
  if(typeof url === 'string' && url.startsWith('blob:')){
    try{
      const response = await fetch(url);
      const blob = await response.blob();
      return await loadPDFFile(blob, targetPage);
    }catch(e){
      console.warn('Blob PDF doğrudan okunamadı:', e);
    }
  }
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
appState.viewMode = 'scroll'; // 'single' | 'scroll'

/**
 * Tüm sayfalar için placeholder div'ler oluşturur,
 * IntersectionObserver ile görünür sayfaları render eder.
 */

// Rotasyon/resize sırasında birbirini üst üste tetikleyen birden fazla
// dinleyici (main.js resize, solve.js orientationchange, viewportfix.js
// resize+visualViewport polling) renderAllPages()'i art arda çağırabilir.
// Korumasız bırakılırsa her çağrı kendi 634 sayfalık placeholder setini
// wrap'e EKLER (öncekini temizlemeden — temizleme yalnız fonksiyon
// BAŞINDA, kendi await'inden ÖNCE olur), bu da yinelenen id'ler ve
// çakışan IntersectionObserver'lar üretip scrollToPage'in yanlış/eski
// bir sayfa-wrap'ine gitmesine (ör. başa dönme) yol açar. renderSinglePageMode
// zaten aynı sınıf hatayı _pageRenderGen ile çözüyor — aynı deseni burada
// da uyguluyoruz: yalnızca EN SON çağrı kendi placeholder'larını kurar.
let _allPagesRenderGen = 0;
async function renderAllPages(){
  const myGen = ++_allPagesRenderGen;
  window.flushActiveTextEditing?.();
  const wrap = document.getElementById('readerCanvasWrap');
  wrap.innerHTML = '';

  // Eski Fabric instance'ları temizle
  Object.values(appState.fabricCanvases).forEach(fc=>{ try{fc.dispose();}catch(e){} });
  appState.fabricCanvases = {};
  appState.fabricCanvas = null;

  // Eski observer'ı kapat
  if(appState._pageObserver){ appState._pageObserver.disconnect(); appState._pageObserver = null; }

  const totalPages = appState.totalPages;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const baseScale = appState.zoom / 100;
  let placeholderW = Math.round(baseScale * 700);
  let placeholderH = Math.round(baseScale * 990);

  if(appState.pdfDoc){
    try{
      const firstPage = await appState.pdfDoc.getPage(1);
      const firstScale = getReaderFitScale(firstPage, wrap);
      const firstViewport = firstPage.getViewport({ scale: firstScale * dpr });
      placeholderW = firstViewport.width / dpr;
      placeholderH = firstViewport.height / dpr;
    }catch(e){
      console.warn('PDF placeholder boyutu hesaplanamadı, varsayılan kullanılıyor:', e);
    }
  }
  // Bekleme sırasında daha yeni bir renderAllPages() çağrısı başladıysa
  // (ör. rotasyon sırasında art arda tetiklenen resize/orientationchange),
  // bu bayat çağrı kendi placeholder setini EKLEMEDEN sessizce çıkar —
  // aksi halde iki set yinelenen id'li sayfa-wrap oluşur.
  if(myGen !== _allPagesRenderGen) return false;

  // KALICI tek içerik sarmalayıcısı — zoom/pan motoru (yukarıda,
  // beginZoomGesture) jest boyunca SADECE bunun transform'unu değiştirir;
  // artık jest başında kurulup bitince sökülen geçici bir eleman yok.
  const inner = document.createElement('div');
  inner.className = 'reader-pages-inner';
  inner.style.cssText = 'display:flex;flex-direction:column;align-items:flex-start;gap:20px;width:100%;';
  wrap.appendChild(inner);

  // Her sayfa için önce placeholder oluştur (boyut sonra doldurulacak)
  for(let i = 1; i <= totalPages; i++){
    const pageWrap = document.createElement('div');
    pageWrap.className = 'pdf-page-wrap';
    pageWrap.id = 'page-wrap-' + i;
    pageWrap.dataset.pageNum = i;
    pageWrap.style.cssText = 'position:relative;display:flex;align-items:center;justify-content:center;margin:12px auto;flex-shrink:0;';

    // Placeholder boyutu gerçek PDF sayfasıyla aynı olmalı. Aksi halde lazy
    // render edilen sayfalar yükseklik değiştirip zoom/pan sonrası scroll
    // konumunu başka sayfaya kaydırır.
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

    inner.appendChild(pageWrap);
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
  return true;
}

function throttleScrollHandler(){
  if(appState._scrollThrottle) return;
  appState._scrollThrottle = setTimeout(()=>{
    appState._scrollThrottle = null;
    if(appState._scrollingToPage || Date.now() < (appState._zoomSettlingUntil || 0)) return;
    if((appState.watchMode || appState._followingCanliMember) && !appState._liveSuppress && !appState._presSuppress){
      appState._liveManualPauseUntil = Date.now() + 8000;
    }
    // KRİTİK: İzle uygularken (_presSuppress/_liveSuppress) applyPageScrollFraction
    // wrap.scrollTop/Left'i DOĞRUDAN değiştiriyor — scrollToPage'in aksine
    // appState._scrollingToPage bayrağını KULLANMIYOR. Bu programatik scroll
    // native bir 'scroll' olayı doğurur; updateCurrentPageFromScroll bunu
    // "en yakın sayfa merkezi" ile BAĞIMSIZ yeniden hesaplayıp, takip edilenden
    // az önce goToPage ile açıkça set edilmiş sayfa numarasını (ör. hedef sayfa
    // sınırında, viewport merkezi hâlâ bir önceki sayfaya daha yakınsa) YANLIŞLIKLA
    // geri eski sayfaya döndürebiliyordu (izlerken admin rozeti 1 sayfa geride
    // kalıyordu). İzle/watchMode kaynaklı bu scroll'da kendi sayfa tespitimizi
    // atlayıp takip edilenin sayfasına güveniyoruz.
    if(appState._presSuppress || appState._liveSuppress) return;
    updateCurrentPageFromScroll();
    // Sayfa DEĞİŞMESE bile (aynı sayfa içinde pan) canlı izleyenler için
    // yayınla — publishCanli() zaten kendi debounce/dedup'ına sahip (bkz.
    // realtime.js _publishTimer + sig karşılaştırması), burada koşulsuz
    // çağırmak Firestore'u spamlamaz.
    window.publishCanli?.();
    window.publishCanliPresence?.();
    scheduleRenderedPageCleanup();
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

function scheduleRenderedPageCleanup(){
  clearTimeout(appState._renderedPageCleanupTimer);
  appState._renderedPageCleanupTimer = setTimeout(cleanupFarRenderedPages, 350);
}

function shouldKeepRenderedPage(pageNum, pageWrap = null){
  if(pageWrap){
    const wrap = document.getElementById('readerCanvasWrap');
    if(wrap){
      const root = wrap.getBoundingClientRect();
      const rect = pageWrap.getBoundingClientRect();
      const margin = Math.max(root.height * 1.2, 900);
      if(rect.bottom >= root.top - margin && rect.top <= root.bottom + margin) return true;
    }
  }
  const current = Number(appState.currentPage || 1);
  return Math.abs(Number(pageNum) - current) <= SCROLL_RENDER_RETAIN_PAGES;
}

function cleanupFarRenderedPages(){
  if(appState.viewMode !== 'scroll') return;
  document.querySelectorAll('#readerCanvasWrap [data-page-num][data-rendered="1"]').forEach(pageWrap=>{
    const pageNum = Number(pageWrap.dataset.pageNum);
    if(!Number.isFinite(pageNum) || shouldKeepRenderedPage(pageNum, pageWrap)) return;
    unloadRenderedPage(pageWrap, pageNum);
  });
}

function unloadRenderedPage(pageWrap, pageNum){
  try{ window.saveDrawingForPage?.(pageNum); }catch(_e){}
  const fc = appState.fabricCanvases?.[pageNum];
  if(fc){
    try{ fc.dispose(); }catch(_e){}
    delete appState.fabricCanvases[pageNum];
    if(appState.fabricCanvas === fc) appState.fabricCanvas = null;
  }
  pageWrap.querySelectorAll('canvas,.canvas-container,.pdf-page-mock').forEach(el=>{
    try{ el.remove(); }catch(_e){}
  });
  pageWrap.dataset.rendered = '';
  delete pageWrap.dataset.rendered;
  pageWrap.style.background = 'var(--bg-2)';
}

/**
 * Tek bir PDF sayfasını render eder (lazy)
 */

// Cevap anahtarı maskeleme: bu fasiküllerin PDF'lerinde testlerin son sayfasının
// altında yatay bir cevap anahtarı şeridi var. Öğrenci görmesin diye o şeridi
// turuncu opak kutuyla kaplıyoruz. (Sadece aşağıdaki fasikül id'leri için.)
const CEVAP_MASK_RENK = '#f97316';
const BLUE_UNDERLINE_HIDE_CONFIG = {
  'aktif-2026-tyt-mat-mrf-prime-sb': {
    eslesenParcalar: [
      'aktif-2026-tyt-mat-mrf-prime-sb',
      '8-6-aktif-2026-tyt-mat-mrf-prime-sb',
      '8-6 aktif 2026 tyt mat mrf prime sb',
      'aktif 2026 tyt matematik maarif prime soru bankasi',
      'aktif 2026 tyt matematik maarif prime soru bankası',
    ],
    sayfaAraligi: [[6, 320]],
  },
};
// Fasikül id → { rect: oransal dikdörtgen, herSayfa: her sayfada mı yoksa yalnız
// testin son sayfasında mı }. rect değerleri sayfa genişlik/yüksekliğine oranlı.
const CEVAP_MASK_CONFIG = {
  'aktif-matematik-acik-uclu': {
    rect: { x: 0.49, y: 0.895, w: 0.495, h: 0.09 },
    herSayfa: true,
  },
  'mof-9-matematik-1': { rect: { x: 0.038, y: 0.902, w: 0.924, h: 0.044 }, herSayfa: false },
  'mof-9-matematik-2': { rect: { x: 0.038, y: 0.902, w: 0.924, h: 0.044 }, herSayfa: false },
  'mof-9-matematik-3': { rect: { x: 0.038, y: 0.902, w: 0.924, h: 0.044 }, herSayfa: false },
  'mof-9-matematik-4': { rect: { x: 0.038, y: 0.902, w: 0.924, h: 0.044 }, herSayfa: false },
  // Möf 10.Sınıf Matematik: Möf-9 ile aynı yayıncı/şablon — testin son sayfasında
  // tam genişlikte "1-C 2-B 3-A..." metin şeridi (daire yok, düz metin).
  // 2-5. Fasiküllerde de aynı format örnek sayfa ile görsel doğrulandı.
  'mof-10-matematik-1': { rect: { x: 0.038, y: 0.902, w: 0.924, h: 0.044 }, herSayfa: false },
  'mof-10-matematik-2': { rect: { x: 0.038, y: 0.902, w: 0.924, h: 0.044 }, herSayfa: false },
  'mof-10-matematik-3': { rect: { x: 0.038, y: 0.902, w: 0.924, h: 0.044 }, herSayfa: false },
  'mof-10-matematik-4': { rect: { x: 0.038, y: 0.902, w: 0.924, h: 0.044 }, herSayfa: false },
  'mof-10-matematik-5': { rect: { x: 0.038, y: 0.902, w: 0.924, h: 0.044 }, herSayfa: false },
  // Yarıçap TYT Problemler: cevap daireleri birçok sayfanın sağ-altında; her sayfada kapat.
  'yaricap-tyt-problemler': {
    rects: [
      { x: 0.54, y: 0.897, w: 0.42, h: 0.037 },
    ],
    yalnizCevapSayfasi: true,
    cevapSayfalari: [45, 47],
  },
  'yaricap-10-matematik-2': {
    sayfaRectleri: {
      16: [{ x: 0.515, y: 0.924, w: 0.43, h: 0.048 }],
      18: [{ x: 0.515, y: 0.924, w: 0.43, h: 0.048 }],
      20: [{ x: 0.515, y: 0.924, w: 0.43, h: 0.048 }],
      22: [{ x: 0.515, y: 0.924, w: 0.43, h: 0.048 }],
      30: [{ x: 0.515, y: 0.924, w: 0.43, h: 0.048 }],
      32: [{ x: 0.515, y: 0.924, w: 0.43, h: 0.048 }],
      45: [{ x: 0.045, y: 0.922, w: 0.43, h: 0.05 }],
      49: [{ x: 0.045, y: 0.922, w: 0.43, h: 0.05 }],
      60: [{ x: 0.515, y: 0.924, w: 0.43, h: 0.048 }],
      64: [{ x: 0.515, y: 0.924, w: 0.43, h: 0.048 }],
      74: [{ x: 0.515, y: 0.924, w: 0.43, h: 0.048 }],
      76: [{ x: 0.515, y: 0.924, w: 0.43, h: 0.048 }],
      78: [{ x: 0.515, y: 0.924, w: 0.43, h: 0.048 }],
    },
  },
  // Yarıçap 10.Sınıf Matematik 1/3/4: 10-2'deki gibi cevap dairesi konumu test
  // türüne göre değil, sayfa numarasının tek/çift olmasına göre değişiyor
  // (tek sayfa → sol şerit, çift sayfa → sağ şerit) — her üç kitapta da örnek
  // sayfalar (tek+çift) görsel olarak doğrulandı, rect'ler 10-2 ile aynı.
  'yaricap-10-matematik-1': {
    giftTekRect: {
      tek: [{ x: 0.045, y: 0.922, w: 0.43, h: 0.05 }],
      cift: [{ x: 0.515, y: 0.924, w: 0.43, h: 0.048 }],
    },
  },
  'yaricap-10-matematik-3': {
    giftTekRect: {
      tek: [{ x: 0.045, y: 0.922, w: 0.43, h: 0.05 }],
      cift: [{ x: 0.515, y: 0.924, w: 0.43, h: 0.048 }],
    },
  },
  'yaricap-10-matematik-4': {
    giftTekRect: {
      tek: [{ x: 0.045, y: 0.922, w: 0.43, h: 0.05 }],
      cift: [{ x: 0.515, y: 0.924, w: 0.43, h: 0.048 }],
    },
  },
  // Yarıçap 10.Sınıf Matematik Soru Bankası: cevap anahtarı bazı bloklarda
  // sayfanın sağ-altında gri kutu, bazı bloklarda ise tüm alt şeritte tek satır
  // olarak çıkıyor. Sayfa listesi JSON'daki cevapAnahtariSayfalari alanından
  // okunur; böylece JSON düzeltildikçe maske sayfaları da aynı kalır.
  'yaricap-10-matematik-soru-bankasi': {
    rects: [
      { x: 0.045, y: 0.912, w: 0.91, h: 0.045 },
      { x: 0.50, y: 0.815, w: 0.455, h: 0.10 },
    ],
    cevapSayfalariFromJson: true,
    sadeceCevapSayfalari: true,
  },
  // Aktif TYT Matematik 1/2: her soru sayfasının altında (sol/sağ sütun veya
  // ikisi birden) "Soru N/ X" şeklinde ince bir cevap şeridi var — MÖF'ten
  // farklı olarak yalnız test biten sayfada değil, sorusu olan HER sayfada.
  // Sayfa aralığı JSON'daki sorular[].pdfSayfa'dan çıkarıldı (PDF ölçümüyle
  // doğrulandı: y 0.936-0.997, x 0.024-0.975, sayfa boyutu 985.68x1316.16pt).
  'aktif-tyt-matematik-1': {
    rect: { x: 0.024, y: 0.935, w: 0.955, h: 0.063 },
    sayfaAraligi: [[5, 256]],
  },
  'aktif-tyt-matematik-2': {
    rect: { x: 0.024, y: 0.935, w: 0.955, h: 0.063 },
    sayfaAraligi: [[5, 128]],
    haric: [52],
  },
  // Aktif TYT Matematik 3: Fasikül 1/2 ile aynı yayıncı/şablon — her sayfanın
  // altında kendi "Soru N/ X" şeridi var. Kitabın tamamı (1-9. Ünite +
  // ÖSYM Çıkmış Sorular, s.5-192) işlendi.
  'aktif-tyt-matematik-3': {
    rect: { x: 0.024, y: 0.935, w: 0.955, h: 0.063 },
    sayfaAraligi: [[5, 192]],
  },
  // Aktif TYT Matematik 4: aynı yayıncı/şablon (Kümeler ve Olasılık, s.5-144).
  'aktif-tyt-matematik-4': {
    rect: { x: 0.024, y: 0.935, w: 0.955, h: 0.063 },
    sayfaAraligi: [[5, 144]],
  },
  // Aktif TYT Matematik 5: aynı yayıncı/şablon (Fonksiyonlar, Polinomlar,
  // ÖSYM Soruları — s.5-112). Rect, Fasikül 3'ten aynen doğrulanarak alındı.
  'aktif-tyt-matematik-5': {
    rect: { x: 0.024, y: 0.935, w: 0.955, h: 0.063 },
    sayfaAraligi: [[5, 112]],
  },
  // Aktif 2026 TYT Matematik Maarif Prime Soru Bankası: her test bölümünün son
  // sayfasında sağ-alt köşede gri kutulu toplu cevap anahtarı var. Sayfa numarası
  // ortada kaldığı için maske yalnız sağ alt şeridi kapatır.
  'aktif-2026-tyt-mat-mrf-prime-sb': {
    rect: { x: 0.50, y: 0.922, w: 0.44, h: 0.055 },
    sayfaAraligi: [[6, 320]],
  },
  // Aktif TYT Geometri Konu Anlatımlı: aynı yayıncı/şablon (17 konu, s.7-384).
  'aktif-tyt-geometri-konu-anlatimli': {
    rect: { x: 0.024, y: 0.935, w: 0.955, h: 0.063 },
    sayfaAraligi: [[7, 384]],
  },
  // Aktif 10'lu Matematik Deneme: soru sayfalarında değil, her denemenin
  // 16 sayfalık bloğunun 15. sayfasında ("... KONU/KAZANIM" tablosu, iki
  // sütun x 20 satır mavi cevap hücresi) toplu cevap anahtarı var. Piksel
  // ölçümüyle doğrulandı (2054x2742 render): sol sütun x 910-971, sağ sütun
  // x 1851-1911, ikisi de y 460-2465.
  'aktif-10lu-matematik-deneme': {
    rects: [
      { x: 0.4382, y: 0.1641, w: 0.0394, h: 0.7385 },
      { x: 0.8964, y: 0.1641, w: 0.0390, h: 0.7385 },
    ],
    cevapSayfalari: [15, 31, 47, 63, 79, 95, 111, 127, 143, 159],
  },
  // Kuvvetlendiren Matematik TYT Soru Bankası 2025: MÖF-9 gibi, cevap anahtarı
  // yalnız testin SON sayfasında (sayfa altında sayfa no'nun yanında, dar bir
  // "1 2 3...N / B B C..." şeridi) — sayfa içindeki sorulara ait A-E şıkları
  // yukarıda, bu şeride dokunmuyor. konu.tur==='test' + sayfaBitis fallback'i
  // (aşağıdaki testBiter kontrolü) zaten bu yapıyı destekliyor, sadece rect
  // eklemek yeterli. Sayfa 36 (Basamak Kavramı Test 1, 24 soru — en geniş
  // durum) piksel ölçümüyle doğrulandı; daha az sorulu testlerde şerit daha
  // dar ama aynı x'te başladığından bu dikdörtgen hepsini kapsar.
  'kuvvetlendiren-tyt-soru-bankasi-2025': {
    rect: { x: 0.31, y: 0.924, w: 0.46, h: 0.036 },
  },
  // Matematik Atölyem 5-8: her kitabın sonunda "KAZANIM TADINDA SORULAR
  // CEVAP ANAHTARI" başlıklı, TEST-N satırları x 1-19 sütunlu, sayfanın
  // neredeyse tamamını kaplayan tam-sayfa cevap tablosu var (başlık/alt
  // bilgi şeridi hariç). Sayfa listesi kitabın kendi JSON'undaki
  // cevapAnahtariSayfalari alanıyla birebir aynı, piksel ölçümüyle
  // doğrulandı (4 kitapta da aynı şablon).
  'matematik-atolyem-5': {
    rect: { x: 0.045, y: 0.055, w: 0.93, h: 0.90 },
    cevapSayfalari: [302, 303, 304],
    sadeceCevapSayfalari: true,
  },
  'matematik-atolyem-6': {
    rect: { x: 0.045, y: 0.055, w: 0.93, h: 0.90 },
    cevapSayfalari: [303, 304],
    sadeceCevapSayfalari: true,
  },
  'matematik-atolyem-7': {
    rect: { x: 0.045, y: 0.055, w: 0.93, h: 0.90 },
    cevapSayfalari: [302, 303, 304],
    sadeceCevapSayfalari: true,
  },
  'matematik-atolyem-8': {
    rect: { x: 0.045, y: 0.055, w: 0.93, h: 0.90 },
    cevapSayfalari: [383, 384],
    sadeceCevapSayfalari: true,
  },
  // Arı Soru Bankası Matematik 8: kitabın sonunda ("CEVAP ANAHTARI" başlıklı,
  // TEST-N satırları x 1-16 sütunlu) 4 sayfalık tam-sayfa cevap tablosu var.
  // Sayfa listesi JSON'daki cevapAnahtariSayfalari alanıyla aynı, piksel
  // ölçümüyle doğrulandı (1240x1755 render, 4 sayfada da aynı şablon).
  'ari-soru-bankasi-mat-8': {
    rect: { x: 0.045, y: 0.07, w: 0.93, h: 0.87 },
    cevapSayfalari: [253, 254, 255, 256],
    sadeceCevapSayfalari: true,
  },
};

// pageNum için cevap anahtarı maskesi gerekiyorsa dikdörtgeni döndür.
function getCevapMaskRects(pageNum){
  const fas = appState.aktifFasikul;
  const cfg = fas && CEVAP_MASK_CONFIG[fas.id];
  if(!cfg || !Array.isArray(fas.konular)) return [];
  if(cfg.sayfaRectleri && Array.isArray(cfg.sayfaRectleri[pageNum])) return cfg.sayfaRectleri[pageNum];
  const rects = cfg.rects || (cfg.rect ? [cfg.rect] : []);
  if(cfg.herSayfa) return rects;
  const cevapSayfalari = cfg.cevapSayfalariFromJson
    ? (fas.cevapAnahtariSayfalari || [])
    : cfg.cevapSayfalari;
  if(Array.isArray(cevapSayfalari)){
    if(cevapSayfalari.includes(pageNum)) return rects;
    // sadeceCevapSayfalari: cevapSayfalari KESİN/TAM listedir — eşleşmezse
    // aşağıdaki genel "testBiter" varsayılanına asla düşülmez. Bu olmadan,
    // kitabın konu verisinde cevapSayfalari'nde HİÇ adı geçmeyen bir sayfada
    // biten başka bir test varsa (ör. Matematik Atölyem'de test-41 sayfa
    // 374'te bitiyor) o sayfa da yanlışlıkla maskeleniyordu. Eski
    // davranışa bağımlı kitaplar (ör. yaricap-tyt-problemler,
    // yalnizCevapSayfasi ile) bu bayrağı KULLANMADIĞI için etkilenmez.
    if(cfg.sadeceCevapSayfalari) return [];
  }
  if(Array.isArray(cfg.sayfaAraligi)){
    const araliktaMi = cfg.sayfaAraligi.some(([min,max]) => pageNum>=min && pageNum<=max);
    if(araliktaMi && !(cfg.haric||[]).includes(pageNum)) return rects;
  }
  if(cfg.yalnizCevapSayfasi){
    const bolumCevabiVar = fas.konular.some(k => (k.altKonular || []).some(ak =>
      String(ak.id || '').startsWith('bp-page-') &&
      (ak.sayfa || ak.sayfaBitis) === pageNum
    ));
    const testBuSayfadaBiter = fas.konular.some(k =>
      k.tur === 'test' && (k.sayfaBitis || k.sayfa) === pageNum
    );
    return bolumCevabiVar || testBuSayfadaBiter ? rects : [];
  }
  const testBiter = fas.konular.some(k => k.tur === 'test' && (k.sayfaBitis || k.sayfa) === pageNum);
  if(!testBiter) return [];
  // Yarıçap 10.Sınıf serisi: cevap dairelerinin sayfada sol mu sağ mı çıktığı
  // test türüne göre değil, sayfa numarasının tek/çift olmasına göre değişiyor
  // (tek sayfa → sol şerit, çift sayfa → sağ şerit) — 6+ sayfa görsel
  // doğrulamayla teyit edildi (bkz ilgili proje notu).
  if(cfg.giftTekRect){
    return pageNum % 2 === 0 ? cfg.giftTekRect.cift : cfg.giftTekRect.tek;
  }
  return rects;
}

function getBlueUnderlineHideConfig(pageNum){
  const fas = appState.aktifFasikul;
  if(!fas) return null;
  const normalize = (value) => String(value || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9]+/g, '');
  const fasAramaMetni = [
    fas.id,
    fas.ad,
    fas.pdf,
    fas.pdfDosya,
    fas.pdfFile,
    fas.json,
    fas.jsonDosya,
  ].filter(Boolean).join(' ').toLocaleLowerCase('tr-TR');
  const fasAramaAnahtari = normalize(fasAramaMetni);
  const cfg = Object.entries(BLUE_UNDERLINE_HIDE_CONFIG).find(([id, item]) => {
    if(fas.id === id) return true;
    return (item.eslesenParcalar || []).some(parca => {
      const parcaMetni = String(parca).toLocaleLowerCase('tr-TR');
      return fasAramaMetni.includes(parcaMetni) || fasAramaAnahtari.includes(normalize(parcaMetni));
    });
  })?.[1];
  if(!cfg) return null;
  if(Array.isArray(cfg.sayfaAraligi)){
    const araliktaMi = cfg.sayfaAraligi.some(([min,max]) => pageNum>=min && pageNum<=max);
    return araliktaMi ? cfg : null;
  }
  return cfg;
}

function hideBlueAnswerUnderlines(ctx, canvas, pageNum){
  if(!getBlueUnderlineHideConfig(pageNum)) return;
  const w = canvas.width;
  const h = canvas.height;
  if(!w || !h) return;
  const yStart = Math.floor(h * 0.08);
  const yEnd = Math.floor(h * 0.93);
  const minRun = Math.max(10, Math.floor(w * 0.006));
  const maxRun = Math.max(minRun + 1, Math.floor(w * 0.08));
  const masks = [];
  let data;
  try{
    data = ctx.getImageData(0, yStart, w, yEnd - yStart).data;
  }catch(e){
    return;
  }

  const isBlueLinePixel = (idx) => {
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    return r < 150 && g > 110 && b > 120 && g > r + 35 && b > r + 35 && Math.abs(g - b) < 90;
  };

  ctx.save();
  ctx.fillStyle = '#fff';
  for(let localY = 0; localY < yEnd - yStart; localY++){
    let runStart = -1;
    let runLen = 0;
    for(let x = 0; x <= w; x++){
      const idx = (localY * w + x) * 4;
      const hit = x < w && isBlueLinePixel(idx);
      if(hit){
        if(runStart < 0) runStart = x;
        runLen += 1;
        continue;
      }
      if(runStart >= 0){
        if(runLen >= minRun && runLen <= maxRun){
          const y = yStart + localY;
          masks.push({
            x: Math.max(0, runStart - 5),
            y: Math.max(0, y - 5),
            w: Math.min(w - runStart + 5, runLen + 10),
            h: 13,
          });
        }
        runStart = -1;
        runLen = 0;
      }
    }
  }
  for(const m of mergeNearbyUnderlineMasks(masks)){
    ctx.fillRect(m.x, m.y, m.w, m.h);
  }
  ctx.restore();
}

function mergeNearbyUnderlineMasks(masks){
  const merged = [];
  for(const m of masks.sort((a,b) => a.y - b.y || a.x - b.x)){
    const prev = merged[merged.length - 1];
    if(prev && Math.abs(prev.y - m.y) <= 8 && Math.abs(prev.x - m.x) <= 12){
      const x1 = Math.min(prev.x, m.x);
      const y1 = Math.min(prev.y, m.y);
      const x2 = Math.max(prev.x + prev.w, m.x + m.w);
      const y2 = Math.max(prev.y + prev.h, m.y + m.h);
      prev.x = x1;
      prev.y = y1;
      prev.w = x2 - x1;
      prev.h = y2 - y1;
    } else {
      merged.push({...m});
    }
  }
  return merged;
}

async function renderSinglePDFPage(pageNum, pageWrap){
  if(!appState.pdfDoc) return;
  try{
    if(!shouldKeepRenderedPage(pageNum, pageWrap)){
      delete pageWrap.dataset.rendered;
      return;
    }
    const page = await appState.pdfDoc.getPage(pageNum);
    if(!shouldKeepRenderedPage(pageNum, pageWrap)){
      delete pageWrap.dataset.rendered;
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const readerWrap = document.getElementById('readerCanvasWrap');
    const baseScale = getReaderFitScale(page, readerWrap, getStableRenderZoom(readerWrap));
    const renderScale = baseScale * dpr;
    const fullViewport = page.getViewport({scale: renderScale});
    const displayW = fullViewport.width / dpr;
    const displayH = fullViewport.height / dpr;

    pageWrap.style.width = displayW + 'px';
    pageWrap.style.height = displayH + 'px';
    pageWrap.style.background = '#fff';

    // bkz. MAX_CANVAS_DIM üstündeki not — GERÇEK arabellek bu tavanı aşmasın,
    // GÖRSEL boyut (pageWrap/displayW/H, yukarıda) hep zoom%'e tam orantılı kalır.
    const capRatio = Math.min(1, MAX_CANVAS_DIM / fullViewport.width, MAX_CANVAS_DIM / fullViewport.height);
    const viewport = capRatio < 1 ? page.getViewport({scale: renderScale * capRatio}) : fullViewport;

    // PDF render canvas
    const pdfCanvas = document.createElement('canvas');
    pdfCanvas.width = viewport.width;
    pdfCanvas.height = viewport.height;
    pdfCanvas.style.cssText = 'display:block;position:absolute;top:0;left:0;width:100%;height:100%;border-radius:4px;z-index:1;pointer-events:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;';
    pdfCanvas.style.background = 'transparent';
    pageWrap.insertBefore(pdfCanvas, pageWrap.firstChild);

    const ctx2d = pdfCanvas.getContext('2d');
    if(!ctx2d) throw new Error('Canvas 2D context alınamadı');
    await page.render({ canvasContext: ctx2d, viewport }).promise;
    hideBlueAnswerUnderlines(ctx2d, pdfCanvas, pageNum);

    // Cevap anahtarını gizle: turuncu opak maske (PDF katmanının üstüne, çizim
    // katmanının altına bastığımız için öğrenci silemez/taşıyamaz).
    const cevapMasks = getCevapMaskRects(pageNum);
    if(cevapMasks.length){
      ctx2d.save();
      ctx2d.fillStyle = CEVAP_MASK_RENK;
      for(const m of cevapMasks){
        ctx2d.fillRect(m.x * pdfCanvas.width, m.y * pdfCanvas.height, m.w * pdfCanvas.width, m.h * pdfCanvas.height);
      }
      ctx2d.restore();
    }

    // Fabric çizim canvas — arabelleği (canvas.width/height) PDF kanvasıyla
    // AYNI, zaten hesaplanmış viewport.width/height'a (dpr+tavan uygulanmış)
    // BİZ elle veriyoruz; initFabricForPage'e disableRetinaScaling:true
    // geçerek Fabric'in KENDİ retina ölçeklemesini (window.devicePixelRatio'ya
    // göre — BİZİM tavanlı dpr'imizden BAĞIMSIZ, ör. iPhone'da 3, bu yüzden
    // arabellek 4096 hedeflenirken 5906'ya çıkıyordu) kapatıyoruz. CSS/görsel
    // boyutu (her zaman, arabellek küçültülmüş olsun olmasın) displayW/H'a
    // elle sabitliyoruz ki PDF katmanıyla hizalı kalsın — patchGetPointer
    // zaten canlı canvas.width/boundsWidth oranına göre çalıştığından bu
    // arabellek/CSS uyumsuzluğunda da doğru koordinat üretir.
    const drawEl = document.createElement('canvas');
    drawEl.className = 'fabric-draw-canvas';
    drawEl.width = viewport.width;
    drawEl.height = viewport.height;
    drawEl.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;border-radius:4px;z-index:20;pointer-events:auto;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;';
    pageWrap.insertBefore(drawEl, pageWrap.querySelector('.page-num-label'));

    initFabricForPage(drawEl, viewport.width, viewport.height, pageNum, { disableRetinaScaling: true });
    const fc = appState.fabricCanvases[pageNum];
    [fc?.wrapperEl, fc?.lowerCanvasEl, fc?.upperCanvasEl].forEach(el=>{
      if(!el) return;
      el.style.width = displayW + 'px';
      el.style.height = displayH + 'px';
    });

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
  const renderZoom = getStableRenderZoom(document.getElementById('readerCanvasWrap'));
  const displayW = Math.round(renderZoom / 100 * 700);
  const displayH = Math.round(renderZoom / 100 * 990);
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
  drawEl.style.cssText = 'position:absolute;top:0;left:0;width:' + displayW + 'px;height:' + displayH + 'px;z-index:20;pointer-events:auto;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;';
  pageWrap.insertBefore(drawEl, pageWrap.querySelector('.page-num-label'));
  initFabricForPage(drawEl, displayW, displayH, pageNum);
}

/**
 * Belirli bir sayfa için Fabric canvas başlatır, aktif sayfaysa appState.fabricCanvas'a atar
 */

function isNarrowReader(){
  return window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
}

// Tablet mi telefon mu? Genişlik/yükseklik yön değiştiğinde yer değiştirdiğinden
// (yatay/dikey) tek bir eksene bakmak yanıltır — KISA kenar telefon/tablet
// arasında yönden bağımsız güvenilir bir ayraç: iPad'ler (mini dahil) yatay/
// dikey fark etmeksizin kısa kenarda ~744px+, telefonlar (Pro Max dahil)
// ~430px'i geçmez. Eşik 500px iki grup arasında güvenli bir orta nokta.
function isTabletDevice(){
  return Math.min(window.innerWidth, window.innerHeight) > 500;
}

function getStableRenderZoom(wrap){
  // Canlı pinch/trackpad zoom önizlemesi aktifken (bkz. isZoomGestureLive,
  // aşağıda) sayfalar CSS transform ile ölçekleniyor. Bu sırada lazy render
  // edilen yeni sayfalar da appState.zoom ile çizilirse ÇİFT ölçeklenir. Bu
  // yüzden aktif önizlemede gerçek render tabanı SABİT kalır; canlı zoom
  // yalnız transform olarak uygulanır.
  if(isZoomGestureLive()) return appState._renderedZoom || appState.zoom || 100;
  return appState.zoom || 100;
}

// Sayfayı viewport genişliğine (ya da tam-ekran/solve modunda kalan alana)
// sığdıran ölçeği hesaplar. BİLEREK saf DOĞRUSAL: appState.zoom%'e tam
// orantılı, alt-sınır/kırpma YOK. Bu, zoom/pan motorunun (yukarıda)
// jest-sonu scroll düzeltmesini basit bir oran çarpımına indirger — eski
// tasarımdaki 0.35 alt-sınırı (çok düşük zoom%'lerde metnin çok küçülmesini
// önlemek için) doğrusallığı bozup anchor hesaplarını karmaşıklaştırıyordu;
// düşük uçtaki okunabilirlik zaten ZOOM_MIN (25) ile sınırlanıyor.
function getReaderFitScale(page, wrap, zoomPct = appState.zoom){
  const zoomScale = zoomPct / 100;
  const container = wrap || document.getElementById('readerCanvasWrap');
  const styles = container ? getComputedStyle(container) : null;
  const padX = styles ? parseFloat(styles.paddingLeft || 0) + parseFloat(styles.paddingRight || 0) : 0;
  // clientWidth=0 olursa layout henüz hazır değil — window.innerWidth'e düş
  const rawW = container?.clientWidth || 0;
  const viewportW = Math.max(280, (rawW > 0 ? rawW : window.innerWidth) - padX - 2);
  const natural = page.getViewport({scale: 1});
  const base = viewportW / natural.width;
  // Tam ekran (solve) modu: kartı kalan alana COVER doldur → gri boşluk kalmaz,
  // sayfa her yönde ekranı doldurur (genişlik VE yüksekliğin BÜYÜK olanına göre).
  // Sayfanın oranı kutununkinden farklıysa bir kenarı ekran dışına taşabilir —
  // ortalanır (align/justify-content:center) ve pan/scroll ile ulaşılır.
  const ov = document.getElementById('reader-overlay');
  const solveMode = !!ov?.classList.contains('solve-mode');
  if(solveMode){
    const padY = styles ? parseFloat(styles.paddingTop || 0) + parseFloat(styles.paddingBottom || 0) : 0;
    const rawH = container?.clientHeight || 0;
    const viewportH = Math.max(280, (rawH > 0 ? rawH : window.innerHeight) - padY - 2);
    const baseH = viewportH / natural.height;
    return Math.max(base, baseH) * zoomScale;
  }
  // Normal: genişliğe sığdır (fill-width)
  return base * zoomScale;
}

function sizeReaderStage(stage, wrap, displayW, displayH){
  const styles = getComputedStyle(wrap);
  const padX = parseFloat(styles.paddingLeft || 0) + parseFloat(styles.paddingRight || 0);
  const padY = parseFloat(styles.paddingTop || 0) + parseFloat(styles.paddingBottom || 0);
  const viewportW = Math.max(0, wrap.clientWidth - padX);
  const viewportH = Math.max(0, wrap.clientHeight - padY);
  const panExtraX = displayW > viewportW ? viewportW : 0;
  const panExtraY = displayH > viewportH ? viewportH : 0;
  stage.style.width = Math.ceil(Math.max(viewportW, displayW + 32 + panExtraX)) + 'px';
  stage.style.height = Math.ceil(Math.max(viewportH, displayH + 32 + panExtraY)) + 'px';
}

// ── renderPages: mod'a göre tek sayfa veya scroll

function renderPages(){
  window.flushActiveTextEditing?.();
  // Başka bir kod yolu (ör. sayfa değişimi) aktif bir zoom jesti SIRASINDA
  // renderPages()'i doğrudan çağırırsa: eski jest durumunu bırak, renderPages
  // zaten wrap'i baştan kuracak.
  gz = null;
  const preserveScroll = !!appState._preserveScrollAfterRender;
  appState._preserveScrollAfterRender = false;
  if(appState.viewMode === 'scroll'){
    return renderAllPages().then((completed)=>{
      // completed===false: daha yeni bir renderAllPages() bu çağrıyı
      // geçersiz kıldı — DOM zaten o çağrı tarafından kurulacak/kuruldu,
      // burada devam edip (zoom/pan/scroll) bayat duruma göre ayarlama
      // yapmayalım (ör. rotasyon sırasında sayfanın başa dönmesi).
      if(completed === false) return;
      appState._renderedZoom = appState.zoom;
      initCardZoomPan();
      initTouchGestures();
      if(!preserveScroll) setTimeout(()=>scrollToPage(appState.currentPage, 'auto'), 50);
    });
  } else {
    return renderSinglePageMode(appState.currentPage).then(()=>{
      appState._renderedZoom = appState.zoom;
      initCardZoomPan();
      initTouchGestures();
    });
  }
}

// ── Tek sayfa modu

// Sayfa render'ı async (pdfDoc.getPage + page.render awaitli) — hızlı ardışık
// goToPage çağrılarında (ör. Konu Listesi'nden yeni bir teste tıklamak) daha
// ESKİ bir çağrı, daha YENİ bir çağrıdan SONRA bitebiliyor (ör. eski sayfa
// zaten önbellekte değilken yeni sayfa daha hızlı çözülüyorsa). Bu durumda
// eski render kendi <div id="page-wrap-N"> öğesini wrap'e ekleyip yeni
// render'ın üzerine yazıyor, kullanıcı seçtiği testten FARKLI bir sayfa
// görüyordu. Her çağrı kendi "nesil" numarasını taşır; süresi dolmuş
// (supersede edilmiş) bir çağrı DOM'a dokunmadan sessizce çıkar.
let _pageRenderGen = 0;

async function renderSinglePageMode(pageNum){
  const myGen = ++_pageRenderGen;
  window.flushActiveTextEditing?.();
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
  pageWrap.className = 'pdf-page-wrap';
  pageWrap.id = 'page-wrap-' + pageNum;
  pageWrap.dataset.pageNum = pageNum;
  pageWrap.style.cssText = 'position:relative;margin:16px auto;flex-shrink:0;border-radius:4px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.4);';

  if(appState.pdfDoc){
    try{
      const page = await appState.pdfDoc.getPage(pageNum);
      if(myGen !== _pageRenderGen) return; // daha yeni bir goToPage bu çağrıyı geçersiz kıldı
      // Force layout reflow before reading clientWidth (Safari timing fix)
      void wrap.getBoundingClientRect();
      const baseScale = getReaderFitScale(page, wrap);
      const renderScale = baseScale * dpr;
      const fullViewport = page.getViewport({scale: renderScale});
      const displayW = fullViewport.width / dpr;
      const displayH = fullViewport.height / dpr;

      pageWrap.style.width = displayW + 'px';
      pageWrap.style.height = displayH + 'px';
      pageWrap.style.background = '#fff';
      sizeReaderStage(stage, wrap, displayW, displayH);

      // DOM'a önce ekle — Safari off-DOM canvas render'ı sessizce başarısız olur
      stage.appendChild(pageWrap);
      wrap.appendChild(stage);

      // bkz. MAX_CANVAS_DIM üstündeki not — DPR tavanı (yukarıdaki dpr=min(...,2))
      // tek başına yetmiyor: %400 zoom + DPR2 ile bile tek kanvas 6336×8960
      // (~217MB) oluyor (gerçek iPad'de ölçülüp "çok büyük zoom hareketi
      // yapınca kapanıyor" olarak bildirildi). GÖRSEL boyut (displayW/H,
      // yukarıda) hep zoom%'e tam orantılı kalır, yalnız arabellek sınırlanır.
      const capRatio = Math.min(1, MAX_CANVAS_DIM / fullViewport.width, MAX_CANVAS_DIM / fullViewport.height);
      const viewport = capRatio < 1 ? page.getViewport({scale: renderScale * capRatio}) : fullViewport;

      const pdfCanvas = document.createElement('canvas');
      pdfCanvas.width = viewport.width;
      pdfCanvas.height = viewport.height;
      pdfCanvas.style.cssText = 'display:block;position:absolute;top:0;left:0;width:100%;height:100%;background:transparent;z-index:1;pointer-events:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;';
      pageWrap.appendChild(pdfCanvas);

      const ctx2d = pdfCanvas.getContext('2d');
      if(!ctx2d) throw new Error('Canvas 2D context alınamadı (bellek yetersiz olabilir)');
      await page.render({ canvasContext: ctx2d, viewport }).promise;
      if(myGen !== _pageRenderGen) return; // süresi dolmuş — kalan adımlar (maske/çizim katmanı) atlanır
      hideBlueAnswerUnderlines(ctx2d, pdfCanvas, pageNum);

      // Cevap anahtarını gizle (renderSinglePDFPage ile aynı maskeleme — bu fonksiyon
      // 'single' görünüm modunda (appState.viewMode varsayılanı) ayrı bir render yolu
      // olduğu için maskeleme burada da tekrarlanmalı, yoksa varsayılan modda hiç uygulanmaz).
      const cevapMasks = getCevapMaskRects(pageNum);
      if(cevapMasks.length){
        ctx2d.save();
        ctx2d.fillStyle = CEVAP_MASK_RENK;
        for(const m of cevapMasks){
          ctx2d.fillRect(m.x * pdfCanvas.width, m.y * pdfCanvas.height, m.w * pdfCanvas.width, m.h * pdfCanvas.height);
        }
        ctx2d.restore();
      }

      // bkz. renderSinglePDFPage'deki aynı yorum — arabelleği PDF kanvasıyla
      // AYNI viewport.width/height'a elle veriyoruz, Fabric'in KENDİ retina
      // ölçeklemesini (window.devicePixelRatio'ya göre — bizim tavanlı dpr'imizden
      // BAĞIMSIZ) disableRetinaScaling:true ile kapatıyoruz, CSS/görsel boyutu
      // her zaman displayW/H'a elle sabitliyoruz.
      const drawEl = document.createElement('canvas');
      drawEl.className = 'fabric-draw-canvas';
      drawEl.width = viewport.width; drawEl.height = viewport.height;
      drawEl.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:transparent;z-index:20;pointer-events:auto;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;';
      pageWrap.appendChild(drawEl);
      initFabricForPage(drawEl, viewport.width, viewport.height, pageNum, { disableRetinaScaling: true });
      const fc = appState.fabricCanvases[pageNum];
      [fc?.wrapperEl, fc?.lowerCanvasEl, fc?.upperCanvasEl].forEach(el=>{
        if(!el) return;
        el.style.width = displayW + 'px';
        el.style.height = displayH + 'px';
      });
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
    drawEl.style.cssText = 'position:absolute;top:0;left:0;width:' + displayW + 'px;height:' + displayH + 'px;z-index:20;pointer-events:auto;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;';
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
  hideContextMenu();
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
  let backdrop = document.getElementById('pdfContextBackdrop');
  if(!backdrop){
    backdrop = document.createElement('div');
    backdrop.id = 'pdfContextBackdrop';
    backdrop.style.cssText = `
      position:fixed;inset:0;z-index:9998;background:rgba(15,12,35,.18);
      backdrop-filter:blur(1px);display:none;
    `;
    backdrop.addEventListener('click', hideContextMenu);
    document.body.appendChild(backdrop);
  }
  let menu = document.getElementById('pdfContextMenu');
  if(!menu){
    menu = document.createElement('div');
    menu.id = 'pdfContextMenu';
    menu.style.cssText = `
      position:fixed;z-index:9999;background:var(--bg-2);border:1px solid var(--border-strong);
      border-radius:var(--radius);box-shadow:var(--shadow-xl);padding:6px;min-width:200px;
      max-height:85vh;overflow-y:auto;-webkit-overflow-scrolling:touch;
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
      <button class="ctx-item" onclick="promptPageJump();hideContextMenu()">
        <span style="font-size:15px">🔢</span>
        <div><div style="font-weight:600;font-size:13px">Sayfaya Git…</div><div style="font-size:11px;color:var(--text-muted)">Sayfa numarası gir</div></div>
      </button>
      <div style="height:1px;background:var(--border);margin:6px 0"></div>
      <button class="ctx-item" id="ctxFullscreen" onclick="window.toggleSolveMode&&window.toggleSolveMode();hideContextMenu()">
        <span style="font-size:15px">⛶</span>
        <div><div style="font-weight:600;font-size:13px">Tam Ekran</div><div style="font-size:11px;color:var(--text-muted)">Soru kartı tüm ekranı kaplar</div></div>
      </button>
    `;
    document.body.appendChild(menu);

    // Dışarı tıklayınca kapat
    document.addEventListener('click', e=>{
      if(!menu.contains(e.target)) hideContextMenu();
    });
  }

  // initPDFContextMenu() her openReader()'da tekrar çağrılır; bu koruma
  // OLMADAN her fasikül açılışında wrap'e bir tane daha dinleyici ekleniyor,
  // birikip uzun oturumlarda gereksiz bellek/işlem tüketiyordu
  // (initCardZoomPan/initLongPressDraw'daki aynı dataset bayrağı deseni).
  if(!wrap.dataset.ctxMenuReady){
    wrap.dataset.ctxMenuReady = '1';
    const isDrawingTool = ()=>['pen','tukenmez','marker','eraser','text'].includes(appState.drawTool);
    const isReaderTouchTool = ()=>['select','pen','tukenmez','marker','eraser','text'].includes(appState.drawTool);
    const clearReaderSelection = ()=>{
      try{
        const sel = window.getSelection?.();
        if(sel && !sel.isCollapsed) sel.removeAllRanges();
      }catch(_e){}
    };
    const suppressNativeReaderMenu = e=>{
      if(!e.target.closest?.('#readerCanvasWrap')) return;
      if(e.target.closest?.('button,input,textarea,select,.tool-btn,.color-dot,.size-slider')) return;
      if(e.type === 'selectstart') {
        e.preventDefault();
        clearReaderSelection();
        return;
      }
      if(!isReaderTouchTool()) return;
      // KRİTİK: 'pointerdown'da preventDefault() çağırmak (fare/mouse için)
      // tarayıcının bu pointer'dan türettiği 'mousedown' olayını TAMAMEN
      // BASTIRIYOR — Fabric.js'in çizim/silme başlatma mantığı 'mouse:down'
      // (native mousedown'dan) dinlediğinden masaüstünde farla çizim/silgi
      // SESSİZCE çalışmaz oluyordu (ekran görüntüsüyle doğrulandı: mouse
      // sürükleme hiçbir iz bırakmıyordu). Bu bastırma SADECE dokunma/kalemin
      // tetiklediği Safari native menüsünü/metin seçimini engellemek için var;
      // fare pointer'ında (e.pointerType==='mouse') dokunulmaz.
      if(e.type === 'pointerdown' && e.pointerType === 'mouse') return;
      e.preventDefault();
      if(!['touchstart','pointerdown'].includes(e.type)) e.stopPropagation();
      clearReaderSelection();
    };
    ['contextmenu','selectstart','webkitmouseforcewillbegin','touchstart','pointerdown'].forEach(type=>{
      wrap.addEventListener(type, suppressNativeReaderMenu, { capture:true });
    });
    document.addEventListener('selectionchange', ()=>{
      if(!document.getElementById('reader-overlay')?.classList.contains('open')) return;
      if(!isReaderTouchTool()) return;
      const sel = window.getSelection?.();
      const node = sel?.anchorNode;
      const el = node?.nodeType === 1 ? node : node?.parentElement;
      if(el?.closest?.('#readerCanvasWrap')) clearReaderSelection();
    });

    // Sağ tık (masaüstü)
    wrap.addEventListener('contextmenu', e=>{
      e.preventDefault();
      if(isDrawingTool()) return;
      showContextMenu(e.clientX, e.clientY);
    });
  }
}

function hideContextMenu(){
  const menu = document.getElementById('pdfContextMenu');
  const backdrop = document.getElementById('pdfContextBackdrop');
  if(menu){
    menu.style.display = 'none';
    menu.classList.remove('ctx-modal');
  }
  if(backdrop) backdrop.style.display = 'none';
}

function showContextMenu(x, y, opts={}){
  const menu = document.getElementById('pdfContextMenu');
  if(!menu) return;
  const asModal = !!opts.modal;
  const backdrop = document.getElementById('pdfContextBackdrop');
  menu.classList.toggle('ctx-modal', asModal);
  if(backdrop) backdrop.style.display = asModal ? 'block' : 'none';
  document.getElementById('ctxSingle')?.classList.toggle('ctx-active', appState.viewMode === 'single');
  document.getElementById('ctxScroll')?.classList.toggle('ctx-active', appState.viewMode === 'scroll');
  // Önce göster ki gerçek boyut ölçülebilsin (max-height:85vh + scroll ile sınırlı)
  menu.style.visibility = 'hidden';
  menu.style.display = 'block';
  const mw = menu.offsetWidth || 200;
  const mh = menu.offsetHeight || 180;
  const mx = asModal ? Math.max(10, (window.innerWidth - mw) / 2) : Math.max(6, Math.min(x, window.innerWidth - mw - 6));
  const my = asModal ? Math.max(10, (window.innerHeight - mh) / 2) : Math.max(6, Math.min(y, window.innerHeight - mh - 6));
  menu.style.left = mx + 'px';
  menu.style.top = my + 'px';
  menu.style.visibility = '';
}

function openViewModeMenu(e){
  e.stopPropagation();
  const menu = document.getElementById('pdfContextMenu');
  if(menu && menu.style.display === 'block'){
    hideContextMenu();
    return;
  }
  // Menüyü TIKLANAN butonun altında konumlandır (sabit #viewModeBtn'e güvenme —
  // o yalnız masaüstü üst araç çubuğunda var ve tablet/telefon yatayda gizli;
  // artık sol panelde de bu menüyü açan başka butonlar var).
  const btn = e.currentTarget instanceof Element ? e.currentTarget : document.getElementById('viewModeBtn');
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
  // Tüm PDF boyunca serbest sayfa değişimi (bölüm sınırına takılma)
  const maxPage = appState.pdfTotalPages || appState.totalPages;
  const newPage = appState.currentPage + delta;
  if(newPage<1 || newPage>maxPage) return;
  saveDrawing();
  goToPage(newPage);
}

function goToPage(n){
  const maxPage = appState.pdfTotalPages || appState.totalPages;
  const previousPage = Number(appState.currentPage || 1);
  appState.currentPage = Math.max(1,Math.min(n,maxPage));
  const nextPage = Number(appState.currentPage || 1);
  if((appState.watchMode || appState._liveSuppress || appState._presSuppress) && nextPage < previousPage - 2){
    window.debugReport?.('pdf.goto.rollback', {
      fromPage: previousPage,
      toPage: nextPage,
      requestedPage: n,
      viewMode: appState.viewMode,
      liveSuppress: !!appState._liveSuppress,
      presSuppress: !!appState._presSuppress,
      watchMode: !!appState.watchMode
    });
  }
  if(appState.viewMode === 'scroll'){
    // Scroll modunda: sayfa zaten render edilmiş, sadece scroll et
    const behavior = (appState._liveSuppress || appState._presSuppress || appState.watchMode) ? 'auto' : 'smooth';
    scrollToPage(appState.currentPage, behavior);
  } else {
    renderSinglePageMode(appState.currentPage);
  }
  updatePageIndicator();
  document.getElementById('prevPageBtn').disabled = appState.currentPage===1;
  document.getElementById('nextPageBtn').disabled = appState.currentPage===appState.totalPages;
  window.syncNavToPage?.(appState.currentPage);
  window.publishCanli?.();
  // Sayfa değişince, o sayfada ÖNCEDEN kayıtlı bir çizim varsa (yeni bir
  // kalem hareketi olmasa bile) İzle edenlere hemen yansısın — aksi halde
  // yalnızca o an YENİ çizilen bir şey İzleyen tarafta görünüyordu,
  // öğrencinin o sayfada zaten var olan eski çalışması hiç yansımıyordu.
  // _presSuppress: bu goToPage çağrısı BİZİM birini takip etmemizden
  // (goToPage(m.page)) geliyorsa kendi çizimimizi yanlışlıkla yayınlamayalım.
  if(!appState._presSuppress && appState.aktifFasikul){
    const key = `drawing_${appState.aktifFasikul.id}_p${appState.currentPage}`;
    const existing = appState.drawings[key];
    if(existing){
      const dims = appState.drawingDims[key] || {};
      window.publishCanliPresenceDraw?.(key, existing, dims.w||0, dims.h||0);
    }
  }
}

function scrollToPage(pageNum, behavior){
  const el = document.getElementById('page-wrap-' + pageNum);
  if(el){
    appState._scrollingToPage = true;
    window.syncNavToPage?.(pageNum);
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
  // Zoom çubuklarındaki kompakt sayfa göstergesi (− ve + arası)
  const mini = isSolutionPage ? `Çz / ${displayTotal}` : `${visibleIdx + 1} / ${displayTotal}`;
  document.querySelectorAll('.js-page-ind').forEach(el => el.textContent = mini);
  document.getElementById('rpSure').textContent = formatTime(appState.timerSec);
}

function promptPageJump(){
  const displayTotal = appState.displayTotalPages || appState.totalPages;
  const n = parseInt(prompt(`Sayfa giriniz (1-${displayTotal}):`));
  if(isNaN(n)) return;
  const target = (appState.visiblePages || [])[n - 1] || n;
  goToPage(target);
}

// Tüm zoom etiketlerini (panel + solve modu çubuğu) tek noktadan güncelle
// ── Zoom standartları: tek clamp + hassasiyet sabitleri (tüm giriş noktaları buna uyar)
const ZOOM_MIN = 25;
const ZOOM_MAX = 400;
// Trackpad/tekerlek pinch hassasiyeti: çarpımsal zoom faktörü = exp(-deltaY * SENS).
// deltaY büyüklüğüne duyarlı olduğu için yumuşak pinch küçük, hızlı pinch büyük adım verir.
const ZOOM_WHEEL_SENS = 0.0022;
function clampZoom(v){ return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v)); }
window.clampZoom = clampZoom;

function setZoomLabel(v){
  const pct = Math.round(v);
  document.querySelectorAll('.js-zoom-pct').forEach(el => el.textContent = `%${pct}`);
}
window.setZoomLabel = setZoomLabel;

// ══════════════════════════════════════════════════════════
// ZOOM/PAN MOTORU (v2 — sıfırdan yazıldı)
//
// Tek prensip: CSS transform-origin, jest boyunca odak noktasını (parmak/
// imleç konumu) EKRANDA sabit tutar — translate hesaplamaya, "hangi sayfa
// hangi oranda" izlemeye HİÇ gerek yok. Sarmalayıcı da artık jest başında
// kurulup jest bitince sökülen GEÇİCİ bir eleman değil: renderAllPages/
// renderSinglePageMode'un zaten oluşturduğu KALICI tek çocuk
// (.reader-pages-inner / .reader-page-stage) — bu yüzden "sayfaları geçici
// sarmalayıcıya taşı / geri taşı" adımı da tamamen kalktı.
//
// Akış: jest SIRASINDA yalnız transform:scale(...) uygulanır (60fps, ucuz).
// Jest BİTİNCE (parmaklar kalktı / trackpad sessizliği / +,- düğmesi):
// zoom belirgin değiştiyse gerçek/keskin render tetiklenir ve odak noktası
// TEK bir oransal scrollLeft/Top düzeltmesiyle aynı ekran konumunda tutulur
// (tüm belge zoom%'e göre DOĞRUSAL ölçeklendiği için — bkz. getReaderFitScale,
// artık 0.35 gibi bir alt-sınır kırpması yok — bu oran her zaman kesin doğru).
// ══════════════════════════════════════════════════════════
let gz = null; // aktif jest durumu (null = jest yok)

function getPagesInner(wrap){
  return wrap?.querySelector(':scope > .reader-pages-inner, :scope > .reader-page-stage') || null;
}

// inner içindeki sayfalar arasından (ekran x,y) noktasını içeren sayfayı
// bulur — tek sayfa modunda zaten tek aday, sürekli modda hit-test yapar.
// Tam üzerine denk gelen yoksa (sayfalar arası boşluk/kenar) en yakın
// sayfaya düşer — anchor hiçbir zaman tamamen kaybolmasın.
function locatePageAt(inner, x, y){
  const pages = inner.querySelectorAll('[data-page-num]');
  for(const p of pages){
    const r = p.getBoundingClientRect();
    if(x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return p;
  }
  let closest = null, minDist = Infinity;
  for(const p of pages){
    const r = p.getBoundingClientRect();
    const d = Math.hypot((r.left + r.width/2) - x, (r.top + r.height/2) - y);
    if(d < minDist){ minDist = d; closest = p; }
  }
  return closest;
}

// ── Canlı izleme: sayfa-göreli pan konumu ──────────────────────────────
// Ekran boyutu farklı olabileceğinden MUTLAK piksel yerine, görünen sayfanın
// KENDİ kutusuna göre ORAN (0..1) taşınır — beginZoomGesture'daki pageAnchor
// ile aynı fikir, ama sürekli (her scroll/pan'de okunabilir/uygulanabilir).
function getCurrentPageScrollFraction(){
  const wrap = document.getElementById('readerCanvasWrap');
  const inner = getPagesInner(wrap);
  if(!wrap || !inner) return null;
  const r = wrap.getBoundingClientRect();
  const cx = r.left + r.width/2, cy = r.top + r.height/2;
  // KRİTİK: appState.currentPage'i (updateCurrentPageFromScroll'ın "sayfa
  // merkezine en yakın" algoritmasıyla seçtiği sayfa) temel al — locatePageAt'in
  // BAĞIMSIZ hit-test'i (viewport merkezi hangi sayfanın kutusu İÇİNDE) sayfa
  // sınırlarında FARKLI bir sayfa seçebiliyordu. Bu durumda presence payload'ında
  // page=54 gönderilirken fracX/fracY/fracTop.. aslında page 53'ün kutusuna göre
  // ölçülmüş oluyordu — takip eden taraf bu oranı 54'ün kutusuna uygulayınca
  // sayfanın BAŞI yerine ORTASINA düşüyordu. page ile frac* HER ZAMAN aynı
  // sayfaya ait olmalı, bu yüzden burada da appState.currentPage kullanılır.
  let pageEl = inner.querySelector(`[data-page-num="${appState.currentPage}"]`);
  if(!pageEl) pageEl = locatePageAt(inner, cx, cy);
  if(!pageEl) return null;
  const pr = pageEl.getBoundingClientRect();
  if(!pr.width || !pr.height) return null;
  const clamp01 = v => Math.max(0, Math.min(1, v));
  return {
    pageNum: Number(pageEl.dataset.pageNum),
    fracX: (cx - pr.left) / pr.width,
    fracY: (cy - pr.top) / pr.height,
    fracLeft: clamp01((r.left - pr.left) / pr.width),
    fracRight: clamp01((r.right - pr.left) / pr.width),
    fracTop: clamp01((r.top - pr.top) / pr.height),
    fracBottom: clamp01((r.bottom - pr.top) / pr.height),
  };
}
window.getCurrentPageScrollFraction = getCurrentPageScrollFraction;

// Takip edilenin fracX/fracY'sini KENDİ ekranımızda aynı sayfa-göreli noktayı
// uygular (zoom zaten ayrıca uygulanmış olmalı). Yeni canlı takipte görünür
// alanın sol + üst kenarını baz alıyoruz; farklı cihaz/panel boyutlarında
// öğrencinin gördüğü bölümün kenarlardan kırpılmasını bu önler. Eski payload'lar
// için merkez hizalama korunur.
function applyPageScrollFraction(pageNum, fracX, fracY, opts = {}){
  const wrap = document.getElementById('readerCanvasWrap');
  const inner = getPagesInner(wrap);
  if(!wrap || !inner || fracX == null || fracY == null) return;
  const pageEl = inner.querySelector(`[data-page-num="${pageNum}"]`);
  if(!pageEl) return;
  const pr = pageEl.getBoundingClientRect();
  if(!pr.width || !pr.height) return;
  const wr = wrap.getBoundingClientRect();
  const useLeftAnchor = opts && opts.fracLeft != null && Number.isFinite(Number(opts.fracLeft));
  const targetX = pr.left + (useLeftAnchor ? Number(opts.fracLeft) : fracX) * pr.width;
  const useTopAnchor = opts && opts.fracTop != null && Number.isFinite(Number(opts.fracTop));
  const targetY = pr.top + (useTopAnchor ? Number(opts.fracTop) : fracY) * pr.height;
  wrap.scrollLeft += useLeftAnchor
    ? targetX - (wr.left + 8)
    : targetX - (wr.left + wr.width / 2);
  wrap.scrollTop += useTopAnchor
    ? targetY - (wr.top + 8)
    : targetY - (wr.top + wr.height / 2);
}
window.applyPageScrollFraction = applyPageScrollFraction;

// Aktif bir canlı zoom önizlemesi sürüyor mu? (lazy render edilen yeni
// sayfaların hangi taban zoom'u kullanacağını bilmesi için — bkz.
// getStableRenderZoom: önizleme sırasında lazy sayfalar RENDEREDzoom'da
// çizilmeli, yoksa üstlerine bir de transform binince çift ölçeklenirler.)
function isZoomGestureLive(){ return !!gz; }

function beginZoomGesture(focalX, focalY){
  if(gz) return;
  const wrap = document.getElementById('readerCanvasWrap');
  const inner = getPagesInner(wrap);
  if(!inner) return;
  // KRİTİK: transform-origin bir elemanın KENDİ (transform'suz) border-box'ına
  // göredir — wrap'e göre DEĞİL. inner'ın o anki getBoundingClientRect()'i zaten
  // mevcut scroll konumunu yansıtır (scroll oldukça inner viewport'ta kayar),
  // bu yüzden ayrıca wrap.scrollLeft/Top eklemeye gerek YOK — eklemek yanlış
  // (wrap'in padding'i + inner'ın kendi konumu wrap'in rect'inden farklı)
  // bir referans noktasına göre ölçüp gerçek bir kaymaya yol açıyordu.
  // KRİTİK: Aşağıdaki TÜM rect ölçümleri (innerRect + pageAnchor) wrap'in
  // DOĞAL/DOKUNULMAMIŞ (overflow:auto) yerleşimine göre, TEK bir tutarlı
  // anda alınır — overflow'u 'hidden' yapmadan ÖNCE. wrap'in overflow'unu
  // 'hidden' yapmak WebKit'te (iPad'de gerçek PDF ile ölçülüp doğrulandı)
  // scrollbar'ın kayboluşuyla birlikte ANINDA küçük (~birkaç piksel) bir
  // reflow'a yol açabiliyor — innerRect BUNDAN ÖNCE, pageAnchor BUNDAN
  // SONRA ölçülseydi iki değer FARKLI referans çerçevelerine göre olur ve
  // aralarında sabit küçük bir tutarsızlık (zıplama) oluşurdu.
  const innerRect = inner.getBoundingClientRect();
  const originX = focalX - innerRect.left;
  const originY = focalY - innerRect.top;
  // Odak noktasının hangi SAYFAya denk geldiğini ve o sayfa içindeki ORANSAL
  // (0..1) konumunu da saklıyoruz — settle'da bunu KULLANIRIZ (pure-ratio
  // yerine). İki ayrı sebep var: (1) tek sayfa modunda .reader-page-stage
  // kendi boyutunu (pan alanı için, bkz. sizeReaderStage) viewport'a göre
  // TABAN alıp büyütür — sayfa viewport'u aşana kadar stage boyutu SABİT
  // kalır, aşınca sayfayla birlikte büyür: zoom%'e göre DOĞRUSAL DEĞİL.
  // (2) sürekli modda IntersectionObserver'ın "yer tutucu → gerçek boyut"
  // geçişi ASENKRON — settle anında odak sayfası hâlâ tahmini yer tutucu
  // boyutundaysa, gerçek boyut az sonra gelince içerik hafifçe kayar (gerçek
  // PDF ile ölçülüp doğrulandı: %193 zoom'da ~11px dikey kayma). Sayfanın
  // KENDİ taze kutusunu (settle'da force-render edilmiş hâliyle) ölçmek her
  // iki sorunu da kökten çözer — inner'ın toplam boyutunun nasıl büyüdüğüne
  // hiç bağlı değil.
  let pageAnchor = null;
  const pageEl = locatePageAt(inner, focalX, focalY);
  if(pageEl){
    const pr = pageEl.getBoundingClientRect();
    if(pr.width && pr.height){
      pageAnchor = {
        pageNum: pageEl.dataset.pageNum,
        fracX: (focalX - pr.left) / pr.width,
        fracY: (focalY - pr.top) / pr.height,
      };
    }
  }
  inner.style.transformOrigin = `${originX}px ${originY}px`;
  inner.style.willChange = 'transform';
  // KRİTİK (eski koddan doğrulanmış gerçek bir tarayıcı davranışı): wrap
  // 'overflow:auto' iken transform'la KÜÇÜLEN inner'ın taştığı alan wrap'in
  // scrollWidth/Height'ını jest SIRASINDA canlı küçültür — tarayıcı bunun
  // üzerine scrollLeft/Top'u JS'in haberi olmadan otomatik kırpar. Jest
  // boyunca overflow:hidden ile bunu devre dışı bırakıyoruz (yukarıdaki TÜM
  // ölçümlerden SONRA, ki onları etkilemesin); commit'te gerçek scroll
  // konumunu KENDİMİZ ayarladıktan sonra geri açılır.
  wrap.style.overflow = 'hidden';
  gz = {
    wrap, inner, focalX, focalY, pageAnchor,
    startZoom: appState.zoom,
    renderedZoom: appState._renderedZoom || appState.zoom || 100,
    liveZoom: appState.zoom,
    startTime: Date.now(),
  };
}

function updateZoomGesture(liveZoom){
  if(!gz) return;
  liveZoom = clampZoom(liveZoom);
  gz.liveZoom = liveZoom;
  gz.inner.style.transform = `scale(${liveZoom / gz.renderedZoom})`;
  appState.zoom = liveZoom;
  setZoomLabel(liveZoom);
}

let _zoomSettleGen = 0; // yarım kalan bir settle'ı sonraki jest geçersiz kılabilsin

// Jesti kapatır. Zum belirgin değiştiyse (eşik: 2 puan): gerçek/keskin render
// planlanır ve odak noktası TEK bir oransal scroll düzeltmesiyle aynı ekran
// konumunda tutulur. Neredeyse hiç değişmediyse (sade bırakma/flick):
// transform anında kaldırılır, hiçbir yan etki bırakılmaz.
async function endZoomGesture(){
  if(!gz) return null;
  const { wrap, inner, focalX, focalY, liveZoom, renderedZoom, startZoom, startTime, pageAnchor } = gz;
  gz = null;
  const zoomChanged = Math.abs(liveZoom - startZoom) >= 2;
  const result = { zoomChanged, dur: Date.now() - startTime };

  if(!zoomChanged){
    inner.style.transform = '';
    inner.style.transformOrigin = '';
    wrap.style.overflow = '';
    return result;
  }

  // originX/Y: transform-origin'e jest BAŞINDA yazdığımız, RENDEREDzoom'un
  // piksel uzayındaki sabit içerik noktası. Belge zoom%'e göre doğrusal
  // ölçeklendiğinden aynı nokta yeni render'da sadece 'ratio' kadar büyür —
  // hangi sayfada olduğunu bilmeye hiç gerek yok.
  const [originX, originY] = inner.style.transformOrigin.split(' ').map(parseFloat);
  const ratio = liveZoom / renderedZoom;
  const targetContentX = originX * ratio;
  const targetContentY = originY * ratio;

  const myGen = ++_zoomSettleGen;
  (window.__zd=window.__zd||[]).push({t:'start', pageAnchor, myGen, liveZoom, renderedZoom});
  appState._preserveScrollAfterRender = true;
  wrap.classList.add('zoom-settling');
  try{
    await Promise.resolve(renderPages());
  }catch(e){
    window.debugReport?.('pdf.zoom.render.failed', {error:e, liveZoom, renderedZoom, startZoom});
    wrap.style.overflow = '';
    wrap.classList.remove('zoom-settling');
    throw e;
  }
  (window.__zd=window.__zd||[]).push({t:'afterRenderPages', myGen, _zoomSettleGen, aborted: myGen !== _zoomSettleGen});
  if(myGen !== _zoomSettleGen) return result; // yeni bir jest bu render'ı geçersiz kıldı

  // renderPages() wrap'i baştan kurdu — taze inner scrollLeft/Top==0 konumunda
  // (innerHTML sıfırlanınca tarayıcı scroll'u doğal olarak sıfırlar). Aynı
  // "kendi kutusuna göre" mantığı: taze inner'ın rect'i + hedef içerik konumu
  // - odak ekran konumu = uygulanacak scroll.
  wrap.scrollLeft = 0; wrap.scrollTop = 0;
  const freshInner = getPagesInner(wrap);
  const freshRect = freshInner.getBoundingClientRect();
  const freshPageEl = pageAnchor ? freshInner.querySelector(`[data-page-num="${pageAnchor.pageNum}"]`) : null;
  (window.__zd=window.__zd||[]).push({t:'freshPageEl', pageAnchor, hasFreshPageEl: !!freshPageEl, w: freshPageEl?.offsetWidth, h: freshPageEl?.offsetHeight, rendered: freshPageEl?.dataset?.rendered});
  // Sürekli modda renderAllPages() TÜM sayfalar için önce genel tahminli bir
  // YER TUTUCU boyut kurar; gerçek/PDF'e-özgü boyut yalnızca IntersectionObserver
  // sayfayı görününce (asenkron, gecikmeli) geliyor. Anchor sayfası TAM O
  // SIRADA hâlâ yer tutucuysa, konum onun üzerinden hesaplanır ve gerçek boyut
  // az sonra gelince içerik hafifçe kayar (gerçek PDF ile ölçülüp doğrulandı:
  // %193 zoom'da ~11px). Ölçmeden ÖNCE zorla/senkron gerçek render'ını bekleriz.
  // SADECE sürekli modda anlamlı: bu 'dataset.rendered' işareti YALNIZ
  // renderAllPages()'in IntersectionObserver akışında set edilir. Tek sayfa
  // modunda renderSinglePageMode() sayfayı bu ÇAĞRIYLA AYNI renderPages()
  // içinde SENKRON olarak ZATEN tam render etmiştir ve bu işareti hiç
  // kullanmaz — kontrolsüz bırakılırsa (dataset.rendered hep undefined
  // kalır) HER zoom değişiminde freshPageEl'e İKİNCİ bir pdfCanvas+Fabric
  // katmanı daha eklenir: kanvas belleği ikiye katlanır VE üst üste binen
  // iki Fabric canvas'ı arasında hangisinin appState.fabricCanvas olduğu
  // belirsizleşip çizim/dokunma eşleşmesi bozulur (gerçek cihazda "çok
  // büyük zoom hareketi yapınca kapanıyor" ve test ortamında dokunuşun
  // yanlış canvas'a düşmesiyle doğrulandı).
  if(appState.viewMode === 'scroll' && freshPageEl && freshPageEl.dataset.rendered !== '1'){
    freshPageEl.dataset.rendered = '1';
    try{
      if(appState.pdfDoc) await renderSinglePDFPage(Number(pageAnchor.pageNum), freshPageEl);
      else renderSingleFallbackPage(Number(pageAnchor.pageNum), freshPageEl);
    }catch(e){ console.warn('Anchor sayfası zorla render edilemedi:', e); }
    (window.__zd=window.__zd||[]).push({t:'afterForceRender', myGen, _zoomSettleGen, aborted: myGen !== _zoomSettleGen, w: freshPageEl?.offsetWidth, h: freshPageEl?.offsetHeight});
    if(myGen !== _zoomSettleGen) return result; // bu bekleme sırasında yeni bir jest başladı
  }
  // Tek sayfa modunda (bkz. beginZoomGesture'daki not — stage boyutu zoom%'e
  // göre doğrusal değil) sayfanın KENDİ taze kutusu + saklanan oran tercih
  // edilir; pure-ratio'dan HER ZAMAN daha doğru, çünkü stage'in nasıl
  // büyüdüğüne hiç bağlı değil.
  if(freshPageEl && freshPageEl.offsetWidth && freshPageEl.offsetHeight){
    // scrollLeft henüz 0 olduğundan pr.left/top mevcut (kaydırılmamış)
    // ekran konumu — istenen scroll = o konum + oran*boyut - hedef ekran konumu.
    // AMA: sayfa o eksende viewport'a SIĞIYORSA (pr.width<=clientWidth vb.)
    // o eksende scroll YAPILAMAZ/GEREKMEZ — CSS zaten margin:auto/justify-
    // content:center ile ORTALAR, scrollLeft/Top'u ne yazarsak yazalım
    // tarayıcı 0'a kırpar. Bu durumda dokunmayız (0 zaten doğru); aksi halde
    // "hedef" hesabımız gerçek CSS-ortalamasıyla çakışıp sabit bir kaymaya
    // yol açardı (gerçek PDF ile ölçülüp doğrulandı: %100'e dönüşte ~19px).
    // DİKEY EKSEN İSTİSNASI: bu "sığıyorsa dokunma" kuralı SADECE tek sayfa
    // modunda geçerli (.reader-page-stage TEK sayfayı ortalar). Sürekli
    // (scroll) modda sayfalar art arda dizilidir — bir sayfanın KENDİ
    // yüksekliği viewport'tan kısa olsa bile (düşük zoom'da kaçınılmaz)
    // belgenin genel scroll konumu HÂLÂ ayarlanmalı; aksi halde scrollTop
    // hep 0'da kalıp hangi sayfada olursan ol 1. sayfaya "zıplıyordu" (gerçek
    // PDF ile ölçülüp doğrulandı: ~%55 zoom'un altında her yerden 1. sayfaya).
    const pr = freshPageEl.getBoundingClientRect();
    if(pr.width > wrap.clientWidth){
      wrap.scrollLeft = Math.max(0, pr.left + pageAnchor.fracX * pr.width - focalX);
    }
    if(appState.viewMode === 'scroll' || pr.height > wrap.clientHeight){
      wrap.scrollTop = Math.max(0, pr.top + pageAnchor.fracY * pr.height - focalY);
    }
    (window.__zd=window.__zd||[]).push({t:'branchPageEl', prTop: pr.top, prHeight: pr.height, fracY: pageAnchor.fracY, focalY, resultScrollTop: wrap.scrollTop});
  } else {
    wrap.scrollLeft = Math.max(0, freshRect.left + targetContentX - focalX);
    wrap.scrollTop = Math.max(0, freshRect.top + targetContentY - focalY);
    (window.__zd=window.__zd||[]).push({t:'branchRatioFallback', freshRectTop: freshRect.top, targetContentY, focalY, resultScrollTop: wrap.scrollTop});
  }
  wrap.style.overflow = '';
  wrap.classList.remove('zoom-settling');
  appState._zoomSettlingUntil = Date.now() + 250;
  window.publishCanli?.();   // canlı izleyenler zoom/pan'i de görsün
  return result;
}

// Paylaşılan jest durumunu KULLANMAYAN, TEK SEFERLİK anlık önizleme — ör.
// çift-tık/çift-dokunuşla %100'e sıfırlama (resetZoomAndPan, solve.js).
// Çağıran taraf kendi renderPages()+overflow sıfırlamasını yapar, bu yüzden
// burada endZoomGesture ÇAĞRILMAZ — sadece canlı önizleme uygulanır.
function previewZoomTo(targetZoom, focalX, focalY){
  beginZoomGesture(focalX, focalY);
  if(gz) updateZoomGesture(targetZoom);
}
window.previewZoomTo = previewZoomTo;

function changeZoom(delta){
  const wrap = document.getElementById('readerCanvasWrap');
  if(!wrap) return;
  const rect = wrap.getBoundingClientRect();
  const cx = rect.left + wrap.clientWidth / 2, cy = rect.top + wrap.clientHeight / 2;
  if(gz) endZoomGesture();
  beginZoomGesture(cx, cy);
  updateZoomGesture(appState.zoom + delta);
  // endZoomGesture() bir Promise döner (render tamamlanınca çözülür) —
  // canlı izleme takibi (setZoomAbsolute) zoom'un GERÇEKTEN oturmasını
  // bekleyip ondan SONRA pan/fraksiyon uygulayabilsin diye döndürüyoruz.
  return endZoomGesture();
}
window.changeZoom = changeZoom;

// Canlı izlemede takip edilenin MUTLAK zoom%'ini uygulamak için — changeZoom
// göreli (delta) çalışır, takip tarafı hedefi doğrudan bilir.
function setZoomAbsolute(targetZoom){
  return changeZoom(clampZoom(targetZoom) - appState.zoom);
}
window.setZoomAbsolute = setZoomAbsolute;

// ══════════════════════════════════════════════════════════
// GİRİŞ UYARLAYICILARI — trackpad (ctrl/meta+wheel), Safari native gesture
// olayları (gesturestart/change/end) ve masaüstü fare-sürükle pan'i. Hepsi
// yukarıdaki TEK paylaşılan motoru (beginZoomGesture/updateZoomGesture/
// endZoomGesture) besler; kendi aralarında hiç durum paylaşmazlar.
// ══════════════════════════════════════════════════════════
function initCardZoomPan(){
  const wrap = document.getElementById('readerCanvasWrap');
  if(!wrap || wrap.dataset.zoomPanReady) return;
  wrap.dataset.zoomPanReady = '1';
  wrap.classList.add('card-pan-ready');

  const isGestureTarget = (target) =>
    !!target.closest('#readerCanvasWrap') && !target.closest('button,label,input,select,.reader-right,.reader-toolbar,.reader-bottom-bar');
  const SCROLL_SPEED = 2;

  // ── Trackpad pinch (Chrome/Edge: ctrl/meta+wheel). Düz wheel'e HİÇ
  // dokunmadan önce düz wheel'i daha hızlı kaydırma için elle uygularız.
  let wheelIdleTimer = null;
  wrap.addEventListener('wheel', (e) => {
    if(!document.getElementById('reader-overlay')?.classList.contains('open')) return;
    if(!isGestureTarget(e.target)) return;
    if(!(e.ctrlKey || e.metaKey)){
      e.preventDefault();
      wrap.scrollLeft += e.deltaX * SCROLL_SPEED;
      wrap.scrollTop += e.deltaY * SCROLL_SPEED;
      return;
    }
    e.preventDefault();
    if(!gz) beginZoomGesture(e.clientX, e.clientY);
    if(!gz) return; // wrap boş (henüz içerik yok)
    const factor = Math.exp(-e.deltaY * ZOOM_WHEEL_SENS);
    updateZoomGesture(gz.liveZoom * factor);
    clearTimeout(wheelIdleTimer);
    wheelIdleTimer = setTimeout(() => endZoomGesture(), 220);
  }, { passive: false });

  // ── Safari/macOS trackpad pinch: çoğu durumda ctrl+wheel yerine
  // gesturestart/gesturechange/gestureend üretir.
  let gestureBaseZoom = 100;
  wrap.addEventListener('gesturestart', (e) => {
    if(!isGestureTarget(e.target)) return;
    e.preventDefault();
    if(gz) endZoomGesture();
    const rect = wrap.getBoundingClientRect();
    beginZoomGesture(e.clientX || rect.left + wrap.clientWidth / 2, e.clientY || rect.top + wrap.clientHeight / 2);
    gestureBaseZoom = gz?.startZoom || appState.zoom || 100;
  }, { passive: false });
  wrap.addEventListener('gesturechange', (e) => {
    if(!gz) return;
    e.preventDefault();
    const scale = Number.isFinite(e.scale) && e.scale > 0 ? e.scale : 1;
    updateZoomGesture(gestureBaseZoom * scale);
  }, { passive: false });
  wrap.addEventListener('gestureend', (e) => {
    if(!gz) return;
    e.preventDefault();
    endZoomGesture();
  }, { passive: false });

  // ── Masaüstü: "Seç/Taşı" aracında fare sürükleyerek pan. Mouse'ta native
  // sürükle-kaydır YOKTUR (touch-action bunun için değil), bu yüzden elle
  // uyguluyoruz — dokunma burada YOK, o native (styles.css touch-action).
  let isPanning = false, startX = 0, startY = 0, startScrollLeft = 0, startScrollTop = 0;
  wrap.addEventListener('pointerdown', (e) => {
    if(e.pointerType === 'touch') return; // dokunma: native kaydırma
    if(e.button !== 0 || !isGestureTarget(e.target)) return;
    if(appState.drawTool !== 'select' && e.target.closest('canvas')) return;
    isPanning = true;
    startX = e.clientX; startY = e.clientY;
    startScrollLeft = wrap.scrollLeft; startScrollTop = wrap.scrollTop;
    wrap.classList.add('card-panning');
    wrap.setPointerCapture?.(e.pointerId);
  });
  wrap.addEventListener('pointermove', (e) => {
    if(!isPanning) return;
    e.preventDefault();
    wrap.scrollLeft = startScrollLeft - (e.clientX - startX) * SCROLL_SPEED;
    wrap.scrollTop = startScrollTop - (e.clientY - startY) * SCROLL_SPEED;
  });
  const stopPan = (e) => {
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
// 2 PARMAK TOUCH PINCH-ZOOM (tablet + telefon ortak). Capture phase ile
// Fabric'e ulaşmadan yakalar. Kapsamı BİLEREK dar: 2 parmak SADECE
// pinch-zoom'dur (pan/flick değil) — kaydırma zaten tek parmakla native
// çalışıyor (bkz. initLongPressDraw altındaki not), bu yüzden burada
// mesafe DEĞİŞMEYEN bir 2-parmak jesti kasıtlı olarak hiçbir şey yapmaz.
// ══════════════════════════════════════════════════════════
function initTouchGestures(){
  const wrap = document.getElementById('readerCanvasWrap');
  if(!wrap || wrap.dataset.touchGestureReady) return;
  wrap.dataset.touchGestureReady = '1';

  let startDist = 0, baseZoom = 100;
  let rafId = null, pending = null;

  const dist = (a, b) => Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
  const midpt = (a, b) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });

  function applyPending(){
    if(!gz || !pending) return;
    const { d, m } = pending;
    pending = null;
    updateZoomGesture(baseZoom * (d / Math.max(1, startDist)));
  }

  wrap.addEventListener('touchstart', e => {
    if(e.touches.length !== 2) return;
    e.preventDefault();
    e.stopPropagation();
    const [a, b] = e.touches;
    startDist = dist(a, b);
    const mid = midpt(a, b);
    if(gz) endZoomGesture();
    beginZoomGesture(mid.x, mid.y);
    baseZoom = gz?.startZoom || appState.zoom || 100;
  }, { passive: false, capture: true });

  wrap.addEventListener('touchmove', e => {
    if(!gz || e.touches.length !== 2) return;
    e.preventDefault();
    e.stopPropagation();
    // Ham veriyi hemen KAYDET, DOM'a hemen YAZMA — ekranın çizim hızına
    // (requestAnimationFrame) senkron, karede en fazla BİR kez uygula.
    pending = { d: dist(e.touches[0], e.touches[1]), m: midpt(e.touches[0], e.touches[1]) };
    if(rafId == null) rafId = requestAnimationFrame(() => { rafId = null; applyPending(); });
  }, { passive: false, capture: true });

  const onEnd = e => {
    if(!gz || e.touches.length >= 2) return;
    if(rafId != null){ cancelAnimationFrame(rafId); rafId = null; }
    applyPending();
    endZoomGesture();
  };
  wrap.addEventListener('touchend', onEnd, { passive: false, capture: true });
  wrap.addEventListener('touchcancel', onEnd, { passive: false, capture: true });
}

// ══════════════════════════════════════════════════════════
// TEK PARMAK: wrap'in KENDİ boşluk/kenar alanında kaydırma NATİF tarayıcıya
// bırakılır (touch-action:pan-x pan-y, bkz. styles.css) — momentum bedava
// gelir. AMA canvas'ın (.lower-canvas/.upper-canvas) touch-action'ı HER ZAMAN
// 'none': touch-action dokunuşun PARMAK mı KALEM mi olduğunu AYIRT ETMEZ —
// canvas'ı native pan'e açmak (önceki v2 denemesi) tablette KALEMLE
// ÇİZERKEN de sayfayı native kaydırmaya "kaçırıyordu" (gerçek iPad+Apple
// Pencil ile doğrulandı: "kalemle yazarken sayfa oynuyor, yazamıyorum").
// Çözüm: canvas üzerindeki parmak-pan'i (tablette HER ZAMAN, telefonda
// "Seç/Taşı" aracında) BURADA elle (JS ile, scrollLeft/Top) sürüyoruz —
// kalem bu koda HİÇ girmez (ilk kontrol), Fabric'in kendi çizim motoruna
// kalır, touch-action:none olduğundan tarayıcı da hiç karışmaz.
// ══════════════════════════════════════════════════════════
function initLongPressDraw(){
  const wrap = document.getElementById('readerCanvasWrap');
  if(!wrap || wrap.dataset.lpDrawReady) return;
  wrap.dataset.lpDrawReady = '1';

  const MOVE_THRESHOLD = 8;   // px — jest "hareket etti" eşiği
  const MENU_HOLD = 1000;     // 1sn sabit basış → Görünüm Modu menüsü
  const TOUCH_SCROLL_SPEED = 2;
  const FLICK_MAX_MS = 500;   // bu süreden hızlı + uzun kaydırma = flick
  const FLICK_MIN = 70;       // flick için min mesafe
  let s = null;

  wrap.addEventListener('touchstart', e => {
    if(e.touches.length !== 1){ if(s){ clearTimeout(s.menuTimer); s = null; } return; }
    const t = e.touches[0];
    if(t.touchType === 'stylus') return; // kalem → Fabric native çizim, HER ZAMAN, buraya hiç girmez
    const onCanvas = !!e.target.closest('canvas');
    const scrollable = wrap.scrollWidth > wrap.clientWidth + 1 || wrap.scrollHeight > wrap.clientHeight + 1;
    const panEnabled = isTabletDevice() || appState.drawTool === 'select';
    s = {
      x0: t.clientX,
      y0: t.clientY,
      sl: wrap.scrollLeft,
      st: wrap.scrollTop,
      t0: Date.now(),
      scrollable,
      onCanvas,
      panEnabled,
      moved: false,
      menuShown: false,
      menuTimer: null
    };
    s.menuTimer = setTimeout(() => {
      if(!s || s.menuShown || s.moved) return;
      s.menuShown = true;
      window.showContextMenu?.(s.x0, s.y0, { modal:true });
      navigator.vibrate?.(15);
    }, MENU_HOLD);
    // Tablette ARAÇ FARK ETMEKSİZİN, telefonda yalnız "Seç" aracında: parmak
    // HER ZAMAN pan'dir (GoodNotes/Notability tarzı: parmak gezinir, kalem
    // yazar). Diğer durumda (telefon + çizim aracı) tamamen Fabric'e bırak.
    if(!panEnabled) return;
    // Canvas ÜZERİNDE mi başladı? Değilse (wrap'in boşluk/kenarı) native
    // scroll zaten çalışıyor, elle pan GEREKMİYOR — sadece TANIMA (menü/flick).
    // KRİTİK: canvas'taki bu parmak dokunuşu, bir çizim aracı (Seç DIŞINDA
    // pen/tukenmez/marker/eraser/text) aktifken Fabric'e HİÇ ulaşmamalı —
    // aksi halde HEM biz pan ederiz HEM Fabric aynı dokunuşu çizim/silme
    // sayar (touchType tek başına yeterli ayraç değil: parmakla test/yanlışlık
    // kalemle karışabilir) → mürekkep VE sayfa aynı anda kayar (gerçek
    // cihazda "kalem yazma hassasiyeti bozuldu" olarak bildirildi). CAPTURE
    // fazında stopPropagation ile durdurulunca Fabric'in canvas'a bağlı
    // touchstart dinleyicisi (target fazı, capture'dan SONRA çalışır) hiç
    // tetiklenmez; kendi iç "sürüklüyor" bayrağı (brush/silgi/seçim) hiç set
    // edilmediğinden sonraki touchmove/touchend'lar da Fabric için no-op olur.
    if(onCanvas && appState.drawTool !== 'select') e.stopPropagation();
  }, { capture: true, passive: true }); // CAPTURE: Fabric'e (target fazı) ulaşmadan ÖNCE karar verip gerekirse durdurmalıyız

  wrap.addEventListener('touchmove', e => {
    if(!s || e.touches.length !== 1) return;
    const t = e.touches[0];
    if(!s.moved && Math.hypot(t.clientX - s.x0, t.clientY - s.y0) > MOVE_THRESHOLD){
      s.moved = true;
      clearTimeout(s.menuTimer);
      if(s.menuShown){
        const menu = document.getElementById('pdfContextMenu');
        if(menu) menu.style.display = 'none';
      }
    }
    s.lastX = t.clientX; s.lastY = t.clientY;
    // Canvas üzerinde başladıysa (touch-action orada 'none', native pan
    // OLAMAZ) pan'i biz sürüyoruz. Canvas dışında native scroll zaten
    // çalışıyor, dokunmuyoruz.
    if(s.moved && s.onCanvas && s.panEnabled){
      wrap.scrollLeft = s.sl - (t.clientX - s.x0) * TOUCH_SCROLL_SPEED;
      wrap.scrollTop = s.st - (t.clientY - s.y0) * TOUCH_SCROLL_SPEED;
    }
  }, { passive: true });

  const onEnd = () => {
    if(!s) return;
    clearTimeout(s.menuTimer);
    // Sol/yukarı flick → sonraki sayfa, sağ/aşağı → önceki. Yalnız kaydıracak
    // içerik YOKKEN (aksi halde bu zaten pan'dir, sayfa değişmemeli).
    if(s.moved && !s.scrollable){
      const dx = (s.lastX ?? s.x0) - s.x0, dy = (s.lastY ?? s.y0) - s.y0, dur = Date.now() - s.t0;
      if(dur < FLICK_MAX_MS && Math.max(Math.abs(dx), Math.abs(dy)) > FLICK_MIN){
        const dir = (Math.abs(dx) >= Math.abs(dy)) ? (dx < 0 ? 1 : -1) : (dy < 0 ? 1 : -1);
        window.changePage?.(dir);
      }
    }
    s = null;
  };
  wrap.addEventListener('touchend', onEnd, { passive: true });
  wrap.addEventListener('touchcancel', onEnd, { passive: true });
}
// iPhone 14 Pro MAX (visualViewport.offsetTop≠0): position:fixed panelde iOS native
// hit-test'i offset kadar şaşırıyor (undo→kalem, redo→silgi; renk/araç butonları da
// aynı şekilde kayar). RENDER parmakla hizalı olduğundan, görsel konumdaki gerçek
// butonu elementFromPoint ile bulup tetikleriz. Ofset 0 ise (iPhone Pro, masaüstü,
// standalone) hiç devreye girmez → native davranış. Hem masaüstü/tablet paneli
// (#readerRight) hem de telefon tam-ekran çözüm paleti (#solvePalette) kapsanır.
function initPanelTapFix(panelId){
  const panel = document.getElementById(panelId);
  if(!panel || panel.dataset.tapFix) return;
  panel.dataset.tapFix = '1';
  let sx = 0, sy = 0, moved = false;
  panel.addEventListener('touchstart', e => {
    const t = e.touches && e.touches[0]; if(!t) return;
    sx = t.clientX; sy = t.clientY; moved = false;
  }, { passive:true, capture:true });
  panel.addEventListener('touchmove', e => {
    const t = e.touches && e.touches[0]; if(!t) return;
    if(Math.hypot(t.clientX - sx, t.clientY - sy) > 10) moved = true;
  }, { passive:true, capture:true });
  panel.addEventListener('touchend', e => {
    const vv = window.visualViewport;
    const vox = vv ? vv.offsetLeft : 0, voy = vv ? vv.offsetTop : 0;
    if((!vox && !voy) || moved) return;           // ofset yok ya da kaydırma → native
    const t = e.changedTouches && e.changedTouches[0]; if(!t) return;
    // Çizim düzeltmesiyle aynı işaret: gerçek görsel hedef (clientX-vox, clientY-voy)
    const el = document.elementFromPoint(t.clientX - vox, t.clientY - voy);
    const target = el && el.closest && el.closest('button,.color-dot,[onclick]');
    const native = e.target && e.target.closest && e.target.closest('button,.color-dot,[onclick]');
    if(target && panel.contains(target) && target !== native){
      e.preventDefault(); e.stopPropagation();
      target.click();
    }
  }, { passive:false, capture:true });
}
window.initPanelTapFix = initPanelTapFix;
document.addEventListener('DOMContentLoaded', ()=>{
  initPanelTapFix('readerRight');
  initPanelTapFix('solvePalette');
  initPanelTapFix('rpZoomBar');
});


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
window.hideContextMenu = hideContextMenu;
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
window.initCardZoomPan = initCardZoomPan;
