import { appState } from '../state/appState.js';
import { _getUserKey, scheduleCloudPersist, getDashboardStats } from '../firebase/firestore.js';

// Aktif ders tek kaynakta: window.currentDrawerDers (split-brain önler)
let allFasikulCards = [];
const FASIKUL_THEME_COLORS = ['#7c73ff','#ec6471','#f59e0b','#22c55e','#14b8a6','#38bdf8','#d946ef'];
let draggedFasikulId = null;
let fasikulWasDragged = false;
let dersModalParentDersId = null;

function renderDate(){
  const d = new Date();
  document.getElementById('todayDate').textContent = d.toLocaleDateString('tr-TR',{weekday:'long',day:'numeric',month:'long'});
}

function renderMathSymbols(){
  const syms = ['∑','∫','π','√','∞','∆','θ','α','β','±','≠','⊥','∥','≤','≥','λ'];
  const wrap = document.getElementById('mathSymbols');
  syms.forEach((s,i) => {
    const el = document.createElement('span');
    el.className='sym'; el.textContent=s;
    el.style.cssText=`left:${5+i*6}%;top:${10+Math.sin(i)*35}%;animation-delay:${i*0.7}s;animation-duration:${10+i%3*4}s;font-size:${20+i%4*10}px`;
    wrap.appendChild(el);
  });
}

function renderStreakDots(){
  const wrap = document.getElementById('streakDots');
  wrap.innerHTML='';
  for(let i=0;i<7;i++){
    const d=document.createElement('div');
    d.className='streak-dot'+(i<7?' done':'');
    wrap.appendChild(d);
  }
}
function toggleTheme(){
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  html.setAttribute('data-theme', isDark?'light':'dark');
  appState.theme = isDark?'light':'dark';
  const icon = isDark?'☀️':'🌙';
  document.getElementById('themeIcon').textContent = icon;
  document.getElementById('themeToggle').textContent = icon;
  document.getElementById('themeTogglePref').textContent = isDark?'Kapalı':'Açık';
  document.getElementById('themeTogglePref').classList.toggle('off',isDark);
  localStorage.setItem('edu_theme', appState.theme);
  scheduleCloudPersist();
}
// GUEST_DEMO_FASIKUL_IDS → window.GUEST_DEMO_FASIKUL_IDS (main.js'de tanımlı)
function visibleFasikullerFor(ders){
  const base = isGuestSession()
    ? (ders.fasikuller||[]).filter(f=>window.GUEST_DEMO_FASIKUL_IDS.has(f.id))
    : (ders.fasikuller||[]);
  if(appState.user?.role === 'admin') return base;
  const hidden = new Set(Array.isArray(appState.user?.hiddenFasikulIds) ? appState.user.hiddenFasikulIds : []);
  return base.filter(f=>!hidden.has(f.id));
}

function perfSummary(bucket){
  const total = Number(bucket?.total || 0);
  const correct = Number(bucket?.dogru || 0);
  const wrong = Number(bucket?.yanlis || 0);
  const solved = correct + wrong;
  const accuracy = solved ? Math.round(correct / solved * 100) : 0;
  const net = correct - wrong * 0.25;
  return {total, correct, wrong, solved, accuracy, net};
}

function formatNet(value){
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

// ══════════════════════════════
// DRAWER
// ══════════════════════════════
function filterFasikuller(q){
  if(!window.currentDrawerDers) return;
  const filtered = visibleFasikullerFor(window.currentDrawerDers).filter(f=>f.ad.toLowerCase().includes(q.toLowerCase()));
  renderFasikulCards(filtered, window.currentDrawerDers);
}
function setFasikulTheme(dersId,fasikulId,color){
  const ders=window.MANIFEST.dersler.find(d=>d.id===dersId);
  const fas=ders?.fasikuller.find(f=>f.id===fasikulId);
  if(!fas || !FASIKUL_THEME_COLORS.includes(color)) return;
  fas.temaRenk=color;
  persistManifest();
  renderFasikulCards(ders.fasikuller,ders);
  showToast('Fasikül rengi güncellendi','success');
}
function moveFasikul(dersId,fasikulId,direction){
  const ders=window.MANIFEST.dersler.find(d=>d.id===dersId);
  if(!ders) return;
  const from=ders.fasikuller.findIndex(f=>f.id===fasikulId);
  const to=Math.max(0,Math.min(ders.fasikuller.length-1,from+direction));
  if(from<0 || from===to) return;
  const [item]=ders.fasikuller.splice(from,1);
  ders.fasikuller.splice(to,0,item);
  persistManifest(); renderFasikulCards(ders.fasikuller,ders); renderDerslerGrid();
}
function reorderFasikulByDrop(dersId,sourceId,targetId){
  if(!sourceId || sourceId===targetId) return;
  const ders=window.MANIFEST.dersler.find(d=>d.id===dersId);
  if(!ders) return;
  const from=ders.fasikuller.findIndex(f=>f.id===sourceId);
  const to=ders.fasikuller.findIndex(f=>f.id===targetId);
  if(from<0 || to<0) return;
  const [item]=ders.fasikuller.splice(from,1);
  ders.fasikuller.splice(to,0,item);
  persistManifest(); renderFasikulCards(ders.fasikuller,ders); renderDerslerGrid();
  showToast('Fasikül sırası kaydedildi','success');
}
function canDersAcceptItem(targetDers, item){
  const targetItems = targetDers?.fasikuller || [];
  const itemIsFolder = item?.type === 'folder';
  const hasFolders = targetItems.some(f=>f.type === 'folder');
  const hasFasikuller = targetItems.some(f=>f.type !== 'folder');
  if(itemIsFolder && hasFasikuller){
    showToast('Bu dizinde fasikül var; alt ders ile fasikül aynı dizinde olamaz.','info');
    return false;
  }
  if(!itemIsFolder && hasFolders){
    showToast('Bu dizinde alt dersler var; fasikülü alt dersin içine taşıyın.','info');
    return false;
  }
  return true;
}
function moveFasikulToDers(sourceDersId, fasikulId, targetDersId){
  if(!sourceDersId || !fasikulId || !targetDersId || sourceDersId===targetDersId) return false;
  const sourceDers=window.MANIFEST.dersler.find(d=>d.id===sourceDersId);
  const targetDers=window.MANIFEST.dersler.find(d=>d.id===targetDersId);
  if(!sourceDers || !targetDers) return false;
  const from=sourceDers.fasikuller.findIndex(f=>f.id===fasikulId);
  if(from<0) return false;
  const [item]=sourceDers.fasikuller.splice(from,1);
  if(item.type === 'folder' && item.childDersId === targetDersId){
    sourceDers.fasikuller.splice(from,0,item);
    showToast('Klasör kendi içine taşınamaz','error');
    return false;
  }
  if(!canDersAcceptItem(targetDers, item)){
    sourceDers.fasikuller.splice(from,0,item);
    return false;
  }
  if(targetDers.fasikuller.some(f=>f.id===item.id)){
    sourceDers.fasikuller.splice(from,0,item);
    showToast('Bu fasikül hedef dizinde zaten var','info');
    return false;
  }
  targetDers.fasikuller.push(item);
  persistManifest();
  renderDerslerGrid();
  renderFasikulCards(visibleFasikullerFor(sourceDers), sourceDers);
  showToast(`${item.ad || 'Fasikül'} taşındı ✓`,'success');
  return true;
}
function toggleFasikulMenu(btn){
  const menu = btn.nextElementSibling;
  const isOpen = menu.classList.contains('open');
  document.querySelectorAll('.fasikul-card-menu.open').forEach(m=>m.classList.remove('open'));
  if(!isOpen) menu.classList.add('open');
}
document.addEventListener('click', (e)=>{
  if(!e.target.closest('.fasikul-card-menu-btn')){
    document.querySelectorAll('.fasikul-card-menu.open').forEach(m=>m.classList.remove('open'));
  }
});

function openLastFasikul(){
  const target = window._lastWorkedTarget;
  if(target?.dersId && target?.fasikulId){
    openReader(target.dersId, target.fasikulId);
    return;
  }
  const ders = window.MANIFEST?.dersler?.find(d=>window.visibleFasikullerFor?.(d)?.length);
  const fas = ders && window.visibleFasikullerFor(ders)[0];
  if(ders && fas) openReader(ders.id, fas.id);
}

// ══════════════════════════════
// READER
// ══════════════════════════════
function safeDateKey(dateLike){
  const d=dateLike ? new Date(dateLike) : null;
  if(!d || Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0,10);
}
function getDailyCounts(records){
  const counts={};
  records.forEach(r=>{
    const key=safeDateKey(r.tarih);
    if(key) counts[key]=(counts[key]||0)+1;
  });
  return counts;
}
function calcCurrentStreak(counts){
  let streak=0;
  const d=new Date();
  for(let i=0;i<365;i++){
    const key=d.toISOString().slice(0,10);
    if((counts[key]||0)>0){ streak++; d.setDate(d.getDate()-1); }
    else break;
  }
  return streak;
}
// ══════════════════════════════
// FASİKÜL İLERLEME HESAPLAMA
// ══════════════════════════════
// ══════════════════════════════
// FASİKÜL VERİ SIFIRLAMA
// ══════════════════════════════
async function resetFasikulData(dersId, fasId){
  if(!confirm('Bu fasiküle ait tüm çözüm kayıtları, hatalılar ve çizimler silinecek. Bu işlem geri alınamaz. Devam etmek istiyor musunuz?')) return;

  // sorularState'ten bu fasikülün kayıtlarını temizle
  const state = appState.sorularState || {};
  Object.keys(state).forEach(key => {
    const s = state[key];
    if ((s && s.fasikulId === fasId) || key.startsWith(fasId + '__')) {
      delete state[key];
    }
  });

  // hatalilar'dan bu fasiküle ait kayıtları temizle
  const beforeCount = appState.hatalilar.length;
  appState.hatalilar = appState.hatalilar.filter(h => h.fasikulId !== fasId);
  const removedCount = beforeCount - appState.hatalilar.length;
  document.getElementById('hataliCount').textContent = appState.hatalilar.length;
  document.getElementById('hataliCountBig').textContent = `${appState.hatalilar.length} Soru`;

  // Çizimleri temizle
  Object.keys(appState.drawings || {}).forEach(key => {
    if (key.startsWith(fasId + '__') || key.startsWith(fasId + '/')) {
      delete appState.drawings[key];
    }
  });

  // Manifest'te ilerlemeyi sıfırla
  const ders = window.MANIFEST.dersler.find(d => d.id === dersId);
  const fas = ders?.fasikuller.find(f => f.id === fasId);
  if (fas) {
    fas.progPct = 0;
    fas._solvedCount = 0;
    fas.sonCalisma = '—';
  }

  // Firestore: bu fasiküle ait cozumler belgelerini sil
  const uid = _getUserKey();
  if (uid && window._firestoreReady && window._fsGetDocs && window._fsDeleteDoc) {
    try {
      const snap = await window._fsGetDocs(window._fsCollection(window._db, 'kullanicilar', uid, 'cozumler'));
      const deletes = [];
      snap.forEach(d => {
        const c = d.data();
        if (c.fasikulId === fasId) deletes.push(window._fsDeleteDoc(d.ref));
      });
      if (deletes.length) await Promise.all(deletes);
    } catch(e) { console.warn('Firestore fasikül sıfırlama hatası:', e); }

    // Firestore: bu fasiküle ait cizimler belgelerini sil
    try {
      const dSnap = await window._fsGetDocs(window._fsCollection(window._db, 'kullanicilar', uid, 'cizimler'));
      const dDels = [];
      dSnap.forEach(d => {
        const c = d.data();
        if (c.fasikulId === fasId) dDels.push(window._fsDeleteDoc(d.ref));
      });
      if (dDels.length) await Promise.all(dDels);
    } catch(e) { console.warn('Firestore çizim sıfırlama hatası:', e); }
  }

  recalcFasikulProgress();
  updateDashboard();
  persistData();
  persistManifest();
  renderDerslerGrid();
  if (window.currentDrawerDers) renderFasikulCards(window.currentDrawerDers.fasikuller, window.currentDrawerDers);
  showToast(`Fasikül sıfırlandı — ${removedCount} hatalı silindi 🗑️`, 'success');
}

// ══════════════════════════════
// HATALIJLAR
// ══════════════════════════════
const DEMO_STATS = {
  streak:7, streakDelta:'↗ Devam et!',
  totalSolved:142, solvedDelta:'↗ +12 bugün',
  weekly:38, weeklyDelta:'↗ +8 geçen hafta',
  accuracy:'%74', accuracyDelta:'↗ +5% geçen ay',
  kpiSolved:142, kpiSolvedSub:'↗ Bu hafta +38',
  kpiAccuracy:'%74', kpiAccuracySub:'↗ +5% geçen haftaya',
  kpiTime:'18s', kpiTimeSub:'Bu ay 18 saat',
  kpiLongest:'12🔥', kpiLongestSub:'Kişisel rekor'
};
function applyDemoStats(on){
  const s = on ? DEMO_STATS : {
    streak:0, streakDelta:'—',
    totalSolved:0, solvedDelta:'—',
    weekly:0, weeklyDelta:'—',
    accuracy:'%0', accuracyDelta:'—',
    kpiSolved:0, kpiSolvedSub:'—',
    kpiAccuracy:'%0', kpiAccuracySub:'—',
    kpiTime:'0s', kpiTimeSub:'—',
    kpiLongest:'0🔥', kpiLongestSub:'—'
  };
  const set = (id,v)=>{ const el=document.getElementById(id); if(el) el.textContent=v; };
  set('sidebarStreakCount', s.streak+' Gün');
  set('statStreak', s.streak);
  set('statStreakDelta', s.streakDelta);
  set('totalSolved', s.totalSolved);
  set('statSolvedDelta', s.solvedDelta);
  set('statWeekly', s.weekly);
  set('statWeeklyDelta', s.weeklyDelta);
  set('statAccuracy', s.accuracy);
  set('statAccuracyDelta', s.accuracyDelta);
  set('kpiTotalSolved', s.kpiSolved);
  set('kpiSolvedSub', s.kpiSolvedSub);
  set('kpiAccuracy', s.kpiAccuracy);
  set('kpiAccuracySub', s.kpiAccuracySub);
  set('kpiTime', s.kpiTime);
  set('kpiTimeSub', s.kpiTimeSub);
  set('kpiLongestStreak', s.kpiLongest);
  set('kpiLongestSub', s.kpiLongestSub);
  set('profileSolved', s.totalSolved);
  set('profileStreak', s.streak+'🔥');
  set('profileAccuracy', s.accuracy);
  // Streak dots
  document.querySelectorAll('.streak-dot').forEach((d,i)=>{ d.classList.toggle('done', on && i<7); });
}
function applyDemoMode(on){
  window.DEMO_SNAPSHOT.forEach(sd=>{
    const ders = window.MANIFEST.dersler.find(d=>d.id===sd.id);
    if(!ders) return;
    ders.progPct = on ? sd.progPct : 0;
    sd.fasikuller.forEach(sf=>{
      const fas = ders.fasikuller.find(f=>f.id===sf.id);
      if(!fas) return;
      fas.progPct = on ? sf.progPct : 0;
      fas.sonCalisma = on ? sf.sonCalisma : '—';
    });
  });
  persistManifest();
  applyDemoStats(on);
  renderDerslerGrid();
  // Açık olan fasikül çekmecesini de güncelle
  if(window.currentDrawerDers){
    renderFasikulCards(window.currentDrawerDers.fasikuller, window.currentDrawerDers);
  }
}
function toggleDemoData(btn){
  const isOff = btn.classList.toggle('off');
  btn.textContent = isOff ? 'Kapalı' : 'Açık';
  localStorage.setItem('edu_demo_mode', isOff ? '0' : '1');
  applyDemoMode(!isOff);
  showToast(isOff ? 'Demo verileri kapatıldı' : 'Demo verileri açıldı', 'success');
}
function openDersModal(dersId, e, parentDersId=null){
  if(isGuestSession()){ showToast('Ders eklemek için yetkili hesabıyla giriş yapın','info'); return; }
  if(e) e.stopPropagation();
  dersModalParentDersId = parentDersId || null;
  const modal = document.getElementById('dersModal');
  const silBtn = document.getElementById('dersSilBtn');
  document.getElementById('dersEditId').value = '';
  document.getElementById('dersAdInput').value = '';
  document.getElementById('dersIkonInput').value = '';
  document.getElementById('dersRenkValue').value = 'var(--mat)';
  document.querySelectorAll('#dersRenkPicker .color-dot').forEach(d=>d.classList.remove('selected'));
  document.querySelector('#dersRenkPicker .color-dot')?.classList.add('selected');
  silBtn.style.display = 'none';
  document.getElementById('dersModalTitle').textContent = dersModalParentDersId ? '📁 Alt Ders Ekle' : '➕ Ders Ekle';
  if(dersId){
    dersModalParentDersId = null;
    const ders = window.MANIFEST.dersler.find(d=>d.id===dersId);
    if(ders){
      document.getElementById('dersEditId').value = dersId;
      document.getElementById('dersAdInput').value = ders.ad;
      document.getElementById('dersIkonInput').value = ders.ikon;
      document.getElementById('dersRenkValue').value = ders.renk;
      document.querySelectorAll('#dersRenkPicker .color-dot').forEach(d=>{
        d.classList.toggle('selected', d.dataset.renk === ders.renk);
      });
      silBtn.style.display = '';
      document.getElementById('dersModalTitle').textContent = '✏️ Dersi Düzenle';
    }
  }
  modal.classList.add('open');
}
function openAltDersModal(e){
  if(isGuestSession()){ showToast('Ders eklemek için yetkili hesabıyla giriş yapın','info'); return; }
  const parent = window.currentDrawerDers;
  if(!parent){ showToast('Önce bir ders paneli açın','error'); return; }
  openDersModal(null, e, parent.id);
}
function closeDersModal(){
  document.getElementById('dersModal').classList.remove('open');
  dersModalParentDersId = null;
}
function selectDersRenk(el, renk){
  document.querySelectorAll('#dersRenkPicker .color-dot').forEach(d=>d.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('dersRenkValue').value = renk;
}
function saveDers(){
  const editId = document.getElementById('dersEditId').value;
  const ad = document.getElementById('dersAdInput').value.trim();
  const ikon = document.getElementById('dersIkonInput').value.trim() || '📚';
  const renk = document.getElementById('dersRenkValue').value;
  if(!ad){ showToast('Ders adı gerekli','error'); return; }
  if(editId){
    const ders = window.MANIFEST.dersler.find(d=>d.id===editId);
    if(ders){ ders.ad=ad; ders.ikon=ikon; ders.renk=renk; }
    showToast(`${ad} güncellendi ✓`,'success');
  } else if(dersModalParentDersId){
    const parent = window.MANIFEST.dersler.find(d=>d.id===dersModalParentDersId);
    if(!parent){ showToast('Üst ders bulunamadı','error'); return; }
    if((parent.fasikuller||[]).some(f=>f.type !== 'folder')){
      showToast('Bu dizinde fasikül var; önce fasikülleri mevcut alt derslere taşıyın veya boş bir ders içinde alt ders oluşturun.','info');
      return;
    }
    const norm = v => String(v||'').trim().toLocaleLowerCase('tr-TR');
    let child = window.MANIFEST.dersler.find(d=>d.parentDersId===parent.id && norm(d.ad)===norm(ad));
    if(!child){
      child = window.MANIFEST.dersler.find(d=>!d.parentDersId && d.id!==parent.id && norm(d.ad)===norm(ad));
      if(child) child.parentDersId = parent.id;
    }
    if(!child){
      const newId = ad.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'') + '-' + Date.now();
      child = { id:newId, ad, ikon, renk, progPct:0, fasikuller:[], parentDersId:parent.id };
      window.MANIFEST.dersler.push(child);
    } else {
      child.ad = ad;
      child.ikon = ikon;
      child.renk = renk;
      child.parentDersId = parent.id;
      child.fasikuller = child.fasikuller || [];
    }
    const folderId = `folder-${child.id}`;
    if(!parent.fasikuller.some(f=>f.id===folderId || f.childDersId===child.id)){
      parent.fasikuller.push({
        id:folderId,
        type:'folder',
        childDersId:child.id,
        ad:child.ad,
        thumb:child.ikon || '📁',
        soruSayisi:0,
        konuSayisi:0,
        progPct:child.progPct || 0,
        sonCalisma:'Alt ders'
      });
    }
    window.currentDrawerDers = parent;
    showToast(`${ad} ${parent.ad} içine eklendi ✓`,'success');
  } else {
    const newId = ad.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'') + '-' + Date.now();
    window.MANIFEST.dersler.push({ id:newId, ad, ikon, renk, progPct:0, fasikuller:[] });
    showToast(`${ad} eklendi ✓`,'success');
  }
  persistManifest();
  renderDerslerGrid();
  if(window.currentDrawerDers){
    const current = window.MANIFEST.dersler.find(d=>d.id===window.currentDrawerDers.id) || window.currentDrawerDers;
    window.currentDrawerDers = current;
    renderFasikulCards(visibleFasikullerFor(current), current);
  }
  closeDersModal();
}
function silDers(){
  const editId = document.getElementById('dersEditId').value;
  if(!editId) return;
  const ders = window.MANIFEST.dersler.find(d=>d.id===editId);
  if(!ders) return;
  if(!confirm(`"${ders.ad}" dersini ve tüm fasikülleri silmek istiyor musunuz?`)) return;
  window.MANIFEST.dersler = window.MANIFEST.dersler.filter(d=>d.id!==editId);
  // Track deletion
  try{ const del=JSON.parse(localStorage.getItem('edu_deleted_dersler')||'[]'); del.push(editId); localStorage.setItem('edu_deleted_dersler',JSON.stringify(del)); }catch(e){}
  persistManifest();
  renderDerslerGrid();
  closeDersModal();
  showToast('Ders silindi 🗑️','success');
}

// ══════════════════════════════
// FASİKÜL CRUD
// ══════════════════════════════
async function openFasikulModal(fasikulId){
  if(isGuestSession()){ showToast('Fasikül eklemek için yetkili hesabıyla giriş yapın','info'); return; }
  const modal = document.getElementById('fasikulModal');
  const silBtn = document.getElementById('fasikulSilBtn');
  document.getElementById('fasikulEditId').value = '';
  document.getElementById('fasikulAdInput').value = '';
  document.getElementById('fasikulSinifInput').value = '10';
  document.getElementById('fasikulSoruInput').value = '0';
  document.getElementById('fasikulThumbInput').value = '';
  // Sınıf/soru kaynak seçilince otomatik dolar ama elle değiştirilebilsin.
  document.getElementById('fasikulSinifInput').readOnly = false;
  document.getElementById('fasikulSoruInput').readOnly = false;
  await populateFasikulSourceSelect(fasikulId);
  silBtn.style.display = 'none';
  document.getElementById('fasikulModalTitle').textContent = '📚 Fasikül Ekle';
  // Düzenleme: drawer açık olmasa da fasikülün sahibi dersi çöz.
  // main.js drawer açınca window.currentDrawerDers'i set ediyor (split-brain köprüsü).
  let ders = window.currentDrawerDers;
  if(fasikulId && (!ders || !ders.fasikuller?.some(f=>f.id===fasikulId))){
    ders = window.MANIFEST?.dersler?.find(d=>d.fasikuller?.some(f=>f.id===fasikulId)) || ders;
  }
  if(ders) window.currentDrawerDers = ders;
  if(fasikulId && ders){
    const fas = ders.fasikuller.find(f=>f.id===fasikulId);
    if(fas){
      document.getElementById('fasikulEditId').value = fasikulId;
      document.getElementById('fasikulAdInput').value = fas.ad;
      document.getElementById('fasikulSinifInput').value = fas.sinif||10;
      document.getElementById('fasikulSoruInput').value = fas.soruSayisi||0;
      document.getElementById('fasikulThumbInput').value = fas.thumb||'';
      document.getElementById('fasikulSourceSelect').value = fas.sourceType==='bundled' ? fas.id : '';
      document.getElementById('fasikulSourceSelect').disabled = true;
      applyBundledSourceToForm(fas.sourceType==='bundled' ? fas.id : '', false);
      silBtn.style.display = fas.sourceType==='bundled' ? 'none' : '';
      document.getElementById('fasikulModalTitle').textContent = '✏️ Fasikülü Düzenle';
    }
  }
  modal.classList.add('open');
}
async function populateFasikulSourceSelect(editId=''){
  const select=document.getElementById('fasikulSourceSelect');
  const hint=document.getElementById('fasikulSourceHint');
  if(!select) return;
  select.disabled=false;
  select.innerHTML='<option value="">Fasikül kaynağı seçin</option>';
  let availableCount=0;
  let noPdfCount=0;
  const permission = appState.eduDirHandle ? await appState.eduDirHandle.queryPermission({mode:'read'}).catch(()=>null) : null;
  const hasFolder = !!appState.eduDirHandle && permission==='granted';
  const cachedKeys = await getCachedPDFKeys();
  const cachedRecords = await getCachedPDFRecords();
  // Anahtar, fasikül başka bir derse eklenince değişebilir. Bu nedenle iPad'de
  // asıl eşleşmeyi kaydedilen File.name üzerinden yap.
  const cachedPdfNames = new Set(cachedRecords.map(r=>normalizePdfFileName(r?.name || r?.blob?.name)));
  // Tüm JSON'ları PARALEL yükle — sırayla 20+ kaynağı çekmek dropdown'ı takıyordu.
  const loaded = await Promise.all(window.BUNDLED_FASIKUL_SOURCES.map(async source=>{
    let raw=bundledSourceCache.get(source.json);
    if(!raw){ try{ raw=await readBundledJson(source); }catch(e){ raw=null; } }
    const folderPdfFound = hasFolder ? await hasLocalPdfFile(source.pdf).catch(()=>false) : false;
    return {source, raw, folderPdfFound};
  }));
  for(const {source, raw, folderPdfFound} of loaded){
    if(!raw && source.id!==editId) continue;
    const cachedPdfFound = cachedKeys.has(`${source.dersId}_${source.id}`)
      || cachedPdfNames.has(normalizePdfFileName(source.pdf));
    const pdfFound = cachedPdfFound || folderPdfFound;
    if(!pdfFound) noPdfCount++;
    const dersAd=window.MANIFEST.dersler.find(d=>d.id===source.dersId)?.ad || source.dersId;
    const option=document.createElement('option');
    option.value=source.id;
    option.textContent=`${raw?.ad || source.json.replace(/\.json$/,'')} · ${dersAd}${pdfFound?'':' · PDF yok'}`;
    availableCount++;
    select.appendChild(option);
  }
  if(hint){
    hint.textContent = availableCount
      ? (noPdfCount
          ? `${availableCount} fasikül kaynağı bulundu (${noPdfCount} tanesinin PDF'i bu cihazda yok — yine de eklenebilir).`
          : `${availableCount} fasikül kaynağı bulundu. Bilgiler seçiminizle otomatik doldurulur.`)
      : 'Eklenebilecek GitHub JSON fasikülü bulunamadı.';
  }
  select.disabled = availableCount===0 && !editId;
}
async function applyBundledSourceToForm(sourceId,fillValues=true){
  const source=window.BUNDLED_FASIKUL_SOURCES.find(s=>s.id===sourceId);
  const hint=document.getElementById('fasikulSourceHint');
  const sinif=document.getElementById('fasikulSinifInput');
  const soru=document.getElementById('fasikulSoruInput');
  if(!source){
    if(hint) hint.textContent='Fasikül eklemek için bir kaynak seçin.';
    if(sinif) sinif.readOnly=false;
    if(soru) soru.readOnly=false;
    return;
  }
  // Cache'de yoksa JSON'ı burada yükle — otomatik doldurma cache zamanlamasına takılmasın.
  let raw=bundledSourceCache.get(source.json);
  if(!raw){ try{ raw=await readBundledJson(source); }catch(e){} }
  if(fillValues && raw){
    document.getElementById('fasikulAdInput').value=raw.ad||source.json.replace(/\.json$/,'');
    sinif.value=bundledSinif(raw.sinif);
    soru.value=raw.soruSayisi||raw.toplamSoru||0;
    document.getElementById('fasikulThumbInput').value=raw.thumb||'📄';
  }
  // Otomatik dolduruldu ama kullanıcı elle değiştirebilsin.
  sinif.readOnly=false;
  soru.readOnly=false;
  if(hint) hint.innerHTML=`GitHub JSON: <b>${source.json}</b><br>PDF: <b>${source.pdf}</b> <span style="opacity:.7">(cihazda yoksa açılırken yüklenir)</span>`;
}
function closeFasikulModal(){
  document.getElementById('fasikulModal').classList.remove('open');
}
function refreshCurrentDrawerAfterFasikulSave(ders){
  if(!ders) return;
  const canonical = window.MANIFEST?.dersler?.find(d=>d.id===ders.id) || ders;
  window.currentDrawerDers = canonical;
  const visible = visibleFasikullerFor(canonical);
  try{ renderFasikulCards(visible, canonical); }catch(e){ console.error(e); }
  if(document.getElementById('drawer') && document.getElementById('drawerOverlay')){
    document.getElementById('drawerTitle').textContent = `${canonical.ikon} ${canonical.ad}`;
    document.getElementById('drawerSearch').value = '';
    document.getElementById('drawerOverlay').classList.add('open');
    document.getElementById('drawer').classList.add('open');
  }
}
function saveFasikul(){
  const editId = document.getElementById('fasikulEditId').value;
  const ad = document.getElementById('fasikulAdInput').value.trim();
  const sinif = parseInt(document.getElementById('fasikulSinifInput').value)||10;
  const soruSayisi = parseInt(document.getElementById('fasikulSoruInput').value)||0;
  const thumb = document.getElementById('fasikulThumbInput').value.trim() || '📄';
  const sourceId = document.getElementById('fasikulSourceSelect').value;
  const source = window.BUNDLED_FASIKUL_SOURCES.find(s=>s.id===sourceId);
  const sourceRaw = source ? bundledSourceCache.get(source.json) : null;
  // Hedef dersi çöz: aktif drawer dersi yoksa seçilen kaynağın dersId'sinden
  // (drawer açılmadan "+ Fasikül Ekle" ile gelindiğinde de çalışsın), düzenlemede
  // ise fasikülü içeren dersten bul.
  let ders = window.currentDrawerDers;
  if(!ders && source) ders = window.MANIFEST?.dersler?.find(d=>d.id===source.dersId) || null;
  if(!ders && editId) ders = window.MANIFEST?.dersler?.find(d=>d.fasikuller?.some(f=>f.id===editId)) || null;
  if(!ders){ showToast('Önce bir ders seç','error'); return; }
  // window.currentDrawerDers bir cloud-sync/yeniden yükleme sonrası STALE (kopuk) referans
  // olabilir. push'u MANIFEST'teki CANONICAL objeye yap ki openDrawer(...ders.id) aynı objeyi
  // bulsun — yoksa drawer boş render eder (fasikül eski, kopuk objede kalır).
  const dersCanonical = window.MANIFEST?.dersler?.find(d=>d.id===ders.id);
  if(dersCanonical) ders = dersCanonical;
  window.currentDrawerDers = ders; // sonraki render'lar doğru (canonical) dersi hedeflesin
  if(!editId && !source){ showToast('Fasikül eklemek için GitHub JSON kaynağı seçin','error'); return; }
  if(!ad){ showToast('Fasikül adı gerekli','error'); return; }
  // Validasyon geçti → modalı HEMEN kapat. Girdiler yukarıda okundu; aşağıdaki
  // veri yazma/persist adımlarından biri hata verse bile modal takılı kalmasın.
  closeFasikulModal();
  // Daha önce silinip bastırılmış bir bundled fasikül yeniden ekleniyorsa bastırmayı kaldır
  // (yoksa loadBundledFasikuller onu bir daha yüklemez, sayaçlar 0 kalır).
  if(source){ try{ const K='edu_deleted_bundled_ids'; const s=new Set(JSON.parse(localStorage.getItem(K)||'[]')); if(s.delete(source.id)) localStorage.setItem(K, JSON.stringify([...s])); }catch(e){} }
  // Tüm fasiküller tip-1 (konu · soru) okuyucuda açılır.
  const detectedTip = source ? 'tip1' : '';
  const thumbBgMap = {'var(--mat)':'linear-gradient(135deg,#312e81,#1e1b4b)','var(--fiz)':'linear-gradient(135deg,#164e63,#0c4a6e)','var(--kim)':'linear-gradient(135deg,#064e3b,#052e16)','var(--bio)':'linear-gradient(135deg,#431407,#450a0a)','var(--tar)':'linear-gradient(135deg,#500724,#2d1657)','var(--edb)':'linear-gradient(135deg,#2e1065,#1a0533)'};
  const thumbBg = thumbBgMap[ders.renk] || 'linear-gradient(135deg,#312e81,#1e1b4b)';
  if(editId){
    const fas = ders.fasikuller.find(f=>f.id===editId);
    if(fas){
      fas.ad=ad; fas.sinif=sinif; fas.soruSayisi=soruSayisi; fas.thumb=thumb; fas.thumbBg=thumbBg; fas.konuSayisi=fas.konular?.length||0;
      if(source){ fas.jsonFile=source.json;fas.pdfFile=source.pdf;fas.sourceType='bundled';
        if(detectedTip){ fas.fasikulTip=detectedTip; } }
    }
    showToast(`${ad} güncellendi ✓`,'success');
  } else {
    const existing = source ? ders.fasikuller.find(f=>f.id===source.id) : null;
    if(existing){
      const konular = sourceRaw?.konular ? normalizeFasikulKonular(sourceRaw.konular) : (existing.konular||[]);
      existing.ad=ad;
      existing.thumb=thumb;
      existing.thumbBg=thumbBg;
      existing.sinif=sinif;
      existing.konuSayisi=konular.length;
      existing.soruSayisi=soruSayisi;
      existing.konular=konular;
      existing.jsonFile=source.json;
      existing.pdfFile=source.pdf;
      existing.sourceType='bundled';
      if(detectedTip){ existing.fasikulTip=detectedTip; }
      persistKonular(ders.id,existing.id,konular).catch(()=>{});
      showToast(`${ad} zaten vardı, bilgiler yenilendi ✓`,'success');
      closeFasikulModal();
      try{ persistManifest(); renderDerslerGrid(); }catch(e){ console.error(e); }
      refreshCurrentDrawerAfterFasikulSave(ders);
      return;
    }
    const newId = source?.id || ad.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'') + '-' + Date.now();
    const konular = sourceRaw?.konular ? normalizeFasikulKonular(sourceRaw.konular) : [];
    ders.fasikuller.push({
      id:newId,ad,thumb,thumbBg,sinif,
      konuSayisi:konular.length,
      soruSayisi:soruSayisi,
      progPct:0,sonCalisma:'Yeni eklendi',konular,
      jsonFile:source?.json||null,pdfFile:source?.pdf||null,sourceType:source?'bundled':null,
      ...(detectedTip?{fasikulTip:detectedTip}:{})
    });
    if(source) persistKonular(ders.id,newId,konular).catch(()=>{});
    window.clearDersRemoval?.(ders.id, newId, source?.json);   // bu derse eklendi → tombstone kalksın
    showToast(`${ad} eklendi ✓`,'success');
  }
  // Önce modalı kapat: persist/render bir hata verse bile modal takılı kalmasın.
  closeFasikulModal();
  try{ persistManifest(); renderDerslerGrid(); }catch(e){ console.error(e); }
  // Dersin fasikül panelini anında yenile, eklenen fasikül kartı beklemeden görünsün.
  refreshCurrentDrawerAfterFasikulSave(ders);
}
function silFasikul(){
  if(!window.currentDrawerDers) return;
  const editId = document.getElementById('fasikulEditId').value;
  if(!editId) return;
  const fas = window.currentDrawerDers.fasikuller.find(f=>f.id===editId);
  if(!fas) return;
  if(!confirm(`"${fas.ad}" fasiküle silmek istiyor musunuz?`)) return;
  window.currentDrawerDers.fasikuller = window.currentDrawerDers.fasikuller.filter(f=>f.id!==editId);
  // Konuları da sil
  try{ localStorage.removeItem(`edu_konular_${window.currentDrawerDers.id}_${editId}`); }catch(e){}
  window.recordDersRemoval?.(window.currentDrawerDers.id, editId, fas.jsonFile);   // bu dersten kalıcı sil
  // Başka derste kalmadıysa geri tohumlanmasın diye bastır.
  window.suppressBundledIfOrphan?.(editId, fas.jsonFile);
  persistManifest();
  renderFasikulCards(window.currentDrawerDers.fasikuller, window.currentDrawerDers);
  renderDerslerGrid();
  closeFasikulModal();
  showToast('Fasikül silindi 🗑️','success');
}

// ══════════════════════════════
// KÜTÜPHANE MODAL — Bundled fasiküllerden ekleme/çıkarma
// ══════════════════════════════
let _kutuphaneFasikulAll = []; // {source, raw, ders (config)}

async function openKutuphaneFasikulModal(targetDersId){
  // Hangi derse ekleneceğini belirle
  const modal = document.getElementById('kutuphaneFasikulModal');
  if(!modal) return;
  modal.classList.add('open');
  modal.dataset.targetDers = targetDersId || '';

  // Ders filtre dropdown'unu doldur
  const dersFilter = document.getElementById('kutuphaneDersFilter');
  if(dersFilter){
    const dersIds = [...new Set(window.BUNDLED_FASIKUL_SOURCES.map(s=>s.dersId))];
    dersFilter.innerHTML = '<option value="">Tüm Dersler</option>';
    dersIds.forEach(dId=>{
      const cfg = window.BUNDLED_DERS_CONFIG[dId] || {ad:dId};
      const opt = document.createElement('option');
      opt.value = dId; opt.textContent = `${cfg.ikon||''}${cfg.ad||dId}`;
      if(dId===targetDersId) opt.selected = true;
      dersFilter.appendChild(opt);
    });
  }

  // Seçilen ders göster/gizle butonu
  const btn = document.getElementById('kutuphaneDersSecBtn');
  if(btn) btn.style.display = targetDersId ? '' : 'none';

  // Listele
  const listWrap = document.getElementById('kutuphaneFasikulListWrap');
  if(listWrap) listWrap.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-muted)">⏳ Yükleniyor…</div>';

  // Tüm kaynakları önbelleğe al
  _kutuphaneFasikulAll = [];
  for(const source of window.BUNDLED_FASIKUL_SOURCES){
    const raw = await readBundledJson(source);
    _kutuphaneFasikulAll.push({source, raw});
  }
  filterKutuphaneFasikuller(document.getElementById('kutuphaneFasikulSearch')?.value||'');
}

function closeKutuphaneFasikulModal(){
  const modal = document.getElementById('kutuphaneFasikulModal');
  if(modal) modal.classList.remove('open');
}

function filterKutuphaneFasikuller(q=''){
  const listWrap = document.getElementById('kutuphaneFasikulListWrap');
  const dersFilter = document.getElementById('kutuphaneDersFilter');
  if(!listWrap) return;
  const dersId = dersFilter?.value || '';
  const lq = q.toLocaleLowerCase('tr-TR');

  let items = _kutuphaneFasikulAll.filter(({source, raw})=>{
    if(dersId && source.dersId !== dersId) return false;
    const name = raw?.ad || source.json;
    if(lq && !name.toLocaleLowerCase('tr-TR').includes(lq) && !source.json.toLocaleLowerCase('tr-TR').includes(lq)) return false;
    return true;
  });

  if(!items.length){
    listWrap.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-muted)">Fasikül bulunamadı</div>';
    return;
  }

  listWrap.innerHTML = '';
  items.forEach(({source, raw})=>{
    const cfg = window.BUNDLED_DERS_CONFIG[source.dersId] || {ad:source.dersId,ikon:'📚',renk:'var(--mat)'};
    const name = raw?.ad || source.json.replace(/\.json$/,'');
    const sinif = raw?.sinif || '?';
    const soruSayisi = raw?.soruSayisi || 0;
    const konuSayisi = raw?.konular?.length || 0;
    const thumb = raw?.thumb || '📄';

    // Hangi derslerde zaten var?
    const existingDersIds = window.MANIFEST.dersler
      .filter(d => d.fasikuller?.some(f=>f.id===source.id))
      .map(d=>d.id);

    const tagsHtml = existingDersIds.map(dId=>{
      const dc = window.BUNDLED_DERS_CONFIG[dId] || window.MANIFEST.dersler.find(d=>d.id===dId);
      const dAd = dc?.ad || dId;
      return `<span style="background:var(--green-dim);color:var(--green);padding:2px 8px;border-radius:99px;font-size:10px;font-weight:600">✓ ${dAd}</span>`;
    }).join('');

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--bg-3);border-radius:var(--radius-sm);border:1px solid var(--border)';
    row.innerHTML = `
      <div style="font-size:26px;flex-shrink:0">${thumb}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:13px;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}</div>
        <div style="font-size:11px;color:var(--text-muted);display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <span style="color:${cfg.renk||'var(--mat)'}">${cfg.ikon||''}${cfg.ad}</span>
          <span>${sinif}. Sınıf</span>
          <span>${konuSayisi} konu</span>
          <span>${soruSayisi} soru</span>
          ${tagsHtml}
        </div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:3px;opacity:.6">${source.json}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
        ${_buildKutuphaneBtns(source, existingDersIds)}
      </div>
    `;
    listWrap.appendChild(row);
  });
}

function _buildKutuphaneBtns(source, existingDersIds){
  // Her ders için ekle/çıkar butonu
  const targetDers = document.getElementById('kutuphaneFasikulModal')?.dataset?.targetDers;
  let btns = '';

  window.MANIFEST.dersler.forEach(ders=>{
    const isIn = existingDersIds.includes(ders.id);
    const highlight = ders.id === targetDers ? 'font-weight:700;' : '';
    if(isIn){
      btns += `<button onclick="kutuphaneCikar('${source.id}','${ders.id}')" title="${ders.ad}'dan çıkar"
        style="${highlight}padding:4px 8px;border-radius:6px;font-size:10px;background:var(--red-dim);color:var(--red);cursor:pointer;border:none;white-space:nowrap">
        ✕ ${ders.ikon||ders.ad}</button>`;
    } else {
      btns += `<button onclick="kutuphaneDersEkle('${source.id}','${ders.id}')" title="${ders.ad}'a ekle"
        style="${highlight}padding:4px 8px;border-radius:6px;font-size:10px;background:var(--bg-4);color:var(--text-1);cursor:pointer;border:none;white-space:nowrap">
        + ${ders.ikon||ders.ad}</button>`;
    }
  });
  return btns;
}

async function kutuphaneDersEkle(sourceId, dersId){
  const source = window.BUNDLED_FASIKUL_SOURCES.find(s=>s.id===sourceId);
  if(!source){ showToast('Kaynak bulunamadı','error'); return; }
  let ders = window.MANIFEST.dersler.find(d=>d.id===dersId);
  if(!ders){ showToast('Ders bulunamadı','error'); return; }
  if(ders.fasikuller.some(f=>f.id===source.id)){ showToast('Zaten ekli','info'); return; }
  window.removeDeletedBundledId?.(source.id);   // önceden bastırıldıysa geri getir
  window.clearDersRemoval?.(dersId, source.id, source.json);   // bu derse tekrar eklendi → tombstone kalksın

  const raw = await readBundledJson(source);
  const cfg = window.BUNDLED_DERS_CONFIG[dersId] || {};
  const thumbBgMap = {'var(--mat)':'linear-gradient(135deg,#312e81,#1e1b4b)','var(--fiz)':'linear-gradient(135deg,#164e63,#0c4a6e)','var(--kim)':'linear-gradient(135deg,#064e3b,#052e16)','var(--bio)':'linear-gradient(135deg,#431407,#450a0a)','var(--tar)':'linear-gradient(135deg,#500724,#2d1657)','var(--edb)':'linear-gradient(135deg,#2e1065,#1a0533)'};
  const thumbBg = thumbBgMap[ders.renk] || 'linear-gradient(135deg,#312e81,#1e1b4b)';
  const konular = raw?.konular ? normalizeFasikulKonular([...raw.konular]) : [];
  ders.fasikuller.push({
    id: source.id,
    ad: raw?.ad || source.id,
    thumb: raw?.thumb || '📄',
    thumbBg,
    sinif: bundledSinif(raw?.sinif),
    konular,
    konuSayisi: konular.length,
    soruSayisi: konular.reduce((s,k)=>s+(k.altKonular||[]).reduce((s2,ak)=>s2+(ak.sorular||[]).length,0),0),
    progPct: 0,
    sonCalisma: 'Yeni eklendi',
    jsonFile: source.json,
    pdfFile: source.pdf,
    sourceType: 'bundled'
  });
  persistManifest();
  renderDerslerGrid();
  showToast(`✓ "${raw?.ad||source.id}" ${ders.ad}'a eklendi`,'success');
  // Listeyi yenile
  filterKutuphaneFasikuller(document.getElementById('kutuphaneFasikulSearch')?.value||'');
}

function kutuphaneCikar(sourceId, dersId){
  const ders = window.MANIFEST.dersler.find(d=>d.id===dersId);
  if(!ders) return;
  const fas = ders.fasikuller.find(f=>f.id===sourceId);
  if(!fas) return;
  if(!confirm(`"${fas.ad}" fasiküle "${ders.ad}" dersinden çıkarılsın mı?`)) return;
  ders.fasikuller = ders.fasikuller.filter(f=>f.id!==sourceId);
  try{ localStorage.removeItem(`edu_konular_${dersId}_${sourceId}`); }catch(e){}
  window.recordDersRemoval?.(dersId, sourceId, fas.jsonFile);   // bu dersten kalıcı sil
  // Başka derste kalmadıysa geri tohumlanmasın diye bastır.
  window.suppressBundledIfOrphan?.(sourceId, fas.jsonFile);
  persistManifest();
  renderDerslerGrid();
  showToast(`Fasikül "${ders.ad}"dan çıkarıldı 🗑️`,'success');
  filterKutuphaneFasikuller(document.getElementById('kutuphaneFasikulSearch')?.value||'');
}

function kutuphaneDersSec(){
  const modal = document.getElementById('kutuphaneFasikulModal');
  const targetDersId = modal?.dataset?.targetDers;
  if(!targetDersId){ showToast('Hedef ders seçilmedi','error'); return; }
  closeKutuphaneFasikulModal();
  openDrawer(targetDersId);
}

function downloadOrnekJson(format){
  // FORMAT A: çoklu soru (bir sayfada birden fazla soru) — altKonular yapısı
  const sampleA = {
    "ad": "Fasikül Adı (Çoklu Soru)",
    "sinif": 10,
    "soruSayisi": 4,
    "konuSayisi": 2,
    "thumb": "📐",
    "konular": [
      {
        "id": "konu-1",
        "ad": "Birinci Konu",
        "sayfaBasl": 1,
        "sayfaBitis": 5,
        "altKonular": [
          {
            "id": "alt-konu-1-1",
            "ad": "Alt Konu 1.1",
            "sayfa": 1,
            "sorular": [
              { "no": 1, "onizleme": "Soru 1 metni (kısa özet)", "cevap": "A", "zorluk": "kolay" },
              { "no": 2, "onizleme": "Soru 2 metni", "cevap": "C", "zorluk": "orta" }
            ]
          }
        ]
      }
    ]
  };
  // FORMAT B: kart bazlı (her sayfada bir soru) — sorular konunun altında, her soruda sayfa
  const sampleB = {
    "ad": "Fasikül Adı (Kart Bazlı - Her Sayfada 1 Soru)",
    "sinif": 10,
    "soruSayisi": 4,
    "konuSayisi": 2,
    "thumb": "📐",
    "konular": [
      {
        "id": "test-1",
        "ad": "Test 1",
        "sayfaBasl": 1,
        "sayfaBitis": 4,
        "soruSayisi": 4,
        "sorular": [
          { "no": 1, "sayfa": 1, "cevap": "E" },
          { "no": 2, "sayfa": 2, "cevap": "A" },
          { "no": 3, "sayfa": 3, "cevap": "C" },
          { "no": 4, "sayfa": 4, "cevap": "B" }
        ]
      }
    ]
  };
  const sample = (format === 'B') ? sampleB : sampleA;
  const blob = new Blob([JSON.stringify(sample, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = format === 'B' ? 'fasikul_kartbazli_ornek.json' : 'fasikul_coklusoru_ornek.json';
  a.click();
  showToast(`Örnek JSON şablonu indirildi (Format ${format||'A'}) 📋`,'success');
}

// ── Window exports ──
window.renderDate = renderDate;
window.renderMathSymbols = renderMathSymbols;
window.renderStreakDots = renderStreakDots;
window.toggleTheme = toggleTheme;
window.visibleFasikullerFor = visibleFasikullerFor;
window.filterFasikuller = filterFasikuller;
window.setFasikulTheme = setFasikulTheme;
window.moveFasikul = moveFasikul;
window.reorderFasikulByDrop = reorderFasikulByDrop;
window.moveFasikulToDers = moveFasikulToDers;
window.toggleFasikulMenu = toggleFasikulMenu;
window.openLastFasikul = openLastFasikul;
window.safeDateKey = safeDateKey;
window.getDailyCounts = getDailyCounts;
window.calcCurrentStreak = calcCurrentStreak;
window.resetFasikulData = resetFasikulData;
window.applyDemoStats = applyDemoStats;
window.applyDemoMode = applyDemoMode;
window.toggleDemoData = toggleDemoData;
window.openDersModal = openDersModal;
window.openAltDersModal = openAltDersModal;
window.closeDersModal = closeDersModal;
window.selectDersRenk = selectDersRenk;
window.saveDers = saveDers;
window.silDers = silDers;
window.openFasikulModal = openFasikulModal;
window.closeFasikulModal = closeFasikulModal;
window.saveFasikul = saveFasikul;
window.silFasikul = silFasikul;
window.populateFasikulSourceSelect = populateFasikulSourceSelect;
window.applyBundledSourceToForm = applyBundledSourceToForm;
window.openKutuphaneFasikulModal = openKutuphaneFasikulModal;
window.closeKutuphaneFasikulModal = closeKutuphaneFasikulModal;
window.filterKutuphaneFasikuller = filterKutuphaneFasikuller;
window.kutuphaneDersEkle = kutuphaneDersEkle;
window.kutuphaneCikar = kutuphaneCikar;
window.kutuphaneDersSec = kutuphaneDersSec;
window.downloadOrnekJson = downloadOrnekJson;
