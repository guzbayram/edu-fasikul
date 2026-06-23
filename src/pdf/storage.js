import { appState } from '../state/appState.js';

const MAX_PDF_BYTES = 50 * 1024 * 1024; // 50 MB

async function calcPDFHash(file){
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
  if(file.size > MAX_PDF_BYTES){
    window.showToast?.(`PDF çok büyük (${(file.size/1024/1024).toFixed(0)} MB). Maksimum 50 MB yüklenebilir.`,'error');
    input.value = '';
    return;
  }
  await window.loadPDFFile?.(file);
  if(appState.aktifDers && appState.aktifFasikul){
    savePDFToDB(appState.aktifDers.id, appState.aktifFasikul.id, file).catch(()=>{});
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
      tx.objectStore(PDF_DB_STORE).put({name:file.name, blob:file}, key);
      tx.oncomplete = ()=>resolve();
      tx.onerror = ()=>reject(tx.error);
    });
  }catch(e){ /* sessizce yoksay */ }
}

async function getPDFFromDB(dersId, fasikulId){
  try{
    const db = await openPdfDB();
    const key = `${dersId}_${fasikulId}`;
    return await new Promise((resolve,reject)=>{
      const tx = db.transaction(PDF_DB_STORE,'readonly');
      const req = tx.objectStore(PDF_DB_STORE).get(key);
      req.onsuccess = ()=>resolve(req.result||null);
      req.onerror = ()=>reject(req.error);
    });
  }catch(e){ return null; }
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
window.calcPDFHash = calcPDFHash;
window.checkPDFHashMatch = checkPDFHashMatch;
