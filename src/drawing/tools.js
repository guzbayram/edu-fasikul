import { appState } from '../state/appState.js';

const DRAW_TAP_TOOL_LOCK_MS = 450;

function shouldIgnoreToolChange(tool){
  if(tool !== 'eraser') return false;
  const lastTap = appState._lastCanvasDrawTapAt || 0;
  return Date.now() - lastTap < DRAW_TAP_TOOL_LOCK_MS;
}

function setTool(btn, tool){
  if(shouldIgnoreToolChange(tool)) return;
  document.querySelectorAll('.tool-btn[data-tool]').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll(`.tool-btn[data-tool="${tool}"]`).forEach(b=>b.classList.add('active'));
  appState.drawTool = tool;
  // Silgi boyutu seçeneklerini yalnızca silgi seçiliyken göster
  document.querySelectorAll('.eraser-size-group').forEach(g=>{
    g.style.display = (tool==='eraser') ? 'inline-flex' : 'none';
  });
  applyTool(tool);
}

function setEraserSize(btn, size){
  appState.eraserSize = size;
  document.querySelectorAll('.eraser-size-btn').forEach(b=>{
    b.classList.toggle('active', Number(b.dataset.esize) === size);
  });
  if(appState.drawTool === 'eraser') applyEraserCursor();
}

// Silgi imleci: seçili boyutta yuvarlak (CSS data-URI cursor)
function eraserCursorCss(){
  const r = Math.max(4, appState.eraserSize || 8);
  const s = r * 2 + 4, c = s / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}"><circle cx="${c}" cy="${c}" r="${r}" fill="rgba(244,63,94,0.12)" stroke="#f43f5e" stroke-width="1.5"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${c} ${c}, cell`;
}
function applyEraserCursor(){
  const css = eraserCursorCss();
  const canvases = appState.viewMode === 'scroll'
    ? Object.values(appState.fabricCanvases)
    : (appState.fabricCanvas ? [appState.fabricCanvas] : []);
  canvases.forEach(fc => { if(fc?.upperCanvasEl) fc.upperCanvasEl.style.setProperty('cursor', css, 'important'); });
}

function applyTool(tool){
  // Scroll modunda tüm canvaslara, tek sayfada sadece aktife uygula
  const canvases = appState.viewMode === 'scroll'
    ? Object.values(appState.fabricCanvases)
    : (appState.fabricCanvas ? [appState.fabricCanvas] : []);

  document.getElementById('readerCenter').dataset.tool = tool;

  canvases.forEach(fc => {
    clearToolHandlers(fc);
    switch(tool){
      case 'select':
        fc.isDrawingMode=false;
        // El/pan modunda mobil sürüklemede Fabric'in mavi çoklu seçim kutusu açılmasın.
        fc.selection=false;
        fc.skipTargetFind=false;
        fc.defaultCursor='default'; fc.hoverCursor='move';
        setObjectsInteractive(fc, true);
        fc.discardActiveObject?.();
        fc.requestRenderAll?.();
        break;
      case 'pen':
        fc.isDrawingMode=true;
        fc.selection=false;
        fc.skipTargetFind=true;
        setObjectsInteractive(fc, false);
        fc.freeDrawingBrush = new fabric.PencilBrush(fc);
        fc.freeDrawingBrush.color = appState.drawColor;
        fc.freeDrawingBrush.width = appState.brushSize;
        fc.freeDrawingBrush.globalCompositeOperation = 'source-over';
        break;
      case 'tukenmez':
        fc.isDrawingMode=true;
        fc.selection=false;
        fc.skipTargetFind=true;
        setObjectsInteractive(fc, false);
        fc.freeDrawingBrush = new fabric.PencilBrush(fc);
        fc.freeDrawingBrush.color = appState.drawColor;
        fc.freeDrawingBrush.width = Math.max(1, appState.brushSize*0.6);
        break;
      case 'marker':
        fc.isDrawingMode=true;
        fc.selection=false;
        fc.skipTargetFind=true;
        setObjectsInteractive(fc, false);
        fc.freeDrawingBrush = new fabric.PencilBrush(fc);
        fc.freeDrawingBrush.color = appState.drawColor+'66';
        fc.freeDrawingBrush.width = appState.brushSize * 4;
        break;
      case 'text':
        fc.isDrawingMode=false; fc.selection=true;
        fc.skipTargetFind=false;
        setObjectsInteractive(fc, true);
        fc._textToolHandler = (opt)=>{
          if(opt.target) return;
          const p = fc.getPointer(opt.e);
          const t = new fabric.IText('', {
            left:p.x, top:p.y, fontSize:14, fill:appState.drawColor,
            fontFamily:'DM Sans, sans-serif', editable:true
          });
          fc.add(t);
          fc.setActiveObject(t);
          t.enterEditing();
          if(t.hiddenTextarea){
            t.hiddenTextarea.focus();
            t.hiddenTextarea.selectionStart = 0;
            t.hiddenTextarea.selectionEnd = 0;
          }
          t.selectionStart = 0;
          t.selectionEnd = 0;
          window.attachTextInputGuard?.(t);
          fc.renderAll();
          clearToolHandlers(fc);
        };
        fc.on('mouse:down', fc._textToolHandler);
        break;
      case 'eraser':
        fc.isDrawingMode=false;
        fc.selection=false;
        fc.skipTargetFind=false;
        fc.discardActiveObject();
        fc.defaultCursor='cell';
        fc.hoverCursor='cell';
        setObjectsInteractive(fc, false);
        applyEraserCursor();
        let _erasing = false, _eraseChanged = false;
        const _eraseAt = (opt)=>{
          const p = fc.getPointer(opt.e);
          const r = appState.eraserSize || 8;
          let changed = false;
          // 1) İmlecin tam altındaki nesneyi sil (hassas). Ortak tahtada BAŞKASININ
          //    kalemi (_owner) silinmez — yoksa yerel silinip senkronla geri gelir.
          const t = opt.target || fc.findTarget(opt.e, false);
          if(t && !t._owner){ fc.remove(t); changed = true; }
          // 2) Silgi yarıçapı içindeki KENDİ nesnelerini de sil
          fc.getObjects().slice().forEach(obj=>{
            if(obj._owner) return;   // başkasının kalemi — dokunma
            const b = obj.getBoundingRect();
            const dx = Math.max(b.left - p.x, 0, p.x - (b.left + b.width));
            const dy = Math.max(b.top - p.y, 0, p.y - (b.top + b.height));
            if(Math.hypot(dx, dy) <= r){ fc.remove(obj); changed = true; }
          });
          if(changed){ fc.discardActiveObject(); fc.requestRenderAll(); _eraseChanged = true; }
        };
        fc._eraserToolHandler = (opt)=>{ _erasing = true; _eraseChanged = false; _eraseAt(opt); };
        fc._eraserMoveHandler = (opt)=>{ if(_erasing) _eraseAt(opt); };
        fc._eraserUpHandler = ()=>{
          _erasing = false;
          if(_eraseChanged){
            saveDrawingForPage(Number(fc._pageNum || appState.currentPage));
            appState.undoStack.push(window._localCanvasJSON?.(fc) ?? JSON.stringify(fc));
            appState.redoStack = [];
            _eraseChanged = false;
            // Silme bitince otomatik kaleme dön (tekrar kalem seçmeye gerek kalmasın)
            setTimeout(()=>{ if(appState.drawTool==='eraser') setTool(null, 'pen'); }, 0);
          }
        };
        fc.on('mouse:down', fc._eraserToolHandler);
        fc.on('mouse:move', fc._eraserMoveHandler);
        fc.on('mouse:up', fc._eraserUpHandler);
        break;
    }
    fc.renderAll();
  });
}

function setColor(dot){
  document.querySelectorAll('.color-dot').forEach(d=>d.classList.remove('selected'));
  dot.classList.add('selected');
  appState.drawColor = dot.dataset.color;
  const canvases = appState.viewMode === 'scroll'
    ? Object.values(appState.fabricCanvases)
    : (appState.fabricCanvas ? [appState.fabricCanvas] : []);
  canvases.forEach(fc=>{
    if(fc && fc.isDrawingMode && fc.freeDrawingBrush){
      if(appState.drawTool==='marker') fc.freeDrawingBrush.color=appState.drawColor+'66';
      else fc.freeDrawingBrush.color=appState.drawColor;
    }
  });
}

function applyBrushSize(value){
  appState.brushSize = parseInt(value, 10);
  document.querySelectorAll('.size-slider').forEach(slider=>{
    if(Number(slider.value) !== appState.brushSize) slider.value = String(appState.brushSize);
  });
  const canvases = appState.viewMode === 'scroll'
    ? Object.values(appState.fabricCanvases)
    : (appState.fabricCanvas ? [appState.fabricCanvas] : []);
  canvases.forEach(fc=>{
    if(fc && fc.isDrawingMode && fc.freeDrawingBrush){
      if(appState.drawTool==='marker') fc.freeDrawingBrush.width=appState.brushSize*4;
      else fc.freeDrawingBrush.width=appState.brushSize;
    }
  });
}

document.querySelectorAll('.size-slider').forEach(slider=>{
  slider.value = String(appState.brushSize || slider.value || 3);
  slider.addEventListener('input', e=>applyBrushSize(e.target.value));
});

function undoDraw(){
  const fc = appState.fabricCanvas;
  if(!fc) return;
  if(appState.undoStack.length > 1){
    appState.redoStack.push(appState.undoStack.pop());
    const prev = appState.undoStack[appState.undoStack.length-1];
    fc.loadFromJSON(prev,()=>{ fc.renderAll(); window.refreshSharedBoard?.(); });
  } else if(appState.undoStack.length===1){
    appState.redoStack.push(appState.undoStack.pop());
    fc.clear(); fc.renderAll(); window.refreshSharedBoard?.();
  }
}

function redoDraw(){
  const fc = appState.fabricCanvas;
  if(!fc || !appState.redoStack.length) return;
  const next = appState.redoStack.pop();
  fc.loadFromJSON(next,()=>{ fc.renderAll(); window.refreshSharedBoard?.(); });
  appState.undoStack.push(next);
}

function clearPage(){
  if(!confirm('Bu sayfadaki tüm çizimler silinecek. Emin misiniz?')) return;
  const pageNum = appState.currentPage;
  const fc = appState.fabricCanvases?.[pageNum] || appState.fabricCanvas;
  if(fc){
    // Yalnız KENDİ nesnelerini sil; ortak tahtadaki başkalarının kalemine dokunma
    fc.getObjects().slice().forEach(obj=>{ if(!obj._owner) fc.remove(obj); });
    fc.discardActiveObject();
    fc.requestRenderAll();
  }
  const key = `drawing_${appState.aktifFasikul?.id}_p${pageNum}`;
  window.markLocalDrawingEdit?.(pageNum);
  delete appState.drawings[key];
  deleteDrawingCloud(key);
  appState.undoStack.push(fc ? (window._localCanvasJSON?.(fc) ?? JSON.stringify(fc)) : '{}');
  appState.redoStack = [];
  showToast('Sayfa temizlendi','info');
}

// ── Page Navigation


// ── Bu modülün fonksiyonlarını window'a kaydet ──
// main.js ve diğer modüller window.xxx ile çağırabilsin
window.setTool = setTool;
window.setEraserSize = setEraserSize;
window.applyTool = applyTool;
window.setColor = setColor;
window.undoDraw = undoDraw;
window.redoDraw = redoDraw;
window.clearPage = clearPage;
