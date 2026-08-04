import { appState } from '../state/appState.js';
import { _getUserKey } from '../firebase/firestore.js';

// ══════════════════════════════════════════════════════════
// CANLI DERS — aynı hesapta iki cihaz arasında sayfa/konu eşitleme
// Çift yönlü ayna: hangi cihaz gezinirse diğeri takip eder.
// Çizim aynalama yalnız canlı ders açıkken çalışır; kapalıyken bulut yedekleme
// sürer ama başka açık cihazın canvas'ına anlık uygulanmaz.
// ══════════════════════════════════════════════════════════
let _canliUnsub = null;
let _publishTimer = null;
let _lastPublishCanliSig = '';
let _lastPublishCanliAt = 0;
let _followTimer = null;
let _followSeq = 0;
let _lastFollowApplyAt = 0;
let _followSourceId = '';
let _followSourceSeenAt = 0;
let _lastFollowStatsSig = '';
const DRAWING_REMOTE_EDIT_GUARD_MS = 2200;
const REMOTE_DRAWING_APPLY_DELAY_MS = 25;
const FOLLOW_APPLY_DELAY_MS = 220;
const FOLLOW_MIN_INTERVAL_MS = 320;
const FOLLOW_SOURCE_LOCK_MS = 12000;

function _liveDeviceId(){
  if(!appState._liveDeviceId)
    appState._liveDeviceId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  return appState._liveDeviceId;
}

export function publishCanli(){
  if(appState.watchMode || appState.reviewMode || appState._liveSuppress || appState._presSuppress) return;   // izleyen/takip eden öğretmen kendi konumunu yayınlamaz
  window.publishCanliPresence?.();   // aynı fasikül canlı oturum listesi (tüm roller)
  window.refreshSharedBoard?.();     // gezinince ortak tahtayı yeni sayfaya uyarla
  // Yayın koşulu: elle açılan Canlı Ders VEYA öğrenci için otomatik yayın açık
  if((!appState.liveSession && !appState.autoPublishLive) || appState._liveSuppress) return;
  if(document.hidden) return;
  const uid = _getUserKey();
  const fas = appState.aktifFasikul;
  if(!uid || !fas || !window._firestoreReady || !window._db) return;
  // Zoom + sayfa-göreli pan (fracX/fracY, bkz. getCurrentPageScrollFraction)
  // de sig'e dahil — yoksa aynı sayfada sadece zoom/pan değişince 1500ms'lik
  // dedup bunu "değişmedi" sayıp izleyene HİÇ yansıtmazdı.
  const frac = window.getCurrentPageScrollFraction?.();
  const zoom = Math.round(appState.zoom || 100);
  const fracX = frac ? frac.fracX.toFixed(3) : '';
  const fracY = frac ? frac.fracY.toFixed(3) : '';
  const fracLeft = frac?.fracLeft != null ? frac.fracLeft.toFixed(3) : '';
  const fracRight = frac?.fracRight != null ? frac.fracRight.toFixed(3) : '';
  const fracTop = frac?.fracTop != null ? frac.fracTop.toFixed(3) : '';
  const fracBottom = frac?.fracBottom != null ? frac.fracBottom.toFixed(3) : '';
  const docFracY = frac?.docFracY != null ? frac.docFracY.toFixed(3) : '';
  const testStats = window.getCurrentTestStatsSnapshot?.() ?? null;
  const statsSigPart = testStats ? `${testStats.correct}.${testStats.wrong}.${testStats.answered}.${testStats.total}` : '';
  const sig = `${appState.aktifDers?.id || ''}|${fas.id}|${appState.currentPage || 1}|${appState.aktifAltKonu?.id || ''}|${zoom}|${fracX}|${fracY}|${fracLeft}|${fracRight}|${fracTop}|${fracBottom}|${docFracY}|${statsSigPart}`;
  const now = Date.now();
  if(sig === _lastPublishCanliSig && now - _lastPublishCanliAt < 700) return;
  _lastPublishCanliSig = sig;
  _lastPublishCanliAt = now;
  clearTimeout(_publishTimer);
  const canliPayload = {
    dersId: appState.aktifDers?.id || '',
    fasikulId: fas.id,
    fasikulAd: fas.ad || fas.id,
    page: appState.currentPage || 1,
    altKonuId: appState.aktifAltKonu?.id || '',
    zoom,
    fracX: frac?.fracX ?? null,
    fracY: frac?.fracY ?? null,
    fracLeft: frac?.fracLeft ?? null,
    fracRight: frac?.fracRight ?? null,
    fracTop: frac?.fracTop ?? null,
    fracBottom: frac?.fracBottom ?? null,
    docFracY: frac?.docFracY ?? null,
    testStats,
    by: _liveDeviceId(),
    ts: Date.now()
  };
  _publishTimer = setTimeout(()=>{
    // Kullanıcı dokümanına yaz (cizimler/cozumler gibi kesinlikle izinli yol).
    const ref = window._fsDoc(window._db,'kullanicilar',uid);
    window._fsSetDoc(ref, { canli:{ ...canliPayload, ts: Date.now() } }, {merge:true}).catch(e=>{
      console.warn('Canlı yayın hatası:',e);
      window.debugReport?.('live.publish.failed', {error:e, payload:canliPayload});
    });
  }, 80);
}

let _latestCanliData = null;
let _openReaderPromise = null;
let _openReaderFasikulId = null;

function scheduleFollowCanli(d){
  _latestCanliData = d;
  const seq = ++_followSeq;
  const pause = Math.max(0, Number(appState._liveManualPauseUntil || 0) - Date.now());
  const wait = Math.max(pause || FOLLOW_APPLY_DELAY_MS, FOLLOW_MIN_INTERVAL_MS - (Date.now() - _lastFollowApplyAt));
  clearTimeout(_followTimer);
  _followTimer = setTimeout(()=>_followCanli(seq), wait);
}

function acceptCanliSource(d){
  if(!d?.by) return true;
  const now = Date.now();
  if(!_followSourceId || _followSourceId === d.by){
    _followSourceId = d.by;
    _followSourceSeenAt = now;
    return true;
  }
  // Aynı öğrenci hesabı tablet + telefon + bilgisayarda açık olabiliyor.
  // İzleme sırasında kaynak cihazı kısa süre kilitlemezsek diğer eski sekme
  // daha yeni ts ile sayfa 1/13 gibi eski konumu yazıp öğretmeni geri atlatır.
  if(now - _followSourceSeenAt < FOLLOW_SOURCE_LOCK_MS){
    window.debugLog?.('live.source.rejected', {
      lockedSource: _followSourceId,
      rejectedSource: d.by,
      page: d.page,
      ts: d.ts
    }, 'warn');
    return false;
  }
  window.debugLog?.('live.source.switched', {
    previousSource: _followSourceId,
    nextSource: d.by,
    page: d.page
  }, 'info');
  _followSourceId = d.by;
  _followSourceSeenAt = now;
  return true;
}

// KÖK NEDEN (bağlantı gecikmesinde admin PDF'i baştaki sayfalara "kayıyordu"):
// openReader() HER ZAMAN appState.currentPage=1 ile başlar, admin'in bu
// fasiküldeki KENDİ son bıraktığı konuyu seçer (öğrencinin DEĞİL) ve sayfa 1'i
// render eder — normalde bu fonksiyonun altındaki altKonuId/page adımları bunu
// hemen düzeltir. Ama openReader() bir ağ isteği (GitHub JSON + PDF) içerir;
// bağlantı yavaşsa bu adım uzar, o sırada öğrenciden YENİ bir konum gelirse
// (yeni bir scheduleFollowCanli → yeni seq) ESKİ çağrı "if(seq!==_followSeq)
// return" ile burada TERK EDİLİYORDU — açık sayfa 1 + admin'in eski konusu
// olarak KALICI kalıyordu, hiç düzeltilmiyordu. Çözüm: (1) 'seq' ile iptal
// ETMEK yerine her adımda EN GÜNCEL veriyi (_latestCanliData) yeniden okuyoruz
// — hangi çağrı sona ererse ersin, sonuçta uygulanan hep en taze konum olur;
// (2) aynı fasikül için ZATEN devam eden bir openReader() varsa YENİSİNİ
// BAŞLATMAK yerine mevcut olanı bekliyoruz (art arda çakışan openReader
// çağrıları hem gereksiz hem de kendi aralarında yarışıyordu).
async function _followCanli(seq){
  if(seq !== _followSeq) return;
  if(document.hidden) return;
  if(Date.now() < Number(appState._liveManualPauseUntil || 0)){
    scheduleFollowCanli(_latestCanliData);
    return;
  }
  _lastFollowApplyAt = Date.now();
  appState._liveSuppress = true;
  try{
    let d = _latestCanliData;
    if(!d) return;
    // İstatistik satırı sayfa/zoom'dan bağımsız değişebilir, kendi dedup'ıyla
    // ayrıca uygulanır (bkz. livepresence.js'deki aynı yaklaşım).
    const statsSig = JSON.stringify(d.testStats || null);
    if(statsSig !== _lastFollowStatsSig){
      _lastFollowStatsSig = statsSig;
      window.applyFollowedTestStats?.(d.testStats || null);
    }
    if(d.fasikulId && appState.aktifFasikul?.id !== d.fasikulId){
      if(_openReaderPromise && _openReaderFasikulId === d.fasikulId){
        await _openReaderPromise;
      } else {
        _openReaderFasikulId = d.fasikulId;
        _openReaderPromise = Promise.resolve(window.openReader?.(d.dersId, d.fasikulId));
        try{ await _openReaderPromise; } finally { _openReaderPromise = null; _openReaderFasikulId = null; }
      }
      d = _latestCanliData || d;   // beklerken daha yeni bir konum gelmiş olabilir
    }
    if(d.altKonuId && appState.aktifAltKonu?.id !== d.altKonuId){
      let foundAk = null;
      (appState.aktifFasikul?.konular||[]).forEach(k=>(k.altKonular||[]).forEach(ak=>{ if(ak.id===d.altKonuId) foundAk=ak; }));
      if(foundAk) window.selectAltKonu?.(foundAk, `altk-${foundAk.id}`);
    }
    d = _latestCanliData || d;
    if(d.page && appState.currentPage !== d.page){
      const targetPage = Number(d.page);
      const currentPage = Number(appState.currentPage || 1);
      if(Number.isFinite(targetPage) && Number.isFinite(currentPage) && targetPage < currentPage - 2){
        window.debugReport?.('live.page.rollback', {
          fromPage: currentPage,
          toPage: targetPage,
          incoming: d,
          source: d.by
        });
      } else {
        window.debugLog?.('live.page.follow', {fromPage: currentPage, toPage: targetPage, source: d.by}, 'info');
      }
      window.goToPage?.(d.page);
    }
    // Sayfa oturduktan SONRA zoom, SONRA pan — zoom kendi render+scroll-
    // restore döngüsünü tetiklediğinden pan ondan ÖNCE uygulanırsa ezilir.
    d = _latestCanliData || d;
    if(d.zoom && Math.abs(d.zoom - appState.zoom) >= 2){
      try{ await window.setZoomAbsolute?.(d.zoom); }catch(e){}
    }
    d = _latestCanliData || d;
    if(d.fracX != null && d.fracY != null){
      window.applyPageScrollFraction?.(d.page || appState.currentPage, d.fracX, d.fracY, {
        fracLeft: d.fracLeft,
        fracRight: d.fracRight,
        fracTop: d.fracTop,
        fracBottom: d.fracBottom,
        docFracY: d.docFracY
      });
    }
  }catch(e){
    console.warn('Canlı takip hatası:',e);
    window.debugReport?.('live.follow.failed', {error:e, incoming:_latestCanliData});
  }
  finally{ setTimeout(()=>{ appState._liveSuppress = false; }, 900); }
}

document.addEventListener('visibilitychange', ()=>{
  if(document.hidden) return;
  if(_latestCanliData && (appState.liveSession || appState.watchMode)) scheduleFollowCanli(_latestCanliData);
});

export function subscribeCanli(uid){
  unsubscribeCanli();
  if(!window._fsOnSnapshot || !window._db || !uid) return;
  const ref = window._fsDoc(window._db,'kullanicilar',uid);
  _canliUnsub = window._fsOnSnapshot(ref, (snap)=>{
    if(!snap.exists() || snap.metadata.hasPendingWrites) return;
    const docData = snap.data() || {};
    if(appState.watchMode) _showWatchStatsPanel(docData.ad || docData.name || docData.email || 'Öğrenci', docData);
    const d = docData.canli;
    if(!d || d.by === _liveDeviceId()) return;             // kendi yazdığımız
    if(d.ts && d.ts <= (appState._lastCanliTs||0)) return; // zaten uygulandı
    if(!acceptCanliSource(d)) return;                      // başka eski cihaz yayını
    appState._lastCanliTs = d.ts || Date.now();
    appState._watchGotData = true;   // izleme modu: en az bir veri geldi
    if(appState.liveSession || appState.watchMode) scheduleFollowCanli(d);
  }, (err)=>console.warn('Canlı dinleme hatası:',err));
}
export function unsubscribeCanli(){
  if(_canliUnsub){ _canliUnsub(); _canliUnsub=null; }
  clearTimeout(_followTimer);
  _followTimer = null;
  _followSeq++;
  _latestCanliData = null;
  _followSourceId = '';
  _followSourceSeenAt = 0;
}

export function toggleLiveSession(){
  const uid = _getUserKey();
  if(!uid || appState.user?.email === 'misafir@demo.com'){
    window.showToast?.('Canlı Ders için hesabınla giriş yapmalısın','info'); return;
  }
  appState.liveSession = !appState.liveSession;
  document.querySelectorAll('.live-session-btn').forEach(b=>b.classList.toggle('active', appState.liveSession));
  if(appState.liveSession){
    subscribeCanli(uid);
    subscribeRealtimeDrawings(uid);
    publishCanli();
    window.showToast?.('Canlı Ders açık — sayfalar eşlenecek 👀','success');
  } else {
    unsubscribeCanli();
    unsubscribeRealtimeDrawings();
    window.showToast?.('Canlı Ders kapalı','info');
  }
}

// ══════════════════════════════════════════════════════════
// ÖĞRETMEN — bir öğrenciyi CANLI İZLE
// Öğrenci konumunu otomatik yayınlar (autoPublishLive). Öğretmen o öğrencinin
// kullanicilar/{uid}/canli ve .../cizimler yollarını dinleyip aynı sayfayı +
// çizimleri kendi ekranında görür. İzleyen taraf hiçbir şey yayınlamaz.
// ══════════════════════════════════════════════════════════
function _escName(s){
  return String(s||'').replace(/[<>&"]/g, c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
}
function _showWatchBanner(name){
  let b = document.getElementById('watchLiveBanner');
  if(!b){
    b = document.createElement('div');
    b.id = 'watchLiveBanner';
    b.className = 'watch-live-banner';
    document.body.appendChild(b);
  }
  b.innerHTML = `<span class="wlb-dot"></span>`
    + `<span class="wlb-txt"><b>${_escName(name)||'Öğrenci'}</b> canlı izleniyor</span>`
    + `<button class="wlb-stop" onclick="stopWatchStudent()">Durdur</button>`;
  b.style.display = 'flex';
}
function _hideWatchBanner(){ const b=document.getElementById('watchLiveBanner'); if(b) b.style.display='none'; }
function _placeWatchStatsPanel(panel){
  const host = document.getElementById('rpSoruSection');
  const after = document.getElementById('soruList');
  if(host && after && panel.parentElement !== host){
    after.insertAdjacentElement('afterend', panel);
    panel.classList.add('in-reader-panel');
  }else if(!host && panel.parentElement !== document.body){
    document.body.appendChild(panel);
    panel.classList.remove('in-reader-panel');
  }
}
function toggleWatchStatsPanel(){
  const panel = document.getElementById('watchLiveStatsPanel');
  if(!panel) return;
  panel.classList.toggle('collapsed');
  const btn = panel.querySelector('.wls-toggle');
  if(btn) btn.textContent = panel.classList.contains('collapsed') ? 'Aç' : 'Kapat';
}
window.toggleWatchStatsPanel = toggleWatchStatsPanel;
function _showWatchStatsPanel(name, data={}){
  let panel = document.getElementById('watchLiveStatsPanel');
  if(!panel){
    panel = document.createElement('div');
    panel.id = 'watchLiveStatsPanel';
    panel.className = 'watch-live-stats-panel';
  }
  _placeWatchStatsPanel(panel);
  const collapsed = panel.classList.contains('collapsed');
  const stats = data.istatistik || {};
  const total = Number(stats.toplam || 0);
  const correct = Number(stats.dogru || 0);
  const wrong = Number(stats.yanlis || 0);
  const blank = Number(stats.bos || 0);
  const accuracy = total ? Math.round((correct / total) * 100) : 0;
  const net = correct - wrong / 4;
  const weekly = data.haftalikCozulen ?? data.buHafta ?? total;
  const last = data.canli?.fasikulAd || data.sonCalisma?.fasikulAd || data.lastFasikulAd || data.canli?.fasikulId || 'Canlı ekran';
  panel.innerHTML = `
    <div class="wls-head">
      <span class="wlb-dot"></span>
      <div><b>${_escName(name)||'Öğrenci'}</b><small>izleme modu</small></div>
      <button class="wls-toggle" onclick="toggleWatchStatsPanel()">${collapsed ? 'Aç' : 'Kapat'}</button>
    </div>
    <div class="wls-body">
      <div class="wls-grid">
        <div class="wls-card"><b>${total}</b><span>Toplam Çözülen</span></div>
        <div class="wls-card"><b>${weekly}</b><span>Bu Hafta</span></div>
        <div class="wls-card"><b>%${accuracy}</b><span>Başarı</span></div>
        <div class="wls-card"><b>${Number.isFinite(net) ? net.toFixed(net % 1 ? 2 : 0) : '0'}</b><span>Net</span></div>
      </div>
      <div class="wls-foot">
        <span>${_escName(last)}</span>
        <span>${correct} doğru · ${wrong} yanlış · ${blank} boş</span>
      </div>
    </div>
  `;
  panel.classList.toggle('collapsed', collapsed);
  panel.style.display = 'block';
}
function _hideWatchStatsPanel(){ const p=document.getElementById('watchLiveStatsPanel'); if(p) p.style.display='none'; }

export function watchStudentLive(studentUid, studentName){
  if(!studentUid){ window.showToast?.('Öğrenci seçilemedi','error'); return; }
  if(!window._firestoreReady || !window._db){ window.showToast?.('Bağlantı hazır değil, birazdan tekrar dene','info'); return; }
  // Önceki izleme/canlı ders varsa temizle
  if(appState.liveSession){ appState.liveSession=false; document.querySelectorAll('.live-session-btn').forEach(b=>b.classList.remove('active')); }
  stopWatchStudent(true);
  appState.watchMode = true;
  appState._watchStudentUid = studentUid;
  appState._watchGotData = false;
  appState._lastCanliTs = 0;   // yeni öğrencinin ilk konumu uygulanabilsin
  subscribeCanli(studentUid);
  subscribeWatchSolutions(studentUid);
  subscribeRealtimeDrawings(studentUid);
  _showWatchBanner(studentName);
  _showWatchStatsPanel(studentName, {});
  window.showToast?.(`🔴 ${studentName||'Öğrenci'} canlı izleniyor`,'success');
  // Öğrenci çevrimdışıysa / hiç yayın yoksa bilgilendir
  clearTimeout(appState._watchProbe);
  appState._watchProbe = setTimeout(()=>{
    if(appState.watchMode && !appState._watchGotData)
      window.showToast?.('Öğrenci şu an çevrimdışı görünüyor · uygulamayı açıp sayfa gezdiğinde ekranına gelecek','info');
  }, 5000);
}

export function stopWatchStudent(silent){
  const wasWatching = appState.watchMode;
  appState.watchMode = false;
  appState._watchStudentUid = null;
  appState._liveManualPauseUntil = 0;
  clearTimeout(appState._watchProbe);
  unsubscribeCanli();
  unsubscribeWatchSolutions();
  unsubscribeRealtimeDrawings();
  _hideWatchBanner();
  _hideWatchStatsPanel();
  _lastFollowStatsSig = '';
  window.updateTestProgress?.();
  if(wasWatching && !silent) window.showToast?.('Canlı izleme durduruldu','info');
}

function restoreSolutionStateFromDoc(data, soruKey){
  return {
    answered:true,
    selected:data.ogrenciCevap??null,
    correct:data.dogru===true,
    skipped:data.atladi===true,
    correct_answer:data.dogruCevap||'',
    timeSec:data.sureSaniye||0,
    fasikulId:data.fasikulId||'',
    fasikulAd:data.fasikulAd||'',
    konu:data.konu||'',
    altKonu:data.altKonu||'',
    zorluk:data.zorluk||'',
    tarih:data.tarih||'',
    _synced:true,
    _watch:true,
    soruKey
  };
}

function subscribeWatchSolutions(uid){
  unsubscribeWatchSolutions();
  appState.watchSorularState = {};
  if(!appState.watchMode || !window._fsOnSnapshot || !window._db || !uid) return;
  const cozumlerRef = window._fsCollection(window._db,'kullanicilar',uid,'cozumler');
  window._watchUnsubCozumler = window._fsOnSnapshot(cozumlerRef, (snapshot)=>{
    let changed = false;
    snapshot.docChanges().forEach(change=>{
      const data = change.doc.data();
      const soruKey = data.soruKey || decodeURIComponent(change.doc.id);
      if(!soruKey) return;
      if(change.type === 'removed'){
        delete appState.watchSorularState[soruKey];
        if(data.fasikulId) delete appState.watchSorularState[`${data.fasikulId}__${soruKey}`];
        changed = true;
        return;
      }
      if(change.doc.metadata.hasPendingWrites) return;
      const restored = restoreSolutionStateFromDoc(data, soruKey);
      appState.watchSorularState[soruKey] = restored;
      if(data.fasikulId) appState.watchSorularState[`${data.fasikulId}__${soruKey}`] = restored;
      changed = true;
    });
    if(changed){
      window.updateTestProgress?.();
      if(appState.aktifAltKonu?.sorular){
        window.renderSoruStrip?.(appState.aktifAltKonu.sorular);
        window.renderSolveAnswers?.();
      }
    }
  }, (err)=>{
    console.warn('İzleme cevapları dinleme hatası:', err);
    window.debugReport?.('watch.solutions.listen.failed', {error:err, uid});
  });
}

function unsubscribeWatchSolutions(){
  if(window._watchUnsubCozumler){
    window._watchUnsubCozumler();
    window._watchUnsubCozumler = null;
  }
  appState.watchSorularState = {};
}

function subscribeRealtimeDrawings(uid){
  unsubscribeRealtimeDrawings();
  if((!appState.liveSession && !appState.watchMode) || !window._fsOnSnapshot || !window._db || !uid) return;
  const cizimlerRef = window._fsCollection(window._db,'kullanicilar',uid,'cizimler');
  window._realtimeUnsubCizimler = window._fsOnSnapshot(cizimlerRef, (snapshot)=>{
    snapshot.docChanges().forEach(change=>{
      if(change.type==='removed') return;
      if(change.doc.metadata.hasPendingWrites) return;
      const data = change.doc.data();
      const key = data.key;
      if(!key || !data.json) return;
      if(data.by && data.by === appState._cloudDeviceId) return;
      const remoteUpdatedAt = Number(data.updatedAtMs || Date.parse(data.updatedAt || '')) || 0;
      const localEditAt = Number(appState.drawingLocalEditAt?.[key] || 0);
      const lastRemoteAt = Number(appState.drawingRemoteUpdatedAt?.[key] || 0);
      if(remoteUpdatedAt && lastRemoteAt && remoteUpdatedAt < lastRemoteAt) return;
      const aktifId = appState.aktifFasikul?.id;
      const currentPage = appState.currentPage;
      const currentKey = aktifId ? `drawing_${aktifId}_p${currentPage}` : null;
      const isCurrentCanvas = currentKey === key;
      const dataPage = Number(data.pageNum || String(key).match(/_p(\d+)$/)?.[1] || 0);
      const isLiveDrawingEvent = Number(data.liveEventAtMs || 0) > 0;
      if(appState.drawings[key] === data.json){
        if(isCurrentCanvas){
          const fc = appState.fabricCanvases?.[currentPage] || appState.fabricCanvas;
          const localJson = fc && window._localCanvasJSON ? window._localCanvasJSON(fc) : '';
          if(fc && localJson !== data.json) queueRealtimeDrawing(fc, key, data);
        }
        return;
      }
      const localIsNewer = localEditAt && remoteUpdatedAt && remoteUpdatedAt < localEditAt;
      const localIsActive = isCurrentCanvas && Date.now() - (appState._lastCanvasDrawTapAt || 0) < DRAWING_REMOTE_EDIT_GUARD_MS;
      if(localIsNewer || localIsActive){
        appState.pendingRemoteDrawings[key] = data;
        return;
      }
      appState.drawings[key] = data.json;
      if(data.w && data.h) appState.drawingDims[key] = {w:data.w, h:data.h};
      if(!isCurrentCanvas && isLiveDrawingEvent && data.fasikulId === aktifId && dataPage){
        window.debugLog?.('live.draw.follow_page', {fromPage:currentPage, toPage:dataPage, key}, 'info');
        window.goToPage?.(dataPage);
        setTimeout(()=>{
          const fc2 = appState.fabricCanvases?.[dataPage] || appState.fabricCanvas;
          if(fc2 && appState.drawings[key]) queueRealtimeDrawing(fc2, key, data);
        }, 180);
        if(remoteUpdatedAt) appState.drawingRemoteUpdatedAt[key] = remoteUpdatedAt;
        return;
      }
      if(currentKey === key){
        const fc = appState.fabricCanvases?.[currentPage] || appState.fabricCanvas;
        if(fc){
          queueRealtimeDrawing(fc, key, data);
        } else {
          setTimeout(()=>{
            const fc2 = appState.fabricCanvases?.[currentPage] || appState.fabricCanvas;
            if(fc2 && appState.drawings[key]) queueRealtimeDrawing(fc2, key, data);
          }, 1500);
        }
      }
      if(remoteUpdatedAt) appState.drawingRemoteUpdatedAt[key] = remoteUpdatedAt;
    });
  }, (err)=>{
    console.warn('Cizimler onSnapshot hatası:',err);
    window.showToast?.('Çizim senkronizasyonu kesildi','error');
  });
}

function queueRealtimeDrawing(fc, key, data){
  if(!fc || !data?.json) return;
  fc._queuedRealtimeDrawing = { key, data };
  clearTimeout(fc._remoteDrawingTimer);
  fc._remoteDrawingTimer = setTimeout(()=>drainRealtimeDrawingQueue(fc), REMOTE_DRAWING_APPLY_DELAY_MS);
}

function drainRealtimeDrawingQueue(fc){
  if(!fc || fc._remoteDrawingLoading) return;
  const queued = fc._queuedRealtimeDrawing;
  fc._queuedRealtimeDrawing = null;
  if(!queued) return;
  loadRealtimeDrawing(fc, queued.key, queued.data);
}

function loadRealtimeDrawing(fc, key, data){
  if(!fc || !data?.json) return;
  fc._remoteDrawingLoading = true;
  fc._applyingRemoteDrawing = true;
  const token = (fc._remoteDrawingToken = (fc._remoteDrawingToken || 0) + 1);
  try{
    fc.loadFromJSON(data.json, ()=>{
      if(fc._remoteDrawingToken === token && !fc._queuedRealtimeDrawing){
        window.applyDrawingScale?.(fc, key);
        fc.renderAll();
      }
      fc._remoteDrawingLoading = false;
      fc._applyingRemoteDrawing = false;
      if(fc._queuedRealtimeDrawing) setTimeout(()=>drainRealtimeDrawingQueue(fc), 0);
    });
  }catch(e){
    fc._remoteDrawingLoading = false;
    fc._applyingRemoteDrawing = false;
    console.warn('Canlı çizim yüklenemedi:', e);
    window.debugReport?.('live.draw.load_failed', {error:e, key});
    if(fc._queuedRealtimeDrawing) setTimeout(()=>drainRealtimeDrawingQueue(fc), 0);
  }
}

function unsubscribeRealtimeDrawings(){
  if(window._realtimeUnsubCizimler){
    window._realtimeUnsubCizimler();
    window._realtimeUnsubCizimler = null;
  }
}

function arraysSameOrderless(a, b){
  const aa = Array.isArray(a) ? [...a].sort() : [];
  const bb = Array.isArray(b) ? [...b].sort() : [];
  return aa.length === bb.length && aa.every((v, i) => v === bb[i]);
}

function refreshVisibleFasikulUi(){
  window.recalcFasikulProgress?.();
  window.renderDerslerGrid?.();
  if(window.currentDrawerDers && window.visibleFasikullerFor && window.renderFasikulCards){
    window.renderFasikulCards(window.visibleFasikullerFor(window.currentDrawerDers), window.currentDrawerDers);
  }
  window.loadMyAssignments?.();
  window.loadMyStudyPlan?.();
}

function subscribeUserProfile(uid){
  if(window._realtimeUnsubUserProfile){
    window._realtimeUnsubUserProfile();
    window._realtimeUnsubUserProfile = null;
  }
  if(!window._fsOnSnapshot || !window._db || !uid) return;
  const ref = window._fsDoc(window._db,'kullanicilar',uid);
  window._realtimeUnsubUserProfile = window._fsOnSnapshot(ref, (snap)=>{
    if(!snap.exists() || snap.metadata.hasPendingWrites || !appState.user) return;
    const data = snap.data() || {};
    const hiddenChanged = Array.isArray(data.hiddenFasikulIds) && !arraysSameOrderless(appState.user.hiddenFasikulIds, data.hiddenFasikulIds);
    const visibleChanged = Array.isArray(data.visibleFasikulIds) && !arraysSameOrderless(appState.user.visibleFasikulIds || [], data.visibleFasikulIds);
    if(hiddenChanged || visibleChanged){
      if(Array.isArray(data.hiddenFasikulIds)) appState.user.hiddenFasikulIds = data.hiddenFasikulIds;
      appState.user.visibleFasikulIds = Array.isArray(data.visibleFasikulIds) ? data.visibleFasikulIds : appState.user.visibleFasikulIds;
      refreshVisibleFasikulUi();
      window.showToast?.('Fasikül yetkileri güncellendi', 'success');
    }
  }, (err)=>{ console.warn('Kullanıcı profili onSnapshot hatası:',err); });
}

export function startRealtimeSync(uid){
  stopRealtimeSync();
  if(!window._fsOnSnapshot || !window._db) return;
  subscribeUserProfile(uid);

  // Öğrenci hesapları konumunu otomatik yayınlar → öğretmen elle bir şey
  // yapmadan canlı izleyebilir. Öğretmen/yönetici/misafir yayın yapmaz.
  appState.autoPublishLive = appState.user?.role === 'ogrenci'
    && appState.user?.email !== 'misafir@demo.com';

  // ── Cevapları dinle ──
  const cozumlerRef = window._fsCollection(window._db,'kullanicilar',uid,'cozumler');
  window._realtimeUnsubCozumler = window._fsOnSnapshot(cozumlerRef, (snapshot)=>{
    let changed = false;
    snapshot.docChanges().forEach(change=>{
      if(change.type==='removed') return;
      const data = change.doc.data();
      const soruKey = data.soruKey || decodeURIComponent(change.doc.id);
      if(!soruKey) return;
      const existing = appState.sorularState[soruKey];
      const incomingTarih = data.tarih || '';
      if(change.doc.metadata.hasPendingWrites) return;
      if(!existing || incomingTarih > (existing.tarih||'') || !existing._synced){
        appState.sorularState[soruKey] = {
          answered:true, selected:data.ogrenciCevap??null,
          correct:data.dogru===true, skipped:data.atladi===true,
          correct_answer:data.dogruCevap||'', timeSec:data.sureSaniye||0,
          fasikulId:data.fasikulId||'', fasikulAd:data.fasikulAd||'',
          konu:data.konu||'', altKonu:data.altKonu||'', zorluk:data.zorluk||'',
          tarih:incomingTarih, _synced:true
        };
        changed = true;
      }
    });
    if(changed){
      localStorage.setItem('edu_sorularState', JSON.stringify(appState.sorularState));
      appState.cloudSolutionsLoaded = true;
      window.recalcFasikulProgress?.();
      window.updateDashboard?.();
      if(typeof window.renderDerslerGrid==='function') window.renderDerslerGrid();
      const readerOpen = document.getElementById('reader-overlay')?.classList.contains('open');
      if(readerOpen){
        window.updateTestProgress?.();
        if(appState.aktifAltKonu?.sorular) window.renderSoruStrip?.(appState.aktifAltKonu.sorular);
      }
    }
  }, (err)=>{ console.warn('Cozumler onSnapshot hatası:',err); });

  // ── Hatalıları dinle ──
  const hatalilarRef = window._fsCollection(window._db,'kullanicilar',uid,'hatalilar');
  window._realtimeUnsubHatalilar = window._fsOnSnapshot(hatalilarRef, (snapshot)=>{
    if(snapshot.metadata.hasPendingWrites) return;
    const hatalilar = [];
    snapshot.forEach(doc => hatalilar.push(doc.data()));
    appState.hatalilar = hatalilar;
    try{ localStorage.setItem('edu_hatalilar',JSON.stringify(hatalilar)); }catch(e){}
    const n = hatalilar.length;
    document.getElementById('hataliCount').textContent = n;
    document.getElementById('hataliCountBig').textContent = `${n} Soru`;
    window.renderHatalilar?.();
  }, (err)=>{ console.warn('Hatalilar onSnapshot hatası:',err); });
}

export function stopRealtimeSync(){
  if(window._realtimeUnsubUserProfile){ window._realtimeUnsubUserProfile(); window._realtimeUnsubUserProfile=null; }
  if(window._realtimeUnsubCozumler){ window._realtimeUnsubCozumler(); window._realtimeUnsubCozumler=null; }
  unsubscribeRealtimeDrawings();
  if(window._realtimeUnsubHatalilar){ window._realtimeUnsubHatalilar(); window._realtimeUnsubHatalilar=null; }
  unsubscribeCanli();
  appState.liveSession = false;
  appState.autoPublishLive = false;
  stopWatchStudent(true);
  window.stopCanliPresence?.();
  document.querySelectorAll('.live-session-btn').forEach(b=>b.classList.remove('active'));
}
