import { appState } from '../state/appState.js';

// ══════════════════════════════════════════════════════════
// TELEFON: Tam ekran ÇÖZÜM MODU
// Karta çift dokun → PDF tüm ekranı kaplar; yüzer/sürüklenebilir
// araç paleti (kalem/silgi/renkler · A–E · kopyala) ile çözülür.
// ══════════════════════════════════════════════════════════

function isPhone(){
  return window.matchMedia('(orientation:portrait)').matches && window.innerWidth <= 820;
}

function enterSolveMode(){
  const ov = document.getElementById('reader-overlay');
  if(!ov || !ov.classList.contains('open')) return;
  ov.classList.add('solve-mode');
  renderSolveAnswers();
  // PDF'in yeni alana göre yeniden boyutlanması için
  setTimeout(()=>{ try{ window.dispatchEvent(new Event('resize')); }catch(_e){} }, 60);
}
function exitSolveMode(){
  document.getElementById('reader-overlay')?.classList.remove('solve-mode');
  setTimeout(()=>{ try{ window.dispatchEvent(new Event('resize')); }catch(_e){} }, 60);
}
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
