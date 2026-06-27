import { appState } from '../state/appState.js';

// ══════════════════════════════════════════════════════════
// TELEFON: Tam ekran ÇÖZÜM MODU
// Karta çift dokun → PDF tüm ekranı kaplar; yüzer/sürüklenebilir
// araç paleti (kalem/silgi/renkler · A–E · kopyala) ile çözülür.
// ══════════════════════════════════════════════════════════

// Canvas alanını paletin boyutu kadar içeriden başlat → PDF palete kadar büyür,
// altında gizlenmez/kesilmez (yatay: soldan, dikey: üstten).
function fitCanvasToPalette(){
  const ov = document.getElementById('reader-overlay');
  const wrap = document.getElementById('readerCanvasWrap');
  const panel = document.getElementById('solvePalette');  // sabit kenar panel
  if(!wrap) return;
  if(!ov?.classList.contains('solve-mode')){
    ['padding-left','padding-top','padding-right','padding-bottom'].forEach(k=>wrap.style.removeProperty(k));
    return;
  }
  // Sabit panel kadar offset → kart panelin hemen yanında/altında (boşluksuz), ORTALI.
  const G = 2;
  const portrait = window.matchMedia('(orientation:portrait)').matches;
  const pr = panel ? panel.getBoundingClientRect() : {width:0, height:0};
  const set = (k,v)=>wrap.style.setProperty(k, v, 'important');
  set('padding-right', G+'px'); set('padding-bottom', G+'px');
  if(portrait){ set('padding-top', (Math.round(pr.height)+G)+'px'); set('padding-left', G+'px'); }
  else        { set('padding-left', (Math.round(pr.width)+G)+'px'); set('padding-top', G+'px'); }
  // Alt zoom çubuğu, sol panelden sonraki KALAN genişlikte ortalansın (yatayda)
  document.documentElement.style.setProperty('--sp-panel-w', (portrait ? 0 : Math.round(pr.width)) + 'px');
}
function reflowSolve(){
  fitCanvasToPalette();
  // Padding değişti → PDF yeni alana sığacak şekilde yeniden render
  try{ window.dispatchEvent(new Event('resize')); }catch(_e){}
  setTimeout(()=>{ try{ window.renderPages?.(); }catch(_e){} }, 90);
}
function enterSolveMode(){
  const ov = document.getElementById('reader-overlay');
  if(!ov || !ov.classList.contains('open')) return;
  ov.classList.add('solve-mode');
  // Kart kalan alanı doldursun: zoom %100 → getReaderFitScale (solve) contain ile en büyük
  appState.zoom = 100; appState._fillBaseZoom = null; window.setZoomLabel?.(100);
  renderSolveAnswers();
  // Tam ekrana girince varsayılan: ✋ Gez (pan/zoom/soru geçişi anında çalışsın)
  const gez = document.querySelector('.solve-palette [data-tool="select"]');
  if(gez && window.setTool) window.setTool(gez, 'select');
  // Palet ölçülüp canvas ona göre konumlansın, sonra PDF yeniden render/sığsın
  setTimeout(reflowSolve, 60);
}
function exitSolveMode(){
  // Cep telefonu YATAY modda sadece tam ekran var → çıkış reader'ı tamamen kapatır
  if(isPhoneLandscape()){ window.closeReader?.(); return; }
  document.getElementById('reader-overlay')?.classList.remove('solve-mode');
  const wrap = document.getElementById('readerCanvasWrap');
  if(wrap){ ['padding-left','padding-top','padding-right','padding-bottom'].forEach(k=>wrap.style.removeProperty(k)); }
  setTimeout(()=>{ try{ window.dispatchEvent(new Event('resize')); }catch(_e){} }, 60);
}

// Cep telefonu yatay modu (kısa yükseklik) → tam ekran zorunlu
function isPhoneLandscape(){
  return window.matchMedia('(orientation:landscape) and (max-height:500px)').matches;
}
// Yatayda reader açıksa otomatik tam ekran (solve) moduna geç
function autoSolveForLandscape(){
  const ov = document.getElementById('reader-overlay');
  if(!ov || !ov.classList.contains('open')) return;
  if(isPhoneLandscape() && !ov.classList.contains('solve-mode')) enterSolveMode();
}
window.autoSolveForLandscape = autoSolveForLandscape;

window.addEventListener('resize', ()=>{
  autoSolveForLandscape();
  if(document.getElementById('reader-overlay')?.classList.contains('solve-mode')) fitCanvasToPalette();
});
window.addEventListener('orientationchange', ()=>{ setTimeout(()=>{ autoSolveForLandscape(); reflowSolve(); }, 200); });
function toggleSolveMode(){
  const ov = document.getElementById('reader-overlay');
  if(!ov) return;
  ov.classList.contains('solve-mode') ? exitSolveMode() : enterSolveMode();
}

// Palet A–E cevap butonlarını güncel soruya göre çiz
function renderSolveAnswers(){
  const wrap = document.getElementById('spAnswers');
  if(!wrap) return;
  const alt = appState.aktifAltKonu;
  const idx = appState.activeQuestionIdx;
  const s = (alt?.sorular || [])[idx];
  const isKonu = window.isKonuKartSoru?.(s) || window.isKonuKartAltKonu?.(alt);
  if(!s || isKonu){ wrap.innerHTML = ''; return; }
  const state = appState.sorularState[s._uid || s.no];
  const answered = !!state?.answered;
  // Şıkların başına soru no
  const noHtml = `<span class="sp-no">S.${s.no}</span>`;
  wrap.innerHTML = noHtml + ['A','B','C','D','E'].map(opt=>{
    let cls = 'sp-ans';
    if(answered){
      if(opt === s.cevap) cls += ' correct-ans';
      else if(opt === state?.selected) cls += ' wrong-ans';
    }
    return `<button class="${cls}" onclick="selectAnswer('${s._uid || s.no}','${opt}','${s.cevap}',${idx})" ${answered?'disabled':''}>${opt}</button>`;
  }).join('');
}

// Yüzer paleti sürükle (tutamaçtan) — birden çok palet için genel
function makeDraggable(palId, handleId){
  const pal = document.getElementById(palId);
  const handle = document.getElementById(handleId);
  if(!pal || !handle || handle.dataset.dragReady) return;
  handle.dataset.dragReady = '1';
  let sx=0, sy=0, ox=0, oy=0, dragging=false;
  const start = (x,y)=>{
    dragging = true;
    sx = x; sy = y;
    const r = pal.getBoundingClientRect();
    ox = r.left; oy = r.top;
    pal.style.transform = 'none';
    pal.classList.add('dragging');
  };
  const move = (x,y)=>{
    if(!dragging) return;
    let nx = ox + (x - sx), ny = oy + (y - sy);
    nx = Math.max(4, Math.min(window.innerWidth  - pal.offsetWidth  - 4, nx));
    ny = Math.max(4, Math.min(window.innerHeight - pal.offsetHeight - 4, ny));
    pal.style.left = nx + 'px'; pal.style.top = ny + 'px';
    pal.style.right = 'auto'; pal.style.bottom = 'auto';
  };
  const end = ()=>{ dragging = false; pal.classList.remove('dragging'); };
  handle.addEventListener('pointerdown', e=>{ e.preventDefault(); handle.setPointerCapture?.(e.pointerId); start(e.clientX, e.clientY); });
  handle.addEventListener('pointermove', e=>{ if(dragging){ e.preventDefault(); move(e.clientX, e.clientY); } });
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}
// Köşeden boyutlandır → pencere genişliği değişir, butonlar flex-wrap ile yeniden dizilir
function makeResizable(palId){
  const pal = document.getElementById(palId);
  const grip = pal?.querySelector('.sp-resize');
  if(!pal || !grip || grip.dataset.rzReady) return;
  grip.dataset.rzReady = '1';
  let sx=0, sw=0, rz=false;
  const start = x => { rz=true; sx=x; sw=pal.getBoundingClientRect().width; };
  const move  = x => { if(!rz) return; pal.style.width = Math.max(92, Math.min(window.innerWidth-20, sw + (x-sx))) + 'px'; };
  const end   = () => { rz=false; };
  grip.addEventListener('pointerdown', e=>{ e.preventDefault(); e.stopPropagation(); grip.setPointerCapture?.(e.pointerId); start(e.clientX); });
  grip.addEventListener('pointermove', e=>{ if(rz){ e.preventDefault(); move(e.clientX); } });
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}
function initSolvePaletteDrag(){
  makeDraggable('solvePalette', 'spHandle');
  makeDraggable('solveToolPalette', 'spToolHandle');
  makeResizable('solvePalette');
  makeResizable('solveToolPalette');
}

// Görünüm Modu menüsü: telefonda 1sn sabit basışla açılır (initLongPressDraw içinde).
// Burada yalnız masaüstü çift-tık desteklenir (yazarken kazara açılmasın diye dokunmada yok).
// Karta çift dokun → kartı alana DOLDUR (cover); tekrar çift dokun → eski hâle
function toggleCardFill(){
  const wrap = document.getElementById('readerCanvasWrap');
  const pw = wrap?.querySelector('[id^="page-wrap-"]');
  if(!wrap || !pw) return;
  const cs = getComputedStyle(wrap);
  const availW = wrap.clientWidth  - parseFloat(cs.paddingLeft||0) - parseFloat(cs.paddingRight||0);
  const availH = wrap.clientHeight - parseFloat(cs.paddingTop||0)  - parseFloat(cs.paddingBottom||0);
  const r = pw.getBoundingClientRect();
  if(!appState._fillBaseZoom){
    // Genişliğe sığdır: kartın sol/sağ kenarları alanın sol/sağ kenarıyla çakışsın
    const factor = availW / r.width;
    if(Math.abs(factor - 1) > 0.02){
      appState._fillBaseZoom = appState.zoom;
      appState.zoom = Math.max(40, Math.min(200, Math.round(appState.zoom * factor)));
    }
  } else {
    appState.zoom = appState._fillBaseZoom; appState._fillBaseZoom = null;
  }
  window.setZoomLabel?.(appState.zoom);
  window.renderPages?.();
}
window.toggleCardFill = toggleCardFill;

function initSolveDoubleTap(){
  const wrap = document.getElementById('readerCanvasWrap');
  if(!wrap || wrap.dataset.solveDtReady) return;
  wrap.dataset.solveDtReady = '1';
  // Masaüstü çift tık + dokunmatik çift dokunma → kartı alana doldur
  wrap.addEventListener('dblclick', ()=> toggleCardFill());
  let lastTap = 0, lx = 0, ly = 0;
  wrap.addEventListener('touchend', e=>{
    if(e.changedTouches.length !== 1) return;
    const t = e.changedTouches[0], now = Date.now();
    if(now - lastTap < 300 && Math.hypot(t.clientX - lx, t.clientY - ly) < 30){
      lastTap = 0; toggleCardFill();
    } else { lastTap = now; lx = t.clientX; ly = t.clientY; }
  }, { passive:true });
}

window.enterSolveMode = enterSolveMode;
window.exitSolveMode = exitSolveMode;
window.toggleSolveMode = toggleSolveMode;
window.renderSolveAnswers = renderSolveAnswers;

document.addEventListener('DOMContentLoaded', ()=>{ initSolvePaletteDrag(); initSolveDoubleTap(); });
