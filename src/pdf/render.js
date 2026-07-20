import { appState } from '../state/appState.js';

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
appState.viewMode = 'single'; // 'single' | 'scroll'

/**
 * Tüm sayfalar için placeholder div'ler oluşturur,
 * IntersectionObserver ile görünür sayfaları render eder.
 */

async function renderAllPages(){
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

  // Her sayfa için önce placeholder oluştur (boyut sonra doldurulacak)
  for(let i = 1; i <= totalPages; i++){
    const pageWrap = document.createElement('div');
    pageWrap.className = 'pdf-page-wrap';
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
    if(appState._scrollingToPage || appState._touchGestureActive || Date.now() < (appState._zoomSettlingUntil || 0)) return;
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

// Tablet mi telefon mu? Genişlik/yükseklik yön değiştiğinde yer değiştirdiğinden
// (yatay/dikey) tek bir eksene bakmak yanıltır — KISA kenar telefon/tablet
// arasında yönden bağımsız güvenilir bir ayraç: iPad'ler (mini dahil) yatay/
// dikey fark etmeksizin kısa kenarda ~744px+, telefonlar (Pro Max dahil)
// ~430px'i geçmez. Eşik 500px iki grup arasında güvenli bir orta nokta.
function isTabletDevice(){
  return Math.min(window.innerWidth, window.innerHeight) > 500;
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
  const base = viewportW / natural.width;
  // Tam ekran (solve) modu: kartı kalan alana COVER doldur → gri boşluk kalmaz,
  // sayfa her yönde ekranı doldurur (genişlik VE yüksekliğin BÜYÜK olanına göre).
  // Sayfanın oranı kutununkinden farklıysa bir kenarı ekran dışına taşabilir —
  // ortalanır (align/justify-content:center) ve pan/scroll ile ulaşılır.
  const ov = document.getElementById('reader-overlay');
  if(ov?.classList.contains('solve-mode')){
    const padY = styles ? parseFloat(styles.paddingTop || 0) + parseFloat(styles.paddingBottom || 0) : 0;
    const rawH = container?.clientHeight || 0;
    const viewportH = Math.max(280, (rawH > 0 ? rawH : window.innerHeight) - padY - 2);
    const baseH = viewportH / natural.height;
    return Math.max(0.35, Math.max(base, baseH) * zoomScale);
  }
  // Normal: genişliğe sığdır (fill-width)
  return Math.max(0.35, base * zoomScale);
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
  window.flushActiveTextEditing?.();
  const preserveScroll = !!appState._preserveScrollAfterRender;
  appState._preserveScrollAfterRender = false;
  if(appState.viewMode === 'scroll'){
    return renderAllPages().then(()=>{
      appState._renderedZoom = appState.zoom;
      if(!preserveScroll) setTimeout(()=>scrollToPage(appState.currentPage, 'auto'), 50);
    });
  } else {
    return renderSinglePageMode(appState.currentPage).then(()=>{
      appState._renderedZoom = appState.zoom;
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
  // Önce göster ki gerçek boyut ölçülebilsin (max-height:85vh + scroll ile sınırlı)
  menu.style.visibility = 'hidden';
  menu.style.display = 'block';
  const mw = menu.offsetWidth || 200;
  const mh = menu.offsetHeight || 180;
  const mx = Math.max(6, Math.min(x, window.innerWidth - mw - 6));
  const my = Math.max(6, Math.min(y, window.innerHeight - mh - 6));
  menu.style.left = mx + 'px';
  menu.style.top = my + 'px';
  menu.style.visibility = '';
}

function openViewModeMenu(e){
  e.stopPropagation();
  const menu = document.getElementById('pdfContextMenu');
  if(menu && menu.style.display === 'block'){
    menu.style.display = 'none';
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
  window.syncNavToPage?.(appState.currentPage);
  window.publishCanli?.();
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

function changeZoom(delta){
  const wrap = document.getElementById('readerCanvasWrap');
  const renderedZoom = appState._renderedZoom || appState.zoom;
  const viewportX = (wrap?.clientWidth || 0) / 2;
  const viewportY = (wrap?.clientHeight || 0) / 2;
  const contentX = (wrap?.scrollLeft || 0) + viewportX;
  const contentY = (wrap?.scrollTop || 0) + viewportY;
  appState.zoom = clampZoom(appState.zoom+delta);
  setZoomLabel(appState.zoom);
  const ratio = appState.zoom / renderedZoom;
  // Anlık görsel ölçek: render beklemeden zoom hissi (merkez = viewport ortası)
  if(wrap){ const rect = wrap.getBoundingClientRect(); applyStageScale(ratio, rect.left + viewportX, rect.top + viewportY); }
  scheduleCardZoomRender({ contentX, contentY, viewportX, viewportY, ratio });
}

async function runCardZoomSettle(wrap){
  const savedAnchor = appState._zoomAnchor;
  appState._zoomAnchor = null;
  const oldScrollBehavior = wrap.style.scrollBehavior;
  wrap.style.scrollBehavior = 'auto';
  appState._preserveScrollAfterRender = true;
  await Promise.resolve(renderPages());
  await new Promise(resolve => requestAnimationFrame(()=>{
    if(savedAnchor){
      wrap.scrollLeft = Math.max(0, savedAnchor.contentX * savedAnchor.ratio - savedAnchor.viewportX);
      wrap.scrollTop = Math.max(0, savedAnchor.contentY * savedAnchor.ratio - savedAnchor.viewportY);
    }
    wrap.style.scrollBehavior = oldScrollBehavior;
    wrap.classList.remove('zoom-settling');
    appState._zoomSettlingUntil = Date.now() + 250;
    resolve();
  }));
}

function scheduleCardZoomRender(anchor, delay = 90){
  const wrap = document.getElementById('readerCanvasWrap');
  if(!wrap) return;
  if(anchor) appState._zoomAnchor = anchor;
  clearTimeout(appState._zoomRenderTimer);
  wrap.classList.add('zoom-settling');
  appState._zoomSettlingUntil = Date.now() + delay + 700;
  appState._zoomRenderTimer = setTimeout(()=>{
    appState._zoomRenderTimer = null;
    runCardZoomSettle(wrap);
  }, delay);
}

// Bir sonraki pinch/pan jesti başlamadan HEMEN önce çağrılır. Önceki jestin
// gecikmeli "kaliteli render'a geçiş" ı (scheduleCardZoomRender) henüz
// tamamlanmadıysa, sahne (stage) elemanlarının genişlik/yükseklik/transform
// stilleri hâlâ ESKİ jestin BÜYÜTÜLMÜŞ halinde kalır. Yeni jest bu ŞİŞMİŞ
// boyutu "orijinal" sanıp üstüne kendi ölçeğini uygularsa, art arda birkaç
// pinch sonunda boyutlar katlanarak devasalaşıp tarayıcıyı kilitliyordu
// ("peş peşe 3-4 kez yapınca donuyor"). Bekleyen bir yerleşme varsa hemen
// (gecikmesiz) tamamlanır — yeni jest DAİMA temiz/gerçek ölçülerle başlar.
async function flushPendingCardZoomRender(){
  if(!appState._zoomRenderTimer) return;
  const wrap = document.getElementById('readerCanvasWrap');
  if(!wrap) return;
  clearTimeout(appState._zoomRenderTimer);
  appState._zoomRenderTimer = null;
  await runCardZoomSettle(wrap);
}

// Anlık görsel ölçek (transform) — render gelene kadar akıcı geri bildirim.
// scale: render edilen boyuta göre oran; cx,cy: client koordinatında zoom merkezi.
function applyStageScale(scale, cx, cy){
  const wrap = document.getElementById('readerCanvasWrap');
  if(!wrap) return;
  const stageNodes = [...wrap.querySelectorAll('.reader-page-stage')];
  const nodes = stageNodes.length ? stageNodes : [...wrap.querySelectorAll('[data-page-num]')];
  nodes.forEach(stage=>{
    const r = stage.getBoundingClientRect();
    stage.style.transformOrigin = `${cx - r.left}px ${cy - r.top}px`;
    stage.style.transform = `scale(${scale})`;
    stage.style.willChange = 'transform';
  });
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
      const rZoom = appState._renderedZoom || oldZoom;
      // Çarpımsal + deltaY büyüklüğüne duyarlı zoom (standart trackpad pinch hissi).
      appState.zoom = clampZoom(appState.zoom * Math.exp(-e.deltaY * ZOOM_WHEEL_SENS));
      if(Math.abs(appState.zoom - oldZoom) < 0.05) return;
      setZoomLabel(appState.zoom);
      const ratio = appState.zoom / rZoom;
      // İmleç-odaklı anlık görsel geri bildirim (render gelene kadar akıcı kalsın).
      applyStageScale(ratio, e.clientX, e.clientY);
      scheduleCardZoomRender({ contentX: relX, contentY: relY, viewportX, viewportY, ratio });
    }
  }, {passive:false});

  wrap.addEventListener('pointerdown', (e)=>{
    // Tek-parmak DOKUNMA pan'i initLongPressDraw() içindeki touchstart/touchmove
    // tarafından yönetiliyor (telefon, "Gez" aracı). PointerEvent'ler dokunmada
    // DA tetiklenir (touch/mouse/pen birleşik API) — iki ayrı dinleyici aynı
    // fiziksel sürüklemeye AYNI ANDA scrollLeft/scrollTop yazınca (biri diğerini
    // ezip tekrar ezilerek) pan hissi yavaş/takılı geliyordu. Burada SADECE
    // touch DIŞI (mouse sürükleme, kalem) pointer'ları devralırız.
    if(e.pointerType === 'touch') return;
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
  let rafId = null;   // bekleyen tek requestAnimationFrame
  let pending = null; // rAF'a kadar biriken EN SON dokunma verisi (ara kareler atlanır)

  function dist(a, b) { return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY); }
  function midpt(a, b) { return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }; }

  // CSS scale on rendered page contents for instant visual feedback.
  // rect0: jest BAŞINDA bir kez ölçülür; her karede getBoundingClientRect()
  // ÇAĞRILMAZ — o an yazdığımız scrollLeft/Top farkından ANALİTİK hesaplanır.
  // (touchmove içinde ölçüp-hemen-yazmak "layout thrashing" yaratıp pinch'i
  // titrek/takılı hissettiriyordu — asıl sorun buydu.)
  function getGestureTargets(wrapRect, visibleStageBuffer) {
    const stageNodes = [...wrap.querySelectorAll('.reader-page-stage')];
    const rawNodes = stageNodes.length ? stageNodes : [...wrap.querySelectorAll('[data-page-num]')];
    if(!rawNodes.length && wrap.firstElementChild) rawNodes.push(wrap.firstElementChild);

    return rawNodes
      .map(stage => {
        const directPage = stage.matches?.('[data-page-num],.pdf-page-wrap,.pdf-page-mock') ? stage : null;
        const page = stage.querySelector?.('.pdf-page-wrap,.pdf-page-mock,[data-page-num]') || directPage || stage.firstElementChild || stage;
        const rect0 = stage.getBoundingClientRect();
        const pageRect = page?.getBoundingClientRect?.() || rect0;
        stage.dataset.gestureW = stage.style.width || '';
        stage.dataset.gestureH = stage.style.height || '';
        stage.dataset.gestureJustify = stage.style.justifyContent || '';
        stage.dataset.gestureAlign = stage.style.alignItems || '';
        if(page){
          page.dataset.gestureTransform = page.style.transform || '';
          page.dataset.gestureTransformOrigin = page.style.transformOrigin || '';
          page.dataset.gestureWillChange = page.style.willChange || '';
        }
        return {
          stage,
          page,
          rect0,
          baseStageW: stage.offsetWidth || rect0.width,
          baseStageH: stage.offsetHeight || rect0.height,
          basePageW: page?.offsetWidth || pageRect.width,
          basePageH: page?.offsetHeight || pageRect.height
        };
      })
      .filter(({ rect0 }) => rect0.bottom >= wrapRect.top - visibleStageBuffer && rect0.top <= wrapRect.bottom + visibleStageBuffer);
  }
  function restoreGestureNode(stage) {
    if(!stage) return;
    const page = stage.querySelector?.('.pdf-page-wrap,.pdf-page-mock,[data-page-num]') || (stage.matches?.('[data-page-num],.pdf-page-wrap,.pdf-page-mock') ? stage : null);
    stage.style.justifyContent = stage.dataset.gestureJustify || '';
    stage.style.alignItems = stage.dataset.gestureAlign || '';
    if(Object.prototype.hasOwnProperty.call(stage.dataset, 'gestureW')) stage.style.width = stage.dataset.gestureW || '';
    if(Object.prototype.hasOwnProperty.call(stage.dataset, 'gestureH')) stage.style.height = stage.dataset.gestureH || '';
    delete stage.dataset.gestureW;
    delete stage.dataset.gestureH;
    delete stage.dataset.gestureJustify;
    delete stage.dataset.gestureAlign;
    [stage, page].filter(Boolean).forEach(el => {
      if(!Object.prototype.hasOwnProperty.call(el.dataset, 'gestureTransform')) return;
      el.style.transform = el.dataset.gestureTransform || '';
      el.style.transformOrigin = el.dataset.gestureTransformOrigin || '';
      el.style.willChange = el.dataset.gestureWillChange || '';
      delete el.dataset.gestureTransform;
      delete el.dataset.gestureTransformOrigin;
      delete el.dataset.gestureWillChange;
    });
  }
  // Sahne (stage) boyutu jest başında (beginGesture) BİR KEZ, ulaşılabilecek
  // en büyük ölçeğe göre ayarlanır — burada karede yalnız transform:scale
  // (GPU, layout'suz) değişir. width/height'a HİÇ dokunulmaz.
  function applyVisualScale(scale) {
    if (!g) return;
    g.stages.forEach(({ page }) => {
      if(!page) return;
      page.style.transformOrigin = '0 0';
      page.style.transform = `scale(${scale})`;
      page.style.willChange = 'transform';
    });
  }
  function clearVisualScale() {
    const nodes = new Set([
      ...wrap.querySelectorAll('.reader-page-stage'),
      ...wrap.querySelectorAll('[data-page-num]'),
    ]);
    nodes.forEach(restoreGestureNode);
  }
  function applyPendingGestureFrame() {
    if (!g || !pending) return;
    const { d, m } = pending;
    // Canlı jest sırasında da ZOOM_MIN/ZOOM_MAX ile sınırla — hem
    // beginGesture'da hesaplanan sahne üst sınırının hiç aşılmamasını
    // garantiler, hem de Preview'daki gibi sınırda "duran" (aşırı
    // büyüyüp release'te aniden geri zıplayan değil) bir his verir.
    const rawScale = d / g.startDist;
    const minScale = ZOOM_MIN / g.startZoom, maxScale = ZOOM_MAX / g.startZoom;
    g.scale = Math.max(minScale, Math.min(maxScale, rawScale));
    const visualScale = g.visualBaseScale * g.scale;
    // wrap'in kendi ekran konumu/boyutu jest sırasında değişmez (yalnız
    // içeriği kaydırılır) — jest başında BİR KEZ ölçülen startWrapRect
    // yeniden kullanılır. Her karede getBoundingClientRect() çağırmak,
    // önceki karenin scrollLeft/Top yazmalarını senkron layout'a zorlayıp
    // pinch'i "ağır/titrek" hissettiriyordu (layout thrashing).
    const rect = g.startWrapRect;
    const viewportX = m.x - rect.left;
    const viewportY = m.y - rect.top;
    const scaleRatio = visualScale / g.visualBaseScale;
    wrap.scrollLeft = Math.max(0, g.anchorContentX * scaleRatio - viewportX);
    wrap.scrollTop = Math.max(0, g.anchorContentY * scaleRatio - viewportY);
    applyVisualScale(visualScale);
    g.lastMid = m;
    g.lastDist = d;
    pending = null;
  }

  const FLICK_MAX_MS = 500, FLICK_MIN = 70;

  // Yeni jestin başlangıç durumunu kurar (t0/t1 düz {x,y} nesneleridir —
  // ham Touch nesnesi değil, çünkü flushPendingCardZoomRender'ın await'i
  // sırasında olay bittiği için Touch referansına güvenmek riskli olurdu).
  function beginGesture(p0, p1){
    // Kart zoom'lanmışsa (kaydıracak fazla içerik var) 2-parmak hareketi SADECE
    // pan'dir, sayfa-geçişi flick'i sanmayalım (bkz. tek-parmak eşdeğeri).
    const scrollable = (wrap.scrollWidth > wrap.clientWidth + 1) || (wrap.scrollHeight > wrap.clientHeight + 1);
    const wrapRect = wrap.getBoundingClientRect();
    const visibleStageBuffer = Math.max(320, wrapRect.height * 0.75);
    const stages = getGestureTargets(wrapRect, visibleStageBuffer);
    const renderedZoom = appState._renderedZoom || appState.zoom || 100;
    const startMid = midpt(p0, p1);
    const startDist = dist(p0, p1);
    // Jest boyunca sahne (stage) boyutu BİR KEZ, ulaşılabilecek EN BÜYÜK
    // ölçeğe (ZOOM_MAX) göre hesaplanıp sabitlenir — her karede width/height
    // YAZMAK (applyVisualScale eskiden böyleydi) senkron layout'a zorlayıp
    // pinch'i "ağır/titrek" hissettiriyordu. Artık karede yalnız
    // transform:scale (GPU, layout'suz) değişiyor. applyPendingGestureFrame
    // canlı ölçeği de ZOOM_MAX ile sınırladığından bu üst sınır asla aşılmaz.
    const maxReachableScale = ZOOM_MAX / renderedZoom;
    stages.forEach(s => {
      s.stage.style.width = Math.ceil(Math.max(wrap.clientWidth, s.basePageW * maxReachableScale + 32, s.baseStageW)) + 'px';
      s.stage.style.height = Math.ceil(Math.max(wrap.clientHeight, s.basePageH * maxReachableScale + 32, s.baseStageH)) + 'px';
      s.stage.style.justifyContent = 'flex-start';
      s.stage.style.alignItems = 'flex-start';
    });
    g = {
      startDist,
      startZoom: appState.zoom,
      visualBaseScale: appState.zoom / renderedZoom,
      startMid,
      lastMid: startMid,
      startWrapRect: wrapRect,
      anchorContentX: wrap.scrollLeft + (startMid.x - wrapRect.left),
      anchorContentY: wrap.scrollTop + (startMid.y - wrapRect.top),
      lastDist: startDist,
      scale: 1,
      startTime: Date.now(),
      scrollable,
      startScrollLeft: wrap.scrollLeft,
      startScrollTop: wrap.scrollTop,
      viewportW: wrap.clientWidth,
      viewportH: wrap.clientHeight,
      stages,
    };
  }

  wrap.addEventListener('touchstart', e => {
    if (e.touches.length >= 2) {
      e.preventDefault();
      e.stopPropagation();
      appState._touchGestureActive = true;
      g = null; // önceki jest hâlâ kurulu olmasın diye (flush sırasında touchmove gelmesin)
      const p0 = { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
      const p1 = { clientX: e.touches[1].clientX, clientY: e.touches[1].clientY };
      if(appState._zoomRenderTimer){
        flushPendingCardZoomRender().then(() => beginGesture(p0, p1));
      } else {
        beginGesture(p0, p1);
      }
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
    // Ham veriyi hemen KAYDET, DOM'a hemen YAZMA — ekranın çizim hızına
    // (requestAnimationFrame) senkron, karede en fazla BİR kez uygula.
    // Aradaki touchmove'lar (ekran hızından daha sık gelebiliyor) atlanır,
    // her zaman EN SON konum kullanılır → titreme/takılma kalmaz.
    pending = { d: dist(t0, t1), m: midpt(t0, t1) };
    if (rafId == null) {
      rafId = requestAnimationFrame(() => {
        rafId = null;
        applyPendingGestureFrame();
      });
    }
  }, { passive: false, capture: true });

  const commitGesture = e => {
    if (!g) return;
    if (e.touches.length >= 2) return; // hâlâ 2 parmak
    if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
    applyPendingGestureFrame();

    const newZoom = clampZoom(g.startZoom * g.scale);
    const wrapRect = g.startWrapRect;
    const zoomChanged = Math.abs(newZoom - g.startZoom) >= 2;

    if (zoomChanged) {
      // ÖNEMLİ: jestin BAŞLADIĞI değil BIRAKILDIĞI (g.lastMid) parmak konumu
      // esas alınır. Kullanıcı pinch sırasında aynı zamanda kaydırıp (pan)
      // sayfayı istediği yere getirebiliyor — g.startMid kullanmak, render
      // sonrası görünümü jestin BAŞLANGIÇ noktasına geri "fırlatıyor" ve
      // kullanıcının bırakırken bıraktığı konumu bozuyordu.
      const contentX = g.anchorContentX;
      const contentY = g.anchorContentY;
      appState.zoom = newZoom;
      setZoomLabel(newZoom);
      scheduleCardZoomRender({
        contentX,
        contentY,
        viewportX: g.lastMid.x - wrapRect.left,
        viewportY: g.lastMid.y - wrapRect.top,
        ratio: newZoom / (appState._renderedZoom || g.startZoom),
      }, 650);
    } else if (!g.scrollable) {
      // Pinch değil (zum ~sabit) ve zum'lanmamış → hızlı/uzun 2-parmak sürükleme
      // = sayfa geçişi flick'i (eskiden yalnız ✋ Gez aracında vardı; Gez artık
      // ayrı bir araç olmadığından bu jest 2 parmağa taşındı).
      const dx = g.lastMid.x - g.startMid.x, dy = g.lastMid.y - g.startMid.y;
      const dur = Date.now() - g.startTime;
      if (dur < FLICK_MAX_MS && Math.max(Math.abs(dx), Math.abs(dy)) > FLICK_MIN) {
        const dir = (Math.abs(dx) >= Math.abs(dy)) ? (dx < 0 ? 1 : -1) : (dy < 0 ? 1 : -1);
        window.changePage?.(dir);
      }
    }
    if(!zoomChanged) clearVisualScale();
    g = null;
    setTimeout(()=>{ appState._touchGestureActive = false; }, zoomChanged ? 700 : 120);
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

  // Not: Çizim koordinatı patchGetPointer (canvas.js) ile her olayda canlı
  // getBoundingClientRect'ten hesaplanıyor; offset tazeleme/calcOffset gerekmez.

  // ── GEÇİCİ TANI KATMANI (window.__DRAW_DEBUG) ────────────────────────────
  // Parmağın clientX/clientY'sine FIXED kırmızı nokta + canlı sayısal HUD.
  // Nokta parmağın altındaysa: sorun canvas eşlemesinde. Değilse: iOS dokunma
  // koordinat sistemi (visual≠layout viewport). Tanı bitince kaldırılacak.
  if(window.__DRAW_DEBUG){
    let dot = document.getElementById('__dbgDot');
    if(!dot){
      dot = document.createElement('div');
      dot.id = '__dbgDot';
      // YEŞİL nokta = parmağın ham konumu (referans). Taze çizgi tam bunun altında olmalı.
      dot.style.cssText = 'position:fixed;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;background:rgba(0,200,0,.4);border:2px solid #fff;box-shadow:0 0 0 1px #000;z-index:99999;pointer-events:none;left:-99px;top:-99px';
      document.body.appendChild(dot);
      const hud = document.createElement('div');
      hud.id = '__dbgHud';
      hud.style.cssText = 'position:fixed;left:4px;top:4px;z-index:99999;background:rgba(0,0,0,.8);color:#0f0;font:11px/1.35 monospace;padding:5px 7px;border-radius:6px;pointer-events:none;white-space:pre';
      document.body.appendChild(hud);
    }
    const dbg = e => {
      const t = e.touches && e.touches[0]; if(!t) return;
      const vv = window.visualViewport;
      dot.style.left = t.clientX + 'px';
      dot.style.top  = t.clientY + 'px';
      document.getElementById('__dbgHud').textContent =
        `vvTop:${vv?(vv.offsetTop|0):'-'} vvLeft:${vv?(vv.offsetLeft|0):'-'}\n` +
        `Temizle(🧹)→taze çiz: çizgi YEŞİL altında mı?`;
    };
    wrap.addEventListener('touchstart', dbg, { passive:true, capture:true });
    wrap.addEventListener('touchmove',  dbg, { passive:true, capture:true });
  }

  const MOVE_THRESHOLD = 8;   // px — jest başladı eşiği
  const MENU_HOLD = 1000;     // 1sn sabit basış → Görünüm Modu menüsü
  const FLICK_MAX_MS = 500;   // bu süreden hızlı + uzun kaydırma = flick (sayfa geçişi)
  const FLICK_MIN = 70;       // flick için min mesafe
  let s = null; // gesture state

  // TABLET: parmakla yazma yok (Apple Pencil/kalemle yazılıyor) → tek parmak
  // HER ZAMAN pan+flick'tir, hangi çizim aracı seçili olursa olsun (Önizleme/
  // GoodNotes'taki gibi). Kalem (stylus) her zaman çizer, aşağıdaki stylus
  // kontrolüyle bu jest devralımından hariç tutulur.
  // TELEFON: stylus nadir olduğundan mevcut davranış korunur — parmak yalnız
  // 'select' (artık görünmeyen, ama üst toolbar'dan erişilebilen) modda pan
  // yapar; diğer araçlarda Fabric'in KENDİ dokunma motoru çizer.
  // 2 parmak → pinch zoom (initTouchGestures), her iki cihazda da geçerli.
  wrap.addEventListener('touchstart', e => {
    if(e.touches.length !== 1){ if(s){ clearTimeout(s.menuTimer); s = null; } return; }
    const t = e.touches[0];
    if(t.touchType === 'stylus') return;   // kalem → Fabric native çizim, her zaman
    if(!isTabletDevice() && appState.drawTool !== 'select') return;   // telefon + çizim aracı → Fabric native
    e.preventDefault(); e.stopPropagation();
    appState._touchGestureActive = true;
    // Kart zoom'lanmış (kaydırılacak fazla içerik var) → bu jest SADECE pan'dir,
    // hızlı/uzun sürüklemeyi sayfa-geçişi flick'i sanmayalım (yoksa zum'da belirli
    // bir noktaya yaklaşmaya çalışırken sayfa değişiverir). Flick sadece %100/sığdır
    // zumda (kaydıracak içerik yokken) sayfa geçişi anlamına gelir.
    const scrollable = (wrap.scrollWidth > wrap.clientWidth + 1) || (wrap.scrollHeight > wrap.clientHeight + 1);
    s = { x0:t.clientX, y0:t.clientY, lastX:t.clientX, lastY:t.clientY,
          sl:wrap.scrollLeft, st:wrap.scrollTop, t0:Date.now(), mode:'pending', menuTimer:null, scrollable };
    s.menuTimer = setTimeout(()=>{
      if(!s || s.mode !== 'pending') return;
      s.mode = 'menu';
      window.showContextMenu?.(s.x0, s.y0);
      navigator.vibrate?.(15);
    }, MENU_HOLD);
  }, { passive:false, capture:true });

  wrap.addEventListener('touchmove', e => {
    if(!s || e.touches.length !== 1) return;
    e.preventDefault(); e.stopPropagation();
    const t = e.touches[0];
    s.lastX = t.clientX; s.lastY = t.clientY;
    if(s.mode === 'pending' && Math.hypot(t.clientX - s.x0, t.clientY - s.y0) > MOVE_THRESHOLD){
      clearTimeout(s.menuTimer); s.mode = 'pan';
    }
    if(s.mode === 'pan'){
      wrap.scrollLeft = s.sl - (t.clientX - s.x0);
      wrap.scrollTop  = s.st - (t.clientY - s.y0);
    }
  }, { passive:false, capture:true });

  const onEnd = ()=>{
    if(!s) return;
    clearTimeout(s.menuTimer);
    // Sol/yukarı flick → sonraki sayfa, sağ/aşağı → önceki (changePage tüm PDF'te serbest)
    // Yalnız zum'lanmamışken (kaydıracak içerik yokken) — zum'da flick sadece pan'dir.
    if(s.mode === 'pan' && !s.scrollable){
      const dx = s.lastX - s.x0, dy = s.lastY - s.y0, dur = Date.now() - s.t0;
      if(dur < FLICK_MAX_MS && Math.max(Math.abs(dx), Math.abs(dy)) > FLICK_MIN){
        const dir = (Math.abs(dx) >= Math.abs(dy)) ? (dx < 0 ? 1 : -1) : (dy < 0 ? 1 : -1);
        window.changePage?.(dir);
      }
    }
    s = null; appState._touchGestureActive = false;
  };
  wrap.addEventListener('touchend',    onEnd, { passive:false, capture:true });
  wrap.addEventListener('touchcancel', onEnd, { passive:false, capture:true });
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
window.applyStageScale = applyStageScale;
window.scheduleCardZoomRender = scheduleCardZoomRender;
window.initCardZoomPan = initCardZoomPan;
