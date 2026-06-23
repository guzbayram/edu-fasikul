import { appState } from '../state/appState.js';
import { _getUserKey, scheduleCloudPersist } from '../firebase/firestore.js';

let currentDrawerDers = null;
let allFasikulCards = [];
const FASIKUL_THEME_COLORS = ['#7c73ff','#ec6471','#f59e0b','#22c55e','#14b8a6','#38bdf8','#d946ef'];
let draggedFasikulId = null;
let fasikulWasDragged = false;

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
// GUEST_DEMO_FASIKUL_IDS → window.GUEST_DEMO_FASIKUL_IDS (main.js'de tanımlı)
function isGuestSession(){ return appState.user?.email==='misafir@demo.com'; }
function visibleFasikullerFor(ders){
  return isGuestSession()
    ? (ders.fasikuller||[]).filter(f=>window.GUEST_DEMO_FASIKUL_IDS.has(f.id))
    : (ders.fasikuller||[]);
}
function renderDerslerGrid(){
  const grid = document.getElementById('derslerGrid');
  grid.innerHTML = '';
  const visibleDersler=window.MANIFEST.dersler.filter(d=>visibleFasikullerFor(d).length>0 || !isGuestSession());
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
function openDrawer(e, dersId){
  if(e?.stopPropagation) e.stopPropagation();
  const ders = window.MANIFEST.dersler.find(d=>d.id===dersId);
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
  const ders=window.MANIFEST.dersler.find(d=>d.id===dersId);
  const fas=ders?.fasikuller.find(f=>f.id===fasikulId);
  if(!fas || !FASIKUL_THEME_COLORS.includes(color)) return;
  fas.temaRenk=color;
  persistManifest();
  renderFasikulCards(ders.fasikuller,ders);
  showToast('Fasikül rengi güncellendi','success');
}
function moveFasikul(dersId,fasikulId,direction){
  const ders=window.MANIFEST.dersler.find(d=>d.id===dersId);
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
  const ders=window.MANIFEST.dersler.find(d=>d.id===dersId);
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
  const matDers = window.MANIFEST.dersler.find(d=>d.id==='mat');
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
  window.MANIFEST.dersler.forEach(ders => {
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
  const ders = window.MANIFEST.dersler.find(d => d.id === dersId);
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
  window.DEMO_SNAPSHOT.forEach(sd=>{
    const ders = window.MANIFEST.dersler.find(d=>d.id===sd.id);
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
    const ders = window.MANIFEST.dersler.find(d=>d.id===dersId);
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
    const ders = window.MANIFEST.dersler.find(d=>d.id===editId);
    if(ders){ ders.ad=ad; ders.ikon=ikon; ders.renk=renk; }
    showToast(`${ad} güncellendi ✓`,'success');
  } else {
    const newId = ad.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'') + '-' + Date.now();
    window.MANIFEST.dersler.push({ id:newId, ad, ikon, renk, progPct:0, fasikuller:[] });
    showToast(`${ad} eklendi ✓`,'success');
  }
  persistManifest();
  renderDerslerGrid();
  closeDersModal();
}
function silDers(){
  const editId = document.getElementById('dersEditId').value;
  if(!editId) return;
  const ders = window.MANIFEST.dersler.find(d=>d.id===editId);
  if(!ders) return;
  if(!confirm(`"${ders.ad}" dersini ve tüm fasikülleri silmek istiyor musunuz?`)) return;
  window.MANIFEST.dersler = window.MANIFEST.dersler.filter(d=>d.id!==editId);
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
  for(const source of window.BUNDLED_FASIKUL_SOURCES){
    const cachedPdfFound = cachedKeys.has(`${source.dersId}_${source.id}`)
      || cachedPdfNames.has(normalizePdfFileName(source.pdf));
    const folderPdfFound = hasFolder ? await hasLocalPdfFile(source.pdf) : false;
    const pdfFound = cachedPdfFound || folderPdfFound;
    if(!pdfFound && source.id!==editId) continue;
    const raw=bundledSourceCache.get(source.json) || await readBundledJson(source);
    if(!raw && source.id!==editId) continue;
    const dersAd=window.MANIFEST.dersler.find(d=>d.id===source.dersId)?.ad || source.dersId;
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
  const source=window.BUNDLED_FASIKUL_SOURCES.find(s=>s.id===sourceId);
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
  const source = window.BUNDLED_FASIKUL_SOURCES.find(s=>s.id===sourceId);
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
    const dersIds = [...new Set(window.BUNDLED_FASIKUL_SOURCES.map(s=>s.dersId))];
    dersFilter.innerHTML = '<option value="">Tüm Dersler</option>';
    dersIds.forEach(dId=>{
      const cfg = window.BUNDLED_DERS_CONFIG[dId] || {ad:dId};
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
  for(const source of window.BUNDLED_FASIKUL_SOURCES){
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
    const cfg = window.BUNDLED_DERS_CONFIG[source.dersId] || {ad:source.dersId,ikon:'📚',renk:'var(--mat)'};
    const name = raw?.ad || source.json.replace(/\.json$/,'');
    const sinif = raw?.sinif || '?';
    const soruSayisi = raw?.soruSayisi || 0;
    const konuSayisi = raw?.konular?.length || 0;
    const thumb = raw?.thumb || '📄';

    // Hangi derslerde zaten var?
    const existingDersIds = window.MANIFEST.dersler
      .filter(d => d.fasikuller?.some(f=>f.id===source.id))
      .map(d=>d.id);

    const tagsHtml = existingDersIds.map(dId=>{
      const dc = window.BUNDLED_DERS_CONFIG[dId] || window.MANIFEST.dersler.find(d=>d.id===dId);
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

  window.MANIFEST.dersler.forEach(ders=>{
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
  const source = window.BUNDLED_FASIKUL_SOURCES.find(s=>s.id===sourceId);
  if(!source){ showToast('Kaynak bulunamadı','error'); return; }
  let ders = window.MANIFEST.dersler.find(d=>d.id===dersId);
  if(!ders){ showToast('Ders bulunamadı','error'); return; }
  if(ders.fasikuller.some(f=>f.id===source.id)){ showToast('Zaten ekli','info'); return; }

  const raw = await readBundledJson(source);
  const cfg = window.BUNDLED_DERS_CONFIG[dersId] || {};
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
  const ders = window.MANIFEST.dersler.find(d=>d.id===dersId);
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

// ── Window exports ──
window.renderDate = renderDate;
window.renderMathSymbols = renderMathSymbols;
window.renderStreakDots = renderStreakDots;
window.toggleTheme = toggleTheme;
window.isGuestSession = isGuestSession;
window.visibleFasikullerFor = visibleFasikullerFor;
window.renderDerslerGrid = renderDerslerGrid;
window.openDrawer = openDrawer;
window.closeDrawer = closeDrawer;
window.filterFasikuller = filterFasikuller;
window.renderFasikulCards = renderFasikulCards;
window.setFasikulTheme = setFasikulTheme;
window.moveFasikul = moveFasikul;
window.reorderFasikulByDrop = reorderFasikulByDrop;
window.toggleFasikulMenu = toggleFasikulMenu;
window.openLastFasikul = openLastFasikul;
window.safeDateKey = safeDateKey;
window.getDailyCounts = getDailyCounts;
window.calcCurrentStreak = calcCurrentStreak;
window.updateDashboard = updateDashboard;
window.recalcFasikulProgress = recalcFasikulProgress;
window.resetFasikulData = resetFasikulData;
window.applyDemoStats = applyDemoStats;
window.applyDemoMode = applyDemoMode;
window.toggleDemoData = toggleDemoData;
window.openDersModal = openDersModal;
window.closeDersModal = closeDersModal;
window.selectDersRenk = selectDersRenk;
window.saveDers = saveDers;
window.silDers = silDers;
window.openFasikulModal = openFasikulModal;
window.closeFasikulModal = closeFasikulModal;
window.saveFasikul = saveFasikul;
window.silFasikul = silFasikul;
window.populateFasikulSourceSelect = populateFasikulSourceSelect;
window.applyBundledSourceToForm = applyBundledSourceToForm;
window.openKutuphaneFasikulModal = openKutuphaneFasikulModal;
window.closeKutuphaneFasikulModal = closeKutuphaneFasikulModal;
window.filterKutuphaneFasikuller = filterKutuphaneFasikuller;
window.kutuphaneDersEkle = kutuphaneDersEkle;
window.kutuphaneCikar = kutuphaneCikar;
window.kutuphaneDersSec = kutuphaneDersSec;
window.downloadOrnekJson = downloadOrnekJson;
