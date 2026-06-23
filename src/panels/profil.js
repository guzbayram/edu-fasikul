import { appState } from '../state/appState.js';
import { _getUserKey, _userDocRef, scheduleCloudPersist } from '../firebase/firestore.js';

function savePreferences(){ localStorage.setItem('edu_preferences',JSON.stringify(appState.preferences)); scheduleCloudPersist(); }
function loadPreferences(){
  try{
    const saved=JSON.parse(localStorage.getItem('edu_preferences')||'null');
    if(saved){
      if(typeof saved.sound==='boolean') appState.preferences.sound=saved.sound;
      if(typeof saved.autoNext==='boolean') appState.preferences.autoNext=saved.autoNext;
      if(Number.isFinite(Number(saved.goal))) appState.preferences.goal=Math.min(300,Math.max(5,Number(saved.goal)));
    }
  }catch(e){}
  const sound=document.getElementById('soundToggle');
  if(sound){sound.textContent=appState.preferences.sound?'Açık':'Kapalı';sound.classList.toggle('off',!appState.preferences.sound);}
  const auto=document.getElementById('autoNextToggle');
  if(auto){auto.textContent=appState.preferences.autoNext?'Açık':'Kapalı';auto.classList.toggle('off',!appState.preferences.autoNext);}
  const slider=document.getElementById('goalSlider');
  if(slider) slider.value=appState.preferences.goal;
  updateGoal(appState.preferences.goal,false);
}
function toggleSound(btn){ appState.preferences.sound=!appState.preferences.sound;btn.textContent=appState.preferences.sound?'Açık':'Kapalı';btn.classList.toggle('off',!appState.preferences.sound);savePreferences(); }
function toggleAutoNext(btn){ appState.preferences.autoNext=!appState.preferences.autoNext;btn.textContent=appState.preferences.autoNext?'Açık':'Kapalı';btn.classList.toggle('off',!appState.preferences.autoNext);savePreferences(); }
function updateGoal(v,persist=true){ const goal=Math.min(300,Math.max(5,parseInt(v)||100));document.getElementById('goalVal').textContent=`${goal} soru`;document.getElementById('goalDisplay').textContent=`${goal} soru`;appState.preferences.goal=goal;if(persist)savePreferences(); }
function cycleAvatar(){ appState.avatarIdx=(appState.avatarIdx+1)%appState.avatarEmojis.length; const em=appState.avatarEmojis[appState.avatarIdx]; document.getElementById('profilAvatar').textContent=em; document.getElementById('avatarBtn').textContent=em; }
function exportData(){ const d={user:appState.user,hatalilar:appState.hatalilar,drawings:Object.keys(appState.drawings)}; const b=document.createElement('a'); b.href='data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(d,null,2)); b.download='edufasikuler_data.json'; b.click(); showToast('Veriler indirildi ✓','success'); }
async function resetAllData(){
  if(!confirm('Tüm veriler (hatalılar, cevaplar, çizimler, ders/fasikül değişiklikleri ve yüklenen JSON\'lar) silinecek. Bu işlem geri alınamaz. Emin misiniz?')) return;

  // 1) Bellek temizle
  appState.hatalilar = [];
  appState.sorularState = {};
  appState.drawings = {};
  appState.cloudIstatistik = null;
  appState.cloudSolutionsLoaded = false;

  // 2) localStorage temizle
  const keysToRemove = [];
  for(let i=0;i<localStorage.length;i++){
    const k = localStorage.key(i);
    if(k && (k.startsWith('edu_konular_') || k==='edu_hatalilar' || k==='edu_sorularState' || k==='edu_manifest_meta' || k==='edu_deleted_dersler')) keysToRemove.push(k);
  }
  keysToRemove.forEach(k=>localStorage.removeItem(k));

  // 3) Manifest konularını ve ilerlemeyi sıfırla
  window.MANIFEST.dersler.forEach(d=>{
    d.progPct = 0;
    d.fasikuller.forEach(f=>{ f.konular=[]; f.progPct=0; f._solvedCount=0; f.sonCalisma='—'; });
  });
  document.getElementById('hataliCount').textContent = '0';
  document.getElementById('hataliCountBig').textContent = '0 Soru';

  // 4) Firestore temizle (cozumler + cizimler alt koleksiyonları + istatistik alanı)
  const uid = _getUserKey();
  if(uid && window._firestoreReady){
    showToast('Bulut verileri siliniyor…','info');
    try{
      // cozumler alt koleksiyonu
      const cSnap = await window._fsGetDocs(window._fsCollection(window._db,'kullanicilar',uid,'cozumler'));
      const cDels=[]; cSnap.forEach(d=>cDels.push(window._fsDeleteDoc(d.ref)));
      await Promise.all(cDels);
      // cizimler alt koleksiyonu
      const dSnap2 = await window._fsGetDocs(window._fsCollection(window._db,'kullanicilar',uid,'cizimler'));
      const dDels=[]; dSnap2.forEach(d=>dDels.push(window._fsDeleteDoc(d.ref)));
      await Promise.all(dDels);
      // Ana belgedeki istatistik, hatalilar, fasikulIstatistik alanlarını sıfırla
      const emptyStats = {toplam:0,dogru:0,yanlis:0,bos:0,konular:{}};
      await window._fsSetDoc(_userDocRef(uid),{
        hatalilar:[],
        istatistik: emptyStats,
        fasikulIstatistik:{},
        guncelleme: new Date().toISOString()
      },{merge:true});
    }catch(e){ console.warn('Firestore sıfırlama hatası:',e); showToast('Bulut temizleme kısmi başarısız','error'); }
  }

  // 5) Demo modu kapat
  applyDemoMode(false);
  const demoToggle = document.getElementById('demoDataToggle');
  if(demoToggle){ demoToggle.textContent='Kapalı'; demoToggle.classList.add('off'); }
  localStorage.setItem('edu_demo_mode','0');

  recalcFasikulProgress();
  updateDashboard();
  renderDerslerGrid();
  showToast('Tüm veriler sıfırlandı 🗑️','success');
}

// ── Window exports ──
window.savePreferences = savePreferences;
window.loadPreferences = loadPreferences;
window.toggleSound = toggleSound;
window.toggleAutoNext = toggleAutoNext;
window.updateGoal = updateGoal;
window.cycleAvatar = cycleAvatar;
window.exportData = exportData;
window.resetAllData = resetAllData;
