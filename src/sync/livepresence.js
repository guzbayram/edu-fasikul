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
    if(_followUid) _applyFollow();
  }, (err)=>console.warn('Canlı oturum dinleme hatası:',err));
  _heartbeatTimer = setInterval(_writePresence, HEARTBEAT_MS);
  _updateRosterButton();
}

export function stopCanliPresence(silent){
  if(_rosterUnsub){ _rosterUnsub(); _rosterUnsub = null; }
  if(_heartbeatTimer){ clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
  clearTimeout(_pubTimer); clearTimeout(_drawPubTimer);
  _followUid = null; _lastFollowSig = '';
  const me = _me();
  if(me && _presFasikulId && _ready() && window._fsDeleteDoc){
    window._fsDeleteDoc(_memberRef(_presFasikulId, me.uid)).catch(()=>{});
  }
  _presFasikulId = null;
  _roster = [];
  _hideRosterPanel();
  _updateRosterButton();
}

function _writePresence(){
  const me = _me();
  const fas = appState.aktifFasikul;
  if(!me || !fas || fas.id !== _presFasikulId || !_ready()) return;
  window._fsSetDoc(_memberRef(fas.id, me.uid), {
    uid: me.uid, name: me.name, role: me.role,
    dersId: appState.aktifDers?.id || '',
    fasikulId: fas.id,
    page: appState.currentPage || 1,
    altKonuId: appState.aktifAltKonu?.id || '',
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
  _applyFollow();
}

export function unfollowCanliMember(){
  if(!_followUid) return;
  _followUid = null; _lastFollowSig = '';
  _renderRoster();
  window.showToast?.('Takip durduruldu','info');
}

function _applyFollow(){
  const m = _roster.find(x=>x.uid === _followUid);
  if(!m) return;                                  // takip edilen çevrimdışı
  const sig = `${m.page}|${m.altKonuId}|${m.drawKey||''}|${(m.draw||'').length}`;
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
  // Sayfa/canvas oturunca çizimi yansıt
  setTimeout(()=>_renderFollowDraw(m.draw, m.drawKey, m.dw, m.dh), 320);
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
      if(fc2) _loadFollowJSON(fc2, json, drawKey);
    }, 1200);
    return;
  }
  _loadFollowJSON(fc, json, drawKey);
}
function _loadFollowJSON(fc, json, drawKey){
  fc._applyingRemoteDrawing = true;
  try{
    fc.loadFromJSON(json, ()=>{
      window.applyDrawingScale?.(fc, drawKey);
      fc._applyingRemoteDrawing = false;
      fc.renderAll();
    });
  }catch(e){ fc._applyingRemoteDrawing = false; console.warn('Takip çizimi yüklenemedi:',e); }
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
    ${others.length ? others.map(m=>{
      const following = m.uid === _followUid;
      return `<div class="crp-row ${following?'following':''}">
        <span class="crp-dot"></span>
        <span class="crp-name">${_esc(m.name)} <i title="${m.role==='ogretmen'?'Öğretmen':m.role==='admin'?'Yönetici':'Öğrenci'}">${_roleIcon(m.role)}</i></span>
        <span class="crp-page">s.${m.page||1}</span>
        <button class="crp-follow ${following?'on':''}" onclick="${following?'unfollowCanliMember()':`followCanliMember('${_escAttr(m.uid)}','${_escAttr(m.name)}')`}">${following?'⏹ Durdur':'▶ İzle'}</button>
      </div>`;
    }).join('') : `<div class="crp-empty">Şu an bu fasikülde başka kimse yok.<br><small>Aynı fasikülü açan kişiler burada görünür.</small></div>`}
    ${me ? `<div class="crp-self">Sen: <b>${_esc(me.name)}</b> ${_roleIcon(me.role)}</div>` : ''}`;
}
function _updateRosterButton(){
  const me = _me();
  const n = _roster.filter(m => m.uid !== me?.uid).length;
  // Üç yerleşimde de buton var (masaüstü toolbar, soru paneli, telefon paleti) → hepsini güncelle
  document.querySelectorAll('.canli-roster-btn').forEach(btn=>{
    btn.classList.toggle('has-live', n > 0);
    btn.classList.toggle('following', !!_followUid);
    const cnt = btn.querySelector('.crb-count');
    if(cnt) cnt.textContent = n > 0 ? String(n) : '';
  });
}
export function toggleCanliRoster(){
  const p = _ensurePanel();
  const open = p.style.display === 'flex';
  p.style.display = open ? 'none' : 'flex';
  if(!open) _renderRoster();
}
function _hideRosterPanel(){ const p = document.getElementById('canliRosterPanel'); if(p) p.style.display = 'none'; }
