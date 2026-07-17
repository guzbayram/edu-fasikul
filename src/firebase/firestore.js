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

// Çıkışta (doLogout) 900ms'lik debounce'un tamamlanmasını beklemeden oturum
// kapanırsa appState.user=null olur ve bekleyen zamanlayıcı persistData()'yı
// sessizce hiçbir şey yapmadan çalıştırır — son değişiklik buluta hiç
// ulaşmaz. Çıkıştan önce bunu senkron biçimde tetikleyip bitmesini bekleriz.
export async function flushCloudPersist(){
  if(appState._cloudPersistTimer){
    clearTimeout(appState._cloudPersistTimer);
    appState._cloudPersistTimer = null;
  }
  try{ await persistData(); }catch(e){}
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

function _findManifestContext(fasikulId){
  const manifest = window.MANIFEST;
  if(!fasikulId || !manifest?.dersler?.length) return {};
  for(const ders of manifest.dersler){
    const fas = (ders.fasikuller||[]).find(f=>f.id === fasikulId);
    if(fas) return {dersId:ders.id, dersAd:ders.ad, fasikulAd:fas.ad};
  }
  return {};
}

function _recordContext(record){
  const fallback = _findManifestContext(record?.fasikulId);
  return {
    dersId: record?.dersId || record?.ders || fallback.dersId || '',
    dersAd: record?.dersAd || fallback.dersAd || '',
    fasikulId: record?.fasikulId || '',
    fasikulAd: record?.fasikulAd || fallback.fasikulAd || '',
    konu: record?.konu || 'Diğer',
    altKonu: record?.altKonu || ''
  };
}

function _emptyPerfBucket(label=''){
  return {label,total:0,dogru:0,yanlis:0,bos:0,timeSec:0,records:[],konular:{},fasikuller:{}};
}

function _addRecordToBucket(bucket, record){
  bucket.total++;
  bucket.timeSec += Number(record.timeSec||0);
  bucket.records.push(record);
  if(record.skipped) bucket.bos++;
  else if(record.correct) bucket.dogru++;
  else bucket.yanlis++;
}

function _buildContextStats(records){
  const dersler = {};
  const fasikuller = {};
  const konular = {};
  records.forEach(record=>{
    const ctx = _recordContext(record);
    const dersKey = ctx.dersId || 'bilinmiyor';
    const fasKey = ctx.fasikulId || 'bilinmiyor';
    const konuKey = `${dersKey}__${fasKey}__${ctx.konu}`;

    if(!dersler[dersKey]) dersler[dersKey]=_emptyPerfBucket(ctx.dersAd || dersKey);
    if(!fasikuller[fasKey]) fasikuller[fasKey]=_emptyPerfBucket(ctx.fasikulAd || fasKey);
    if(!konular[konuKey]) konular[konuKey]={
      ..._emptyPerfBucket(ctx.konu),
      dersId:dersKey,
      dersAd:ctx.dersAd || dersKey,
      fasikulId:fasKey,
      fasikulAd:ctx.fasikulAd || fasKey,
      konu:ctx.konu,
      altKonu:ctx.altKonu
    };

    _addRecordToBucket(dersler[dersKey], record);
    _addRecordToBucket(fasikuller[fasKey], record);
    _addRecordToBucket(konular[konuKey], record);
    dersler[dersKey].fasikuller[fasKey]=fasikuller[fasKey];
    fasikuller[fasKey].konular[konuKey]=konular[konuKey];
  });
  return {dersler, fasikuller, konular};
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
  const contextStats=_buildContextStats(records);
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
  return {
    toplam, dogru, yanlis, bos, konular, records,
    dersler: contextStats.dersler,
    fasikuller: contextStats.fasikuller,
    konuDagilimi: contextStats.konular
  };
}

// ── Hatalilar Subcollection ───────────────────────────────────────

export async function migrateHatalilarToSubcollection(uid){
  if(!window._firestoreReady) return;
  try{
    const docRef = _userDocRef(uid);
    const snap = await window._fsGetDoc(docRef);
    if(!snap.exists()) return;
    const arr = snap.data()?.hatalilar;
    if(!Array.isArray(arr) || arr.length === 0) return;
    const writes = arr.map(h => {
      const key = _safeDocId(h.soruKey || h.soruNo || String(Date.now()));
      const ref = window._fsDoc(window._db,'kullanicilar',uid,'hatalilar',key);
      return window._fsSetDoc(ref,{...h,migratedAt:new Date().toISOString()},{merge:true});
    });
    await Promise.all(writes);
    await window._fsSetDoc(docRef,{hatalilar:[]},{merge:true});
    console.info(`Hatalilar migration: ${arr.length} soru subcollection'a taşındı.`);
  }catch(e){ console.warn('Hatalilar migration hatası:',e); }
}

export function addHataliCloud(uid, h){
  if(!uid || !window._firestoreReady) return;
  const key = _safeDocId(h.soruKey || h.soruNo || String(Date.now()));
  const ref = window._fsDoc(window._db,'kullanicilar',uid,'hatalilar',key);
  window._fsSetDoc(ref,{...h,updatedAt:new Date().toISOString()},{merge:true})
    .catch(e=>console.warn('Hatali buluta kaydedilemedi:',e));
}

export function removeHataliCloud(uid, soruKey){
  if(!uid || !soruKey || !window._firestoreReady || !window._fsDeleteDoc) return;
  window._fsDeleteDoc(window._fsDoc(window._db,'kullanicilar',uid,'hatalilar',_safeDocId(soruKey)))
    .catch(e=>console.warn('Hatali buluttan silinemedi:',e));
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
      dersId: s.dersId || appState.aktifDers?.id || '',
      dersAd: s.dersAd || appState.aktifDers?.ad || '',
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

export function persistDrawingCloud(key,json,w,h){
  const uid=_getUserKey();
  if(!uid || !json || !window._firestoreReady) return;
  if(!appState._cloudDeviceId) appState._cloudDeviceId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const ref=window._fsDoc(window._db,'kullanicilar',uid,'cizimler',_safeDocId(key));
  const now = Date.now();
  const payload={
    key,json,
    fasikulId:appState.aktifFasikul?.id||'',
    by:appState._cloudDeviceId,
    updatedAt:new Date(now).toISOString(),
    updatedAtMs:now
  };
  if(w) payload.w=w; if(h) payload.h=h;
  window._fsSetDoc(ref,payload,{merge:true})
    .catch(e=>console.warn('Çizim buluta kaydedilemedi:',e));
  window.publishCanliPresenceDraw?.(key, json, w, h);   // canlı takipçilere yansı
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
    localStorage.setItem('edu_video_watched', JSON.stringify(appState.videoWatched));
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
    const p = window._fsSetDoc(docRef, {
      email: appState.user.email,
      name: appState.user.name,
      preferences: appState.preferences,
      theme: appState.theme,
      manifest: window.buildManifestMeta?.() || [],
      manifestTs: Number(localStorage.getItem('edu_manifest_meta_ts')||0),
      removedFromDers: (()=>{ try{ return JSON.parse(localStorage.getItem('edu_removed_from_ders')||'[]'); }catch(e){ return []; } })(),
      videoWatched: appState.videoWatched,
      istatistik: istatistik,
      fasikulIstatistik: fasikulIst,
      guncelleme: new Date().toISOString()
    }, { merge: true }).then(()=>{
      try{ localStorage.removeItem('edu_manifest_dirty'); }catch(e){}
      if(!appState.cloudSolutionsLoaded) appState.cloudIstatistik=istatistik;
    }).catch(e=>console.warn('Firestore kayıt hatası:',e));
    _persistYeniCozumler(key);
    return p;
  }
  return Promise.resolve();
}

export function loadPersistedData(){
  try{
    const h=localStorage.getItem('edu_hatalilar');
    if(h) appState.hatalilar=JSON.parse(h);
    const s=localStorage.getItem('edu_sorularState');
    if(s) appState.sorularState=JSON.parse(s);
    const vw=localStorage.getItem('edu_video_watched');
    if(vw) appState.videoWatched=JSON.parse(vw);
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
      if(appState.user && Array.isArray(data.hiddenFasikulIds)){
        appState.user.hiddenFasikulIds = data.hiddenFasikulIds;
      }
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
      // Per-ders silme tombstone'unu bulutla birleştir (manifest'i uygulamadan ÖNCE
      // ki loadManifestMeta/loadBundledFasikuller içindeki filtre bunları görsün).
      if(Array.isArray(data.removedFromDers)){
        try{
          const merged = new Set(JSON.parse(localStorage.getItem('edu_removed_from_ders')||'[]'));
          data.removedFromDers.forEach(k=>merged.add(k));
          localStorage.setItem('edu_removed_from_ders', JSON.stringify([...merged]));
        }catch(e){}
      }
      if(Array.isArray(data.manifest)){
        // Yerelde bulut'a HENÜZ ulaşmamış daha yeni bir değişiklik olabilir
        // (ör. ders/alt ders/fasikül eklenip 900ms'lik senk. beklemeden çıkış
        // yapılmışsa). Bu durumda bayat bulut kopyası yerelin üzerine
        // yazılmasın — yereli koru ve buluta yeniden göndermeyi programla.
        const localTs = Number(localStorage.getItem('edu_manifest_meta_ts')||0);
        const cloudTs = Number(data.manifestTs||0);
        const localManifestCanWin = appState.user?.role === 'admin'
          && localStorage.getItem('edu_manifest_dirty') === '1';
        if(localManifestCanWin && localTs > cloudTs){
          scheduleCloudPersist();
        } else {
          localStorage.setItem('edu_manifest_meta',JSON.stringify(data.manifest));
          localStorage.setItem('edu_manifest_meta_ts', String(cloudTs||Date.now()));
          window.loadManifestMeta?.();
          await window.loadBundledFasikuller?.();
          window.applyDersRemovals?.();
          window.renderDerslerGrid?.();
        }
      }
      if(data.sorularState) appState.sorularState = data.sorularState;
      if(data.videoWatched){
        appState.videoWatched = {...appState.videoWatched, ...data.videoWatched};
        try{ localStorage.setItem('edu_video_watched', JSON.stringify(appState.videoWatched)); }catch(e){}
      }
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
          dersId:c.dersId||c.ders||'',dersAd:c.dersAd||'',
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
        if(c.key && c.json){ drawings[c.key]=c.json; if(c.w && c.h) appState.drawingDims[c.key]={w:c.w,h:c.h}; }
      });
      appState.drawings=drawings;
    }catch(e){ console.warn('Çizimler yüklenemedi:',e); }

    // Hatalilar subcollection yükle + gerekirse migration yap
    try{
      await migrateHatalilarToSubcollection(key);
      const hataliSnap=await window._fsGetDocs(window._fsCollection(window._db,'kullanicilar',key,'hatalilar'));
      if(hataliSnap.size > 0){
        appState.hatalilar = hataliSnap.docs.map(d=>d.data());
        localStorage.setItem('edu_hatalilar',JSON.stringify(appState.hatalilar));
      }
    }catch(e){ console.warn('Hatalilar subcollection yüklenemedi:',e); }

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
