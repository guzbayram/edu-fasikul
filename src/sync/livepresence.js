import { appState } from '../state/appState.js';
import { _getUserKey } from '../firebase/firestore.js';

// ══════════════════════════════════════════════════════════
// CANLI OTURUM — aynı fasikülde bulunanların listesi + seçerek takip
// Öğrenci/öğretmen/admin herkes kendi konumunu (sayfa + o sayfanın çizimi)
// canliOturum/{fasikulId}/uyeler/{uid} dokümanına yazar. Aynı fasiküldekiler
// birbirini listede görür; birine dokununca o kişinin sayfası + çizimleri
// yansır. Kimsenin özel (kullanicilar/{uid}) dokümanı okunmaz.
// ══════════════════════════════════════════════════════════

const HEARTBEAT_MS = 3000;
const ONLINE_WINDOW_MS = 45000;   // ts bu süre içinde tazelenmezse "çevrimdışı"
let _presFasikulId = null;
let _rosterUnsub = null;
let _heartbeatTimer = null;
let _startRetryTimer = null;
let _pubTimer = null, _drawPubTimer = null;
let _presenceScrollWrap = null;
let _presenceScrollHandler = null;
let _roster = [];
let _followUid = null;
let _lastFollowSig = '';
let _followApplyTimer = null;
let _followApplySeq = 0;
let _lastFollowApplyAt = 0;
let _lastPresenceWriteAt = 0;
let _followSourceId = '';
let _followSourceSeenAt = 0;
const FOLLOW_APPLY_DELAY_MS = 220;
const FOLLOW_MIN_INTERVAL_MS = 320;
const PRESENCE_MIN_WRITE_INTERVAL_MS = 350;
const FOLLOW_SOURCE_LOCK_MS = 12000;
const FOLLOW_DRAW_APPLY_DELAY_MS = 25;
const FOLLOW_DRAW_RETRY_MS = 90;
const FOLLOW_DRAW_MAX_RETRY = 12;

function _esc(s){ return String(s??'').replace(/[<>&]/g, c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])); }
function _escAttr(s){ return _esc(s).replace(/'/g,"\\'"); }

function _me(){
  const u = appState.user;
  if(!u || u.email === 'misafir@demo.com') return null;
  const uid = _getUserKey();
  if(!uid) return null;
  return { uid, name: u.name || u.email || 'Kullanıcı', role: u.role || 'ogrenci' };
}
function _presenceDeviceId(){
  if(!appState._liveDeviceId)
    appState._liveDeviceId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  return appState._liveDeviceId;
}
function _ready(){ return !!(window._firestoreReady && window._db && window._fsDoc && window._fsSetDoc); }
function _memberRef(fasikulId, uid){ return window._fsDoc(window._db,'canliOturum',fasikulId,'uyeler',uid); }
function _roleIcon(r){ return r==='ogretmen'?'👨‍🏫':r==='admin'?'🔑':'🎓'; }
function _hashDraw(json){
  const s = String(json || '');
  let h = 0;
  for(let i=0;i<s.length;i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return `${s.length}:${h >>> 0}`;
}

function _slugRoomPart(value){
  return String(value || '')
    .normalize('NFC')
    .toLocaleLowerCase('tr-TR')
    .replace(/[\/\\#?\[\].]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
}

function _canonicalRoomPart(fas){
  const candidates = [fas?.id, fas?.jsonFile, fas?.pdfFile, fas?.ad]
    .map(_slugRoomPart)
    .filter(Boolean);
  // Aynı fasikül bazı cihazlarda katalog adıyla, bazı cihazlarda JSON içindeki
  // özgün PDF adıyla gelebiliyor. Oda anahtarı bunlardan türetilirse admin ve
  // öğrenci aynı görünen fasikülde farklı canlı odalara düşer.
  if(candidates.some(v =>
    v === 'yaricap-tyt-problemler' ||
    v.includes('6-5-yaricap-tyt-problemler-fasikulu') ||
    v.includes('tyt-problemler-fasikulu-yaricap')
  )){
    return 'yaricap-tyt-problemler';
  }
  return candidates[0] || 'unknown';
}

function _roomIdForFasikul(fas){
  if(!fas) return '';
  return `fas-${_canonicalRoomPart(fas)}`;
}

function _pageFromDrawingKey(fasikulId, key){
  const prefix = `drawing_${fasikulId}_p`;
  if(!key || !String(key).startsWith(prefix)) return 0;
  return Number(String(key).slice(prefix.length)) || 0;
}
function _pageFromAnyDrawingKey(key){
  return Number(String(key || '').match(/_p(\d+)$/)?.[1] || 0);
}

export function startCanliPresence(){
  const fas = appState.aktifFasikul;
  const roomId = _roomIdForFasikul(fas);
  const restartingSameRoom = !!(roomId && _presFasikulId === roomId);
  stopCanliPresence(true, { keepDoc: restartingSameRoom });
  const me = _me();
  if(!me || !fas || !roomId || !_ready() || !window._fsOnSnapshot || !window._fsCollection){
    schedulePresenceStartRetry();
    return;
  }
  clearTimeout(_startRetryTimer);
  _presFasikulId = roomId;
  _writePresence(true);
  window.voiceJoinRoom?.(roomId);
  const col = window._fsCollection(window._db,'canliOturum',roomId,'uyeler');
  _rosterUnsub = window._fsOnSnapshot(col, (snap)=>{
    const now = Date.now();
    const list = [];
    snap.forEach(d=>{
      const m = d.data(); if(!m || !m.uid) return;
      if((now - (m.ts||0)) > ONLINE_WINDOW_MS) return;
      list.push(m);
    });
    _roster = list;
    _renderRoster();
    _writePresence();
    if(_followUid) scheduleApplyFollow();
    if(appState.sharedBoard) refreshSharedBoard();   // biri çizince ortak tahtayı tazele
  }, (err)=>{
    console.warn('Canlı oturum dinleme hatası:',err);
    window.debugReport?.('presence.listen.failed', {error:err, fasikulId:fas.id, roomId});
  });
  _heartbeatTimer = setInterval(_writePresence, HEARTBEAT_MS);
  [250, 750, 1500, 3000].forEach(ms=>setTimeout(()=>_writePresence(true), ms));
  _attachPresenceScrollBridge();
  _updateRosterButton();
}

export function stopCanliPresence(silent, opts = {}){
  clearTimeout(_startRetryTimer); _startRetryTimer = null;
  if(_rosterUnsub){ _rosterUnsub(); _rosterUnsub = null; }
  if(_heartbeatTimer){ clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
  _detachPresenceScrollBridge();
  clearTimeout(_pubTimer); clearTimeout(_drawPubTimer); clearTimeout(_sbTimer); clearTimeout(_followApplyTimer);
  _followUid = null; _lastFollowSig = '';
  _followSourceId = '';
  _followSourceSeenAt = 0;
  appState._followingCanliMember = false;
  _followApplyTimer = null;
  _followApplySeq++;
  if(appState.sharedBoard){ appState.sharedBoard = false; _clearOverlay(); }
  const me = _me();
  if(!opts.keepDoc && me && _presFasikulId && _ready() && window._fsDeleteDoc){
    window._fsDeleteDoc(_memberRef(_presFasikulId, me.uid)).catch(()=>{});
  }
  if(!opts.keepDoc) window.voiceLeaveRoom?.();
  _presFasikulId = null;
  _roster = [];
  _hideRosterPanel();
  _updateRosterButton();
}

function schedulePresenceStartRetry(){
  clearTimeout(_startRetryTimer);
  _startRetryTimer = setTimeout(()=>{
    if(appState.aktifFasikul && !appState.reviewMode) startCanliPresence();
  }, 350);
}

function _attachPresenceScrollBridge(){
  _detachPresenceScrollBridge();
  const wrap = document.getElementById('readerCanvasWrap');
  if(!wrap) return;
  _presenceScrollWrap = wrap;
  _presenceScrollHandler = ()=>{
    if(appState.watchMode || appState.reviewMode || appState._presSuppress || appState._liveSuppress) return;
    publishCanliPresence();
  };
  wrap.addEventListener('scroll', _presenceScrollHandler, { passive:true });
}

function _detachPresenceScrollBridge(){
  if(_presenceScrollWrap && _presenceScrollHandler){
    _presenceScrollWrap.removeEventListener('scroll', _presenceScrollHandler);
  }
  _presenceScrollWrap = null;
  _presenceScrollHandler = null;
}

function _writePresence(force = false){
  const me = _me();
  const fas = appState.aktifFasikul;
  if(appState.reviewMode) return;
  const roomId = _roomIdForFasikul(fas);
  if(!me || !fas || !roomId || roomId !== _presFasikulId || !_ready()) return;
  const now = Date.now();
  if(!force && now - _lastPresenceWriteAt < PRESENCE_MIN_WRITE_INTERVAL_MS) return;
  _lastPresenceWriteAt = now;
  if(document.hidden){
    // Gizli sekme/arka plandaki cihaz eski sayfa bilgisini yazarsa aktif
    // öğrencinin canlı konumunu UID dokümanında ezer. Ama tamamen susarsa
    // anten rozeti kişiyi çevrimdışı sanır. Bu yüzden sadece heartbeat yaz.
    const hiddenPayload = {
      uid: me.uid, name: me.name, role: me.role,
      by: _presenceDeviceId(),
      dersId: appState.aktifDers?.id || '',
      fasikulId: fas.id,
      roomId,
      jsonFile: fas.jsonFile || '',
      pdfFile: fas.pdfFile || '',
      ts: now,
      hidden: true
    };
    window._fsSetDoc(_memberRef(roomId, me.uid), hiddenPayload, {merge:true}).catch(e=>{
      console.warn('Canlı oturum heartbeat hatası:',e);
      window.debugReport?.('presence.heartbeat.failed', {error:e, payload:hiddenPayload});
    });
    return;
  }
  // Zoom + sayfa-göreli pan konumu da taşınır ki takip eden AYNI görünümü
  // (kaydırma dahil) görsün — ekran boyutundan bağımsız kalması için MUTLAK
  // piksel değil ORAN (fracX/fracY, bkz. getCurrentPageScrollFraction).
  const suppressed = !!(appState.watchMode || appState._presSuppress || appState._liveSuppress);
  const frac = suppressed ? null : window.getCurrentPageScrollFraction?.();
  const payload = {
    uid: me.uid, name: me.name, role: me.role,
    by: _presenceDeviceId(),
    dersId: appState.aktifDers?.id || '',
    fasikulId: fas.id,
    roomId,
    jsonFile: fas.jsonFile || '',
    pdfFile: fas.pdfFile || '',
    page: appState.currentPage || 1,
    altKonuId: appState.aktifAltKonu?.id || '',
    ts: now,
    hidden: false
  };
  if(!suppressed){
    payload.zoom = appState.zoom || 100;
    payload.fracX = frac?.fracX ?? null;
    payload.fracY = frac?.fracY ?? null;
    payload.fracLeft = frac?.fracLeft ?? null;
    payload.fracRight = frac?.fracRight ?? null;
    payload.fracTop = frac?.fracTop ?? null;
    payload.fracBottom = frac?.fracBottom ?? null;
  }
  window._fsSetDoc(_memberRef(roomId, me.uid), payload, {merge:true}).catch(e=>{
    console.warn('Canlı oturum yazma hatası:',e);
    window.debugReport?.('presence.write.failed', {error:e, payload});
  });
}

// Gezinmede çağrılır (throttle)
export function publishCanliPresence(){
  if(appState.watchMode || appState.reviewMode || appState._presSuppress || appState._liveSuppress) return;
  if(!_presFasikulId) return;
  clearTimeout(_pubTimer);
  _pubTimer = setTimeout(_writePresence, 80);
}

// Çizim değişince: mevcut sayfanın çizimini kendi dokümanına koy → takipçiler görsün
export function publishCanliPresenceDraw(key, json, w, h){
  const me = _me();
  const fas = appState.aktifFasikul;
  const roomId = _roomIdForFasikul(fas);
  if(!me || !fas || !roomId || roomId !== _presFasikulId || !_ready() || !key) return;
  const drawPage = _pageFromDrawingKey(fas.id, key) || _pageFromAnyDrawingKey(key);
  if(!drawPage) return;
  const currentKey = `drawing_${fas.id}_p${appState.currentPage||1}`;
  const localEditAt = Number(appState.drawingLocalEditAt?.[key] || 0);
  const recentLocalEdit = localEditAt && Date.now() - localEditAt < 5000;
  if(key !== currentKey && !recentLocalEdit) return;
  clearTimeout(_drawPubTimer);
  _drawPubTimer = setTimeout(()=>{
    const now = Date.now();
    window._fsSetDoc(_memberRef(roomId, me.uid),
      { page:drawPage, drawKey:key, draw:json||'', drawTs:now, drawSig:_hashDraw(json), dw:w||0, dh:h||0, ts:now }, {merge:true})
      .catch(e=>window.debugLog?.('presence.draw.write.failed', {error:e, key}, 'warn'));
  }, 50);
}

// ── Takip ──────────────────────────────────────────────
export function followCanliMember(uid, name){
  const me = _me();
  if(!uid || uid === me?.uid) return;
  _followUid = uid;
  appState._followingCanliMember = true;
  _lastFollowSig = '';
  _followSourceId = '';
  _followSourceSeenAt = 0;
  window.showToast?.(`🔴 ${name||'Katılımcı'} takip ediliyor`,'success');
  _renderRoster();
  scheduleApplyFollow();
}

export function unfollowCanliMember(){
  if(!_followUid) return;
  _followUid = null; _lastFollowSig = '';
  _followSourceId = '';
  _followSourceSeenAt = 0;
  appState._followingCanliMember = false;
  _renderRoster();
  window.showToast?.('Takip durduruldu','info');
}

function scheduleApplyFollow(){
  const seq = ++_followApplySeq;
  const pause = Math.max(0, Number(appState._liveManualPauseUntil || 0) - Date.now());
  const wait = Math.max(pause || FOLLOW_APPLY_DELAY_MS, FOLLOW_MIN_INTERVAL_MS - (Date.now() - _lastFollowApplyAt));
  clearTimeout(_followApplyTimer);
  _followApplyTimer = setTimeout(()=>_applyFollow(seq), wait);
}

function acceptPresenceSource(m){
  if(!m?.by) return true;
  const now = Date.now();
  if(!_followSourceId || _followSourceId === m.by){
    _followSourceId = m.by;
    _followSourceSeenAt = now;
    return true;
  }
  // Aynı öğrenci hesabı birden fazla cihazda açık olunca arka plandaki eski
  // cihaz page=1/eski sayfa yazarak admin ekranını başa atlatabiliyor. Takip
  // başladıktan sonra kısa süre kaynak cihazı kilitleyip bu bayat yazımları yok say.
  if(now - _followSourceSeenAt < FOLLOW_SOURCE_LOCK_MS){
    window.debugLog?.('presence.source.rejected', {
      lockedSource: _followSourceId,
      rejectedSource: m.by,
      page: m.page,
      ts: m.ts
    }, 'warn');
    return false;
  }
  window.debugLog?.('presence.source.switched', {
    previousSource: _followSourceId,
    nextSource: m.by,
    page: m.page
  }, 'info');
  _followSourceId = m.by;
  _followSourceSeenAt = now;
  return true;
}

function _applyFollow(seq){
  if(seq !== _followApplySeq) return;
  if(document.hidden){
    // Arka plandaki izleyici ağır PDF render tetiklemesin; sekme görünür
    // olunca en güncel presence tekrar uygulanacak.
    return;
  }
  if(Date.now() < Number(appState._liveManualPauseUntil || 0)){
    scheduleApplyFollow();
    return;
  }
  _lastFollowApplyAt = Date.now();
  const m = _roster.find(x=>x.uid === _followUid);
  if(!m) return;                                  // takip edilen çevrimdışı
  if(!acceptPresenceSource(m)) return;
  const drawSig = m.drawSig || _hashDraw(m.draw);
  const sig = `${m.page}|${m.altKonuId}|${m.drawKey||''}|${m.drawTs||''}|${drawSig}|${m.zoom||''}|${m.fracX ?? ''}|${m.fracY ?? ''}|${m.fracLeft ?? ''}|${m.fracRight ?? ''}|${m.fracTop ?? ''}|${m.fracBottom ?? ''}`;
  if(sig === _lastFollowSig) return;              // değişmedi → tekrar uygulama
  _lastFollowSig = sig;
  appState._presSuppress = true;
  try{
    if(m.altKonuId && appState.aktifAltKonu?.id !== m.altKonuId){
      let ak=null;
      (appState.aktifFasikul?.konular||[]).forEach(k=>(k.altKonular||[]).forEach(a=>{ if(a.id===m.altKonuId) ak=a; }));
      if(ak) window.selectAltKonu?.(ak, `altk-${ak.id}`);
    }
    if(m.page && appState.currentPage !== m.page){
      const targetPage = Number(m.page);
      const currentPage = Number(appState.currentPage || 1);
      if(Number.isFinite(targetPage) && Number.isFinite(currentPage) && targetPage < currentPage - 2){
        window.debugReport?.('presence.page.rollback', {
          fromPage: currentPage,
          toPage: targetPage,
          followedUid: _followUid,
          member: m
        });
      } else {
        window.debugLog?.('presence.page.follow', {fromPage: currentPage, toPage: targetPage, followedUid:_followUid}, 'info');
      }
      window.goToPage?.(m.page);
    }
  }catch(e){
    console.warn('Takip uygula hatası:',e);
    window.debugReport?.('presence.follow.failed', {error:e, member:m});
  }
  // Sayfa/canvas oturunca ZOOM, SONRA pan, SONRA çizimi uygula — sırayla:
  // zoom kendi render+scroll-restore döngüsünü tetikler, pan/çizim ONDAN
  // ÖNCE uygulanırsa zoom'un kendi düzeltmesi tarafından ezilir.
  setTimeout(async ()=>{
    try{
      if(seq !== _followApplySeq) return;
      if(m.zoom && Math.abs(m.zoom - appState.zoom) >= 2){
        try{ await window.setZoomAbsolute?.(m.zoom); }catch(e){}
        if(seq !== _followApplySeq) return;
      }
      if(m.fracX != null && m.fracY != null){
        window.applyPageScrollFraction?.(m.page || appState.currentPage, m.fracX, m.fracY, {
          fracLeft: m.fracLeft,
          fracRight: m.fracRight,
          fracTop: m.fracTop,
          fracBottom: m.fracBottom
        });
      }
      _renderFollowDraw(m.draw, m.drawKey, m.dw, m.dh, 0);
    } finally {
      if(seq === _followApplySeq) setTimeout(()=>{ appState._presSuppress = false; }, 900);
    }
  }, 120);
}

document.addEventListener('visibilitychange', ()=>{
  if(document.hidden) return;
  if(_presFasikulId) _writePresence(true);
  if(_followUid) scheduleApplyFollow();
});

function _renderFollowDraw(json, drawKey, dw, dh, attempt = 0){
  if(!json || !drawKey) return;
  const fas = appState.aktifFasikul;
  const currentKey = fas ? `drawing_${fas.id}_p${appState.currentPage}` : null;
  const remotePage = _pageFromAnyDrawingKey(drawKey);
  const sameVisiblePage = !!(remotePage && remotePage === Number(appState.currentPage || 1));
  const targetKey = currentKey && sameVisiblePage ? currentKey : drawKey;
  if(currentKey !== drawKey && !sameVisiblePage){
    if(attempt < FOLLOW_DRAW_MAX_RETRY){
      setTimeout(()=>_renderFollowDraw(json, drawKey, dw, dh, attempt + 1), FOLLOW_DRAW_RETRY_MS);
    } else {
      window.debugReport?.('presence.follow.draw.key_mismatch', {currentKey, drawKey, page:appState.currentPage});
    }
    return;
  }
  // Takip edilenin canvas boyutunu kaydet ki applyDrawingScale doğru ölçeklesin
  if(dw && dh) appState.drawingDims[targetKey] = { w:dw, h:dh };
  const fc = appState.fabricCanvases?.[appState.currentPage] || appState.fabricCanvas;
  if(!fc){
    setTimeout(()=>{
      const fc2 = appState.fabricCanvases?.[appState.currentPage] || appState.fabricCanvas;
      if(fc2) _queueFollowJSON(fc2, json, targetKey);
      else if(attempt < FOLLOW_DRAW_MAX_RETRY) _renderFollowDraw(json, drawKey, dw, dh, attempt + 1);
      else window.debugReport?.('presence.follow.draw.canvas_missing', {drawKey, page:appState.currentPage});
    }, FOLLOW_DRAW_RETRY_MS);
    return;
  }
  _queueFollowJSON(fc, json, targetKey);
}
function _queueFollowJSON(fc, json, drawKey){
  if(!fc || !json || !drawKey) return;
  fc._queuedFollowDrawing = { json, drawKey };
  clearTimeout(fc._followDrawingTimer);
  fc._followDrawingTimer = setTimeout(()=>_drainFollowJSON(fc), FOLLOW_DRAW_APPLY_DELAY_MS);
}
function _drainFollowJSON(fc){
  if(!fc || fc._followDrawingLoading) return;
  const queued = fc._queuedFollowDrawing;
  fc._queuedFollowDrawing = null;
  if(!queued) return;
  _loadFollowJSON(fc, queued.json, queued.drawKey);
}
function _loadFollowJSON(fc, json, drawKey){
  fc._followDrawingLoading = true;
  fc._applyingRemoteDrawing = true;
  const token = (fc._followDrawingToken = (fc._followDrawingToken || 0) + 1);
  try{
    fc.loadFromJSON(json, ()=>{
      if(fc._followDrawingToken === token && !fc._queuedFollowDrawing){
        window.applyDrawingScale?.(fc, drawKey);
        fc.renderAll();
      }
      fc._followDrawingLoading = false;
      fc._applyingRemoteDrawing = false;
      if(fc._queuedFollowDrawing) setTimeout(()=>_drainFollowJSON(fc), 0);
    });
  }catch(e){
    fc._followDrawingLoading = false;
    fc._applyingRemoteDrawing = false;
    console.warn('Takip çizimi yüklenemedi:',e);
    window.debugReport?.('presence.follow.draw.load_failed', {error:e, drawKey});
    if(fc._queuedFollowDrawing) setTimeout(()=>_drainFollowJSON(fc), 0);
  }
}

// ── ORTAK TAHTA — aynı sayfadaki herkesin kalemi overlay olarak birleşir ──
// Herkes kendi kalemini presence'a yazar (publishCanliPresenceDraw). Ortak tahta
// açıkken, aynı fasikül+sayfadaki DİĞER kişilerin çizimleri kendi canvas'ına
// _owner etiketiyle (salt-görüntü) eklenir; kendi çizimin korunur ve kaydedilir.
let _sbTimer = null;
function _curFc(){ return appState.fabricCanvases?.[appState.currentPage] || appState.fabricCanvas || null; }

export function toggleSharedBoard(){
  const me = _me();
  if(!me){ window.showToast?.('Ortak tahta için hesabınla giriş yapmalısın','info'); return; }
  appState.sharedBoard = !appState.sharedBoard;
  if(appState.sharedBoard){
    window.showToast?.('🖊️ Ortak tahta açık — aynı sayfadakilerle birlikte yazın','success');
    _syncSharedBoard();
  } else {
    _clearOverlay();
    window.showToast?.('Ortak tahta kapalı','info');
  }
  _renderRoster();
}

// Debounced dış giriş (sayfa/zoom render sonrası ve gezinmede çağrılır)
export function refreshSharedBoard(){
  if(!appState.sharedBoard) { _clearOverlay(); return; }
  clearTimeout(_sbTimer);
  _sbTimer = setTimeout(_syncSharedBoard, 220);
}

function _clearOverlay(fc){
  fc = fc || _curFc();
  if(!fc) return;
  const owned = fc.getObjects().filter(o=>o._owner);
  if(!owned.length) return;
  fc._applyingRemoteDrawing = true;
  owned.forEach(o=>fc.remove(o));
  fc._applyingRemoteDrawing = false;
  fc.requestRenderAll();
}

function _syncSharedBoard(){
  if(!appState.sharedBoard) return;
  const fas = appState.aktifFasikul;
  const fc = _curFc();
  const F = window.fabric;
  if(!fas || !fc || !F?.util?.enlivenObjects) return;
  const me = _me();
  const curKey = `drawing_${fas.id}_p${appState.currentPage}`;
  const members = _roster.filter(m => m.uid !== me?.uid && m.drawKey === curKey && m.draw);
  const token = (fc._sbToken = Date.now() + Math.random());   // eşzamanlı/bayat sync ayrımı
  const localW = fc.width, localH = fc.height;

  // ÖNCE herkesin nesnelerini enliven et (async), SONRA tek seferde takas et.
  // Böylece "önce hepsi kaybolur sonra geri gelir" (flicker/toplu silinme) OLMAZ.
  const tasks = members.map(m => new Promise(resolve=>{
    let objs;
    try{ objs = (JSON.parse(m.draw)?.objects) || []; }catch(e){ objs = []; }
    if(!objs.length){ resolve([]); return; }
    const rx = (m.dw && localW) ? localW / m.dw : 1;
    const ry = (m.dh && localH) ? localH / m.dh : 1;
    try{
      F.util.enlivenObjects(objs, (arr)=>{
        arr.forEach(o=>{
          o.set({
            left:(o.left||0)*rx, top:(o.top||0)*ry,
            scaleX:(o.scaleX||1)*rx, scaleY:(o.scaleY||1)*ry,
            selectable:false, evented:false, hoverCursor:'default'
          });
          o._owner = m.uid;
          o.setCoords?.();
        });
        resolve(arr);
      }, '');
    }catch(e){ resolve([]); }
  }));

  Promise.all(tasks).then(groups=>{
    if(fc._sbToken !== token) return;                 // daha yeni bir sync başladı → bu bayat
    fc._applyingRemoteDrawing = true;
    fc.getObjects().filter(o=>o._owner).forEach(o=>fc.remove(o));  // eskiyi çıkar
    groups.forEach(arr=>arr.forEach(o=>fc.add(o)));                // yeniyi ekle (aynı senkron blok)
    fc._applyingRemoteDrawing = false;
    fc.requestRenderAll();
  }).catch(()=>{ fc._applyingRemoteDrawing = false; });
}

// ── Roster UI ──────────────────────────────────────────
function _ensurePanel(){
  let p = document.getElementById('canliRosterPanel');
  if(!p){
    p = document.createElement('div');
    p.id = 'canliRosterPanel';
    p.className = 'canli-roster-panel';
    document.body.appendChild(p);
  }
  return p;
}
function _renderRoster(){
  _updateRosterButton();
  const p = document.getElementById('canliRosterPanel');
  if(!p || p.style.display !== 'flex') return;
  const me = _me();
  const others = _roster.filter(m => m.uid !== me?.uid)
                        .sort((a,b)=>(b.ts||0)-(a.ts||0));
  p.innerHTML = `
    <div class="crp-head"><b>Bu fasikülde canlı</b><span class="crp-n">${others.length}</span><button class="crp-x" onclick="toggleCanliRoster()" title="Kapat">✕</button></div>
    <button class="crp-board ${appState.sharedBoard?'on':''}" onclick="toggleSharedBoard()" title="Aynı sayfadaki herkes birlikte çizsin, herkes birbirinin kalemini görsün">🖊️ Ortak Tahta <b>${appState.sharedBoard?'AÇIK':'Kapalı'}</b></button>
    ${window.voiceSelfPanel?.() || ''}
    ${others.length ? others.map(m=>{
      const following = m.uid === _followUid;
      const handRaised = !!m.voice?.handRaised;
      return `<div class="crp-row ${following?'following':''} ${handRaised?'hand-raised':''}">
        <span class="crp-dot"></span>
        <span class="crp-name">${handRaised ? '<b class="crp-hand" title="Konuşmak istiyor">✋</b>' : ''}${_esc(m.name)} <i title="${m.role==='ogretmen'?'Öğretmen':m.role==='admin'?'Yönetici':'Öğrenci'}">${_roleIcon(m.role)}</i></span>
        <span class="crp-page">s.${m.page||1}</span>
        <button class="crp-follow ${following?'on':''}" onclick="${following?'unfollowCanliMember()':`followCanliMember('${_escAttr(m.uid)}','${_escAttr(m.name)}')`}">${following?'⏹ Durdur':'▶ İzle'}</button>
        ${window.voiceRosterControls?.(m, me) || ''}
      </div>`;
    }).join('') : `<div class="crp-empty">Şu an bu fasikülde başka kimse yok.<br><small>Aynı fasikülü açan kişiler burada görünür.</small></div>`}
    ${me ? `<div class="crp-self">Sen: <b>${_esc(me.name)}</b> ${_roleIcon(me.role)}</div>` : ''}`;
}
function _updateRosterButton(){
  const me = _me();
  const others = _roster.filter(m => m.uid !== me?.uid);
  const n = others.length;
  const handCount = others.filter(m => m.voice?.handRaised).length;
  // Üç yerleşimde de buton var (masaüstü toolbar, soru paneli, telefon paleti) → hepsini güncelle
  document.querySelectorAll('.canli-roster-btn').forEach(btn=>{
    btn.classList.toggle('has-live', n > 0);
    btn.classList.toggle('has-hand', handCount > 0);
    btn.classList.toggle('following', !!_followUid);
    let cnt = btn.querySelector('.crb-count');
    if(!cnt){
      cnt = document.createElement('span');
      cnt.className = 'crb-count';
      btn.appendChild(cnt);
    }
    const label = handCount > 0 ? `✋${handCount}` : (n > 0 ? String(n) : '');
    cnt.textContent = label;
    cnt.hidden = !label;
    btn.setAttribute('aria-label', n > 0 ? `Bu fasikülde ${n} kişi canlı` : 'Canlı katılımcılar');
    btn.title = n > 0 ? `Bu fasikülde ${n} kişi canlı` : 'Canlı katılımcılar';
  });
}
export function toggleCanliRoster(){
  const p = _ensurePanel();
  const open = p.style.display === 'flex';
  p.style.display = open ? 'none' : 'flex';
  if(!open){
    _writePresence();
    setTimeout(_writePresence, 500);
    _renderRoster();
  }
}
window.renderCanliRoster = _renderRoster;
function _hideRosterPanel(){ const p = document.getElementById('canliRosterPanel'); if(p) p.style.display = 'none'; }
