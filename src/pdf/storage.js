import { appState } from '../state/appState.js';

// Hash yalnızca küçük dosyalarda hesaplanır; büyük PDF'lerde arrayBuffer belleği tüketir
const HASH_SIZE_LIMIT = 150 * 1024 * 1024; // 150 MB üstünde hash atla

async function calcPDFHash(file){
  if(file.size > HASH_SIZE_LIMIT) return null;
  try{
    const buf = await file.arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
  }catch(e){ return null; }
}

async function savePDFHashToCloud(fasikulId, hash, pageCount){
  if(!fasikulId || !hash || !window._firestoreReady) return;
  window._fsSetDoc(
    window._fsDoc(window._db, 'fasikuller', fasikulId),
    { hash, pageCount, uploadedAt: new Date().toISOString() },
    { merge: true }
  ).catch(()=>{});
}

export async function checkPDFHashMatch(fasikulId, localHash){
  if(!fasikulId || !localHash || !window._firestoreReady) return true;
  try{
    const snap = await window._fsGetDoc(window._fsDoc(window._db, 'fasikuller', fasikulId));
    if(!snap.exists()) return true;
    const remote = snap.data().hash;
    return !remote || remote === localHash;
  }catch(e){ return true; }
}

async function handlePDFUpload(input){
  const file = input.files[0];
  if(!file || file.type !== 'application/pdf'){
    window.showToast?.('Lütfen geçerli bir PDF dosyası seç','error');
    return;
  }
  await window.loadPDFFile?.(file);
  if(appState.aktifDers && appState.aktifFasikul){
    // Yazmayı bekle — kullanıcı yüklemenin hemen ardından incelemeyi kapatıp
    // başka bir teste geçerse (rapor akışı), kayıt commit olmadan önbellek
    // okuması boş dönebilir ve tekrar yükleme istenebilir.
    await savePDFToDB(appState.aktifDers.id, appState.aktifFasikul.id, file).catch(()=>{});
    // Hash'i arka planda hesapla ve buluta kaydet
    calcPDFHash(file).then(hash => {
      if(hash && appState.aktifFasikul){
        const pageCount = appState.totalPages || 0;
        savePDFHashToCloud(appState.aktifFasikul.id, hash, pageCount);
      }
    });
  }
  input.value = '';
}

// ══════════════════════════════
// PDF PERSISTENCE (IndexedDB)
// ══════════════════════════════
const PDF_DB_NAME = 'edu_pdf_store';
const PDF_DB_STORE = 'pdfs';
// Safari/iPadOS'ta showDirectoryPicker olmadığı için PDF'ler kopyalanıp burada
// saklanıyor — hiçbir eviction olmazsa süresiz birikip GB'larca yer kaplıyordu.
// Bu cap aşılınca en eski kullanılan (LRU) kayıtlar otomatik silinir.
const PDF_CACHE_MAX_BYTES = 1.5 * 1024 * 1024 * 1024; // 1.5 GB

function openPdfDB(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(PDF_DB_NAME, 1);
    req.onupgradeneeded = ()=>{
      req.result.createObjectStore(PDF_DB_STORE);
    };
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error);
  });
}

async function savePDFToDB(dersId, fasikulId, file){
  try{
    const db = await openPdfDB();
    const key = `${dersId}_${fasikulId}`;
    await new Promise((resolve,reject)=>{
      const tx = db.transaction(PDF_DB_STORE,'readwrite');
      tx.objectStore(PDF_DB_STORE).put({name:file.name, blob:file, size:file.size||0, lastAccessed:Date.now()}, key);
      tx.oncomplete = ()=>resolve();
      tx.onerror = ()=>reject(tx.error);
    });
    // Yeni kayıt eklendi — cap aşıldıysa en eski kullanılanları temizle.
    // Şu an okuyucuda açık olan fasikül varsa (kullanıcı o an görüntülüyor
    // olabilir) her zaman korunur — yeni kaydedilenle aynı olmayabilir
    // (ör. toplu PDF seçiminde arka planda başka bir fasikül açık olabilir).
    const activeKey = appState.aktifDers?.id && appState.aktifFasikul?.id
      ? `${appState.aktifDers.id}_${appState.aktifFasikul.id}` : key;
    evictOldPDFsIfNeeded(activeKey).catch(()=>{});
  }catch(e){ /* sessizce yoksay */ }
}

async function getPDFFromDB(dersId, fasikulId){
  try{
    const db = await openPdfDB();
    const key = `${dersId}_${fasikulId}`;
    const record = await new Promise((resolve,reject)=>{
      const tx = db.transaction(PDF_DB_STORE,'readonly');
      const req = tx.objectStore(PDF_DB_STORE).get(key);
      req.onsuccess = ()=>resolve(req.result||null);
      req.onerror = ()=>reject(req.error);
    });
    // Gerçekten görüntülendi — LRU sırası için erişim zamanını arka planda güncelle
    // (okuma sonucunu bekletmeden, ayrı bir yazma transaction'ıyla).
    if(record) touchPDFLastAccessed(db, key, record).catch(()=>{});
    return record;
  }catch(e){ return null; }
}

function touchPDFLastAccessed(db, key, record){
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(PDF_DB_STORE,'readwrite');
    tx.objectStore(PDF_DB_STORE).put({...record, lastAccessed:Date.now()}, key);
    tx.oncomplete = ()=>resolve();
    tx.onerror = ()=>reject(tx.error);
  });
}

// Toplam boyut PDF_CACHE_MAX_BYTES'ı aşarsa en eski kullanılan (lastAccessed)
// kayıtlardan başlayarak, cap'in altına inene kadar sırayla siler. Şu an açık
// olan fasikülün kaydı (protectedKey) hiçbir zaman silinmez.
async function evictOldPDFsIfNeeded(protectedKey){
  try{
    const db = await openPdfDB();
    const entries = await new Promise((resolve,reject)=>{
      const tx = db.transaction(PDF_DB_STORE,'readonly');
      const store = tx.objectStore(PDF_DB_STORE);
      const rows = [];
      const req = store.openCursor();
      req.onsuccess = ()=>{
        const cursor = req.result;
        if(cursor){
          const v = cursor.value || {};
          rows.push({key:cursor.key, size:v.size||0, lastAccessed:v.lastAccessed||0});
          cursor.continue();
        } else resolve(rows);
      };
      req.onerror = ()=>reject(req.error);
    });

    let total = entries.reduce((sum,e)=>sum+e.size,0);
    if(total <= PDF_CACHE_MAX_BYTES) return;

    const evictable = entries.filter(e=>e.key!==protectedKey).sort((a,b)=>a.lastAccessed-b.lastAccessed);
    const toEvict = [];
    for(const e of evictable){
      if(total <= PDF_CACHE_MAX_BYTES) break;
      toEvict.push(e.key);
      total -= e.size;
    }
    if(!toEvict.length) return;

    await new Promise((resolve,reject)=>{
      const tx = db.transaction(PDF_DB_STORE,'readwrite');
      const store = tx.objectStore(PDF_DB_STORE);
      toEvict.forEach(k=>store.delete(k));
      tx.oncomplete = ()=>resolve();
      tx.onerror = ()=>reject(tx.error);
    });

    window.updateEduDirUI?.();
    window.showToast?.(`Depolama alanı için ${toEvict.length} eski PDF önbellekten temizlendi`,'info');
  }catch(e){ /* sessizce yoksay */ }
}

async function clearAllCachedPDFs(){
  try{
    const db = await openPdfDB();
    await new Promise((resolve,reject)=>{
      const tx = db.transaction(PDF_DB_STORE,'readwrite');
      tx.objectStore(PDF_DB_STORE).clear();
      tx.oncomplete = ()=>resolve();
      tx.onerror = ()=>reject(tx.error);
    });
    await window.updateEduDirUI?.();
    window.showToast?.('✓ PDF önbelleği temizlendi','success');
  }catch(e){
    window.showToast?.('Önbellek temizlenemedi','error');
  }
}

async function getCachedPDFKeys(){
  try{
    const db = await openPdfDB();
    return await new Promise((resolve,reject)=>{
      const tx = db.transaction(PDF_DB_STORE,'readonly');
      const req = tx.objectStore(PDF_DB_STORE).getAllKeys();
      req.onsuccess = ()=>resolve(new Set(req.result||[]));
      req.onerror = ()=>reject(req.error);
      tx.oncomplete = ()=>db.close();
    });
  }catch(e){ return new Set(); }
}

async function getCachedPDFRecords(){
  try{
    const db = await openPdfDB();
    return await new Promise((resolve,reject)=>{
      const tx = db.transaction(PDF_DB_STORE,'readonly');
      const req = tx.objectStore(PDF_DB_STORE).getAll();
      req.onsuccess = ()=>resolve(req.result||[]);
      req.onerror = ()=>reject(req.error);
      tx.oncomplete = ()=>db.close();
    });
  }catch(e){ return []; }
}

async function deletePDFFromDB(dersId, fasikulId){
  try{
    const db = await openPdfDB();
    const key = `${dersId}_${fasikulId}`;
    await new Promise((resolve,reject)=>{
      const tx = db.transaction(PDF_DB_STORE,'readwrite');
      tx.objectStore(PDF_DB_STORE).delete(key);
      tx.oncomplete = ()=>resolve();
      tx.onerror = ()=>reject(tx.error);
    });
  }catch(e){}
}

/**
 * File alarak PDF.js ile yükler ve ilk sayfayı render eder
 */


// ── Bu modülün fonksiyonlarını window'a kaydet ──
// main.js ve diğer modüller window.xxx ile çağırabilsin
window.handlePDFUpload = handlePDFUpload;
window.openPdfDB = openPdfDB;
window.savePDFToDB = savePDFToDB;
window.getPDFFromDB = getPDFFromDB;
window.getCachedPDFKeys = getCachedPDFKeys;
window.getCachedPDFRecords = getCachedPDFRecords;
window.deletePDFFromDB = deletePDFFromDB;
window.clearAllCachedPDFs = clearAllCachedPDFs;
window.calcPDFHash = calcPDFHash;
window.checkPDFHashMatch = checkPDFHashMatch;
