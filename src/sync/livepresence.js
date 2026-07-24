import { appState } from '../state/appState.js';
import { _getUserKey } from '../firebase/firestore.js';

// ══════════════════════════════════════════════════════════
// CANLI OTURUM — aynı fasikülde bulunanların listesi + seçerek takip
// Öğrenci/öğretmen/admin herkes kendi konumunu (sayfa + o sayfanın çizimi)
// canliOturum/{fasikulId}/uyeler/{uid} dokümanına yazar. Aynı fasiküldekiler
// birbirini listede görür; birine dokununca o kişinin sayfası + çizimleri
// yansır. Kimsenin özel (kullanicilar/{uid}) dokümanı okunmaz.
// ══════════════════════════════════════════════════════════

const HEARTBEAT_MS = 15000;
const ONLINE_WINDOW_MS = 45000;   // ts bu süre içinde tazelenmezse "çevrimdışı"
let _presFasikulId = null;
let _rosterUnsub = null;
let _heartbeatTimer = null;
let _pubTimer = null, _drawPubTimer = null;
let _roster = [];
let _followUid = null;
let _lastFollowSig = '';
let _followApplyTimer = null;
let _followApplySeq = 0;
const FOLLOW_APPLY_DELAY_MS = 90;
const FOLLOW_DRAW_APPLY_DELAY_MS = 90;

function _esc(s){ return String(s??'').replace(/[<>&]/g, c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])); }
function _escAttr(s){ return _esc(s).replace(/'/g,"\\'"); }

function _me(){
  const u = appState.user;
  if(!u || u.email === 'misafir@demo.com') return null;
  const uid = _getUserKey();
  if(!uid) return null;
  return { uid, name: u.name || u.email || 'Kullanıcı', role: u.role || 'ogrenci' };
}
function _ready(){ return !!(window._firestoreReady && window._db && window._fsDoc && window._fsSetDoc); }
function _memberRef(fasikulId, uid){ return window._fsDoc(window._db,'canliOturum',fasikulId,'uyeler',uid); }
function _roleIcon(r){ return r==='ogretmen'?'👨‍🏫':r==='admin'?'🔑':'🎓'; }

export function startCanliPresence(){
  stopCanliPresence(true);
  const me = _me();
  const fas = appState.aktifFasikul;
  if(!me || !fas || !_ready() || !window._fsOnSnapshot || !window._fsCollection) return;
  _presFasikulId = fas.id;
  _writePresence();
  window.voiceJoinRoom?.(fas.id);
  const col = window._fsCollection(window._db,'canliOturum',fas.id,'uyeler');
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
    if(_followUid) scheduleApplyFollow();
    if(appState.sharedBoard) refreshSharedBoard();   // biri çizince ortak tahtayı tazele
  }, (err)=>console.warn('Canlı oturum dinleme hatası:',err));
  _heartbeatTimer = setInterval(_writePresence, HEARTBEAT_MS);
  _updateRosterButton();
}

export function stopCanliPresence(silent){
  if(_rosterUnsub){ _rosterUnsub(); _rosterUnsub = null; }
  if(_heartbeatTimer){ clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
  clearTimeout(_pubTimer); clearTimeout(_drawPubTimer); clearTimeout(_sbTimer); clearTimeout(_followApplyTimer);
  _followUid = null; _lastFollowSig = '';
  _followApplyTimer = null;
  _followApplySeq++;
  if(appState.sharedBoard){ appState.sharedBoard = false; _clearOverlay(); }
  const me = _me();
  if(me && _presFasikulId && _ready() && window._fsDeleteDoc){
    window._fsDeleteDoc(_memberRef(_presFasikulId, me.uid)).catch(()=>{});
  }
  window.voiceLeaveRoom?.();
  _presFasikulId = null;
  _roster = [];
  _hideRosterPanel();
  _updateRosterButton();
}

function _writePresence(){
  const me = _me();
  const fas = appState.aktifFasikul;
  if(!me || !fas || fas.id !== _presFasikulId || !_ready()) return;
  // Zoom + sayfa-göreli pan konumu da taşınır ki takip eden AYNI görünümü
  // (kaydırma dahil) görsün — ekran boyutundan bağımsız kalması için MUTLAK
  // piksel değil ORAN (fracX/fracY, bkz. getCurrentPageScrollFraction).
  const frac = window.getCurrentPageScrollFraction?.();
  window._fsSetDoc(_memberRef(fas.id, me.uid), {
    uid: me.uid, name: me.name, role: me.role,
    dersId: appState.aktifDers?.id || '',
    fasikulId: fas.id,
    page: appState.currentPage || 1,
    altKonuId: appState.aktifAltKonu?.id || '',
    zoom: appState.zoom || 100,
    fracX: frac?.fracX ?? null,
    fracY: frac?.fracY ?? null,
    ts: Date.now()
  }, {merge:true}).catch(e=>console.warn('Canlı oturum yazma hatası:',e));
}

// Gezinmede çağrılır (throttle)
export function publishCanliPresence(){
  if(!_presFasikulId) return;
  clearTimeout(_pubTimer);
  _pubTimer = setTimeout(_writePresence, 180);
}

// Çizim değişince: mevcut sayfanın çizimini kendi dokümanına koy → takipçiler görsün
export function publishCanliPresenceDraw(key, json, w, h){
  const me = _me();
  const fas = appState.aktifFasikul;
  if(!me || !fas || fas.id !== _presFasikulId || !_ready() || !key) return;
  const currentKey = `drawing_${fas.id}_p${appState.currentPage||1}`;
  if(key !== currentKey) return;
  clearTimeout(_drawPubTimer);
  _drawPubTimer = setTimeout(()=>{
    window._fsSetDoc(_memberRef(fas.id, me.uid),
      { drawKey:key, draw:json||'', dw:w||0, dh:h||0, ts:Date.now() }, {merge:true})
      .catch(()=>{});
  }, 250);
}

// ── Takip ──────────────────────────────────────────────
export function followCanliMember(uid, name){
  const me = _me();
  if(!uid || uid === me?.uid) return;
  _followUid = uid;
  _lastFollowSig = '';
  window.showToast?.(`🔴 ${name||'Katılımcı'} takip ediliyor`,'success');
  _renderRoster();
  scheduleApplyFollow();
}

export function unfollowCanliMember(){
  if(!_followUid) return;
  _followUid = null; _lastFollowSig = '';
  _renderRoster();
  window.showToast?.('Takip durduruldu','info');
}

function scheduleApplyFollow(){
  const seq = ++_followApplySeq;
  clearTimeout(_followApplyTimer);
  _followApplyTimer = setTimeout(()=>_applyFollow(seq), FOLLOW_APPLY_DELAY_MS);
}

function _applyFollow(seq){
  const m = _roster.find(x=>x.uid === _followUid);
  if(!m) return;                                  // takip edilen çevrimdışı
  const sig = `${m.page}|${m.altKonuId}|${m.drawKey||''}|${(m.draw||'').length}|${m.zoom||''}|${m.fracX ?? ''}|${m.fracY ?? ''}`;
  if(sig === _lastFollowSig) return;              // değişmedi → tekrar uygulama
  _lastFollowSig = sig;
  appState._presSuppress = true;
  try{
    if(m.altKonuId && appState.aktifAltKonu?.id !== m.altKonuId){
      let ak=null;
      (appState.aktifFasikul?.konular||[]).forEach(k=>(k.altKonular||[]).forEach(a=>{ if(a.id===m.altKonuId) ak=a; }));
      if(ak) window.selectAltKonu?.(ak, `altk-${ak.id}`);
    }
    if(m.page && appState.currentPage !== m.page) window.goToPage?.(m.page);
  }catch(e){ console.warn('Takip uygula hatası:',e); }
  finally{ setTimeout(()=>{ appState._presSuppress = false; }, 400); }
  // Sayfa/canvas oturunca ZOOM, SONRA pan, SONRA çizimi uygula — sırayla:
  // zoom kendi render+scroll-restore döngüsünü tetikler, pan/çizim ONDAN
  // ÖNCE uygulanırsa zoom'un kendi düzeltmesi tarafından ezilir.
  setTimeout(async ()=>{
    if(seq !== _followApplySeq) return;
    if(m.zoom && Math.abs(m.zoom - appState.zoom) >= 2){
      try{ await window.setZoomAbsolute?.(m.zoom); }catch(e){}
      if(seq !== _followApplySeq) return;
    }
    if(m.fracX != null && m.fracY != null){
      window.applyPageScrollFraction?.(m.page || appState.currentPage, m.fracX, m.fracY);
    }
    _renderFollowDraw(m.draw, m.drawKey, m.dw, m.dh);
  }, 320);
}

function _renderFollowDraw(json, drawKey, dw, dh){
  if(!json || !drawKey) return;
  const fas = appState.aktifFasikul;
  const currentKey = fas ? `drawing_${fas.id}_p${appState.currentPage}` : null;
  if(currentKey !== drawKey) return;             // takip edilen başka sayfada
  // Takip edilenin canvas boyutunu kaydet ki applyDrawingScale doğru ölçeklesin
  if(dw && dh) appState.drawingDims[drawKey] = { w:dw, h:dh };
  const fc = appState.fabricCanvases?.[appState.currentPage] || appState.fabricCanvas;
  if(!fc){
    setTimeout(()=>{
      const fc2 = appState.fabricCanvases?.[appState.currentPage] || appState.fabricCanvas;
      if(fc2) _queueFollowJSON(fc2, json, drawKey);
    }, 1200);
    return;
  }
  _queueFollowJSON(fc, json, drawKey);
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
    const cnt = btn.querySelector('.crb-count');
    if(cnt) cnt.textContent = handCount > 0 ? `✋${handCount}` : (n > 0 ? String(n) : '');
  });
}
export function toggleCanliRoster(){
  const p = _ensurePanel();
  const open = p.style.display === 'flex';
  p.style.display = open ? 'none' : 'flex';
  if(!open) _renderRoster();
}
window.renderCanliRoster = _renderRoster;
function _hideRosterPanel(){ const p = document.getElementById('canliRosterPanel'); if(p) p.style.display = 'none'; }
