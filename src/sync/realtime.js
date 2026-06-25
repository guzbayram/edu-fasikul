import { appState } from '../state/appState.js';
import { _getUserKey } from '../firebase/firestore.js';

// ══════════════════════════════════════════════════════════
// CANLI DERS — aynı hesapta iki cihaz arasında sayfa/konu eşitleme
// Çift yönlü ayna: hangi cihaz gezinirse diğeri takip eder.
// (Çizim/çözüm senkronu zaten cizimler/cozumler ile canlı.)
// ══════════════════════════════════════════════════════════
let _canliUnsub = null;
let _publishTimer = null;

function _liveDeviceId(){
  if(!appState._liveDeviceId)
    appState._liveDeviceId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  return appState._liveDeviceId;
}

export function publishCanli(){
  if(!appState.liveSession || appState._liveSuppress) return;
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
    if(appState.liveSession) _followCanli(d);
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
    publishCanli();
    window.showToast?.('Canlı Ders açık — sayfalar eşlenecek 👀','success');
  } else {
    unsubscribeCanli();
    window.showToast?.('Canlı Ders kapalı','info');
  }
}

export function startRealtimeSync(uid){
  stopRealtimeSync();
  if(!window._fsOnSnapshot || !window._db) return;

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

  // ── Çizimleri dinle ──
  const cizimlerRef = window._fsCollection(window._db,'kullanicilar',uid,'cizimler');
  window._realtimeUnsubCizimler = window._fsOnSnapshot(cizimlerRef, (snapshot)=>{
    snapshot.docChanges().forEach(change=>{
      if(change.type==='removed') return;
      if(change.doc.metadata.hasPendingWrites) return;
      const data = change.doc.data();
      const key = data.key;
      if(!key || !data.json) return;
      if(appState.drawings[key] === data.json) return;
      appState.drawings[key] = data.json;
      if(data.w && data.h) appState.drawingDims[key] = {w:data.w, h:data.h};
      const aktifId = appState.aktifFasikul?.id;
      const currentPage = appState.currentPage;
      const currentKey = aktifId ? `drawing_${aktifId}_p${currentPage}` : null;
      if(currentKey === key){
        const fc = appState.fabricCanvases?.[currentPage] || appState.fabricCanvas;
        if(fc){
          fc.loadFromJSON(data.json, ()=>{ window.applyDrawingScale?.(fc, key); fc.renderAll(); });
        } else {
          setTimeout(()=>{
            const fc2 = appState.fabricCanvases?.[currentPage] || appState.fabricCanvas;
            if(fc2 && appState.drawings[key]) fc2.loadFromJSON(appState.drawings[key], ()=>{ window.applyDrawingScale?.(fc2, key); fc2.renderAll(); });
          }, 1500);
        }
      }
    });
  }, (err)=>{
    console.warn('Cizimler onSnapshot hatası:',err);
    window.showToast?.('Çizim senkronizasyonu kesildi','error');
  });

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
  if(window._realtimeUnsubCizimler){ window._realtimeUnsubCizimler(); window._realtimeUnsubCizimler=null; }
  if(window._realtimeUnsubHatalilar){ window._realtimeUnsubHatalilar(); window._realtimeUnsubHatalilar=null; }
  unsubscribeCanli();
  appState.liveSession = false;
  document.querySelectorAll('.live-session-btn').forEach(b=>b.classList.remove('active'));
}
