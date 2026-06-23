import { appState } from '../state/appState.js';

// ── Yardımcı fonksiyonlar ─────────────────────────────────────────

export function _getUserKey(){
  if(!appState.user) return null;
  return appState.user.uid || appState.user.email.replace(/[^a-zA-Z0-9]/g,'_');
}

export function _safeDocId(value){ return encodeURIComponent(String(value||'')).replace(/\./g,'%2E'); }

export function _userDocRef(uid=_getUserKey()){
  if(!uid || !window._firestoreReady) return null;
  return window._fsDoc(window._db,'kullanicilar',uid);
}

export function scheduleCloudPersist(){
  if(!appState.user || appState.user.email==='misafir@demo.com') return;
  if(appState._cloudPersistTimer) clearTimeout(appState._cloudPersistTimer);
  appState._cloudPersistTimer=setTimeout(()=>persistData(),900);
}

export function _canonicalAnswerKey(key,s){
  const fid=String(s?.fasikulId||'');
  let base=String(key||'');
  if(fid && base.startsWith(`${fid}__`)) base=base.slice(fid.length+2);
  return `${fid}__${base}`;
}

export function getAnsweredRecords(){
  const seenObjects=new Set(), seenKeys=new Set(), records=[];
  Object.entries(appState.sorularState||{}).forEach(([key,s])=>{
    if(!s || !s.answered || seenObjects.has(s)) return;
    const canonical=_canonicalAnswerKey(key,s);
    if(seenKeys.has(canonical)) return;
    seenObjects.add(s); seenKeys.add(canonical); records.push(s);
  });
  return records;
}

export function _hesaplaIstatistik(records=getAnsweredRecords()){
  let toplam=0, dogru=0, yanlis=0, bos=0;
  const konular = {};
  records.forEach(s=>{
    toplam++;
    const konu = s.konu || 'Diğer';
    if(!konular[konu]) konular[konu]={dogru:0, yanlis:0};
    if(s.skipped){ bos++; }
    else if(s.correct){ dogru++; konular[konu].dogru++; }
    else { yanlis++; konular[konu].yanlis++; }
  });
  return {toplam, dogru, yanlis, bos, konular};
}

export function _hesaplaFasikulIstatistik(){
  const fasikuller = {};
  (appState.hatalilar||[]).forEach(h=>{
    const fid = h.fasikulId || 'bilinmiyor';
    if(!fasikuller[fid]) fasikuller[fid]={fasikulAd:h.fasikulAd||fid, dersId:h.ders||'', dersAd:h.dersAd||'', hataSayisi:0, konular:{}};
    fasikuller[fid].hataSayisi++;
    const konu = h.konu || 'Diğer';
    fasikuller[fid].konular[konu] = (fasikuller[fid].konular[konu]||0) + 1;
  });
  return fasikuller;
}

export function getDashboardStats(){
  const records=getAnsweredRecords();
  const calculated=_hesaplaIstatistik();
  const cloud=appState.cloudIstatistik||{};
  const cloudTotal=Number(cloud.toplam||0);
  const useCalculated=appState.cloudSolutionsLoaded || cloudTotal===0;
  const pending=useCalculated ? {toplam:0,dogru:0,yanlis:0,bos:0,konular:{}} : _hesaplaIstatistik(records.filter(s=>!s._synced));
  const toplam=useCalculated ? calculated.toplam : cloudTotal+pending.toplam;
  const dogru=useCalculated ? calculated.dogru : Number(cloud.dogru||0)+pending.dogru;
  const yanlis=useCalculated ? calculated.yanlis : Number(cloud.yanlis||0)+pending.yanlis;
  const bos=useCalculated ? calculated.bos : Number(cloud.bos||0)+pending.bos;
  const konular=useCalculated ? calculated.konular : JSON.parse(JSON.stringify(cloud.konular||{}));
  if(!useCalculated){
    Object.entries(pending.konular||{}).forEach(([k,v])=>{
      konular[k]={dogru:(konular[k]?.dogru||0)+v.dogru,yanlis:(konular[k]?.yanlis||0)+v.yanlis};
    });
  }
  return {toplam, dogru, yanlis, bos, konular};
}

// ── Firestore yazma fonksiyonları ─────────────────────────────────

function _persistYeniCozumler(uid){
  if(!window._fsDoc || !window._firestoreReady) return;
  const state = appState.sorularState || {};
  const seenObjects=new Set(), seenKeys=new Set();
  Object.entries(state).forEach(([soruKey, s])=>{
    if(!s || !s.answered || s._synced) return;
    const canonical=_canonicalAnswerKey(soruKey,s);
    if(seenObjects.has(s) || seenKeys.has(canonical)) return;
    seenObjects.add(s); seenKeys.add(canonical);
    const cozumRef = window._fsDoc(window._db, 'kullanicilar', uid, 'cozumler', _safeDocId(soruKey));
    window._fsSetDoc(cozumRef, {
      soruKey: soruKey,
      fasikulId: s.fasikulId || appState.aktifFasikul?.id || '',
      fasikulAd: s.fasikulAd || appState.aktifFasikul?.ad || '',
      konu: s.konu || appState.aktifKonu?.ad || '',
      altKonu: s.altKonu || appState.aktifAltKonu?.ad || '',
      dogruCevap: s.correct_answer || '',
      ogrenciCevap: s.selected || null,
      dogru: s.correct === true,
      atladi: s.skipped === true,
      sureSaniye: s.timeSec || 0,
      zorluk: s.zorluk || '',
      tarih: s.tarih || new Date().toISOString()
    }, {merge:true}).then(()=>{
      s._synced=true;
      try{ localStorage.setItem('edu_sorularState',JSON.stringify(appState.sorularState)); }catch(e){}
    }).catch(e=>console.warn('cozumGecmisi kayıt hatası:',e));
  });
}

export function persistDrawingCloud(key,json){
  const uid=_getUserKey();
  if(!uid || !json || !window._firestoreReady) return;
  const ref=window._fsDoc(window._db,'kullanicilar',uid,'cizimler',_safeDocId(key));
  window._fsSetDoc(ref,{key,json,fasikulId:appState.aktifFasikul?.id||'',updatedAt:new Date().toISOString()},{merge:true})
    .catch(e=>console.warn('Çizim buluta kaydedilemedi:',e));
}

export function deleteDrawingCloud(key){
  const uid=_getUserKey();
  if(!uid || !window._firestoreReady || !window._fsDeleteDoc) return;
  window._fsDeleteDoc(window._fsDoc(window._db,'kullanicilar',uid,'cizimler',_safeDocId(key)))
    .catch(e=>console.warn('Çizim buluttan silinemedi:',e));
}

export function persistData(){
  try{
    localStorage.setItem('edu_hatalilar', JSON.stringify(appState.hatalilar));
    localStorage.setItem('edu_sorularState', JSON.stringify(appState.sorularState));
  }catch(e){}
  const key = _getUserKey();
  if(key && window._firestoreReady){
    const dashboardStats = getDashboardStats();
    const istatistik = {
      toplam:dashboardStats.toplam,
      dogru:dashboardStats.dogru,
      yanlis:dashboardStats.yanlis,
      bos:dashboardStats.bos,
      konular:dashboardStats.konular
    };
    const fasikulIst = _hesaplaFasikulIstatistik();
    const docRef = _userDocRef(key);
    window._fsSetDoc(docRef, {
      email: appState.user.email,
      name: appState.user.name,
      hatalilar: appState.hatalilar,
      preferences: appState.preferences,
      theme: appState.theme,
      manifest: window.buildManifestMeta?.() || [],
      istatistik: istatistik,
      fasikulIstatistik: fasikulIst,
      guncelleme: new Date().toISOString()
    }, { merge: true }).then(()=>{
      if(!appState.cloudSolutionsLoaded) appState.cloudIstatistik=istatistik;
    }).catch(e=>console.warn('Firestore kayıt hatası:',e));
    _persistYeniCozumler(key);
  }
}

export function loadPersistedData(){
  try{
    const h=localStorage.getItem('edu_hatalilar');
    if(h) appState.hatalilar=JSON.parse(h);
    const s=localStorage.getItem('edu_sorularState');
    if(s) appState.sorularState=JSON.parse(s);
    document.getElementById('hataliCount').textContent=appState.hatalilar.length||0;
    document.getElementById('hataliCountBig').textContent=`${appState.hatalilar.length||0} Soru`;
  }catch(e){}
}

export async function loadFromFirestore(){
  const key = _getUserKey();
  if(!key || !window._firestoreReady) return;
  try{
    let docRef = _userDocRef(key);
    const snap = await window._fsGetDoc(docRef);
    let data = null;
    let shouldPersistAfterLoad = false;
    if(snap.exists()){
      data = snap.data();
      if(data.hatalilar)    appState.hatalilar    = data.hatalilar;
      if(data.istatistik) appState.cloudIstatistik = data.istatistik;
      if(data.fasikulIstatistik) appState.cloudFasikulIstatistik = data.fasikulIstatistik;
      if(data.preferences){
        appState.preferences={...appState.preferences,...data.preferences};
        localStorage.setItem('edu_preferences',JSON.stringify(appState.preferences));
        window.loadPreferences?.();
      }
      if(data.theme && data.theme!==appState.theme){
        document.documentElement.setAttribute('data-theme',data.theme);
        appState.theme=data.theme;
        localStorage.setItem('edu_theme',data.theme);
      }
      if(Array.isArray(data.manifest)){
        localStorage.setItem('edu_manifest_meta',JSON.stringify(data.manifest));
        window.loadManifestMeta?.();
        await window.loadBundledFasikuller?.();
        window.renderDerslerGrid?.();
      }
      if(data.sorularState) appState.sorularState = data.sorularState;
      localStorage.setItem('edu_hatalilar',    JSON.stringify(appState.hatalilar));
    }

    const legacyKeys=[key, appState.user?.email ? appState.user.email.replace(/[^a-zA-Z0-9]/g,'_') : ''].filter(Boolean);
    for(const legacyKey of [...new Set(legacyKeys)]){
      try{
        const legacySnap=await window._fsGetDoc(window._fsDoc(window._db,'ogrenciler',legacyKey));
        if(!legacySnap.exists()) continue;
        const legacy=legacySnap.data();
        if(!appState.hatalilar?.length && legacy.hatalilar){ appState.hatalilar=legacy.hatalilar; shouldPersistAfterLoad=true; }
        if(!Object.keys(appState.sorularState||{}).length && legacy.sorularState){ appState.sorularState=legacy.sorularState; shouldPersistAfterLoad=true; }
        if(legacy.istatistik || legacy.fasikulIstatistik) await window._fsSetDoc(docRef,{legacyIstatistik:legacy.istatistik||null,legacyFasikulIstatistik:legacy.fasikulIstatistik||null},{merge:true});
        break;
      }catch(e){}
    }

    try{
      const cozumSnap=await window._fsGetDocs(window._fsCollection(window._db,'kullanicilar',key,'cozumler'));
      const loadedState={...appState.sorularState};
      let cozumCount=0;
      cozumSnap.forEach(d=>{
        cozumCount++;
        const c=d.data();
        const soruKey=c.soruKey || decodeURIComponent(d.id);
        const restoredState={
          answered:true,
          selected:c.ogrenciCevap ?? null,
          correct:c.dogru===true,
          skipped:c.atladi===true,
          correct_answer:c.dogruCevap||'',
          timeSec:c.sureSaniye||0,
          fasikulId:c.fasikulId||'',fasikulAd:c.fasikulAd||'',
          konu:c.konu||'',altKonu:c.altKonu||'',zorluk:c.zorluk||'',
          tarih:c.tarih||'',
          _synced:true
        };
        loadedState[soruKey]=restoredState;
        if(c.fasikulId && !String(soruKey).startsWith(`${c.fasikulId}__`)){
          loadedState[`${c.fasikulId}__${soruKey}`]=restoredState;
        }
      });
      if(cozumCount>0){
        appState.sorularState=loadedState;
        appState.cloudIstatistik=null;
        localStorage.setItem('edu_sorularState',JSON.stringify(appState.sorularState));
      }
      appState.cloudSolutionsLoaded=cozumCount>0;
    }catch(e){ console.warn('Çözüm geçmişi yüklenemedi:',e); }

    try{
      const drawingSnap=await window._fsGetDocs(window._fsCollection(window._db,'kullanicilar',key,'cizimler'));
      const drawings={...appState.drawings};
      drawingSnap.forEach(d=>{
        const c=d.data();
        if(c.key && c.json) drawings[c.key]=c.json;
      });
      appState.drawings=drawings;
    }catch(e){ console.warn('Çizimler yüklenemedi:',e); }

    document.getElementById('hataliCount').textContent=appState.hatalilar.length||0;
    document.getElementById('hataliCountBig').textContent=`${appState.hatalilar.length||0} Soru`;
    window.recalcFasikulProgress?.();
    window.updateDashboard?.();
    window.persistManifest?.();
    window.renderDerslerGrid?.();
    if(shouldPersistAfterLoad || Object.values(appState.sorularState||{}).some(s=>s&&s.answered&&!s._synced)) persistData();
    window.showToast?.('Veriler buluttan yüklendi ☁️','success');
    window.startRealtimeSync?.(key);
  }catch(e){ console.warn('Firestore yükleme hatası:',e); }
}
