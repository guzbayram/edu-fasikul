import { appState } from '../state/appState.js';

// ══════════════════════════════════════════════════════════
// TELEFON: Tam ekran ÇÖZÜM MODU
// Karta çift dokun → PDF tüm ekranı kaplar; yüzer/sürüklenebilir
// araç paleti (kalem/silgi/renkler · A–E · kopyala) ile çözülür.
// ══════════════════════════════════════════════════════════

function isPhone(){
  return window.matchMedia('(orientation:portrait)').matches && window.innerWidth <= 820;
}

// Canvas alanını paletin boyutu kadar içeriden başlat → PDF palete kadar büyür,
// altında gizlenmez/kesilmez (yatay: soldan, dikey: üstten).
function fitCanvasToPalette(){
  const ov = document.getElementById('reader-overlay');
  const pal = document.getElementById('solvePalette');
  const wrap = document.getElementById('readerCanvasWrap');
  if(!wrap) return;
  if(!ov?.classList.contains('solve-mode') || !pal){
    ['padding-left','padding-top','padding-right','padding-bottom'].forEach(k=>wrap.style.removeProperty(k));
    return;
  }
  const r = pal.getBoundingClientRect();
  const portrait = window.matchMedia('(orientation:portrait)').matches;
  const G = 16; // standart boşluk (palet + ekran kenarları)
  const set = (k,v)=>wrap.style.setProperty(k, v, 'important'); // landscape CSS padding'i ez
  set('padding-right',  G + 'px');
  set('padding-bottom', G + 'px');
  if(portrait){ set('padding-top', (r.height + G) + 'px'); set('padding-left', G + 'px'); }
  else        { set('padding-left', (r.width + G) + 'px'); set('padding-top', G + 'px'); }
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
  renderSolveAnswers();
  // Tam ekrana girince varsayılan: ✋ Gez (pan/zoom/soru geçişi anında çalışsın)
  const gez = document.querySelector('.solve-palette [data-tool="select"]');
  if(gez && window.setTool) window.setTool(gez, 'select');
  // Palet ölçülüp canvas ona göre konumlansın, sonra PDF yeniden render/sığsın
  setTimeout(reflowSolve, 60);
}
function exitSolveMode(){
  document.getElementById('reader-overlay')?.classList.remove('solve-mode');
  const wrap = document.getElementById('readerCanvasWrap');
  if(wrap){ ['padding-left','padding-top','padding-right','padding-bottom'].forEach(k=>wrap.style.removeProperty(k)); }
  setTimeout(()=>{ try{ window.dispatchEvent(new Event('resize')); }catch(_e){} }, 60);
}
window.addEventListener('resize', ()=>{ if(document.getElementById('reader-overlay')?.classList.contains('solve-mode')) fitCanvasToPalette(); });
window.addEventListener('orientationchange', ()=>{ setTimeout(reflowSolve, 200); });
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
  wrap.innerHTML = ['A','B','C','D','E'].map(opt=>{
    let cls = 'sp-ans';
    if(answered){
      if(opt === s.cevap) cls += ' correct-ans';
      else if(opt === state?.selected) cls += ' wrong-ans';
    }
    return `<button class="${cls}" onclick="selectAnswer('${s._uid || s.no}','${opt}','${s.cevap}',${idx})" ${answered?'disabled':''}>${opt}</button>`;
  }).join('');
}

// Yüzer paleti sürükle (tutamaçtan)
function initSolvePaletteDrag(){
  const pal = document.getElementById('solvePalette');
  const handle = document.getElementById('spHandle');
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

// Görünüm Modu menüsü: telefonda 1sn sabit basışla açılır (initLongPressDraw içinde).
// Burada yalnız masaüstü çift-tık desteklenir (yazarken kazara açılmasın diye dokunmada yok).
function initSolveDoubleTap(){
  const wrap = document.getElementById('readerCanvasWrap');
  if(!wrap || wrap.dataset.solveDtReady) return;
  wrap.dataset.solveDtReady = '1';
  wrap.addEventListener('dblclick', e=>{ window.showContextMenu?.(e.clientX, e.clientY); });
}

window.enterSolveMode = enterSolveMode;
window.exitSolveMode = exitSolveMode;
window.toggleSolveMode = toggleSolveMode;
window.renderSolveAnswers = renderSolveAnswers;

document.addEventListener('DOMContentLoaded', ()=>{ initSolvePaletteDrag(); initSolveDoubleTap(); });
