import { appState } from '../state/appState.js';

function setTool(btn, tool){
  document.querySelectorAll('#toolGroup .tool-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  appState.drawTool = tool;
  applyTool(tool);
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
        fc.isDrawingMode=false; fc.selection=true;
        fc.skipTargetFind=false;
        fc.defaultCursor='default'; fc.hoverCursor='move';
        setObjectsInteractive(fc, true);
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
          const t = new fabric.IText('Metin yaz…', {
            left:p.x, top:p.y, fontSize:14, fill:appState.drawColor,
            fontFamily:'DM Sans, sans-serif', editable:true
          });
          fc.add(t); fc.setActiveObject(t); t.enterEditing(); fc.renderAll();
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
        let _erasing = false, _eraseChanged = false;
        fc._eraserToolHandler = (opt)=>{
          _erasing = true; _eraseChanged = false;
          const target = opt.target || fc.findTarget(opt.e, false);
          if(!target) return;
          fc.remove(target); fc.discardActiveObject(); fc.requestRenderAll();
          _eraseChanged = true;
        };
        fc._eraserMoveHandler = (opt)=>{
          if(!_erasing) return;
          const target = opt.target || fc.findTarget(opt.e, false);
          if(!target) return;
          fc.remove(target); fc.discardActiveObject(); fc.requestRenderAll();
          _eraseChanged = true;
        };
        fc._eraserUpHandler = ()=>{
          _erasing = false;
          if(_eraseChanged){
            saveDrawingForPage(Number(fc._pageNum || appState.currentPage));
            appState.undoStack.push(JSON.stringify(fc));
            appState.redoStack = [];
            _eraseChanged = false;
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

document.getElementById('brushSize').addEventListener('input',e=>{
  appState.brushSize = parseInt(e.target.value);
  const canvases = appState.viewMode === 'scroll'
    ? Object.values(appState.fabricCanvases)
    : (appState.fabricCanvas ? [appState.fabricCanvas] : []);
  canvases.forEach(fc=>{
    if(fc && fc.isDrawingMode && fc.freeDrawingBrush){
      if(appState.drawTool==='marker') fc.freeDrawingBrush.width=appState.brushSize*4;
      else fc.freeDrawingBrush.width=appState.brushSize;
    }
  });
});

function undoDraw(){
  const fc = appState.fabricCanvas;
  if(!fc) return;
  if(appState.undoStack.length > 1){
    appState.redoStack.push(appState.undoStack.pop());
    const prev = appState.undoStack[appState.undoStack.length-1];
    fc.loadFromJSON(prev,()=>fc.renderAll());
  } else if(appState.undoStack.length===1){
    appState.redoStack.push(appState.undoStack.pop());
    fc.clear(); fc.renderAll();
  }
}

function redoDraw(){
  const fc = appState.fabricCanvas;
  if(!fc || !appState.redoStack.length) return;
  const next = appState.redoStack.pop();
  fc.loadFromJSON(next,()=>fc.renderAll());
  appState.undoStack.push(next);
}

function clearPage(){
  if(!confirm('Bu sayfadaki tüm çizimler silinecek. Emin misiniz?')) return;
  const pageNum = appState.currentPage;
  const fc = appState.fabricCanvases?.[pageNum] || appState.fabricCanvas;
  if(fc){
    fc.getObjects().slice().forEach(obj=>fc.remove(obj));
    fc.discardActiveObject();
    fc.requestRenderAll();
  }
  const key = `drawing_${appState.aktifFasikul?.id}_p${pageNum}`;
  delete appState.drawings[key];
  deleteDrawingCloud(key);
  appState.undoStack.push(fc ? JSON.stringify(fc) : '{}');
  appState.redoStack = [];
  showToast('Sayfa temizlendi','info');
}

// ── Page Navigation


// ── Bu modülün fonksiyonlarını window'a kaydet ──
// main.js ve diğer modüller window.xxx ile çağırabilsin
window.setTool = setTool;
window.applyTool = applyTool;
window.setColor = setColor;
window.undoDraw = undoDraw;
window.redoDraw = redoDraw;
window.clearPage = clearPage;
