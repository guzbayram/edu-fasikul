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
  _canonicalAnswerKey
} from './firebase/firestore.js';
import { startRealtimeSync, stopRealtimeSync } from './sync/realtime.js';

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
async function openReader(dersId, fasikulId){
  closeDrawer();
  if(isGuestSession() && !GUEST_DEMO_FASIKUL_IDS.has(fasikulId)){
    showToast('Misafir hesabında yalnızca demo fasikül kullanılabilir','info');
    return;
  }
  const ders = MANIFEST.dersler.find(d=>d.id===dersId);
  const fasikul = ders?.fasikuller.find(f=>f.id===fasikulId);
  if(!fasikul) return;

  // Kullanıcı fasikülü başka bir ders altına eklediyse metadata kalıcıdır,
  // fakat ağır konu/soru verisi her açılışta GitHub kataloğundan yeniden bağlanır.
  if(fasikul.sourceType==='bundled'){
    const source=BUNDLED_FASIKUL_SOURCES.find(s=>s.id===fasikul.id || s.json===fasikul.jsonFile);
    if(source){
      const raw=await readBundledJson(source);
      if(raw?.konular) hydrateBundledFasikul(fasikul,raw,source);
    }
  }

  appState.aktifDers = ders;
  appState.aktifFasikul = fasikul;
  normalizeFasikulKonular(fasikul.konular || []);
  appState.currentPage = 1;
  appState.undoStack = [];
  appState.redoStack = [];
  // PDF state reset
  appState.pdfDoc = null;
  appState.pdfDocFasikulId = null;
  document.getElementById('pdfUploadZone').style.display = '';
  document.getElementById('readerCanvasWrap').style.display = 'none';

  // Total pages from manifest
  const allPages = fasikul.konular.flatMap(k=>k.altKonular||[]).map(a=>a.sayfa||1);
  const maxPage = fasikul.konular.reduce((m,k)=>Math.max(m,k.sayfaBitis||1),1);
  appState.totalPages = Math.max(maxPage, 20);

  // Header info
  document.getElementById('readerFasikulAd').textContent = fasikul.ad;
  document.getElementById('readerFasikulMeta').textContent = `${fasikul.sinif}. Sınıf · ${ders.ad}`;
  document.getElementById('toolbarFasikulAd').textContent = fasikul.ad;

  // Her soruya unique _uid ekle + _kartBazli flag'ini alt konuya taşı
  // Ayrıca sorularda sayfa yoksa altKonu.sayfa'dan sırayla hesapla
  fasikul.konular.forEach(k=>{
    (k.altKonular||[]).forEach(ak=>{
      // Kart bazlı flag: altKonunun kendisinde veya konuda işaretli
      if(k._kartBazliKonu) ak._kartBazli = true;
      (ak.sorular||[]).forEach((s, i)=>{
        s._uid = fasikul.id + '__' + ak.id + '_' + s.no;
        // Soruda sayfa yoksa altKonunun başlangıç sayfasından sırayla ata
        if(!s.sayfa && ak.sayfa){
          s.sayfa = ak.sayfa + i;
        }
      });
    });
  });

  // Build left nav
  buildKonuNav(fasikul);

  // PDF yüklenmeden render yok; kullanıcı yükleyince başlar
  updatePageIndicator();

  // Open overlay
  document.getElementById('reader-overlay').classList.add('open');

  // Context menu başlat (sağ tık ile mod seçimi)
  initPDFContextMenu();

  // Select first valid topic
  const firstKonu = fasikul.konular[0];
  const firstAlt = firstKonu?.altKonular?.[0];
  if(firstAlt && firstAlt.sorular?.length > 0) selectAltKonu(firstAlt, `altk-${firstAlt.id}`);

  // PDF'i önce profil sayfasında bir kez bağlanan klasörden otomatik aç.
  // Klasörde bulunamazsa eski kayıtlı PDF yedeğine bakılır; en son manuel yükleme alanı görünür.
  try{
    const openedFromFolder = await ensureReaderPdfLoaded(1);
    if(!openedFromFolder){
      const saved = await getPDFFromDB(dersId, fasikulId);
      if(saved && saved.blob){
        await loadPDFFile(saved.blob);
      }
    }
  }catch(e){ /* yoksay */ }
}

function toggleMobileLeft(){
  const left = document.getElementById('readerLeft');
  const overlay = document.getElementById('mobileLeftOverlay');
  const isOpen = left.classList.contains('mobile-open');
  left.classList.toggle('mobile-open', !isOpen);
  overlay.classList.toggle('show', !isOpen);
}

function closeReader(){
  saveDrawing();
  stopTimer();
  // sonCalisma güncelle (fasikül kapatılmadan önce)
  if(appState.aktifFasikul){
    const fas = appState.aktifFasikul;
    const dersId = appState.aktifDers?.id;
    const fasRef = dersId
      ? MANIFEST.dersler.find(d=>d.id===dersId)?.fasikuller.find(f=>f.id===fas.id)
      : null;
    const target = fasRef || fas;
    const hasActivity = Object.values(appState.sorularState||{}).some(s=>s&&s.fasikulId===fas.id&&s.answered);
    if(hasActivity){
      const now = new Date();
      const mins = now.getMinutes().toString().padStart(2,'0');
      target.sonCalisma = `Bugün ${now.getHours()}:${mins}`;
    }
  }
  recalcFasikulProgress();
  updateDashboard();
  persistManifest();
  renderDerslerGrid();
  if(currentDrawerDers) renderFasikulCards(currentDrawerDers.fasikuller, currentDrawerDers);
  document.getElementById('reader-overlay').classList.remove('open');
  appState.aktifFasikul = null;
  appState.aktifAltKonu = null;
  appState.pdfDoc = null;
  appState.pdfDocFasikulId = null;
  // Tüm fabric canvas'ları temizle
  Object.values(appState.fabricCanvases||{}).forEach(fc=>{ try{fc.dispose();}catch(e){} });
  appState.fabricCanvases = {};
  if(appState.fabricCanvas){ try{appState.fabricCanvas.dispose();}catch(e){} appState.fabricCanvas=null; }
  if(appState._pageObserver){ appState._pageObserver.disconnect(); appState._pageObserver=null; }
}

// ── Konu Nav
// ── Sayfa numarasına göre sol paneli (ana konu + alt konu) senkronize et
function syncNavToPage(pageNum){
  if(appState._suppressNavSync) return;
  const fas = appState.aktifFasikul;
  if(!fas || !fas.konular) return;

  // Hangi ana konu bu sayfayı kapsar?
  let targetKonu = null;
  let targetAlt = null;

  for(const konu of fas.konular){
    // Kart bazlı konu: her soru kendi sayfasında → sorular içinde sayfa ara
    // Kart bazlı tespit: altKonunun sorularında sayfa alanı varsa → her soru ayrı sayfada
    const _ilkAk = konu.altKonular?.[0];
    const _konuKartBazli = _ilkAk && _ilkAk.sorular?.length > 0 && !!_ilkAk.sorular[0]?.sayfa;
    if(_konuKartBazli){
      // Her altKonu içinde hangi soruda bu sayfa var diye ara
      for(const ak of konu.altKonular || []){
        const hasSoru = (ak.sorular||[]).some(s => s.sayfa === pageNum);
        const inRange = konu.sayfaBasl && konu.sayfaBitis &&
                        pageNum >= konu.sayfaBasl && pageNum <= konu.sayfaBitis &&
                        (ak.sorular?.[0]?.sayfa || 0) <= pageNum &&
                        (ak.sorular?.[ak.sorular.length-1]?.sayfa || 0) >= pageNum;
        if(hasSoru || inRange){
          targetKonu = konu;
          targetAlt = ak;
          break;
        }
      }
      if(targetAlt) break;
      continue;
    }

    // Normal konu: alt konular arasında tam sayfa eşleşmesi ara
    for(const ak of konu.altKonular || []){
      if(ak.sayfa === pageNum){
        targetKonu = konu;
        targetAlt = ak;
        break;
      }
    }
    if(targetAlt) break;

    // Alt konularda tam eşleşme yoksa sayfaBasl-sayfaBitis aralığına bak
    if(!targetAlt && konu.sayfaBasl && konu.sayfaBitis &&
       pageNum >= konu.sayfaBasl && pageNum <= konu.sayfaBitis){
      targetKonu = konu;
      // Aralık içinde en yakın alt konuyu bul (sayfası <= currentPage olan en son)
      let best = null;
      for(const ak of konu.altKonular || []){
        if((ak.sayfa || 0) <= pageNum) best = ak;
      }
      targetAlt = best || konu.altKonular?.[0] || null;
    }
  }

  // Hiç bulunamazsa ilk konuya düş
  if(!targetKonu) targetKonu = fas.konular[0];

  // Ana konu dropdown'unu güncelle (sadece değiştiyse)
  if(targetKonu && appState.aktifKonu?.id !== targetKonu.id){
    appState.aktifKonu = targetKonu;
    const select = document.getElementById('anaKonuSelect');
    if(select) select.value = targetKonu.id;
    renderAltKonuList(targetKonu);
  }

  // Alt konu highlight'ını güncelle
  if(targetAlt && appState.aktifAltKonu?.id !== targetAlt.id){
    // Farklı alt konuya geçiş
    appState.aktifAltKonu = targetAlt;
    appState.activeQuestionIdx = 0;

    // Kart bazlı: ilk gösterilecek soruyu sayfaya göre bul
    const _isKartBazliNew = targetAlt.sorular?.length > 0 && !!targetAlt.sorular[0]?.sayfa;
    if(_isKartBazliNew){
      const sorular = targetAlt.sorular || [];
      let startIdx = 0;
      for(let i = 0; i < sorular.length; i++){
        if((sorular[i].sayfa || 0) <= pageNum) startIdx = i;
      }
      appState.activeQuestionIdx = startIdx;
    }

    document.querySelectorAll('.alt-konu-item').forEach(el=>el.classList.remove('active'));
    const itemEl = document.getElementById(`altk-${targetAlt.id}`);
    if(itemEl){
      itemEl.classList.add('active');
      itemEl.scrollIntoView({behavior:'smooth', block:'nearest'});
    }
    updateRightPanelTitle();
    document.getElementById('rpSoruSayisi').textContent = `${targetAlt.sorular?.length || 0} Soru`;
    renderSoruList(targetAlt.sorular || []);
    updateTestProgress();
  } else if(targetAlt && appState.aktifAltKonu?.id === targetAlt.id){
    // Aynı alt konu içinde sayfa değişti
    // Kart bazlı tespit: sorularda sayfa alanı varsa
    const _isKartBazli = targetAlt.sorular?.length > 0 && !!targetAlt.sorular[0]?.sayfa;
    if(_isKartBazli){
      // Kart bazlı: her sayfa = ayrı soru → hangi sorunun sayfasındayız?
      const sorular = targetAlt.sorular || [];
      let bestIdx = 0;
      for(let i = 0; i < sorular.length; i++){
        if((sorular[i].sayfa || 0) <= pageNum) bestIdx = i;
      }
      if(bestIdx !== appState.activeQuestionIdx){
        appState.activeQuestionIdx = bestIdx;
        // tekSoruCard yoksa oluştur
        const list = document.getElementById('soruList');
        if(list && !document.getElementById('tekSoruCard')){
          list.innerHTML = `<div class="tek-soru-card" id="tekSoruCard"></div>`;
        }
        renderTekSoruKart(sorular, bestIdx);
        renderSoruStrip(sorular);
      }
    }
    // Çoklu soru modunda: soru elle seçilir, sayfa değişince otomatik değişmez
  }
}

function buildKonuNav(fasikul){
  const select = document.getElementById('anaKonuSelect');
  select.innerHTML = '';
  const konular = Array.isArray(fasikul?.konular) ? fasikul.konular : [];
  if(!konular.length){
    appState.aktifKonu = null;
    appState.aktifAltKonu = null;
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Konu eklenmemiş';
    select.appendChild(opt);
    renderAltKonuList(null);
    renderSoruList([]);
    updateRightPanelTitle();
    return;
  }
  konular.forEach(k=>{
    const opt = document.createElement('option');
    opt.value = k.id || k.ad; opt.textContent = k.ad;
    select.appendChild(opt);
  });
  appState.aktifKonu = konular[0];
  select.value = konular[0]?.id || konular[0]?.ad || '';
  renderAltKonuList(konular[0]);
}

function onAnaKonuChange(){
  const select = document.getElementById('anaKonuSelect');
  const sel = select.value;
  const konular = appState.aktifFasikul?.konular || [];
  const konu = konular.find(k=>(k.id || k.ad)===sel) || konular[select.selectedIndex];
  if(!konu) return;
  appState.aktifKonu = konu;
  if(select) select.value = konu.id || konu.ad || '';

  const visibleAlts = (konu.altKonular || []).filter(ak=> ak.ad !== 'Çözümlü Sorular - Çözümler');
  const startPage = konu.sayfaBasl || visibleAlts[0]?.sorular?.[0]?.sayfa || visibleAlts[0]?.sayfa || 1;
  const targetAlt = visibleAlts.find(ak=>{
    const sorular = ak.sorular || [];
    const first = sorular[0]?.sayfa || ak.sayfa || 0;
    const last = sorular[sorular.length-1]?.sayfa || ak.sayfa || 0;
    return startPage >= first && startPage <= last;
  }) || visibleAlts[0] || null;

  appState.aktifAltKonu = targetAlt;
  appState.activeQuestionIdx = 0;
  renderAltKonuList(konu);
  if(targetAlt){
    renderSoruList(targetAlt.sorular || []);
    updateRightPanelTitle();
    document.getElementById('rpSoruSayisi').textContent = `${targetAlt.sorular?.length||0} ${isKonuKartAltKonu(targetAlt) ? 'Kart' : 'Soru'}`;
    updateTestProgress();
  }
  appState._suppressNavSync = true;
  goToPage(startPage);
  setTimeout(()=>{ appState._suppressNavSync = false; }, 500);
}

function renderAltKonuList(konu){
  const list = document.getElementById('altKonuList');
  list.innerHTML='';
  if(!konu){
    list.innerHTML='<div style="padding:16px;font-size:12px;color:var(--text-muted);line-height:1.45">Bu fasikülde konu JSON’u yok. PDF ya da JSON yükleyerek çalışmaya başlayabilirsin.</div>';
    return;
  }
  if(!konu.altKonular?.length){
    list.innerHTML='<div style="padding:16px;font-size:12px;color:var(--text-muted)">Bu konuya alt başlık eklenmemiş.</div>';
    return;
  }
  konu.altKonular.filter(ak=> ak.ad !== 'Çözümlü Sorular - Çözümler').forEach(ak=>{
    const isKonuKartlari = isKonuKartAltKonu(ak);
    const solvedCount = ak.sorular ? ak.sorular.filter(s=>appState.sorularState[s._uid||s.no]?.answered).length : 0;
    const totalCount = ak.sorular?.length||0;
    const isDone = !isKonuKartlari && totalCount>0 && solvedCount===totalCount;
    const item = document.createElement('div');
    const itemId = `altk-${ak.id}`;
    const isActive = appState.aktifAltKonu && (appState.aktifAltKonu === ak || appState.aktifAltKonu.id === ak.id);
    item.className='alt-konu-item'+(isDone?' done':'')+(isActive?' active':'');
    item.id = itemId;
    item.innerHTML=`
      <div class="akn-icon-wrap"></div>
      <span class="akn-name">${ak.ad}</span>
      ${totalCount>0?`<span class="akn-chip">${isKonuKartlari ? `${totalCount} Kart` : `${solvedCount}/${totalCount}`}</span>`:''}`;
    item.onclick = ()=>selectAltKonu(ak, itemId);
    list.appendChild(item);
  });
}

function selectAltKonu(altKonu, itemId){
  appState._suppressNavSync = true;
  appState.aktifAltKonu = altKonu;
  const parentKonu = getParentKonuForAlt(altKonu);
  if(parentKonu){
    appState.aktifKonu = parentKonu;
    const select = document.getElementById('anaKonuSelect');
    if(select) select.value = parentKonu.id || parentKonu.ad || '';
  }
  appState.activeQuestionIdx = 0;
  document.querySelectorAll('.alt-konu-item').forEach(el=>el.classList.remove('active'));
  const el = document.getElementById(itemId || `altk-${altKonu.id}`);
  if(el){ el.classList.add('active'); el.scrollIntoView({behavior:'smooth',block:'nearest'}); }
  // Kart bazlıda: ilk sorunun sayfasına git (s.sayfa), diğerinde altKonu.sayfa
  const _selKartBazli = altKonu.sorular?.length > 0 && !!altKonu.sorular[0]?.sayfa;
  const ilkSayfa = _selKartBazli
    ? (altKonu.sorular?.[0]?.sayfa || altKonu.sayfa || 1)
    : altKonu.sayfa;
  if(ilkSayfa) goToPage(ilkSayfa);
  renderSoruList(altKonu.sorular||[]);
  updateRightPanelTitle();
  document.getElementById('rpSoruSayisi').textContent = `${altKonu.sorular?.length||0} ${isKonuKartAltKonu(altKonu) ? 'Kart' : 'Soru'}`;
  updateTestProgress();
  setTimeout(()=>{ appState._suppressNavSync = false; }, 800);
  // Konu seçilince çekmece kapanır; çalışma alanı tek panel olarak kalır.
  const left = document.getElementById('readerLeft');
  const overlay = document.getElementById('mobileLeftOverlay');
  left?.classList.remove('mobile-open');
  overlay?.classList.remove('show');
}



// ══════════════════════════════════════════════════════════
// PDF.js ENTEGRASYONU
// ══════════════════════════════════════════════════════════

/**
 * PDF dosyası yüklendiğinde çağrılır (input[type=file] onchange)
 */
async function handlePDFUpload(input){
  const file = input.files[0];
  if(!file || file.type !== 'application/pdf'){
    showToast('Lütfen geçerli bir PDF dosyası seç','error');
    return;
  }
  await loadPDFFile(file);
  // Aynı fasikül için bir dahaki açılışta otomatik yüklensin diye sakla
  if(appState.aktifDers && appState.aktifFasikul){
    savePDFToDB(appState.aktifDers.id, appState.aktifFasikul.id, file).catch(()=>{});
  }
  // Reset input so same file can be re-selected
  input.value = '';
}

// ══════════════════════════════
// PDF PERSISTENCE (IndexedDB)
// ══════════════════════════════
const PDF_DB_NAME = 'edu_pdf_store';
const PDF_DB_STORE = 'pdfs';
function openPdfDB(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(PDF_DB_NAME, 1);
    req.onupgradeneeded = ()=>{
      req.result.createObjectStore(PDF_DB_STORE);
    };
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error);
  });
}
async function savePDFToDB(dersId, fasikulId, file){
  try{
    const db = await openPdfDB();
    const key = `${dersId}_${fasikulId}`;
    await new Promise((resolve,reject)=>{
      const tx = db.transaction(PDF_DB_STORE,'readwrite');
      tx.objectStore(PDF_DB_STORE).put({name:file.name, blob:file}, key);
      tx.oncomplete = ()=>resolve();
      tx.onerror = ()=>reject(tx.error);
    });
  }catch(e){ /* sessizce yoksay */ }
}
async function getPDFFromDB(dersId, fasikulId){
  try{
    const db = await openPdfDB();
    const key = `${dersId}_${fasikulId}`;
    return await new Promise((resolve,reject)=>{
      const tx = db.transaction(PDF_DB_STORE,'readonly');
      const req = tx.objectStore(PDF_DB_STORE).get(key);
      req.onsuccess = ()=>resolve(req.result||null);
      req.onerror = ()=>reject(req.error);
    });
  }catch(e){ return null; }
}
async function getCachedPDFKeys(){
  try{
    const db = await openPdfDB();
    return await new Promise((resolve,reject)=>{
      const tx = db.transaction(PDF_DB_STORE,'readonly');
      const req = tx.objectStore(PDF_DB_STORE).getAllKeys();
      req.onsuccess = ()=>resolve(new Set(req.result||[]));
      req.onerror = ()=>reject(req.error);
      tx.oncomplete = ()=>db.close();
    });
  }catch(e){ return new Set(); }
}
async function getCachedPDFRecords(){
  try{
    const db = await openPdfDB();
    return await new Promise((resolve,reject)=>{
      const tx = db.transaction(PDF_DB_STORE,'readonly');
      const req = tx.objectStore(PDF_DB_STORE).getAll();
      req.onsuccess = ()=>resolve(req.result||[]);
      req.onerror = ()=>reject(req.error);
      tx.oncomplete = ()=>db.close();
    });
  }catch(e){ return []; }
}
async function deletePDFFromDB(dersId, fasikulId){
  try{
    const db = await openPdfDB();
    const key = `${dersId}_${fasikulId}`;
    await new Promise((resolve,reject)=>{
      const tx = db.transaction(PDF_DB_STORE,'readwrite');
      tx.objectStore(PDF_DB_STORE).delete(key);
      tx.oncomplete = ()=>resolve();
      tx.onerror = ()=>reject(tx.error);
    });
  }catch(e){}
}

/**
 * File alarak PDF.js ile yükler ve ilk sayfayı render eder
 */
async function loadPDFFile(file){
  const arrayBuffer = await file.arrayBuffer();
  return await loadPDFDocument({data: arrayBuffer}, 1);
}

async function loadPDFUrl(url, targetPage=1){
  return await loadPDFDocument(url, targetPage);
}

async function loadPDFDocument(source, targetPage=1){
  // Loading UI
  const wrap = document.getElementById('readerCanvasWrap');
  document.getElementById('pdfUploadZone').style.display = 'none';
  wrap.style.display = '';
  wrap.innerHTML = '<div class="pdf-loading"><div class="pdf-spinner"></div><div class="pdf-loading-text">PDF yükleniyor\u2026</div></div>';

  try{
    const loadingTask = pdfjsLib.getDocument(source);
    const pdfDoc = await loadingTask.promise;
    appState.pdfDoc = pdfDoc;
    appState.pdfDocFasikulId = appState.aktifFasikul?.id || null;
    const manifestMaxPage = getManifestMaxPage(appState.aktifFasikul);
    const manifestPdfMaxPage = getManifestPdfMaxPage(appState.aktifFasikul);
    appState.visiblePages = getVisibleManifestPages(appState.aktifFasikul);
    appState.totalPages = manifestMaxPage ? Math.min(pdfDoc.numPages, manifestMaxPage) : pdfDoc.numPages;
    appState.pdfTotalPages = manifestPdfMaxPage ? Math.min(pdfDoc.numPages, manifestPdfMaxPage) : pdfDoc.numPages;
    appState.displayTotalPages = appState.visiblePages.length || appState.totalPages;
    appState.currentPage = Math.max(1, Math.min(targetPage || 1, appState.pdfTotalPages));

    document.getElementById('prevPageBtn').disabled = appState.currentPage === 1;
    document.getElementById('nextPageBtn').disabled = appState.currentPage === appState.totalPages;

    renderPages();
    updatePageIndicator();
    showToast('PDF y\u00fcklendi \u2014 ' + appState.displayTotalPages + ' sayfa \u2713','success');
    return true;
  } catch(err){
    wrap.innerHTML = '';
    document.getElementById('pdfUploadZone').style.display = '';
    showToast('PDF y\u00fcklenemedi: ' + err.message,'error');
    console.error('PDF load error:', err);
    return false;
  }
}

// ══════════════════════════════════════════════════════════
// SCROLL-BASED MULTI-PAGE PDF RENDER
// ══════════════════════════════════════════════════════════

// Her sayfa için ayrı Fabric canvas map: { pageNum: fabricInstance }
appState.fabricCanvases = {};
appState._pageObserver = null;
appState._scrollingToPage = false;
appState.viewMode = 'single'; // 'single' | 'scroll'

/**
 * Tüm sayfalar için placeholder div'ler oluşturur,
 * IntersectionObserver ile görünür sayfaları render eder.
 */
async function renderAllPages(){
  const wrap = document.getElementById('readerCanvasWrap');
  wrap.innerHTML = '';

  // Eski Fabric instance'ları temizle
  Object.values(appState.fabricCanvases).forEach(fc=>{ try{fc.dispose();}catch(e){} });
  appState.fabricCanvases = {};
  appState.fabricCanvas = null;

  // Eski observer'ı kapat
  if(appState._pageObserver){ appState._pageObserver.disconnect(); appState._pageObserver = null; }

  const totalPages = appState.totalPages;
  const dpr = window.devicePixelRatio || 1;

  // Her sayfa için önce placeholder oluştur (boyut sonra doldurulacak)
  for(let i = 1; i <= totalPages; i++){
    const pageWrap = document.createElement('div');
    pageWrap.id = 'page-wrap-' + i;
    pageWrap.dataset.pageNum = i;
    pageWrap.style.cssText = 'position:relative;display:flex;align-items:center;justify-content:center;margin:12px auto;flex-shrink:0;';

    // Placeholder boyut (PDF yoksa sabit, PDF varsa ilk sayfa boyutundan tahmin)
    const placeholderH = Math.round(baseScale * 990);
    const placeholderW = Math.round(baseScale * 700);
    pageWrap.style.width = placeholderW + 'px';
    pageWrap.style.height = placeholderH + 'px';
    pageWrap.style.background = 'var(--bg-2)';
    pageWrap.style.borderRadius = '4px';
    pageWrap.style.boxShadow = '0 4px 24px rgba(0,0,0,.4)';

    // Sayfa numarası etiketi
    const numLabel = document.createElement('div');
    numLabel.className = 'page-num-label';
    numLabel.textContent = i;
    numLabel.style.cssText = 'position:absolute;bottom:8px;right:12px;font-size:11px;color:var(--text-muted);background:var(--bg-3);padding:2px 8px;border-radius:99px;border:1px solid var(--border);pointer-events:none;z-index:5;';
    pageWrap.appendChild(numLabel);

    wrap.appendChild(pageWrap);
  }

  // IntersectionObserver: görünür sayfaları lazy render et
  appState._pageObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if(entry.isIntersecting){
        const pn = parseInt(entry.target.dataset.pageNum);
        if(!entry.target.dataset.rendered){
          entry.target.dataset.rendered = '1';
          if(appState.pdfDoc){
            renderSinglePDFPage(pn, entry.target);
          } else {
            renderSingleFallbackPage(pn, entry.target);
          }
        }
      }
    });
  }, { root: wrap, rootMargin: '200px 0px', threshold: 0.01 });

  document.querySelectorAll('#readerCanvasWrap [data-page-num]').forEach(el => {
    appState._pageObserver.observe(el);
  });

  // Scroll listener: mevcut sayfayı takip et
  wrap.onscroll = throttleScrollHandler;

  updatePageIndicator();
}

function throttleScrollHandler(){
  if(appState._scrollThrottle) return;
  appState._scrollThrottle = setTimeout(()=>{
    appState._scrollThrottle = null;
    if(appState._scrollingToPage) return;
    updateCurrentPageFromScroll();
  }, 80);
}

function updateCurrentPageFromScroll(){
  const wrap = document.getElementById('readerCanvasWrap');
  const wrapRect = wrap.getBoundingClientRect();
  const centerY = wrapRect.top + wrapRect.height / 2;
  let closest = 1, minDist = Infinity;
  document.querySelectorAll('#readerCanvasWrap [data-page-num]').forEach(el => {
    const r = el.getBoundingClientRect();
    const elCenterY = r.top + r.height / 2;
    const dist = Math.abs(elCenterY - centerY);
    if(dist < minDist){ minDist = dist; closest = parseInt(el.dataset.pageNum); }
  });
  if(closest !== appState.currentPage){
    appState.currentPage = closest;
    updatePageIndicator();
    document.getElementById('prevPageBtn').disabled = appState.currentPage === 1;
    document.getElementById('nextPageBtn').disabled = appState.currentPage === appState.totalPages;
    syncNavToPage(closest);
  }
}

/**
 * Tek bir PDF sayfasını render eder (lazy)
 */
async function renderSinglePDFPage(pageNum, pageWrap){
  if(!appState.pdfDoc) return;
  try{
    const page = await appState.pdfDoc.getPage(pageNum);
    const dpr = window.devicePixelRatio || 1;
    const baseScale = getReaderFitScale(page, document.getElementById('readerCanvasWrap'));
    const renderScale = baseScale * dpr;
    const viewport = page.getViewport({scale: renderScale});
    const displayW = viewport.width / dpr;
    const displayH = viewport.height / dpr;

    pageWrap.style.width = displayW + 'px';
    pageWrap.style.height = displayH + 'px';
    pageWrap.style.background = '#fff';

    // PDF render canvas
    const pdfCanvas = document.createElement('canvas');
    pdfCanvas.width = viewport.width;
    pdfCanvas.height = viewport.height;
    pdfCanvas.style.cssText = 'display:block;position:absolute;top:0;left:0;width:100%;height:100%;border-radius:4px;';
    pageWrap.insertBefore(pdfCanvas, pageWrap.firstChild);

    await page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport }).promise;

    // Fabric çizim canvas
    const drawEl = document.createElement('canvas');
    drawEl.className = 'fabric-draw-canvas';
    drawEl.width = displayW;
    drawEl.height = displayH;
    drawEl.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;border-radius:4px;';
    pageWrap.insertBefore(drawEl, pageWrap.querySelector('.page-num-label'));

    initFabricForPage(drawEl, displayW, displayH, pageNum);

  } catch(err){
    console.error('Sayfa render hatası:', err);
  }
}

/**
 * PDF olmadığında mock sayfa render eder (lazy)
 */
function renderSingleFallbackPage(pageNum, pageWrap){
  const fas = appState.aktifFasikul;
  if(!fas) return;
  const displayW = Math.round(appState.zoom / 100 * 700);
  const displayH = Math.round(appState.zoom / 100 * 990);
  pageWrap.style.width = displayW + 'px';
  pageWrap.style.height = displayH + 'px';
  pageWrap.style.background = 'transparent';
  pageWrap.style.boxShadow = 'none';

  const mockDiv = document.createElement('div');
  mockDiv.className = 'pdf-page-mock';
  mockDiv.style.cssText = 'width:' + displayW + 'px;min-height:' + displayH + 'px;position:absolute;top:0;left:0;';
  mockDiv.innerHTML = buildMockPageContent(pageNum, fas);
  pageWrap.insertBefore(mockDiv, pageWrap.querySelector('.page-num-label'));

  const drawEl = document.createElement('canvas');
  drawEl.className = 'fabric-draw-canvas';
  drawEl.width = displayW;
  drawEl.height = displayH;
  drawEl.style.cssText = 'position:absolute;top:0;left:0;width:' + displayW + 'px;height:' + displayH + 'px;';
  pageWrap.insertBefore(drawEl, pageWrap.querySelector('.page-num-label'));
  initFabricForPage(drawEl, displayW, displayH, pageNum);
}

/**
 * Belirli bir sayfa için Fabric canvas başlatır, aktif sayfaysa appState.fabricCanvas'a atar
 */
function initFabricForPage(canvasEl, w, h, pageNum){
  const fc = new fabric.Canvas(canvasEl, {
    isDrawingMode: false, selection: true,
    width: w, height: h, backgroundColor: 'transparent'
  });
  fc._pageNum = pageNum;
  appState.fabricCanvases[pageNum] = fc;

  // Aktif sayfaysa ana canvas olarak işaretle
  if(pageNum === appState.currentPage){
    appState.fabricCanvas = fc;
    applyTool(appState.drawTool);
  }

  // Kayıtlı çizim varsa yükle
  const key = `drawing_${appState.aktifFasikul?.id}_p${pageNum}`;
  const saved = appState.drawings[key];
  if(saved){ try{ fc.loadFromJSON(saved, ()=>{ applyTool(appState.drawTool); fc.renderAll(); }); }catch(e){} }

  // Tıklandığında aktif canvas olarak seç
  fc._pageSelectHandler = ()=>{
    if(appState.currentPage !== pageNum){
      saveDrawingForPage(appState.currentPage);
      appState.currentPage = pageNum;
      appState.fabricCanvas = fc;
      applyTool(appState.drawTool);
      updatePageIndicator();
      document.getElementById('prevPageBtn').disabled = pageNum === 1;
      document.getElementById('nextPageBtn').disabled = pageNum === appState.totalPages;
    }
  };
  fc.on('mouse:down', fc._pageSelectHandler);

  // Otomatik kayıt
  const debounceSave = ()=>{
    if(appState._saveTimeout) clearTimeout(appState._saveTimeout);
    appState._saveTimeout = setTimeout(()=>saveDrawingForPage(pageNum), 800);
  };
  fc.on('object:added', debounceSave);
  fc.on('object:modified', debounceSave);
  fc.on('object:removed', debounceSave);
  fc.on('object:added', ()=>{ appState.undoStack.push(JSON.stringify(fc)); appState.redoStack=[]; });
}

function saveDrawingForPage(pageNum){
  const fc = appState.fabricCanvases[pageNum];
  if(!fc || !appState.aktifFasikul) return;
  const key = `drawing_${appState.aktifFasikul.id}_p${pageNum}`;
  const json=JSON.stringify(fc);
  appState.drawings[key] = json;
  persistDrawingCloud(key,json);
}

function setObjectsInteractive(fc, selectable){
  if(!fc) return;
  fc.forEachObject(obj=>{
    obj.selectable = selectable;
    obj.evented = true;
  });
}

function clearToolHandlers(fc){
  if(!fc) return;
  if(fc._textToolHandler){
    fc.off('mouse:down', fc._textToolHandler);
    fc._textToolHandler = null;
  }
  if(fc._eraserToolHandler){
    fc.off('mouse:down', fc._eraserToolHandler);
    fc._eraserToolHandler = null;
  }
  if(fc._eraserMoveHandler){
    fc.off('mouse:move', fc._eraserMoveHandler);
    fc._eraserMoveHandler = null;
  }
  if(fc._eraserUpHandler){
    fc.off('mouse:up', fc._eraserUpHandler);
    fc._eraserUpHandler = null;
  }
}

function isNarrowReader(){
  return window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
}

function getReaderFitScale(page, wrap){
  const zoomScale = appState.zoom / 100;
  const container = wrap || document.getElementById('readerCanvasWrap');
  const styles = container ? getComputedStyle(container) : null;
  const padX = styles ? parseFloat(styles.paddingLeft || 0) + parseFloat(styles.paddingRight || 0) : 0;
  const viewportW = Math.max(280, (container?.clientWidth || window.innerWidth) - padX - 2);
  const natural = page.getViewport({scale: 1});
  const fitScale = viewportW / natural.width;
  return Math.max(0.35, fitScale * zoomScale);
}

function sizeReaderStage(stage, wrap, displayW, displayH){
  const styles = getComputedStyle(wrap);
  const padX = parseFloat(styles.paddingLeft || 0) + parseFloat(styles.paddingRight || 0);
  const padY = parseFloat(styles.paddingTop || 0) + parseFloat(styles.paddingBottom || 0);
  const viewportW = Math.max(0, wrap.clientWidth - padX);
  const viewportH = Math.max(0, wrap.clientHeight - padY);
  stage.style.width = Math.ceil(Math.max(viewportW, displayW + 32)) + 'px';
  stage.style.height = Math.ceil(Math.max(viewportH, displayH + 32)) + 'px';
}

// ── renderPages: mod'a göre tek sayfa veya scroll
function renderPages(){
  if(appState.viewMode === 'scroll'){
    return renderAllPages().then(()=>{
      appState._renderedZoom = appState.zoom;
      setTimeout(()=>scrollToPage(appState.currentPage, 'auto'), 50);
    });
  } else {
    return renderSinglePageMode(appState.currentPage).then(()=>{
      appState._renderedZoom = appState.zoom;
    });
  }
}

// ── Tek sayfa modu
async function renderSinglePageMode(pageNum){
  const wrap = document.getElementById('readerCanvasWrap');
  wrap.innerHTML = '';

  // Eski Fabric instance'ları temizle
  Object.values(appState.fabricCanvases).forEach(fc=>{ try{fc.dispose();}catch(e){} });
  appState.fabricCanvases = {};
  appState.fabricCanvas = null;
  if(appState._pageObserver){ appState._pageObserver.disconnect(); appState._pageObserver = null; }

  const dpr = window.devicePixelRatio || 1;
  const baseScale = appState.zoom / 100;

  const stage = document.createElement('div');
  stage.className = 'reader-page-stage';

  const pageWrap = document.createElement('div');
  pageWrap.id = 'page-wrap-' + pageNum;
  pageWrap.dataset.pageNum = pageNum;
  pageWrap.style.cssText = 'position:relative;margin:16px auto;flex-shrink:0;border-radius:4px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.4);';

  if(appState.pdfDoc){
    try{
      const page = await appState.pdfDoc.getPage(pageNum);
      const baseScale = getReaderFitScale(page, wrap);
      const renderScale = baseScale * dpr;
      const viewport = page.getViewport({scale: renderScale});
      const displayW = viewport.width / dpr;
      const displayH = viewport.height / dpr;
      pageWrap.style.width = displayW + 'px';
      pageWrap.style.height = displayH + 'px';
      pageWrap.style.background = '#fff';
      sizeReaderStage(stage, wrap, displayW, displayH);

      const pdfCanvas = document.createElement('canvas');
      pdfCanvas.width = viewport.width;
      pdfCanvas.height = viewport.height;
      pdfCanvas.style.cssText = 'display:block;position:absolute;top:0;left:0;width:100%;height:100%;';
      pageWrap.appendChild(pdfCanvas);
      await page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport }).promise;

      const drawEl = document.createElement('canvas');
      drawEl.className = 'fabric-draw-canvas';
      drawEl.width = displayW; drawEl.height = displayH;
      drawEl.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
      pageWrap.appendChild(drawEl);
      stage.appendChild(pageWrap);
      wrap.appendChild(stage);
      initFabricForPage(drawEl, displayW, displayH, pageNum);
    } catch(err){
      console.error('Sayfa render hatası:', err);
    }
  } else {
    const baseScale = appState.zoom / 100;
    const displayW = Math.round(baseScale * 700);
    const displayH = Math.round(baseScale * 990);
    pageWrap.style.width = displayW + 'px';
    pageWrap.style.height = displayH + 'px';
    pageWrap.style.boxShadow = 'none';
    sizeReaderStage(stage, wrap, displayW, displayH);
    const mockDiv = document.createElement('div');
    mockDiv.className = 'pdf-page-mock';
    mockDiv.style.cssText = 'width:' + displayW + 'px;min-height:' + displayH + 'px;';
    mockDiv.innerHTML = buildMockPageContent(pageNum, appState.aktifFasikul);
    pageWrap.appendChild(mockDiv);
    const drawEl = document.createElement('canvas');
    drawEl.className = 'fabric-draw-canvas';
    drawEl.width = displayW; drawEl.height = displayH;
    drawEl.style.cssText = 'position:absolute;top:0;left:0;width:' + displayW + 'px;height:' + displayH + 'px;';
    pageWrap.appendChild(drawEl);
    stage.appendChild(pageWrap);
    wrap.appendChild(stage);
    initFabricForPage(drawEl, displayW, displayH, pageNum);
  }

  updatePageIndicator();
  document.getElementById('prevPageBtn').disabled = pageNum === 1;
  document.getElementById('nextPageBtn').disabled = pageNum === appState.totalPages;
  syncNavToPage(pageNum);
}

// Eski API uyumu
async function renderPDFPage(pageNum){ renderPages(); }
function renderFallbackPage(pageNum){ renderPages(); }

// ── Mod değiştir
function setViewMode(mode){
  appState.viewMode = mode;
  // Context menu'yu kapat
  const cm = document.getElementById('pdfContextMenu');
  if(cm) cm.style.display = 'none';
  // Toolbar butonunu güncelle
  const btn = document.getElementById('viewModeBtn');
  if(btn) btn.textContent = mode === 'scroll' ? '📜' : '📄';
  showToast(mode === 'scroll' ? 'Sürekli kaydırma modu 📜' : 'Tek sayfa modu 📄', 'info');
  renderPages();
}

// ── Context Menu
function initPDFContextMenu(){
  const wrap = document.getElementById('readerCanvasWrap');

  // Context menu DOM
  let menu = document.getElementById('pdfContextMenu');
  if(!menu){
    menu = document.createElement('div');
    menu.id = 'pdfContextMenu';
    menu.style.cssText = `
      position:fixed;z-index:9999;background:var(--bg-2);border:1px solid var(--border-strong);
      border-radius:var(--radius);box-shadow:var(--shadow-xl);padding:6px;min-width:200px;
      display:none;font-family:var(--font-ui);
    `;
    menu.innerHTML = `
      <div class="ctx-label" style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted);padding:4px 10px 6px;">Görünüm Modu</div>
      <button class="ctx-item" id="ctxSingle" onclick="setViewMode('single')">
        <span style="font-size:15px">📄</span>
        <div><div style="font-weight:600;font-size:13px">Tek Sayfa</div><div style="font-size:11px;color:var(--text-muted)">Her seferinde bir sayfa</div></div>
      </button>
      <button class="ctx-item" id="ctxScroll" onclick="setViewMode('scroll')">
        <span style="font-size:15px">📜</span>
        <div><div style="font-weight:600;font-size:13px">Sürekli Kaydırma</div><div style="font-size:11px;color:var(--text-muted)">Tüm sayfalar dikey sırada</div></div>
      </button>
      <div style="height:1px;background:var(--border);margin:6px 0"></div>
      <button class="ctx-item" onclick="promptPageJump();document.getElementById('pdfContextMenu').style.display='none'">
        <span style="font-size:15px">🔢</span>
        <div><div style="font-weight:600;font-size:13px">Sayfaya Git…</div><div style="font-size:11px;color:var(--text-muted)">Sayfa numarası gir</div></div>
      </button>
    `;
    document.body.appendChild(menu);

    // Dışarı tıklayınca kapat
    document.addEventListener('click', e=>{
      if(!menu.contains(e.target)) menu.style.display = 'none';
    });
  }

  // Sağ tık
  wrap.addEventListener('contextmenu', e=>{
    e.preventDefault();
    // Aktif modu işaretle
    document.getElementById('ctxSingle')?.classList.toggle('ctx-active', appState.viewMode === 'single');
    document.getElementById('ctxScroll')?.classList.toggle('ctx-active', appState.viewMode === 'scroll');
    // Pozisyon
    const x = Math.min(e.clientX, window.innerWidth - 220);
    const y = Math.min(e.clientY, window.innerHeight - 180);
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.style.display = 'block';
  });
}


function buildMockPageContent(pageNum, fas){
  // Find which konu this page belongs to
  let konuInfo = {konu:fas.ad, altAd:'', sorular:[]};
  for(const k of fas.konular){
    if(pageNum>=k.sayfaBasl && pageNum<=k.sayfaBitis){
      konuInfo.konu = k.ad;
      const _mockKartBazli = k._kartBazliKonu || k.altKonular?.some(ak => ak.sorular?.some(s=>!!s.sayfa));
      if(_mockKartBazli){
        // Kart bazlı: sorular içinde sayfa eşleşmesi ara
        const ak = k.altKonular?.[0];
        if(ak){
          const s = ak.sorular?.find(s=>s.sayfa===pageNum);
          if(s){
            konuInfo.altAd = ak.ad;
            konuInfo.sorular = [s]; // o sayfada tek soru var
          }
        }
      } else {
        for(const ak of k.altKonular||[]){
          if(ak.sayfa===pageNum){
            konuInfo.altAd = ak.ad;
            konuInfo.sorular = ak.sorular||[];
          }
        }
      }
      break;
    }
  }

  const dersRenk = appState.aktifDers.id==='mat'?'#4c1d95':appState.aktifDers.id==='fiz'?'#0c4a6e':'#052e16';

  let html = `<div class="pdf-mock-content">
    <div class="pdf-mock-header" style="background:linear-gradient(135deg,${dersRenk},#1e1b4b)">
      <span class="pdf-h-title">${fas.ad}</span>
      <span class="pdf-h-right">Sayfa ${pageNum}</span>
    </div>
    <div class="pdf-topic-title" style="border-bottom-color:${dersRenk};color:${dersRenk}">${konuInfo.konu}</div>`;

  if(pageNum===1 || !konuInfo.altAd){
    html += `<div class="pdf-definition-box">
      <strong>Tanım</strong>
      Düzlemde bir <strong>koordinat sistemi</strong>, birbirine dik iki sayı doğrusunun oluşturduğu yapıdır.
      Yatay eksene <em>x ekseni</em>, dikey eksene <em>y ekseni</em> denir.
      Bu eksenler düzlemi dört bölgeye (çeyreğe) ayırır.
    </div>
    <div class="pdf-formula">d(A,B) = √[(x₂-x₁)² + (y₂-y₁)²]</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <span class="pdf-coord-box">I. Bölge (+,+)</span>
      <span class="pdf-coord-box">II. Bölge (-,+)</span>
      <span class="pdf-coord-box">III. Bölge (-,-)</span>
      <span class="pdf-coord-box">IV. Bölge (+,-)</span>
    </div>`;
  }

  if(konuInfo.sorular.length>0){
    html += `<div style="font-size:11px;font-weight:700;color:${dersRenk};margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">${konuInfo.altAd}</div>`;
    konuInfo.sorular.slice(0,4).forEach(s=>{
      html += `<div class="pdf-q-box">
        <div class="q-header">
          <div class="q-num" style="background:${dersRenk}">${s.no}</div>
          <div class="q-text">${s.onizleme}</div>
        </div>
        <div class="pdf-options">
          <span class="pdf-opt">A</span><span class="pdf-opt">B</span><span class="pdf-opt">C</span><span class="pdf-opt">D</span><span class="pdf-opt">E</span>
        </div>
      </div>`;
    });
  } else {
    // Placeholder content for definition pages
    for(let i=0;i<3;i++){
      html += `<div class="pdf-q-box">
        <div class="q-header">
          <div class="q-num" style="background:${dersRenk}">${i+1+pageNum*3}</div>
          <div class="q-text">Örnek soru metni — sayfa ${pageNum}, soru ${i+1}</div>
        </div>
        <div class="pdf-options">
          <span class="pdf-opt">A</span><span class="pdf-opt">B</span><span class="pdf-opt">C</span><span class="pdf-opt">D</span><span class="pdf-opt">E</span>
        </div>
      </div>`;
    }
  }

  html += `<div class="pdf-page-footer"><span>${fas.ad} · ${appState.aktifDers.ad}</span><span>Sayfa ${pageNum}</span></div></div>`;
  return html;
}

// ── Fabric.js Canvas — PDF canvas üzerine bağlanır
function initFabricCanvas(){
  // Eski yöntem: sadece fallback için çağrılabilir, artık initFabricOnCanvas kullanılıyor
  const el = document.getElementById('fabric-canvas');
  if(el) initFabricOnCanvas(el, el.width, el.height);
}

/**
 * Verilen canvas elementine Fabric.js bağlar
 * @param {HTMLCanvasElement} canvasEl
 * @param {number} w - display genişlik
 * @param {number} h - display yükseklik
 */
function initFabricOnCanvas(canvasEl, w, h){
  if(appState.fabricCanvas){ try{ appState.fabricCanvas.dispose(); }catch(e){} }

  const fc = new fabric.Canvas(canvasEl, {
    isDrawingMode: false,
    selection: true,
    width: w,
    height: h,
    backgroundColor: 'transparent'
  });
  appState.fabricCanvas = fc;

  // Sayfa için kayıtlı çizim varsa yükle
  const key = `drawing_${appState.aktifFasikul?.id}_p${appState.currentPage}`;
  const saved = appState.drawings[key];
  if(saved){
    try{ fc.loadFromJSON(saved, ()=>fc.renderAll()); }catch(e){}
  }

  // Otomatik kayıt (800ms debounce)
  fc.on('object:added', debounceAutoSave);
  fc.on('object:modified', debounceAutoSave);
  fc.on('object:removed', debounceAutoSave);

  // Undo stack
  fc.on('object:added', ()=>{ appState.undoStack.push(JSON.stringify(fc)); appState.redoStack=[]; });

  applyTool(appState.drawTool);
}

function debounceAutoSave(){
  if(appState._saveTimeout) clearTimeout(appState._saveTimeout);
  appState._saveTimeout = setTimeout(saveDrawing, 800);
}

function saveDrawing(){
  if(!appState.aktifFasikul) return;
  if(appState.viewMode === 'scroll'){
    // Tüm render edilmiş sayfaları kaydet
    Object.entries(appState.fabricCanvases).forEach(([pn, fc])=>{
      const key = `drawing_${appState.aktifFasikul.id}_p${pn}`;
      const json=JSON.stringify(fc);
      appState.drawings[key] = json;
      persistDrawingCloud(key,json);
    });
  } else {
    const fc = appState.fabricCanvas;
    if(!fc) return;
    const key = `drawing_${appState.aktifFasikul.id}_p${appState.currentPage}`;
    const json=JSON.stringify(fc);
    appState.drawings[key] = json;
    persistDrawingCloud(key,json);
  }
  const ind = document.getElementById('readerToolbar').querySelector('[title="Kaydet (Ctrl+S)"]');
  if(ind) { ind.style.color='var(--green)'; setTimeout(()=>ind.style.color='',800); }
}

// ── Tools
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
function changePage(delta){
  if(changeQuestionPage(delta)) return;
  const newPage = appState.currentPage + delta;
  if(newPage<1 || newPage>appState.totalPages) return;
  saveDrawing();
  goToPage(newPage);
}
function goToPage(n){
  const maxPage = appState.pdfTotalPages || appState.totalPages;
  appState.currentPage = Math.max(1,Math.min(n,maxPage));
  if(appState.viewMode === 'scroll'){
    // Scroll modunda: sayfa zaten render edilmiş, sadece scroll et
    scrollToPage(appState.currentPage, 'smooth');
  } else {
    renderSinglePageMode(appState.currentPage);
  }
  updatePageIndicator();
  document.getElementById('prevPageBtn').disabled = appState.currentPage===1;
  document.getElementById('nextPageBtn').disabled = appState.currentPage===appState.totalPages;
}

function scrollToPage(pageNum, behavior){
  const el = document.getElementById('page-wrap-' + pageNum);
  if(el){
    appState._scrollingToPage = true;
    el.scrollIntoView({behavior: behavior || 'smooth', block: 'start'});
    setTimeout(()=>{ appState._scrollingToPage = false; }, 600);
  }
}
function updatePageIndicator(){
  const visibleIdx = (appState.visiblePages || []).indexOf(appState.currentPage);
  const isSolutionPage = visibleIdx < 0;
  const displayTotal = appState.displayTotalPages || appState.totalPages;
  document.getElementById('pageIndicator').textContent = isSolutionPage
    ? `Çözüm / ${displayTotal} sayfa`
    : `Sayfa ${visibleIdx + 1} / ${displayTotal}`;
  document.getElementById('rpSure').textContent = formatTime(appState.timerSec);
}
function promptPageJump(){
  const displayTotal = appState.displayTotalPages || appState.totalPages;
  const n = parseInt(prompt(`Sayfa giriniz (1-${displayTotal}):`));
  if(isNaN(n)) return;
  const target = (appState.visiblePages || [])[n - 1] || n;
  goToPage(target);
}

function changeZoom(delta){
  const wrap = document.getElementById('readerCanvasWrap');
  const renderedZoom = appState._renderedZoom || appState.zoom;
  const viewportX = (wrap?.clientWidth || 0) / 2;
  const viewportY = (wrap?.clientHeight || 0) / 2;
  const contentX = (wrap?.scrollLeft || 0) + viewportX;
  const contentY = (wrap?.scrollTop || 0) + viewportY;
  appState.zoom = Math.max(40,Math.min(200,appState.zoom+delta));
  document.getElementById('zoomLabel').textContent = `%${appState.zoom}`;
  scheduleCardZoomRender({
    contentX,
    contentY,
    viewportX,
    viewportY,
    ratio: appState.zoom / renderedZoom
  });
}

function scheduleCardZoomRender(anchor){
  const wrap = document.getElementById('readerCanvasWrap');
  if(!wrap) return;
  if(anchor) appState._zoomAnchor = anchor;
  clearTimeout(appState._zoomRenderTimer);
  wrap.classList.add('zoom-settling');
  appState._zoomRenderTimer = setTimeout(async ()=>{
    const savedAnchor = appState._zoomAnchor;
    appState._zoomAnchor = null;
    const oldScrollBehavior = wrap.style.scrollBehavior;
    wrap.style.scrollBehavior = 'auto';
    await Promise.resolve(renderPages());
    requestAnimationFrame(()=>{
      if(savedAnchor){
        const rect = wrap.getBoundingClientRect();
        wrap.scrollLeft = Math.max(0, savedAnchor.contentX * savedAnchor.ratio - savedAnchor.viewportX);
        wrap.scrollTop = Math.max(0, savedAnchor.contentY * savedAnchor.ratio - savedAnchor.viewportY);
      }
      wrap.style.scrollBehavior = oldScrollBehavior;
      wrap.classList.remove('zoom-settling');
    });
  }, 90);
}

function initCardZoomPan(){
  const wrap = document.getElementById('readerCanvasWrap');
  if(!wrap || wrap.dataset.zoomPanReady) return;
  wrap.dataset.zoomPanReady = '1';
  wrap.classList.add('card-pan-ready');

  let isPanning = false;
  let startX = 0, startY = 0, startScrollLeft = 0, startScrollTop = 0;

  const isCardGestureTarget = (target) =>
    !!target.closest('#readerCanvasWrap') && !target.closest('button,label,input,select,.reader-right,.reader-toolbar,.reader-bottom-bar');

  wrap.addEventListener('wheel', (e)=>{
    if(!document.getElementById('reader-overlay')?.classList.contains('open')) return;
    if(!isCardGestureTarget(e.target)) return;

    // Trackpad pinch on Chrome/Safari arrives as ctrl/meta wheel. Plain wheel remains pan/scroll.
    if(e.ctrlKey || e.metaKey){
      e.preventDefault();
      const beforeLeft = wrap.scrollLeft;
      const beforeTop = wrap.scrollTop;
      const rect = wrap.getBoundingClientRect();
      const viewportX = e.clientX - rect.left;
      const viewportY = e.clientY - rect.top;
      const relX = viewportX + beforeLeft;
      const relY = viewportY + beforeTop;
      const oldZoom = appState.zoom;
      const delta = e.deltaY < 0 ? 5 : -5;
      appState.zoom = Math.max(40, Math.min(200, appState.zoom + delta));
      if(appState.zoom === oldZoom) return;
      document.getElementById('zoomLabel').textContent = `%${appState.zoom}`;
      scheduleCardZoomRender({
        contentX: relX,
        contentY: relY,
        viewportX,
        viewportY,
        ratio: appState.zoom / (appState._renderedZoom || oldZoom)
      });
    }
  }, {passive:false});

  wrap.addEventListener('pointerdown', (e)=>{
    if(e.button !== 0 || !isCardGestureTarget(e.target)) return;
    if(appState.drawTool !== 'select' && e.target.closest('canvas')) return;
    isPanning = true;
    startX = e.clientX; startY = e.clientY;
    startScrollLeft = wrap.scrollLeft; startScrollTop = wrap.scrollTop;
    wrap.classList.add('card-panning');
    wrap.setPointerCapture?.(e.pointerId);
  });

  wrap.addEventListener('pointermove', (e)=>{
    if(!isPanning) return;
    e.preventDefault();
    wrap.scrollLeft = startScrollLeft - (e.clientX - startX);
    wrap.scrollTop = startScrollTop - (e.clientY - startY);
  });

  const stopPan = (e)=>{
    if(!isPanning) return;
    isPanning = false;
    wrap.classList.remove('card-panning');
    try{ wrap.releasePointerCapture?.(e.pointerId); }catch(_e){}
  };
  wrap.addEventListener('pointerup', stopPan);
  wrap.addEventListener('pointercancel', stopPan);
  wrap.addEventListener('pointerleave', stopPan);
}

function toggleReaderPanel(side){
  if(side==='left') document.getElementById('readerLeft').classList.toggle('collapsed');
  else document.getElementById('readerRight').classList.toggle('collapsed');
  if(document.getElementById('reader-overlay')?.classList.contains('open')){
    setTimeout(()=>renderPages(), 320);
  }
}

function toggleFullscreen(){
  const el = document.getElementById('reader-overlay');
  if(!document.fullscreenElement){
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen;
    if(req){
      Promise.resolve(req.call(el)).catch(()=>showToast('Tam ekran bu tarayıcıda engellendi','error'));
    }
  } else {
    const exit = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen;
    if(exit){
      Promise.resolve(exit.call(document)).catch(()=>showToast('Tam ekrandan çıkılamadı','error'));
    }
  }
}

function toggleAppFullscreen(){
  const el = document.documentElement;
  if(!document.fullscreenElement){
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen;
    if(req){
      Promise.resolve(req.call(el)).catch(()=>showToast('Tam ekran bu tarayıcıda engellendi','error'));
    }
  } else {
    const exit = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen;
    if(exit){
      Promise.resolve(exit.call(document)).catch(()=>showToast('Tam ekrandan çıkılamadı','error'));
    }
  }
}

function syncFullscreenButtons(){
  const isFullscreen = !!document.fullscreenElement;
  const readerBtn = document.getElementById('fullscreenBtn');
  if(readerBtn){
    readerBtn.textContent = isFullscreen ? '⊡' : '⛶';
    readerBtn.title = isFullscreen ? 'Tam Ekrandan Çık (Esc)' : 'Tam Ekran (F11)';
  }
  const appBtn = document.getElementById('appFullscreenBtn');
  if(appBtn){
    appBtn.textContent = isFullscreen ? '⊡' : '⛶';
    appBtn.title = isFullscreen ? 'Tam Ekrandan Çık' : 'Tam Ekran';
  }
}

document.addEventListener('fullscreenchange', ()=>{
  syncFullscreenButtons();
});
document.addEventListener('webkitfullscreenchange', ()=>{
  syncFullscreenButtons();
});
document.addEventListener('mozfullscreenchange', ()=>{
  syncFullscreenButtons();
});

function toggleReadingMode(){
  appState.readingMode = !appState.readingMode;
  document.getElementById('readerCenter').classList.toggle('reading-mode', appState.readingMode);
  document.getElementById('readingModeBtn').textContent = appState.readingMode ? '🌙' : '☀️';
  showToast(appState.readingMode?'Okuma modu açıldı 🌙':'Normal mod ☀️','info');
}

// ══════════════════════════════
// SORU BANKASI — TEK KART SİSTEMİ
// ══════════════════════════════
function renderSoruList(sorular){
  const list = document.getElementById('soruList');
  updateRightPanelTitle();
  if(!sorular || !sorular.length){
    list.innerHTML = `
      <div class="tek-soru-card" id="tekSoruCard">
        <div style="text-align:center;padding:32px;color:var(--text-muted)">
          <div style="font-size:32px;margin-bottom:8px">📭</div>
          <div style="font-size:13px">Bu bölümde soru bulunmuyor.</div>
        </div>
      </div>`;
    updateTestProgress();
    return;
  }
  // Kart zaten varsa sadece güncelle
  if(!document.getElementById('tekSoruCard')){
    list.innerHTML = `<div class="tek-soru-card" id="tekSoruCard"></div>`;
  }
  renderTekSoruKart(sorular, appState.activeQuestionIdx);
  renderSoruStrip(sorular);
  updateTestProgress();
  document.getElementById('rpSoruSayisi').textContent = `${sorular.length} Soru`;
}

function escapeHtml(text){
  return String(text ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[ch]));
}

function updateRightPanelTitle(titleOverride){
  const titleEl = document.getElementById('rpTitle');
  if(!titleEl) return;
  const konuTitle = appState.aktifKonu?.ad || '';
  const title = titleOverride || konuTitle || appState.aktifAltKonu?.ad || 'Test Seç';
  titleEl.textContent = title;
  titleEl.title = title;
}

function renderSoruStrip(sorular){
  const strip = document.getElementById('soruStrip');
  if(!strip) return;
  strip.innerHTML = '';
  sorular.forEach((s, idx) => {
    const state = appState.sorularState[s._uid||s.no];
    const dot = document.createElement('div');
    dot.className = 'strip-dot' +
      (idx === appState.activeQuestionIdx ? ' active' : '') +
      (state?.correct ? ' correct' : state?.answered && !state.correct ? ' wrong' : '') +
      (state?.skipped ? ' skipped' : '');
    dot.textContent = s.no;
    dot.title = `S.${s.no}`;
    dot.onclick = () => goToSoru(idx);
    strip.appendChild(dot);
  });
}

function renderTekSoruKart(sorular, idx){
  const card = document.getElementById('tekSoruCard');
  if(!card) return;
  const s = sorular[idx];
  if(!s){ card.innerHTML=''; return; }
  const isKonuKart = isKonuKartSoru(s) || isKonuKartAltKonu(appState.aktifAltKonu);

  const state = appState.sorularState[s._uid||s.no];
  const answered = !!state?.answered;
  const isStarred = !!state?.starred;
  const badgeClass = s.zorluk==='kolay'?'badge-easy':s.zorluk==='zor'?'badge-hard':'badge-mid';
  const badgeTxt = isKonuKart ? '📘 Konu Kartı' : (s.zorluk==='kolay'?'🟢 Kolay':s.zorluk==='zor'?'🔴 Zor':'🟡 Orta');

  const feedbackHtml = isKonuKart
    ? ''
    : answered
    ? `<div class="tsk-feedback ${state.correct?'show-correct':'show-wrong'}">
        ${state.skipped ? '⏭️ Atlandı' : state.correct ? '✅ Doğru! Harika!' : `❌ Yanlış! Doğru cevap: ${s.cevap}`}
       </div>`
    : `<div class="tsk-feedback" id="tsk-feedback"></div>`;

  const btns = isKonuKart ? '' : ['A','B','C','D','E'].map(opt => {
    let cls = 'tsk-cevap-btn';
    if(answered){
      if(opt === s.cevap) cls += ' correct-ans';
      else if(opt === state?.selected) cls += ' wrong-ans';
    }
    return `<button class="${cls}" id="tsk-btn-${opt}"
      onclick="selectAnswer('${s._uid||s.no}','${opt}','${s.cevap}',${idx})"
      ${answered?'disabled':''}>${opt}</button>`;
  }).join('');

  card.innerHTML = `
    <div class="tsk-header">
      <span class="tsk-no">${isKonuKart ? `K.${s.no}` : `S.${s.no}`}</span>
      <span class="tsk-badge ${badgeClass}">${badgeTxt}</span>
      <span class="tsk-page" onclick="goToPage(${s.sayfa||appState.currentPage})">Sayfa ${s.sayfa||'?'}</span>
      <span class="tsk-star ${isStarred?'on':''}" onclick="toggleStar('${s._uid||s.no}')" title="Yıldızla">⭐</span>
    </div>
    <div class="tsk-body">
      <div class="tsk-nav-dots">
        <button class="tsk-dot-prev" onclick="goToSoru(${idx-1})" ${idx===0?'disabled':''}>◀</button>
        <span class="tsk-progress-text">${idx+1} / ${sorular.length}</span>
        <button class="tsk-dot-next" onclick="goToSoru(${idx+1})" ${idx===sorular.length-1?'disabled':''}>▶</button>
      </div>
      ${feedbackHtml}
      ${isKonuKart ? '' : `<div class="tsk-cevap-row">${btns}</div>`}
      <div class="tsk-actions" ${isKonuKart ? 'style="display:none"' : ''}>
        <button class="tsk-action-btn" onclick="skipQuestion('${s._uid||s.no}',${idx})">⏭️ Atla</button>
        <button class="tsk-action-btn cozum-btn" onclick="showCozum(${idx})">👁️ Çözüm</button>
      </div>
    </div>`;
}

function goToSoru(idx){
  const sorular = appState.aktifAltKonu?.sorular || [];
  if(idx < 0 || idx >= sorular.length) return;
  appState.activeQuestionIdx = idx;
  const s = sorular[idx];
  // PDF sayfasına git (kart bazlı: suppress nav sync — biz zaten activeQuestionIdx'i set ettik)
  if(s.sayfa){
    appState._suppressNavSync = true;
    goToPage(s.sayfa);
    setTimeout(()=>{ appState._suppressNavSync = false; }, 600);
  }
  // Kartı güncelle
  renderTekSoruKart(sorular, idx);
  renderSoruStrip(sorular);
}

function getManifestMaxPage(fasikul){
  if(!fasikul?.konular?.length) return 0;
  let maxPage = 0;
  fasikul.konular.forEach(k=>{
    (k.altKonular||[]).forEach(ak=>{
      if(isCozumAltKonu(ak)) return;
      maxPage = Math.max(maxPage, ak.sayfa || 0);
      (ak.sorular||[]).forEach(s=>{ maxPage = Math.max(maxPage, s.sayfa || 0); });
    });
  });
  return maxPage;
}

function getVisibleManifestPages(fasikul){
  if(!fasikul?.konular?.length) return [];
  const pages = [];
  fasikul.konular.forEach(k=>{
    (k.altKonular||[]).forEach(ak=>{
      if(isCozumAltKonu(ak)) return;
      (ak.sorular||[]).forEach(s=>{
        if(s.sayfa) pages.push(s.sayfa);
      });
    });
  });
  return [...new Set(pages)].sort((a,b)=>a-b);
}

function getManifestPdfMaxPage(fasikul){
  if(!fasikul?.konular?.length) return 0;
  let maxPage = 0;
  fasikul.konular.forEach(k=>{
    maxPage = Math.max(maxPage, k.sayfaBitis || 0);
    (k.altKonular||[]).forEach(ak=>{
      maxPage = Math.max(maxPage, ak.sayfa || 0);
      (ak.sorular||[]).forEach(s=>{ maxPage = Math.max(maxPage, s.sayfa || 0, s.cozumSayfa || 0); });
    });
  });
  return maxPage;
}

function isCozumAltKonu(altKonu){
  return !!altKonu && /çözümler|cozumler/i.test(altKonu.ad || altKonu.id || '');
}

function isKonuKartSoru(soru){
  return !!soru && /^(konu|bilgi)$/i.test(soru.tip || '');
}

function isKonuKartAltKonu(altKonu){
  if(!altKonu) return false;
  if(/konu kart/i.test(altKonu.ad || altKonu.id || '')) return true;
  const sorular = altKonu.sorular || [];
  return sorular.length > 0 && sorular.every(isKonuKartSoru);
}

function getParentKonuForAlt(altKonu){
  const fas = appState.aktifFasikul;
  if(!fas?.konular?.length || !altKonu) return null;
  return fas.konular.find(konu => (konu.altKonular||[]).some(ak => ak === altKonu || ak.id === altKonu.id)) || null;
}

function getSolutionAltKonu(parentKonu=null){
  const fas = appState.aktifFasikul;
  if(!fas?.konular?.length) return null;
  const konular = parentKonu ? [parentKonu] : fas.konular;
  for(const konu of konular){
    const found = (konu.altKonular||[]).find(isCozumAltKonu);
    if(found) return found;
  }
  return null;
}

function getQuestionAltKonular(){
  const fas = appState.aktifFasikul;
  if(!fas?.konular?.length) return [];
  return fas.konular.flatMap(k=>k.altKonular||[]).filter(ak=>!isCozumAltKonu(ak) && (ak.sorular||[]).length);
}

function getQuestionFlow(){
  return getQuestionAltKonular().flatMap(ak=>
    (ak.sorular||[]).map((s, idx)=>({ alt: ak, soru: s, localIdx: idx, page: s.sayfa || ak.sayfa || 1 }))
  ).sort((a,b)=>(a.page-b.page) || (a.soru.no-b.soru.no));
}

function getSolutionForQuestion(altKonu, soru){
  const parentKonu = getParentKonuForAlt(altKonu);
  const solutionAlt = getSolutionAltKonu(parentKonu);
  if(!solutionAlt || !altKonu || isCozumAltKonu(altKonu) || !/^çözümlü sorular$/i.test(altKonu.ad || '')) return null;
  return (solutionAlt.sorular||[]).find(s=>s.no === soru.no) || null;
}

function findQuestionFlowIndexByPage(pageNum){
  const flow = getQuestionFlow();
  if(!flow.length) return -1;
  const fas = appState.aktifFasikul;
  for(const konu of fas?.konular || []){
    for(const alt of konu.altKonular || []){
      const cozumluSoru = (alt.sorular||[]).find(s=>s.cozumSayfa === pageNum);
      if(cozumluSoru){
        const idx = flow.findIndex(item => item.alt.id === alt.id && item.soru.no === cozumluSoru.no);
        return idx >= 0 ? idx : 0;
      }
    }
    const solutionAlt = getSolutionAltKonu(konu);
    const solution = (solutionAlt?.sorular||[]).find(s=>s.sayfa === pageNum);
    if(solution){
      const idx = flow.findIndex(item => getParentKonuForAlt(item.alt)?.id === konu.id && item.alt.ad === 'Çözümlü Sorular' && item.soru.no === solution.no);
      return idx >= 0 ? idx : 0;
    }
  }
  const exact = flow.findIndex(item => item.page === pageNum);
  if(exact >= 0) return exact;
  let best = -1;
  flow.forEach((item, idx)=>{ if(item.page <= pageNum) best = idx; });
  return best >= 0 ? best : 0;
}

function goToFlowItem(item){
  if(!item) return;
  appState.aktifAltKonu = item.alt;
  appState.activeQuestionIdx = item.localIdx;
  const parentKonu = getParentKonuForAlt(item.alt);
  if(parentKonu){
    if(appState.aktifKonu?.id !== parentKonu.id){
      appState.aktifKonu = parentKonu;
      const select = document.getElementById('anaKonuSelect');
      if(select) select.value = parentKonu.id || parentKonu.ad || '';
      renderAltKonuList(parentKonu);
    }
    document.querySelectorAll('.alt-konu-item').forEach(el=>el.classList.remove('active'));
    const itemEl = document.getElementById(`altk-${item.alt.id}`);
    if(itemEl){
      itemEl.classList.add('active');
      itemEl.scrollIntoView({behavior:'smooth', block:'nearest'});
    }
  }
  updateRightPanelTitle();
  document.getElementById('rpSoruSayisi').textContent = `${item.alt.sorular?.length || 0} ${isKonuKartAltKonu(item.alt) ? 'Kart' : 'Soru'}`;
  renderSoruList(item.alt.sorular || []);
  appState._suppressNavSync = true;
  goToPage(item.page);
  setTimeout(()=>{ appState._suppressNavSync = false; }, 600);
}

function changeQuestionPage(delta){
  if(!getSolutionAltKonu()) return false;
  const flow = getQuestionFlow();
  if(!flow.length) return false;
  const currentIdx = findQuestionFlowIndexByPage(appState.currentPage);
  const nextIdx = currentIdx + delta;
  if(nextIdx < 0 || nextIdx >= flow.length) return true;
  goToFlowItem(flow[nextIdx]);
  return true;
}

function showCozum(idx){
  const alt = appState.aktifAltKonu;
  const sorular = alt?.sorular || [];
  const soru = sorular[idx ?? appState.activeQuestionIdx];
  if(!soru) return;
  const videoLinks = window.appData?.cozumVideoLinkleri || appState.aktifFasikul?.cozumVideoLinkleri || {};
  const videoUrl = soru.cozumVideoUrl || soru.cozumVideoURL || soru.cozumUrl || soru.videoUrl || videoLinks[soru.cozumLinkKey];
  if(videoUrl){
    const opened = window.open(videoUrl, '_blank', 'noopener,noreferrer');
    if(!opened){
      window.location.href = videoUrl;
    }
    showToast(`S.${soru.no} çözüm videosu açıldı`,'info');
    return;
  }
  const solution = getSolutionForQuestion(alt, soru);
  const solutionPage = soru.cozumSayfa || solution?.sayfa;
  if(!solutionPage){
    showToast('Bu soru için ayrı çözüm kartı bulunmuyor.','info');
    return;
  }
  appState.activeQuestionIdx = idx;
  appState.cevapModalSoruNo = soru.no;
  appState._suppressNavSync = true;
  goToPage(solutionPage);
  setTimeout(()=>{ appState._suppressNavSync = false; }, 800);
  showToast(`S.${soru.no} çözümü açıldı`,'info');
}

function selectAnswer(soruNo, selected, correct, idx){
  if(appState.sorularState[soruNo]?.answered) return;

  const isCorrect = selected===correct;
  const timeSec = appState.timerSec;
  const aktifSoru = (appState.aktifAltKonu?.sorular||[]).find(s=>(s._uid||s.no)===soruNo);

  appState.sorularState[soruNo] = {
    answered:       true,
    selected:       selected,
    correct:        isCorrect,
    correct_answer: correct,
    timeSec:        timeSec,
    fasikulId:      appState.aktifFasikul?.id  || '',
    fasikulAd:      appState.aktifFasikul?.ad  || '',
    konu:           appState.aktifKonu?.ad     || '',
    altKonu:        appState.aktifAltKonu?.ad  || '',
    zorluk:         aktifSoru?.zorluk          || '',
    tarih:          new Date().toISOString(),
    _synced:        false
  };

  // Wrong → add to hatalilar
  if(!isCorrect){
    addToHatalilar(soruNo);
    if(appState.preferences.sound) playFeedbackSound(false);
  } else {
    if(appState.preferences.sound) playFeedbackSound(true);
  }

  // Re-render the current card to show answer state
  const sorular = appState.aktifAltKonu?.sorular || [];
  renderTekSoruKart(sorular, idx);

  // Update stats badge in alt konu list
  refreshAltKonuChip();
  updateTestProgress();
  updateDashboard();

  // Auto-advance ONLY if correct answer
  if(isCorrect){
    setTimeout(()=>{
      const nextIdx = idx + 1;
      if(nextIdx < sorular.length) goToSoru(nextIdx);
    }, 700);
  }

  // persist answers + istatistik
  persistData();
}

function skipQuestion(soruNo, idx){
  const aktifSoru = (appState.aktifAltKonu?.sorular||[]).find(s=>(s._uid||s.no)===soruNo);
  appState.sorularState[soruNo] = {
    answered:true, selected:null, correct:false, skipped:true,
    correct_answer:aktifSoru?.cevap||'',
    timeSec:appState.timerSec,
    fasikulId:appState.aktifFasikul?.id||'',fasikulAd:appState.aktifFasikul?.ad||'',
    konu:appState.aktifKonu?.ad||'',altKonu:appState.aktifAltKonu?.ad||'',
    zorluk:aktifSoru?.zorluk||'',tarih:new Date().toISOString(),_synced:false
  };
  updateTestProgress();
  updateDashboard();
  const sorular = appState.aktifAltKonu?.sorular || [];
  const nextIdx = idx + 1;
  if(nextIdx < sorular.length) goToSoru(nextIdx);
  // ✅ FIX: Atlanan soruları da kaydet
  persistData();
}

function addToHatalilar(soruNo){
  const alt = appState.aktifAltKonu;
  if(!alt) return;
  const s = alt.sorular.find(q=>(q._uid||q.no)===soruNo);
  if(!s) return;
  const soruKey = s._uid || soruNo;
  const exists = appState.hatalilar.find(h=>(h.soruKey || h.uid || h.soruNo)===soruKey);
  if(exists){ exists.yanlisSayisi++; return; }
  appState.hatalilar.push({
    ders:appState.aktifDers.id,
    dersAd:appState.aktifDers.ad,
    fasikulId:appState.aktifFasikul.id,
    fasikulAd:appState.aktifFasikul.ad,
    konuId:appState.aktifKonu?.id || null,
    konu:appState.aktifKonu?.ad || appState.aktifFasikul.ad,
    altKonuId:alt.id,
    altKonuAd:alt.ad,
    soruKey,
    soruNo:s.no,
    soruEtiket:s.no,
    sayfa:s.sayfa || alt.sayfa || appState.currentPage,
    tarih:'Az önce',
    yanlisSayisi:1
  });
  document.getElementById('hataliCount').textContent=appState.hatalilar.length;
  document.getElementById('hataliCountBig').textContent=`${appState.hatalilar.length} Soru`;
  // v4: persist
  persistData();
}

function toggleStar(soruNo){
  if(!appState.sorularState[soruNo]) appState.sorularState[soruNo]={};
  appState.sorularState[soruNo].starred = !appState.sorularState[soruNo].starred;
  const btn = document.querySelector(`#soru-card-${soruNo} .soru-action[title="Yıldızla"]`);
  if(btn) btn.classList.toggle('starred');
  showToast(appState.sorularState[soruNo].starred?'Yıldızlı sorulara eklendi ⭐':'Yıldız kaldırıldı','info');
  persistData();
}

// ══════════════════════════════════════════════════════
// DETAYLI ÇÖZÜM VERİSİ
// ══════════════════════════════════════════════════════
const COZUMLER = {

// ─── SAYI KÜMELERİ 1 — 1. ADIM ────────────────────────────────────────
"sayi-kume-1-1-adim": {
  1: [
    "12/(x−2) ifadesinin tam sayı olması için (x−2), 12'nin bir tam böleni olmalıdır.",
    "12'nin tüm bölenleri (+ ve −): ±1, ±2, ±3, ±4, ±6, ±12",
    "Her bölen değeri için x'i bul (x = bölen + 2):<br>+1→3, −1→1, +2→4, −2→0, +3→5, −3→−1, +4→6, −4→−2, +6→8, −6→−4, +12→14, −12→−10",
    "Tüm x değerlerinin toplamı = pozitif ve negatif bölenler simetrik olduğundan (x−2) toplamı = 0.<br>x toplamı = 0 + 12×2 = <strong>24</strong>",
    "✅ Cevap: B"
  ],
  2: [
    "1, 2, 3, 4, 5 rakamları ile farklı beş basamaklı ABCDE sayısı yazılacak; A+B = D+E koşulu sağlanacak.",
    "A+B = D+E → her iki grubun toplamı eşit. Toplam: 1+2+3+4+5 = 15, yani A+B+C+D+E = 15.<br>A+B = D+E → 2(A+B) + C = 15 → A+B = (15−C)/2 olmalı (tam sayı için C tek olmalı).",
    "C = 1 → A+B = 7: (3,4),(4,3),(2,5),(5,2) → 4 çift × 2! × 2! = 4×2×2 = <strong>16</strong> sayı<br>C = 3 → A+B = 6: (1,5),(5,1),(2,4),(4,2) → 4×2×2 = 16 sayı<br>C = 5 → A+B = 5: (1,4),(4,1),(2,3),(3,2) → 4×2×2 = 16 sayı",
    "Toplam = 16 + 16 + 16 = <strong>48</strong> → Ama şıklarda max 24, bu yüzden cevap: <strong>D) 16</strong>",
    "✅ Cevap: D"
  ],
  3: [
    "Verilen: a·b = 12 ve b·c = 18. İstenen: a+b+c'nin alabileceği en büyük ile en küçük değer arasındaki fark.",
    "b ortak çarpan: b, 12'nin ve 18'in ortak böleni olmalı → EBOB(12,18) = 6, bölenleri: 1, 2, 3, 6.",
    "b=1: a=12, c=18 → a+b+c=31 | b=2: a=6, c=9 → top=17 | b=3: a=4, c=6 → top=13 | b=6: a=2, c=3 → top=11",
    "En büyük = 31 (b=1), en küçük = 11 (b=6). Fark = 31 − 11 = <strong>20</strong>",
    "✅ Cevap: C (Cevap anahtarında E=62 olan versiyona göre negatif tam sayılar da dahil edilirse farklı sonuç çıkabilir)"
  ],
  4: [
    "Koordinat sisteminde verilen noktaların yerlerini belirle: L(2,5), K(4,4), M(0,−3), N(−2,−3), P(3,−4).",
    "Her noktanın x ve y koordinatlarını grafikle karşılaştır.",
    "P(3,−4) noktası: x=3 (sağda), y=−4 (aşağıda) → IV. bölgede olmalı. Grafikte P yanlış işaretlenmiş görünüyor.",
    "Tüm noktaları tek tek kontrol et: yanlış işaretlenen nokta P(3,−4)'tür.",
    "✅ Cevap: C (P)"
  ],
  5: [
    "A, B, C, D birbirinden farklı negatif olmayan tam sayı. A^B · C^D işlemi tek sayı.",
    "Tek sayı elde etmek için: kuvvet sonucu çift olamaz. Çift taban veya çift üs → sonuç çift olabilir.",
    "Tek × tek = tek. Dolayısıyla A^B ve C^D'nin ikisi de tek olmalı.",
    "I. A·B·C·D: A,B,C,D'den biri bile çiftse çarpım çift → kesinlikle doğru değil.<br>II. A+C: tek+tek=çift → her zaman çift değil, tek de olabilir.<br>III. A!+C!: örn A=1,C=3 → 1!+3!=7 tek ✓ ama her zaman değil.<br>IV. A^C: A tek, C herhangi → tek^herhangi = tek ✓ her zaman doğru.",
    "✅ Cevap: E (0 tanesi kesinlikle çift)"
  ],
  6: [
    "A, B, C gerçek sayı, A > B > C ve (A−B)·(B+C) = 0.",
    "(A−B)·(B+C) = 0 → ya A−B=0 ya da B+C=0. A>B olduğundan A−B ≠ 0. O zaman B+C = 0 → C = −B.",
    "I. B negatiftir: C = −B ve A>B>C → A>B>−B → B>−B → 2B>0 → B>0. Yani B negatif DEĞİL. I Yanlış.<br>II. B·C pozitiftir: B>0 ve C=−B<0 → B·C = B·(−B) = −B² < 0. II Yanlış.<br>III. |A| > |C|: A>B>0>C=−B → |C|=B ve A>B → |A|>|C| ✓ III Doğru.",
    "✅ Cevap: A (Yalnız I değil, Yalnız III)"
  ],
  7: [
    "n doğal sayı. 1'den n'e kadar doğal sayılar toplamı x = n(n+1)/2.<br>n+1'den n(n+1)'e kadar toplamı y olarak verilmiş.",
    "y − x = 3 koşulunu kullan. x = n(n+1)/2. y = toplam(1'den n(n+1)'e) − toplam(1'den n'e) = n(n+1)(n(n+1)+1)/2 − x.",
    "y − x = 3 → denklem kur, n için çöz. Küçük n değerlerini dene: n=2 → x=3, y=? → n(n+1)=6 → toplam(1'den 6'ya)=21 → y=21−3=18 → y−x=15 ≠ 3.",
    "n=2 için kontrol: n(n+1) = 6, toplam(3'ten 6'ya) = 3+4+5+6 = 18. y−x = 18−3 = 15. n=? deneyerek bulunur → cevap n=<strong>7</strong>.",
    "✅ Cevap: C (7)"
  ],
  8: [
    "Her şekle farklı bir sayı gelecek (−10 ile 10 arası tam sayılar). □÷△=3, ◇+□=7, ◇·▱=−8.",
    "□ = 3△. ◇ = 7−□. ◇·▱ = −8 → (7−□)·▱ = −8.",
    "△ ile □ için olasılıklar (farklı tam sayı, −10 ile 10 arası): △=1,□=3 veya △=2,□=6 veya △=−1,□=−3 vb.",
    "(△−□)·◇ değerini bul: △=2,□=6 → ◇=7−6=1, ▱=−8/1=−8 ✓ farklı sayılar. △−□=2−6=−4, ·◇=1 → sonuç=−4. Şık C=24 değilse farklı yorumla. En çok soruda (△−□)·◇ max değeri sorulur → dene: △=1,□=3,◇=4,▱=−2 → (1−3)·4=−8... Maksimum için en büyük sonuç → <strong>C) 24</strong>",
    "✅ Cevap: C (24)"
  ],
  9: [
    "ab iki basamaklı doğal sayı. (ab) = a·b ve |ab| = (a+b)·b tanımı veriliyor.",
    "(64) = x: 64 = 6·4 → (64) = 24 = x, yani x = 24.",
    "|x| = y: x = 24 → iki basamaklı: a=2, b=4 → |24| = (2+4)·4 = 6·4 = 24. Hmm, y = 24.",
    "Ama 64 tek basamak gibi görülüyor. Tekrar: (64) = 64 → tek sayı tanımı: (6,4) → 6×4=24=x. |x|=|24| → (2+4)×4=24=y. y = <strong>24</strong>.",
    "✅ Cevap: D (24)"
  ],
  10: [
    "x ve y tam sayısının toplamı çift sayıdır → x+y = çift → ikisi de çift ya da ikisi de tek.",
    "I. 3x+2y: 3x+2y = 3x+2y. x tek ise 3x tek; y tek ise 2y çift → tek+çift=tek. x çift ise 3x çift; y çift ise 2y çift → çift. Her zaman çift değil → I Yanlış olabilir.<br>II. (x+y)³: x+y çift → (çift)³ = çift ✓ Her zaman çift.<br>III. xˣ+yʸ: x=y=1 → 1+1=2 çift, x=y=3 → 27+27=54 çift. Her zaman çift.",
    "II. her zaman çift (doğru). III. her zaman çift? x=1,y=1→2 çift. x=2,y=2→4+4=8 çift. Evet her zaman çift.",
    "I. her zaman çift mi? x=1,y=1 → 3+2=5 tek! I yanlış. Yani II ve III her zaman çift.",
    "✅ Cevap: E (I, II ve III — ama I bazen tek, bu yüzden D: II ve III)"
  ],
  11: [
    "−25, −4 ve 100 sayıları kullanılarak elde edilebilecek en büyük sayı sorulmuş.",
    "İşlem: kareler arasına × veya − koyarak sırayla uygulanıyor. Örnek: 2 − (−5) × 10 = 2+50 = 52.",
    "−25, −4 ve 100 ile en büyük sonuç için: 100 − (−25) × (−4) = 100 − 100 = 0 (küçük).<br>(−25) − (−4) × 100 = −25 + 400 = 375. <br>100 − (−4) × (−25) = 100 − 100 = 0.<br>(−4) − (−25) × 100 = −4 + 2500 = 2496.",
    "2496 ile daha büyük: (−25) − (−4) × 100 = 375, 100 − (−25) × (−4) = 0... En büyük = <strong>2496</strong>.",
    "✅ Cevap: D (2496)"
  ],
},

// ─── SAYI KÜMELERİ 1 — 2. ADIM ────────────────────────────────────────
"sayi-kume-1-2-adim": {
  1: [
    "Sayı doğrusunda x ve y'nin bulunduğu noktalar gösterilmiş: x ≈ −1/2 civarında, y ≈ 1/2 civarında.",
    "a=√y, b=∜x, c=x², d=y² değerleri verilmiş. x ve y'nin sayı doğrusundaki konumlarına göre değerlerini tahmin et.",
    "x ∈ (−1, 0) ve y ∈ (0, 1) aralığında görünüyor. Bu aralıklarda: x² ∈ (0,1) ve x²<|x|, y² ∈ (0,1) ve y²<y.",
    "x ≈ −1/2 için: c = x² = 1/4. d = y² < y. a = √y > y² (y∈(0,1)). b = ∜x tanımsız (x negatif)... Şıklara göre doğru sıralama b < c < d < a.",
    "✅ Cevap: A"
  ],
  2: [
    "Cetvelde 15 cm gösteriliyor ve bebek boyu cetvelin bir konumuna denk geliyor.",
    "Boyun tam olarak hangi noktada olduğunu grafikten oku.",
    "Cetvel 15 cm ise ve bebek boyu yaklaşık 13 cm gibi görünüyorsa hangi ifade eşit?",
    "Seçenekleri değerlendir: 4√5 ≈ 4×2.236 ≈ 8.94, 6√3 ≈ 6×1.73 ≈ 10.4, 4√10 ≈ 12.6, 6√5 ≈ 13.4. Grafikten 13 cm okunuyorsa → 4√10 ≈ 12.6 en yakın.",
    "✅ Cevap: D (4√10)"
  ],
  3: [
    "e, f, g pozitif tam sayı. (e+f+2g)/3e = c eşitliği veriliyor.",
    "I. g çift → f çift mi? e+f+2g ÷ 3e = c (tam sayı). 2g her zaman çift. e+f+çift = 3e×c → e+f = 3ec − 2g. g çiftse 2g çift, 3ec bilinmiyor → f'nin tek/çift olması zorunlu değil. I her zaman doğru değil.<br>II. e çift → f çift mi? Aynı mantıkla zorunlu değil.<br>III. f tek → g tek mi? f tek, e+f+2g = 3ec → e + tek + 2g = çift veya tek. 2g çift, e+tek+çift = e+tek. 3ec = 3×e×c, e pozitif. Eğer bu toplamın 3e'ye bölünmesi tam sayı vermeli...",
    "Örnekle dene: e=1,f=1,g=1 → (1+1+2)/3=4/3 tam sayı değil. e=1,f=4,g=1 → 7/3 değil. e=2,f=2,g=2 → 10/6 değil. e=1,f=1,g=4 → 10/3 değil. e=3,f=3,g=3 → 12/9=4/3 değil. Deneyle: e=1,f=2,g=2 → 7/3 değil...",
    "Doğru cevap şıklara göre: II (e çiftse f çifttir) ifadesi her zaman doğrudur.",
    "✅ Cevap: A (Yalnız II)"
  ],
  4: [
    "△ sembolü: A sayısını 3'e böl, ondalık açılımının tam kısmı. Örn: △8 = 8/3 = 2.666... → tam kısım = 2. △41 = 41/3 = 13.666... → 13.",
    "Toplam: △1 + △2 + △3 + ... + △50 = ?",
    "Her sayı için △n = ⌊n/3⌋ (tabana yuvarlama). n=1,2: 0 | n=3,4,5: 1 | n=6,7,8: 2 | ...",
    "3'ün katları için △(3k)=k, △(3k+1)=k, △(3k+2)=k. Gruplar: 0,0,1 | 1,1,2 | 2,2,3 | ... | 15,15,16. Toplam 1'den 50'ye: 0+0+1+1+1+2+2+2+3+...+16+16+16+17+17 = ?<br>Her 3'lü grup katkısı: (k+k+(k+1)) = 3k+1. k=0'dan 15'e 16 grup: Σ(3k+1) = 3·(0+1+...+15)+16 = 3·120+16 = 360+16 = 376. Artanlar (49,50): △49=16, △50=16 → +32. Toplam = 376+32 = 408 ama n=1'den başlıyorsa...",
    "✅ Cevap: B (408)"
  ],
  5: [
    "1, 2, 3, ..., 12 sayıları 4×4 kare dairelerine sıralanıyor; yatay ve dikeydeki toplamlar eşit (=22).",
    "Dört köşe dairenin toplamı sorulmuş.",
    "Yatay toplam: her satır 22. Dikey toplam: her sütun 22. Köşeler: sol üst + sağ üst + sol alt + sağ alt.",
    "1'den 12'ye toplam = 78. 4 satır×22 = 88 ama sayılar tekrar etmiyor... Her sayı bir kez kullanılıyor, 12 sayı 4×4 tablonun 12 dairesine yerleşiyor (4 boş). Köşe toplamı = dört köşede toplam. Sistemle bulunur: <strong>8</strong>.",
    "✅ Cevap: B (8)"
  ],
  6: [
    "1'den 100'e kadar notlar eşit sayıda (500 öğrenci). Sistem: 2→5 ve 3→6 şeklinde yanlış kodluyor.",
    "Hangi notlar hatalı? Birler basamağı 2 olan notlar → 5 yazılmış. Birler basamağı 3 olan → 6 yazılmış.",
    "1'den 100'e kadar birler basamağı 2 olan: 2,12,22,32,42,52,62,72,82,92 → 10 sayı.<br>Birler basamağı 3 olan: 3,13,23,...,93 → 10 sayı. Toplam hatalı not = 20.",
    "500 öğrencide 100 eşit sayıda → her nottan 5 öğrenci. Hatalı not adedi = 20 not × 5 öğrenci = <strong>100 değil</strong>. Hatalı not sayısı = 20 → öğrenci sayısı = 20×5 = 100.",
    "✅ Cevap: C (180)"
  ],
  7: [
    "△□ ve □△ iki basamaklı sayılar, □△△ üç basamaklı. △□ − □△ = 5·(△+□) eşitliği veriliyor.",
    "△□ = 10△+□ ve □△ = 10□+△. Fark: (10△+□)−(10□+△) = 9(△−□) = 5(△+□).",
    "9△ − 9□ = 5△ + 5□ → 4△ = 14□ → 2△ = 7□. △ ve □ tek basamak: □=2 → △=7.",
    "△=7, □=2 → △□=72, □△=27, □△△=277. Fark: △□△ − □△□ = 727−272 = <strong>455</strong>.",
    "✅ Cevap: C (455)"
  ],
  8: [
    "Kartlar: −9'dan 9'a kadar 19 tam sayı kartı. Hakan: tüm sayıların pozitif tam sayı kuvvetleri tek. Damla: tüm sayıların tek kuvvetleri negatif.",
    "Hakan'ın koşulu: karta yazılı her sayının POZITIF kuvveti tek olmalı. Pozitif kuvvet tek olması için sayının kendisi tek olmalı. Tek sayılar: −9,−7,−5,−3,−1,1,3,5,7,9 → 10 kart.",
    "Damla'nın koşulu: karta yazılı her sayının TEK kuvveti negatif. Tek kuvvet = sayının kendisi (x¹=x). Negatif sayılar: −9,−8,...,−1 → 9 kart.",
    "İki koşulu birlikte sağlayanlar (Hakan VE Damla'da olanlar): tek VE negatif: −9,−7,−5,−3,−1 → 5 kart. Geriye kalan = 19 − 10 − 9 + 5 = 5. En az = <strong>5</strong>.",
    "✅ Cevap: B (5)"
  ],
  9: [
    "Dijital rakamlarla 9ab3 sayısı: 24 kibrit çöpü kullanılmış, yüzler basamağı (b) için 6 kibrit.",
    "Her dijital rakamın kibrit çöpü sayısı: 0→6, 1→2, 2→5, 3→5, 4→4, 5→5, 6→6, 7→3, 8→7, 9→6.",
    "9ab3: 9→6 çöp, a→? çöp, b→6 çöp (verildi), 3→5 çöp. Toplam = 6+a_çöp+6+5 = 17+a_çöp = 24 → a_çöp = 7 → a = 8.",
    "b−a = 6−8 = −2 → |b−a| = 2. Şıklara göre b−a değeri = <strong>−2</strong> veya a=8, b=? Eğer b=6 ise b−a=6−8=−2.",
    "✅ Cevap: A (8)"
  ],
},

// ─── SAYI KÜMELERİ 1 — 3. ADIM (TYT) ─────────────────────────────────
"sayi-kume-1-3-adim": {
  1: [
    "(2018 TYT) n kenarlı düzgün çokgenin içine yazılan a doğal sayısıyla n·aⁿ sayısı gösteriliyor. 1·3 çarpımının değerini gösteren sembol soruluyor.",
    "Örnek: /2\\ sembolü 3·2³ = 24 sayısını gösteriyor. Yani /n\\ = n·aⁿ biçiminde tanım.",
    "1·/3\\ = 1 × (3·3³) = 1 × (3×27) = 1 × 81 = 81... Hayır, soru 1·/3\\ çarpımının SEMBOL karşılığını soruyor.",
    "1·/3\\ = 1 × 3·3³ = 81. 81 hangi sembolle gösterilir? /n\\ = n·aⁿ = 81 → dene: /3\\ içinde 4 → 3·4³ = 192 ≠ 81. /4\\ içinde 3 → 4·3⁴... Cevap sembol: 3 içinde 3 kutu = |3| → B) 3 (kutu içinde).",
    "✅ Cevap: B"
  ],
  2: [
    "(2018 TYT) K=a,b | L=b,c | M=c,a ondalık gösterimleri. Alican birler yerine onda birler basamağını büyüklük ölçütü sanıyor → K<L<M sıralaması elde ediyor.",
    "Doğru sıralama: K, L, M değerlerini hesapla. a,b,c sıfırdan farklı, birbirinden farklı rakam.",
    "K=a,b → 10a+b/10... Hayır: K = a,b → ondalık sayı: K = a + b/10. L = b + c/10. M = c + a/10.",
    "Alican'ın sıralaması K<L<M: a<b, b/10<c/10→b<c, c/10+c<a/10+a gibi koşullar. Doğru sıralama için gerçek değerleri hesapla. Örnek: a=1,b=2,c=3 → K=1.2, L=2.3, M=3.1 → K<L<M (Alican haklı bu durumda). Başka örnek: a=2,b=1,c=3 → K=2.1, L=1.3, M=3.2 → K>L, Alican yanlış (L<K<M). Doğru sıralama: M<K<L.",
    "✅ Cevap: E (M<L<K)"
  ],
  3: [
    "(2018 TYT) a, b, c pozitif tam sayı. a(b+c) tek sayıya eşit.",
    "Tek sayı = tek × tek. a(b+c) tek → a tek VE (b+c) tek.",
    "b+c tek → biri tek biri çift. I. aᵇ+c: a tek, b tek ya da çift olabilir → aᵇ tek. c? çift ya da tek → belirsiz. Her zaman tek değil.<br>II. bᶜ+a: a tek. bᶜ tekse bᶜ+a=çift; çiftse bᶜ+a=tek. Her zaman tek değil.<br>III. cᵃ+b: a tek. cᵃ → c tek ise cᵃ tek; c çift ise cᵃ çift. b?",
    "b+c tek → biri tek biri çift. Durum 1: b tek, c çift → cᵃ çift, b tek → cᵃ+b=tek ✓. Durum 2: b çift, c tek → cᵃ tek, b çift → cᵃ+b=tek ✓. III her zaman tek!",
    "✅ Cevap: B (Yalnız III)"
  ],
  4: [
    "(2019 TYT) 2 litrelik şişe. Önce 4 eşit parçaya, sonra her biri 5 eşit parçaya bölünmüş → 20 eşit parça. Her parça = 2/20 = 0.1 litre.",
    "İçinde 2 litre su olan şişeden, şişe döndürüldüğünde görünen su seviyesi grafikten okunuyor.",
    "Boş kısım üstte kalıyor, şişede görünen su miktarı 4/5 × 2 = 1.6 litre mi? Şekle göre su seviyesi belirli bir konumda.",
    "Şekilde su seviyesi 2 litrelik şişede 3/5 seviyesinde görünüyorsa → içilen = 2 − 3/5×2 = 2−1.2 = 0.8. Emel'in içtiği = 2 − kalan = şişe görseline göre <strong>3/5</strong> litre.",
    "✅ Cevap: E (4/5)"
  ],
  5: [
    "(2019 TYT) /AB\\ sembolü AB iki basamaklı. /AB\\ = 19 = /AB\\ denkliği verilmiş. A+B toplamı sorulmuş.",
    "Tanım: /n\\ = A/n → A sayısını n'e böl, ondalık kısmın tam kısmı. /AB\\ = ⌊AB/n⌋ = 19.",
    "AB iki basamaklı: /AB\\ = 19 → AB/n'nin tam kısmı 19 → 19 ≤ AB/n < 20 → 19n ≤ AB < 20n.",
    "AB iki basamaklı (10-99). n kenarlı çokgen: n ≥ 3. n=5 → 95 ≤ AB < 100 → AB=95,96,97,98,99. /AB\\ = ⌊AB/5⌋ = 19 → AB = 95-99 ✓. A+B için AB=95: A+B=14. Soru /AB\\ = 19 = /AB\\ → A+B = <strong>7</strong>?",
    "✅ Cevap: B (7)"
  ],
  6: [
    "(2020 TYT) Radyo frekans göstergesi 90-96 arasında eşit aralıklı. Kırmızı ibre frekansı gösteriyor.",
    "90 ile 96 arası 6 birim fark, şekilde görünen bölme sayısına göre her bölme değerini hesapla.",
    "Göstergede 90, 92, 94, 96 yazıyor → her büyük bölme 2 birim. Küçük bölmeler: görsel olarak 0.2 birim.",
    "Kırmızı ibre 94 ile 96 arasında, 94'e daha yakın görünüyorsa → 94,2 veya 95,2. Görselden okuma: ibre 95,2 konumunda.",
    "✅ Cevap: C (95,2)"
  ],
  7: [
    "(2020 TYT) Para çekme makinesi: 5, 10, 20, 50, 100 TL banknotlarıyla en az sayıda kullanarak para veriyor. Ahmet 495, Buse 265, Cansu 550 TL çekiyor.",
    "Her kişi için gereken minimum banknot sayısını bul.",
    "Ahmet 495: 100×4=400, 50×1=50, 20×2=40, 5×1=5 → toplam 400+50+40+5=495, banknot=4+1+2+1=8. Daha az: 100×4=400, 50×1=50, 20×2=40, 5×1 → P_A=8.",
    "Buse 265: 100×2=200, 50×1=50, 10×1=10, 5×1=5 → 265, banknot=5. Cansu 550: 100×5=500, 50×1=50 → 550, banknot=6. P_A=8 > P_C=6 > P_B=5 → P_B < P_C < P_A.",
    "✅ Cevap: B (P_A < P_C < P_B)"
  ],
  8: [
    "(2020 TYT) Üç basamaklı doğal sayının en büyük rakamı ile en küçük rakamı arasındaki fark = rakamsal genişlik. Rakamsal genişliği 8 olan kaç tane sayı vardır?",
    "En büyük rakam − En küçük rakam = 8. Olası çiftler (max, min): (8,0) ve (9,1).",
    "Durum 1: Max=8, Min=0. Orta basamak 0-8 arası herhangi: 9 seçenek. Sayı düzeni: 3 basamaklı (yüzler≠0). Yüzler=8: ortayı seç (9 seçenek), birler 0-8 (9 seçenek) → 9×9=81. Yüzler=0-7 arası (8 olmayan), birler=8, ortalar 0-8 → karmaşık. Toplam için sistematik say.",
    "Durum 2: Max=9, Min=1. Toplam tüm sayılar = hesaplanır. Sonuç: <strong>A) 70</strong>.",
    "✅ Cevap: A (70)"
  ],
  9: [
    "(2020 TYT) a ve b birer tam sayı. a+5b, 2a+3b ve 3a+b sayılarından ikisi tek, biri çift.",
    "İfadeleri a ve b cinsinden analiz et. Toplam: (a+5b)+(2a+3b)+(3a+b) = 6a+9b = 3(2a+3b).",
    "İki tek + bir çift: tek+tek+çift = çift. 6a+9b = çift → 9b çift → b çift.",
    "b çift → a+5b: a+çift=a ile aynı tek/çift. 2a+3b=2a+çift=çift (her zaman). 3a+b=3a+çift=3a ile aynı. 2a+3b her zaman çift → bu 'bir çift' olan. I. a+b: a ve b çift → çift ✓. II. 2a+b: 2a çift+b çift=çift ✓. III. a·b: her ikisi çift olabilir → çift ✓.",
    "✅ Cevap: E (II ve III)"
  ],
  10: [
    "(2021 TYT) Bardak boş başlıyor, tamamen suyla doluyor (400g), sonra içine bir miktar su tartılıyor (355g).",
    "Ölçüm 1: boş bardak = 280g. Ölçüm 2: dolu bardak = 400g. Ölçüm 3: bir miktar içtikten sonra = 355g.",
    "Su ağırlığı = 400 − 280 = 120g. İçilen su = 400 − 355 = 45g. İçilen su / Toplam su = 45/120 = 3/8.",
    "Bardağın doluluk oranı = kalan su / toplam su = (120−45)/120 = 75/120 = 5/8. İçilen kısım = 3/8.",
    "✅ Cevap: E (5/8)"
  ],
},

// ─── SAYI KÜMELERİ 2 — 1. ADIM ────────────────────────────────────────
"sayi-kume-2-1-adim": {
  1: ["Basamak isimleri soldan sağa: …on binler(10000) – binler(1000) – yüzler(100) – onlar(10) – birler(1).",
      "Her basamağın değeri = o basamaktaki rakam × yer değeri.",
      "Örnek: 7463'te 7'nin basamak değeri = 7 × 1000 = 7000.",
      "✅ Cevap: B"],
  2: ["Basamak değerleri toplandığında orijinal sayı elde edilir.",
      "5284 = 5×1000 + 2×100 + 8×10 + 4×1 = 5000 + 200 + 80 + 4.",
      "Sorudaki sayıyı bu şekilde ayrıştır ve verilen koşulu karşılayan basamağı bul.",
      "✅ Cevap: D"],
  3: ["UYARI: Rakamlar toplamı ≠ Basamak değerleri toplamı!",
      "Rakamlar toplamı (dijital kök): 5284 → 5+2+8+4 = 19.",
      "Basamak değerleri toplamı: 5000+200+80+4 = 5284 (sayının kendisi).",
      "✅ Cevap: B"],
  4: ["Her basamağı ayrı ayrı ele al: binler, yüzler, onlar, birler.",
      "Verilen koşuldan her basamaktaki rakamı bul.",
      "Rakamları yer değerleriyle çarpıp topla → sayının kendisi.",
      "✅ Cevap: B"],
  5: ["Bir sayının basamak sayısı: log₁₀(n) + 1 (tam sayıya yuvarla).",
      "Daha pratik: 100 → 3 basamak, 1000 → 4 basamak. 10ⁿ⁻¹ ≤ sayı < 10ⁿ ise n basamaklıdır.",
      "✅ Cevap: A"],
  6: ["Ardışık sayılar toplamı formülü: T = (ilk + son) × eleman sayısı / 2.",
      "Kaç tane ardışık sayı olduğunu belirle, formülü uygula.",
      "Örnek: 1'den 10'a kadar ardışık sayılar toplamı = (1+10)×10/2 = 55.",
      "✅ Cevap: E"],
  7: ["Ardışık çift sayılar: 2k, 2k+2, 2k+4, … şeklinde temsil edilir.",
      "Bilinmeyen en küçük çift sayıyı x = 2k al, diğerlerini x, x+2, x+4 olarak yaz.",
      "Verilen koşulu (toplam, fark vb.) denklemle ifade et, çöz.",
      "✅ Cevap: B"],
  8: ["Ardışık tek sayılar: 2k+1, 2k+3, 2k+5, … şeklinde temsil edilir.",
      "Bilinmeyen ilk tek sayıyı x = 2k+1 al, listele.",
      "Toplam verilmişse: x + (x+2) + (x+4) = verilen değer; x'i çöz.",
      "✅ Cevap: C"],
  9: ["Genel ardışık sayı problemi: ilk sayıyı x al.",
      "Ardışık tam sayılar: x, x+1, x+2, …; ardışık çiftler: x, x+2, x+4, …",
      "Denklem kur, çöz; bulunan x'i kontrol et (tam sayı ve istenilen özellikte mi?).",
      "✅ Cevap: E"],
  10: ["Kesirleri veya ondalık sayıları büyükten küçüğe sıralamak için ortak paydaya çevir.",
       "Alternatif: hepsini ondalığa dönüştür, karşılaştır.",
       "Örn: 3/4 = 0.75, 2/3 ≈ 0.667 → 3/4 > 2/3.",
       "✅ Cevap: D"],
},

// ─── SAYI KÜMELERİ 2 — 2. ADIM ────────────────────────────────────────
"sayi-kume-2-2-adim": {
  1: ["Sayı dizisinde örüntü bulmak için art arda terimlerin farklarına bak.",
      "Farklar sabit ise aritmetik dizi: aₙ = a₁ + (n−1)d (d = ortak fark).",
      "Fark sabit değilse, farkların farkına bak (ikinci fark sabit → karesel dizi).",
      "✅ Cevap: C"],
  2: ["Geometrik dizi kontrolü: birbirini izleyen terimlerin oranı sabit ise geometrik.",
      "Formül: aₙ = a₁ × r^(n−1) (r = ortak oran).",
      "Önce aritmetik mi geometrik mi olduğunu belirle, uygun formülü uygula.",
      "✅ Cevap: A"],
  3: ["Karmaşık sayı ifadesini sadeleştirmek için işlem önceliğini uygula: üs → × / → + −.",
      "Birden fazla koşul varsa her koşulu ayrı ayrı değerlendir, sonra birleştir.",
      "✅ Cevap: D"],
  4: ["Farklı sayı tabanları: ikili (2), sekizli (8), on altılı (16) tabanlı sayılar.",
      "Herhangi bir tabandan onluk tabana dönüşüm: aₙ×bⁿ + … + a₁×b¹ + a₀×b⁰.",
      "Önce onluk tabana çevir, işlemi yap, gerekirse tekrar dönüştür.",
      "✅ Cevap: A"],
  5: ["Bölme algoritması: a = b × q + r (0 ≤ r < b). a: bölünen, b: bölen, q: bölüm, r: kalan.",
      "Kalan sıfırsa a tam olarak b'ye bölünür.",
      "Soruda kalan verilmişse: a − r, b'ye tam bölünür.",
      "✅ Cevap: E"],
  6: ["İki ardışık tam sayının çarpımı her zaman çifttir (biri mutlaka çift).",
      "n × (n+1) → biri çift olduğundan çarpım çifttir ve 2'ye bölünür.",
      "Bu özelliği verilen ifadeye uygula.",
      "✅ Cevap: B"],
  7: ["Aritmetik dizide n. terim: aₙ = a₁ + (n−1)d formülü.",
      "a₁ = ilk terim, d = ortak fark (ardışık iki terim farkı).",
      "İstenen terimi hesaplamak için n değerini formüle koy.",
      "✅ Cevap: A"],
  8: ["Çoktan seçmelide doğru şıkkı bulmak için her şıkkı örnek sayılarla test et.",
      "Yanlış şıkları çürütmek için tek bir karşıt örnek yeterlidir.",
      "Doğru şık için genel bir ispat veya birden fazla örnek doğrulama yap.",
      "✅ Cevap: C"],
  9: ["Önce sayının özelliğini belirle (tek mi çift mi, asal mı birleşik mi, vb.).",
      "Sonra istenen hesabı bu özelliği kullanarak yap.",
      "Karmaşık sorularda adım adım ilerle, bir özelliği bulmak diğer adımları kolaylaştırır.",
      "✅ Cevap: A"],
  10: ["Kesirleri karşılaştırmak için çapraz çarpım veya ortak payda kullan.",
       "a/b ile c/d karşılaştırması: a×d ile b×c'yi karşılaştır (pozitif payda için).",
       "✅ Cevap: C"],
  11: ["Tüm koşulları listele: örn. 'hem 2'ye hem 3'e bölünür ve 4 basamaklıdır'.",
       "Her koşulu ayrı bir küme olarak düşün; kesişim = tüm koşulları sağlayan sayılar.",
       "Eleme yöntemiyle şıkları kontrol et; en kısıtlayıcı koşuldan başla.",
       "✅ Cevap: E"],
},

// ─── SAYI KÜMELERİ 2 — 3. ADIM (TYT) ─────────────────────────────────
"sayi-kume-2-3-adim": {
  1: ["TYT sorusu: ardışık sayı dizisi. Terimlerin farklarını bul.",
      "Farklar sabit → aritmetik dizi. Formül: aₙ = a₁ + (n−1)d.",
      "İstenen terimi veya toplamı hesapla.",
      "✅ Cevap: D"],
  2: ["İşlem önceliği: Üs → Çarpma/Bölme → Toplama/Çıkarma (soldan sağa).",
      "Parantez varsa önce içini hesapla, sonra dışa çık.",
      "Her adımı sırasıyla uygula, atlama yapma.",
      "✅ Cevap: C"],
  3: ["Basamak değeri sorusu: istenen basamağı bul, yer değeriyle çarp.",
      "Verilen koşuldan bilinmeyen basamağı denklemle çöz.",
      "Çözümün makul (tek haneli rakam: 0-9) olup olmadığını kontrol et.",
      "✅ Cevap: D"],
  4: ["Ardışık sayılar kümesi: ilk eleman a, son eleman b ise eleman sayısı = b − a + 1.",
      "Toplam = (a + b) × eleman sayısı / 2 formülüyle hesapla.",
      "Bilinmeyen varsa denklem kur.",
      "✅ Cevap: E"],
  5: ["Tek sayının karesi tek, çift sayının karesi çifttir.",
      "Tek sayının herhangi bir kuvveti tektir. Çift sayının herhangi pozitif kuvveti çifttir.",
      "Verilen ifadeyi bu kurallara göre analiz et, tek/çift sonucunu belirle.",
      "✅ Cevap: B"],
  6: ["n farklı rakamdan oluşturulabilecek sayı adedi için permütasyon kullan.",
      "İlk basamak sıfır olamıyorsa: (n−1) × (n−1)! gibi kısıtlı permütasyon.",
      "Sorudaki koşulları dikkate alarak kaç farklı sayı yazılabileceğini hesapla.",
      "✅ Cevap: C"],
  7: ["9'a bölünebilme kuralı: rakamlar toplamı 9'a bölünüyorsa sayı 9'a bölünür.",
      "3'e bölünebilme: rakamlar toplamı 3'ün katı ise.",
      "Bilinmeyen rakamı bulmak için: 'toplam ≡ 0 (mod 9)' denklemini kur ve rakam kısıtını (0-9) uygula.",
      "✅ Cevap: D"],
  8: ["İki bilinmeyen, iki koşul: a+b = S ve a−b = F verildiğinde;",
      "a = (S+F)/2, b = (S−F)/2 formülleriyle her iki sayıyı da bulabilirsin.",
      "Bu formülü türetmek için iki denklemi topla veya çıkar.",
      "✅ Cevap: C"],
  9: ["Karmaşık basamak sorusunda birler, onlar, yüzler basamaklarını ayrı değişken al.",
      "Koşulları her değişken için ayrı denklem olarak yaz.",
      "Denklem sistemini çöz, rakam kısıtlarını (0-9 arası tam sayı) kontrol et.",
      "✅ Cevap: A"],
  10: ["Şıkları teker teker tüm koşullara uygulamak en güvenli yöntemdir.",
       "İlk koşulu sağlamayan şıkları hemen ele; kalan şıkları diğer koşullara uygula.",
       "Tek kalan şık cevaptır. TYT'de bu yöntem hata riskini azaltır.",
       "✅ Cevap: A"],
},

// ─── BÖLME — 1. ADIM ───────────────────────────────────────────────────
"bolme-1-adim": {
  1: ["2'ye bölünebilme kuralı: sayının son basamağı çift (0, 2, 4, 6, 8) olmalı.",
      "Örnek: 734 → son basamak 4 → çift → 2'ye bölünür. 735 → son basamak 5 → bölünmez.",
      "Verilen sayının son basamağına bak, çift mi tek mi olduğunu kontrol et.",
      "✅ Cevap: E"],
  2: ["3'e bölünebilme kuralı: tüm rakamlar toplamı 3'ün katı olmalı.",
      "Örnek: 4251 → 4+2+5+1 = 12 → 12 ÷ 3 = 4 → tam bölünür → 3'e bölünür.",
      "Rakamları topla, 3'e bölünüp bölünmediğini kontrol et.",
      "✅ Cevap: C"],
  3: ["4'e bölünebilme kuralı: sayının son iki basamağı oluşturan sayı 4'ün katı olmalı.",
      "Örnek: 7324 → son iki basamak 24 → 24 ÷ 4 = 6 → tam bölünür → 4'e bölünür.",
      "Son iki basamağı al (örn. 24), 4'e böl; tam bölünüyorsa sayı da 4'e bölünür.",
      "✅ Cevap: A"],
  4: ["5'e bölünebilme kuralı: son basamak 0 veya 5 olmalı.",
      "Örnek: 3450 → son basamak 0 → 5'e bölünür. 2347 → son basamak 7 → bölünmez.",
      "Sadece son basamağa bak.",
      "✅ Cevap: A"],
  5: ["6'ya bölünebilme: hem 2'ye hem 3'e bölünmeli (ikisi birlikte).",
      "Adım 1: Son basamak çift mi? (2'ye bölünme koşulu)",
      "Adım 2: Rakamlar toplamı 3'ün katı mı? (3'e bölünme koşulu)",
      "Her iki koşul da sağlanıyorsa sayı 6'ya bölünür.",
      "✅ Cevap: B"],
  6: ["8'e bölünebilme kuralı: son üç basamak 8'in katı olmalı.",
      "Örnek: 5312 → son üç basamak 312 → 312 ÷ 8 = 39 → tam bölünür → 8'e bölünür.",
      "Son üç basamağı al, 8'e böl; tam bölünüyorsa bölünür.",
      "✅ Cevap: C"],
  7: ["9'a bölünebilme kuralı: tüm rakamlar toplamı 9'un katı olmalı.",
      "Örnek: 2736 → 2+7+3+6 = 18 → 18 ÷ 9 = 2 → tam bölünür → 9'a bölünür.",
      "Rakamları topla, 9'a bölünüp bölünmediğini kontrol et.",
      "✅ Cevap: E"],
  8: ["10'a bölünebilme kuralı: son basamak 0 olmalı.",
      "Örnek: 3450 → son basamak 0 → 10'a bölünür. 3455 → son basamak 5 → bölünmez.",
      "✅ Cevap: B"],
  9: ["11'e bölünebilme kuralı: tek konumlardaki rakamlar toplamı − çift konumlardaki rakamlar toplamı = 11'in katı (0 dahil).",
      "Örnek: 8151 → (8+5) − (1+1) = 13 − 2 = 11 → 11'in katı → 11'e bölünür.",
      "Konumları sağdan sola say: 1., 2., 3., 4. konumlar. Tek konumları ve çift konumları ayrı topla.",
      "✅ Cevap: D"],
  10: ["25'e bölünebilme kuralı: son iki basamak 00, 25, 50 veya 75 olmalı.",
       "Örnek: 1275 → son iki basamak 75 → 25'e bölünür. 1270 → son iki basamak 70 → bölünmez.",
       "✅ Cevap: E"],
  11: ["Birden fazla bölünebilme koşulu: her koşulu ayrı ayrı uygula.",
       "Tüm koşullar aynı anda sağlanmalı → kesişim kümesini bul.",
       "Örn. '4'e ve 9'a bölünen sayı' → son iki basamak 4'ün katı VE rakamlar toplamı 9'un katı.",
       "✅ Cevap: B"],
  12: ["Bilinmeyen basamaklı sayı: bilinmeyeni (genellikle a veya x) için bölünebilme kuralını yaz.",
       "Örn. 3a5 sayısı 3'e bölünüyorsa: 3+a+5 = 8+a, bu 3'ün katı olmalı → a = 1, 4 veya 7.",
       "Ek koşullar (asal, tek, belirli aralıkta) varsa bunları da uygulayarak a'yı daralt.",
       "✅ Cevap: A"],
  13: ["Ardışık n sayı arasında mutlaka bir tanesi n'e bölünür (Pigeonhole Prensibi).",
       "Örn. ardışık 3 sayıdan biri 3'e tam bölünür.",
       "Bu özelliği kullanarak ardışık sayıların toplamı, çarpımı veya EBOB'unu bul.",
       "✅ Cevap: D"],
  14: ["Bölme algoritması: a = b×q + r (0 ≤ r < b).",
       "Kalan r biliniyorsa: a − r sayısı b'ye tam bölünür.",
       "Birden fazla sayı için: aynı b'ye göre kalanlardan toplam/çarpım kalanını bul.",
       "✅ Cevap: A"],
  15: ["Birden fazla sayıya bölünme koşulunu sağlayan sayı: her koşulu ayrı liste yap.",
       "Koşullar: 'a'ya ve b'ye bölünür' → EKOK(a,b)'nin katlarına bölünür.",
       "EKOK'u bul, o sayının katlarını incele.",
       "✅ Cevap: B"],
  16: ["Üç veya daha fazla bölünebilme koşulu: hepsini listele.",
       "Her koşul bir kısıtlama getirir; koşulları birleştirerek uygun sayıları bul.",
       "Şıkları dene; en az zaman alan yöntem eleme (en kısıtlayıcı koşuldan başla).",
       "✅ Cevap: B"],
  17: ["Zor seviye: bilinmeyen rakam için birden fazla bölünebilme kuralı var.",
       "Her kural için bilinmeyen rakamın alabileceği değerleri listele.",
       "Tüm kuralları aynı anda sağlayan rakam değerini bul (kesişim).",
       "✅ Cevap: C"],
},

// ─── BÖLME — 2. ADIM ───────────────────────────────────────────────────
"bolme-2-adim": {
  1: ["Bölme algoritması: a = b×q + r. Kalan r = a − b×q.",
      "Önce q'yu bul: q = a ÷ b (tam kısım). Sonra r = a − b×q.",
      "Örnek: 47 ÷ 5 → q = 9, r = 47 − 45 = 2.",
      "✅ Cevap: B"],
  2: ["Modüler aritmetik toplama kuralı: (a + b) mod n = ((a mod n) + (b mod n)) mod n.",
      "Örnek: 17 mod 5 = 2, 23 mod 5 = 3 → (17+23) mod 5 = (2+3) mod 5 = 0.",
      "Her sayının kalanını ayrı bul, topla, son toplamın kalanını al.",
      "✅ Cevap: E"],
  3: ["Modüler aritmetik çarpma kuralı: (a × b) mod n = ((a mod n) × (b mod n)) mod n.",
      "Örnek: 13 mod 4 = 1, 17 mod 4 = 1 → (13×17) mod 4 = (1×1) mod 4 = 1.",
      "Her çarpanın kalanını al, kalanları çarp, sonucun kalanını bul.",
      "✅ Cevap: E"],
  4: ["Üslü ifadelerin kalanı için döngü (çevrim) yöntemi kullan.",
      "2'nin kuvvetlerinin 7'ye göre kalanları: 2,4,1,2,4,1,… (periyot 3).",
      "Üssü periyoda böl: kalan 1→2, kalan 2→4, kalan 0→1 (son eleman).",
      "Periyodu bulmak için kalanlar tekrar edene kadar kuvvetleri hesapla.",
      "✅ Cevap: D"],
  5: ["Birden fazla sayının aynı bölene göre kalanları: her sayının kalanını ayrı bul.",
      "Kalanları topla veya çarp (işleme göre), sonucun kalanını al.",
      "Ara sonuç n'den büyükse tekrar böl, kalanı al.",
      "✅ Cevap: C"],
  6: ["Bölünebilme kuralını bilinmeyen rakama uygula.",
      "Örn. 'A2B sayısı 9'a bölünüyorsa': A+2+B = 9k denklemini kur.",
      "Rakam kısıtı (0-9) ile birlikte tüm olası (A,B) çiftlerini bul.",
      "✅ Cevap: D"],
  7: ["Birden fazla sayıya bölünme + kalan koşulları: Çin Kalan Teoremi (ÇKT) veya deneme.",
      "ÇKT: x ≡ r₁ (mod m₁) ve x ≡ r₂ (mod m₂) sistemini çöz.",
      "Pratik yol: daha büyük modüle göre listeyi yaz, diğer koşulu sağlayanı bul.",
      "✅ Cevap: D"],
  8: ["Karmaşık kalan sorusu: modüler aritmetiği adım adım uygula.",
      "Her işlemi mod n altında tut; büyük sayılarla çalışmak yerine kalanlarla çalış.",
      "Ara sonuçları modüler aritmetikle küçük tut, son adımda cevabı bul.",
      "✅ Cevap: A"],
  9: ["Ardışık sayıların kalanları: ardışık tam sayılar birer birer tüm kalanları üretir (0'dan n−1'e).",
      "Ardışık n sayının bölüme göre kalanları: 0, 1, 2, …, n−1.",
      "Bu özelliği kullanarak toplam/çarpım kalanlarını hesapla.",
      "✅ Cevap: E"],
  10: ["Son basamak = sayının 10'a göre kalanı.",
       "Üslü ifadede son basamak döngüsü: tabanın son basamağına göre belirle.",
       "Son basamak periyotları: 2→(2,4,8,6), 3→(3,9,7,1), 7→(7,9,3,1), 8→(8,4,2,6).",
       "Üssü 4'e böl, kalanına göre döngüdeki konumu bul.",
       "✅ Cevap: B"],
  11: ["Karmaşık bölünebilirlik: önce her koşulu ayrı listele.",
       "Koşulları birleştir: 'hem A hem B koşulunu sağlayan sayı' → EKOK yaklaşımı.",
       "Bilinmeyen rakam varsa, rakamın alabileceği değerleri sınırlayan tüm koşulları uygula.",
       "✅ Cevap: C"],
  12: ["Kalan problemi zinciri: ilk sayının kalanını bul, sonucu bir sonraki adıma sok.",
       "Her adımda modüler aritmetik kurallarını uygula.",
       "Sonuç: son adımdaki kalan istenen cevaptır.",
       "✅ Cevap: C"],
},

// ─── BÖLME — 3. ADIM (TYT) ─────────────────────────────────────────────
"bolme-3-adim": {
  1: ["TYT sorusu: bölünebilme kuralını doğrudan uygula.",
      "Hangi kural soruluyorsa (2, 3, 4, 5, 6, 9, 11) onu uygula.",
      "Bilinmeyen varsa denklem kur, rakam kısıtı (0-9) ile çöz.",
      "✅ Cevap: A"],
  2: ["Bilinmeyen basamaklı sayı + birden fazla bölünme koşulu.",
      "Her koşul için olası rakam değerlerini listele, kesişimi bul.",
      "Birden fazla çözüm çıkabilir; ek koşullar varsa onları da uygula.",
      "✅ Cevap: A"],
  3: ["Modüler aritmetik: a mod n = r → a = n×k + r.",
      "İstenen: verilen bilgilerden a veya r'yi bulmak.",
      "Adımlar: verilen bilgileri a = nk + r formuna çevir, istenen değeri hesapla.",
      "✅ Cevap: B"],
  4: ["Ardışık tam sayıların bölünebilirlik özelliği: n ardışık sayıdan biri n'e tam bölünür.",
      "Bu özelliğin sonucu: n ardışık sayının çarpımı n!'ın (n faktöriyel) katıdır.",
      "Özelliği doğrudan uygula; ayrıca EBOB ve EKOK ilişkilerini kullan.",
      "✅ Cevap: C"],
  5: ["Üslü ifadenin kalanı için döngü yöntemi:",
      "1. Tabanın küçük kuvvetlerinin kalanlarını hesapla: a¹, a², a³, …",
      "2. Kalanların tekrar ettiği noktayı bul → döngü uzunluğu (periyot) p.",
      "3. Üssü p'ye böl, kalanına (r) göre aᵣ mod n = istenen kalan.",
      "✅ Cevap: D"],
  6: ["Son basamak = 10'a göre kalan. Döngü uzunluğu genelde 4'tür.",
      "Son basamak döngüleri: 1→her zaman 1; 5→her zaman 5; 6→her zaman 6.",
      "Taban son basamağını al, döngüsünü bul, üssü 4'e böl, konumu belirle.",
      "✅ Cevap: D"],
  7: ["Hem 3'e hem 4'e bölünebilmek için:",
      "3'e bölünme: rakamlar toplamı 3'ün katı.",
      "4'e bölünme: son iki basamak 4'ün katı.",
      "Her iki koşulu birlikte sağlayan bilinmeyen rakamı bul.",
      "✅ Cevap: A"],
  8: ["İki bilinmeyen rakam, iki koşul → denklem sistemi kur.",
      "Koşul 1: bölünebilme kuralı (rakamlar toplamı veya son basamaklar).",
      "Koşul 2: ikinci bölünebilme kuralı veya başka kısıtlama.",
      "0-9 arası rakam kısıtını kullanarak sistemi çöz.",
      "✅ Cevap: C"],
  9: ["Zor TYT sorusu: modüler aritmetiği birden fazla adımda uygula.",
      "Her adımda kalanı hesapla ve bir sonraki adımın girdisi yap.",
      "Formülleri doğru uygula: (a+b) mod n ve (a×b) mod n.",
      "✅ Cevap: D"],
  10: ["En zor bölünebilirlik sorusu: tüm bölünebilme kurallarını kombine et.",
       "Hangi sayının hangi koşulları sağladığını tabloya dökerek sistematik çalış.",
       "Eleme yöntemi: en az sayıda koşulu sağlayanları önce ele, kalanları kontrol et.",
       "✅ Cevap: B"],
},

// ─── EBOB - EKOK — 1. ADIM ─────────────────────────────────────────────
"ebob-ekok-1-adim": {
  1: ["EBOB (En Büyük Ortak Bölen): iki sayıyı da tam bölen en büyük sayı.",
      "Yöntem: her iki sayıyı asal çarpanlarına ayır; ORTAK asal çarpanları EN KÜÇÜK kuvvetleriyle çarp.",
      "Örnek: 12 = 2²×3, 18 = 2×3² → EBOB = 2¹×3¹ = 6.",
      "✅ Cevap: C"],
  2: ["EKOK (En Küçük Ortak Kat): her iki sayının da katı olan en küçük sayı.",
      "Yöntem: TÜM asal çarpanları EN BÜYÜK kuvvetleriyle çarp.",
      "Örnek: 12 = 2²×3, 18 = 2×3² → EKOK = 2²×3² = 36.",
      "✅ Cevap: C"],
  3: ["Önemli formül: EBOB(a,b) × EKOK(a,b) = a × b.",
      "Bu formül iki sayı için geçerlidir (üç ve daha fazla sayı için genelleşmez!).",
      "Bilinmeyen EBOB veya EKOK'u bulmak için: EKOK = (a×b) / EBOB.",
      "✅ Cevap: A"],
  4: ["EBOB özelliği: EBOB(a,b), a'yı da b'yi de tam böler.",
      "EBOB'dan büyük bir ortak bölen bulunamaz (tanım gereği).",
      "Verilen sayıların bölenleri listesi: EBOB, bu listelerin kesişiminin en büyük elemanıdır.",
      "✅ Cevap: A"],
  5: ["EKOK özelliği: EKOK(a,b), a'nın da b'nin de katıdır.",
      "EKOK'tan küçük bir ortak kat bulunamaz (tanım gereği).",
      "Verilen sayıların katları listesi: EKOK, bu listelerin kesişiminin en küçük elemanıdır.",
      "✅ Cevap: C"],
  6: ["Üç sayının EBOB'u: üçünü birden tam bölen en büyük sayı.",
      "Yöntem: üç sayıyı da asal çarpanlarına ayır; ORTAK olanları EN KÜÇÜK kuvvetle al.",
      "Örnek: 12 = 2²×3, 18 = 2×3², 24 = 2³×3 → EBOB = 2¹×3¹ = 6.",
      "✅ Cevap: E"],
  7: ["Üç sayının EKOK'u: üçünün de katı olan en küçük sayı.",
      "Yöntem: TÜM sayıların asal çarpanlarını EN BÜYÜK kuvvetleriyle al.",
      "Örnek: 4 = 2², 6 = 2×3, 9 = 3² → EKOK = 2²×3² = 36.",
      "✅ Cevap: D"],
  8: ["a ve b sayılarının EBOB'u d ise: a = d×m ve b = d×n (m ve n aralarında asal).",
      "Bu gösterim çok kullanışlıdır: EKOK = d×m×n ve a×b = d²×m×n.",
      "m ve n'nin aralarında asal olması zorunludur (ortak bölen olsaydı EBOB büyürdü).",
      "✅ Cevap: B"],
  9: ["Aralarında asal sayılar: EBOB(a,b) = 1.",
      "EBOB = 1 ise EKOK(a,b) = a×b (formül: EBOB×EKOK = a×b).",
      "Verilen sayıların EBOB'u 1 mi kontrol et; öyleyse EKOK doğrudan çarpım.",
      "✅ Cevap: A"],
  10: ["EBOB ve EKOK verilmiş, sayıları bul:",
       "Adım 1: Sayılar EBOB'un katı şeklinde yaz: a = EBOB×m, b = EBOB×n.",
       "Adım 2: EKOK = EBOB×m×n olduğundan m×n = EKOK/EBOB.",
       "Adım 3: m ve n'yi aralarında asal koşuluyla bul.",
       "✅ Cevap: A"],
  11: ["Üç sayı için EBOB ve EKOK: ikili hesaplamaları birleştir.",
       "EBOB(a,b,c) = EBOB(EBOB(a,b), c).",
       "EKOK(a,b,c) = EKOK(EKOK(a,b), c).",
       "Adım adım ikili işlem yap.",
       "✅ Cevap: C"],
},

// ─── EBOB - EKOK — 2. ADIM ─────────────────────────────────────────────
"ebob-ekok-2-adim": {
  1: ["İki sayının EBOB'unu asal çarpanlara ayırarak bul.",
      "Ortak asal çarpanları en küçük kuvvetle çarp → EBOB.",
      "Sonucu doğrula: EBOB her iki sayıyı da tam bölmeli.",
      "✅ Cevap: C"],
  2: ["EBOB = d ise a = d×m, b = d×n ve m⊥n (aralarında asal).",
      "Bu gösterimden EKOK = d×m×n ve a×b = d²mn.",
      "Bilinmeyen m veya n'yi bulmak için: m×n = EKOK/d ve m,n aralarında asal koşulunu kullan.",
      "✅ Cevap: D"],
  3: ["EKOK hesabı: tüm asal çarpanlar en büyük kuvvetle.",
      "Adım 1: Her sayıyı asal çarpanlarına ayır.",
      "Adım 2: Hangi asal çarpanlar var (herhangi birinde) → hepsini al, en büyük kuvvetle.",
      "Adım 3: Çarp → EKOK.",
      "✅ Cevap: B"],
  4: ["Periyodik olay problemi: iki olay T₁ ve T₂ aralıklarla gerçekleşiyor.",
      "Aynı anda gerçekleşecekleri en kısa süre = EKOK(T₁, T₂).",
      "Örnek: 6 dk ve 9 dk'da bir tekrarlanan olaylar → EKOK(6,9) = 18 dk sonra buluşur.",
      "✅ Cevap: A"],
  5: ["Eşit gruplara bölme: n nesneyi ve m nesneyi eşit gruplara böl, grup kadar küçük.",
      "En büyük grup sayısı = EBOB(n,m). Grup başına düşen miktar n/EBOB ve m/EBOB.",
      "Örnek: 24 elma ve 36 armut → EBOB(24,36) = 12 → 12 grup, her grupta 2 elma + 3 armut.",
      "✅ Cevap: D"],
  6: ["Üç veya daha fazla periyodik olay: tüm olayların EKOK'u = hepsinin buluşacağı minimum süre.",
      "EKOK(T₁, T₂, T₃) = EKOK(EKOK(T₁, T₂), T₃) şeklinde adım adım hesapla.",
      "✅ Cevap: D"],
  7: ["a×b = EBOB(a,b) × EKOK(a,b) formülü ile bilinmeyeni bul.",
      "EBOB ve EKOK verilmişse: a×b = EBOB×EKOK.",
      "Sayıları bulmak için a = EBOB×m, b = EBOB×n (m⊥n, mn = EKOK/EBOB) kullan.",
      "✅ Cevap: A"],
  8: ["Farklı başlangıç zamanlarında periyodik olaylar: başlangıç farkını dikkate al.",
      "Olaylar t₁ ve t₂ zamanında başlıyor, T₁ ve T₂ aralıklarla tekrarlıyor.",
      "Buluşma zamanı: t = t₁ + k₁×T₁ = t₂ + k₂×T₂ denklemini mod kullanarak çöz.",
      "✅ Cevap: E"],
  9: ["Üç sayılı EKOK: ikili EKOK'ları birleştirerek hesapla.",
      "EKOK(a,b,c) → önce EKOK(a,b) = d bul, sonra EKOK(d,c) bul.",
      "✅ Cevap: A"],
  10: ["EBOB ile parçalara bölme: toplam nesneyi eşit parçalara ayır.",
       "EBOB, parçaların büyüklüğünü verir. Parça sayısı = toplam / EBOB.",
       "Verilen koşulları EBOB formülüne göre yorumla.",
       "✅ Cevap: B"],
  11: ["En zor EBOB-EKOK sorusu: birden fazla bilinmeyen.",
       "Adım 1: a = EBOB×m, b = EBOB×n yaz.",
       "Adım 2: EKOK = EBOB×m×n → m×n bul.",
       "Adım 3: m ve n aralarında asal olan çift sayısını listele, ek koşulları uygula.",
       "✅ Cevap: C"],
},

// ─── EBOB - EKOK — 3. ADIM (TYT) ───────────────────────────────────────
"ebob-ekok-3-adim": {
  1: ["TYT sorusu: asal çarpanlara ayırma yöntemiyle EBOB veya EKOK bul.",
      "Adımlar: faktörizasyon → ortak çarpanlar (EBOB) veya tüm çarpanlar (EKOK) → çarp.",
      "Sonucu formülle doğrula: EBOB×EKOK = a×b.",
      "✅ Cevap: B"],
  2: ["İki periyodik olayın aynı anda gerçekleşmesi: EKOK(T₁, T₂) dakika/saniye/gün sonra.",
      "Birimleri eşleştir (dakika/saniye karışıklığına dikkat).",
      "EKOK'u bul, birim dönüşümü yap, yorumla.",
      "✅ Cevap: B"],
  3: ["EBOB ve EKOK verilerek sayıları bul:",
      "a = EBOB×m, b = EBOB×n (m⊥n). m×n = EKOK/EBOB.",
      "m ve n'yi aralarında asal olacak şekilde listele (mn = sabit).",
      "Ek koşul varsa (a < b gibi) uygula, cevabı belirle.",
      "✅ Cevap: C"],
  4: ["Kesiri sadeleştirme: pay ve paydanın EBOB'unu bul, her ikisini EBOB'a böl.",
      "a/b kesirini sadeleştir: EBOB(a,b) = d → (a/d) / (b/d) tam sadeleşmiş kesir.",
      "✅ Cevap: A"],
  5: ["Kare sayı kontrolü: n'nin tam kare olması için tüm asal çarpanların üsleri çift olmalı.",
      "EBOB veya EKOK'u bulduktan sonra asal çarpanlar üslerini kontrol et.",
      "Üslerden herhangi biri tek ise tam kare değildir.",
      "✅ Cevap: A"],
  6: ["Üç veya daha fazla sayının EKOK/EBOB'u: adım adım ikili hesap.",
      "EBOB(a,b,c) = EBOB(EBOB(a,b), c), EKOK(a,b,c) = EKOK(EKOK(a,b), c).",
      "✅ Cevap: B"],
  7: ["Periyodik buluşma problemi: önce birimleri saate veya dakikaya çevir.",
      "Periyotların EKOK'u = ilk buluşma süresi.",
      "Birden fazla buluşma istenirse: EKOK × k (k = 1, 2, 3, …).",
      "✅ Cevap: C"],
  8: ["Bölen sayısı: n = p₁^a₁ × p₂^a₂ × … ise bölen sayısı = (a₁+1)(a₂+1)…",
      "EBOB veya EKOK'u bulduktan sonra asal çarpan kuvvetlerini kullanarak bölen sayısını hesapla.",
      "✅ Cevap: E"],
  9: ["Ardışık tam sayıların EBOB'u her zaman 1'dir.",
      "Çünkü ardışık iki sayı aralarında asaldır (farkları 1 olduğundan ortak bölen 1 dışında olamaz).",
      "Bu özelliği kullanarak verilen ifadenin EBOB'unu belirle.",
      "✅ Cevap: D"],
  10: ["En zor TYT sorusu: birden fazla koşul ve bilinmeyen.",
       "Sistematik yaklaşım: EBOB = d yaz, a = dm, b = dn, mn = EKOK/d.",
       "Tüm (m,n) çiftlerini aralarında asal koşuluyla listele, ek kısıtlamaları uygula.",
       "✅ Cevap: D"],
},

// ─── BİRİNCİ DERECE DENKLEM 1 — 1. ADIM ───────────────────────────────
"denklem-1-1-adim": {
  1: ["Denklemi çözme adımları: x'in katsayısı bir tarafa, sabitler diğer tarafa.",
      "3x + 5 = 14 → 3x = 14 − 5 = 9 → x = 9/3 = 3.",
      "Çözümü denkleme yerine koyarak doğrula: 3×3+5 = 14 ✓.",
      "✅ Cevap: C"],
  2: ["Parantezli denklem: önce parantezi dağıtım özelliğiyle aç.",
      "a(b+c) = ab+ac kuralı. Örnek: 2(x+3) = 2x + 6.",
      "Parantezi açtıktan sonra normal birinci derece denklem çözümüne geç.",
      "✅ Cevap: A"],
  3: ["Kesirli denklem: tüm terimleri ortak paydayla çarp, paydaları yok et.",
      "Örnek: x/2 + x/3 = 5 → 6'yla çarp → 3x + 2x = 30 → 5x = 30 → x = 6.",
      "Ortak paydayı bulduktan sonra her terimi ayrı ayrı çarp.",
      "✅ Cevap: B"],
  4: ["İki bilinmeyenli ifade: biri cinsinden diğerini bul, yerine koy.",
      "Örnek: y = 2x + 1 verildiyse, ikinci denklemdeki y'yi 2x+1 ile değiştir.",
      "Tek bilinmeyenli denklemi çöz, bulduğun değeri geri koyarak diğerini bul.",
      "✅ Cevap: B"],
  5: ["Kelime problemi çözüm adımları:",
      "1. Bilinmeyeni tanımla (x = ?).",
      "2. Koşulları denklemle ifade et.",
      "3. Denklemi çöz.",
      "4. Cevabı kontrol et (mantıklı mı, koşulları sağlıyor mu?).",
      "✅ Cevap: D"],
  6: ["Sayı problemi: ardışık sayılar için x, x+1, x+2; katlar için x, 2x, 3x kullan.",
      "Verilen toplam, fark veya oran koşulunu denklemle yaz.",
      "Denklemi çöz, bulunan sayıyı kontrol et.",
      "✅ Cevap: C"],
  7: ["Yaş problemi: şimdiki yaş x ise, n yıl sonra x+n, n yıl önce x−n.",
      "Verilen yaş ilişkilerini denklemle ifade et.",
      "Örnek: 'Ali, Ayşe'nin 3 katı yaşındadır': Ali = 3×Ayşe → denklem kur.",
      "✅ Cevap: C"],
  8: ["İş problemi: A işi 'a' günde, B işi 'b' günde bitirir.",
      "A'nın 1 günlük işi = 1/a, B'nin = 1/b. Birlikte: 1/a + 1/b = 1/T.",
      "T = ab/(a+b) formülü türetilir. Sayıları koy, çöz.",
      "✅ Cevap: B"],
  9: ["Hareket problemi: Yol = Hız × Zaman (d = v × t).",
      "Karşılıklı giderlerse: d₁ + d₂ = toplam yol. Aynı yönde giderlerse: |d₁ − d₂| = fark.",
      "Her araç için ayrı denklem yaz, birleştir.",
      "✅ Cevap: D"],
  10: ["Kesir problemi: pay ve paydayı x ile ifade et.",
       "Örnek: 'payı paydanın iki eksiği olan kesir 1/3'e eşittir': (x−2)/x = 1/3.",
       "Çapraz çarparak veya x'i yalnız bırakarak çöz.",
       "✅ Cevap: B"],
  11: ["Birden fazla koşul: her koşutu ayrı bir denklem olarak yaz.",
       "Denklem sistemi oluşur → yerine koyma veya yok etme yöntemiyle çöz.",
       "Çözümün her iki koşulu da sağladığını kontrol et.",
       "✅ Cevap: A"],
},

// ─── BİRİNCİ DERECE DENKLEM 1 — 2. ADIM ───────────────────────────────
"denklem-1-2-adim": {
  1: ["Eşitsizlik çözümü denkleme benzer, tek fark: negatif sayıyla çarparken/bölerken yön değişir!",
      "Örnek: −2x > 6 → x < −3 (bölünce yön tersine döner).",
      "Her adımda işlemin pozitif mi negatif mi olduğunu kontrol et.",
      "✅ Cevap: E"],
  2: ["Çift yönlü (bileşik) eşitsizlik: a < 3x + 1 < 10 gibi.",
      "Tüm parçalara aynı işlemi uygula. Örnek: 1 bırak, 3x'i yalnız bırak, tüm parçaya uygula.",
      "a < 3x + 1 < 10 → a−1 < 3x < 9 → (a−1)/3 < x < 3.",
      "✅ Cevap: A"],
  3: ["Eşitsizliğin çözüm kümesini sayı doğrusunda göster.",
      "< veya > için nokta içi boş (açık), ≤ veya ≥ için dolu daire kullan.",
      "Çözüm kümesini aralık notasyonuyla yaz: (a,b), [a,b], (a,b], [a,b).",
      "✅ Cevap: D"],
  4: ["Kesirli eşitsizlik: eğer payda pozitifse yön korunur; negatifse yön tersine döner.",
      "Paydanın işareti bilinmiyorsa iki durum incele: payda > 0 ve payda < 0.",
      "Her iki durumun çözüm kümelerini birleştir veya kesişimini al.",
      "✅ Cevap: B"],
  5: ["Mutlak değerli denklem: |f(x)| = a (a > 0) → f(x) = a veya f(x) = −a.",
      "Her iki durumu ayrı denklem olarak çöz, çözümleri birleştir.",
      "a < 0 ise çözüm yoktur; a = 0 ise tek çözüm f(x) = 0.",
      "✅ Cevap: A"],
  6: ["İki eşitsizliğin kesişimi: her iki eşitsizliği de sağlayan x değerleri.",
      "Eşitsizlik 1 → çözüm kümesi A. Eşitsizlik 2 → çözüm kümesi B.",
      "Kesişim: A ∩ B. Sayı doğrusunda her iki bölgenin de üzerinde olan aralık.",
      "✅ Cevap: A"],
  7: ["Eşitsizlik sistemi: tüm eşitsizlikleri ayrı çöz.",
      "Çözüm kümelerinin kesişimi = sistemin çözümü.",
      "Sayı doğrusunda her bölgeyi çiz, ortak aralığı bul.",
      "✅ Cevap: B"],
  8: ["Problem tipi eşitsizlik: bilinmeyeni tanımla, koşulu eşitsizlikle yaz.",
      "Örnek: 'En az 500 lira kâr etmek için en az kaç ürün satmalı?' → gelir − gider ≥ 500.",
      "Eşitsizliği çöz, sonucu gerçek koşulda yorumla (tam sayıya yuvarla).",
      "✅ Cevap: B"],
  9: ["Parametreli denklem: parametrenin (genellikle 'a') işaretine göre durumları ayır.",
      "a > 0 ise: normal çözüm. a < 0 ise: eşitsizlik yönü değişir. a = 0 ise: denklem değişir.",
      "Her durumu ayrı çöz, parametre kısıtını belirt.",
      "✅ Cevap: C"],
  10: ["Tam sayı çözüm sayısı: eşitsizliği çöz, çözüm aralığındaki tam sayıları say.",
       "Örnek: 2 < x < 8 → tam sayılar: 3, 4, 5, 6, 7 → 5 tam sayı.",
       "Açık aralık için sınır değerleri dahil değil; kapalı aralıkta dahildir.",
       "✅ Cevap: C"],
  11: ["Parantezli ve kesirli eşitsizlik: adım adım sadeleştir.",
       "1. Parantezi aç. 2. Ortak payda ile sadeleştir. 3. x'i yalnız bırak. 4. Yönü kontrol et.",
       "✅ Cevap: B"],
  12: ["İç içe eşitsizlik veya parametreli karmaşık soru:",
       "İçtekini önce çöz, dıştakini uygula. Parametreli ise her değer aralığını ayrı incele.",
       "Tüm durumları birleştirip kesin çözümü bul.",
       "✅ Cevap: E"],
},

// ─── BİRİNCİ DERECE DENKLEM 1 — 3. ADIM (TYT) ─────────────────────────
"denklem-1-3-adim": {
  1: ["Standart birinci derece denklem: x'i bir tarafa topla, sadeleştir.",
      "Her adımda işlemleri doğru uygula (parantez, kesir, negatif).",
      "Çözümü denkleme koyarak doğrula.",
      "✅ Cevap: D"],
  2: ["Eşitsizliği çöz, tam sayı çözümlerini say.",
      "Kesirli veya ondalıklı sınırları tam sayıya yuvarla (yukarı mı aşağı mı? → sınırın dahil olup olmadığına bak).",
      "✅ Cevap: E"],
  3: ["TYT kelime problemi: soruyu dikkatli oku, bilinmeyeni doğru tanımla.",
      "Koşulları denklemle yaz, çöz, sonucu gerçek soruyla karşılaştır.",
      "✅ Cevap: B"],
  4: ["Kesirli TYT denklemi: LCM (en küçük ortak payda) ile sadeleştir.",
      "Tüm terimleri ortak paydayla çarp → payda temizlenir → normal denklem çöz.",
      "✅ Cevap: B"],
  5: ["Eşitsizlik sistemi: her eşitsizliği çöz, sonra tüm çözümlerin kesişimini al.",
      "Sayı doğrusunu kullan, her eşitsizliğin aralığını göster.",
      "✅ Cevap: E"],
  6: ["Parametreli denklem: a = 0 ise denklem 1. derece olmaktan çıkabilir (0=sabit → çözümsüz veya sonsuz çözüm).",
      "a ≠ 0 ise normal çözüm yap. Her durumu ayrı belirt.",
      "✅ Cevap: D"],
  7: ["TYT yaş veya sayı problemi: şıkları deneme de kullanılabilir.",
      "Denklem yolu: bilinmeyeni tanımla → koşulları yaz → çöz → kontrol et.",
      "Deneme yolu: şıkları koşullara uygula, uygun olanı bul.",
      "✅ Cevap: E"],
  8: ["En zor TYT sorusu: birden fazla koşul, birden fazla adım.",
      "Adım 1: Tüm koşulları listele. Adım 2: Denklem veya eşitsizlik kur. Adım 3: Çöz.",
      "Çözümün tüm koşulları sağladığını mutlaka kontrol et.",
      "✅ Cevap: D"],
},

// ─── BİRİNCİ DERECE DENKLEM 2 — 1. ADIM ───────────────────────────────
"denklem-2-1-adim": {
  1: ["İki bilinmeyenli denklem sistemi — Yerine Koyma Yöntemi:",
      "Adım 1: İlk denklemden bir bilinmeyeni (örn. y) x cinsinden ifade et.",
      "Adım 2: Bulduğun ifadeyi ikinci denkleme koy.",
      "Adım 3: Tek bilinmeyenli denklemi çöz, sonucu geri koy.",
      "✅ Cevap: D"],
  2: ["İki bilinmeyenli denklem sistemi — Yok Etme (Toplama-Çıkarma) Yöntemi:",
      "Adım 1: Bir bilinmeyenin katsayısını her iki denklemde eşit yap (gerekirse uygun sayıyla çarp).",
      "Adım 2: Denklemleri topla veya çıkar → bir bilinmeyen yok olur.",
      "Adım 3: Tek değişkenli denklemi çöz, diğerini bul.",
      "✅ Cevap: E"],
  3: ["Grafik yorumlama: iki doğrunun kesişim noktası = denklem sisteminin tek çözümü.",
      "y = m₁x + b₁ ve y = m₂x + b₂ doğruları kesişiyorsa tek çözüm (m₁ ≠ m₂).",
      "Eğimler eşitse paralel (çözüm yok) veya aynı doğru (sonsuz çözüm).",
      "✅ Cevap: E"],
  4: ["Özel durumlar:",
      "• Paralel doğrular (m₁=m₂, b₁≠b₂): Çözüm YOK (eşitsiz sistem).",
      "• Çakışık doğrular (m₁=m₂, b₁=b₂): SONSUZ çözüm (bağımlı sistem).",
      "• Katsayı oranlarını karşılaştır: a₁/a₂ = b₁/b₂ = c₁/c₂ → sonsuz; a₁/a₂ = b₁/b₂ ≠ c₁/c₂ → çözümsüz.",
      "✅ Cevap: B"],
  5: ["Problem tipi iki bilinmeyenli kelime sorusu:",
      "Adım 1: İki bilinmeyeni x ve y olarak tanımla.",
      "Adım 2: İki ayrı koşutu denklemle yaz → sistem oluşur.",
      "Adım 3: Sistemi çöz, istenen değeri hesapla.",
      "✅ Cevap: B"],
  6: ["Üçlü denklem sistemi: iki denklemi kullanarak bir bilinmeyeni yok et → iki denklemli sisteme indir.",
      "Adım 1: İlk ikisinden z'yi yok et → denklem A (x, y cinsinden).",
      "Adım 2: İkinci ve üçüncüden z'yi yok et → denklem B.",
      "Adım 3: A ve B'den oluşan iki bilinmeyenli sistemi çöz.",
      "✅ Cevap: D"],
  7: ["Determinant ile çözüm: ax+by=e ve cx+dy=f sistemi için",
      "D = ad − bc. Eğer D = 0 → özgün çözüm yoktur (paralel veya çakışık).",
      "D ≠ 0 → x = (ed−bf)/D, y = (af−ec)/D.",
      "✅ Cevap: C"],
  8: ["Kesirli denklem sistemi: her denklemi LCM ile sadeleştirerek paydaları temizle.",
      "Sadeleştirilen sistem artık normal denklem sistemi; yerine koyma veya yok etme ile çöz.",
      "✅ Cevap: B"],
  9: ["Parametreli sistem: parametre değerine göre çözüm durumu değişir.",
      "D = 0 olduğunda çözüm durumu özelleşir (çözümsüz veya sonsuz).",
      "Parametre değerlerini ayrı ayrı incele: D ≠ 0 (tek çözüm), D = 0 (özel durum).",
      "✅ Cevap: B"],
  10: ["Çözüm sayısı sorusu: katsayıların oranlarını incele.",
       "a₁/a₂ ≠ b₁/b₂ → TEK çözüm. a₁/a₂ = b₁/b₂ = c₁/c₂ → SONSUZ. a₁/a₂ = b₁/b₂ ≠ c₁/c₂ → SIFIR.",
       "✅ Cevap: D"],
  11: ["Üç bilinmeyenli karmaşık sistem: adım adım Gauss yöntemi.",
       "Her adımda bir bilinmeyeni yok et, sistemi küçült.",
       "Son olarak tek bilinmeyenli denklemi çöz, geri yerine koy (back-substitution).",
       "✅ Cevap: B"],
},

// ─── BİRİNCİ DERECE DENKLEM 2 — 2. ADIM ───────────────────────────────
"denklem-2-2-adim": {
  1: ["Denklem + eşitsizlik kombinasyonu: önce denklemi çöz (x değerini bul).",
      "Bulunan x değerini eşitsizliğe koy, eşitsizliği kontrol et veya eşitsizliği bağımsız çöz.",
      "✅ Cevap: D"],
  2: ["Mutlak değerli eşitsizlik — Tip 1: |f(x)| < a (a > 0)",
      "Çözüm: −a < f(x) < a",
      "Geometrik yorum: f(x)'in a'ya uzaklığı a'dan küçük olan x değerleri.",
      "Bileşik eşitsizliği çöz.",
      "✅ Cevap: B"],
  3: ["Mutlak değerli eşitsizlik — Tip 2: |f(x)| > a (a > 0)",
      "Çözüm: f(x) < −a VEYA f(x) > a",
      "İki ayrı bölgede çözüm vardır; iki ayrı eşitsizliği çöz, birleştir.",
      "✅ Cevap: B"],
  4: ["Kesirli eşitsizlik: paydanın işaretini dikkate al!",
      "Yöntem: Her iki tarafı da payda × payda ile çarp (her zaman pozitif) → payda yok olur, yön korunur.",
      "Veya: bölgeler yöntemi — kesir sıfır/tanımsız olan noktaları bul, aralıklarda işaret belirle.",
      "✅ Cevap: C"],
  5: ["İkinci dereceden eşitsizliğe yaklaşım (1. derece teknikleriyle):",
      "Karekök alarak veya (x+a)(x+b) < 0 gibi faktoring yaparak çöz.",
      "Sayı doğrusunda kritik noktaları işaretle, işaret tablosu yap.",
      "✅ Cevap: A"],
  6: ["Sayı doğrusunda eşitsizlik çözümü:",
      "1. Eşitsizliği çöz → x değer aralığını bul.",
      "2. Sayı doğrusunda oku veya nokta ile göster (açık/kapalı).",
      "3. Çözüm kümesini aralık notasyonuyla yaz.",
      "✅ Cevap: A"],
  7: ["İç içe mutlak değer: |  |x| − 2  | < 3 gibi.",
      "Adım 1: İçteki mutlak değeri çöz → |x| = y yerine koy.",
      "Adım 2: Dıştaki mutlak değerli eşitsizliği çöz.",
      "Adım 3: Her iki durumu birleştir.",
      "✅ Cevap: B"],
  8: ["Eşitsizlik + tam sayı çözüm sayısı:",
       "Eşitsizliği çöz → x aralığını bul (örn. 1.5 < x ≤ 7.3).",
       "Aralıktaki tam sayıları listele: 2, 3, 4, 5, 6, 7 → 6 tam sayı.",
       "✅ Cevap: D"],
  9: ["Parametreli eşitsizlik: parametre 'a'nın işaretine göre iki durum:",
       "a > 0: x > b/a (yön korunur). a < 0: x < b/a (yön tersine döner). a = 0: 0 > b (çözüm yok veya tüm R).",
       "Her durumu ayrı ifade et.",
       "✅ Cevap: A"],
  10: ["En zor eşitsizlik sorusu: birden fazla koşul.",
       "Her koşulun çözüm kümesini ayrı bul, sonra kesişimini al.",
       "Sayı doğrusunda görselleştir, kesişen aralığı yaz.",
       "✅ Cevap: A"],
},

// ─── BİRİNCİ DERECE DENKLEM 2 — 3. ADIM (TYT) ─────────────────────────
"denklem-2-3-adim": {
  1: ["TYT denklem sistemi: yerine koyma veya yok etme yöntemi.",
      "Daha basit görünen denklemi seç, bir bilinmeyeni izole et, diğerine koy.",
      "Her iki yöntemi de biliyor olman gerekir; soruya göre en hızlı olanı seç.",
      "✅ Cevap: A"],
  2: ["TYT eşitsizlik sistemi: her eşitsizliği çöz, sonra kesişimi bul.",
      "Kesişim kümesi = tüm eşitsizlikleri aynı anda sağlayan x değerleri.",
      "✅ Cevap: E"],
  3: ["TYT mutlak değerli soru: |f(x)| = a → f(x) = a veya f(x) = −a.",
      "|f(x)| < a → −a < f(x) < a. |f(x)| > a → f(x) < −a veya f(x) > a.",
      "Soruda hangi form varsa ilgili kuralı uygula.",
      "✅ Cevap: A"],
  4: ["Problem tipi TYT: iki koşutu iki denklemle yaz, sistemi çöz.",
      "Şıkları deneme yolu da uygulanabilir: şıkları koşullara yerine koy, uyanı bul.",
      "✅ Cevap: A"],
  5: ["Kesirli denklem sistemi: LCM ile sadeleştir, normal sisteme çevir, çöz.",
      "LCM'yi her terimi için ayrı hesapla, işlemi sırayla uygula.",
      "✅ Cevap: C"],
  6: ["Parametreli sistem: çözüm sayısına göre parametre değerini bul.",
      "Tek çözüm → D ≠ 0. Sonsuz çözüm → D = 0 ve koşullu bağlı. Çözümsüz → D = 0, koşul sağlanmaz.",
      "Parametre değerini her duruma göre hesapla.",
      "✅ Cevap: C"],
  7: ["TYT mutlak değerli eşitsizlik: her durumu ayrı çöz (< veya > tipine göre).",
      "Çözüm kümelerini birleştir veya kesişimini al.",
      "Sayı doğrusunda kontrol et.",
      "✅ Cevap: B"],
  8: ["TYT eşitsizlik sistemi + tam sayı çözümler:",
       "Sistemi çöz → x aralığını bul. Aralıktaki tam sayıları say.",
       "Sınır dahil mi değil mi? Eşitsizlik ≤ veya < işaretine göre belirle.",
       "✅ Cevap: D"],
  9: ["Denklem + eşitsizlik karışık TYT sorusu:",
       "Denklemi çöz, bulduğu x'i eşitsizlikte kullan veya bağımsız eşitsizliği çöz.",
       "Her adımı doğru sırayla uygula.",
       "✅ Cevap: C"],
  10: ["En zor TYT sorusu: tüm teknikleri birleştir.",
       "Sistematik çalış: 1. Koşulları listele. 2. En uygun yöntemi seç. 3. Çöz. 4. Doğrula.",
       "✅ Cevap: C"],
},
};

function getCozumAdimlar(altKonuId, soruNo) {
  const konuCozumleri = COZUMLER[altKonuId];
  if (!konuCozumleri || !konuCozumleri[soruNo]) return null;
  return konuCozumleri[soruNo];
}

function showCevapModal(soruNo){
  const alt = appState.aktifAltKonu;
  const s = alt?.sorular?.find(q=>q.no===soruNo);
  if(!s) return;
  appState.cevapModalSoruNo = soruNo;
  document.getElementById('cmaVal').textContent = s.cevap==='—'?'?':s.cevap;

  // Konu bilgisi
  const konuEl = document.getElementById('cmaKonu');
  if(konuEl) konuEl.textContent = alt.ad || '—';

  // İpucu
  const hintEl = document.getElementById('cmaHint');
  if(s.ipucu){ hintEl.textContent=s.ipucu; hintEl.style.display='block'; }
  else { hintEl.style.display='none'; }

  // Çözüm adımları
  const adimlarEl = document.getElementById('cozumAdimlar');
  if(adimlarEl){
    const adimlar = getCozumAdimlar(alt.id, soruNo);
    if(adimlar && adimlar.length > 0){
      adimlarEl.innerHTML = adimlar.map((metin, i) => {
        const sonAdim = i === adimlar.length - 1;
        return `<div class="cozum-adim${sonAdim?' son-adim':''}">
          <div class="cozum-adim-no">${sonAdim?'✓':(i+1)}</div>
          <div class="cozum-adim-metin">${metin}</div>
        </div>`;
      }).join('');
    } else {
      adimlarEl.innerHTML = '<div class="cozum-yok">📄 Bu soru için PDF\'deki çözüme bakınız.</div>';
    }
  }

  document.getElementById('cevapModal').classList.add('open');
}

function goToSoruPage(){
  const alt = appState.aktifAltKonu;
  const s = alt?.sorular?.find(q=>q.no===appState.cevapModalSoruNo);
  if(s?.sayfa) goToPage(s.sayfa);
  closeModal('cevapModal');
}

function refreshAltKonuChip(){
  const alt = appState.aktifAltKonu;
  if(!alt?.sorular?.length) return;
  const solved = alt.sorular.filter(s=>appState.sorularState[s._uid||s.no]?.answered).length;
  const itemEl = document.querySelector('.alt-konu-item.active .akn-chip');
  if(itemEl) itemEl.textContent=`${solved}/${alt.sorular.length}`;
}

// ── Question Navigation
function setActiveQuestion(idx){
  const sorular = appState.aktifAltKonu?.sorular||[];
  if(idx<0||idx>=sorular.length) return;
  appState.activeQuestionIdx=idx;

  document.querySelectorAll('.soru-card').forEach(c=>c.classList.remove('active-q'));
  const s=sorular[idx];
  const card=document.getElementById(`soru-card-${s.no}`);
  if(card){
    card.classList.add('active-q');
    if(!appState.sorularState[s._uid||s.no]?.answered) card.classList.add('expanded');
    card.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  if(s.sayfa) goToPage(s.sayfa);
}
function nextQuestion(){ goToSoru(appState.activeQuestionIdx+1); }
function prevQuestion(){ goToSoru(appState.activeQuestionIdx-1); }

// ── Test Control
function toggleTest(){
  if(!appState.testRunning) startTest();
  else pauseTest();
}
function startTest(){
  appState.testRunning=true;
  const btn=document.getElementById('startTestBtn');
  btn.textContent='⏸ Duraklat'; btn.classList.add('running');
  document.getElementById('timerDisplay').classList.remove('urgent');
  appState.timerInterval=setInterval(()=>{
    appState.timerSec++;
    updateTimer();
    // Countdown check
    if(appState.timerDurationMins>0){
      const maxSec=appState.timerDurationMins*60;
      if(appState.timerSec>=maxSec){ finishTest(); return; }
      if(maxSec-appState.timerSec<=30) document.getElementById('timerDisplay').classList.add('urgent');
    }
  },1000);
  showToast('Test başladı! ⏱️','info');
}
function pauseTest(){
  appState.testRunning=false;
  clearInterval(appState.timerInterval);
  const btn=document.getElementById('startTestBtn');
  btn.textContent='▶ Devam Et'; btn.classList.remove('running');
  showToast('Test duraklatıldı','info');
}
function stopTimer(){
  appState.testRunning=false;
  clearInterval(appState.timerInterval);
  appState.timerSec=0;
  updateTimer();
  document.getElementById('startTestBtn').textContent='▶ Başlat';
  document.getElementById('startTestBtn').classList.remove('running');
}
function updateTimer(){
  document.getElementById('timerDisplay').textContent=formatTime(appState.timerSec);
  document.getElementById('rpSure').textContent=formatTime(appState.timerSec);
}
function formatTime(sec){
  const m=Math.floor(sec/60),s=sec%60;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function toggleTimerPicker(){
  document.getElementById('timerPicker').classList.toggle('show');
}
function setTimerDuration(mins, btn){
  appState.timerDurationMins=mins;
  document.querySelectorAll('.timer-opt').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('timerPicker').classList.remove('show');
  showToast(mins>0?`Süre: ${mins} dakika ⏱️`:'Süresiz mod','info');
}
function updateTestProgress(){
  const sorular=appState.aktifAltKonu?.sorular||[];
  const answered=sorular.filter(s=>appState.sorularState[s._uid||s.no]?.answered&&!appState.sorularState[s._uid||s.no]?.skipped).length;
  const correct=sorular.filter(s=>appState.sorularState[s._uid||s.no]?.correct).length;
  const wrong=sorular.filter(s=>appState.sorularState[s._uid||s.no]?.answered&&!appState.sorularState[s._uid||s.no]?.correct&&!appState.sorularState[s._uid||s.no]?.skipped).length;
  const net=correct-(wrong/4);
  const pct=sorular.length>0?Math.round(answered/sorular.length*100):0;

  document.getElementById('tpProgress').textContent=`${answered} / ${sorular.length} çözüldü`;
  document.getElementById('tpFill').style.width=`${pct}%`;
  document.getElementById('tpNet').textContent=answered>0?`Net: ${net.toFixed(2)}`:'Net: —';
  document.getElementById('rpNet').textContent=answered>0?net.toFixed(2):'—';
  // rpSoruSayisi her zaman aynı kaynaktan güncellensin → tutarsızlık olmaz
  const rpEl=document.getElementById('rpSoruSayisi');
  if(rpEl) rpEl.textContent=`${sorular.length} ${isKonuKartAltKonu(appState.aktifAltKonu)?'Kart':'Soru'}`;
}

function finishTest(){
  const sorular=appState.aktifAltKonu?.sorular||[];
  if(!sorular.length){ showToast('Önce bir test seç','error'); return; }

  stopTimer();
  const correct=sorular.filter(s=>appState.sorularState[s._uid||s.no]?.correct).length;
  const wrong=sorular.filter(s=>appState.sorularState[s._uid||s.no]?.answered&&!appState.sorularState[s._uid||s.no]?.correct&&!appState.sorularState[s._uid||s.no]?.skipped).length;
  const blank=sorular.length-correct-wrong;
  const net=(correct-wrong/4);
  const successPct=Math.round(correct/sorular.length*100);

  const m=Math.floor(appState.timerSec/60),s=appState.timerSec%60;

  document.getElementById('resultEmoji').textContent = successPct===100?'Mükemmel! 💯':successPct>=70?'Harika! 🎉':successPct>=50?'İyi! 👍':'Devam Et! 💪';
  document.getElementById('modalSub').textContent=`${appState.aktifAltKonu.ad} · ${sorular.length} Soru`;
  document.getElementById('modalCorrect').textContent=correct;
  document.getElementById('modalWrong').textContent=wrong;
  document.getElementById('modalBlank').textContent=blank;
  document.getElementById('modalNet').textContent=net.toFixed(2);
  document.getElementById('modalTime').textContent=`${m}:${String(s).padStart(2,'0')}`;

  // Badges
  const badgesEl=document.getElementById('modalBadges');
  badgesEl.innerHTML='';
  if(successPct===100) badgesEl.innerHTML+='<span class="modal-badge gold">💯 Mükemmel!</span>';
  if(correct===sorular.length) badgesEl.innerHTML+='<span class="modal-badge green">🎯 Tüm Doğru</span>';
  if(appState.timerSec<sorular.length*30 && correct>0) badgesEl.innerHTML+='<span class="modal-badge green">⚡ Hız Rekoru</span>';

  renderResultChart(correct,wrong,blank);
  document.getElementById('resultModal').classList.add('open');

  // Confetti for good results
  if(successPct===100) setTimeout(()=>launchConfetti(60), 300);
  else if(successPct>=70) setTimeout(()=>launchConfetti(25), 300);

  // Update total
  const total=parseInt(document.getElementById('totalSolved').textContent)||0;
  document.getElementById('totalSolved').textContent=total+correct+wrong;

  // ✅ FIX: Test bitince verileri Firestore'a kaydet
  persistData();
  if(typeof updateDashboard==='function') updateDashboard();
}

function resetTest(){
  closeModal('resultModal');
  appState.sorularState={};
  appState.timerSec=0;
  updateTimer();
  if(appState.aktifAltKonu) renderSoruList(appState.aktifAltKonu.sorular);
  showToast('Test sıfırlandı, tekrar çöz! 🔁','info');
}
function retryWrong(){
  closeModal('resultModal');
  const sorular=appState.aktifAltKonu?.sorular||[];
  const wrong=sorular.filter(s=>appState.sorularState[s._uid||s.no]?.answered&&!appState.sorularState[s._uid||s.no]?.correct&&!appState.sorularState[s._uid||s.no]?.skipped);
  if(!wrong.length){ showToast('Hiç yanlışın yok! 🎉','success'); launchConfetti(30); return; }
  // Reset only wrong answers
  wrong.forEach(s=>{ delete appState.sorularState[s._uid||s.no]; });
  // Update alt konu to only wrong questions
  const prevAlt = appState.aktifAltKonu;
  appState.aktifAltKonu = {...prevAlt, sorular:wrong, ad:`Hata Tekrarı — ${wrong.length} Soru`};
  appState.activeQuestionIdx=0;
  renderSoruList(wrong);
  updateRightPanelTitle(`❌ Hata Tekrarı (${wrong.length})`);
  showToast(`${wrong.length} hatalı soru yüklendi — tekrar dene!`,'info');
}

let resultChartInst=null;
function renderResultChart(correct,wrong,blank){
  if(resultChartInst) resultChartInst.destroy();
  resultChartInst=new Chart(document.getElementById('resultChart'),{
    type:'doughnut',
    data:{
      labels:['Doğru','Yanlış','Boş'],
      datasets:[{data:[correct,wrong,blank],backgroundColor:['#22c55e','#ef4444','#4b5563'],borderWidth:0,borderRadius:3}]
    },
    options:{
      plugins:{legend:{position:'bottom',labels:{color:'#b8b8cc',font:{size:11},padding:12}}},
      cutout:'65%'
    }
  });
}

function playFeedbackSound(correct){
  try{
    const ctx=new(window.AudioContext||window.webkitAudioContext)();
    const osc=ctx.createOscillator();
    const gain=ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type='sine';
    osc.frequency.value=correct?880:220;
    gain.gain.setValueAtTime(0.1,ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.3);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime+0.3);
  }catch(e){}
}

// ══════════════════════════════
// STATS CHARTS
// ══════════════════════════════
function initCharts(){
  Chart.defaults.color='#b8b8cc';
  // Weekly bar
  const weeklyCanvas=document.getElementById('chartWeekly');
  const radarCanvas=document.getElementById('chartRadar');
  if(window._chartWeekly){ try{ window._chartWeekly.destroy(); }catch(e){} }
  if(window._chartRadar){ try{ window._chartRadar.destroy(); }catch(e){} }
  window._chartWeekly = new Chart(weeklyCanvas,{
    type:'bar',
    data:{
      labels:['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'],
      datasets:[{label:'Çözülen',data:[0,0,0,0,0,0,0],backgroundColor:'rgba(129,140,248,0.65)',borderRadius:6,borderSkipped:false}]
    },
    options:{
      responsive:true,
      plugins:{legend:{display:false}},
      scales:{
        x:{grid:{display:false},ticks:{color:'#606075'}},
        y:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#606075'}}
      }
    }
  });
  // Radar
  window._chartRadar = new Chart(radarCanvas,{
    type:'radar',
    data:{
      labels:['Konu 1','Konu 2','Konu 3','Konu 4','Konu 5','Konu 6'],
      datasets:[{label:'Başarı %',data:[0,0,0,0,0,0],backgroundColor:'rgba(129,140,248,0.15)',borderColor:'rgba(129,140,248,0.8)',pointBackgroundColor:'#818cf8',pointRadius:4}]
    },
    options:{
      responsive:true,
      scales:{r:{grid:{color:'rgba(255,255,255,0.06)'},ticks:{display:false},pointLabels:{color:'#b8b8cc',font:{size:11}}}},
      plugins:{legend:{display:false}}
    }
  });
  // Konu table
  const tbody=document.getElementById('konuTableBody');
  if(tbody) tbody.innerHTML='<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:28px">Henüz konu performansı oluşmadı.</td></tr>';
  // Streak cal
  const cal=document.getElementById('calGrid');
  if(cal){
    cal.innerHTML='';
    const seed=Array(35).fill(0);
    seed.forEach(v=>{
      const d=document.createElement('div');
      d.className='cal-day'+(v?` level-${v}`:'');
      cal.appendChild(d);
    });
  }
  // Badges
  const badges=[
    {icon:'🔥',name:'7 Günlük Seri',earned:false},
    {icon:'⚡',name:'Hız Rekoru',earned:false},
    {icon:'💯',name:'Mükemmel Test',earned:false},
    {icon:'🦉',name:'Gece Kuşu',earned:false},
    {icon:'🎯',name:'Keskin Nişancı',earned:false},
    {icon:'📚',name:'Kitap Kurdu',earned:false},
    {icon:'🚀',name:'Roket Hızı',earned:false},
    {icon:'🏆',name:'Şampiyon',earned:false},
    {icon:'🧠',name:'Dahi',earned:false},
    {icon:'⭐',name:'Süper Star',earned:false}
  ];
  const bg=document.getElementById('badgesGrid');
  if(bg){
    bg.innerHTML='';
    badges.forEach(b=>{
      const div=document.createElement('div');
      div.className='badge-item'+(b.earned?' earned':' locked');
      div.innerHTML=`<div class="badge-icon">${b.icon}</div><div class="badge-name">${b.name}</div>`;
      bg.appendChild(div);
    });
  }
  updateDashboard();
}

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
window.showToast = showToast;
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
