import { appState } from '../state/appState.js';
import { _getUserKey } from '../firebase/firestore.js';

// ══════════════════════════════════════════════════════════
// CANLI DERS — aynı hesapta iki cihaz arasında sayfa/konu eşitleme
// Çift yönlü ayna: hangi cihaz gezinirse diğeri takip eder.
// Çizim aynalama yalnız canlı ders açıkken çalışır; kapalıyken bulut yedekleme
// sürer ama başka açık cihazın canvas'ına anlık uygulanmaz.
// ══════════════════════════════════════════════════════════
let _canliUnsub = null;
let _publishTimer = null;
const DRAWING_REMOTE_EDIT_GUARD_MS = 3500;

function _liveDeviceId(){
  if(!appState._liveDeviceId)
    appState._liveDeviceId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  return appState._liveDeviceId;
}

export function publishCanli(){
  if(appState.watchMode) return;   // izleyen öğretmen kendi konumunu yayınlamaz
  // Yayın koşulu: elle açılan Canlı Ders VEYA öğrenci için otomatik yayın açık
  if((!appState.liveSession && !appState.autoPublishLive) || appState._liveSuppress) return;
  const uid = _getUserKey();
  const fas = appState.aktifFasikul;
  if(!uid || !fas || !window._firestoreReady || !window._db) return;
  clearTimeout(_publishTimer);
  _publishTimer = setTimeout(()=>{
    // Kullanıcı dokümanına yaz (cizimler/cozumler gibi kesinlikle izinli yol).
    const ref = window._fsDoc(window._db,'kullanicilar',uid);
    window._fsSetDoc(ref, { canli:{
      dersId: appState.aktifDers?.id || '',
      fasikulId: fas.id,
      page: appState.currentPage || 1,
      altKonuId: appState.aktifAltKonu?.id || '',
      by: _liveDeviceId(),
      ts: Date.now()
    }}, {merge:true}).catch(e=>console.warn('Canlı yayın hatası:',e));
  }, 200);
}

async function _followCanli(d){
  appState._liveSuppress = true;
  try{
    if(d.fasikulId && appState.aktifFasikul?.id !== d.fasikulId){
      await window.openReader?.(d.dersId, d.fasikulId);
    }
    if(d.altKonuId && appState.aktifAltKonu?.id !== d.altKonuId){
      let foundAk = null;
      (appState.aktifFasikul?.konular||[]).forEach(k=>(k.altKonular||[]).forEach(ak=>{ if(ak.id===d.altKonuId) foundAk=ak; }));
      if(foundAk) window.selectAltKonu?.(foundAk, `altk-${foundAk.id}`);
    }
    if(d.page && appState.currentPage !== d.page){
      window.goToPage?.(d.page);
    }
  }catch(e){ console.warn('Canlı takip hatası:',e); }
  finally{ setTimeout(()=>{ appState._liveSuppress = false; }, 500); }
}

export function subscribeCanli(uid){
  unsubscribeCanli();
  if(!window._fsOnSnapshot || !window._db || !uid) return;
  const ref = window._fsDoc(window._db,'kullanicilar',uid);
  _canliUnsub = window._fsOnSnapshot(ref, (snap)=>{
    if(!snap.exists() || snap.metadata.hasPendingWrites) return;
    const d = snap.data()?.canli;
    if(!d || d.by === _liveDeviceId()) return;             // kendi yazdığımız
    if(d.ts && d.ts <= (appState._lastCanliTs||0)) return; // zaten uygulandı
    appState._lastCanliTs = d.ts || Date.now();
    appState._watchGotData = true;   // izleme modu: en az bir veri geldi
    if(appState.liveSession || appState.watchMode) _followCanli(d);
  }, (err)=>console.warn('Canlı dinleme hatası:',err));
}
export function unsubscribeCanli(){ if(_canliUnsub){ _canliUnsub(); _canliUnsub=null; } }

export function toggleLiveSession(){
  const uid = _getUserKey();
  if(!uid || appState.user?.email === 'misafir@demo.com'){
    window.showToast?.('Canlı Ders için hesabınla giriş yapmalısın','info'); return;
  }
  appState.liveSession = !appState.liveSession;
  document.querySelectorAll('.live-session-btn').forEach(b=>b.classList.toggle('active', appState.liveSession));
  if(appState.liveSession){
    subscribeCanli(uid);
    subscribeRealtimeDrawings(uid);
    publishCanli();
    window.showToast?.('Canlı Ders açık — sayfalar eşlenecek 👀','success');
  } else {
    unsubscribeCanli();
    unsubscribeRealtimeDrawings();
    window.showToast?.('Canlı Ders kapalı','info');
  }
}

// ══════════════════════════════════════════════════════════
// ÖĞRETMEN — bir öğrenciyi CANLI İZLE
// Öğrenci konumunu otomatik yayınlar (autoPublishLive). Öğretmen o öğrencinin
// kullanicilar/{uid}/canli ve .../cizimler yollarını dinleyip aynı sayfayı +
// çizimleri kendi ekranında görür. İzleyen taraf hiçbir şey yayınlamaz.
// ══════════════════════════════════════════════════════════
function _escName(s){
  return String(s||'').replace(/[<>&"]/g, c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
}
function _showWatchBanner(name){
  let b = document.getElementById('watchLiveBanner');
  if(!b){
    b = document.createElement('div');
    b.id = 'watchLiveBanner';
    b.className = 'watch-live-banner';
    document.body.appendChild(b);
  }
  b.innerHTML = `<span class="wlb-dot"></span>`
    + `<span class="wlb-txt"><b>${_escName(name)||'Öğrenci'}</b> canlı izleniyor</span>`
    + `<button class="wlb-stop" onclick="stopWatchStudent()">Durdur</button>`;
  b.style.display = 'flex';
}
function _hideWatchBanner(){ const b=document.getElementById('watchLiveBanner'); if(b) b.style.display='none'; }

export function watchStudentLive(studentUid, studentName){
  if(!studentUid){ window.showToast?.('Öğrenci seçilemedi','error'); return; }
  if(!window._firestoreReady || !window._db){ window.showToast?.('Bağlantı hazır değil, birazdan tekrar dene','info'); return; }
  // Önceki izleme/canlı ders varsa temizle
  if(appState.liveSession){ appState.liveSession=false; document.querySelectorAll('.live-session-btn').forEach(b=>b.classList.remove('active')); }
  stopWatchStudent(true);
  appState.watchMode = true;
  appState._watchStudentUid = studentUid;
  appState._watchGotData = false;
  appState._lastCanliTs = 0;   // yeni öğrencinin ilk konumu uygulanabilsin
  subscribeCanli(studentUid);
  subscribeRealtimeDrawings(studentUid);
  _showWatchBanner(studentName);
  window.showToast?.(`🔴 ${studentName||'Öğrenci'} canlı izleniyor`,'success');
  // Öğrenci çevrimdışıysa / hiç yayın yoksa bilgilendir
  clearTimeout(appState._watchProbe);
  appState._watchProbe = setTimeout(()=>{
    if(appState.watchMode && !appState._watchGotData)
      window.showToast?.('Öğrenci şu an çevrimdışı görünüyor · uygulamayı açıp sayfa gezdiğinde ekranına gelecek','info');
  }, 5000);
}

export function stopWatchStudent(silent){
  const wasWatching = appState.watchMode;
  appState.watchMode = false;
  appState._watchStudentUid = null;
  clearTimeout(appState._watchProbe);
  unsubscribeCanli();
  unsubscribeRealtimeDrawings();
  _hideWatchBanner();
  if(wasWatching && !silent) window.showToast?.('Canlı izleme durduruldu','info');
}

function subscribeRealtimeDrawings(uid){
  unsubscribeRealtimeDrawings();
  if((!appState.liveSession && !appState.watchMode) || !window._fsOnSnapshot || !window._db || !uid) return;
  const cizimlerRef = window._fsCollection(window._db,'kullanicilar',uid,'cizimler');
  window._realtimeUnsubCizimler = window._fsOnSnapshot(cizimlerRef, (snapshot)=>{
    snapshot.docChanges().forEach(change=>{
      if(change.type==='removed') return;
      if(change.doc.metadata.hasPendingWrites) return;
      const data = change.doc.data();
      const key = data.key;
      if(!key || !data.json) return;
      if(data.by && data.by === appState._cloudDeviceId) return;
      if(appState.drawings[key] === data.json) return;
      const remoteUpdatedAt = Number(data.updatedAtMs || Date.parse(data.updatedAt || '')) || 0;
      const localEditAt = Number(appState.drawingLocalEditAt?.[key] || 0);
      const lastRemoteAt = Number(appState.drawingRemoteUpdatedAt?.[key] || 0);
      if(remoteUpdatedAt && lastRemoteAt && remoteUpdatedAt < lastRemoteAt) return;
      const aktifId = appState.aktifFasikul?.id;
      const currentPage = appState.currentPage;
      const currentKey = aktifId ? `drawing_${aktifId}_p${currentPage}` : null;
      const isCurrentCanvas = currentKey === key;
      const localIsNewer = localEditAt && remoteUpdatedAt && remoteUpdatedAt < localEditAt;
      const localIsActive = isCurrentCanvas && Date.now() - (appState._lastCanvasDrawTapAt || 0) < DRAWING_REMOTE_EDIT_GUARD_MS;
      if(localIsNewer || localIsActive){
        appState.pendingRemoteDrawings[key] = data;
        return;
      }
      appState.drawings[key] = data.json;
      if(data.w && data.h) appState.drawingDims[key] = {w:data.w, h:data.h};
      if(currentKey === key){
        const fc = appState.fabricCanvases?.[currentPage] || appState.fabricCanvas;
        if(fc){
          loadRealtimeDrawing(fc, key, data);
        } else {
          setTimeout(()=>{
            const fc2 = appState.fabricCanvases?.[currentPage] || appState.fabricCanvas;
            if(fc2 && appState.drawings[key]) loadRealtimeDrawing(fc2, key, data);
          }, 1500);
        }
      }
      if(remoteUpdatedAt) appState.drawingRemoteUpdatedAt[key] = remoteUpdatedAt;
    });
  }, (err)=>{
    console.warn('Cizimler onSnapshot hatası:',err);
    window.showToast?.('Çizim senkronizasyonu kesildi','error');
  });
}

function loadRealtimeDrawing(fc, key, data){
  if(!fc || !data?.json) return;
  fc._applyingRemoteDrawing = true;
  try{
    fc.loadFromJSON(data.json, ()=>{
      window.applyDrawingScale?.(fc, key);
      fc._applyingRemoteDrawing = false;
      fc.renderAll();
    });
  }catch(e){
    fc._applyingRemoteDrawing = false;
    console.warn('Canlı çizim yüklenemedi:', e);
  }
}

function unsubscribeRealtimeDrawings(){
  if(window._realtimeUnsubCizimler){
    window._realtimeUnsubCizimler();
    window._realtimeUnsubCizimler = null;
  }
}

export function startRealtimeSync(uid){
  stopRealtimeSync();
  if(!window._fsOnSnapshot || !window._db) return;

  // Öğrenci hesapları konumunu otomatik yayınlar → öğretmen elle bir şey
  // yapmadan canlı izleyebilir. Öğretmen/yönetici/misafir yayın yapmaz.
  appState.autoPublishLive = appState.user?.role === 'ogrenci'
    && appState.user?.email !== 'misafir@demo.com';

  // ── Cevapları dinle ──
  const cozumlerRef = window._fsCollection(window._db,'kullanicilar',uid,'cozumler');
  window._realtimeUnsubCozumler = window._fsOnSnapshot(cozumlerRef, (snapshot)=>{
    let changed = false;
    snapshot.docChanges().forEach(change=>{
      if(change.type==='removed') return;
      const data = change.doc.data();
      const soruKey = data.soruKey || decodeURIComponent(change.doc.id);
      if(!soruKey) return;
      const existing = appState.sorularState[soruKey];
      const incomingTarih = data.tarih || '';
      if(change.doc.metadata.hasPendingWrites) return;
      if(!existing || incomingTarih > (existing.tarih||'') || !existing._synced){
        appState.sorularState[soruKey] = {
          answered:true, selected:data.ogrenciCevap??null,
          correct:data.dogru===true, skipped:data.atladi===true,
          correct_answer:data.dogruCevap||'', timeSec:data.sureSaniye||0,
          fasikulId:data.fasikulId||'', fasikulAd:data.fasikulAd||'',
          konu:data.konu||'', altKonu:data.altKonu||'', zorluk:data.zorluk||'',
          tarih:incomingTarih, _synced:true
        };
        changed = true;
      }
    });
    if(changed){
      localStorage.setItem('edu_sorularState', JSON.stringify(appState.sorularState));
      appState.cloudSolutionsLoaded = true;
      window.recalcFasikulProgress?.();
      window.updateDashboard?.();
      if(typeof window.renderDerslerGrid==='function') window.renderDerslerGrid();
      const readerOpen = document.getElementById('reader-overlay')?.classList.contains('open');
      if(readerOpen){
        window.updateTestProgress?.();
        if(appState.aktifAltKonu?.sorular) window.renderSoruStrip?.(appState.aktifAltKonu.sorular);
      }
    }
  }, (err)=>{ console.warn('Cozumler onSnapshot hatası:',err); });

  // ── Hatalıları dinle ──
  const hatalilarRef = window._fsCollection(window._db,'kullanicilar',uid,'hatalilar');
  window._realtimeUnsubHatalilar = window._fsOnSnapshot(hatalilarRef, (snapshot)=>{
    if(snapshot.metadata.hasPendingWrites) return;
    const hatalilar = [];
    snapshot.forEach(doc => hatalilar.push(doc.data()));
    appState.hatalilar = hatalilar;
    try{ localStorage.setItem('edu_hatalilar',JSON.stringify(hatalilar)); }catch(e){}
    const n = hatalilar.length;
    document.getElementById('hataliCount').textContent = n;
    document.getElementById('hataliCountBig').textContent = `${n} Soru`;
    window.renderHatalilar?.();
  }, (err)=>{ console.warn('Hatalilar onSnapshot hatası:',err); });
}

export function stopRealtimeSync(){
  if(window._realtimeUnsubCozumler){ window._realtimeUnsubCozumler(); window._realtimeUnsubCozumler=null; }
  unsubscribeRealtimeDrawings();
  if(window._realtimeUnsubHatalilar){ window._realtimeUnsubHatalilar(); window._realtimeUnsubHatalilar=null; }
  unsubscribeCanli();
  appState.liveSession = false;
  appState.autoPublishLive = false;
  stopWatchStudent(true);
  document.querySelectorAll('.live-session-btn').forEach(b=>b.classList.remove('active'));
}
