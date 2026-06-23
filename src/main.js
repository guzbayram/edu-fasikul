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
  ADMIN_EMAIL
} from './firebase/auth.js';
import {
  persistData, loadPersistedData, loadFromFirestore,
  persistDrawingCloud, deleteDrawingCloud, scheduleCloudPersist,
  getDashboardStats, getAnsweredRecords, _hesaplaIstatistik,
  _canonicalAnswerKey, _getUserKey,
  addHataliCloud, removeHataliCloud, migrateHatalilarToSubcollection
} from './firebase/firestore.js';
import { startRealtimeSync, stopRealtimeSync } from './sync/realtime.js';

// ─── Faz 3 Modülleri ────────────────────────────────────
import './pdf/storage.js';
import './pdf/render.js';
import './drawing/canvas.js';
import './drawing/tools.js';
import './reader/index.js';
import './reader/toolbar.js';
import './reader/panel.js';

// ─── Faz 4 Modülleri ────────────────────────────────────
import './ui/toast.js';
import './ui/router.js';
import './ui/onboarding.js';
import './panels/dashboard.js';
import './panels/hatalilar.js';
import './panels/profil.js';
import './panels/admin.js';

// ─── PDF.js ──────────────────────────────────────────────
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
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
  // Türkçe ve özel karakterleri NFC'ye normalize et (macOS NFD → GitHub NFC)
  const normFile = filename.normalize('NFC');
  if(!cfg.repo){
    // Repo ayarlanmamış: relative path kullan (local / aynı sunucu)
    const p = (cfg.path || '').replace(/\/$/,'');
    return p ? `${p}/${encodeURIComponent(normFile)}` : encodeURIComponent(normFile);
  }
  const branch = cfg.branch || 'main';
  const path = (cfg.path || '').replace(/^\/+|\/+$/g,'');
  const filePart = path ? `${path}/${encodeURIComponent(normFile)}` : encodeURIComponent(normFile);
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
  {id:'tyt-denemeleri-2',dersId:'tyt',json:'9-tyt-denemeleri-2-cards.json',pdf:'9-tyt-denemeleri-2-cards.pdf'}
];

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

  // v4: Load persisted data
  loadPersistedData();
  recalcFasikulProgress();
  updateDashboard();
  renderDerslerGrid();

  // v4: Onboarding flag for first-time users
  if(!localStorage.getItem('edu_onboarded')){
    window._showOnboardOnLogin = true;
  }

  // PDF.js worker
  if(typeof pdfjsLib !== 'undefined'){
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

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
});

function renderDate(){
  const d = new Date();
  document.getElementById('todayDate').textContent = d.toLocaleDateString('tr-TR',{weekday:'long',day:'numeric',month:'long'});
}

function renderMathSymbols(){
  const syms = ['∑','∫','π','√','∞','∆','θ','α','β','±','≠','⊥','∥','≤','≥','λ'];
  const wrap = document.getElementById('mathSymbols');
  syms.forEach((s,i) => {
    const el = document.createElement('span');
    el.className='sym'; el.textContent=s;
    el.style.cssText=`left:${5+i*6}%;top:${10+Math.sin(i)*35}%;animation-delay:${i*0.7}s;animation-duration:${10+i%3*4}s;font-size:${20+i%4*10}px`;
    wrap.appendChild(el);
  });
}

function renderStreakDots(){
  const wrap = document.getElementById('streakDots');
  wrap.innerHTML='';
  for(let i=0;i<7;i++){
    const d=document.createElement('div');
    d.className='streak-dot'+(i<7?' done':'');
    wrap.appendChild(d);
  }
}


// ══════════════════════════════
// THEME
// ══════════════════════════════
function toggleTheme(){
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  html.setAttribute('data-theme', isDark?'light':'dark');
  appState.theme = isDark?'light':'dark';
  const icon = isDark?'☀️':'🌙';
  document.getElementById('themeIcon').textContent = icon;
  document.getElementById('themeToggle').textContent = icon;
  document.getElementById('themeTogglePref').textContent = isDark?'Kapalı':'Açık';
  document.getElementById('themeTogglePref').classList.toggle('off',isDark);
  localStorage.setItem('edu_theme', appState.theme);
  scheduleCloudPersist();
}
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
  const titles = {dashboard:'Anasayfa',stats:'İstatistikler',hatalilar:'Hatalılar Defteri',profil:'Profilim',admin:'Kullanıcı Yönetimi'};
  document.getElementById('topBarTitle').textContent = titles[name]||name;
  if(name==='stats' && !window._chartsInited){ initCharts(); window._chartsInited=true; }
  if(name==='dashboard' || name==='stats' || name==='profil') updateDashboard();
  if(name==='hatalilar') renderHatalilar();
  if(name==='admin') loadKullaniciList();
}

// ══════════════════════════════
// DERS GRID
// ══════════════════════════════
const GUEST_DEMO_FASIKUL_IDS = new Set(['lgs-matematik']);
function isGuestSession(){ return appState.user?.email==='misafir@demo.com'; }
function visibleFasikullerFor(ders){
  return isGuestSession()
    ? (ders.fasikuller||[]).filter(f=>GUEST_DEMO_FASIKUL_IDS.has(f.id))
    : (ders.fasikuller||[]);
}
function renderDerslerGrid(){
  const grid = document.getElementById('derslerGrid');
  grid.innerHTML = '';
  const visibleDersler=MANIFEST.dersler.filter(d=>visibleFasikullerFor(d).length>0 || !isGuestSession());
  const sayac = document.getElementById('derslerSayac');
  if(sayac) sayac.textContent = `${visibleDersler.length} ders aktif`;
  visibleDersler.forEach(ders => {
    const card = document.createElement('div');
    card.className = 'ders-card';
    card.dataset.ders = ders.id;
    const visibleFasikuller=visibleFasikullerFor(ders);
    const fasSayisi = visibleFasikuller.length;
    const soruSayisi = visibleFasikuller.reduce((a,f)=>a+f.soruSayisi,0);
    const r = 20; const circ = 2*Math.PI*r;
    const offset = circ * (1 - ders.progPct/100);
    const renkVar = ders.renk;
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
        <span>${visibleFasikuller[0]?.sonCalisma||'—'}</span>
        <button class="devam-btn" onclick="openDrawer(event,'${ders.id}')">Devam Et →</button>
      </div>`;
    grid.appendChild(card);
  });
}

// ══════════════════════════════
// DRAWER
// ══════════════════════════════
let currentDrawerDers = null;
let allFasikulCards = [];
const FASIKUL_THEME_COLORS = ['#7c73ff','#ec6471','#f59e0b','#22c55e','#14b8a6','#38bdf8','#d946ef'];
let draggedFasikulId = null;
let fasikulWasDragged = false;

function openDrawer(e, dersId){
  if(e?.stopPropagation) e.stopPropagation();
  const ders = MANIFEST.dersler.find(d=>d.id===dersId);
  if(!ders) return;
  currentDrawerDers = ders;
  window.currentDrawerDers = ders;
  document.getElementById('drawerTitle').textContent = `${ders.ikon} ${ders.ad} Fasikülleri`;
  document.getElementById('drawerSearch').value='';
  renderFasikulCards(visibleFasikullerFor(ders), ders);
  document.getElementById('drawerOverlay').classList.add('open');
  document.getElementById('drawer').classList.add('open');
}
function closeDrawer(){
  document.getElementById('drawerOverlay').classList.remove('open');
  document.getElementById('drawer').classList.remove('open');
}
function filterFasikuller(q){
  if(!currentDrawerDers) return;
  const filtered = visibleFasikullerFor(currentDrawerDers).filter(f=>f.ad.toLowerCase().includes(q.toLowerCase()));
  renderFasikulCards(filtered, currentDrawerDers);
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
    const card = document.createElement('div');
    card.className='fasikul-card';
    card.dataset.fasikulId=fas.id;
    card.draggable=sortable;
    const soruCozulen = fas._solvedCount ?? Math.floor(fas.soruSayisi * fas.progPct/100);
    const renkCSS = fas.temaRenk || ders.renk;
    card.style.setProperty('--fas-accent', renkCSS);
    const hasKonular = fas.konular && fas.konular.length > 0;
    const isBundled = fas.sourceType === 'bundled';
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
          <button onclick="event.stopPropagation();openFasikulModal('${fas.id}')">✏️ Fasikülü düzenle</button>
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
          <span>${soruCozulen}/${fas.soruSayisi} çözüldü</span>
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
    if(sortable){
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
        reorderFasikulByDrop(ders.id,draggedFasikulId,fas.id);
      });
    }
    body.appendChild(card);
  });
}
function setFasikulTheme(dersId,fasikulId,color){
  const ders=MANIFEST.dersler.find(d=>d.id===dersId);
  const fas=ders?.fasikuller.find(f=>f.id===fasikulId);
  if(!fas || !FASIKUL_THEME_COLORS.includes(color)) return;
  fas.temaRenk=color;
  persistManifest();
  renderFasikulCards(ders.fasikuller,ders);
  showToast('Fasikül rengi güncellendi','success');
}
function moveFasikul(dersId,fasikulId,direction){
  const ders=MANIFEST.dersler.find(d=>d.id===dersId);
  if(!ders) return;
  const from=ders.fasikuller.findIndex(f=>f.id===fasikulId);
  const to=Math.max(0,Math.min(ders.fasikuller.length-1,from+direction));
  if(from<0 || from===to) return;
  const [item]=ders.fasikuller.splice(from,1);
  ders.fasikuller.splice(to,0,item);
  persistManifest(); renderFasikulCards(ders.fasikuller,ders); renderDerslerGrid();
}
function reorderFasikulByDrop(dersId,sourceId,targetId){
  if(!sourceId || sourceId===targetId) return;
  const ders=MANIFEST.dersler.find(d=>d.id===dersId);
  if(!ders) return;
  const from=ders.fasikuller.findIndex(f=>f.id===sourceId);
  const to=ders.fasikuller.findIndex(f=>f.id===targetId);
  if(from<0 || to<0) return;
  const [item]=ders.fasikuller.splice(from,1);
  ders.fasikuller.splice(to,0,item);
  persistManifest(); renderFasikulCards(ders.fasikuller,ders); renderDerslerGrid();
  showToast('Fasikül sırası kaydedildi','success');
}
function toggleFasikulMenu(btn){
  const menu = btn.nextElementSibling;
  const isOpen = menu.classList.contains('open');
  document.querySelectorAll('.fasikul-card-menu.open').forEach(m=>m.classList.remove('open'));
  if(!isOpen) menu.classList.add('open');
}
document.addEventListener('click', (e)=>{
  if(!e.target.closest('.fasikul-card-menu-btn')){
    document.querySelectorAll('.fasikul-card-menu.open').forEach(m=>m.classList.remove('open'));
  }
});

function openLastFasikul(){
  const matDers = MANIFEST.dersler.find(d=>d.id==='mat');
  const analitik = matDers?.fasikuller.find(f=>f.id==='analitik-duzlem');
  if(analitik) openReader('mat','analitik-duzlem');
}

// ══════════════════════════════
// READER
// ══════════════════════════════
function safeDateKey(dateLike){
  const d=dateLike ? new Date(dateLike) : null;
  if(!d || Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0,10);
}
function getDailyCounts(records){
  const counts={};
  records.forEach(r=>{
    const key=safeDateKey(r.tarih);
    if(key) counts[key]=(counts[key]||0)+1;
  });
  return counts;
}
function calcCurrentStreak(counts){
  let streak=0;
  const d=new Date();
  for(let i=0;i<365;i++){
    const key=d.toISOString().slice(0,10);
    if((counts[key]||0)>0){ streak++; d.setDate(d.getDate()-1); }
    else break;
  }
  return streak;
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

  if(window._chartWeekly){
    window._chartWeekly.data.datasets[0].data=weeklyData;
    window._chartWeekly.update();
  }
  const topicRows=Object.entries(stats.konular||{}).map(([name,k])=>{
    const d=Number(k.dogru||0), y=Number(k.yanlis||0), solved=d+y;
    return {name,dogru:d,yanlis:y,solved,accuracy:solved?Math.round(d/solved*100):0,net:d-y*0.25};
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
    {icon:'🧠',name:'Dahi',earned:Object.keys(stats.konular||{}).length>=5},
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
  const records = getAnsweredRecords();
  // Per-fasikül: answered (non-skipped) unique question count
  const fasikulSolved = {};
  records.forEach(s => {
    if (!s.fasikulId || s.skipped) return;
    fasikulSolved[s.fasikulId] = (fasikulSolved[s.fasikulId] || 0) + 1;
  });
  MANIFEST.dersler.forEach(ders => {
    let dersTotal = 0, dersSolved = 0;
    ders.fasikuller.forEach(fas => {
      const solved = fasikulSolved[fas.id] || 0;
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
async function resetFasikulData(dersId, fasId){
  if(!confirm('Bu fasiküle ait tüm çözüm kayıtları, hatalılar ve çizimler silinecek. Bu işlem geri alınamaz. Devam etmek istiyor musunuz?')) return;

  // sorularState'ten bu fasikülün kayıtlarını temizle
  const state = appState.sorularState || {};
  Object.keys(state).forEach(key => {
    const s = state[key];
    if ((s && s.fasikulId === fasId) || key.startsWith(fasId + '__')) {
      delete state[key];
    }
  });

  // hatalilar'dan bu fasiküle ait kayıtları temizle
  const beforeCount = appState.hatalilar.length;
  appState.hatalilar = appState.hatalilar.filter(h => h.fasikulId !== fasId);
  const removedCount = beforeCount - appState.hatalilar.length;
  document.getElementById('hataliCount').textContent = appState.hatalilar.length;
  document.getElementById('hataliCountBig').textContent = `${appState.hatalilar.length} Soru`;

  // Çizimleri temizle
  Object.keys(appState.drawings || {}).forEach(key => {
    if (key.startsWith(fasId + '__') || key.startsWith(fasId + '/')) {
      delete appState.drawings[key];
    }
  });

  // Manifest'te ilerlemeyi sıfırla
  const ders = MANIFEST.dersler.find(d => d.id === dersId);
  const fas = ders?.fasikuller.find(f => f.id === fasId);
  if (fas) {
    fas.progPct = 0;
    fas._solvedCount = 0;
    fas.sonCalisma = '—';
  }

  // Firestore: bu fasiküle ait cozumler belgelerini sil
  const uid = _getUserKey();
  if (uid && window._firestoreReady && window._fsGetDocs && window._fsDeleteDoc) {
    try {
      const snap = await window._fsGetDocs(window._fsCollection(window._db, 'kullanicilar', uid, 'cozumler'));
      const deletes = [];
      snap.forEach(d => {
        const c = d.data();
        if (c.fasikulId === fasId) deletes.push(window._fsDeleteDoc(d.ref));
      });
      if (deletes.length) await Promise.all(deletes);
    } catch(e) { console.warn('Firestore fasikül sıfırlama hatası:', e); }

    // Firestore: bu fasiküle ait cizimler belgelerini sil
    try {
      const dSnap = await window._fsGetDocs(window._fsCollection(window._db, 'kullanicilar', uid, 'cizimler'));
      const dDels = [];
      dSnap.forEach(d => {
        const c = d.data();
        if (c.fasikulId === fasId) dDels.push(window._fsDeleteDoc(d.ref));
      });
      if (dDels.length) await Promise.all(dDels);
    } catch(e) { console.warn('Firestore çizim sıfırlama hatası:', e); }
  }

  recalcFasikulProgress();
  updateDashboard();
  persistData();
  persistManifest();
  renderDerslerGrid();
  if (currentDrawerDers) renderFasikulCards(currentDrawerDers.fasikuller, currentDrawerDers);
  showToast(`Fasikül sıfırlandı — ${removedCount} hatalı silindi 🗑️`, 'success');
}

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
    if(e.key==='p'&&!e.ctrlKey){ const btn=document.querySelector('[data-tool="pen"]'); if(btn) setTool(btn,'pen'); }
    if(e.key==='e'&&!e.ctrlKey){ const btn=document.querySelector('[data-tool="eraser"]'); if(btn) setTool(btn,'eraser'); }
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
function applyDemoStats(on){
  const s = on ? DEMO_STATS : {
    streak:0, streakDelta:'—',
    totalSolved:0, solvedDelta:'—',
    weekly:0, weeklyDelta:'—',
    accuracy:'%0', accuracyDelta:'—',
    kpiSolved:0, kpiSolvedSub:'—',
    kpiAccuracy:'%0', kpiAccuracySub:'—',
    kpiTime:'0s', kpiTimeSub:'—',
    kpiLongest:'0🔥', kpiLongestSub:'—'
  };
  const set = (id,v)=>{ const el=document.getElementById(id); if(el) el.textContent=v; };
  set('sidebarStreakCount', s.streak+' Gün');
  set('statStreak', s.streak);
  set('statStreakDelta', s.streakDelta);
  set('totalSolved', s.totalSolved);
  set('statSolvedDelta', s.solvedDelta);
  set('statWeekly', s.weekly);
  set('statWeeklyDelta', s.weeklyDelta);
  set('statAccuracy', s.accuracy);
  set('statAccuracyDelta', s.accuracyDelta);
  set('kpiTotalSolved', s.kpiSolved);
  set('kpiSolvedSub', s.kpiSolvedSub);
  set('kpiAccuracy', s.kpiAccuracy);
  set('kpiAccuracySub', s.kpiAccuracySub);
  set('kpiTime', s.kpiTime);
  set('kpiTimeSub', s.kpiTimeSub);
  set('kpiLongestStreak', s.kpiLongest);
  set('kpiLongestSub', s.kpiLongestSub);
  set('profileSolved', s.totalSolved);
  set('profileStreak', s.streak+'🔥');
  set('profileAccuracy', s.accuracy);
  // Streak dots
  document.querySelectorAll('.streak-dot').forEach((d,i)=>{ d.classList.toggle('done', on && i<7); });
}
function applyDemoMode(on){
  DEMO_SNAPSHOT.forEach(sd=>{
    const ders = MANIFEST.dersler.find(d=>d.id===sd.id);
    if(!ders) return;
    ders.progPct = on ? sd.progPct : 0;
    sd.fasikuller.forEach(sf=>{
      const fas = ders.fasikuller.find(f=>f.id===sf.id);
      if(!fas) return;
      fas.progPct = on ? sf.progPct : 0;
      fas.sonCalisma = on ? sf.sonCalisma : '—';
    });
  });
  persistManifest();
  applyDemoStats(on);
  renderDerslerGrid();
  // Açık olan fasikül çekmecesini de güncelle
  if(currentDrawerDers){
    renderFasikulCards(currentDrawerDers.fasikuller, currentDrawerDers);
  }
}
function toggleDemoData(btn){
  const isOff = btn.classList.toggle('off');
  btn.textContent = isOff ? 'Kapalı' : 'Açık';
  localStorage.setItem('edu_demo_mode', isOff ? '0' : '1');
  applyDemoMode(!isOff);
  showToast(isOff ? 'Demo verileri kapatıldı' : 'Demo verileri açıldı', 'success');
}

// ══════════════════════════════
// DERS CRUD
// ══════════════════════════════
function openDersModal(dersId, e){
  if(isGuestSession()){ showToast('Ders eklemek için yetkili hesabıyla giriş yapın','info'); return; }
  if(e) e.stopPropagation();
  const modal = document.getElementById('dersModal');
  const silBtn = document.getElementById('dersSilBtn');
  document.getElementById('dersEditId').value = '';
  document.getElementById('dersAdInput').value = '';
  document.getElementById('dersIkonInput').value = '';
  document.getElementById('dersRenkValue').value = 'var(--mat)';
  document.querySelectorAll('#dersRenkPicker .color-dot').forEach(d=>d.classList.remove('selected'));
  document.querySelector('#dersRenkPicker .color-dot')?.classList.add('selected');
  silBtn.style.display = 'none';
  document.getElementById('dersModalTitle').textContent = '➕ Ders Ekle';
  if(dersId){
    const ders = MANIFEST.dersler.find(d=>d.id===dersId);
    if(ders){
      document.getElementById('dersEditId').value = dersId;
      document.getElementById('dersAdInput').value = ders.ad;
      document.getElementById('dersIkonInput').value = ders.ikon;
      document.getElementById('dersRenkValue').value = ders.renk;
      document.querySelectorAll('#dersRenkPicker .color-dot').forEach(d=>{
        d.classList.toggle('selected', d.dataset.renk === ders.renk);
      });
      silBtn.style.display = '';
      document.getElementById('dersModalTitle').textContent = '✏️ Dersi Düzenle';
    }
  }
  modal.classList.add('open');
}
function closeDersModal(){
  document.getElementById('dersModal').classList.remove('open');
}
function selectDersRenk(el, renk){
  document.querySelectorAll('#dersRenkPicker .color-dot').forEach(d=>d.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('dersRenkValue').value = renk;
}
function saveDers(){
  const editId = document.getElementById('dersEditId').value;
  const ad = document.getElementById('dersAdInput').value.trim();
  const ikon = document.getElementById('dersIkonInput').value.trim() || '📚';
  const renk = document.getElementById('dersRenkValue').value;
  if(!ad){ showToast('Ders adı gerekli','error'); return; }
  if(editId){
    const ders = MANIFEST.dersler.find(d=>d.id===editId);
    if(ders){ ders.ad=ad; ders.ikon=ikon; ders.renk=renk; }
    showToast(`${ad} güncellendi ✓`,'success');
  } else {
    const newId = ad.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'') + '-' + Date.now();
    MANIFEST.dersler.push({ id:newId, ad, ikon, renk, progPct:0, fasikuller:[] });
    showToast(`${ad} eklendi ✓`,'success');
  }
  persistManifest();
  renderDerslerGrid();
  closeDersModal();
}
function silDers(){
  const editId = document.getElementById('dersEditId').value;
  if(!editId) return;
  const ders = MANIFEST.dersler.find(d=>d.id===editId);
  if(!ders) return;
  if(!confirm(`"${ders.ad}" dersini ve tüm fasikülleri silmek istiyor musunuz?`)) return;
  MANIFEST.dersler = MANIFEST.dersler.filter(d=>d.id!==editId);
  // Track deletion
  try{ const del=JSON.parse(localStorage.getItem('edu_deleted_dersler')||'[]'); del.push(editId); localStorage.setItem('edu_deleted_dersler',JSON.stringify(del)); }catch(e){}
  persistManifest();
  renderDerslerGrid();
  closeDersModal();
  showToast('Ders silindi 🗑️','success');
}

// ══════════════════════════════
// FASİKÜL CRUD
// ══════════════════════════════
async function openFasikulModal(fasikulId){
  if(isGuestSession()){ showToast('Fasikül eklemek için yetkili hesabıyla giriş yapın','info'); return; }
  const modal = document.getElementById('fasikulModal');
  const silBtn = document.getElementById('fasikulSilBtn');
  document.getElementById('fasikulEditId').value = '';
  document.getElementById('fasikulAdInput').value = '';
  document.getElementById('fasikulSinifInput').value = '10';
  document.getElementById('fasikulSoruInput').value = '0';
  document.getElementById('fasikulThumbInput').value = '';
  document.getElementById('fasikulSinifInput').readOnly = true;
  document.getElementById('fasikulSoruInput').readOnly = true;
  await populateFasikulSourceSelect(fasikulId);
  silBtn.style.display = 'none';
  document.getElementById('fasikulModalTitle').textContent = '📚 Fasikül Ekle';
  if(fasikulId && currentDrawerDers){
    const fas = currentDrawerDers.fasikuller.find(f=>f.id===fasikulId);
    if(fas){
      document.getElementById('fasikulEditId').value = fasikulId;
      document.getElementById('fasikulAdInput').value = fas.ad;
      document.getElementById('fasikulSinifInput').value = fas.sinif||10;
      document.getElementById('fasikulSoruInput').value = fas.soruSayisi||0;
      document.getElementById('fasikulThumbInput').value = fas.thumb||'';
      document.getElementById('fasikulSourceSelect').value = fas.sourceType==='bundled' ? fas.id : '';
      document.getElementById('fasikulSourceSelect').disabled = true;
      applyBundledSourceToForm(fas.sourceType==='bundled' ? fas.id : '', false);
      silBtn.style.display = fas.sourceType==='bundled' ? 'none' : '';
      document.getElementById('fasikulModalTitle').textContent = '✏️ Fasikülü Düzenle';
    }
  }
  modal.classList.add('open');
}
async function populateFasikulSourceSelect(editId=''){
  const select=document.getElementById('fasikulSourceSelect');
  const hint=document.getElementById('fasikulSourceHint');
  if(!select) return;
  select.disabled=false;
  select.innerHTML='<option value="">JSON + PDF eşleşmesi seçin</option>';
  let availableCount=0;
  const permission = appState.eduDirHandle ? await appState.eduDirHandle.queryPermission({mode:'read'}).catch(()=>null) : null;
  const hasFolder = !!appState.eduDirHandle && permission==='granted';
  const cachedKeys = await getCachedPDFKeys();
  const cachedRecords = await getCachedPDFRecords();
  // Anahtar, fasikül başka bir derse eklenince değişebilir. Bu nedenle iPad'de
  // asıl eşleşmeyi kaydedilen File.name üzerinden yap.
  const cachedPdfNames = new Set(cachedRecords.map(r=>normalizePdfFileName(r?.name || r?.blob?.name)));
  if(!hasFolder && cachedKeys.size===0 && cachedPdfNames.size===0){
    select.disabled=true;
    if(hint) hint.innerHTML='Önce profil sayfasından PDF dosyalarınızı seçin. GitHub JSON adresi uygulama tarafından otomatik kullanılır.';
    return;
  }
  for(const source of BUNDLED_FASIKUL_SOURCES){
    const cachedPdfFound = cachedKeys.has(`${source.dersId}_${source.id}`)
      || cachedPdfNames.has(normalizePdfFileName(source.pdf));
    const folderPdfFound = hasFolder ? await hasLocalPdfFile(source.pdf) : false;
    const pdfFound = cachedPdfFound || folderPdfFound;
    if(!pdfFound && source.id!==editId) continue;
    const raw=bundledSourceCache.get(source.json) || await readBundledJson(source);
    if(!raw && source.id!==editId) continue;
    const dersAd=MANIFEST.dersler.find(d=>d.id===source.dersId)?.ad || source.dersId;
    const option=document.createElement('option');
    option.value=source.id;
    option.textContent=`${raw?.ad || source.json.replace(/\.json$/,'')} · ${dersAd}`;
    availableCount++;
    select.appendChild(option);
  }
  if(hint){
    hint.textContent = availableCount
      ? `${availableCount} GitHub JSON + PDF eşleşmesi bulundu. Bilgiler seçiminizle otomatik doldurulur.`
      : 'Bu cihazdaki PDF adlarıyla eşleşen GitHub JSON fasikülü bulunamadı.';
  }
  select.disabled = availableCount===0 && !editId;
}
function applyBundledSourceToForm(sourceId,fillValues=true){
  const source=BUNDLED_FASIKUL_SOURCES.find(s=>s.id===sourceId);
  const hint=document.getElementById('fasikulSourceHint');
  const sinif=document.getElementById('fasikulSinifInput');
  const soru=document.getElementById('fasikulSoruInput');
  if(!source){
    if(hint) hint.textContent='Fasikül eklemek için JSON + PDF eşleşmesi seçin.';
    if(sinif) sinif.readOnly=true;
    if(soru) soru.readOnly=true;
    return;
  }
  const raw=bundledSourceCache.get(source.json);
  if(fillValues && raw){
    document.getElementById('fasikulAdInput').value=raw.ad||'';
    sinif.value=bundledSinif(raw.sinif);
    soru.value=raw.soruSayisi||raw.toplamSoru||0;
    document.getElementById('fasikulThumbInput').value=raw.thumb||'📄';
  }
  sinif.readOnly=true;
  soru.readOnly=true;
  if(hint) hint.innerHTML=`GitHub JSON: <b>${source.json}</b><br>Bu cihazdaki PDF: <b>${source.pdf}</b>`;
}
function closeFasikulModal(){
  document.getElementById('fasikulModal').classList.remove('open');
}
function saveFasikul(){
  if(!currentDrawerDers){ showToast('Önce bir ders seç','error'); return; }
  const editId = document.getElementById('fasikulEditId').value;
  const ad = document.getElementById('fasikulAdInput').value.trim();
  const sinif = parseInt(document.getElementById('fasikulSinifInput').value)||10;
  const soruSayisi = parseInt(document.getElementById('fasikulSoruInput').value)||0;
  const thumb = document.getElementById('fasikulThumbInput').value.trim() || '📄';
  const sourceId = document.getElementById('fasikulSourceSelect').value;
  const source = BUNDLED_FASIKUL_SOURCES.find(s=>s.id===sourceId);
  const sourceRaw = source ? bundledSourceCache.get(source.json) : null;
  if(!editId && !source){ showToast('Fasikül eklemek için GitHub JSON kaynağı seçin','error'); return; }
  if(!ad){ showToast('Fasikül adı gerekli','error'); return; }
  const thumbBgMap = {'var(--mat)':'linear-gradient(135deg,#312e81,#1e1b4b)','var(--fiz)':'linear-gradient(135deg,#164e63,#0c4a6e)','var(--kim)':'linear-gradient(135deg,#064e3b,#052e16)','var(--bio)':'linear-gradient(135deg,#431407,#450a0a)','var(--tar)':'linear-gradient(135deg,#500724,#2d1657)','var(--edb)':'linear-gradient(135deg,#2e1065,#1a0533)'};
  const thumbBg = thumbBgMap[currentDrawerDers.renk] || 'linear-gradient(135deg,#312e81,#1e1b4b)';
  if(editId){
    const fas = currentDrawerDers.fasikuller.find(f=>f.id===editId);
    if(fas){
      fas.ad=ad; fas.sinif=sinif; fas.soruSayisi=soruSayisi; fas.thumb=thumb; fas.thumbBg=thumbBg; fas.konuSayisi=fas.konular?.length||0;
      if(source){ fas.jsonFile=source.json;fas.pdfFile=source.pdf;fas.sourceType='bundled'; }
    }
    showToast(`${ad} güncellendi ✓`,'success');
  } else {
    const existing = source ? currentDrawerDers.fasikuller.find(f=>f.id===source.id) : null;
    if(existing){
      const konular = sourceRaw?.konular ? normalizeFasikulKonular(sourceRaw.konular) : (existing.konular||[]);
      existing.ad=ad;
      existing.thumb=thumb;
      existing.thumbBg=thumbBg;
      existing.sinif=sinif;
      existing.konuSayisi=konular.length;
      existing.soruSayisi=soruSayisi;
      existing.konular=konular;
      existing.jsonFile=source.json;
      existing.pdfFile=source.pdf;
      existing.sourceType='bundled';
      persistKonular(currentDrawerDers.id,existing.id,konular).catch(()=>{});
      showToast(`${ad} zaten vardı, bilgiler yenilendi ✓`,'success');
      persistManifest();
      renderFasikulCards(currentDrawerDers.fasikuller, currentDrawerDers);
      renderDerslerGrid();
      closeFasikulModal();
      return;
    }
    const newId = source?.id || ad.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'') + '-' + Date.now();
    const konular = sourceRaw?.konular ? normalizeFasikulKonular(sourceRaw.konular) : [];
    currentDrawerDers.fasikuller.push({
      id:newId,ad,thumb,thumbBg,sinif,konuSayisi:konular.length,soruSayisi,progPct:0,sonCalisma:'Yeni eklendi',konular,
      jsonFile:source?.json||null,pdfFile:source?.pdf||null,sourceType:source?'bundled':null
    });
    if(source) persistKonular(currentDrawerDers.id,newId,konular).catch(()=>{});
    showToast(`${ad} eklendi ✓`,'success');
  }
  persistManifest();
  renderFasikulCards(currentDrawerDers.fasikuller, currentDrawerDers);
  renderDerslerGrid();
  closeFasikulModal();
}
function silFasikul(){
  if(!currentDrawerDers) return;
  const editId = document.getElementById('fasikulEditId').value;
  if(!editId) return;
  const fas = currentDrawerDers.fasikuller.find(f=>f.id===editId);
  if(!fas) return;
  if(!confirm(`"${fas.ad}" fasiküle silmek istiyor musunuz?`)) return;
  currentDrawerDers.fasikuller = currentDrawerDers.fasikuller.filter(f=>f.id!==editId);
  // Konuları da sil
  try{ localStorage.removeItem(`edu_konular_${currentDrawerDers.id}_${editId}`); }catch(e){}
  persistManifest();
  renderFasikulCards(currentDrawerDers.fasikuller, currentDrawerDers);
  renderDerslerGrid();
  closeFasikulModal();
  showToast('Fasikül silindi 🗑️','success');
}

// ══════════════════════════════
// KÜTÜPHANE MODAL — Bundled fasiküllerden ekleme/çıkarma
// ══════════════════════════════
let _kutuphaneFasikulAll = []; // {source, raw, ders (config)}

async function openKutuphaneFasikulModal(targetDersId){
  // Hangi derse ekleneceğini belirle
  const modal = document.getElementById('kutuphaneFasikulModal');
  if(!modal) return;
  modal.classList.add('open');
  modal.dataset.targetDers = targetDersId || '';

  // Ders filtre dropdown'unu doldur
  const dersFilter = document.getElementById('kutuphaneDersFilter');
  if(dersFilter){
    const dersIds = [...new Set(BUNDLED_FASIKUL_SOURCES.map(s=>s.dersId))];
    dersFilter.innerHTML = '<option value="">Tüm Dersler</option>';
    dersIds.forEach(dId=>{
      const cfg = BUNDLED_DERS_CONFIG[dId] || {ad:dId};
      const opt = document.createElement('option');
      opt.value = dId; opt.textContent = `${cfg.ikon||''}${cfg.ad||dId}`;
      if(dId===targetDersId) opt.selected = true;
      dersFilter.appendChild(opt);
    });
  }

  // Seçilen ders göster/gizle butonu
  const btn = document.getElementById('kutuphaneDersSecBtn');
  if(btn) btn.style.display = targetDersId ? '' : 'none';

  // Listele
  const listWrap = document.getElementById('kutuphaneFasikulListWrap');
  if(listWrap) listWrap.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-muted)">⏳ Yükleniyor…</div>';

  // Tüm kaynakları önbelleğe al
  _kutuphaneFasikulAll = [];
  for(const source of BUNDLED_FASIKUL_SOURCES){
    const raw = await readBundledJson(source);
    _kutuphaneFasikulAll.push({source, raw});
  }
  filterKutuphaneFasikuller(document.getElementById('kutuphaneFasikulSearch')?.value||'');
}

function closeKutuphaneFasikulModal(){
  const modal = document.getElementById('kutuphaneFasikulModal');
  if(modal) modal.classList.remove('open');
}

function filterKutuphaneFasikuller(q=''){
  const listWrap = document.getElementById('kutuphaneFasikulListWrap');
  const dersFilter = document.getElementById('kutuphaneDersFilter');
  if(!listWrap) return;
  const dersId = dersFilter?.value || '';
  const lq = q.toLocaleLowerCase('tr-TR');

  let items = _kutuphaneFasikulAll.filter(({source, raw})=>{
    if(dersId && source.dersId !== dersId) return false;
    const name = raw?.ad || source.json;
    if(lq && !name.toLocaleLowerCase('tr-TR').includes(lq) && !source.json.toLocaleLowerCase('tr-TR').includes(lq)) return false;
    return true;
  });

  if(!items.length){
    listWrap.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-muted)">Fasikül bulunamadı</div>';
    return;
  }

  listWrap.innerHTML = '';
  items.forEach(({source, raw})=>{
    const cfg = BUNDLED_DERS_CONFIG[source.dersId] || {ad:source.dersId,ikon:'📚',renk:'var(--mat)'};
    const name = raw?.ad || source.json.replace(/\.json$/,'');
    const sinif = raw?.sinif || '?';
    const soruSayisi = raw?.soruSayisi || 0;
    const konuSayisi = raw?.konular?.length || 0;
    const thumb = raw?.thumb || '📄';

    // Hangi derslerde zaten var?
    const existingDersIds = MANIFEST.dersler
      .filter(d => d.fasikuller?.some(f=>f.id===source.id))
      .map(d=>d.id);

    const tagsHtml = existingDersIds.map(dId=>{
      const dc = BUNDLED_DERS_CONFIG[dId] || MANIFEST.dersler.find(d=>d.id===dId);
      const dAd = dc?.ad || dId;
      return `<span style="background:var(--green-dim);color:var(--green);padding:2px 8px;border-radius:99px;font-size:10px;font-weight:600">✓ ${dAd}</span>`;
    }).join('');

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--bg-3);border-radius:var(--radius-sm);border:1px solid var(--border)';
    row.innerHTML = `
      <div style="font-size:26px;flex-shrink:0">${thumb}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:13px;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}</div>
        <div style="font-size:11px;color:var(--text-muted);display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <span style="color:${cfg.renk||'var(--mat)'}">${cfg.ikon||''}${cfg.ad}</span>
          <span>${sinif}. Sınıf</span>
          <span>${konuSayisi} konu</span>
          <span>${soruSayisi} soru</span>
          ${tagsHtml}
        </div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:3px;opacity:.6">${source.json}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
        ${_buildKutuphaneBtns(source, existingDersIds)}
      </div>
    `;
    listWrap.appendChild(row);
  });
}

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

async function kutuphaneDersEkle(sourceId, dersId){
  const source = BUNDLED_FASIKUL_SOURCES.find(s=>s.id===sourceId);
  if(!source){ showToast('Kaynak bulunamadı','error'); return; }
  let ders = MANIFEST.dersler.find(d=>d.id===dersId);
  if(!ders){ showToast('Ders bulunamadı','error'); return; }
  if(ders.fasikuller.some(f=>f.id===source.id)){ showToast('Zaten ekli','info'); return; }

  const raw = await readBundledJson(source);
  const cfg = BUNDLED_DERS_CONFIG[dersId] || {};
  const thumbBgMap = {'var(--mat)':'linear-gradient(135deg,#312e81,#1e1b4b)','var(--fiz)':'linear-gradient(135deg,#164e63,#0c4a6e)','var(--kim)':'linear-gradient(135deg,#064e3b,#052e16)','var(--bio)':'linear-gradient(135deg,#431407,#450a0a)','var(--tar)':'linear-gradient(135deg,#500724,#2d1657)','var(--edb)':'linear-gradient(135deg,#2e1065,#1a0533)'};
  const thumbBg = thumbBgMap[ders.renk] || 'linear-gradient(135deg,#312e81,#1e1b4b)';
  const konular = raw?.konular ? normalizeFasikulKonular([...raw.konular]) : [];
  ders.fasikuller.push({
    id: source.id,
    ad: raw?.ad || source.id,
    thumb: raw?.thumb || '📄',
    thumbBg,
    sinif: bundledSinif(raw?.sinif),
    konular,
    konuSayisi: konular.length,
    soruSayisi: konular.reduce((s,k)=>s+(k.altKonular||[]).reduce((s2,ak)=>s2+(ak.sorular||[]).length,0),0),
    progPct: 0,
    sonCalisma: 'Yeni eklendi',
    jsonFile: source.json,
    pdfFile: source.pdf,
    sourceType: 'bundled'
  });
  persistManifest();
  renderDerslerGrid();
  showToast(`✓ "${raw?.ad||source.id}" ${ders.ad}'a eklendi`,'success');
  // Listeyi yenile
  filterKutuphaneFasikuller(document.getElementById('kutuphaneFasikulSearch')?.value||'');
}

function kutuphaneCikar(sourceId, dersId){
  const ders = MANIFEST.dersler.find(d=>d.id===dersId);
  if(!ders) return;
  const fas = ders.fasikuller.find(f=>f.id===sourceId);
  if(!fas) return;
  if(!confirm(`"${fas.ad}" fasiküle "${ders.ad}" dersinden çıkarılsın mı?`)) return;
  ders.fasikuller = ders.fasikuller.filter(f=>f.id!==sourceId);
  try{ localStorage.removeItem(`edu_konular_${dersId}_${sourceId}`); }catch(e){}
  persistManifest();
  renderDerslerGrid();
  showToast(`Fasikül "${ders.ad}"dan çıkarıldı 🗑️`,'success');
  filterKutuphaneFasikuller(document.getElementById('kutuphaneFasikulSearch')?.value||'');
}

function kutuphaneDersSec(){
  const modal = document.getElementById('kutuphaneFasikulModal');
  const targetDersId = modal?.dataset?.targetDers;
  if(!targetDersId){ showToast('Hedef ders seçilmedi','error'); return; }
  closeKutuphaneFasikulModal();
  openDrawer(targetDersId);
}

function downloadOrnekJson(format){
  // FORMAT A: çoklu soru (bir sayfada birden fazla soru) — altKonular yapısı
  const sampleA = {
    "ad": "Fasikül Adı (Çoklu Soru)",
    "sinif": 10,
    "soruSayisi": 4,
    "konuSayisi": 2,
    "thumb": "📐",
    "konular": [
      {
        "id": "konu-1",
        "ad": "Birinci Konu",
        "sayfaBasl": 1,
        "sayfaBitis": 5,
        "altKonular": [
          {
            "id": "alt-konu-1-1",
            "ad": "Alt Konu 1.1",
            "sayfa": 1,
            "sorular": [
              { "no": 1, "onizleme": "Soru 1 metni (kısa özet)", "cevap": "A", "zorluk": "kolay" },
              { "no": 2, "onizleme": "Soru 2 metni", "cevap": "C", "zorluk": "orta" }
            ]
          }
        ]
      }
    ]
  };
  // FORMAT B: kart bazlı (her sayfada bir soru) — sorular konunun altında, her soruda sayfa
  const sampleB = {
    "ad": "Fasikül Adı (Kart Bazlı - Her Sayfada 1 Soru)",
    "sinif": 10,
    "soruSayisi": 4,
    "konuSayisi": 2,
    "thumb": "📐",
    "konular": [
      {
        "id": "test-1",
        "ad": "Test 1",
        "sayfaBasl": 1,
        "sayfaBitis": 4,
        "soruSayisi": 4,
        "sorular": [
          { "no": 1, "sayfa": 1, "cevap": "E" },
          { "no": 2, "sayfa": 2, "cevap": "A" },
          { "no": 3, "sayfa": 3, "cevap": "C" },
          { "no": 4, "sayfa": 4, "cevap": "B" }
        ]
      }
    ]
  };
  const sample = (format === 'B') ? sampleB : sampleA;
  const blob = new Blob([JSON.stringify(sample, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = format === 'B' ? 'fasikul_kartbazli_ornek.json' : 'fasikul_coklusoru_ornek.json';
  a.click();
  showToast(`Örnek JSON şablonu indirildi (Format ${format||'A'}) 📋`,'success');
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

const bundledSourceCache = new Map();
async function readBundledJson(source){
  if(bundledSourceCache.has(source.json)) return bundledSourceCache.get(source.json);
  let raw = null;
  // 1. GitHub veya yapılandırılmış URL'den çek
  if(location.protocol !== 'file:'){
    try{
      const url = buildGithubRawUrl(source.json);
      const response = await fetch(url);
      if(response.ok) raw = await response.json();
      else {
        // GitHub başarısız olursa eski relative path'i dene
        const fallback = await fetch(encodeURIComponent(source.json.normalize('NFC')));
        if(fallback.ok) raw = await fallback.json();
      }
    }catch(e){
      try{
        const fallback = await fetch(encodeURIComponent(source.json.normalize('NFC')));
        if(fallback.ok) raw = await fallback.json();
      }catch(e2){}
    }
  }
  // 2. Gzip bundle varsa oradan
  if(!raw && window.EDU_FASIKUL_GZIP?.[source.json]){
    try{
      const binary = atob(window.EDU_FASIKUL_GZIP[source.json]);
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
function hydrateBundledFasikul(fas,raw,source){
  const konular=normalizeFasikulKonular(raw.konular||[]);
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
  return fas;
}
async function loadBundledFasikuller(){
  let loaded = 0;
  for(const source of BUNDLED_FASIKUL_SOURCES){
    const raw = await readBundledJson(source);
    if(!raw || !Array.isArray(raw.konular)) continue;
    let ders = MANIFEST.dersler.find(d=>d.id===source.dersId);
    if(!ders){
      const cfg = BUNDLED_DERS_CONFIG[source.dersId] || BUNDLED_DERS_CONFIG.mat;
      ders = {id:source.dersId,ad:cfg.ad,ikon:cfg.ikon,renk:cfg.renk,progPct:0,fasikuller:[]};
      MANIFEST.dersler.push(ders);
    }
    let canonical = ders.fasikuller.find(f=>f.id===source.id);
    if(!canonical){
      canonical = {id:source.id,progPct:0,sonCalisma:'Henüz çalışılmadı',temaRenk:null};
      ders.fasikuller.push(canonical);
    }

    // Aynı GitHub fasikülü kullanıcının oluşturduğu başka bir ders
    // altında da bulunabilir. Tüm kopyalara aynı konu/soru JSON'unu bağla.
    const copies=[];
    for(const manifestDers of MANIFEST.dersler){
      for(const fas of manifestDers.fasikuller||[]){
        if(fas.id===source.id || fas.jsonFile===source.json) copies.push(fas);
      }
    }
    if(!copies.includes(canonical)) copies.push(canonical);
    copies.forEach(fas=>hydrateBundledFasikul(fas,raw,source));
    loaded+=copies.length;
  }
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
    scheduleCloudPersist();
  }catch(e){}
}
function buildManifestMeta(){
  return MANIFEST.dersler.map(d=>({
    id:d.id, ad:d.ad, ikon:d.ikon, renk:d.renk, progPct:d.progPct,
    fasikuller: d.fasikuller.map(f=>({
      id:f.id, ad:f.ad, thumb:f.thumb, thumbBg:f.thumbBg,
      sinif:f.sinif, konuSayisi:f.konuSayisi, soruSayisi:f.soruSayisi,
      progPct:f.progPct, sonCalisma:f.sonCalisma, temaRenk:f.temaRenk||null,
      jsonFile:f.jsonFile||null, pdfFile:f.pdfFile||null, sourceType:f.sourceType||null
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
        existing.ad=sd.ad; existing.ikon=sd.ikon; existing.renk=sd.renk; existing.progPct=sd.progPct;
        sd.fasikuller.forEach(sf=>{
          const ef = existing.fasikuller.find(f=>f.id===sf.id);
          if(ef){ ef.ad=sf.ad; ef.thumb=sf.thumb; ef.thumbBg=sf.thumbBg; ef.sinif=sf.sinif; ef.konuSayisi=sf.konuSayisi; ef.soruSayisi=sf.soruSayisi; ef.progPct=sf.progPct; ef.sonCalisma=sf.sonCalisma; ef.temaRenk=sf.temaRenk||null; ef.jsonFile=sf.jsonFile||null; ef.pdfFile=sf.pdfFile||null; ef.sourceType=sf.sourceType||null; }
          else { existing.fasikuller.push({...sf, konular:[]}); }
        });
        const savedOrder=sd.fasikuller.map(sf=>sf.id);
        existing.fasikuller.sort((a,b)=>{
          const ai=savedOrder.indexOf(a.id), bi=savedOrder.indexOf(b.id);
          if(ai<0 && bi<0) return 0;
          if(ai<0) return 1;
          if(bi<0) return -1;
          return ai-bi;
        });
      } else {
        MANIFEST.dersler.push({...sd, fasikuller: sd.fasikuller.map(f=>({...f,konular:[]}))});
      }
    });
    MANIFEST.dersler = MANIFEST.dersler.filter(d=>!deleted.includes(d.id) && !LEGACY_DEMO_DERS_IDS.has(d.id));
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
// ONBOARDING
// ══════════════════════════════
const ONBOARD_STEPS=[
  {
    title:'Konu Navigatörü 📚',
    desc:'Sol panelden ana konu ve alt konuları seç. Her konu PDF\'deki ilgili sayfaya atlar.',
    target:'readerLeft',
    pos:{left:'300px',top:'120px'}
  },
  {
    title:'Çizim Araçları ✏️',
    desc:'Üst araç çubuğunda kalem, vurgulayıcı ve metin aracıyla PDF üzerine not alabilirsin. Tüm çizimler otomatik kaydedilir.',
    target:'readerToolbar',
    pos:{left:'50%',top:'80px',transform:'translateX(-50%)'}
  },
  {
    title:'Soru Paneli 🎯',
    desc:'Sağ panelden soruları çöz, test başlat, süre tut. Hatalı sorular otomatik defterine eklenir.',
    target:'readerRight',
    pos:{right:'360px',top:'120px'}
  }
];
let onboardStep=0;

function startOnboarding(){
  if(document.getElementById('reader-overlay').classList.contains('open')){
    showOnboardStep(0);
  } else {
    // Open reader first then tour
    const firstDers=MANIFEST.dersler[0];
    const firstFas=firstDers.fasikuller[0];
    openReader(firstDers, firstFas);
    setTimeout(()=>showOnboardStep(0), 500);
  }
}

function showOnboardStep(idx){
  onboardStep=idx;
  const steps=ONBOARD_STEPS;
  if(idx>=steps.length){ endOnboarding(); return; }
  const step=steps[idx];
  const overlay=document.getElementById('onboardOverlay');
  const tip=document.getElementById('onboardTip');
  overlay.style.display='block';
  tip.style.display='block';
  document.getElementById('onboardTitle').textContent=step.title;
  document.getElementById('onboardDesc').textContent=step.desc;
  // Position
  Object.assign(tip.style,{left:'',top:'',right:'',transform:'',...step.pos});
  // Dots
  const dots=document.getElementById('onboardDots');
  dots.innerHTML='';
  steps.forEach((_,i)=>{
    const d=document.createElement('div');
    d.className='onboard-dot'+(i===idx?' active':'');
    dots.appendChild(d);
  });
  // Button label
  document.getElementById('onboardNextBtn').textContent=idx===steps.length-1?'Başlayalım! 🚀':'İleri →';
  // Highlight target
  document.querySelectorAll('.onboard-highlight').forEach(el=>el.classList.remove('onboard-highlight'));
  const target=document.getElementById(step.target);
  if(target) target.style.outline='2px solid var(--mat)';
  setTimeout(()=>{ if(target) target.style.outline=''; }, 3000);
}

function onboardNext(){
  showOnboardStep(onboardStep+1);
}

function endOnboarding(){
  document.getElementById('onboardOverlay').style.display='none';
  document.getElementById('onboardTip').style.display='none';
  localStorage.setItem('edu_onboarded','1');
  showToast('Tur tamamlandı! İyi çalışmalar 🎓','success');
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
window.normalizePdfFileName = normalizePdfFileName;
window.readBundledJson = readBundledJson;
window.hydrateBundledFasikul = hydrateBundledFasikul;
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
window.startOnboarding = startOnboarding;
window.loadFromFirestore = loadFromFirestore;
window.startRealtimeSync = startRealtimeSync;
window.stopRealtimeSync = stopRealtimeSync;
window.persistData = persistData;
window.scheduleCloudPersist = scheduleCloudPersist;
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
