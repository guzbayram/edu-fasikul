import { appState } from '../state/appState.js';
import { _getUserKey } from '../firebase/firestore.js';
import { db, doc, setDoc, collection, onSnapshot, deleteDoc, query, where } from '../firebase/init.js';

// Ses verisi WebRTC ile doğrudan katılımcılar arasında akar. Firestore yalnızca
// offer/answer/ICE ve el kaldırma gibi küçük, kısa ömürlü signaling verisini taşır.
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];
const VOICE_HEARTBEAT_MS = 15000;
const PEER_DISCONNECT_RETRY_MS = 2500;
const PEER_RESTART_COOLDOWN_MS = 3500;

let localStream = null;
let roomId = '';
let voiceRoster = [];
let rosterUnsub = null;
let signalUnsub = null;
let heartbeatTimer = null;
let voiceReady = false;
let lastHandRaised = new Set();
let signalSeq = 0;
let pendingGrant = null;
let voicePlaybackBlocked = false;
let voiceState = { handRaised: false, raisedAt: null, callPending: false, callActive: false, muted: false };
const peers = new Map();
const remoteAudio = new Map();
const pendingCandidates = new Map();
const peerRecoveryTimers = new Map();
const peerLastRestartAt = new Map();
const peerLastReportedState = new Map();

function esc(s) {
  return String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}

function me() {
  const uid = _getUserKey();
  const user = appState.user;
  if (!uid || !user || user.email === 'misafir@demo.com') return null;
  return { uid, name: user.name || user.email || 'Kullanıcı', email: user.email, role: user.role || 'ogrenci' };
}

function isTeacher() {
  return appState.user?.role === 'admin' || appState.user?.role === 'ogretmen';
}

function showStatus(msg, type = 'info') {
  window.showToast?.(msg, type);
}

function closeVoiceGrantPrompt() {
  document.getElementById('voiceGrantPrompt')?.remove();
}

function closeVoicePlaybackPrompt() {
  document.getElementById('voicePlaybackPrompt')?.remove();
}

function renderVoicePlaybackPrompt() {
  if (!voicePlaybackBlocked || !remoteAudio.size) {
    closeVoicePlaybackPrompt();
    return;
  }
  let panel = document.getElementById('voicePlaybackPrompt');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'voicePlaybackPrompt';
    panel.className = 'voice-playback-prompt';
    document.body.appendChild(panel);
  }
  panel.innerHTML = `
    <span>Karşı tarafın sesi hazır.</span>
    <button onclick="playVoiceAudio()">Sesi Başlat</button>
  `;
}

function renderVoiceGrantPrompt() {
  if (isTeacher() || !pendingGrant) {
    closeVoiceGrantPrompt();
    return;
  }
  let panel = document.getElementById('voiceGrantPrompt');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'voiceGrantPrompt';
    panel.className = 'voice-grant-prompt';
    document.body.appendChild(panel);
  }
  panel.innerHTML = `
    <div>
      <b>Sesli konuşma isteği</b>
      <span>${esc(pendingGrant.name)} seni konuşmaya çağırıyor.</span>
    </div>
    <button onclick="acceptVoiceGrant()">Kabul Et</button>
    <button class="secondary" onclick="rejectVoiceGrant()">Reddet</button>
  `;
}

function memberRef(uid = me()?.uid) {
  return uid && roomId ? doc(db, 'canliOturum', roomId, 'uyeler', uid) : null;
}

function signalCollection() {
  return roomId ? collection(db, 'canliOturum', roomId, 'sesSinyalleri') : null;
}

function queueForVoice() {
  return voiceRoster
    .filter(item => item.voice?.handRaised)
    .sort((a, b) => (a.voice?.raisedAt || 0) - (b.voice?.raisedAt || 0));
}

function serializeSignalPayload(payload) {
  if (!payload) return {};
  if (typeof payload.toJSON === 'function') return payload.toJSON();
  return payload;
}

function publishVoicePresence(extra = {}) {
  const user = me();
  const ref = memberRef(user?.uid);
  if (!user || !ref) return Promise.resolve();
  voiceState = {
    ...voiceState,
    ...extra,
    muted: Object.prototype.hasOwnProperty.call(extra, 'muted') ? !!extra.muted : localMuted()
  };
  return setDoc(ref, {
    uid: user.uid,
    name: user.name,
    role: user.role,
    ts: Date.now(),
    voice: {
      online: true,
      ...voiceState
    }
  }, { merge: true }).catch(error => {
    console.warn('Firebase ses durumu yazılamadı:', error);
    window.debugReport?.('voice.presence.write.failed', {error, roomId});
    voiceReady = false;
    renderVoiceUi();
    throw error;
  });
}

async function sendSignal(to, type, payload = {}) {
  const user = me();
  const signals = signalCollection();
  if (!user || !signals || !to) throw new Error('Canlı ses odası hazır değil.');
  const id = `${to}_${user.uid}_${Date.now()}_${++signalSeq}`;
  await setDoc(doc(signals, id), {
    to,
    from: user.uid,
    fromName: user.name,
    type,
    payload: serializeSignalPayload(payload),
    createdAt: Date.now()
  });
}

function subscribeVoiceRoom() {
  const user = me();
  if (!user || !roomId) return;
  rosterUnsub?.();
  signalUnsub?.();
  const members = collection(db, 'canliOturum', roomId, 'uyeler');
  rosterUnsub = onSnapshot(members, snap => {
    const now = Date.now();
    voiceRoster = snap.docs
      .map(item => item.data())
      .filter(item => item?.uid && now - (item.ts || 0) < 45000);
    const raised = new Set(queueForVoice().map(item => item.uid));
    raised.forEach(uid => {
      if (!lastHandRaised.has(uid) && isTeacher() && uid !== user.uid) {
        const member = voiceRoster.find(item => item.uid === uid);
        showStatus(`✋ ${member?.name || 'Öğrenci'} konuşmak istiyor`, 'info');
        window.eduNotify?.('Öğrenci el kaldırdı', `${member?.name || 'Öğrenci'} konuşmak istiyor`);
      }
    });
    lastHandRaised = raised;
    renderVoiceUi();
  }, error => {
    console.warn('Firebase ses katılımcıları dinlenemedi:', error);
    window.debugReport?.('voice.roster.listen.failed', {error, roomId});
    voiceReady = false;
    renderVoiceUi();
  });

  signalUnsub = onSnapshot(query(collection(db, 'canliOturum', roomId, 'sesSinyalleri'), where('to', '==', user.uid)), snap => {
    snap.docChanges().forEach(change => {
      if (change.type !== 'added') return;
      const signal = change.doc.data();
      if (signal?.to !== user.uid || signal.from === user.uid) return;
      if (Date.now() - (signal.createdAt || 0) > 60000) {
        deleteDoc(change.doc.ref).catch(() => {});
        return;
      }
      handleSignal(signal).finally(() => deleteDoc(change.doc.ref).catch(() => {}));
    });
  }, error => {
    console.warn('Firebase ses sinyalleri dinlenemedi:', error);
    window.debugReport?.('voice.signal.listen.failed', {error, roomId});
    voiceReady = false;
    renderVoiceUi();
  });
}

export async function voiceJoinRoom(nextRoomId) {
  const user = me();
  if (!user || !nextRoomId) return;
  if (roomId === String(nextRoomId) && voiceReady) return;
  voiceLeaveRoom();
  roomId = String(nextRoomId);
  try {
    await publishVoicePresence();
    voiceReady = true;
    subscribeVoiceRoom();
    heartbeatTimer = setInterval(() => publishVoicePresence().catch(() => {}), VOICE_HEARTBEAT_MS);
  } catch (error) {
    console.warn('Firebase ses odası açılamadı:', error);
    window.debugReport?.('voice.room.join.failed', {error, roomId:nextRoomId});
    showStatus('Canlı ses için Firestore izni gerekli.', 'error');
  }
  renderVoiceUi();
}

export function voiceLeaveRoom() {
  rosterUnsub?.(); rosterUnsub = null;
  signalUnsub?.(); signalUnsub = null;
  clearInterval(heartbeatTimer); heartbeatTimer = null;
  roomId = '';
  voiceReady = false;
  voiceRoster = [];
  pendingGrant = null;
  voicePlaybackBlocked = false;
  voiceState = { handRaised: false, raisedAt: null, callPending: false, callActive: false, muted: false };
  closeVoiceGrantPrompt();
  closeVoicePlaybackPrompt();
  lastHandRaised.clear();
  peers.forEach((_, uid) => closePeer(uid));
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  renderVoiceUi();
}

async function getLocalStream() {
  if (localStream) return localStream;
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Bu tarayıcı mikrofon erişimini desteklemiyor.');
  localStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false
  });
  localStream.getAudioTracks().forEach(track => {
    track.enabled = !voiceState.muted;
    track.onended = () => {
      voiceState.callActive = false;
      localStream = null;
      window.debugReport?.('voice.local.track.ended', {roomId});
      showStatus('Mikrofon bağlantısı kapandı. Yeniden konuşmak için mikrofonu aç.', 'error');
      publishVoicePresence({ callActive: false }).catch(() => {});
      renderVoiceUi();
    };
  });
  publishVoicePresence().catch(() => {});
  return localStream;
}

function createPeer(uid) {
  closePeer(uid, false);
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  peers.set(uid, pc);
  pc.onicecandidate = event => {
    if (event.candidate) sendSignal(uid, 'ice', event.candidate).catch(console.warn);
  };
  pc.ontrack = event => {
    attachRemoteAudio(uid, event.streams[0]);
    showStatus('Karşı tarafın sesi bağlandı.', 'success');
  };
  const onPeerState = () => {
    schedulePeerRecovery(uid, pc.connectionState || pc.iceConnectionState);
    renderVoiceUi();
  };
  pc.onconnectionstatechange = onPeerState;
  pc.oniceconnectionstatechange = onPeerState;
  pc.onicecandidateerror = event => {
    console.warn('WebRTC ICE aday hatası:', event?.errorText || event?.errorCode || event);
    window.debugLog?.('voice.ice.candidate.error', {uid, errorText:event?.errorText, errorCode:event?.errorCode}, 'warn');
  };
  return pc;
}

async function startCall(uid, makeOffer) {
  if (!uid) return;
  const stream = await getLocalStream();
  const pc = createPeer(uid);
  stream.getTracks().forEach(track => pc.addTrack(track, stream));
  if (makeOffer) {
    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);
    await sendSignal(uid, 'offer', offer);
  }
  await publishVoicePresence({ callActive: true, callPending: false });
  renderVoiceUi();
}

function clearPeerRecovery(uid) {
  const timer = peerRecoveryTimers.get(uid);
  if (timer) clearTimeout(timer);
  peerRecoveryTimers.delete(uid);
}

function shouldInitiatePeerRecovery(uid) {
  const user = me();
  if (!user || !uid) return false;
  return String(user.uid) < String(uid);
}

function schedulePeerRecovery(uid, state) {
  if (!uid) return;
  if (state === 'connected' || state === 'completed') {
    window.debugLog?.('voice.peer.connected', {uid, state}, 'info');
    clearPeerRecovery(uid);
    peerLastReportedState.delete(uid);
    publishVoicePresence({ callActive: true }).catch(() => {});
    return;
  }
  if (state === 'closed') {
    clearPeerRecovery(uid);
    peerLastReportedState.delete(uid);
    return;
  }
  if (state !== 'disconnected' && state !== 'failed') return;
  // pc.onconnectionstatechange VE pc.oniceconnectionstatechange İKİSİ DE aynı
  // onPeerState()'i çağırıyor; bağlantı "disconnected"/"failed" durumunda
  // KALDIĞI sürece her ufak state tick'inde (yeniden pazarlık denemeleri dahil)
  // bu fonksiyon tekrar tekrar tetikleniyordu — tek bir gerçek kopma olayı,
  // saniyeler içinde onlarca neredeyse birebir aynı debugReport kaydına
  // dönüşüyordu (canlıda 9 saniyede 20 kayıt gözlemlendi). Aynı durum için
  // sadece BİR KEZ raporla; durum GERÇEKTEN değişince (ör. disconnected'dan
  // failed'a yükselince, ya da toparlanıp yeniden kopunca) tekrar raporlanır.
  if (peerLastReportedState.get(uid) !== state) {
    peerLastReportedState.set(uid, state);
    window.debugReport?.('voice.peer.unstable', {uid, state}, {force: state === 'failed'});
  }
  if (peerRecoveryTimers.has(uid)) return;
  const initiator = shouldInitiatePeerRecovery(uid);
  const delay = state === 'failed' ? (initiator ? 300 : 4000) : (initiator ? PEER_DISCONNECT_RETRY_MS : 7000);
  peerRecoveryTimers.set(uid, setTimeout(() => {
    peerRecoveryTimers.delete(uid);
    restartPeer(uid).catch(error => console.warn('Ses bağlantısı yeniden başlatılamadı:', error));
  }, delay));
}

async function restartPeer(uid) {
  const user = me();
  if (!user || !uid || !roomId) return;
  const pc = peers.get(uid);
  if (!pc || pc.connectionState === 'connected' || pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') return;
  const now = Date.now();
  const last = peerLastRestartAt.get(uid) || 0;
  if (now - last < PEER_RESTART_COOLDOWN_MS) {
    schedulePeerRecovery(uid, 'disconnected');
    return;
  }
  if (!shouldInitiatePeerRecovery(uid)) {
    const stale = now - last > PEER_RESTART_COOLDOWN_MS * 2;
    if (!stale) return;
  }
  if (pc.signalingState && pc.signalingState !== 'stable') {
    schedulePeerRecovery(uid, 'disconnected');
    return;
  }
  const stream = await getLocalStream();
  if (!pc.getSenders().some(sender => sender.track?.kind === 'audio')) {
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
  }
  peerLastRestartAt.set(uid, now);
  window.debugLog?.('voice.peer.restart', {uid}, 'warn');
  const offer = await pc.createOffer({ offerToReceiveAudio: true, iceRestart: true });
  await pc.setLocalDescription(offer);
  await sendSignal(uid, 'offer', offer);
  await publishVoicePresence({ callActive: true, callPending: false });
  showStatus('Ses bağlantısı yeniden deneniyor.', 'info');
}

async function addCandidate(pc, uid, candidate) {
  if (!pc.remoteDescription) {
    const list = pendingCandidates.get(uid) || [];
    list.push(candidate);
    pendingCandidates.set(uid, list);
    return;
  }
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (error) {
    console.warn('WebRTC ICE adayı eklenemedi:', error);
    window.debugLog?.('voice.ice.add.failed', {uid, error}, 'warn');
  }
}

async function flushCandidates(pc, uid) {
  const list = pendingCandidates.get(uid) || [];
  pendingCandidates.delete(uid);
  for (const candidate of list) await addCandidate(pc, uid, candidate);
}

async function handleSignal({ from, fromName, type, payload }) {
  if (!from || !type) return;
  if (type === 'grant') {
    window.debugLog?.('voice.signal.grant', {from, fromName}, 'info');
    showStatus(`${fromName || 'Karşı taraf'} ses görüşmesini kabul etti`, 'success');
    pendingGrant = null;
    closeVoiceGrantPrompt();
    await getLocalStream();
    setLocalMuted(false);
    await publishVoicePresence({ handRaised: false, raisedAt: null, callPending: false });
    await startCall(from, true);
    renderVoiceUi();
    return;
  }
  if (type === 'mute') {
    setLocalMuted(!!payload?.muted, true);
    return;
  }
  const stream = await getLocalStream();
  let pc = peers.get(from) || createPeer(from);
  window.debugLog?.('voice.signal.received', {from, type}, 'info');
  if (!pc.getSenders().some(sender => sender.track?.kind === 'audio')) {
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
  }
  if (type === 'offer') {
    if (pc.signalingState && pc.signalingState !== 'stable') {
      try {
        await pc.setLocalDescription({ type: 'rollback' });
      } catch (_e) {
        closePeer(from, false);
        pc = createPeer(from);
        stream.getTracks().forEach(track => pc.addTrack(track, stream));
      }
    }
    await pc.setRemoteDescription(new RTCSessionDescription(payload));
    await flushCandidates(pc, from);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await sendSignal(from, 'answer', answer);
    await publishVoicePresence({ callActive: true, callPending: false });
  } else if (type === 'answer') {
    await pc.setRemoteDescription(new RTCSessionDescription(payload));
    await flushCandidates(pc, from);
    await publishVoicePresence({ callActive: true, callPending: false });
  } else if (type === 'ice' && payload) {
    await addCandidate(pc, from, payload);
  }
  renderVoiceUi();
}

function attachRemoteAudio(uid, stream) {
  let audio = remoteAudio.get(uid);
  if (!audio) {
    audio = document.createElement('audio');
    audio.autoplay = true;
    audio.playsInline = true;
    audio.muted = false;
    audio.volume = 1;
    audio.dataset.voiceUid = uid;
    audio.style.display = 'none';
    document.body.appendChild(audio);
    remoteAudio.set(uid, audio);
  }
  audio.srcObject = stream;
  audio.play?.().then(() => {
    voicePlaybackBlocked = false;
    closeVoicePlaybackPrompt();
  }).catch(() => {
    voicePlaybackBlocked = true;
    window.debugReport?.('voice.playback.blocked', {uid});
    showStatus('Sesi başlatmak için Sesi Başlat düğmesine dokun.', 'info');
    renderVoicePlaybackPrompt();
  });
}

function closePeer(uid, refresh = true) {
  clearPeerRecovery(uid);
  const pc = peers.get(uid);
  if (pc) pc.close();
  peers.delete(uid);
  pendingCandidates.delete(uid);
  const audio = remoteAudio.get(uid);
  if (audio) audio.remove();
  remoteAudio.delete(uid);
  if (!remoteAudio.size) {
    voicePlaybackBlocked = false;
    closeVoicePlaybackPrompt();
  }
  if (!peers.size) publishVoicePresence({ callActive: false }).catch(() => {});
  if (refresh) renderVoiceUi();
}

function setLocalMuted(muted, remoteCommand = false) {
  voiceState.muted = !!muted;
  localStream?.getAudioTracks().forEach(track => { track.enabled = !muted; });
  publishVoicePresence({ muted: !!muted }).catch(() => {});
  renderVoiceUi();
  if (remoteCommand) showStatus(muted ? 'Mikrofon öğretmen tarafından kapatıldı' : 'Mikrofon açıldı', 'info');
}

function localMuted() {
  const track = localStream?.getAudioTracks?.()[0];
  return track ? !track.enabled : !!voiceState.muted;
}

function connectionLabel(uid) {
  const pc = peers.get(uid);
  if (!voiceReady) return 'bağlantı kesildi';
  if (!pc) return 'hazır';
  const state = pc.connectionState || pc.iceConnectionState;
  if (state === 'connected' || state === 'completed') return 'bağlı';
  if (state === 'failed' || state === 'disconnected') return 'zayıf sinyal';
  return state || 'bağlanıyor';
}

export async function raiseHandForVoice() {
  if (!voiceReady) return showStatus('Canlı ses odası hazır değil.', 'error');
  try {
    await getLocalStream();
    setLocalMuted(false);
    await publishVoicePresence({ handRaised: true, raisedAt: Date.now(), callPending: true });
    showStatus('Ses görüşmesi talebi gönderildi; karşı taraf kabul edince bağlantı kurulacak.', 'success');
  } catch (error) {
    showStatus(error.message || 'Ses talebi başlatılamadı. Mikrofon iznini kontrol et.', 'error');
  }
}

export async function acceptVoiceGrant() {
  if (!pendingGrant?.uid) return showStatus('Bekleyen sesli konuşma izni yok.', 'info');
  try {
    const teacherUid = pendingGrant.uid;
    await getLocalStream();
    setLocalMuted(false);
    await publishVoicePresence({ handRaised: false, raisedAt: null, callPending: false });
    pendingGrant = null;
    closeVoiceGrantPrompt();
    await startCall(teacherUid, true);
  } catch (error) {
    showStatus(error.message || 'Mikrofon açılamadı', 'error');
  }
}

export async function rejectVoiceGrant() {
  pendingGrant = null;
  closeVoiceGrantPrompt();
  await publishVoicePresence({ handRaised: false, raisedAt: null, callPending: false }).catch(() => {});
  renderVoiceUi();
}

export async function grantVoice(uid) {
  if (!isTeacher() || !uid) return;
  try {
    await sendSignal(uid, 'grant');
    await startCall(uid, false);
    showStatus('Ses görüşmesi kabul edildi; bağlantı kuruluyor.', 'success');
  } catch (error) {
    showStatus(error.message || 'Ses görüşmesi kabul edilemedi', 'error');
  }
}

export function muteVoiceUser(uid, muted = true) {
  if (!isTeacher() || !uid) return;
  sendSignal(uid, 'mute', { muted }).catch(error => showStatus(error.message || 'Mikrofon değiştirilemedi', 'error'));
}

export function muteAllVoice() {
  if (!isTeacher()) return;
  voiceRoster.filter(item => item.role === 'ogrenci' && item.uid !== me()?.uid)
    .forEach(item => muteVoiceUser(item.uid, true));
}

export function toggleLocalVoiceMute() {
  if (!localStream) {
    getLocalStream().then(() => setLocalMuted(false)).catch(error => showStatus(error.message || 'Mikrofon açılamadı', 'error'));
    return;
  }
  setLocalMuted(!localMuted());
}

export function leaveVoiceCall(uid) {
  if (uid) closePeer(uid);
  else peers.forEach((_, peerUid) => closePeer(peerUid));
}

export async function playVoiceAudio() {
  try {
    await Promise.all(Array.from(remoteAudio.values()).map(audio => {
      audio.muted = false;
      audio.volume = 1;
      return audio.play?.();
    }));
    voicePlaybackBlocked = false;
    closeVoicePlaybackPrompt();
  } catch (error) {
    voicePlaybackBlocked = true;
    renderVoicePlaybackPrompt();
    showStatus('Tarayıcı sesi başlatamadı. Sayfaya bir kez dokunup tekrar dene.', 'error');
  }
}

export function voiceSelfPanel() {
  const user = me();
  if (!user) return '';
  const queue = queueForVoice();
  const queued = queue.some(item => item.uid === user.uid);
  const muteText = localMuted() ? 'Mikrofonu Aç' : 'Mikrofonu Kapat';
  const status = voiceReady ? 'ses hazır' : 'ses kapalı';
  if (isTeacher()) {
    return `<div class="voice-self-panel">
      <div><b>Sesli Konuşma</b><span>${queued ? 'talep gönderildi' : esc(status)}${queue.length ? ` · ${queue.length} el` : ''}</span></div>
      <button onclick="raiseHandForVoice()" ${queued || !voiceReady ? 'disabled' : ''} title="Karşı taraftan sesli konuşma talep et">${queued ? 'Talep Gönderildi' : '✋ Ses Talep Et'}</button>
      ${'Notification' in window && Notification.permission !== 'granted' ? '<button onclick="requestEduNotificationPermission()" title="El kaldırma bildirimlerini aç">Bildirim Aç</button>' : ''}
      <button onclick="muteAllVoice()" title="Tüm öğrencilerin mikrofonunu kapat">Toplu Sustur</button>
    </div>`;
  }
  if (pendingGrant) {
    return `<div class="voice-self-panel voice-call-pending">
      <div><b>Sesli Konuşma</b><span>${esc(pendingGrant.name)} çağırıyor</span></div>
      <button onclick="acceptVoiceGrant()" title="Mikrofon izni verip konuşmayı başlat">Kabul Et</button>
      <button onclick="rejectVoiceGrant()" title="Sesli konuşmayı reddet">Reddet</button>
    </div>`;
  }
  return `<div class="voice-self-panel">
    <div><b>Sesli Konuşma</b><span>${queued ? 'sırada bekliyor' : esc(status)}</span></div>
    <button onclick="raiseHandForVoice()" ${queued || !voiceReady ? 'disabled' : ''}>${queued ? 'Talep Gönderildi' : '✋ Ses Talep Et'}</button>
    <button onclick="toggleLocalVoiceMute()">${muteText}</button>
  </div>`;
}

export function voiceRosterControls(member, currentUser) {
  if (!member || !currentUser || member.uid === currentUser.uid) return '';
  const queue = queueForVoice();
  const isQueued = queue.some(item => item.uid === member.uid);
  const status = connectionLabel(member.uid);
  const muted = !!member.voice?.muted;
  if (!isTeacher()) return `<span class="voice-status">${esc(status)}</span>`;
  const acceptDisabled = isQueued ? '' : 'disabled';
  return `<div class="voice-controls">
    ${isQueued ? '<span class="voice-hand">✋</span>' : ''}
    <span class="voice-status">${esc(status)}</span>
    <button onclick="grantVoice('${esc(member.uid)}')" ${acceptDisabled} title="Ses görüşmesi talebini kabul et">Kabul Et</button>
    <button onclick="muteVoiceUser('${esc(member.uid)}',${muted ? 'false' : 'true'})">${muted ? 'Aç' : 'Sustur'}</button>
    <button onclick="leaveVoiceCall('${esc(member.uid)}')" title="Ses bağlantısını kapat">Kapat</button>
  </div>`;
}

function renderVoiceUi() {
  renderVoiceGrantPrompt();
  renderVoicePlaybackPrompt();
  window.renderCanliRoster?.();
}

window.voiceJoinRoom = voiceJoinRoom;
window.voiceLeaveRoom = voiceLeaveRoom;
window.voiceSelfPanel = voiceSelfPanel;
window.voiceRosterControls = voiceRosterControls;
window.raiseHandForVoice = raiseHandForVoice;
window.acceptVoiceGrant = acceptVoiceGrant;
window.rejectVoiceGrant = rejectVoiceGrant;
window.playVoiceAudio = playVoiceAudio;
window.grantVoice = grantVoice;
window.muteVoiceUser = muteVoiceUser;
window.muteAllVoice = muteAllVoice;
window.toggleLocalVoiceMute = toggleLocalVoiceMute;
window.leaveVoiceCall = leaveVoiceCall;
