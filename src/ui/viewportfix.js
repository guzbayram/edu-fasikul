// ══════════════════════════════════════════════════════════
// iOS Safari viewport fix: adres çubuğu yüzünden görünür viewport,
// layout viewport'tan kısa olunca position:fixed reader-overlay görünürden
// uzun kalıyor; içerik dağılınca dokunma noktası ~bir satır yukarı kayıyor.
// Overlay'i visualViewport KONUMUNA (top/left) oturturuz — BOYUTU (height/
// width) KASITLI OLARAK vv.height/width'e SABİTLEMEYİZ: bazı cihazlarda
// (ör. iPhone Pro Max, negatif visualViewport.offsetTop) vv.height, CSS'in
// kendi doğal inset:0 boyutlandırmasından (right:0;bottom:0 → containing
// block'u tam doldurur) DAHA KISA/DAR olabiliyor ve bu da altta/sağda gri
// boşluk YARATIYORDU (çözmek yerine). Ayrıca panel/palet artık position:
// static (gerçek flex çocuğu, bkz. .solve-left-col/.reader-right) olduğundan
// dokunma-hedefi kayması sorunu zaten kökten çözüldü — bu fonksiyonun asıl
// işi artık yalnızca konum (offset) telafisi, boyut değil.
// (Kesin çözüm: Ana Ekrana Ekle → standalone; o zaman bu zaten devreye girmez.)
// ══════════════════════════════════════════════════════════
function syncReaderViewport(){
  const vv = window.visualViewport;
  const ov = document.getElementById('reader-overlay');
  if(!vv || !ov || !ov.classList.contains('open')) return;
  ov.style.removeProperty('height');
  ov.style.removeProperty('width');
  // iPhone Pro Max'te visualViewport.offsetTop NEGATİF olabiliyor (bilinen tuhaflık,
  // bkz. yatay-cizim-kaymasi belleği). Negatif değeri OLDUĞU GİBİ top'a yazmak kutuyu
  // yukarı/ekran DIŞINA kaydırıp panelin üst satırını (pan/kalem/marker) ve PDF'in üst
  // satırını kırpıyordu. 0'ın altına asla inmeyiz — yalnızca GERÇEKTEN aşağı kaymış
  // (offsetTop>0) durumları telafi ederiz.
  ov.style.top  = Math.max(0, vv.offsetTop) + 'px';
  ov.style.left = Math.max(0, vv.offsetLeft) + 'px';
}
function reflowReaderViewport(){
  syncReaderViewport();
  try{ window.renderPages?.(); }catch(_e){}
}
// Sabit gecikmeler ([0,80,180,360,700]) yerine: gerçek cihazda Safari araç çubuğu
// animasyonu ne kadar sürerse sürsün YAKALAMAK için visualViewport boyutunu kısa
// aralıklarla izleriz — DEĞİŞTİĞİ her an yeniden hizala/render et, birkaç ardışık
// kontrolde DEĞİŞMEYİNCE dur. (Masaüstü Safari "Hassas Tasarım Modu"nda araç çubuğu
// animasyonu YOK → sabit gecikmeler orada hep yetiyordu; gerçek cihazda animasyon
// daha uzun sürebiliyor, sabit son gecikmeden SONRA da boyut değişmeye devam edip
// PDF eski/küçük boyutta kalıyor, dışında gri boşluk kalıyordu.)
let _viewportWatchTimer = null;
function watchReaderViewportSettle(maxMs = 3000){
  if(_viewportWatchTimer) clearInterval(_viewportWatchTimer);
  let lastH = -1, lastW = -1, stableCount = 0;
  const start = Date.now();
  _viewportWatchTimer = setInterval(()=>{
    const ov = document.getElementById('reader-overlay');
    const vv = window.visualViewport;
    if(!ov || !ov.classList.contains('open') || !vv){
      clearInterval(_viewportWatchTimer); _viewportWatchTimer = null; return;
    }
    const h = Math.round(vv.height), w = Math.round(vv.width);
    if(h !== lastH || w !== lastW){
      lastH = h; lastW = w; stableCount = 0;
      reflowReaderViewport();
    } else {
      stableCount++;
    }
    if(stableCount >= 3 || Date.now() - start > maxMs){
      clearInterval(_viewportWatchTimer); _viewportWatchTimer = null;
    }
  }, 120);
}
function scheduleReaderViewportReflow(){
  if(!document.getElementById('reader-overlay')?.classList.contains('open')) return;
  reflowReaderViewport();
  watchReaderViewportSettle();
}
function clearReaderViewport(){
  const ov = document.getElementById('reader-overlay');
  if(ov){ ov.style.removeProperty('height'); ov.style.removeProperty('width'); ov.style.removeProperty('top'); ov.style.removeProperty('left'); }
  if(_viewportWatchTimer){ clearInterval(_viewportWatchTimer); _viewportWatchTimer = null; }
}
window.syncReaderViewport = syncReaderViewport;
window.scheduleReaderViewportReflow = scheduleReaderViewportReflow;
window.clearReaderViewport = clearReaderViewport;

if(window.visualViewport){
  window.visualViewport.addEventListener('resize', scheduleReaderViewportReflow);
  window.visualViewport.addEventListener('scroll', syncReaderViewport);
}
window.addEventListener('resize', scheduleReaderViewportReflow);
window.addEventListener('orientationchange', scheduleReaderViewportReflow);
document.addEventListener('fullscreenchange', scheduleReaderViewportReflow);
document.addEventListener('webkitfullscreenchange', scheduleReaderViewportReflow);
document.addEventListener('mozfullscreenchange', scheduleReaderViewportReflow);
