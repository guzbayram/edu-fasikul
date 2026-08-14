import { appState, pushUndoSnapshot } from '../state/appState.js';

// Fabric.js 5.5.2 hatası: Canvas.prototype._onTouchStart HER touchstart'ta
// koşulsuz e.preventDefault() çağırıyor — allowTouchScrolling:true olsa BİLE
// (bu bayrağı yalnız _onMouseMove/touchmove kontrol ediyor, _onTouchStart hiç
// bakmıyor). Artık canvas'ın touch-action'ı zaten HER ZAMAN 'none' olduğundan
// (bkz. styles.css — parmak-pan'i elle JS ile sürüyoruz, initLongPressDraw)
// bu preventDefault pratikte zararsız hâle geldi, ama zaten var olan bir
// Fabric hatası olduğu ve başka bir yerde işe yarayabileceği için düzeltme
// duruyor: Prototip metodunu SARMALIYORUZ (yeniden yazmıyoruz — Fabric'in
// kendi touchmove/touchend yeniden-bağlama mantığı olduğu gibi çalışmaya
// devam etsin): allowTouchScrolling true iken preventDefault'u orijinal
// çağrı SIRASINDA geçici olarak etkisizleştiriyoruz.
// NOT: main.js henüz `window.fabric = fabric` atamasını yapmadan bu modül
// evaluate edilebildiğinden yama modül-üstü DEĞİL, ilk canvas kurulumunda
// (initFabricForPage/initFabricOnCanvas) çağrılır — fabric o an garanti hazır.
function patchFabricTouchStartPreventDefault(){
  const proto = window.fabric?.Canvas?.prototype;
  if(!proto || proto.__touchScrollPatched) return;
  proto.__touchScrollPatched = true;
  const orig = proto._onTouchStart;
  proto._onTouchStart = function(e){
    if(!this.allowTouchScrolling) return orig.call(this, e);
    const realPreventDefault = e.preventDefault;
    e.preventDefault = function(){};
    try{ orig.call(this, e); } finally { e.preventDefault = realPreventDefault; }
  };
}

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

// Ortak tahta: başka kullanıcıların çizim nesneleri canvas'a _owner ile işaretlenip
// eklenir (overlay). Kaydederken/undo alırken YALNIZ kendi (yerel) nesnelerimizi
// serialize et — başkasının kalemi ne buluta kaydedilsin ne de bize ait sayılsın.
function localCanvasJSON(fc){
  if(!fc) return '{}';
  const data = fc.toJSON(['_owner']);
  if(Array.isArray(data.objects)) data.objects = data.objects.filter(o=>!o._owner);
  return JSON.stringify(data);
}
window._localCanvasJSON = localCanvasJSON;

// KÖK NEDEN (yatay çizim kayması): Fabric'in getPointer'ı, dokunma noktasını
// `clientX + getScrollLeftTop(target)` (tüm üst elementlerin scroll toplamı, canvas-wrap
// scrollTop'u dahil) - calcOffset offset'i ile hesaplıyor. Bizim canvas-wrap iç-scroll'u
// bu toplama girince ve getBoundingClientRect zaten scroll'u yansıtınca aynı scroll ÇİFT
// sayılıyor → kart aşağı kaydırılınca (yalnız yatayda gerekiyor) çizim ~2×scroll kayıyor.
//
// Çözüm: getPointer'ı tamamen değiştir; noktayı SADECE `clientX - rect.left` ile bul.
// clientX/Y ve getBoundingClientRect aynı viewport koordinat sisteminde olduğundan hiçbir
// scroll/offset terimi gerekmez; her olayda canlı rect ile hesaplanır (bayatlama yok).
function patchGetPointer(fc){
  fc.getPointer = function(e, ignoreZoom){
    if(this._absolutePointer && !ignoreZoom) return this._absolutePointer;
    if(this._pointer && ignoreZoom) return this._pointer;
    const upperCanvasEl = this.upperCanvasEl;
    const bounds = upperCanvasEl.getBoundingClientRect();
    const boundsWidth = bounds.width || 0, boundsHeight = bounds.height || 0;
    const te = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
    // iPhone 14 Pro MAX'te visualViewport.offsetTop=-59 ölçüldü (Pro'da 0 → orada etkisiz).
    // position:fixed RENDER parmakla hizalı (yeşil nokta altında) ama getBoundingClientRect
    // LAYOUT çerçevesinde → ikisi vvTop kadar ayrı; mürekkep parmağın ÜSTÜne kayıyordu.
    // vvTop'u ÇIKAR → mürekkep aşağı, parmağa iner (vvTop<0 olduğundan +59 etki).
    const vv = window.visualViewport;
    const vox = vv ? vv.offsetLeft : 0, voy = vv ? vv.offsetTop : 0;
    let pointer = { x: (te.clientX - bounds.left) - vox, y: (te.clientY - bounds.top) - voy };
    if(!ignoreZoom) pointer = this.restorePointerVpt(pointer);
    const retina = this.getRetinaScaling();
    if(retina !== 1){ pointer.x /= retina; pointer.y /= retina; }
    const cssScale = (boundsWidth === 0 || boundsHeight === 0)
      ? { width: 1, height: 1 }
      : { width: upperCanvasEl.width / boundsWidth, height: upperCanvasEl.height / boundsHeight };
    return { x: pointer.x * cssScale.width, y: pointer.y * cssScale.height };
  };
  return fc;
}
window.patchGetPointer = patchGetPointer;

function rememberCanvasDrawTap(){
  if(['pen','tukenmez','marker'].includes(appState.drawTool)){
    appState._lastCanvasDrawTapAt = Date.now();
    const pageNum = appState.fabricCanvas?._pageNum || appState.currentPage;
    markLocalDrawingEdit(pageNum);
  }
}

function drawingKeyForPage(pageNum){
  return appState.aktifFasikul ? `drawing_${appState.aktifFasikul.id}_p${pageNum}` : '';
}

function markLocalDrawingEdit(pageNum){
  const key = drawingKeyForPage(pageNum);
  if(!key) return;
  appState.drawingLocalEditAt[key] = Date.now();
}

function bindCanvasDrawTapMemory(fc){
  if(!fc?.upperCanvasEl || fc._drawTapMemoryReady) return;
  fc._drawTapMemoryReady = true;
  ['pointerdown','touchstart','mousedown'].forEach(type=>{
    fc.upperCanvasEl.addEventListener(type, rememberCanvasDrawTap, { passive: true, capture: true });
  });
}

function liftFabricHitLayer(fc){
  const container = fc?.wrapperEl || fc?.upperCanvasEl?.parentElement;
  if(container){
    container.style.position = 'absolute';
    container.style.left = '0';
    container.style.top = '0';
    container.style.zIndex = '30';
    container.style.pointerEvents = 'auto';
    container.style.webkitUserSelect = 'none';
    container.style.userSelect = 'none';
    container.style.webkitTouchCallout = 'none';
  }
  if(fc?.upperCanvasEl){
    fc.upperCanvasEl.style.zIndex = '32';
    fc.upperCanvasEl.style.pointerEvents = 'auto';
    fc.upperCanvasEl.style.touchAction = 'none';
    fc.upperCanvasEl.style.webkitUserSelect = 'none';
    fc.upperCanvasEl.style.userSelect = 'none';
    fc.upperCanvasEl.style.webkitTouchCallout = 'none';
  }
  if(fc?.lowerCanvasEl){
    fc.lowerCanvasEl.style.zIndex = '31';
    fc.lowerCanvasEl.style.pointerEvents = 'none';
    fc.lowerCanvasEl.style.webkitUserSelect = 'none';
    fc.lowerCanvasEl.style.userSelect = 'none';
    fc.lowerCanvasEl.style.webkitTouchCallout = 'none';
  }
}

function initFabricForPage(canvasEl, w, h, pageNum, opts={}){
  patchFabricTouchStartPreventDefault();
  const fc = new fabric.Canvas(canvasEl, {
    isDrawingMode: false, selection: true,
    width: w, height: h, backgroundColor: 'transparent',
    // bkz. patchFabricTouchStartPreventDefault üstündeki not.
    allowTouchScrolling: true,
    // render.js MAX_CANVAS_DIM tavanı: çağıran taraf zaten kendi DPR+tavan
    // hesabıyla arabellek boyutunu (w,h) belirlediyse Fabric'in KENDİ
    // retina ölçeklemesi (varsayılan açık, window.devicePixelRatio'ya göre —
    // BİZİM tavanlı dpr sabitimizden BAĞIMSIZ, ör. iPhone'da 3) bunun ÜSTÜNE
    // BİR KEZ DAHA çarpıp arabelleği beklenenden ~1.5× büyük bırakıyordu
    // (4096 hedeflenirken gerçekte 5906 ölçüldü) — tavan etkisiz kalıyordu.
    ...(opts.disableRetinaScaling ? { enableRetinaScaling: false } : {}),
  });
  patchGetPointer(fc);
  bindCanvasDrawTapMemory(fc);
  liftFabricHitLayer(fc);
  fc._pageNum = pageNum;
  appState.fabricCanvases[pageNum] = fc;

  // İnceleme modu: tuval tamamen salt-okunur (görüntüleme amaçlı) kalır —
  // öğretmen öğrencinin çizimini asla düzenleyemez/silemez.
  if(appState.reviewMode){
    fc.isDrawingMode = false;
    fc.selection = false;
    fc.skipTargetFind = true;
  }

  // Aktif sayfaysa ana canvas olarak işaretle
  if(pageNum === appState.currentPage){
    appState.fabricCanvas = fc;
  }
  // Sayfa aktif olsun olmasın, tuval HEMEN aktif araca göre ayarlanmalı —
  // aksi halde Fabric'in ham varsayılanında (selection:true) kalır ve
  // parmakla dokununca (özellikle panlarken henüz çizilmemiş komşu sayfaya
  // girince) istenmeyen mavi seçim kutusu açılır.
  if(!appState.reviewMode) applyTool(appState.drawTool);

  // Kayıtlı çizim varsa yükle
  const key = drawingKeyForPage(pageNum);
  const saved = appState.drawings[key];
  if(saved){
    try{
      fc.loadFromJSON(saved, ()=>{
        applyDrawingScale(fc, key);
        if(appState.reviewMode) setObjectsInteractive(fc, false);
        else applyTool(appState.drawTool);
        fc.renderAll();
        window.refreshSharedBoard?.();
      });
    }catch(e){}
  }
  else { window.refreshSharedBoard?.(); }

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
  fc.on('mouse:down', rememberCanvasDrawTap);

  // Otomatik kayıt
  const debounceSave = (delay=160)=>{
    if(appState._saveTimeout) clearTimeout(appState._saveTimeout);
    appState._saveTimeout = setTimeout(()=>saveDrawingForPage(pageNum), delay);
  };
  const localCanvasChanged = ()=>{
    if(fc._loadingDrawing || fc._applyingRemoteDrawing) return;
    markLocalDrawingEdit(pageNum);
    debounceSave();
  };
  fc.on('object:added', localCanvasChanged);
  fc.on('object:modified', localCanvasChanged);
  fc.on('object:removed', localCanvasChanged);
  fc.on('text:changed', opt=>{
    stabilizeTextSelection(opt?.target);
    markLocalDrawingEdit(pageNum);
    debounceSave(80);
  });
  fc.on('text:editing:exited', opt=>{
    const target = opt?.target;
    detachTextInputGuard(target);
    if(target && target.type === 'i-text' && !String(target.text || '').trim()){
      fc.remove(target);
    }
    saveDrawingForPage(pageNum);
  });
  fc.on('object:added', ()=>{ if(!fc._loadingDrawing && !fc._applyingRemoteDrawing){ pushUndoSnapshot(localCanvasJSON(fc)); appState.redoStack=[]; } });
}

function saveDrawingForPage(pageNum){
  const fc = appState.fabricCanvases[pageNum];
  if(!fc || !appState.aktifFasikul) return;
  const key = drawingKeyForPage(pageNum);
  const json=localCanvasJSON(fc);
  appState.drawings[key] = json;
  appState.drawingDims[key] = { w: fc.width, h: fc.height };
  persistDrawingCloud(key, json, fc.width, fc.height, { live:true, pageNum });
}

// Canlı takipte (watchStudentLive): izlenen öğrencinin cizimler subcollection'ı
// realtime.js'deki subscribeRealtimeDrawings() ile appState.drawings'e
// yazılıyor, AMA bu SADECE tuval o an ZATEN "aktif sayfa" ise ekrana da
// uygulanıyor (initFabricForPage tuval İLK KURULURKEN appState.drawings'e
// bakar, sonradan gelen güncellemeyi kendiliğinden yakalamaz). Admin sayfa
// A'dayken canlı takip B sayfasına geçerse ve öğrencinin B'deki eski
// çiziminin verisi tuval B kurulmadan ÖNCE ya da SONRA gelmiş olabilir —
// zamanlamaya göre B'nin tuvali boş kalabiliyordu. _followCanli sayfa
// senkronundan SONRA bunu çağırıp mevcut tuvali appState.drawings'teki
// GÜNCEL veriyle zorla eşitliyoruz (fark yoksa no-op).
function reloadDrawingForPage(pageNum){
  const fc = appState.fabricCanvases[pageNum];
  if(!fc) return;
  const key = drawingKeyForPage(pageNum);
  const saved = appState.drawings[key];
  if(!saved) return;
  let current = '';
  try{ current = localCanvasJSON(fc); }catch(e){}
  if(current === saved) return;
  fc._loadingDrawing = true;
  try{
    fc.loadFromJSON(saved, ()=>{
      applyDrawingScale(fc, key);
      fc.renderAll();
      fc._loadingDrawing = false;
    });
  }catch(e){ fc._loadingDrawing = false; }
}
window.reloadDrawingForPage = reloadDrawingForPage;

// Çizim değişiklikleri her zaman 160ms (metin 80ms) debounce'la buluta
// yazılır ve — cevaplardan farklı olarak — hiçbir localStorage yedeği
// YOKTUR (sadece appState.drawings/RAM). Sekme kapanmadan önceki
// visibilitychange/pagehide flush'ı (main.js) bu bekleyen zamanlayıcıyı
// hiç kontrol etmiyordu — tablet bellek baskısıyla sekme aniden
// kapandığında, son 160ms içindeki (henüz ateşlenmemiş) çizim buluta hiç
// gitmeden kayboluyordu. main.js buradan çağırıp o bekleyen kaydı zorluyor.
function flushPendingDrawingSave(){
  if(!appState._saveTimeout) return;
  clearTimeout(appState._saveTimeout);
  appState._saveTimeout = null;
  saveDrawingForPage(appState.currentPage);
}
window.flushPendingDrawingSave = flushPendingDrawingSave;

function stabilizeTextSelection(target){
  if(!target || target.type !== 'i-text' || !target.isEditing || !target.hiddenTextarea) return;
  const ta = target.hiddenTextarea;
  const len = ta.value.length;
  const textareaAllSelected = ta.selectionStart === 0 && ta.selectionEnd === len;
  const fabricAllSelected = target.selectionStart === 0 && target.selectionEnd === len;
  if(len > 0 && (textareaAllSelected || fabricAllSelected)){
    ta.selectionStart = len;
    ta.selectionEnd = len;
    target.selectionStart = len;
    target.selectionEnd = len;
  }
}

function attachTextInputGuard(target){
  if(!target || target.type !== 'i-text' || !target.hiddenTextarea || target._textInputGuard) return;
  const ta = target.hiddenTextarea;
  const collapseBeforeInsert = e=>{
    const isInsert = e.type === 'beforeinput'
      ? String(e.inputType || '').startsWith('insert')
      : (!e.ctrlKey && !e.metaKey && !e.altKey && String(e.key || '').length === 1);
    if(isInsert) stabilizeTextSelection(target);
  };
  const collapseAfterInput = ()=>setTimeout(()=>stabilizeTextSelection(target), 0);
  ta.addEventListener('beforeinput', collapseBeforeInsert);
  ta.addEventListener('keydown', collapseBeforeInsert);
  ta.addEventListener('input', collapseAfterInput);
  target._textInputGuard = { collapseBeforeInsert, collapseAfterInput };
}

function detachTextInputGuard(target){
  const guard = target?._textInputGuard;
  const ta = target?.hiddenTextarea;
  if(!guard || !ta) return;
  ta.removeEventListener('beforeinput', guard.collapseBeforeInsert);
  ta.removeEventListener('keydown', guard.collapseBeforeInsert);
  ta.removeEventListener('input', guard.collapseAfterInput);
  target._textInputGuard = null;
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
  patchFabricTouchStartPreventDefault();
  if(appState.fabricCanvas){ try{ appState.fabricCanvas.dispose(); }catch(e){} }

  const fc = new fabric.Canvas(canvasEl, {
    isDrawingMode: false,
    selection: true,
    width: w,
    height: h,
    backgroundColor: 'transparent',
    // bkz. initFabricForPage'deki not: Fabric'in kendi preventDefault'unu
    // kapatır, native pan/scroll kararı CSS touch-action'a kalır.
    allowTouchScrolling: true,
  });
  patchGetPointer(fc);
  bindCanvasDrawTapMemory(fc);
  liftFabricHitLayer(fc);
  appState.fabricCanvas = fc;

  // Sayfa için kayıtlı çizim varsa yükle
  const key = drawingKeyForPage(appState.currentPage);
  const saved = appState.drawings[key];
  if(saved){
    try{
      fc._loadingDrawing = true;
      fc.loadFromJSON(saved, ()=>{ applyDrawingScale(fc, key); fc._loadingDrawing = false; fc.renderAll(); window.refreshSharedBoard?.(); });
    }catch(e){ fc._loadingDrawing = false; }
  } else { window.refreshSharedBoard?.(); }

  // Otomatik kayıt (canlı izleme için kısa debounce)
  const localCanvasChanged = ()=>{
    if(fc._loadingDrawing || fc._applyingRemoteDrawing) return;
    markLocalDrawingEdit(appState.currentPage);
    debounceAutoSave();
  };
  fc.on('object:added', localCanvasChanged);
  fc.on('object:modified', localCanvasChanged);
  fc.on('object:removed', localCanvasChanged);
  fc.on('text:changed', opt=>{
    stabilizeTextSelection(opt?.target);
    markLocalDrawingEdit(appState.currentPage);
    debounceAutoSave(80);
  });
  fc.on('text:editing:exited', opt=>{
    const target = opt?.target;
    detachTextInputGuard(target);
    if(target && target.type === 'i-text' && !String(target.text || '').trim()){
      fc.remove(target);
    }
    saveDrawing();
  });

  // Undo stack
  fc.on('object:added', ()=>{ if(!fc._loadingDrawing && !fc._applyingRemoteDrawing){ pushUndoSnapshot(localCanvasJSON(fc)); appState.redoStack=[]; } });
  fc.on('mouse:down', rememberCanvasDrawTap);

  applyTool(appState.drawTool);
}

function debounceAutoSave(delay=160){
  if(appState._saveTimeout) clearTimeout(appState._saveTimeout);
  appState._saveTimeout = setTimeout(saveDrawing, delay);
}

function saveDrawing(){
  if(!appState.aktifFasikul) return;
  if(appState.viewMode === 'scroll'){
    // Tüm render edilmiş sayfaları kaydet
    Object.entries(appState.fabricCanvases).forEach(([pn, fc])=>{
      const key = drawingKeyForPage(pn);
      const json=localCanvasJSON(fc);
      appState.drawings[key] = json;
      appState.drawingDims[key] = { w: fc.width, h: fc.height };
      persistDrawingCloud(key, json, fc.width, fc.height, { live:false, pageNum:Number(pn) });
    });
  } else {
    const fc = appState.fabricCanvas;
    if(!fc) return;
    const key = drawingKeyForPage(appState.currentPage);
    const json=localCanvasJSON(fc);
    appState.drawings[key] = json;
    appState.drawingDims[key] = { w: fc.width, h: fc.height };
    persistDrawingCloud(key, json, fc.width, fc.height, { live:true, pageNum:appState.currentPage });
  }
  const ind = document.getElementById('readerToolbar').querySelector('[title="Kaydet (Ctrl+S)"]');
  if(ind) { ind.style.color='var(--green)'; setTimeout(()=>ind.style.color='',800); }
}

function getActiveTextObject(){
  const canvases = appState.viewMode === 'scroll'
    ? Object.values(appState.fabricCanvases || {})
    : (appState.fabricCanvas ? [appState.fabricCanvas] : []);
  for(const fc of canvases){
    const active = fc?.getActiveObject?.();
    if(active && active.type === 'i-text' && active.isEditing) return { fc, active };
  }
  return null;
}

function isFabricTextEditing(){
  return !!getActiveTextObject();
}

function flushActiveTextEditing(){
  const info = getActiveTextObject();
  if(!info) return false;
  info.active.setCoords();
  info.fc.requestRenderAll();
  const pageNum = Number(info.fc._pageNum || appState.currentPage);
  if(appState.viewMode === 'scroll') saveDrawingForPage(pageNum);
  else saveDrawing();
  return true;
}

// ── Tools


// ── Bu modülün fonksiyonlarını window'a kaydet ──
// main.js ve diğer modüller window.xxx ile çağırabilsin
window.initFabricForPage = initFabricForPage;
window.saveDrawingForPage = saveDrawingForPage;
window.markLocalDrawingEdit = markLocalDrawingEdit;
window.attachTextInputGuard = attachTextInputGuard;
window.setObjectsInteractive = setObjectsInteractive;
window.clearToolHandlers = clearToolHandlers;
window.initFabricCanvas = initFabricCanvas;
window.initFabricOnCanvas = initFabricOnCanvas;
window.debounceAutoSave = debounceAutoSave;
window.saveDrawing = saveDrawing;
window.isFabricTextEditing = isFabricTextEditing;
window.flushActiveTextEditing = flushActiveTextEditing;
