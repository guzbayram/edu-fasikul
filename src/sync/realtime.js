import { appState } from '../state/appState.js';

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
      const aktifId = appState.aktifFasikul?.id;
      const currentPage = appState.currentPage;
      const currentKey = aktifId ? `drawing_${aktifId}_p${currentPage}` : null;
      if(currentKey === key){
        const fc = appState.fabricCanvases?.[currentPage] || appState.fabricCanvas;
        if(fc){
          fc.loadFromJSON(data.json, ()=>{ fc.renderAll(); });
        } else {
          setTimeout(()=>{
            const fc2 = appState.fabricCanvases?.[currentPage] || appState.fabricCanvas;
            if(fc2 && appState.drawings[key]) fc2.loadFromJSON(appState.drawings[key], ()=>fc2.renderAll());
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
}
