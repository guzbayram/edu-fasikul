import { appState } from '../state/appState.js';

// Çizim, kaydedildiği canvas boyutuna göre saklanır. Zoom değişip canvas yeniden
// boyutlanınca nesneleri orana göre ölçekle ki konum/boyut kullanıcının çizdiği
// yerde kalsın (zoom'dan etkilensin ama kaymasın).
function applyDrawingScale(fc, key){
  const dim = appState.drawingDims?.[key];
  if(!dim || !dim.w || !dim.h || !fc.width || !fc.height) return;
  const rw = fc.width / dim.w, rh = fc.height / dim.h;
  if(Math.abs(rw - 1) < 0.002 && Math.abs(rh - 1) < 0.002) return;
  fc.getObjects().forEach(o => {
    o.left   = (o.left   || 0) * rw;
    o.top    = (o.top    || 0) * rh;
    o.scaleX = (o.scaleX || 1) * rw;
    o.scaleY = (o.scaleY || 1) * rh;
    o.setCoords();
  });
}
window.applyDrawingScale = applyDrawingScale;

function initFabricForPage(canvasEl, w, h, pageNum){
  const fc = new fabric.Canvas(canvasEl, {
    isDrawingMode: false, selection: true,
    width: w, height: h, backgroundColor: 'transparent'
  });
  fc._pageNum = pageNum;
  appState.fabricCanvases[pageNum] = fc;

  // Aktif sayfaysa ana canvas olarak işaretle
  if(pageNum === appState.currentPage){
    appState.fabricCanvas = fc;
    applyTool(appState.drawTool);
  }

  // Kayıtlı çizim varsa yükle
  const key = `drawing_${appState.aktifFasikul?.id}_p${pageNum}`;
  const saved = appState.drawings[key];
  if(saved){ try{ fc.loadFromJSON(saved, ()=>{ applyDrawingScale(fc, key); applyTool(appState.drawTool); fc.renderAll(); }); }catch(e){} }

  // Tıklandığında aktif canvas olarak seç
  fc._pageSelectHandler = ()=>{
    if(appState.currentPage !== pageNum){
      saveDrawingForPage(appState.currentPage);
      appState.currentPage = pageNum;
      appState.fabricCanvas = fc;
      applyTool(appState.drawTool);
      updatePageIndicator();
      document.getElementById('prevPageBtn').disabled = pageNum === 1;
      document.getElementById('nextPageBtn').disabled = pageNum === appState.totalPages;
    }
  };
  fc.on('mouse:down', fc._pageSelectHandler);

  // Otomatik kayıt
  const debounceSave = ()=>{
    if(appState._saveTimeout) clearTimeout(appState._saveTimeout);
    appState._saveTimeout = setTimeout(()=>saveDrawingForPage(pageNum), 800);
  };
  fc.on('object:added', debounceSave);
  fc.on('object:modified', debounceSave);
  fc.on('object:removed', debounceSave);
  fc.on('object:added', ()=>{ appState.undoStack.push(JSON.stringify(fc)); appState.redoStack=[]; });
}

function saveDrawingForPage(pageNum){
  const fc = appState.fabricCanvases[pageNum];
  if(!fc || !appState.aktifFasikul) return;
  const key = `drawing_${appState.aktifFasikul.id}_p${pageNum}`;
  const json=JSON.stringify(fc);
  appState.drawings[key] = json;
  appState.drawingDims[key] = { w: fc.width, h: fc.height };
  persistDrawingCloud(key, json, fc.width, fc.height);
}

function setObjectsInteractive(fc, selectable){
  if(!fc) return;
  fc.forEachObject(obj=>{
    obj.selectable = selectable;
    obj.evented = true;
  });
}

function clearToolHandlers(fc){
  if(!fc) return;
  if(fc._textToolHandler){
    fc.off('mouse:down', fc._textToolHandler);
    fc._textToolHandler = null;
  }
  if(fc._eraserToolHandler){
    fc.off('mouse:down', fc._eraserToolHandler);
    fc._eraserToolHandler = null;
  }
  if(fc._eraserMoveHandler){
    fc.off('mouse:move', fc._eraserMoveHandler);
    fc._eraserMoveHandler = null;
  }
  if(fc._eraserUpHandler){
    fc.off('mouse:up', fc._eraserUpHandler);
    fc._eraserUpHandler = null;
  }
}

function initFabricCanvas(){
  // Eski yöntem: sadece fallback için çağrılabilir, artık initFabricOnCanvas kullanılıyor
  const el = document.getElementById('fabric-canvas');
  if(el) initFabricOnCanvas(el, el.width, el.height);
}

/**
 * Verilen canvas elementine Fabric.js bağlar
 * @param {HTMLCanvasElement} canvasEl
 * @param {number} w - display genişlik
 * @param {number} h - display yükseklik
 */

function initFabricOnCanvas(canvasEl, w, h){
  if(appState.fabricCanvas){ try{ appState.fabricCanvas.dispose(); }catch(e){} }

  const fc = new fabric.Canvas(canvasEl, {
    isDrawingMode: false,
    selection: true,
    width: w,
    height: h,
    backgroundColor: 'transparent'
  });
  appState.fabricCanvas = fc;

  // Sayfa için kayıtlı çizim varsa yükle
  const key = `drawing_${appState.aktifFasikul?.id}_p${appState.currentPage}`;
  const saved = appState.drawings[key];
  if(saved){
    try{ fc.loadFromJSON(saved, ()=>{ applyDrawingScale(fc, key); fc.renderAll(); }); }catch(e){}
  }

  // Otomatik kayıt (800ms debounce)
  fc.on('object:added', debounceAutoSave);
  fc.on('object:modified', debounceAutoSave);
  fc.on('object:removed', debounceAutoSave);

  // Undo stack
  fc.on('object:added', ()=>{ appState.undoStack.push(JSON.stringify(fc)); appState.redoStack=[]; });

  applyTool(appState.drawTool);
}

function debounceAutoSave(){
  if(appState._saveTimeout) clearTimeout(appState._saveTimeout);
  appState._saveTimeout = setTimeout(saveDrawing, 800);
}

function saveDrawing(){
  if(!appState.aktifFasikul) return;
  if(appState.viewMode === 'scroll'){
    // Tüm render edilmiş sayfaları kaydet
    Object.entries(appState.fabricCanvases).forEach(([pn, fc])=>{
      const key = `drawing_${appState.aktifFasikul.id}_p${pn}`;
      const json=JSON.stringify(fc);
      appState.drawings[key] = json;
      appState.drawingDims[key] = { w: fc.width, h: fc.height };
      persistDrawingCloud(key, json, fc.width, fc.height);
    });
  } else {
    const fc = appState.fabricCanvas;
    if(!fc) return;
    const key = `drawing_${appState.aktifFasikul.id}_p${appState.currentPage}`;
    const json=JSON.stringify(fc);
    appState.drawings[key] = json;
    appState.drawingDims[key] = { w: fc.width, h: fc.height };
    persistDrawingCloud(key, json, fc.width, fc.height);
  }
  const ind = document.getElementById('readerToolbar').querySelector('[title="Kaydet (Ctrl+S)"]');
  if(ind) { ind.style.color='var(--green)'; setTimeout(()=>ind.style.color='',800); }
}

// ── Tools


// ── Bu modülün fonksiyonlarını window'a kaydet ──
// main.js ve diğer modüller window.xxx ile çağırabilsin
window.initFabricForPage = initFabricForPage;
window.saveDrawingForPage = saveDrawingForPage;
window.setObjectsInteractive = setObjectsInteractive;
window.clearToolHandlers = clearToolHandlers;
window.initFabricCanvas = initFabricCanvas;
window.initFabricOnCanvas = initFabricOnCanvas;
window.debounceAutoSave = debounceAutoSave;
window.saveDrawing = saveDrawing;
