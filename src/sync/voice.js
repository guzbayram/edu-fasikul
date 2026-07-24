import { appState } from '../state/appState.js';
import { _getUserKey } from '../firebase/firestore.js';

const DEFAULT_SIGNALING_URL = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  ? 'http://localhost:3001'
  : '';
const SIGNALING_URL = window.EDU_VOICE_SIGNALING_URL || DEFAULT_SIGNALING_URL;
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

let socket = null;
let socketLoadPromise = null;
let localStream = null;
let roomId = '';
let voiceRoster = [];
let voiceQueue = [];
const peers = new Map();
const remoteAudio = new Map();

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

async function loadSocketClient() {
  if (window.io) return;
  if (!SIGNALING_URL) throw new Error('Signaling URL tanımlı değil.');
  if (!socketLoadPromise) {
    socketLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${SIGNALING_URL}/socket.io/socket.io.js`;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Socket.io client yüklenemedi.'));
      document.head.appendChild(script);
    });
  }
  await socketLoadPromise;
}

async function ensureSocket() {
  if (!SIGNALING_URL) throw new Error('Canlı ses için HTTPS destekli signaling sunucusu tanımlanmalı.');
  await loadSocketClient();
  if (socket?.connected) return socket;
  socket = window.io(SIGNALING_URL, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    timeout: 8000
  });

  socket.on('connect', () => {
    if (roomId) emitJoin(roomId);
    renderVoiceUi();
  });
  socket.on('disconnect', () => {
    renderVoiceUi();
    showStatus('Ses bağlantısı koptu; yeniden bağlanıyor.', 'info');
  });
  socket.on('voice:roster', list => {
    voiceRoster = Array.isArray(list) ? list : [];
    renderVoiceUi();
  });
  socket.on('voice:queue', list => {
    voiceQueue = Array.isArray(list) ? list : [];
    renderVoiceUi();
  });
  socket.on('voice:hand-raised', ({ name }) => {
    if (isTeacher()) {
      showStatus(`✋ ${name || 'Öğrenci'} konuşmak istiyor`, 'info');
      window.eduNotify?.('Öğrenci el kaldırdı', `${name || 'Öğrenci'} konuşmak istiyor`);
    }
  });
  socket.on('voice:granted', async ({ from, name }) => {
    showStatus(`${name || 'Öğretmen'} mikrofon izni verdi`, 'success');
    await startCall(from, true);
  });
  socket.on('voice:grant-sent', async ({ to }) => {
    await startCall(to, false);
  });
  socket.on('voice:signal', handleSignal);
  socket.on('voice:set-muted', ({ muted }) => setLocalMuted(!!muted, true));
  socket.on('voice:user-left', ({ uid }) => closePeer(uid));
  return socket;
}

function emitJoin(nextRoomId) {
  const user = me();
  if (!socket || !user || !nextRoomId) return;
  socket.emit('voice:join', { roomId: nextRoomId, user });
}

export async function voiceJoinRoom(nextRoomId) {
  const user = me();
  if (!user || !nextRoomId) return;
  roomId = String(nextRoomId);
  try {
    await ensureSocket();
    emitJoin(roomId);
  } catch (err) {
    console.warn('Ses signaling bağlantısı kurulamadı:', err);
    renderVoiceUi();
  }
}

export function voiceLeaveRoom() {
  if (socket?.connected) socket.emit('voice:leave');
  roomId = '';
  voiceRoster = [];
  voiceQueue = [];
  peers.forEach((_, uid) => closePeer(uid));
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
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
  publishStatus();
  return localStream;
}

function createPeer(uid) {
  closePeer(uid);
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  peers.set(uid, pc);
  pc.onicecandidate = event => {
    if (event.candidate) socket?.emit('voice:signal', { to: uid, type: 'ice', payload: event.candidate });
  };
  pc.ontrack = event => attachRemoteAudio(uid, event.streams[0]);
  pc.onconnectionstatechange = renderVoiceUi;
  pc.oniceconnectionstatechange = renderVoiceUi;
  return pc;
}

async function startCall(uid, makeOffer) {
  if (!uid) return;
  const s = await ensureSocket();
  const stream = await getLocalStream();
  const pc = createPeer(uid);
  stream.getTracks().forEach(track => pc.addTrack(track, stream));
  if (makeOffer) {
    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);
    s.emit('voice:signal', { to: uid, type: 'offer', payload: offer });
  }
  renderVoiceUi();
}

async function handleSignal({ from, type, payload }) {
  if (!from || !type) return;
  const stream = await getLocalStream();
  const pc = peers.get(from) || createPeer(from);
  if (!pc.getSenders().some(sender => sender.track?.kind === 'audio')) {
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
  }
  if (type === 'offer') {
    await pc.setRemoteDescription(new RTCSessionDescription(payload));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket?.emit('voice:signal', { to: from, type: 'answer', payload: answer });
  } else if (type === 'answer') {
    await pc.setRemoteDescription(new RTCSessionDescription(payload));
  } else if (type === 'ice' && payload) {
    await pc.addIceCandidate(new RTCIceCandidate(payload));
  }
  renderVoiceUi();
}

function attachRemoteAudio(uid, stream) {
  let audio = remoteAudio.get(uid);
  if (!audio) {
    audio = document.createElement('audio');
    audio.autoplay = true;
    audio.playsInline = true;
    audio.dataset.voiceUid = uid;
    audio.style.display = 'none';
    document.body.appendChild(audio);
    remoteAudio.set(uid, audio);
  }
  audio.srcObject = stream;
  audio.play?.().catch(() => showStatus('Ses başlatmak için ekrana bir kez dokunman gerekebilir.', 'info'));
}

function closePeer(uid) {
  const pc = peers.get(uid);
  if (pc) pc.close();
  peers.delete(uid);
  const audio = remoteAudio.get(uid);
  if (audio) audio.remove();
  remoteAudio.delete(uid);
  renderVoiceUi();
}

function setLocalMuted(muted, remoteCommand = false) {
  localStream?.getAudioTracks().forEach(track => { track.enabled = !muted; });
  publishStatus();
  renderVoiceUi();
  if (remoteCommand) showStatus(muted ? 'Mikrofon öğretmen tarafından kapatıldı' : 'Mikrofon açıldı', 'info');
}

function localMuted() {
  const track = localStream?.getAudioTracks?.()[0];
  return track ? !track.enabled : false;
}

function publishStatus() {
  socket?.emit('voice:status', { muted: localMuted(), speaking: false });
}

function connectionLabel(uid) {
  const pc = peers.get(uid);
  if (!socket?.connected) return 'bağlantı kesildi';
  if (!pc) return 'hazır';
  const state = pc.connectionState || pc.iceConnectionState;
  if (state === 'connected' || state === 'completed') return 'bağlı';
  if (state === 'failed' || state === 'disconnected') return 'zayıf sinyal';
  return state || 'bağlanıyor';
}

export function raiseHandForVoice() {
  ensureSocket().then(() => {
    socket.emit('voice:hand-raise');
    showStatus('El kaldırıldı; öğretmen izin verince mikrofon açılacak.', 'success');
  }).catch(err => showStatus(err.message || 'Ses bağlantısı kurulamadı', 'error'));
}

export function grantVoice(uid) {
  if (!isTeacher()) return;
  ensureSocket().then(() => socket.emit('voice:grant', { to: uid }));
}

export function muteVoiceUser(uid, muted = true) {
  if (!isTeacher()) return;
  socket?.emit('voice:mute-user', { uid, muted });
}

export function muteAllVoice() {
  if (!isTeacher()) return;
  socket?.emit('voice:mute-all');
}

export function toggleLocalVoiceMute() {
  setLocalMuted(!localMuted());
}

export function leaveVoiceCall(uid) {
  if (uid) closePeer(uid);
  else peers.forEach((_, peerUid) => closePeer(peerUid));
}

export function voiceSelfPanel() {
  const user = me();
  if (!user) return '';
  const queued = voiceQueue.some(item => item.uid === user.uid);
  const muteText = localMuted() ? 'Mikrofonu Aç' : 'Mikrofonu Kapat';
  const status = socket?.connected ? 'ses hazır' : 'ses kapalı';
  if (isTeacher()) {
    const waiting = voiceQueue.length;
    return `<div class="voice-self-panel">
      <div><b>Sesli Konuşma</b><span>${esc(status)}${waiting ? ` · ${waiting} el` : ''}</span></div>
      ${'Notification' in window && Notification.permission !== 'granted' ? '<button onclick="requestEduNotificationPermission()" title="El kaldırma bildirimlerini aç">Bildirim Aç</button>' : ''}
      <button onclick="muteAllVoice()" title="Tüm öğrencilerin mikrofonunu kapat">Toplu Sustur</button>
    </div>`;
  }
  return `<div class="voice-self-panel">
    <div><b>Sesli Konuşma</b><span>${queued ? 'sırada bekliyor' : esc(status)}</span></div>
    <button onclick="raiseHandForVoice()" ${queued ? 'disabled' : ''}>${queued ? 'El Kaldırıldı' : '✋ El Kaldır'}</button>
    <button onclick="toggleLocalVoiceMute()">${muteText}</button>
  </div>`;
}

export function voiceRosterControls(member, currentUser) {
  if (!member || !currentUser || member.uid === currentUser.uid) return '';
  const isQueued = voiceQueue.some(item => item.uid === member.uid);
  const status = connectionLabel(member.uid);
  const muted = !!voiceRoster.find(item => item.uid === member.uid)?.muted;
  if (!isTeacher()) return `<span class="voice-status">${esc(status)}</span>`;
  return `<div class="voice-controls">
    ${isQueued ? '<span class="voice-hand">✋</span>' : ''}
    <span class="voice-status">${esc(status)}</span>
    <button onclick="grantVoice('${esc(member.uid)}')" title="Öğrenciye konuşma izni ver">Konuş</button>
    <button onclick="muteVoiceUser('${esc(member.uid)}',${muted ? 'false' : 'true'})">${muted ? 'Aç' : 'Sustur'}</button>
    <button onclick="leaveVoiceCall('${esc(member.uid)}')" title="Ses bağlantısını kapat">Kapat</button>
  </div>`;
}

function renderVoiceUi() {
  window.renderCanliRoster?.();
}

window.voiceJoinRoom = voiceJoinRoom;
window.voiceLeaveRoom = voiceLeaveRoom;
window.voiceSelfPanel = voiceSelfPanel;
window.voiceRosterControls = voiceRosterControls;
window.raiseHandForVoice = raiseHandForVoice;
window.grantVoice = grantVoice;
window.muteVoiceUser = muteVoiceUser;
window.muteAllVoice = muteAllVoice;
window.toggleLocalVoiceMute = toggleLocalVoiceMute;
window.leaveVoiceCall = leaveVoiceCall;
