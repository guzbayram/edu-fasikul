import { appState } from '../state/appState.js';
import { _getUserKey } from '../firebase/firestore.js';
import { db, doc, setDoc } from '../firebase/init.js';

const STORAGE_KEY = 'edu_debug_events_v1';
const MAX_EVENTS = 80;
const MAX_REPORT_EVENTS = 35;
const REPORT_COOLDOWN_MS = 8000;

let events = loadEvents();
let lastReportAt = 0;
let reportSeq = 0;

function loadEvents(){
  try{
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.slice(-MAX_EVENTS) : [];
  }catch(_e){
    return [];
  }
}

function saveEvents(){
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_EVENTS))); }
  catch(_e){}
}

function safe(value, depth=0){
  if(value == null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return value;
  if(depth > 2) return String(value);
  if(value instanceof Error) return {name:value.name, message:value.message, stack:String(value.stack || '').slice(0, 1200)};
  if(Array.isArray(value)) return value.slice(0, 12).map(v=>safe(v, depth+1));
  if(typeof value === 'object'){
    const out = {};
    Object.keys(value).slice(0, 24).forEach(k=>{
      if(/password|sifre|token|secret|apiKey/i.test(k)) return;
      try{ out[k] = safe(value[k], depth+1); }catch(_e){}
    });
    return out;
  }
  return String(value);
}

function context(){
  const fas = appState.aktifFasikul || {};
  const ders = appState.aktifDers || {};
  const user = appState.user || {};
  return {
    role: user.role || '',
    email: user.email || '',
    dersId: ders.id || '',
    fasikulId: fas.id || '',
    fasikulAd: fas.ad || '',
    altKonuId: appState.aktifAltKonu?.id || '',
    page: appState.currentPage || 1,
    zoom: appState.zoom || 100,
    liveSession: !!appState.liveSession,
    watchMode: !!appState.watchMode,
    sharedBoard: !!appState.sharedBoard,
    hidden: !!document.hidden,
    online: navigator.onLine,
    url: location.pathname + location.search + location.hash
  };
}

function device(){
  return {
    ua: navigator.userAgent,
    platform: navigator.platform || '',
    language: navigator.language || '',
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: window.devicePixelRatio || 1,
    touch: navigator.maxTouchPoints || 0
  };
}

function pushEvent(level, type, data={}){
  const item = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
    iso: new Date().toISOString(),
    level,
    type,
    data: safe(data),
    context: context()
  };
  events.push(item);
  events = events.slice(-MAX_EVENTS);
  saveEvents();
  window.dispatchEvent(new CustomEvent('edu-debug-event', {detail:item}));
  return item;
}

async function sendReport(reason, details={}, options={}){
  const now = Date.now();
  if(!options.force && now - lastReportAt < REPORT_COOLDOWN_MS) return false;
  lastReportAt = now;
  const uid = _getUserKey();
  if(!uid || !window._firestoreReady) return false;
  const id = `${now}_${++reportSeq}`;
  const payload = {
    reason,
    details: safe(details),
    createdAt: new Date().toISOString(),
    createdAtMs: now,
    uid,
    user: {
      email: appState.user?.email || '',
      role: appState.user?.role || '',
      name: appState.user?.name || ''
    },
    context: context(),
    device: device(),
    events: events.slice(-MAX_REPORT_EVENTS)
  };
  try{
    await setDoc(doc(db, 'kullanicilar', uid, 'debugLogs', id), payload);
    pushEvent('info', 'debug.report.sent', {reason, id});
    return true;
  }catch(error){
    pushEvent('warn', 'debug.report.failed', {reason, error});
    return false;
  }
}

function installGlobalHandlers(){
  window.addEventListener('error', event=>{
    const err = event.error || {};
    pushEvent('error', 'window.error', {
      message: event.message,
      source: event.filename,
      line: event.lineno,
      column: event.colno,
      error: err
    });
    sendReport('window.error', {message:event.message, source:event.filename, line:event.lineno, column:event.colno}).catch(()=>{});
  });
  window.addEventListener('unhandledrejection', event=>{
    pushEvent('error', 'promise.unhandled', {reason:event.reason});
    sendReport('promise.unhandled', {reason:event.reason}).catch(()=>{});
  });
  window.addEventListener('online', ()=>pushEvent('info', 'network.online'));
  window.addEventListener('offline', ()=>{
    pushEvent('warn', 'network.offline');
    sendReport('network.offline').catch(()=>{});
  });
}

function exportDebugLog(){
  const blob = new Blob([JSON.stringify({exportedAt:new Date().toISOString(), device:device(), events}, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `edufasikul-debug-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
  window.showToast?.('Hata günlüğü indirildi', 'success');
}

function clearDebugLog(){
  events = [];
  saveEvents();
  window.showToast?.('Hata günlüğü temizlendi', 'info');
}

installGlobalHandlers();

window.debugLog = (type, data, level='info') => pushEvent(level, type, data);
window.debugReport = (reason, details, options) => sendReport(reason, details, options);
window.exportDebugLog = exportDebugLog;
window.clearDebugLog = clearDebugLog;
window.getDebugLog = () => events.slice();

export { pushEvent as debugLog, sendReport as debugReport, exportDebugLog, clearDebugLog };
