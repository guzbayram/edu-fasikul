import { appState } from '../state/appState.js';

function toggleSidebar(){
  const s = document.getElementById('sidebar');
  s.classList.toggle('collapsed');
  const btn = s.querySelector('.collapse-btn');
  btn.textContent = s.classList.contains('collapsed') ? '▶' : '◀';
}
function showPanel(name, navEl){
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('panel-'+name).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  if(navEl) navEl.classList.add('active');
  const titles = {dashboard:'Anasayfa',stats:'İstatistikler',hatalilar:'Hatalılar Defteri',profil:'Profilim',admin:'Kullanıcı Yönetimi'};
  document.getElementById('topBarTitle').textContent = titles[name]||name;
  if(name==='stats' && !window._chartsInited){ initCharts(); window._chartsInited=true; }
  if(name==='dashboard' || name==='stats' || name==='profil') updateDashboard();
  if(name==='profil'){
    window.refreshProfileGithubJsonTools?.();
    // PDF Klasörü özeti (X/Y hazır + kullanılmayan fasikül temizleme kutusu)
    // sadece belirli PDF aksiyonlarından sonra hesaplanıyordu — ders silme,
    // sıfırlama gibi işlemlerden sonra Profil'e her girişte donmuş/eski sayı
    // görünüyordu. Artık panel her açıldığında güncel duruma göre yeniden
    // hesaplanır.
    window.updateEduDirUI?.();
  }
  if(name==='hatalilar') renderHatalilar();
  if(name==='admin') loadKullaniciList();
}

// ── Window exports ──
window.toggleSidebar = toggleSidebar;
window.showPanel = showPanel;
