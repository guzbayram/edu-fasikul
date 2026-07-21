import { appState } from '../state/appState.js';

function toggleReaderPanel(side){
  if(side==='left'){
    window.toggleRpKonuSection?.();
  } else {
    document.getElementById('readerRight').classList.toggle('collapsed');
  }
  if(document.getElementById('reader-overlay')?.classList.contains('open')){
    setTimeout(()=>renderPages(), 320);
  }
}

function toggleFullscreen(){
  const el = document.getElementById('reader-overlay');
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  if(!fsEl){
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen;
    if(req){
      Promise.resolve(req.call(el)).catch(()=>iosFsHint());
    } else {
      iosFsHint(); // iOS Safari (iPhone): div tam ekranı desteklenmez
    }
  } else {
    const exit = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen;
    if(exit){
      Promise.resolve(exit.call(document)).catch(()=>showToast('Tam ekrandan çıkılamadı','error'));
    }
  }
}
function iosFsHint(){
  // iOS'ta tarayıcı çubuğunu gizlemenin tek yolu: Ana Ekrana Ekle (standalone PWA)
  const standalone = window.navigator.standalone || window.matchMedia('(display-mode:standalone)').matches;
  if(standalone) return; // zaten tam ekran (ana ekrandan açılmış)
  showToast('Tam ekran için: Paylaş ⬆️ → "Ana Ekrana Ekle" 📲 — sonra oradan aç','info');
}

function toggleAppFullscreen(){
  const el = document.documentElement;
  if(!document.fullscreenElement){
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen;
    if(req){
      Promise.resolve(req.call(el)).catch(()=>showToast('Tam ekran bu tarayıcıda engellendi','error'));
    }
  } else {
    const exit = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen;
    if(exit){
      Promise.resolve(exit.call(document)).catch(()=>showToast('Tam ekrandan çıkılamadı','error'));
    }
  }
}

function syncFullscreenButtons(){
  const isFullscreen = !!document.fullscreenElement;
  const readerBtn = document.getElementById('fullscreenBtn');
  if(readerBtn){
    readerBtn.textContent = isFullscreen ? '⊡' : '⛶';
    readerBtn.title = isFullscreen ? 'Tam Ekrandan Çık (Esc)' : 'Tam Ekran (F11)';
  }
  const appBtn = document.getElementById('appFullscreenBtn');
  if(appBtn){
    appBtn.textContent = isFullscreen ? '⊡' : '⛶';
    appBtn.title = isFullscreen ? 'Tam Ekrandan Çık' : 'Tam Ekran';
  }
}

document.addEventListener('fullscreenchange', ()=>{
  syncFullscreenButtons();
});
document.addEventListener('webkitfullscreenchange', ()=>{
  syncFullscreenButtons();
});
document.addEventListener('mozfullscreenchange', ()=>{
  syncFullscreenButtons();
});

function toggleReadingMode(){
  appState.readingMode = !appState.readingMode;
  document.getElementById('readerCenter').classList.toggle('reading-mode', appState.readingMode);
  document.getElementById('readingModeBtn').textContent = appState.readingMode ? '🌙' : '☀️';
  showToast(appState.readingMode?'Okuma modu açıldı 🌙':'Normal mod ☀️','info');
}

// ══════════════════════════════
// SORU BANKASI — TEK KART SİSTEMİ
// ══════════════════════════════


// ── Bu modülün fonksiyonlarını window'a kaydet ──
// main.js ve diğer modüller window.xxx ile çağırabilsin
window.toggleReaderPanel = toggleReaderPanel;
window.toggleFullscreen = toggleFullscreen;
window.toggleAppFullscreen = toggleAppFullscreen;
window.syncFullscreenButtons = syncFullscreenButtons;
window.toggleReadingMode = toggleReadingMode;
