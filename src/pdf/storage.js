import { appState } from '../state/appState.js';

async function handlePDFUpload(input){
  const file = input.files[0];
  if(!file || file.type !== 'application/pdf'){
    showToast('Lütfen geçerli bir PDF dosyası seç','error');
    return;
  }
  await loadPDFFile(file);
  // Aynı fasikül için bir dahaki açılışta otomatik yüklensin diye sakla
  if(appState.aktifDers && appState.aktifFasikul){
    savePDFToDB(appState.aktifDers.id, appState.aktifFasikul.id, file).catch(()=>{});
  }
  // Reset input so same file can be re-selected
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
