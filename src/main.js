// ═══════════════════════════════════════════════════════════
// EduFasikül — Faz 2: Core Modüller (State + Firebase + Sync)
// ═══════════════════════════════════════════════════════════

import './styles.css';

// ─── Core modüller ───────────────────────────────────────
import { appState } from './state/appState.js';
import './firebase/init.js';
import {
  doLogin, doLogout, doGuest, enterApp,
  addKullanici, deleteKullanici, loadKullaniciList,
  toggleKullaniciActive, resetKullaniciPassword,
  selectManagedStudent, refreshAssignTopicOptions,
  createAssignment, updateAssignment, deleteAssignment, loadMyAssignments,
  refreshEditAssignmentTopicOptions,
  refreshPlanFasikulOptions, refreshPlanTopicOptions, prefillStudyPlanSlot, openStudyPlanModal, closeStudyPlanModal, shiftStudyPlanWeek, changeStudyPlanWeek,
  createStudyPlanSlot, clearStudyPlanSlot, dragStudyPlanSlot, dropStudyPlanSlot, startResizeStudyPlanSlot, approveStudyPlanChanges, loadMyStudyPlan,
  toggleTeacherAssignField, toggleUserFasikulVisibility, applyUserFasikulVisibility,
  ADMIN_EMAIL
} from './firebase/auth.js';
import {
  persistData, loadPersistedData, loadFromFirestore,
  persistDrawingCloud, deleteDrawingCloud, scheduleCloudPersist, flushCloudPersist,
  getDashboardStats, getAnsweredRecords, _hesaplaIstatistik,
  _canonicalAnswerKey, _getUserKey,
  addHataliCloud, removeHataliCloud, migrateHatalilarToSubcollection
} from './firebase/firestore.js';
import { startRealtimeSync, stopRealtimeSync, toggleLiveSession, publishCanli, watchStudentLive, stopWatchStudent } from './sync/realtime.js';
import { startCanliPresence, stopCanliPresence, publishCanliPresence, publishCanliPresenceDraw, toggleCanliRoster, followCanliMember, unfollowCanliMember, toggleSharedBoard, refreshSharedBoard } from './sync/livepresence.js';

// ─── Faz 3 Modülleri ────────────────────────────────────
import './pdf/storage.js';
import './pdf/render.js';
import './drawing/canvas.js';
import './drawing/tools.js';
import './reader/index.js';
import './reader/toolbar.js';
import './reader/panel.js';
import './reader/solve.js';

// ─── Faz 4 Modülleri ────────────────────────────────────
import './ui/toast.js';
import './ui/tooltip.js';
import './ui/router.js';
import './ui/onboarding.js';
import './ui/viewportfix.js';
import './panels/dashboard.js';
import './panels/hatalilar.js';
import './panels/profil.js';
import './panels/admin.js';

// ─── PDF.js ──────────────────────────────────────────────
// Worker CDN'den (cdnjs) değil, npm paketinden bundle'lanıp aynı origin'den
// servis ediliyor — cdnjs erişilemez/engelliyse "Setting up fake worker
// failed" hatasıyla PDF yüklemesi tamamen kırılmasın.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.js?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
window.pdfjsLib = pdfjsLib;

// ─── Fabric.js ───────────────────────────────────────────
import { fabric } from 'fabric';
window.fabric = fabric;

// ─── Chart.js ────────────────────────────────────────────
import Chart from 'chart.js/auto';
window.Chart = Chart;

// ═══════════════════════════════════════════════════════════
// ANA UYGULAMA KODU (orijinal index.html satır 3069-9341)
// ═══════════════════════════════════════════════════════════

// ══════════════════════════════
// ══════════════════════════════
// GITHUB JSON KAYNAK KONFİGÜRASYONU
// ══════════════════════════════
const GITHUB_CONFIG_KEY = 'edu_github_config';
function getGithubConfig(){
  const defaultConfig = { repo: 'guzbayram/edu-fasikul', branch: 'main', path: '' };
  try{
    const saved = localStorage.getItem(GITHUB_CONFIG_KEY);
    if(saved){
      const parsed=JSON.parse(saved);
      // Eski sürümde boş kaydedilmiş ayarlar yerine uygulamanın kendi
      // GitHub kataloğunu otomatik kullan.
      if(parsed?.repo) return parsed;
    }
  }catch(e){}
  return defaultConfig;
}
function setGithubConfig(cfg){
  localStorage.setItem(GITHUB_CONFIG_KEY, JSON.stringify(cfg));
}
function buildGithubRawUrl(filename){
  const cfg = getGithubConfig();
  return buildGithubRawUrlForName(cfg, filename);
}
function buildGithubRawUrlForName(cfg, filename){
  if(!cfg.repo){
    // Repo ayarlanmamış: relative path kullan (local / aynı sunucu)
    const p = (cfg.path || '').replace(/\/$/,'');
    return p ? `${p}/${encodeURIComponent(filename)}` : encodeURIComponent(filename);
  }
  const branch = cfg.branch || 'main';
  const path = (cfg.path || '').replace(/^\/+|\/+$/g,'');
  const filePart = path ? `${path}/${encodeURIComponent(filename)}` : encodeURIComponent(filename);
  return `https://raw.githubusercontent.com/${cfg.repo}/${branch}/${filePart}`;
}
function onGithubRepoInput(){
  const repo = document.getElementById('githubRepoInput')?.value?.trim() || '';
  const branch = document.getElementById('githubBranchInput')?.value?.trim() || 'main';
  const path = document.getElementById('githubPathInput')?.value?.trim() || '';
  const hint = document.getElementById('githubConfigHint');
  if(hint && repo){
    const sample = buildGithubRawUrlFromParts(repo, branch, path, 'ornek.json');
    hint.textContent = 'Örnek URL: ' + sample;
  } else if(hint){ hint.textContent = ''; }
}
function buildGithubRawUrlFromParts(repo, branch, path, filename){
  const normFile = (filename||'').normalize('NFC');
  if(!repo) return path ? path.replace(/\/$/,'') + '/' + normFile : normFile;
  const b = branch || 'main';
  const p = (path||'').replace(/^\/+|\/+$/g,'');
  const fp = p ? `${p}/${normFile}` : normFile;
  return `https://raw.githubusercontent.com/${repo}/${b}/${fp}`;
}
async function saveGithubConfig(){
  const repo = document.getElementById('githubRepoInput')?.value?.trim() || '';
  const branch = document.getElementById('githubBranchInput')?.value?.trim() || 'main';
  const path = document.getElementById('githubPathInput')?.value?.trim() || '';
  setGithubConfig({ repo, branch, path });
  bundledSourceCache.clear(); // Cache'i temizle — yeni URL'den tekrar çekilsin
  const statusEl = document.getElementById('githubConfigStatus');
  if(statusEl){ statusEl.textContent = '⏳ Test ediliyor…'; statusEl.style.color='var(--yellow)'; }
  // Test: ilk kaynağı çekmeyi dene
  const firstSrc = BUNDLED_FASIKUL_SOURCES[0];
  if(firstSrc){
    try{
      const url = buildGithubRawUrl(firstSrc.json);
      const r = await fetch(url);
      if(r.ok){
        const data = await r.json();
        bundledSourceCache.set(firstSrc.json, data);
        if(statusEl){ statusEl.textContent = '✓ Bağlantı başarılı'; statusEl.style.color='var(--green)'; }
      } else {
        if(statusEl){ statusEl.textContent = `✗ HTTP ${r.status}`; statusEl.style.color='var(--red)'; }
      }
    }catch(e){
      if(statusEl){ statusEl.textContent = `✗ ${e.message}`; statusEl.style.color='var(--red)'; }
    }
  } else {
    if(statusEl){ statusEl.textContent = '✓ Kaydedildi'; statusEl.style.color='var(--green)'; }
  }
  // Kütüphaneyi yenile
  await loadBundledFasikuller();
  renderDerslerGrid();
  showToast('GitHub ayarları kaydedildi ✓','success');
}
function initGithubConfigUI(){
  const cfg = getGithubConfig();
  const ri = document.getElementById('githubRepoInput');
  const bi = document.getElementById('githubBranchInput');
  const pi = document.getElementById('githubPathInput');
  if(ri) ri.value = cfg.repo || '';
  if(bi) bi.value = cfg.branch || 'main';
  if(pi) pi.value = cfg.path || '';
  onGithubRepoInput();
}

// ══════════════════════════════
// MANIFEST DATA  (konular JSON yükleme ile gelir)
// ══════════════════════════════
const MANIFEST = {
  dersler: [
    {
      id:'mat', ad:'Matematik', ikon:'🔢', renk:'var(--mat)', progPct:42,
      fasikuller:[
        { id:'analitik-duzlem', ad:'Analitik Düzlem', thumb:'📐', thumbBg:'linear-gradient(135deg,#312e81,#1e1b4b)', sinif:10, konuSayisi:7, soruSayisi:66, progPct:45, sonCalisma:'2 saat önce', konular:[] },
        { id:'tyt-matematik', ad:'3 Adımda TYT Matematik', thumb:'📊', thumbBg:'linear-gradient(135deg,#1e1b4b,#312e81)', sinif:12, konuSayisi:34, soruSayisi:1061, progPct:0, sonCalisma:'—', konular:[] },
        { id:'limit-turev', ad:'Limit ve Türev', thumb:'📉', thumbBg:'linear-gradient(135deg,#1e1b4b,#0c4a6e)', sinif:12, konuSayisi:5, soruSayisi:48, progPct:20, sonCalisma:'2 gün önce', konular:[] }
      ]
    },
    { id:'bio', ad:'Biyoloji', ikon:'🧬', renk:'var(--bio)', progPct:15, fasikuller:[
      { id:'bio-1', ad:'Hücre Biyolojisi', thumb:'🔬', thumbBg:'linear-gradient(135deg,#431407,#450a0a)', sinif:10, konuSayisi:1, soruSayisi:20, progPct:15, sonCalisma:'1 hafta önce', konular:[] }
    ]},
    { id:'fiz', ad:'Fizik', ikon:'⚡', renk:'var(--fiz)', progPct:28, fasikuller:[
      { id:'fiz-1', ad:'Kuvvet ve Hareket', thumb:'🌀', thumbBg:'linear-gradient(135deg,#164e63,#0c4a6e)', sinif:10, konuSayisi:1, soruSayisi:40, progPct:28, sonCalisma:'3 gün önce', konular:[] }
    ]},
    { id:'tar', ad:'Tarih', ikon:'🏛️', renk:'var(--tar)', progPct:33, fasikuller:[
      { id:'tar-1', ad:'Osmanlı Kuruluş', thumb:'📜', thumbBg:'linear-gradient(135deg,#500724,#2d1657)', sinif:10, konuSayisi:1, soruSayisi:35, progPct:33, sonCalisma:'4 gün önce', konular:[] }
    ]},
    { id:'kim', ad:'Kimya', ikon:'🧪', renk:'var(--kim)', progPct:60, fasikuller:[
      { id:'kim-1', ad:'Atom ve Periyodik Tablo', thumb:'⚗️', thumbBg:'linear-gradient(135deg,#064e3b,#052e16)', sinif:10, konuSayisi:1, soruSayisi:28, progPct:60, sonCalisma:'1 gün önce', konular:[] }
    ]},
    { id:'edb', ad:'Edebiyat', ikon:'📖', renk:'var(--edb)', progPct:55, fasikuller:[
      { id:'siir', ad:'Şiir Türleri', thumb:'📝', thumbBg:'linear-gradient(135deg,#2e1065,#1a0533)', sinif:10, konuSayisi:2, soruSayisi:22, progPct:55, sonCalisma:'5 saat önce', konular:[] }
    ]}
  ]
};

// Eski demo sürümünden kalan, gerçek PDF/JSON kaynağı olmayan kartlar.
// Kullanıcının sonradan oluşturduğu dersler bu listede olmadığı için korunur.
const LEGACY_DEMO_DERS_IDS = new Set(['bio','fiz','tar','kim','edb']);
const LEGACY_DEMO_FASIKUL_IDS = new Set(['analitik-duzlem','tyt-matematik','limit-turev']);
MANIFEST.dersler = MANIFEST.dersler
  .filter(d=>!LEGACY_DEMO_DERS_IDS.has(d.id))
  .map(d=>({...d,fasikuller:(d.fasikuller||[]).filter(f=>!LEGACY_DEMO_FASIKUL_IDS.has(f.id))}));

// Depoyla birlikte gelen fasikül kaynakları. JSON otomatik yüklenir;
// PDF aynı adla kullanıcının profilden bağladığı klasörden okunur.
const BUNDLED_DERS_CONFIG = {
  mat: { ad:'Matematik', ikon:'🔢', renk:'var(--mat)' },
  geo: { ad:'Geometri', ikon:'📐', renk:'var(--kim)' },
  tyt: { ad:'TYT Denemeleri', ikon:'📝', renk:'var(--edb)' }
};
const BUNDLED_FASIKUL_SOURCES = [
  {id:'lgs-matematik',dersId:'mat',json:'0-lgs_matematik-kart.json',pdf:'0-lgs_matematik-kart.pdf'},
  {id:'ucgen-akademi-1',dersId:'mat',json:'1-1-Üçgen Akademi-1.fasikül-kart.json',pdf:'1-1-Üçgen Akademi-1.fasikül-kart.pdf'},
  {id:'ucgen-akademi-2',dersId:'mat',json:'1-2-Üçgen Akademi-2.fasikül-kart.json',pdf:'1-2-Üçgen Akademi-2.fasikül-kart.pdf'},
  {id:'ucgen-akademi-3',dersId:'mat',json:'1-3-Üçgen Akademi-3.fasikül-kart.json',pdf:'1-3-Üçgen Akademi-3.fasikül-kart.pdf'},
  {id:'ucgen-akademi-4',dersId:'mat',json:'1-4-Üçgen Akademi-4.fasikül-kart.json',pdf:'1-4-Üçgen Akademi-4.fasikül-kart.pdf'},
  {id:'ucgen-akademi-5',dersId:'mat',json:'1-5-Üçgen Akademi-5.fasikül-kart.json',pdf:'1-5-Üçgen Akademi-5.fasikül-kart.pdf'},
  {id:'tyt-matematik-ozet',dersId:'mat',json:'1-Matematik-Ozet-Tyt-kart.json',pdf:'1-Matematik-Ozet-Tyt-kart.pdf'},
  {id:'tyt-matematik-vsc',dersId:'mat',json:'10-tyt-mat-vsc-testleri-kart.json',pdf:'10-tyt-mat-vsc-testleri-kart.pdf'},
  {id:'tyt-cikmis-sorular',dersId:'mat',json:'11-tyt-cıkmış-sorular-2018-2025-kart.json',pdf:'11-tyt-cıkmış-sorular-2018-2025-kart.pdf'},
  {id:'tyt-matematik-soru-bankasi',dersId:'mat',json:'2-tyt-matematik-soru-bankası-kart.json',pdf:'2-tyt-matematik-soru-bankası-kart.pdf'},
  {id:'tyt-geometri-soru-bankasi',dersId:'geo',json:'3-tyt-geometri-soru-bankası-kart.json',pdf:'3-tyt-geometri-soru-bankası-kart.pdf'},
  {id:'tyt-matematik-tarama',dersId:'mat',json:'4-tyt-mat-tarama-testleri-kart.json',pdf:'4-tyt-mat-tarama-testleri-kart.pdf'},
  {id:'uc-adim-tyt-matematik',dersId:'mat',json:'5-uc-adim-tyt-matematik-kartjson.json',pdf:'5-uc-adim-tyt-matematik-kart.pdf'},
  {id:'uc-adim-deneme-tyt-15',dersId:'tyt',json:'6-uc-adim-deneme-tyt-15-cards.json',pdf:'6-uc-adim-deneme-tyt-15-cards.pdf'},
  {id:'tyt-kampi-tum-dersler',dersId:'tyt',json:'7-tyt-kampi-tum-dersler-kart.json',pdf:'7-tyt-kampi-tum-dersler-kart.pdf'},
  {id:'tyt-denemeleri-1',dersId:'tyt',json:'8-tyt-denemeleri-1-cards.json',pdf:'8-tyt-denemeleri-1-cards.pdf'},
  {id:'tyt-denemeleri-2',dersId:'tyt',json:'9-tyt-denemeleri-2-cards.json',pdf:'9-tyt-denemeleri-2-cards.pdf'},
  {id:'matematik-destek',dersId:'mat',json:'12-Matematik (Destek).json',pdf:'12-Matematik (Destek).pdf',type:'video'},
  {id:'mof-9-matematik-1',dersId:'mat',json:'Möf-9.Sınıf-Matematik-1.Fasikül.json',pdf:'Möf-9.Sınıf-Matematik-1.Fasikül.pdf'},
  {id:'mof-9-matematik-2',dersId:'mat',json:'Möf-9.Sınıf-Matematik-2.Fasikül.json',pdf:'Möf-9.Sınıf-Matematik-2.Fasikül.pdf'},
  {id:'mof-9-matematik-3',dersId:'mat',json:'15-Möf - 9.Sınıf-Matematik-3.Fasikül.json',pdf:'15-Möf - 9.Sınıf-Matematik-3.Fasikül.pdf'},
  {id:'mof-9-matematik-4',dersId:'mat',json:'16-Möf - 9.Sınıf-Matematik-4.Fasikül.json',pdf:'16-Möf - 9.Sınıf-Matematik-4.Fasikül.pdf'},
  {id:'yaricap-tyt-problemler',dersId:'mat',json:'26-Yarıçap - Tyt-Problemler Fasikülü.json',pdf:'26-Yarıçap - Tyt-Problemler Fasikülü.pdf'},
  {id:'yaricap-10-matematik-1',dersId:'mat',json:'27-Yarıçap - 10.Sınıf-Matematik-1.Fasikul.json',pdf:'27-Yarıçap - 10.Sınıf-Matematik-1.Fasikul.pdf'},
  {id:'yaricap-10-matematik-2',dersId:'mat',json:'28-Yarıçap - 10.Sınıf-Matematik-2.Fasikul.json',pdf:'28-Yarıçap - 10.Sınıf-Matematik-2.Fasikul.pdf'},
  {id:'aktif-matematik-acik-uclu',dersId:'mat',json:'17-Aktif - Matematik Açık Uçlu.json',pdf:'17-Aktif - Matematik Açık Uçlu.pdf'},
  {id:'aktif-tyt-matematik-1',dersId:'mat',json:'18-Aktif - Tyt Matematik Fasikül 1.json',pdf:'18-Aktif - Tyt Matematik Fasikül 1.pdf'},
  {id:'aktif-tyt-matematik-2',dersId:'mat',json:'19-Aktif - Tyt Matematik Fasikül 2.json',pdf:'19-Aktif - Tyt Matematik Fasikül 2.pdf'},
  {id:'kuvvetlendiren-tyt-soru-bankasi-2025',dersId:'mat',json:'23-Aktif - Tyt-Soru-Bankası-2025.json',pdf:'23-Aktif - Tyt-Soru-Bankası-2025.pdf'},
  {id:'aktif-tyt-matematik-3',dersId:'mat',json:'20-Aktif - Tyt Matematik Fasikül 3.json',pdf:'20-Aktif - Tyt Matematik Fasikül 3.pdf'}
];

const CUSTOM_GITHUB_FASIKUL_SOURCES_KEY = 'edu_custom_github_fasikul_sources';
function safeParseCustomGithubSources(){
  try{
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_GITHUB_FASIKUL_SOURCES_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(s=>s?.id && s?.dersId && s?.json && s?.pdf) : [];
  }catch(e){ return []; }
}
function mergeCustomGithubSources(){
  const norm = v => String(v||'').normalize('NFC');
  safeParseCustomGithubSources().forEach(source=>{
    // json'u NFC ile karşılaştır: sabit kaynak NFC, form girdisi NFD olabilir →
    // aksi halde aynı fasikül iki ayrı kaynak olarak eklenip çift kart oluşturur.
    const existingIndex = BUNDLED_FASIKUL_SOURCES.findIndex(s=>s.id===source.id || norm(s.json)===norm(source.json));
    if(existingIndex >= 0) BUNDLED_FASIKUL_SOURCES[existingIndex] = {...BUNDLED_FASIKUL_SOURCES[existingIndex], ...source, custom:true};
    else BUNDLED_FASIKUL_SOURCES.push({...source, custom:true});
  });
}
function saveCustomGithubSource(source){
  const sources = safeParseCustomGithubSources();
  const clean = {
    id: source.id,
    dersId: source.dersId,
    json: source.json,
    pdf: source.pdf,
    type: source.type || undefined,
    fasikulTip: source.fasikulTip || undefined,
    custom: true
  };
  const existingIndex = sources.findIndex(s=>s.id===clean.id || s.json===clean.json);
  if(existingIndex >= 0) sources[existingIndex] = clean;
  else sources.push(clean);
  localStorage.setItem(CUSTOM_GITHUB_FASIKUL_SOURCES_KEY, JSON.stringify(sources));
  mergeCustomGithubSources();
  return clean;
}
// Bir özel (custom) GitHub kaynağını localStorage'dan ve bellekten kaldır.
// Böylece silinen fasikül sonraki açılışta merge ile geri gelmez.
function removeCustomGithubSource(fasikulId, jsonFile){
  const jn = String(jsonFile||'').normalize('NFC');
  const sources = safeParseCustomGithubSources()
    .filter(s => s.id!==fasikulId && String(s.json||'').normalize('NFC')!==jn);
  localStorage.setItem(CUSTOM_GITHUB_FASIKUL_SOURCES_KEY, JSON.stringify(sources));
  for(let i=BUNDLED_FASIKUL_SOURCES.length-1;i>=0;i--){
    const s=BUNDLED_FASIKUL_SOURCES[i];
    if(s.custom && (s.id===fasikulId || String(s.json||'').normalize('NFC')===jn))
      BUNDLED_FASIKUL_SOURCES.splice(i,1);
  }
}
// Sabit (kod içi) bir fasikülü kalıcı gizlemek için bastırma listesi.
const DELETED_BUNDLED_IDS_KEY = 'edu_deleted_bundled_ids';
function getDeletedBundledIds(){
  try{ return new Set(JSON.parse(localStorage.getItem(DELETED_BUNDLED_IDS_KEY)||'[]')); }
  catch(e){ return new Set(); }
}
function addDeletedBundledId(id){
  const s=getDeletedBundledIds(); s.add(id);
  localStorage.setItem(DELETED_BUNDLED_IDS_KEY, JSON.stringify([...s]));
}
// Bastırılmış bir fasikülü geri getir (ör. tekrar eklenince) — aksi halde
// loadBundledFasikuller onu bir daha yüklemez ve sayaçlar 0 kalır.
function removeDeletedBundledId(id){
  const s=getDeletedBundledIds();
  if(s.delete(id)) localStorage.setItem(DELETED_BUNDLED_IDS_KEY, JSON.stringify([...s]));
}
window.removeDeletedBundledId = removeDeletedBundledId;

// ── Per-ders silme tombstone'u ──────────────────────────────────────────────
// Bir fasikülü belirli bir DERSTEN silince, o (ders,fasikül) çifti burada
// "kalıcı silinmiş" işaretlenir. loadManifestMeta / loadBundledFasikuller ve
// bulut manifest'i geri yüklendikten sonra bu liste FİLTRE olarak uygulanır.
// Böylece eski (bayat) yerel/bulut meta'sı fasikülü o derse geri EKLESE bile
// anında düşürülür — "matematikten siliyorum, redeploy'da geri geliyor" kökü.
const DERS_REMOVED_KEY = 'edu_removed_from_ders';
const _normNFC = v => String(v||'').normalize('NFC');
function getDersRemovals(){
  try{ return new Set(JSON.parse(localStorage.getItem(DERS_REMOVED_KEY)||'[]')); }catch(e){ return new Set(); }
}
function recordDersRemoval(dersId, fasId, jsonFile){
  if(!dersId || !fasId) return;
  const s = getDersRemovals();
  s.add(dersId+' '+fasId);
  if(jsonFile) s.add(dersId+' j:'+_normNFC(jsonFile));
  try{ localStorage.setItem(DERS_REMOVED_KEY, JSON.stringify([...s])); }catch(e){}
}
function clearDersRemoval(dersId, fasId, jsonFile){
  if(!dersId || !fasId) return;
  const s = getDersRemovals();
  let changed = s.delete(dersId+' '+fasId);
  if(jsonFile) changed = s.delete(dersId+' j:'+_normNFC(jsonFile)) || changed;
  if(changed){ try{ localStorage.setItem(DERS_REMOVED_KEY, JSON.stringify([...s])); }catch(e){} }
}
function applyDersRemovals(){
  const rem = getDersRemovals();
  if(!rem.size) return;
  for(const d of MANIFEST.dersler){
    d.fasikuller = (d.fasikuller||[]).filter(f=>{
      if(rem.has(d.id+' '+f.id)) return false;
      if(f.jsonFile && rem.has(d.id+' j:'+_normNFC(f.jsonFile))) return false;
      return true;
    });
  }
}
window.recordDersRemoval = recordDersRemoval;
window.clearDersRemoval = clearDersRemoval;
window.applyDersRemovals = applyDersRemovals;

// Bir fasikül BİR dersten çıkarıldığında: başka derste hâlâ varsa hiçbir şey yapma.
// Hiçbir derste kalmadıysa (yetim) → custom kaynağı kaldır + sabit kaynaksa bastır,
// ki loadBundledFasikuller onu varsayılan derse geri tohumlamasın.
function suppressBundledIfOrphan(fasId, jsonFile){
  const norm=v=>String(v||'').normalize('NFC');
  const jn=norm(jsonFile);
  const stillExists = MANIFEST.dersler.some(d=>(d.fasikuller||[]).some(f=>f.id===fasId || (jn && norm(f.jsonFile)===jn)));
  if(stillExists) return false;
  removeCustomGithubSource(fasId, jsonFile);
  if(BUNDLED_FASIKUL_SOURCES.some(s=>!s.custom && (s.id===fasId || (jn && norm(s.json)===jn)))) addDeletedBundledId(fasId);
  return true;
}
window.suppressBundledIfOrphan = suppressBundledIfOrphan;
// Admin: fasikülü kütüphaneden sil (manifest + custom kaynak + gerekiyorsa bastır).
function deleteFasikul(dersId, fasikulId){
  if(appState.user?.role!=='admin'){ showToast('Bu işlem sadece admin için açık','error'); return; }
  const ders=MANIFEST.dersler.find(d=>d.id===dersId);
  const fas=ders?.fasikuller.find(f=>f.id===fasikulId);
  if(!ders||!fas) return;
  if(!confirm(`"${fas.ad}" fasikülü kütüphaneden silinecek. Emin misiniz?`)) return;
  if(fas.type === 'folder' && fas.childDersId){
    const child = MANIFEST.dersler.find(d=>d.id===fas.childDersId);
    if(child) delete child.parentDersId;
  }
  const jsonFile=fas.jsonFile;
  ders.fasikuller = ders.fasikuller.filter(f=>f.id!==fasikulId);
  recordDersRemoval(dersId, fasikulId, jsonFile);   // bu dersten kalıcı sil
  // Yalnız hiçbir derste kalmadıysa bastır (başka derste duruyorsa dokunma).
  suppressBundledIfOrphan(fasikulId, jsonFile);
  persistManifest();
  renderFasikulCards(visibleFasikullerFor(ders), ders);
  renderDerslerGrid();
  showToast('Fasikül silindi ✓','success');
}
window.deleteFasikul = deleteFasikul;
mergeCustomGithubSources();

// Demo verilerinin orijinal anlık görüntüsü (Demo Verileri açma/kapama ve sıfırlama için)
const DEMO_SNAPSHOT = MANIFEST.dersler.map(d=>({
  id:d.id, progPct:d.progPct,
  fasikuller: d.fasikuller.map(f=>({ id:f.id, progPct:f.progPct, sonCalisma:f.sonCalisma }))
}));



// ══════════════════════════════
// INIT
// ══════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  // Yeni standartları mevcut cihazlara da bir kez uygula; sonraki kullanıcı
  // değişiklikleri normal biçimde saklanmaya devam eder.
  if(!localStorage.getItem('edu_defaults_v5')){
    localStorage.setItem('edu_theme','light');
    localStorage.setItem('edu_demo_mode','0');
    localStorage.setItem('edu_preferences',JSON.stringify({sound:true,autoNext:true,goal:100}));
    localStorage.setItem('edu_defaults_v5','1');
  }
  renderMathSymbols();
  renderStreakDots();
  loadManifestMeta();
  await loadAllKonular();
  await loadBundledFasikuller();
  await restoreEduDirHandle();
  initGithubConfigUI();
  // Demo Verileri tercihini uygula
  const demoMode = localStorage.getItem('edu_demo_mode') === '1';
  applyDemoMode(demoMode);
  const demoToggle = document.getElementById('demoDataToggle');
  if(demoToggle){ demoToggle.textContent=demoMode?'Açık':'Kapalı'; demoToggle.classList.toggle('off',!demoMode); }
  renderDerslerGrid();
  renderDate();
  // Load saved theme
  const saved = localStorage.getItem('edu_theme');
  if(saved && saved !== appState.theme) toggleTheme();
  loadPreferences();
  applyUiIcons();
  renderIconSettings();
  initCatDrag();

  // v4: Load persisted data
  loadPersistedData();
  recalcFasikulProgress();
  updateDashboard();
  renderDerslerGrid();

  // Onboarding turu kaldırıldı (otomatik tetik yok)

  // Drag & drop PDF yükleme
  const uploadZone = document.getElementById('pdfUploadZone');
  if(uploadZone){
    uploadZone.addEventListener('dragover', e=>{
      e.preventDefault(); uploadZone.classList.add('drag-over');
    });
    uploadZone.addEventListener('dragleave', ()=>uploadZone.classList.remove('drag-over'));
    uploadZone.addEventListener('drop', e=>{
      e.preventDefault(); uploadZone.classList.remove('drag-over');
      const file = e.dataTransfer?.files?.[0];
      if(file && file.type==='application/pdf'){
        loadPDFFile(file);
        if(appState.aktifDers && appState.aktifFasikul){
          savePDFToDB(appState.aktifDers.id, appState.aktifFasikul.id, file).catch(()=>{});
        }
      }
      else showToast('Lütfen bir PDF dosyası bırak','error');
    });
  }

  initCardZoomPan();
  initTouchGestures();
  if(localStorage.getItem('edu_draw_debug') === '1') window.__DRAW_DEBUG = true; // tanı (varsayılan KAPALI)
  initLongPressDraw();
  // initPanelTapFix KALDIRILDI — panel artık position:fixed değil (flex çocuğu),
  // butonlar native doğru seçilir; tap-fix aksine yanlış yönlendirirdi.
});

// ══════════════════════════════
// ÖZELLEŞTİRİLEBİLİR SİMGELER (cihaz başına; localStorage)
// ══════════════════════════════
const UI_ICONS = {
  live:  { label:'📡 Canlı Ders',  def:'📡', opts:['📡','🔗','👥','🟢','🔄','🤝'] },
  cozum: { label:'🎥 Çözüm',       def:'🎥', opts:['🎥','▶️','🎬','💡','📺','✅'] }
};
function _loadUiIcons(){ try{ return JSON.parse(localStorage.getItem('edu_ui_icons')||'{}'); }catch(e){ return {}; } }
function getUiIcon(id){ const s=_loadUiIcons(); return s[id] || UI_ICONS[id]?.def || ''; }
function setUiIcon(id, icon){
  const s=_loadUiIcons(); s[id]=icon;
  try{ localStorage.setItem('edu_ui_icons', JSON.stringify(s)); }catch(e){}
  applyUiIcons(); renderIconSettings();
}
function applyUiIcons(){
  document.querySelectorAll('.live-session-btn').forEach(b=>{ b.textContent = getUiIcon('live'); });
  // Çözüm butonu dinamik render — açık soru kartı varsa yeniden çiz
  if(appState.aktifAltKonu?.sorular && document.getElementById('tekSoruCard')){
    window.renderTekSoruKart?.(appState.aktifAltKonu.sorular, appState.activeQuestionIdx);
  }
}
function renderIconSettings(){
  const wrap=document.getElementById('iconSettings'); if(!wrap) return;
  wrap.innerHTML = Object.entries(UI_ICONS).map(([id,cfg])=>{
    const cur=getUiIcon(id);
    const opts=cfg.opts.map(o=>`<button class="icon-opt${o===cur?' active':''}" type="button" onclick="setUiIcon('${id}','${o}')">${o}</button>`).join('');
    return `<div class="icon-row"><span class="icon-row-label">${cfg.label}</span><div class="icon-opts">${opts}</div></div>`;
  }).join('');
}
window.getUiIcon = getUiIcon;
window.setUiIcon = setUiIcon;
window.applyUiIcons = applyUiIcons;
window.renderIconSettings = renderIconSettings;

// ══════════════════════════════
// MOTİVASYON KEDİSİ 🐾 — tıkladıkça değişir + zıplar (mini ödül)
// ══════════════════════════════
const CAT_FACES = ['🐱','😺','😸','😻','😹','😽','🐈','😼','🐯','🦁'];
const CAT_CHEERS = ['Harikasın! 🐾','Devam et! 💪','Süpersin! ⭐','Mükemmel! 🌟','Çok iyisin! 🎉','Aferin! 👏','Başaracaksın! 🚀','Mırr… odaklan! 😺'];
const CAT_SPARKS = ['💖','⭐','✨','🐾','🎈','💫'];
let _catIdx = 0;
// Küratörlü yavru kedi görselleri (cataas.com — telifsiz/anahtarsız).
// El ile seçildi: net, aydınlık, sevimli yavrular (karanlık/düşük çözünürlüklü olanlar elendi).
const CURATED_CATS = ['3Z6CcYkHotdUXQC9','48xLBZGSXgxZRMAB','5enhMoq1fey3akP5','8nqmX1ooqvk4fzRU','98qvAp6CYXZMLztN','AbOAHgaV6eqUQZfL','BX0XdDZffs3PqkV7','CFnG5UsD2WCxXJ4L','0F0IKAPOdWiE755P','0GC9MRUAqxhBzPyA','1DrcyohjhwcNaRIz','1ntkA1kLWffNS2xN'];
let _lastCat = -1;
function _nextCatSrc(){
  let i = Math.floor(Math.random()*CURATED_CATS.length);
  if(i === _lastCat) i = (i+1) % CURATED_CATS.length;
  _lastCat = i;
  return `https://cataas.com/cat/${CURATED_CATS[i]}?width=320&height=320`;
}
function loadCatImage(){
  const img = document.getElementById('catImg'); const emo = document.getElementById('catEmoji');
  if(!img) return;
  img.onload  = ()=>{ img.style.display='block'; if(emo) emo.style.display='none'; };
  img.onerror = ()=>{ img.style.display='none';  if(emo) emo.style.display=''; }; // resim gelmezse emoji
  img.src = _nextCatSrc();
}
function pokeCat(){
  const el = document.getElementById('catBuddy'); if(!el) return;
  _catIdx = (_catIdx + 1) % CAT_FACES.length;
  const emo = document.getElementById('catEmoji'); const img = document.getElementById('catImg');
  if(_catMode()==='emoji'){
    if(img){ img.style.display='none'; }
    if(emo){ emo.style.display=''; emo.textContent = CAT_FACES[_catIdx]; }
  } else {
    if(emo) emo.textContent = CAT_FACES[_catIdx];
    loadCatImage();
  }
  el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
  const s = document.createElement('span');
  s.className = 'cat-spark';
  s.textContent = CAT_SPARKS[Math.floor(Math.random()*CAT_SPARKS.length)];
  s.style.right = (8 + Math.random()*28) + 'px';
  s.style.bottom = '112px';
  el.parentElement?.appendChild(s);
  setTimeout(()=>s.remove(), 1000);
  if(Math.random() < 0.45) window.showToast?.(CAT_CHEERS[Math.floor(Math.random()*CAT_CHEERS.length)], 'success');
}
window.pokeCat = pokeCat;

// Kedi profil ayarları: aç/kapa + görünüm (emoji / canlı foto) — cihaz başına
function _catOn(){ return localStorage.getItem('edu_cat_on') === '1'; }   // varsayılan KAPALI
function _catMode(){ return localStorage.getItem('edu_cat_mode') || 'canli'; }
function applyCatVisibility(){
  const c=document.getElementById('catBuddy'); if(c) c.style.display = _catOn() ? '' : 'none';
  const t=document.getElementById('catOnToggle'); if(t){ const on=_catOn(); t.textContent=on?'Açık':'Kapalı'; t.classList.toggle('off', !on); }
  document.querySelectorAll('[data-catmode]').forEach(b=>b.classList.toggle('active', b.dataset.catmode===_catMode()));
}
function toggleCatOn(){ localStorage.setItem('edu_cat_on', _catOn() ? '0' : '1'); applyCatVisibility(); }
function setCatMode(m){
  localStorage.setItem('edu_cat_mode', m); applyCatVisibility();
  const img=document.getElementById('catImg'), emo=document.getElementById('catEmoji');
  if(m==='emoji'){ if(img){ img.style.display='none'; img.removeAttribute('src'); } if(emo){ emo.style.display=''; emo.textContent=CAT_FACES[_catIdx]||'🐱'; } }
  else { loadCatImage(); }
}
window.toggleCatOn = toggleCatOn;
window.setCatMode = setCatMode;
window.applyCatVisibility = applyCatVisibility;

// Kedi: sürükle-taşı (yüzen pencere) + dokununca değiş; konum cihazda saklanır
function initCatDrag(){
  const cat = document.getElementById('catBuddy');
  if(!cat || cat._dragInit) return;
  cat._dragInit = true;
  // Boyut geri yükle (kullanıcı 1–4 kat ayarlayabilir; cihazda saklı)
  const _applyCatSize=(s)=>{ s=Math.max(56,Math.min(220,s)); cat.style.width=s+'px'; cat.style.height=s+'px'; cat.style.fontSize=Math.round(s*0.46)+'px'; };
  try{ const sz=parseInt(localStorage.getItem('edu_cat_size')||''); if(Number.isFinite(sz)) _applyCatSize(sz); }catch(e){}
  try{
    const p = JSON.parse(localStorage.getItem('edu_cat_pos')||'null');
    if(p && Number.isFinite(p.left) && Number.isFinite(p.top)){
      cat.style.left=p.left+'px'; cat.style.top=p.top+'px'; cat.style.right='auto'; cat.style.bottom='auto';
    }
  }catch(e){}
  // ── Köşeden boyutlandırma tutamacı ──
  const handle=document.getElementById('catResize');
  if(handle){
    let rsz=false, rs=0, rsize=0;
    handle.addEventListener('pointerdown', e=>{
      e.stopPropagation(); rsz=true; rs=e.clientX+e.clientY; rsize=cat.offsetWidth;
      handle.setPointerCapture?.(e.pointerId);
    });
    handle.addEventListener('pointermove', e=>{
      if(!rsz) return; e.stopPropagation();
      _applyCatSize(rsize + (rs-(e.clientX+e.clientY))); // sol-üste sürükle → büyür
    });
    const rend=e=>{ if(!rsz) return; rsz=false; try{ handle.releasePointerCapture?.(e.pointerId); }catch(_e){} try{ localStorage.setItem('edu_cat_size', String(cat.offsetWidth)); }catch(_e){} };
    handle.addEventListener('pointerup', rend);
    handle.addEventListener('pointercancel', rend);
  }
  let dragging=false, moved=false, sx=0, sy=0, ox=0, oy=0;
  cat.addEventListener('pointerdown', e=>{
    dragging=true; moved=false; sx=e.clientX; sy=e.clientY;
    const pr=cat.parentElement.getBoundingClientRect(), r=cat.getBoundingClientRect();
    ox=r.left-pr.left; oy=r.top-pr.top;
    cat.setPointerCapture?.(e.pointerId);
  });
  cat.addEventListener('pointermove', e=>{
    if(!dragging) return;
    if(cat.classList.contains('cat-parked')) cat.classList.remove('cat-parked'); // sürükleyince park'tan çık
    const dx=e.clientX-sx, dy=e.clientY-sy;
    if(Math.abs(dx)>4 || Math.abs(dy)>4) moved=true;
    const pr=cat.parentElement.getBoundingClientRect();
    // Sağa TAMAMEN kaydırılabilsin diye sağ sınır gevşek (sadece 10px sliver kalır)
    const nl=Math.max(0, Math.min(ox+dx, pr.width - 10));
    const nt=Math.max(0, Math.min(oy+dy, pr.height - cat.offsetHeight));
    cat.style.left=nl+'px'; cat.style.top=nt+'px'; cat.style.right='auto'; cat.style.bottom='auto';
  });
  const parkCat=()=>{
    cat.classList.add('cat-parked');
    cat.style.left=''; cat.style.right='0';
    try{ localStorage.setItem('edu_cat_parked','1'); }catch(_e){}
  };
  const unparkCat=()=>{
    cat.classList.remove('cat-parked');
    const pr=cat.parentElement.getBoundingClientRect();
    const nl=Math.max(0, pr.width - cat.offsetWidth - 16);
    cat.style.left=nl+'px'; cat.style.right='auto';
    try{ localStorage.setItem('edu_cat_parked','0'); localStorage.setItem('edu_cat_pos', JSON.stringify({left:nl, top:parseInt(cat.style.top)||0})); }catch(_e){}
  };
  cat._unparkCat = unparkCat;
  const end=e=>{
    if(!dragging) return; dragging=false;
    try{ cat.releasePointerCapture?.(e.pointerId); }catch(_e){}
    if(moved){
      const pr=cat.parentElement.getBoundingClientRect();
      const left=parseInt(cat.style.left)||0;
      // Yarıdan fazlası sağ kenardan taştıysa → park et (kenarda yarı saydam tab)
      if(left + cat.offsetWidth*0.5 > pr.width){ parkCat(); return; }
      try{ localStorage.setItem('edu_cat_pos', JSON.stringify({left, top:parseInt(cat.style.top)||0})); }catch(_e){}
    } else {
      if(cat.classList.contains('cat-parked')) unparkCat(); // park'lı kediye dokun → geri gel
      else pokeCat(); // sadece dokunma → kedi değişsin
    }
  };
  cat.addEventListener('pointerup', end);
  cat.addEventListener('pointercancel', end);
  try{ if(localStorage.getItem('edu_cat_parked')==='1') cat.classList.add('cat-parked'); }catch(e){}
  applyCatVisibility();
  if(_catOn() && _catMode()==='canli') loadCatImage(); // başlangıçta gerçek bir kedi resmi göster
}
window.initCatDrag = initCatDrag;

// ══════════════════════════════
// THEME
// ══════════════════════════════
function savePreferences(){ localStorage.setItem('edu_preferences',JSON.stringify(appState.preferences)); scheduleCloudPersist(); }
function loadPreferences(){
  try{
    const saved=JSON.parse(localStorage.getItem('edu_preferences')||'null');
    if(saved){
      if(typeof saved.sound==='boolean') appState.preferences.sound=saved.sound;
      if(typeof saved.autoNext==='boolean') appState.preferences.autoNext=saved.autoNext;
      if(Number.isFinite(Number(saved.goal))) appState.preferences.goal=Math.min(300,Math.max(5,Number(saved.goal)));
    }
  }catch(e){}
  const sound=document.getElementById('soundToggle');
  if(sound){sound.textContent=appState.preferences.sound?'Açık':'Kapalı';sound.classList.toggle('off',!appState.preferences.sound);}
  const auto=document.getElementById('autoNextToggle');
  if(auto){auto.textContent=appState.preferences.autoNext?'Açık':'Kapalı';auto.classList.toggle('off',!appState.preferences.autoNext);}
  const slider=document.getElementById('goalSlider');
  if(slider) slider.value=appState.preferences.goal;
  updateGoal(appState.preferences.goal,false);
}
function toggleSound(btn){ appState.preferences.sound=!appState.preferences.sound;btn.textContent=appState.preferences.sound?'Açık':'Kapalı';btn.classList.toggle('off',!appState.preferences.sound);savePreferences(); }
function toggleAutoNext(btn){ appState.preferences.autoNext=!appState.preferences.autoNext;btn.textContent=appState.preferences.autoNext?'Açık':'Kapalı';btn.classList.toggle('off',!appState.preferences.autoNext);savePreferences(); }
function updateGoal(v,persist=true){ const goal=Math.min(300,Math.max(5,parseInt(v)||100));document.getElementById('goalVal').textContent=`${goal} soru`;document.getElementById('goalDisplay').textContent=`${goal} soru`;appState.preferences.goal=goal;if(persist)savePreferences(); }
function cycleAvatar(){ appState.avatarIdx=(appState.avatarIdx+1)%appState.avatarEmojis.length; const em=appState.avatarEmojis[appState.avatarIdx]; document.getElementById('profilAvatar').textContent=em; document.getElementById('avatarBtn').textContent=em; }
function exportData(){ const d={user:appState.user,hatalilar:appState.hatalilar,drawings:Object.keys(appState.drawings)}; const b=document.createElement('a'); b.href='data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(d,null,2)); b.download='edufasikuler_data.json'; b.click(); showToast('Veriler indirildi ✓','success'); }

// ══════════════════════════════
// SIDEBAR & PANELS
// ══════════════════════════════
function toggleSidebar(){
  const s = document.getElementById('sidebar');
  s.classList.toggle('collapsed');
  const btn = s.querySelector('.collapse-btn');
  btn.textContent = s.classList.contains('collapsed') ? '▶' : '◀';
}
function showPanel(name, navEl){
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('panel-'+name).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  if(navEl) navEl.classList.add('active');
  const titles = {dashboard:'Anasayfa',stats:'İstatistikler',hatalilar:'Hatalılar Defteri',profil:'Profilim',admin:'Kullanıcı ve Program Yönetimi'};
  document.getElementById('topBarTitle').textContent = titles[name]||name;
  if(name==='stats' && !window._chartsInited){ initCharts(); window._chartsInited=true; }
  if(name==='dashboard' || name==='stats' || name==='profil') updateDashboard();
  if(name==='profil') refreshProfileGithubJsonTools();
  if(name==='hatalilar') renderHatalilar();
  if(name==='admin') loadKullaniciList();
}

// ══════════════════════════════
// DERS GRID
// ══════════════════════════════
const GUEST_DEMO_FASIKUL_IDS = new Set(['lgs-matematik']);
function isGuestSession(){ return appState.user?.email==='misafir@demo.com'; }
function perfSummary(bucket){
  const total = Number(bucket?.total || 0);
  const correct = Number(bucket?.dogru || 0);
  const wrong = Number(bucket?.yanlis || 0);
  const solved = correct + wrong;
  const accuracy = solved ? Math.round(correct / solved * 100) : 0;
  const net = correct - wrong * 0.25;
  return {total, correct, wrong, solved, accuracy, net};
}
function formatNet(value){
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
function isNestedDers(ders){
  return !!ders?.parentDersId;
}
function getFolderChildDers(fas){
  return fas?.type === 'folder' && fas.childDersId
    ? MANIFEST.dersler.find(d=>d.id===fas.childDersId)
    : null;
}
function getFasikulSoruSayisi(fas){
  const child = getFolderChildDers(fas);
  if(child) return visibleFasikullerFor(child).reduce((a,f)=>a+getFasikulSoruSayisi(f),0);
  return Number(fas?.soruSayisi || 0);
}
function getFasikulKonuSayisi(fas){
  const child = getFolderChildDers(fas);
  if(child) return visibleFasikullerFor(child).reduce((a,f)=>a+getFasikulKonuSayisi(f),0);
  return Number(fas?.konuSayisi || 0);
}
function renderDerslerGrid(){
  const grid = document.getElementById('derslerGrid');
  grid.innerHTML = '';
  const stats = getDashboardStats();
  const visibleDersler=MANIFEST.dersler.filter(d=>!isNestedDers(d) && (visibleFasikullerFor(d).length>0 || !isGuestSession()));
  const sayac = document.getElementById('derslerSayac');
  if(sayac) sayac.textContent = `${visibleDersler.length} ders aktif`;
  visibleDersler.forEach(ders => {
    const card = document.createElement('div');
    card.className = 'ders-card';
    card.dataset.ders = ders.id;
    const dersPerf = perfSummary(stats.dersler?.[ders.id]);
    const visibleFasikuller=visibleFasikullerFor(ders);
    const fasSayisi = visibleFasikuller.length;
    const soruSayisi = visibleFasikuller.reduce((a,f)=>a+getFasikulSoruSayisi(f),0);
    const r = 20; const circ = 2*Math.PI*r;
    const offset = circ * (1 - ders.progPct/100);
    const renkVar = ders.renk;
    card.style.setProperty('--accent', renkVar);
    card.innerHTML = `
      <button class="ders-edit-btn" onclick="openDersModal('${ders.id}',event)" title="Düzenle">✏️</button>
      <div class="ders-card-top">
        <span class="ders-card-icon">${ders.ikon}</span>
        <div class="ders-card-titles">
          <div class="ders-card-name">${ders.ad}</div>
          <div class="ders-card-meta">${fasSayisi} fasikül · ${soruSayisi} soru</div>
        </div>
      </div>
      <div class="progress-ring-wrap">
        <svg class="progress-ring" width="48" height="48" viewBox="0 0 48 48">
          <circle cx="24" cy="24" r="${r}" fill="none" stroke="var(--bg-4)" stroke-width="3.5"/>
          <circle cx="24" cy="24" r="${r}" fill="none" stroke="${renkVar}" stroke-width="3.5"
            stroke-dasharray="${circ}" stroke-dashoffset="${offset}" stroke-linecap="round"/>
        </svg>
        <div>
          <div class="progress-ring-label" style="color:${renkVar}">${ders.progPct}%</div>
          <div class="progress-ring-sub">tamamlandı</div>
        </div>
      </div>
      <div class="ders-card-footer">
        <span>${dersPerf.total ? `${dersPerf.solved} çözüldü · %${dersPerf.accuracy} · Net ${formatNet(dersPerf.net)}` : (visibleFasikuller[0]?.sonCalisma||'—')}</span>
        <button class="devam-btn" style="background:color-mix(in srgb,${renkVar} 16%,transparent);color:${renkVar}" onclick="openDrawer(event,'${ders.id}')">Devam Et →</button>
      </div>`;
    grid.appendChild(card);
  });
}

// ══════════════════════════════
// DRAWER
// ══════════════════════════════
// Aktif ders tek kaynakta: window.currentDrawerDers (split-brain önler)
let allFasikulCards = [];
const FASIKUL_THEME_COLORS = ['#7c73ff','#ec6471','#f59e0b','#22c55e','#14b8a6','#38bdf8','#d946ef'];
let draggedFasikulId = null;
let fasikulWasDragged = false;

function openDrawer(e, dersId, dersObj){
  if(e?.stopPropagation) e.stopPropagation();
  // dersObj verilirse onu kullan: çağıran (ör. saveFasikul) fasikülü hangi objeye
  // eklediyse render de o objeden yapılsın; MANIFEST.find farklı/kopuk obje bulabilir.
  const ders = dersObj || MANIFEST.dersler.find(d=>d.id===dersId);
  if(!ders) return;
  window.currentDrawerDers = ders;
  const parent = ders.parentDersId ? MANIFEST.dersler.find(d=>d.id===ders.parentDersId) : null;
  document.getElementById('drawerTitle').textContent = parent
    ? `${parent.ikon || '📚'} ${parent.ad} / ${ders.ad}`
    : `${ders.ikon} ${ders.ad}`;
  const backBtn = document.querySelector('.drawer-back');
  if(backBtn){
    backBtn.onclick = (ev)=>{
      ev?.stopPropagation?.();
      parent ? openDrawer(ev, parent.id) : closeDrawer();
    };
    backBtn.classList.toggle('drawer-back-parent', !!parent);
    backBtn.title = parent ? `${parent.ad} içine dön; kartı buraya bırakırsanız dışarı taşınır` : 'Kapat';
    backBtn.ondragover = (ev)=>{
      if(parent && draggedFasikulId){ ev.preventDefault(); backBtn.classList.add('drag-over'); }
    };
    backBtn.ondragleave = ()=>backBtn.classList.remove('drag-over');
    backBtn.ondrop = (ev)=>{
      if(!parent || !draggedFasikulId) return;
      ev.preventDefault();
      backBtn.classList.remove('drag-over');
      window.moveFasikulToDers?.(ders.id, draggedFasikulId, parent.id);
      openDrawer(ev, parent.id);
    };
  }
  document.getElementById('drawerSearch').value='';
  renderFasikulCards(visibleFasikullerFor(ders), ders);
  document.getElementById('drawerOverlay').classList.add('open');
  document.getElementById('drawer').classList.add('open');
}
function closeDrawer(){
  document.getElementById('drawerOverlay').classList.remove('open');
  document.getElementById('drawer').classList.remove('open');
}
function attachFasikulDragHandlers(card, ders, fas, sortable, moveTargetDersId=null){
  if(!sortable) return;
  card.addEventListener('dragstart', e=>{
    draggedFasikulId=fas.id; fasikulWasDragged=true;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed='move';
    e.dataTransfer.setData('text/plain',fas.id);
  });
  card.addEventListener('dragend', ()=>{
    card.classList.remove('dragging');
    document.querySelectorAll('.fasikul-card.drag-over').forEach(c=>c.classList.remove('drag-over'));
    draggedFasikulId=null;
  });
  card.addEventListener('dragover', e=>{
    e.preventDefault();
    if(draggedFasikulId && draggedFasikulId!==fas.id) card.classList.add('drag-over');
  });
  card.addEventListener('dragleave', ()=>card.classList.remove('drag-over'));
  card.addEventListener('drop', e=>{
    e.preventDefault(); card.classList.remove('drag-over');
    if(moveTargetDersId){
      window.moveFasikulToDers?.(ders.id, draggedFasikulId, moveTargetDersId);
    } else {
      window.reorderFasikulByDrop?.(ders.id,draggedFasikulId,fas.id);
    }
  });
}
function renderFasikulCards(fasikuller, ders){
  const body = document.getElementById('drawerBody');
  body.innerHTML = '';
  const sortable = fasikuller.length === ders.fasikuller.length;
  body.classList.toggle('is-filtered', !sortable);
  if(fasikuller.length===0){
    body.innerHTML='<div style="text-align:center;padding:32px;color:var(--text-muted)">Fasikül bulunamadı</div>';
    return;
  }
  fasikuller.forEach(fas => {
   try{
    const childDers = getFolderChildDers(fas);
    if(childDers){
      const childVisible = visibleFasikullerFor(childDers);
      const soruSayisi = childVisible.reduce((a,f)=>a+getFasikulSoruSayisi(f),0);
      const konuSayisi = childVisible.reduce((a,f)=>a+getFasikulKonuSayisi(f),0);
      const renkCSS = childDers.renk || ders.renk;
      const card = document.createElement('div');
      card.className='fasikul-card fasikul-folder-card';
      card.dataset.fasikulId=fas.id;
      card.draggable=sortable;
      card.style.setProperty('--fas-accent', renkCSS);
      card.innerHTML=`
        <button class="ders-edit-btn folder-edit-btn" onclick="openDersModal('${childDers.id}',event)" title="Düzenle">✏️</button>
        <div class="fasikul-card-top">
          <div class="fasikul-drag-handle" title="Sürükleyerek sırala" aria-hidden="true">⣿</div>
          <div class="fasikul-thumb" style="background:color-mix(in srgb,${renkCSS} 16%,transparent)">${childDers.ikon || fas.thumb || '📁'}</div>
          <div class="fasikul-info">
            <div class="fasikul-name">${childDers.ad}</div>
            <div class="fasikul-meta">
              <span class="fasikul-meta-chip">📁 Alt ders</span>
              <span class="fasikul-meta-chip">📚 ${childVisible.length} fasikül</span>
              <span class="fasikul-meta-chip">📝 ${soruSayisi} soru</span>
            </div>
          </div>
          <button class="fasikul-card-menu-btn" type="button" aria-label="Klasör seçenekleri" title="Klasör seçenekleri" onclick="event.stopPropagation();toggleFasikulMenu(this)">⋮</button>
          <div class="fasikul-card-menu">
            ${appState.user?.role === 'admin' ? `<button onclick="event.stopPropagation();deleteFasikul('${ders.id}','${fas.id}')" style="color:var(--red);font-weight:800">❌ Klasörü kaldır</button>` : ''}
          </div>
        </div>
        <div class="fasikul-progress">
          <div class="prog-bar"><div class="prog-fill" style="width:${childDers.progPct || 0}%;background:${renkCSS}"></div></div>
          <div class="prog-pct">${childDers.progPct || 0}%</div>
        </div>
        <div class="fasikul-card-footer">
          <div class="fasikul-card-stats"><span>${konuSayisi} konu · ${soruSayisi} soru</span></div>
          <button class="fasikul-open-btn" style="background:${renkCSS};color:#fff"
            onclick="event.stopPropagation();openDrawer(event,'${childDers.id}')">Aç →</button>
        </div>`;
      card.addEventListener('click', (e)=>{
        if(e.target.closest('.fasikul-card-menu')||e.target.closest('.fasikul-card-menu-btn')) return;
        if(fasikulWasDragged){ fasikulWasDragged=false; return; }
        openDrawer(e, childDers.id);
      });
      attachFasikulDragHandlers(card, ders, fas, sortable, childDers.id);
      body.appendChild(card);
      return;
    }
    const card = document.createElement('div');
    card.className='fasikul-card';
    card.dataset.fasikulId=fas.id;
    card.draggable=sortable;
    const fasPerf = perfSummary(fas._perf);
    const soruCozulen = fasPerf.total ? fasPerf.solved : (fas._solvedCount ?? Math.floor(fas.soruSayisi * fas.progPct/100));
    const renkCSS = fas.temaRenk || ders.renk;
    card.style.setProperty('--fas-accent', renkCSS);
    const hasKonular = fas.konular && fas.konular.length > 0;
    const isBundled = fas.sourceType === 'bundled';
    const isAdmin = appState.user?.role === 'admin';
    const jsonPillHtml = hasKonular
      ? `<span class="fasikul-json-pill ok">✓ ${isBundled?'JSON otomatik':'JSON yüklü'}</span>`
      : '';
    card.innerHTML=`
      <div class="fasikul-card-top">
        <div class="fasikul-drag-handle" title="Sürükleyerek sırala" aria-hidden="true">⣿</div>
        <div class="fasikul-thumb" style="background:color-mix(in srgb,${renkCSS} 16%,transparent)">${fas.thumb}</div>
        <div class="fasikul-info">
          <div class="fasikul-name">${fas.ad}</div>
          <div class="fasikul-meta">
            <span class="fasikul-meta-chip">📚 ${fas.konuSayisi} konu</span>
            <span class="fasikul-meta-chip">📝 ${fas.soruSayisi} soru</span>
            <span class="fasikul-meta-chip">🕐 ${fas.sonCalisma||'—'}</span>
          </div>
        </div>
        <button class="fasikul-card-menu-btn" type="button" aria-label="Fasikül seçenekleri" title="Fasikül seçenekleri" onclick="event.stopPropagation();toggleFasikulMenu(this)">⋮</button>
        <div class="fasikul-card-menu">
          ${isAdmin?`<button onclick="event.stopPropagation();deleteFasikul('${ders.id}','${fas.id}')" style="color:var(--red);font-weight:800">❌ Fasikülü sil (admin)</button>
          <div class="fasikul-menu-divider"></div>`:''}
          <button onclick="event.stopPropagation();resetFasikulData('${ders.id}','${fas.id}')" style="color:var(--red)">🗑️ Çalışmayı sıfırla</button>
          <div class="fasikul-menu-divider"></div>
          <div class="fasikul-color-label">Kart rengi</div>
          <div class="fasikul-color-grid">
            ${FASIKUL_THEME_COLORS.map(c=>`<button class="fasikul-color-swatch${renkCSS===c?' selected':''}" style="--swatch:${c}" title="Bu rengi kullan" aria-label="Kart rengini değiştir" onclick="event.stopPropagation();setFasikulTheme('${ders.id}','${fas.id}','${c}')"></button>`).join('')}
          </div>
          <div class="fasikul-menu-divider"></div>
          <div class="fasikul-order-actions">
            <button onclick="event.stopPropagation();moveFasikul('${ders.id}','${fas.id}',-1)">↑ Üste taşı</button>
            <button onclick="event.stopPropagation();moveFasikul('${ders.id}','${fas.id}',1)">↓ Alta taşı</button>
          </div>
        </div>
      </div>
      <div class="fasikul-progress">
        <div class="prog-bar"><div class="prog-fill" style="width:${fas.progPct}%;background:${renkCSS}"></div></div>
        <div class="prog-pct">${fas.progPct}%</div>
      </div>
      <div class="fasikul-card-footer">
        <div class="fasikul-card-stats">
          <span>${fasPerf.total ? `${soruCozulen}/${fas.soruSayisi} · %${fasPerf.accuracy} · Net ${formatNet(fasPerf.net)}` : `${soruCozulen}/${fas.soruSayisi} çözüldü`}</span>
          ${jsonPillHtml}
        </div>
        <button class="fasikul-open-btn" style="background:${renkCSS};color:#fff"
          onclick="event.stopPropagation();openReader('${ders.id}','${fas.id}')">Aç →</button>
      </div>`;
    card.addEventListener('click', (e)=>{
      if(e.target.closest('.fasikul-card-menu')||e.target.closest('.fasikul-card-menu-btn')) return;
      if(fasikulWasDragged){ fasikulWasDragged=false; return; }
      openReader(ders.id, fas.id);
    });
    attachFasikulDragHandlers(card, ders, fas, sortable);
    body.appendChild(card);
   }catch(err){
    // Bir kartın render'ı patlarsa forEach durmasın — diğer fasiküller (ve yeni
    // eklenen) yine görünsün. Kök nedeni görmek için konsola yaz.
    console.error('Fasikül kartı render hatası:', fas?.id, err);
   }
  });
}
document.addEventListener('click', (e)=>{
  if(!e.target.closest('.fasikul-card-menu-btn')){
    document.querySelectorAll('.fasikul-card-menu.open').forEach(m=>m.classList.remove('open'));
  }
});

// ══════════════════════════════
// READER
// ══════════════════════════════
function _escapeHtml(text){
  return String(text ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[ch]));
}

function getLastWorkedTarget(){
  let best = null;
  let fallback = null;
  MANIFEST.dersler.forEach(ders => {
    const fasikuller = visibleFasikullerFor(ders);
    fasikuller.forEach(fas => {
      const hasWorkText = fas.sonCalisma && fas.sonCalisma !== '—' && fas.sonCalisma !== 'Yeni eklendi';
      const score = Number(fas._lastWorkedAt || 0);
      const target = { ders, fas, score };
      if(score && (!best || score > best.score)) best = target;
      if(hasWorkText && !fallback) fallback = target;
    });
  });
  return best || fallback || null;
}

function updateLastOpenBanner(){
  const target = getLastWorkedTarget();
  const banner = document.getElementById('lastOpenBanner');
  if(!banner) return;
  const nameEl = document.getElementById('lastOpenName');
  const metaEl = document.getElementById('lastOpenMeta');
  const pctEl = document.getElementById('lastOpenPct');
  const barEl = document.getElementById('lastOpenPbar');
  const thumbEl = document.getElementById('lastOpenThumb');
  if(!target){
    window._lastWorkedTarget = null;
    if(nameEl) nameEl.textContent = 'Henüz çalışma yok';
    if(metaEl) metaEl.textContent = 'Bir fasikül açıp çalışmaya başlayın';
    if(pctEl) pctEl.textContent = '%0';
    if(barEl) barEl.style.width = '0%';
    if(thumbEl) thumbEl.textContent = '📘';
    return;
  }
  const { ders, fas } = target;
  window._lastWorkedTarget = { dersId: ders.id, fasikulId: fas.id };
  const pct = Math.max(0, Math.min(100, Number(fas.progPct || 0)));
  const konu = fas._lastKonuAd || fas._lastAltKonuAd || fas.sonCalisma || 'Kaldığın yerden devam et';
  if(nameEl) nameEl.textContent = fas.ad || 'Fasikül';
  if(metaEl) metaEl.textContent = `${ders.ad} · ${fas.sinif || '?'}. Sınıf · ${konu}`;
  if(pctEl) pctEl.textContent = `%${pct}`;
  if(barEl) barEl.style.width = `${pct}%`;
  if(thumbEl){
    thumbEl.textContent = fas.thumb || ders.ikon || '📘';
    if(fas.thumbBg) thumbEl.style.background = fas.thumbBg;
  }
  banner.title = `${_escapeHtml(fas.ad)} - devam et`;
}

function updateDashboard(){
  const stats=getDashboardStats();
  const total=stats.toplam||0;
  const correct=stats.dogru||0;
  const wrong=stats.yanlis||0;
  const accuracy=total ? Math.round((correct/total)*100) : 0;
  const records=stats.records||[];
  const daily=getDailyCounts(records);
  const today=new Date();
  const weekKeys=[];
  for(let i=6;i>=0;i--){ const d=new Date(today); d.setDate(today.getDate()-i); weekKeys.push(d.toISOString().slice(0,10)); }
  const weeklyData=weekKeys.map(k=>daily[k]||0);
  const weeklyTotal=weeklyData.reduce((a,b)=>a+b,0);
  const streak=calcCurrentStreak(daily);
  const totalSec=records.reduce((sum,r)=>sum+Number(r.timeSec||0),0);
  const totalMin=Math.round(totalSec/60);
  const set=(id,v)=>{ const el=document.getElementById(id); if(el) el.textContent=v; };
  set('sidebarStreakCount', `${streak} Gün`);
  set('statStreak', streak);
  set('statStreakDelta', streak ? '↗ Devam et!' : '—');
  set('totalSolved', total);
  set('statSolvedDelta', weeklyTotal ? `↗ Bu hafta +${weeklyTotal}` : '—');
  set('statWeekly', weeklyTotal);
  set('statWeeklyDelta', weeklyTotal ? '↗ Aktif hafta' : '—');
  set('statAccuracy', `%${accuracy}`);
  set('statAccuracyDelta', total ? `${correct} doğru · ${wrong} yanlış` : '—');
  set('kpiTotalSolved', total);
  set('kpiSolvedSub', weeklyTotal ? `Bu hafta +${weeklyTotal}` : 'Henüz haftalık çözüm yok');
  set('kpiAccuracy', `%${accuracy}`);
  set('kpiAccuracySub', total ? `${correct}/${total} doğru` : 'Henüz veri yok');
  set('kpiTime', totalMin>=60 ? `${Math.floor(totalMin/60)}s ${totalMin%60}d` : `${totalMin}d`);
  set('kpiTimeSub', totalSec ? 'Çözüm sürelerinden hesaplandı' : 'Henüz süre yok');
  set('kpiLongestStreak', `${streak}🔥`);
  set('kpiLongestSub', streak ? 'Güncel seri' : 'Seri oluşmadı');
  set('profileSolved', total);
  set('profileStreak', `${streak}🔥`);
  set('profileAccuracy', `%${accuracy}`);
  document.querySelectorAll('.streak-dot').forEach((d,i)=>d.classList.toggle('done', i<Math.min(streak,7)));
  updateLastOpenBanner();

  if(window._chartWeekly){
    window._chartWeekly.data.datasets[0].data=weeklyData;
    window._chartWeekly.update();
  }
  const konuDagilimi = stats.konuDagilimi || stats.konular || {};
  const topicRows=Object.entries(konuDagilimi).map(([name,k])=>{
    const d=Number(k.dogru||0), y=Number(k.yanlis||0), solved=d+y;
    const label = k.dersAd && k.fasikulAd
      ? `${k.dersAd} / ${k.fasikulAd} / ${k.konu || k.label || name}`
      : (k.konu || k.label || name);
    return {name:label,dogru:d,yanlis:y,solved,accuracy:solved?Math.round(d/solved*100):0,net:d-y*0.25};
  }).filter(r=>r.solved>0).sort((a,b)=>b.solved-a.solved);
  if(window._chartRadar){
    const radarRows=topicRows.slice(0,6);
    window._chartRadar.data.labels=radarRows.length ? radarRows.map(r=>r.name.length>16?r.name.slice(0,15)+'…':r.name) : ['Konu 1','Konu 2','Konu 3','Konu 4','Konu 5','Konu 6'];
    window._chartRadar.data.datasets[0].data=radarRows.length ? radarRows.map(r=>r.accuracy) : [0,0,0,0,0,0];
    window._chartRadar.update();
  }
  const tbody=document.getElementById('konuTableBody');
  if(tbody){
    if(!topicRows.length){
      tbody.innerHTML='<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:28px">Henüz konu performansı oluşmadı.</td></tr>';
    }else{
      tbody.innerHTML=topicRows.slice(0,12).map(r=>`<tr><td>${r.name}</td><td>${r.solved}</td><td>%${r.accuracy}</td><td>${Number.isInteger(r.net)?r.net:r.net.toFixed(2)}</td><td>${r.accuracy>=75?'↗':r.accuracy>=50?'➡':'↘'}</td></tr>`).join('');
    }
  }
  const cal=document.getElementById('calGrid');
  if(cal){
    cal.innerHTML='';
    for(let i=34;i>=0;i--){
      const d=new Date(today); d.setDate(today.getDate()-i);
      const count=daily[d.toISOString().slice(0,10)]||0;
      const level=count>=20?4:count>=10?3:count>=4?2:count>0?1:0;
      const el=document.createElement('div');
      el.className='cal-day'+(level?` level-${level}`:'');
      el.title=`${count} soru`;
      cal.appendChild(el);
    }
  }
  const badges=[
    {icon:'🔥',name:'7 Günlük Seri',earned:streak>=7},
    {icon:'⚡',name:'Hız Rekoru',earned:records.some(r=>Number(r.timeSec||999)<=20)},
    {icon:'💯',name:'Mükemmel Test',earned:total>=10&&accuracy===100},
    {icon:'🦉',name:'Gece Kuşu',earned:records.some(r=>{const d=new Date(r.tarih||0);return !Number.isNaN(d.getTime())&&d.getHours()>=22;})},
    {icon:'🎯',name:'Keskin Nişancı',earned:total>=20&&accuracy>=85},
    {icon:'📚',name:'Kitap Kurdu',earned:total>=100},
    {icon:'🚀',name:'Roket Hızı',earned:weeklyTotal>=50},
    {icon:'🏆',name:'Şampiyon',earned:total>=300},
    {icon:'🧠',name:'Dahi',earned:Object.keys(konuDagilimi).length>=5},
    {icon:'⭐',name:'Süper Star',earned:total>=500}
  ];
  const bg=document.getElementById('badgesGrid');
  if(bg){
    bg.innerHTML=badges.map(b=>`<div class="badge-item${b.earned?' earned':' locked'}"><div class="badge-icon">${b.icon}</div><div class="badge-name">${b.name}</div></div>`).join('');
  }
}

// ══════════════════════════════
// FASİKÜL İLERLEME HESAPLAMA
// ══════════════════════════════
function recalcFasikulProgress(){
  const stats = getDashboardStats();
  MANIFEST.dersler.forEach(ders => {
    let dersTotal = 0, dersSolved = 0;
    ders._perf = stats.dersler?.[ders.id] || null;
    ders.fasikuller.forEach(fas => {
      fas._perf = stats.fasikuller?.[fas.id] || null;
      const p = perfSummary(fas._perf);
      const solved = p.solved || 0;
      const total = fas.soruSayisi || 0;
      fas._solvedCount = solved;
      fas.progPct = total > 0 ? Math.min(100, Math.round((solved / total) * 100)) : 0;
      dersTotal += total;
      dersSolved += solved;
    });
    ders.progPct = dersTotal > 0 ? Math.min(100, Math.round((dersSolved / dersTotal) * 100)) : 0;
  });
}

// ══════════════════════════════
// FASİKÜL VERİ SIFIRLAMA
// ══════════════════════════════
// ══════════════════════════════
// HATALIJLAR
// ══════════════════════════════
function renderHatalilar(){
  const list=document.getElementById('hataliList');
  list.innerHTML='';
  const dersFilter=document.getElementById('hataliDersFilter').value;
  let filtered=[...appState.hatalilar];
  if(dersFilter) filtered=filtered.filter(h=>h.ders===dersFilter);
  const sort=document.getElementById('hataliSortFilter').value;
  if(sort==='yanlis') filtered.sort((a,b)=>b.yanlisSayisi-a.yanlisSayisi);
  else if(sort==='ders') filtered.sort((a,b)=>a.ders.localeCompare(b.ders));

  if(!filtered.length){
    list.innerHTML='<div style="text-align:center;padding:48px;color:var(--text-muted)"><div style="font-size:48px;margin-bottom:12px">🎉</div><div style="font-size:16px;font-weight:600">Harika! Hiç hatalı sorun yok.</div></div>';
    return;
  }
  const dersRenkler={mat:'var(--mat)',fiz:'var(--fiz)',kim:'var(--kim)',bio:'var(--bio)',tar:'var(--tar)',edb:'var(--edb)'};
  filtered.forEach((h,i)=>{
    const card=document.createElement('div');
    card.className='hatali-card';
    card.innerHTML=`
      <div class="hatali-ders-dot" style="background:${dersRenkler[h.ders]||'var(--mat)'}"></div>
      <div class="hatali-info">
        <div class="hatali-breadcrumb">${h.dersAd} → ${h.konu}</div>
        <div class="hatali-soru-no">Soru ${h.soruEtiket || h.soruNo}</div>
        <div class="hatali-meta">${h.tarih} · <span>${h.yanlisSayisi}× yanlış</span></div>
      </div>
      <div class="hatali-actions">
        <button class="hatali-action ha-pdf" onclick="openHataliInReader(${appState.hatalilar.indexOf(h)})">📄 PDF'de Gör</button>
        <button class="hatali-action ha-ok" onclick="removeHatali(${appState.hatalilar.indexOf(h)});showToast('Öğrenildi olarak işaretlendi ✅','success')">✅ Öğrendim</button>
        <button class="hatali-action ha-sil" onclick="removeHatali(${appState.hatalilar.indexOf(h)})">🗑️</button>
      </div>`;
    list.appendChild(card);
  });
}
function removeHatali(idx){
  appState.hatalilar.splice(idx,1);
  document.getElementById('hataliCount').textContent=appState.hatalilar.length;
  document.getElementById('hataliCountBig').textContent=`${appState.hatalilar.length} Soru`;
  renderHatalilar();
  showToast('Hatalılar defterinden kaldırıldı','info');
}
function startTekrarModu(){
  if(!appState.hatalilar.length){ showToast('Hatalılar listeniz boş!','info'); return; }
  // Build a virtual alt konu from hatalilar
  const allSorular = [];
  appState.hatalilar.forEach(h => {
    // Try to find in manifest
    for(const ders of MANIFEST.dersler){
      for(const fas of ders.fasikuller||[]){
        for(const konu of fas.konular||[]){
          for(const ak of konu.altKonular||[]){
            const s = ak.sorular?.find(q=>q.no===h.soruNo);
            if(s) { allSorular.push({...s, sayfa: s.sayfa||ak.sayfa, _dersId:ders.id, _fasId:fas.id}); }
          }
        }
      }
    }
  });
  if(!allSorular.length){
    // Create dummy questions from hatalilar
    appState.hatalilar.forEach(h=>{
      allSorular.push({no:h.soruNo, onizleme:`Soru ${h.soruNo} — ${h.konu}`, cevap:'A', zorluk:'orta', sayfa:1});
    });
  }
  // Pick first ders/fasikul as context (or use mat/analitik as fallback)
  const firstH = appState.hatalilar[0];
  let contextDers = MANIFEST.dersler.find(d=>d.id===firstH.ders)||MANIFEST.dersler[0];
  let contextFas = contextDers.fasikuller[0];

  appState.aktifDers = contextDers;
  appState.aktifFasikul = contextFas;
  appState.aktifAltKonu = {
    id:'tekrar-modu',
    ad:`Tekrar Modu (${allSorular.length} Hatalı Soru)`,
    sayfa:1,
    sorular:allSorular
  };
  appState.sorularState = {};
  appState.activeQuestionIdx = 0;

  // Open reader
  openReader(contextDers, contextFas);

  setTimeout(()=>{
    updateRightPanelTitle('🔁 Tekrar Modu');
    renderSoruList(allSorular);
    const startBtn = document.getElementById('startTestBtn');
    startBtn.classList.add('tekrar-modu-active');
    showToast(`Tekrar modu: ${allSorular.length} hatalı soru yüklendi 🔁`, 'info');
  }, 300);
}

// ══════════════════════════════
// MODALS
// ══════════════════════════════
function closeModal(id){ document.getElementById(id).classList.remove('open'); }
function showKbModal(){ document.getElementById('kbModal').classList.add('open'); }

// ══════════════════════════════
// TOAST
// ══════════════════════════════
function showToast(msg, type='info'){
  const container=document.getElementById('toastContainer');
  const toast=document.createElement('div');
  toast.className=`toast toast-${type}`;
  const icons={success:'✅',error:'❌',info:'ℹ️'};
  toast.innerHTML=`<span>${icons[type]||'ℹ️'}</span><span style="flex:1">${msg}</span><span class="toast-close" onclick="this.parentElement.remove()">×</span>`;
  container.appendChild(toast);
  setTimeout(()=>{ toast.classList.add('hiding'); setTimeout(()=>toast.remove(),300); },3500);
}

// ══════════════════════════════
// KEYBOARD SHORTCUTS
// ══════════════════════════════
document.addEventListener('keydown', e=>{
  // Reader shortcuts
  if(document.getElementById('reader-overlay').classList.contains('open')){
    if(window.isFabricTextEditing?.()){
      if(e.ctrlKey && e.key==='s'){
        e.preventDefault();
        window.flushActiveTextEditing?.();
        showToast('Çizimler kaydedildi ✓','success');
      }
      return;
    }
    // A-E answer
    if(['A','B','C','D','E'].includes(e.key.toUpperCase()) && !e.ctrlKey && !e.altKey){
      if(document.activeElement.tagName==='INPUT'||document.activeElement.tagName==='TEXTAREA') return;
      const sorular=appState.aktifAltKonu?.sorular||[];
      const s=sorular[appState.activeQuestionIdx];
      if(s&&!appState.sorularState[s._uid||s.no]?.answered){
        selectAnswer(s._uid||s.no,e.key.toUpperCase(),s.cevap,appState.activeQuestionIdx);
        e.preventDefault();
      }
    }
    if(e.key==='ArrowRight'&&!e.ctrlKey) nextQuestion();
    if(e.key==='ArrowLeft'&&!e.ctrlKey) prevQuestion();
    if(e.key===' '&&!e.ctrlKey){ e.preventDefault(); nextQuestion(); }
    if(e.key==='ArrowRight'&&e.ctrlKey){ e.preventDefault(); changePage(1); }
    if(e.key==='ArrowLeft'&&e.ctrlKey){ e.preventDefault(); changePage(-1); }
    if(e.key==='Escape' && !document.fullscreenElement) closeReader();
    if(e.key==='F11'){ e.preventDefault(); toggleFullscreen(); }
    if(e.ctrlKey&&e.key==='z'){ e.preventDefault(); undoDraw(); }
    if(e.ctrlKey&&(e.key==='y'||e.key==='Y')){ e.preventDefault(); redoDraw(); }
    if(e.ctrlKey&&e.key==='s'){ e.preventDefault(); saveDrawing(); showToast('Çizimler kaydedildi ✓','success'); }
    const typingTarget = document.activeElement?.tagName === 'INPUT'
      || document.activeElement?.tagName === 'TEXTAREA'
      || document.activeElement?.isContentEditable;
    if(!typingTarget && e.key==='p'&&!e.ctrlKey){ const btn=document.querySelector('[data-tool="pen"]'); if(btn) setTool(btn,'pen'); }
    if(!typingTarget && e.key==='e'&&!e.ctrlKey){ const btn=document.querySelector('[data-tool="eraser"]'); if(btn) setTool(btn,'eraser'); }
  } else if(e.key==='F11'){
    e.preventDefault();
    toggleAppFullscreen();
  }
});

let readerResizeTimer = null;
window.addEventListener('resize', ()=>{
  if(!document.getElementById('reader-overlay')?.classList.contains('open')) return;
  if(readerResizeTimer) clearTimeout(readerResizeTimer);
  readerResizeTimer = setTimeout(()=>renderPages(), 180);
});
// ══════════════════════════════
// DATA RESET
// ══════════════════════════════
// ── Edu-Fasikul Lokal Klasör Yönetimi ─────────────────────────

const FASIKUL_PDF_MAP = {};
BUNDLED_FASIKUL_SOURCES.forEach(s=>{ FASIKUL_PDF_MAP[s.id]=s.pdf; });

function openHandleDB(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('EduFasikulHandles',1);
    request.onupgradeneeded=()=>{ if(!request.result.objectStoreNames.contains('handles')) request.result.createObjectStore('handles'); };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
async function saveEduDirHandle(handle){
  const db=await openHandleDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('handles','readwrite');
    tx.objectStore('handles').put(handle,'edu-directory');
    tx.oncomplete=()=>{db.close();resolve();};
    tx.onerror=()=>{db.close();reject(tx.error);};
  });
}
async function loadEduDirHandle(){
  const db=await openHandleDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('handles','readonly');
    const request=tx.objectStore('handles').get('edu-directory');
    request.onsuccess=()=>resolve(request.result||null);
    request.onerror=()=>reject(request.error);
    tx.oncomplete=()=>db.close();
  });
}
async function restoreEduDirHandle(){
  if(!('showDirectoryPicker' in window)){
    await updateEduDirUI();
    return;
  }
  try{
    const handle=await loadEduDirHandle();
    if(!handle) return;
    appState.eduDirHandle=handle;
    appState.eduDirPermission=await handle.queryPermission({mode:'read'});
    await updateEduDirUI();
  }catch(e){}
}

async function selectEduDir(){
  if(!('showDirectoryPicker' in window)){
    document.getElementById('eduPdfFilesInput')?.click();
    return;
  }
  try{
    const handle=await window.showDirectoryPicker({id:'edu-fasikul-pdf-folder',mode:'read'});
    appState.eduDirHandle = handle;
    appState.eduDirPermission = 'granted';
    await saveEduDirHandle(handle);
    localStorage.setItem('edu_dir_name', handle.name);
    showToast(`✓ "${handle.name}" klasörü bağlandı`,'success');
    await updateEduDirUI();
    if(document.getElementById('fasikulModal')?.classList.contains('open')){
      await populateFasikulSourceSelect(document.getElementById('fasikulEditId')?.value || '');
    }
  } catch(e){
    if(e.name !== 'AbortError') showToast('Klasör seçimi iptal edildi','info');
  }
}

async function updateEduDirUI(){
  const statusEl = document.getElementById('eduDirStatus');
  const subStatusEl = document.getElementById('eduDirSubStatus');
  const listEl   = document.getElementById('eduDirFileList');
  const buttonEl = document.getElementById('eduDirButton');
  const helpEl = document.getElementById('eduDirHelp');
  const titleEl = document.getElementById('eduDirTitle');
  if(!statusEl) return;
  refreshProfileGithubJsonTools();

  const allFasikuller = MANIFEST.dersler.flatMap(d=>d.fasikuller).filter(f=>f.pdfFile||FASIKUL_PDF_MAP[f.id]);

  // Safari/iPadOS kullanıcı klasörünü web sayfasına bağlayamaz.
  // Aynı deneyimi, PDF'leri bir kez topluca seçip IndexedDB'de saklayarak sağlıyoruz.
  if(!('showDirectoryPicker' in window)){
    if(titleEl) titleEl.textContent='📱 PDF Dosyaları';
    if(helpEl) helpEl.innerHTML = `<b style="color:var(--text-0)">iPad'de bir kez yapmanız yeterli:</b><br>Files uygulamasından Edu-Fasikul PDF'lerinizi topluca seçin. Uygulama dosyaları adlarına göre fasiküllerle eşleştirip bu cihazda saklar.<br><br><b style="color:var(--green)">✓ JSON dosyaları</b> GitHub'dan otomatik indirilir.`;
    const cachedKeys = await getCachedPDFKeys();
    const foundCount = allFasikuller.filter(f=>cachedKeys.has(getPdfStorageKeyForFasikul(f))).length;
    statusEl.innerHTML = foundCount
      ? `<b style="color:var(--green)">✓ ${foundCount} PDF</b> bu cihazda hazır`
      : 'PDF dosyaları seçilmedi';
    if(subStatusEl) subStatusEl.textContent = foundCount ? 'Yeni dosyalar ekleyebilir veya mevcutları yenileyebilirsiniz' : 'Files uygulamasından PDF dosyalarınızı seçin';
    if(buttonEl) buttonEl.textContent = foundCount ? 'PDF’leri Güncelle' : 'PDF’leri Seç';
    listEl.innerHTML = `<div class="edu-dir-summary"><b>${foundCount}/${allFasikuller.length}</b> PDF hazır${foundCount===allFasikuller.length ? '<span>Tüm dosyalar hazır</span>' : `<span>${allFasikuller.length-foundCount} dosya eksik</span>`}</div>`;
    listEl.style.display = 'block';
    return;
  }

  if(!appState.eduDirHandle){
    statusEl.textContent = 'Klasör bağlı değil';
    if(subStatusEl) subStatusEl.textContent='PDF klasörünüzü seçin';
    if(buttonEl) buttonEl.textContent='Klasör Seç';
    listEl.style.display = 'none';
    return;
  }

  const permission=await appState.eduDirHandle.queryPermission({mode:'read'});
  appState.eduDirPermission=permission;
  if(permission!=='granted'){
    statusEl.innerHTML=`<b>${appState.eduDirHandle.name}</b> · izin gerekli`;
    if(buttonEl) buttonEl.textContent='İzni Etkinleştir';
    listEl.style.display='none';
    return;
  }

  statusEl.innerHTML = `<b style="color:var(--green)">✓ ${appState.eduDirHandle.name}</b> bağlandı`;
  if(buttonEl) buttonEl.textContent='Klasörü Değiştir';

  // Her beklenen PDF dosyasını kontrol et
  let foundCount = 0;
  const missing = [];
  for(const fas of allFasikuller){
    const pdfName = fas.pdfFile || FASIKUL_PDF_MAP[fas.id] || (fas.id + '.pdf');
    let found = false;
    try{
      await findPdfFileHandle(pdfName);
      found = true;
    } catch(e){ found = false; }
    if(found) foundCount++; else missing.push(pdfName);
  }
  const total=allFasikuller.length;
  listEl.innerHTML = `<div class="edu-dir-summary"><b>${foundCount}/${total}</b> PDF bulundu${missing.length ? `<span>${missing.length} dosya eksik</span>` : '<span>Tüm dosyalar hazır</span>'}</div>`;
  listEl.style.display = 'block';
}

function getPdfStorageKeyForFasikul(fasikul){
  const ders = MANIFEST.dersler.find(d=>(d.fasikuller||[]).some(f=>f.id===fasikul.id));
  return ders ? `${ders.id}_${fasikul.id}` : '';
}

async function handleBulkPdfImport(input){
  const files = [...(input.files||[])].filter(file=>file.type==='application/pdf' || /\.pdf$/i.test(file.name));
  input.value='';
  if(!files.length){
    showToast('PDF dosyası seçilmedi','info');
    return;
  }

  const candidates = MANIFEST.dersler.flatMap(d=>(d.fasikuller||[]).map(f=>({ders:d,fas:f})));
  let matched=0;
  for(const file of files){
    const fileKey=normalizePdfFileName(file.name);
    const match=candidates.find(({fas})=>{
      const expected=fas.pdfFile || FASIKUL_PDF_MAP[fas.id] || `${fas.id}.pdf`;
      return normalizePdfFileName(expected)===fileKey;
    });
    if(!match) continue;
    await savePDFToDB(match.ders.id,match.fas.id,file);
    matched++;
  }

  try{ await navigator.storage?.persist?.(); }catch(e){}
  await updateEduDirUI();
  if(document.getElementById('fasikulModal')?.classList.contains('open')){
    await populateFasikulSourceSelect(document.getElementById('fasikulEditId')?.value || '');
  }
  if(matched) showToast(`✓ ${matched} PDF fasiküllerle eşleştirildi`,'success');
  else showToast('Seçilen PDF adları GitHub fasikülleriyle eşleşmedi','error');
}

function normalizePdfFileName(name){
  return String(name||'')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .replace(/[ıİ]/g,'i')
    .replace(/[ğĞ]/g,'g')
    .replace(/[üÜ]/g,'u')
    .replace(/[şŞ]/g,'s')
    .replace(/[öÖ]/g,'o')
    .replace(/[çÇ]/g,'c')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/^-+|-+$/g,'');
}

async function findPdfFileHandle(pdfName){
  if(!appState.eduDirHandle) throw new Error('Klasör yok');
  try{ return await appState.eduDirHandle.getFileHandle(pdfName); }catch(e){}
  const wanted=String(pdfName).normalize('NFC').toLocaleLowerCase('tr-TR');
  const wantedLoose=normalizePdfFileName(pdfName);
  for await(const entry of appState.eduDirHandle.values()){
    if(entry.kind!=='file') continue;
    if(entry.name.normalize('NFC').toLocaleLowerCase('tr-TR')===wanted) return entry;
    if(normalizePdfFileName(entry.name)===wantedLoose) return entry;
  }
  throw new Error('PDF bulunamadı');
}

async function hasLocalPdfFile(pdfName){
  if(!appState.eduDirHandle) return false;
  try{
    const permission=await appState.eduDirHandle.queryPermission({mode:'read'});
    if(permission!=='granted') return false;
    await findPdfFileHandle(pdfName);
    return true;
  }catch(e){
    return false;
  }
}
// dashboard.js (ayrı modül) populateFasikulSourceSelect içinde bare
// "hasLocalPdfFile(...)" ile çağırıyor — window'a bağlanmazsa ReferenceError
// fırlatıp (klasör bağlıyken) Promise.all'u tamamen reddedip "Fasikül
// kaynağı seçin" listesini BOŞ bırakıyordu.
window.hasLocalPdfFile = hasLocalPdfFile;

async function getLocalPdfBlob(fasikul){
  if(!appState.eduDirHandle) return null;
  const permission=await appState.eduDirHandle.queryPermission({mode:'read'});
  if(permission!=='granted') return null;
  const pdfName = fasikul.pdfFile || FASIKUL_PDF_MAP[fasikul.id] || (fasikul.id + '.pdf');
  try{
    const fileHandle = await findPdfFileHandle(pdfName);
    const file = await fileHandle.getFile();
    return URL.createObjectURL(file);
  } catch(e){ return null; }
}

function getFasikulPdfUrl(fasikul){
  if(!fasikul) return null;
  if(fasikul.pdfUrl) return fasikul.pdfUrl;
  return null;
}

async function ensureReaderPdfLoaded(targetPage=1){
  const fas = appState.aktifFasikul;
  if(!fas) return false;
  if(appState.pdfDoc && appState.pdfDocFasikulId === fas.id){
    goToPage(targetPage);
    return true;
  }

  // 1. Önce kullanıcının bir kez bağladığı PDF klasörüne bak.
  let url = null;
  if(appState.eduDirHandle){
    url = await getLocalPdfBlob(fas);
    if(url) showToast(`📁 PDF lokal klasörden açılıyor…`,'info');
  }
  // 2. iPad/Safari'de profilden bir kez seçilip cihazda saklanan PDF'ye bak.
  if(!url && appState.aktifDers){
    let cached = await getPDFFromDB(appState.aktifDers.id,fas.id);
    // Fasikül sonradan başka bir ders kartına eklenmiş olsa bile PDF,
    // katalogdaki asıl kaynak anahtarıyla bulunabilsin.
    if(!cached){
      const source=BUNDLED_FASIKUL_SOURCES.find(s=>s.id===fas.id);
      if(source) cached=await getPDFFromDB(source.dersId,fas.id);
    }
    if(cached?.blob){
      url=URL.createObjectURL(cached.blob);
      showToast(`📱 PDF bu cihazdan açılıyor…`,'info');
    }
  }
  // 3. Yalnızca özel olarak tanımlanmış bir uzak URL varsa onu kullan.
  if(!url) url = getFasikulPdfUrl(fas);

  if(!url){
    document.getElementById('pdfUploadZone').style.display = '';
    document.getElementById('readerCanvasWrap').style.display = 'none';
    showToast('PDF bulunamadı. Profil sayfasından PDF klasörünü veya dosyalarını seçin.','info');
    return false;
  }
  try{
    return await loadPDFUrl(url, targetPage);
  }catch(e){
    showToast('PDF açılamadı. Dosyayı kontrol edin.','error');
    return false;
  }
}


function findHataliContext(h){
  const wantedKeys = [h.soruKey, h.uid, h.soruNo].filter(v=>v!==undefined && v!==null).map(v=>String(v));
  for(const ders of MANIFEST.dersler){
    if(h.ders && ders.id !== h.ders) continue;
    for(const fas of ders.fasikuller||[]){
      if(h.fasikulId && fas.id !== h.fasikulId) continue;
      if(!h.fasikulId && h.fasikulAd && fas.ad !== h.fasikulAd) continue;
      for(const konu of fas.konular||[]){
        if(h.konuId && konu.id !== h.konuId) continue;
        for(const ak of konu.altKonular||[]){
          if(h.altKonuId && ak.id !== h.altKonuId) continue;
          const s = ak.sorular?.find(q=>{
            const modernKey = `${fas.id}__${ak.id}_${q.no}`;
            const legacyKey = `${ak.id}_${q.no}`;
            const qKey = String(q._uid || modernKey);
            const qNo = String(q.no);
            return wantedKeys.includes(qKey)
              || wantedKeys.includes(legacyKey)
              || wantedKeys.includes(qNo)
              || (h.sayfa && Number(q.sayfa || ak.sayfa) === Number(h.sayfa));
          });
          if(s){
            s._uid = `${fas.id}__${ak.id}_${s.no}`;
            if(!s.sayfa && ak.sayfa) s.sayfa = ak.sayfa;
            return {ders, fas, konu, ak, s, page:s.sayfa || ak.sayfa || h.sayfa || 1};
          }
        }
      }
    }
  }
  return null;
}

async function openHataliInReader(idx){
  const h = appState.hatalilar[idx];
  if(!h) return;
  const ctx = findHataliContext(h);
  if(ctx){
    openReader(ctx.ders.id, ctx.fas.id);
    appState.aktifKonu = ctx.konu;
    const select = document.getElementById('anaKonuSelect');
    if(select) select.value = ctx.konu.id;
    renderAltKonuList(ctx.konu);
    selectAltKonu(ctx.ak, `altk-${ctx.ak.id}`);
    const opened = await ensureReaderPdfLoaded(ctx.page);
    if(opened){
      goToPage(ctx.page);
      showToast(`Soru ${h.soruEtiket || ctx.s.no} PDF'de açıldı`,'success');
    }
    return;
  }
  showToast('PDF sayfası bulunamadı','error');
}

async function resetAllData(){
  if(!confirm('Tüm veriler (hatalılar, cevaplar, çizimler, ders/fasikül değişiklikleri ve yüklenen JSON\'lar) silinecek. Bu işlem geri alınamaz. Emin misiniz?')) return;

  // 1) Bellek temizle
  appState.hatalilar = [];
  appState.sorularState = {};
  appState.drawings = {};
  appState.cloudIstatistik = null;
  appState.cloudSolutionsLoaded = false;

  // 2) localStorage temizle
  const keysToRemove = [];
  for(let i=0;i<localStorage.length;i++){
    const k = localStorage.key(i);
    if(k && (k.startsWith('edu_konular_') || k==='edu_hatalilar' || k==='edu_sorularState' || k==='edu_manifest_meta' || k==='edu_deleted_dersler')) keysToRemove.push(k);
  }
  keysToRemove.forEach(k=>localStorage.removeItem(k));

  // 3) Manifest konularını ve ilerlemeyi sıfırla
  MANIFEST.dersler.forEach(d=>{
    d.progPct = 0;
    d.fasikuller.forEach(f=>{ f.konular=[]; f.progPct=0; f._solvedCount=0; f.sonCalisma='—'; });
  });
  document.getElementById('hataliCount').textContent = '0';
  document.getElementById('hataliCountBig').textContent = '0 Soru';

  // 4) Firestore temizle (cozumler + cizimler alt koleksiyonları + istatistik alanı)
  const uid = _getUserKey();
  if(uid && window._firestoreReady){
    showToast('Bulut verileri siliniyor…','info');
    try{
      // cozumler alt koleksiyonu
      const cSnap = await window._fsGetDocs(window._fsCollection(window._db,'kullanicilar',uid,'cozumler'));
      const cDels=[]; cSnap.forEach(d=>cDels.push(window._fsDeleteDoc(d.ref)));
      await Promise.all(cDels);
      // cizimler alt koleksiyonu
      const dSnap2 = await window._fsGetDocs(window._fsCollection(window._db,'kullanicilar',uid,'cizimler'));
      const dDels=[]; dSnap2.forEach(d=>dDels.push(window._fsDeleteDoc(d.ref)));
      await Promise.all(dDels);
      // Ana belgedeki istatistik, hatalilar, fasikulIstatistik alanlarını sıfırla
      const emptyStats = {toplam:0,dogru:0,yanlis:0,bos:0,konular:{}};
      await window._fsSetDoc(_userDocRef(uid),{
        hatalilar:[],
        istatistik: emptyStats,
        fasikulIstatistik:{},
        guncelleme: new Date().toISOString()
      },{merge:true});
    }catch(e){ console.warn('Firestore sıfırlama hatası:',e); showToast('Bulut temizleme kısmi başarısız','error'); }
  }

  // 5) Demo modu kapat
  applyDemoMode(false);
  const demoToggle = document.getElementById('demoDataToggle');
  if(demoToggle){ demoToggle.textContent='Kapalı'; demoToggle.classList.add('off'); }
  localStorage.setItem('edu_demo_mode','0');

  recalcFasikulProgress();
  updateDashboard();
  renderDerslerGrid();
  showToast('Tüm veriler sıfırlandı 🗑️','success');
}

// ══════════════════════════════
// STATS RENDER
// ══════════════════════════════
const DEMO_STATS = {
  streak:7, streakDelta:'↗ Devam et!',
  totalSolved:142, solvedDelta:'↗ +12 bugün',
  weekly:38, weeklyDelta:'↗ +8 geçen hafta',
  accuracy:'%74', accuracyDelta:'↗ +5% geçen ay',
  kpiSolved:142, kpiSolvedSub:'↗ Bu hafta +38',
  kpiAccuracy:'%74', kpiAccuracySub:'↗ +5% geçen haftaya',
  kpiTime:'18s', kpiTimeSub:'Bu ay 18 saat',
  kpiLongest:'12🔥', kpiLongestSub:'Kişisel rekor'
};
// ══════════════════════════════
// DERS CRUD
// ══════════════════════════════
// ══════════════════════════════
// FASİKÜL CRUD
// ══════════════════════════════
// ══════════════════════════════
// KÜTÜPHANE MODAL — Bundled fasiküllerden ekleme/çıkarma
// ══════════════════════════════
let _kutuphaneFasikulAll = []; // {source, raw, ders (config)}

function _buildKutuphaneBtns(source, existingDersIds){
  // Her ders için ekle/çıkar butonu
  const targetDers = document.getElementById('kutuphaneFasikulModal')?.dataset?.targetDers;
  let btns = '';

  MANIFEST.dersler.forEach(ders=>{
    const isIn = existingDersIds.includes(ders.id);
    const highlight = ders.id === targetDers ? 'font-weight:700;' : '';
    if(isIn){
      btns += `<button onclick="kutuphaneCikar('${source.id}','${ders.id}')" title="${ders.ad}'dan çıkar"
        style="${highlight}padding:4px 8px;border-radius:6px;font-size:10px;background:var(--red-dim);color:var(--red);cursor:pointer;border:none;white-space:nowrap">
        ✕ ${ders.ikon||ders.ad}</button>`;
    } else {
      btns += `<button onclick="kutuphaneDersEkle('${source.id}','${ders.id}')" title="${ders.ad}'a ekle"
        style="${highlight}padding:4px 8px;border-radius:6px;font-size:10px;background:var(--bg-4);color:var(--text-1);cursor:pointer;border:none;white-space:nowrap">
        + ${ders.ikon||ders.ad}</button>`;
    }
  });
  return btns;
}

// ══════════════════════════════
// JSON YÜKLEME (Fasikül Konuları)
// ══════════════════════════════
function slugifyId(text, fallback='item'){
  return String(text || fallback)
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/ı/g,'i').replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s').replace(/ö/g,'o').replace(/ç/g,'c')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || fallback;
}

function derivePdfNameFromJson(jsonName){
  return String(jsonName || '').replace(/\.json$/i, '.pdf');
}
function normalizeGithubJsonFileName(value){
  const name = String(value || '').trim().normalize('NFC');
  if(!name) return '';
  if(/\.json$/i.test(name)) return name;
  if(/\.js$/i.test(name)) return name.replace(/\.js$/i, '.json');
  return `${name.replace(/\.+$/,'')}.json`;
}
function normalizeGithubPdfFileName(value, jsonName){
  const name = String(value || '').trim().normalize('NFC');
  if(/\.pdf$/i.test(name)) return name;
  return derivePdfNameFromJson(jsonName);
}
function ensureGithubSourceId(jsonName, fallback='fasikul'){
  return slugifyId(String(jsonName || '').replace(/\.json$/i, ''), fallback);
}
function populateProfileGithubDersSelect(){
  const select = document.getElementById('profileGithubJsonDers');
  if(!select) return;
  const current = select.value || 'mat';
  select.innerHTML = MANIFEST.dersler.map(d=>`<option value="${d.id}">${d.ad}</option>`).join('');
  if([...select.options].some(o=>o.value===current)) select.value = current;
}
function isProfileGithubAdmin(){
  const email = String(appState.user?.email || '').toLowerCase();
  const roleText = document.getElementById('profileSub')?.textContent || '';
  return appState.user?.role === 'admin' || email === ADMIN_EMAIL || roleText.includes('Yönetici');
}
function refreshProfileGithubJsonTools(){
  const box = document.getElementById('profileGithubJsonTools');
  if(!box) return;
  const isAdmin = isProfileGithubAdmin();
  box.style.display = isAdmin ? '' : 'none';
  if(isAdmin) populateProfileGithubDersSelect();
}
function setProfileGithubJsonStatus(message, tone='muted'){
  const el = document.getElementById('profileGithubJsonStatus');
  if(!el) return;
  el.textContent = message;
  el.dataset.tone = tone;
}
async function addProfileGithubJsonFasikul(){
  if(!isProfileGithubAdmin()){
    showToast('Bu işlem sadece admin için açık','error');
    return;
  }
  const dersId = document.getElementById('profileGithubJsonDers')?.value || 'mat';
  const tipSel = document.getElementById('profileGithubJsonTip')?.value || 'auto';
  const jsonInput = document.getElementById('profileGithubJsonFile');
  const pdfInput = document.getElementById('profileGithubPdfFile');
  const idInput = document.getElementById('profileGithubSourceId');
  const json = normalizeGithubJsonFileName(jsonInput?.value || '');
  const pdf = normalizeGithubPdfFileName(pdfInput?.value || '', json);
  const id = ensureGithubSourceId((idInput?.value || '').trim() || json, 'github-fasikul');
  if(jsonInput) jsonInput.value = json;
  if(pdfInput) pdfInput.value = pdf;
  if(!json.endsWith('.json')){
    setProfileGithubJsonStatus('JSON dosya adı .json ile bitmeli.', 'error');
    showToast('JSON dosya adı .json olmalı','error');
    return;
  }
  if(!pdf.endsWith('.pdf')){
    setProfileGithubJsonStatus('PDF dosya adı .pdf ile bitmeli.', 'error');
    showToast('PDF dosya adı .pdf olmalı','error');
    return;
  }
  const source = { id, dersId, json, pdf, custom:true };
  if(tipSel==='tip1') source.fasikulTip = tipSel;
  setProfileGithubJsonStatus('GitHub JSON okunuyor ve format kontrol ediliyor...', 'loading');
  try{
    bundledSourceCache.delete(json);
    const raw = await readBundledJson(source);
    if(!raw || !Array.isArray(raw.konular)){
      setProfileGithubJsonStatus('Geçersiz JSON: konular dizisi bulunamadı veya dosya okunamadı.', 'error');
      showToast('JSON okunamadı veya format hatalı','error');
      return;
    }
    // Otomatik seçiliyse şemadan algıla; kaynağa yaz ki sonraki açılışlarda sabit kalsın.
    if(!source.fasikulTip) source.fasikulTip = 'tip1';
    const savedSource = saveCustomGithubSource(source);
    let ders = MANIFEST.dersler.find(d=>d.id===dersId);
    if(!ders){
      const cfg = BUNDLED_DERS_CONFIG[dersId] || BUNDLED_DERS_CONFIG.mat;
      ders = {id:dersId,ad:cfg.ad,ikon:cfg.ikon,renk:cfg.renk,progPct:0,fasikuller:[]};
      MANIFEST.dersler.push(ders);
    }
    let fas = ders.fasikuller.find(f=>f.id===id || f.jsonFile===json);
    if(!fas){
      fas = {id,progPct:0,sonCalisma:'Henüz çalışılmadı',temaRenk:null};
      ders.fasikuller.push(fas);
    }
    hydrateBundledFasikul(fas, raw, savedSource);
    FASIKUL_PDF_MAP[fas.id] = pdf;
    persistManifest();
    renderDerslerGrid();
    refreshProfileGithubJsonTools();
    setProfileGithubJsonStatus(`Eklendi: ${fas.ad} (${fas.soruSayisi || 0} soru). PDF dosyası klasörde "${pdf}" adıyla bulunmalı.`, 'success');
    showToast('GitHub JSON fasikülü eklendi ✓','success');
  }catch(e){
    setProfileGithubJsonStatus(`JSON eklenemedi: ${e.message || e}`, 'error');
    showToast('JSON eklenemedi','error');
  }
}

function normalizeFasikulKonular(konular){
  if(!Array.isArray(konular)) return [];
  konular.forEach((k, konuIdx) => {
    k.id = k.id || `konu-${konuIdx + 1}-${slugifyId(k.ad, 'konu')}`;
    if(!k.altKonular && k.sorular && k.sorular.length > 0) {
      k._kartBazliKonu = true;
      k.altKonular = [{
        id: `${k.id}-sorular`,
        ad: k.ad,
        sayfa: k.sayfaBasl || (k.sorular[0]?.sayfa) || 1,
        _kartBazli: true,
        sorular: k.sorular.map(s => ({
          ...s,
          onizleme: s.onizleme || (k.ad + ' S.' + s.no),
          zorluk: s.zorluk || 'orta'
        }))
      }];
    }
    (k.altKonular || []).forEach((ak, altIdx) => {
      ak.id = ak.id || `${k.id}-alt-${altIdx + 1}-${slugifyId(ak.ad, 'alt')}`;
      const sorular = ak.sorular || [];
      // Bazı formatlarda (ör. kart bazlı "Aktif" fasikülleri) gerçek PDF sayfası
      // "pdfSayfa" alanında tutulur. Önce bunu "sayfa"ya taşı — aksi halde aşağıdaki
      // ardışık sayaç (ak.sayfa+soruIdx) devreye girip yanlış sayfaya yönlendirir ve
      // toplam sayfa sayısı (getManifestMaxPage) da hatalı hesaplanır.
      sorular.forEach(s => { if(!s.sayfa && s.pdfSayfa) s.sayfa = s.pdfSayfa; });
      const firstPage = sorular.find(s=>s.sayfa)?.sayfa || ak.sayfa || k.sayfaBasl || 1;
      ak.sayfa = ak.sayfa || firstPage;
      sorular.forEach((s, soruIdx) => {
        s.no = s.no ?? (soruIdx + 1);
        s.sayfa = s.sayfa || (ak.sayfa ? ak.sayfa + soruIdx : undefined);
        s._uid = s._uid || `${ak.id}_${s.no}`;
        s.onizleme = s.onizleme || `${k.ad} - ${ak.ad} Soru ${s.no}`;
        s.zorluk = s.zorluk || 'orta';
      });
    });
    const pages = (k.altKonular || []).flatMap(ak => (ak.sorular || []).map(s=>s.sayfa).filter(Boolean));
    if(pages.length){
      k.sayfaBasl = k.sayfaBasl || Math.min(...pages);
      k.sayfaBitis = k.sayfaBitis || Math.max(...pages);
    }
  });
  return konular;
}

/**
 * Beklenen JSON formatı (üç seçenek desteklenir):
 *
 * FORMAT 1 — Direkt konular dizisi:
 * [ { id, ad, sayfaBasl, sayfaBitis, altKonular: [ { id, ad, sayfa, sorular: [ {no, onizleme, cevap, zorluk} ] } ] } ]
 *
 * FORMAT 2 — Fasikül wrapper (çoklu soru: bir sayfada birden fazla soru):
 * { ad, sinif, soruSayisi, konuSayisi, konular: [ { id, ad, sayfaBasl, sayfaBitis, altKonular: [...] } ] }
 *
 * FORMAT 3 — Kart bazlı (her sayfada bir soru) — OTOMATİK normalize edilir:
 * { ad, sinif, ..., konular: [ { id, ad, sayfaBasl, sayfaBitis, sorular: [ {no, sayfa, cevap} ] } ] }
 * Not: altKonular YOKSA ve sorular varsa → otomatik kart bazlı mod aktif olur.
 */
function handleJSONUpload(input, dersId, fasikulId){
  const file = input.files[0];
  if(!file) return;
  if(!file.name.endsWith('.json')){ showToast('Lütfen .json dosyası seç','error'); return; }

  const reader = new FileReader();
  reader.onload = (e) => {
    try{
      const raw = JSON.parse(e.target.result);
      const ders = MANIFEST.dersler.find(d=>d.id===dersId);
      if(!ders){ showToast('Ders bulunamadı','error'); return; }
      const fas = ders.fasikuller.find(f=>f.id===fasikulId);
      if(!fas){ showToast('Fasikül bulunamadı','error'); return; }

      // Format tespiti
      let konular;
      if(Array.isArray(raw)){
        konular = raw; // FORMAT 1
      } else if(raw.konular && Array.isArray(raw.konular)){
        konular = raw.konular; // FORMAT 2
        // Wrapper meta bilgilerini de güncelle
        if(raw.ad) fas.ad = raw.ad;
        if(raw.sinif) fas.sinif = raw.sinif;
        if(raw.soruSayisi) fas.soruSayisi = raw.soruSayisi;
        if(raw.konuSayisi !== undefined) fas.konuSayisi = raw.konuSayisi;
        if(raw.thumb) fas.thumb = raw.thumb;
      } else {
        showToast('Geçersiz JSON formatı. konular dizisi bulunamadı.','error');
        return;
      }

      // ── JSON FORMAT NORMALİZASYONU ─────────────────────────
      // FORMAT A (Kart): konular[i].altKonular var, sorular[j].sayfa YOK → her altKonu = çoklu soru, aynı sayfada
      // FORMAT B (Tarama): konular[i].altKonular YOK, konular[i].sorular var, her soruda .sayfa → her soru kendi sayfasında
      // FORMAT B → normalize ederek FORMAT A'ya dönüştür: her konu = bir altKonu, her soru = kendi sayfası
      konular = normalizeFasikulKonular(konular);

      // konuSayisi ve soruSayisi otomatik hesapla
      fas.konular = konular;
      fas.konuSayisi = konular.length;
      fas.soruSayisi = konular.reduce((sum, k)=>
        sum + (k.altKonular||[]).reduce((s2, ak)=> s2 + (ak.sorular||[]).length, 0), 0);
      fas.sonCalisma = 'Az önce yüklendi';

      // Okuyucu açıksa konu adlarını kayıt işlemini bekletmeden hemen göster.
      if(appState.aktifDers?.id === dersId && appState.aktifFasikul?.id === fasikulId){
        buildKonuNav(fas);
        updateRightPanelTitle();
      }

      persistKonular(dersId, fasikulId, konular);
      persistManifest();
      renderDerslerGrid();
      renderFasikulCards(ders.fasikuller, ders);
      showToast(`✓ ${fas.ad} — ${fas.konuSayisi} konu, ${fas.soruSayisi} soru yüklendi`, 'success');
    } catch(err){
      showToast('JSON ayrıştırma hatası: ' + err.message, 'error');
    }
  };
  reader.readAsText(file, 'utf-8');
  // input'u sıfırla (aynı dosya tekrar seçilebilsin)
  input.value = '';
}

const KONU_DB_NAME = 'EduFasikulKonular';
const KONU_DB_STORE = 'konular';

function openKonuDB(){
  return new Promise((resolve,reject)=>{
    const request = indexedDB.open(KONU_DB_NAME, 1);
    request.onupgradeneeded = ()=>{
      const db = request.result;
      if(!db.objectStoreNames.contains(KONU_DB_STORE)) db.createObjectStore(KONU_DB_STORE);
    };
    request.onsuccess = ()=>resolve(request.result);
    request.onerror = ()=>reject(request.error);
  });
}

async function saveKonularToDB(key, value){
  const db = await openKonuDB();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(KONU_DB_STORE, 'readwrite');
    tx.objectStore(KONU_DB_STORE).put(value, key);
    tx.oncomplete = ()=>{ db.close(); resolve(); };
    tx.onerror = ()=>{ db.close(); reject(tx.error); };
  });
}

async function loadKonularFromDB(key){
  const db = await openKonuDB();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(KONU_DB_STORE, 'readonly');
    const request = tx.objectStore(KONU_DB_STORE).get(key);
    request.onsuccess = ()=>resolve(request.result || null);
    request.onerror = ()=>reject(request.error);
    tx.oncomplete = ()=>db.close();
  });
}

async function persistKonular(dersId, fasikulId, konular){
  const key = `edu_konular_${dersId}_${fasikulId}`;
  const value = JSON.stringify(konular);
  try{
    await saveKonularToDB(key, value);
    try{ localStorage.setItem(key, value); }catch(e){ /* IndexedDB kaydı yeterli */ }
  }catch(e){
    try{ localStorage.setItem(key, value); }
    catch(storageError){ showToast('Konular cihazda saklanamadı','error'); }
  }
}
// dashboard.js (ayrı modül) saveFasikul/kutuphaneDersEkle içinde bare
// "persistKonular(...)" ile çağırıyor — window'a bağlanmazsa ReferenceError
// fırlatıp konu/soru verisi cihaza HİÇ kaydedilmiyordu.
window.persistKonular = persistKonular;

const bundledSourceCache = new Map();
function sourceFileNameVariants(filename){
  return [...new Set([
    String(filename || ''),
    String(filename || '').normalize('NFC'),
    String(filename || '').normalize('NFD'),
  ].filter(Boolean))];
}
async function fetchGithubJsonVariants(filename){
  const cfg = getGithubConfig();
  if(!cfg.repo || location.protocol === 'file:') return null;
  for(const name of sourceFileNameVariants(filename)){
    try{
      const ctrl = new AbortController();
      const timer = setTimeout(()=>ctrl.abort(), 10000);
      let response;
      try{ response = await fetch(buildGithubRawUrlForName(cfg, name), {signal: ctrl.signal}); }
      finally{ clearTimeout(timer); }
      if(response.ok) return await response.json();
    }catch(e){}
  }
  return null;
}
async function fetchLocalJsonVariants(filename){
  for(const name of sourceFileNameVariants(filename)){
    try{
      const response = await fetch(encodeURIComponent(name));
      if(response.ok) return await response.json();
    }catch(e){}
  }
  return null;
}
async function readBundledJson(source){
  if(bundledSourceCache.has(source.json)) return bundledSourceCache.get(source.json);
  let raw = null;
  // 1. GitHub veya yapılandırılmış URL'den çek
  raw = await fetchGithubJsonVariants(source.json);
  if(!raw) raw = await fetchLocalJsonVariants(source.json);
  // 2. Gzip bundle varsa oradan
  const gzipKey = sourceFileNameVariants(source.json).find(name => window.EDU_FASIKUL_GZIP?.[name]);
  if(!raw && gzipKey){
    try{
      const binary = atob(window.EDU_FASIKUL_GZIP[gzipKey]);
      const bytes = Uint8Array.from(binary, c=>c.charCodeAt(0));
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      raw = JSON.parse(await new Response(stream).text());
    }catch(e){ console.warn('Yerel JSON kataloğu okunamadı:', source.json, e); }
  }
  if(raw) bundledSourceCache.set(source.json, raw);
  return raw;
}
function bundledSinif(value){
  const n = parseInt(value);
  if(Number.isFinite(n)) return n;
  return String(value||'').toUpperCase().includes('LGS') ? 8 : 12;
}
// dashboard.js (ayrı modül) applyBundledSourceToForm/hydrateBundledFasikul
// içinde bare "bundledSinif(...)" ile çağırıyor — window'a bağlanmazsa
// ReferenceError fırlatıp fonksiyonun geri kalanını (sınıf/soru/thumb alan
// doldurma) sessizce iptal ediyordu.
window.bundledSinif = bundledSinif;
function hydrateBundledFasikul(fas,raw,source){
  const konular=normalizeFasikulKonular(raw.konular||[]);
  fas.fasikulTip = 'tip1';
  fas.ad = fas.ad || raw.ad || source.id;
  fas.thumb = fas.thumb || raw.thumb || '📄';
  fas.thumbBg = fas.thumbBg || 'linear-gradient(135deg,#312e81,#1e1b4b)';
  fas.sinif = fas.sinif || bundledSinif(raw.sinif);
  fas.konular = konular;
  fas.konuSayisi = konular.length;
  fas.soruSayisi = konular.reduce((sum,k)=>sum+(k.altKonular||[]).reduce((s,ak)=>s+(ak.sorular||[]).length,0),0);
  fas.jsonFile = source.json;
  fas.pdfFile = source.pdf;
  fas.sourceType = 'bundled';
  if(raw.cozumVideoLinkleri) fas.cozumVideoLinkleri = raw.cozumVideoLinkleri;
  if(raw.tip) fas.tip = raw.tip;
  return fas;
}
async function loadBundledFasikuller(){
  let loaded = 0;
  const deletedIds = getDeletedBundledIds();
  const norm = v => String(v||'').normalize('NFC');
  for(const source of BUNDLED_FASIKUL_SOURCES){
    if(deletedIds.has(source.id)) continue; // admin sildi → geri gelmesin
    const raw = await readBundledJson(source);
    if(!raw || !Array.isArray(raw.konular)) continue;
    // Bu kaynağın TÜM derslerdeki mevcut kopyaları (kullanıcının küratörlüğü).
    const copies=[];
    for(const manifestDers of MANIFEST.dersler){
      for(const fas of manifestDers.fasikuller||[]){
        if(fas.id===source.id || norm(fas.jsonFile)===norm(source.json)) copies.push(fas);
      }
    }
    // Hiçbir derste yoksa YALNIZ ilk kurulumda varsayılan derse (source.dersId)
    // tohumla. Kullanıcı başka derse taşıdıysa/çıkardıysa artık varsayılan derse
    // GERİ EKLENMEZ — "aynı anda Matematik'e de ekleniyor / silince geri geliyor"
    // sorununun kök nedeni bu koşulsuz tohumlamaydı.
    if(copies.length===0){
      let ders = MANIFEST.dersler.find(d=>d.id===source.dersId);
      if(!ders){
        const cfg = BUNDLED_DERS_CONFIG[source.dersId] || BUNDLED_DERS_CONFIG.mat;
        ders = {id:source.dersId,ad:cfg.ad,ikon:cfg.ikon,renk:cfg.renk,progPct:0,fasikuller:[]};
        MANIFEST.dersler.push(ders);
      }
      const canonical = {id:source.id,progPct:0,sonCalisma:'Henüz çalışılmadı',temaRenk:null};
      ders.fasikuller.push(canonical);
      copies.push(canonical);
    }
    copies.forEach(fas=>hydrateBundledFasikul(fas,raw,source));
    loaded+=copies.length;
  }
  applyDersRemovals();   // bu dersten kalıcı silinenler tohumlama sonrası da düşsün
  window.bundledLibraryReady = true;
  return loaded;
}

async function loadAllKonular(){
  // Eski localStorage kayıtlarını destekle; büyük konu dosyalarını IndexedDB'den yükle.
  for(const ders of MANIFEST.dersler){
    for(const fas of ders.fasikuller){
      try{
        const key = `edu_konular_${ders.id}_${fas.id}`;
        let saved = localStorage.getItem(key);
        if(!saved) saved = await loadKonularFromDB(key);
        if(saved){
          const loadedKonular = JSON.parse(saved);
          // Normalize FORMAT B (kart bazlı: altKonular yok, sorularda sayfa var)
          normalizeFasikulKonular(loadedKonular);
          fas.konular = loadedKonular;
          fas.konuSayisi = fas.konular.length;
          fas.soruSayisi = fas.konular.reduce((sum,k)=>
            sum + (k.altKonular||[]).reduce((s2,ak)=> s2+(ak.sorular||[]).length,0),0);
        }
      }catch(e){}
    }
  }
}

// ══════════════════════════════
// MANIFEST PERSISTENCE
// ══════════════════════════════
function persistManifest(){
  try{
    const slim = buildManifestMeta();
    localStorage.setItem('edu_manifest_meta', JSON.stringify(slim));
    localStorage.setItem('edu_manifest_meta_ts', String(Date.now()));
    scheduleCloudPersist();
  }catch(e){}
}
function buildManifestMeta(){
  // Firestore setDoc() bir alan "undefined" ise TÜM yazmayı reddediyor (sessizce
  // değil, hata fırlatıp bulut senk.'in tamamını düşürüyor). "Alt ders" klasör
  // sözde-fasikülü (dashboard.js saveDers) gerçek bir fasikülün tüm alanlarına
  // sahip değil (ör. thumbBg, sinif yok) — bu yüzden her alan burada açıkça
  // ||null ile korunuyor, gelecekte eksik alanlı bir obje eklense bile senk.
  // sessizce bozulmasın.
  return MANIFEST.dersler.map(d=>({
    id:d.id, ad:d.ad, ikon:d.ikon||null, renk:d.renk||null, progPct:d.progPct??0, parentDersId:d.parentDersId||null,
    fasikuller: d.fasikuller.map(f=>({
      id:f.id, ad:f.ad||null, thumb:f.thumb||null, thumbBg:f.thumbBg||null, type:f.type||null, childDersId:f.childDersId||null,
      sinif:f.sinif||null, konuSayisi:f.konuSayisi??0, soruSayisi:f.soruSayisi??0,
      progPct:f.progPct??0, sonCalisma:f.sonCalisma||null, temaRenk:f.temaRenk||null,
      jsonFile:f.jsonFile||null, pdfFile:f.pdfFile||null, sourceType:f.sourceType||null,
      fasikulTip:f.fasikulTip||null
    }))
  }));
}
function loadManifestMeta(){
  try{
    const saved = localStorage.getItem('edu_manifest_meta');
    if(!saved) return;
    const slim = JSON.parse(saved);
    const deleted = JSON.parse(localStorage.getItem('edu_deleted_dersler')||'[]');
    slim.forEach(sd=>{
      if(LEGACY_DEMO_DERS_IDS.has(sd.id)) return;
      if(deleted.includes(sd.id)) return;
      sd.fasikuller=(sd.fasikuller||[]).filter(f=>!LEGACY_DEMO_FASIKUL_IDS.has(f.id));
      const existing = MANIFEST.dersler.find(d=>d.id===sd.id);
      if(existing){
        existing.ad=sd.ad; existing.ikon=sd.ikon; existing.renk=sd.renk; existing.progPct=sd.progPct; existing.parentDersId=sd.parentDersId||null;
        const currentById = new Map((existing.fasikuller||[]).map(f=>[f.id,f]));
        existing.fasikuller = sd.fasikuller.map(sf=>{
          const ef = currentById.get(sf.id);
          const merged = ef ? {...ef, ...sf} : {...sf, konular:[]};
          merged.type = sf.type || null;
          merged.childDersId = sf.childDersId || null;
          merged.temaRenk = sf.temaRenk || null;
          merged.jsonFile = sf.jsonFile || null;
          merged.pdfFile = sf.pdfFile || null;
          merged.sourceType = sf.sourceType || null;
          if(!sf.fasikulTip) delete merged.fasikulTip;
          return merged;
        });
      } else {
        MANIFEST.dersler.push({...sd, fasikuller: sd.fasikuller.map(f=>({...f,konular:[]}))});
      }
    });
    MANIFEST.dersler = MANIFEST.dersler.filter(d=>!deleted.includes(d.id) && !LEGACY_DEMO_DERS_IDS.has(d.id));
    applyDersRemovals();
  }catch(e){}
}

// ══════════════════════════════
// PERSISTENCE (localStorage + Firestore)
// ══════════════════════════════

// ══════════════════════════════
// INIT UPDATES (v4) — persistence and onboarding are handled in the main DOMContentLoaded above

function launchConfetti(count=40){
  const colors=['#818cf8','#22d3ee','#34d399','#f472b6','#fbbf24','#ef4444','#a78bfa'];
  for(let i=0;i<count;i++){
    const el=document.createElement('div');
    el.className='confetti-piece';
    el.style.cssText=`
      left:${Math.random()*100}vw;
      top:-10px;
      background:${colors[Math.floor(Math.random()*colors.length)]};
      animation-duration:${1.5+Math.random()*2}s;
      animation-delay:${Math.random()*0.5}s;
      transform:rotate(${Math.random()*360}deg);
      width:${6+Math.random()*8}px;
      height:${6+Math.random()*8}px;
    `;
    document.body.appendChild(el);
    setTimeout(()=>el.remove(), 4000);
  }
}

// ══════════════════════════════
// INIT UPDATES (v4)
// ══════════════════════════════
// Onboarding on first login — triggered from original enterApp
// (Onboarding check done in the first DOMContentLoaded listener above)


// ── Window globals: modüllerin main.js fonksiyonlarını çağırabilmesi için ──
// Faz 3/4'te panel modülleri ayrılınca bu satırlar da kalkacak.
window.MANIFEST = MANIFEST;
window.BUNDLED_FASIKUL_SOURCES = BUNDLED_FASIKUL_SOURCES;
window.BUNDLED_DERS_CONFIG = BUNDLED_DERS_CONFIG;
window.GUEST_DEMO_FASIKUL_IDS = GUEST_DEMO_FASIKUL_IDS;
window.currentDrawerDers = null;
window.showToast = showToast;
window.closeDrawer = closeDrawer;
window.openDrawer = openDrawer;
window.renderFasikulCards = renderFasikulCards;
window.normalizeFasikulKonular = normalizeFasikulKonular;
window.refreshProfileGithubJsonTools = refreshProfileGithubJsonTools;
window.addProfileGithubJsonFasikul = addProfileGithubJsonFasikul;
window.normalizePdfFileName = normalizePdfFileName;
window.readBundledJson = readBundledJson;
window.bundledSourceCache = bundledSourceCache;
window.hydrateBundledFasikul = hydrateBundledFasikul;
window.saveCustomGithubSource = saveCustomGithubSource;
window.isGuestSession = isGuestSession;
window.closeModal = closeModal;
window.ensureReaderPdfLoaded = ensureReaderPdfLoaded;
window.launchConfetti = launchConfetti;
window.recalcFasikulProgress = recalcFasikulProgress;
window.updateDashboard = updateDashboard;
window.renderDerslerGrid = renderDerslerGrid;
window.loadManifestMeta = loadManifestMeta;
window.loadBundledFasikuller = loadBundledFasikuller;
window.buildManifestMeta = buildManifestMeta;
window.loadPreferences = loadPreferences;
window.loadFromFirestore = loadFromFirestore;
window.startRealtimeSync = startRealtimeSync;
window.stopRealtimeSync = stopRealtimeSync;
window.toggleLiveSession = toggleLiveSession;
window.publishCanli = publishCanli;
window.watchStudentLive = watchStudentLive;
window.stopWatchStudent = stopWatchStudent;
window.startCanliPresence = startCanliPresence;
window.stopCanliPresence = stopCanliPresence;
window.publishCanliPresence = publishCanliPresence;
window.publishCanliPresenceDraw = publishCanliPresenceDraw;
window.toggleCanliRoster = toggleCanliRoster;
window.followCanliMember = followCanliMember;
window.unfollowCanliMember = unfollowCanliMember;
window.toggleSharedBoard = toggleSharedBoard;
window.refreshSharedBoard = refreshSharedBoard;
window.persistData = persistData;
window.scheduleCloudPersist = scheduleCloudPersist;
window.flushCloudPersist = flushCloudPersist;
window.persistDrawingCloud = persistDrawingCloud;
window.deleteDrawingCloud = deleteDrawingCloud;
window.getDashboardStats = getDashboardStats;
window.getAnsweredRecords = getAnsweredRecords;
window._getUserKey = _getUserKey;
window.addHataliCloud = addHataliCloud;
window.removeHataliCloud = removeHataliCloud;
window.migrateHatalilarToSubcollection = migrateHatalilarToSubcollection;
window.persistManifest = typeof persistManifest !== 'undefined' ? persistManifest : ()=>{};
window.renderSoruStrip = typeof renderSoruStrip !== 'undefined' ? renderSoruStrip : ()=>{};
window.updateTestProgress = typeof updateTestProgress !== 'undefined' ? updateTestProgress : ()=>{};
// HTML onclick handler'lar için auth fonksiyonları
window.doLogin = doLogin;
window.doLogout = doLogout;
window.doGuest = doGuest;
window.enterApp = enterApp;
window.addKullanici = addKullanici;
window.deleteKullanici = deleteKullanici;
window.loadKullaniciList = loadKullaniciList;
window.toggleKullaniciActive = toggleKullaniciActive;
window.resetKullaniciPassword = resetKullaniciPassword;
window.selectManagedStudent = selectManagedStudent;
window.refreshAssignTopicOptions = refreshAssignTopicOptions;
window.createAssignment = createAssignment;
window.updateAssignment = updateAssignment;
window.deleteAssignment = deleteAssignment;
window.loadMyAssignments = loadMyAssignments;
window.refreshEditAssignmentTopicOptions = refreshEditAssignmentTopicOptions;
window.refreshPlanFasikulOptions = refreshPlanFasikulOptions;
window.refreshPlanTopicOptions = refreshPlanTopicOptions;
window.prefillStudyPlanSlot = prefillStudyPlanSlot;
window.openStudyPlanModal = openStudyPlanModal;
window.closeStudyPlanModal = closeStudyPlanModal;
window.shiftStudyPlanWeek = shiftStudyPlanWeek;
window.changeStudyPlanWeek = changeStudyPlanWeek;
window.createStudyPlanSlot = createStudyPlanSlot;
window.clearStudyPlanSlot = clearStudyPlanSlot;
window.dragStudyPlanSlot = dragStudyPlanSlot;
window.dropStudyPlanSlot = dropStudyPlanSlot;
window.startResizeStudyPlanSlot = startResizeStudyPlanSlot;
window.approveStudyPlanChanges = approveStudyPlanChanges;
window.loadMyStudyPlan = loadMyStudyPlan;
window.toggleTeacherAssignField = toggleTeacherAssignField;
window.toggleUserFasikulVisibility = toggleUserFasikulVisibility;
window.applyUserFasikulVisibility = applyUserFasikulVisibility;
window.DEMO_SNAPSHOT = DEMO_SNAPSHOT;
window.selectEduDir = selectEduDir;
window.handleBulkPdfImport = handleBulkPdfImport;
window.updateEduDirUI = updateEduDirUI;
