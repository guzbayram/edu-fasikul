// ── Çalışma ve Performans Raporu ────────────────────────────
// Admin/öğretmenin bir öğrenciyi VE öğrencinin kendi kendini takip
// edebileceği ortak rapor modalı. İki görünüm sunar:
//   1) Zaman Hiyerarşisi: Yıl → Ay → Hafta → Gün → Fasikül/Konu/Test tablosu
//   2) Fasikül Bazlı Özet: her fasikül için tüm zamanlı çözüm geçmişi
// Kaynak veri appState.sorularState (kendi) veya Firestore
// kullanicilar/{uid}/cozumler (yönetilen öğrenci) — alan adları farklı
// olduğundan (correct/skipped vs dogru/atladi) ikisini de kabul eder.

function _rpEsc(t){
  return String(t ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function _rpDogruMu(r){ return r.correct === true || r.dogru === true; }
function _rpBosMu(r){ return !!(r.skipped || r.atladi); }
function _rpNet(dogru, yanlis){ return dogru - yanlis * 0.25; }
function _rpFmtNet(n){ return Number.isInteger(n) ? String(n) : n.toFixed(2); }
function _rpBasari(dogru, yanlis){ const s = dogru + yanlis; return s ? Math.round(dogru / s * 100) : 0; }
function _rpBadge(basari){
  const cls = basari >= 75 ? 'success' : basari >= 50 ? 'warning' : 'danger';
  return `<span class="rapor-badge ${cls}">%${basari}</span>`;
}

// ISO 8601 hafta numarası + o haftanın Pazartesi/Pazar tarihleri.
function _rpWeekInfo(date){
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  const dow = (date.getDay() + 6) % 7;
  const monday = new Date(date); monday.setDate(date.getDate() - dow); monday.setHours(0,0,0,0);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  return { isoYear: d.getUTCFullYear(), week, monday, sunday };
}
function _rpDayLabel(dateKey){
  return new Date(dateKey+'T00:00:00').toLocaleDateString('tr-TR',{day:'2-digit',month:'long',year:'numeric',weekday:'long'});
}
function _rpShortDate(d){
  return d.toLocaleDateString('tr-TR',{day:'2-digit',month:'long'});
}
// Hafta etiketi: aynı ay içindeyse "03-09 Ağustos 2026", ay değişiyorsa
// "29 Temmuz - 04 Ağustos 2026" — hafta numarası/parantez yok, sade tarih aralığı.
function _rpWeekRangeLabel(monday, sunday){
  const gun = d => d.toLocaleDateString('tr-TR',{day:'2-digit'});
  const yil = sunday.getFullYear();
  if(monday.getMonth() === sunday.getMonth()){
    const ay = sunday.toLocaleDateString('tr-TR',{month:'long'});
    return `${gun(monday)}-${gun(sunday)} ${ay} ${yil}`;
  }
  return `${_rpShortDate(monday)} - ${_rpShortDate(sunday)} ${yil}`;
}

// records → gün bazlı gruplar (her günde fasikül+anaKonu+altKonu/test satırları)
function _rpBuildGunler(records){
  const gunler = {};
  (records || []).forEach(r=>{
    if(!r || !r.tarih) return;
    const tarih = new Date(r.tarih);
    if(Number.isNaN(tarih.getTime())) return;
    const gunKey = tarih.toISOString().slice(0,10);
    if(!gunler[gunKey]) gunler[gunKey] = {
      gunKey, ts: new Date(gunKey+'T00:00:00').getTime(),
      satirlar: new Map(), toplam: {soru:0, dogru:0, yanlis:0, bos:0}
    };
    const gun = gunler[gunKey];
    const satirKey = `${r.fasikulId || r.fasikulAd || ''}|${r.konu || ''}|${r.altKonu || ''}`;
    if(!gun.satirlar.has(satirKey)) gun.satirlar.set(satirKey, {
      fasikulAd: r.fasikulAd || r.fasikulId || 'Fasikül',
      konu: r.konu || '—', altKonu: r.altKonu || '—',
      soru:0, dogru:0, yanlis:0, bos:0, ilkTs: tarih.getTime()
    });
    const s = gun.satirlar.get(satirKey);
    s.soru++; gun.toplam.soru++;
    if(_rpBosMu(r)){ s.bos++; gun.toplam.bos++; }
    else if(_rpDogruMu(r)){ s.dogru++; gun.toplam.dogru++; }
    else { s.yanlis++; gun.toplam.yanlis++; }
    if(tarih.getTime() < s.ilkTs) s.ilkTs = tarih.getTime();
  });
  return Object.values(gunler).sort((a,b)=>b.ts-a.ts).map(g=>({
    ...g, satirlar: [...g.satirlar.values()].sort((a,b)=>a.ilkTs-b.ilkTs)
  }));
}

function _rpMergeToplam(hedef, kaynak){
  hedef.soru += kaynak.soru; hedef.dogru += kaynak.dogru;
  hedef.yanlis += kaynak.yanlis; hedef.bos += kaynak.bos;
}

// Gün gruplarını Yıl → Ay → Hafta → Gün ağacına sarar.
function buildRaporAgaci(records){
  const gunler = _rpBuildGunler(records);
  const yillar = new Map();
  gunler.forEach(g=>{
    const d = new Date(g.gunKey+'T00:00:00');
    const {isoYear, week, monday, sunday} = _rpWeekInfo(d);
    const yilKey = String(d.getFullYear());
    const ayKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const haftaKey = `${isoYear}-W${String(week).padStart(2,'0')}`;
    if(!yillar.has(yilKey)) yillar.set(yilKey, {key:yilKey, label:`${yilKey} Yılı`, ts:d.getFullYear(), aylar:new Map(), toplam:{soru:0,dogru:0,yanlis:0,bos:0}});
    const yil = yillar.get(yilKey);
    if(!yil.aylar.has(ayKey)) yil.aylar.set(ayKey, {key:ayKey, label:d.toLocaleDateString('tr-TR',{month:'long',year:'numeric'}), ts:d.getFullYear()*100+d.getMonth(), haftalar:new Map(), toplam:{soru:0,dogru:0,yanlis:0,bos:0}});
    const ay = yil.aylar.get(ayKey);
    if(!ay.haftalar.has(haftaKey)) ay.haftalar.set(haftaKey, {key:haftaKey, label:_rpWeekRangeLabel(monday, sunday), ts:monday.getTime(), gunler:[], toplam:{soru:0,dogru:0,yanlis:0,bos:0}});
    const hafta = ay.haftalar.get(haftaKey);
    hafta.gunler.push(g);
    _rpMergeToplam(yil.toplam, g.toplam);
    _rpMergeToplam(ay.toplam, g.toplam);
    _rpMergeToplam(hafta.toplam, g.toplam);
  });
  return [...yillar.values()].sort((a,b)=>b.ts-a.ts).map(yil=>({
    ...yil,
    aylar: [...yil.aylar.values()].sort((a,b)=>b.ts-a.ts).map(ay=>({
      ...ay,
      haftalar: [...ay.haftalar.values()].sort((a,b)=>b.ts-a.ts).map(hafta=>({
        ...hafta, gunler: hafta.gunler.slice().sort((a,b)=>b.ts-a.ts)
      }))
    }))
  }));
}

// records → fasikül bazlı, her satır bir (gün×anaKonu×altKonu) çözümü.
function buildRaporFasikulOzet(records){
  const fasikuller = new Map();
  (records || []).forEach(r=>{
    if(!r || !r.tarih) return;
    const tarih = new Date(r.tarih);
    if(Number.isNaN(tarih.getTime())) return;
    const gunKey = tarih.toISOString().slice(0,10);
    const fasKey = r.fasikulId || r.fasikulAd || 'fasikul';
    if(!fasikuller.has(fasKey)) fasikuller.set(fasKey, {
      fasikulAd: r.fasikulAd || r.fasikulId || 'Fasikül',
      satirlar: new Map(), toplam:{soru:0,dogru:0,yanlis:0,bos:0}, sonTs:0
    });
    const fas = fasikuller.get(fasKey);
    const satirKey = `${gunKey}|${r.konu||''}|${r.altKonu||''}`;
    if(!fas.satirlar.has(satirKey)) fas.satirlar.set(satirKey, {
      tarih: gunKey, ts: tarih.getTime(), konu: r.konu || '—', altKonu: r.altKonu || '—',
      soru:0, dogru:0, yanlis:0, bos:0
    });
    const s = fas.satirlar.get(satirKey);
    s.soru++; fas.toplam.soru++;
    if(_rpBosMu(r)){ s.bos++; fas.toplam.bos++; }
    else if(_rpDogruMu(r)){ s.dogru++; fas.toplam.dogru++; }
    else { s.yanlis++; fas.toplam.yanlis++; }
    if(tarih.getTime() > fas.sonTs) fas.sonTs = tarih.getTime();
  });
  return [...fasikuller.values()].sort((a,b)=>b.sonTs-a.sonTs).map(f=>({
    ...f, satirlar: [...f.satirlar.values()].sort((a,b)=>b.ts-a.ts)
  }));
}

function _rpSummaryGrid(t){
  const net = _rpNet(t.dogru, t.yanlis);
  return `<div class="rapor-summary-grid">
    <div class="rapor-summary-box"><span class="label">Toplam Soru</span><span class="val">${t.soru}</span></div>
    <div class="rapor-summary-box"><span class="label">Doğru / Yanlış</span><span class="val"><b class="rp-dogru">${t.dogru} D</b> / <b class="rp-yanlis">${t.yanlis} Y</b></span></div>
    <div class="rapor-summary-box"><span class="label">Boş</span><span class="val rp-bos">${t.bos}</span></div>
    <div class="rapor-summary-box"><span class="label">Net</span><span class="val">${_rpFmtNet(net)}</span></div>
  </div>`;
}

// Geniş tablo yerine dikey kartlar — modal genişliği ne olursa olsun
// yatay scroll gerekmeden tüm veri (fasikül/tarih, konu, soru/doğru/
// yanlış/boş/net/başarı) okunabilsin diye iki satıra bölünmüş kart.
function _rpRowsCards(rows, tarihSutunu){
  if(!rows.length) return '<div class="rapor-empty-row">Kayıt yok.</div>';
  return `<div class="rapor-satir-list">${rows.map(s=>{
    const net = _rpNet(s.dogru, s.yanlis), basari = _rpBasari(s.dogru, s.yanlis);
    const ustEtiket = tarihSutunu
      ? `<span class="rapor-tag rapor-tag-tarih">${_rpEsc(new Date(s.tarih+'T00:00:00').toLocaleDateString('tr-TR',{day:'2-digit',month:'short',year:'numeric'}))}</span>`
      : `<span class="rapor-tag">${_rpEsc(s.fasikulAd)}</span>`;
    return `<div class="rapor-satir-card">
      <div class="rapor-satir-top">
        ${ustEtiket}
        <span class="rapor-satir-konu">${_rpEsc(s.konu)} <span class="ok">›</span> ${_rpEsc(s.altKonu)}</span>
      </div>
      <div class="rapor-satir-stats">
        ${s.soru} soru · <b class="rp-dogru">${s.dogru} D</b> / <b class="rp-yanlis">${s.yanlis} Y</b> · <span class="rp-bos">${s.bos} boş</span> · Net <b>${_rpFmtNet(net)}</b> · ${_rpBadge(basari)}
      </div>
    </div>`;
  }).join('')}</div>`;
}

// Yıl/Ay/Hafta/Gün başlıkları tek satırlık kompakt özet gösterir; yalnızca
// Fasikül Bazlı Özet görünümündeki fasikül kartları tam kutu-grid kullanır.
function _rpCompactStatsLine(t){
  const net = _rpNet(t.dogru, t.yanlis);
  return `${t.soru} soru · <b class="rp-dogru">${t.dogru} D</b> / <b class="rp-yanlis">${t.yanlis} Y</b> · <span class="rp-bos">${t.bos} boş</span> · Net <b>${_rpFmtNet(net)}</b>`;
}

function _rpAcc(level, headerHtml, bodyHtml, toplam, open, statsPrefix){
  const compact = level !== 'fasikul';
  const stats = statsPrefix ? `${statsPrefix} · ${_rpCompactStatsLine(toplam)}` : _rpCompactStatsLine(toplam);
  return `<div class="rapor-acc rapor-lvl-${level}${open ? '' : ' rapor-collapsed'}">
    <div class="rapor-acc-header rapor-h-${level}" onclick="raporToggleAcc(this)">
      <div class="rapor-acc-title-row">
        ${headerHtml}
        <span class="rapor-toggle-icon">▾</span>
      </div>
      ${compact ? `<div class="rapor-acc-stats-line">${stats}</div>` : ''}
    </div>
    ${compact ? '' : _rpSummaryGrid(toplam)}
    <div class="rapor-content-body">${bodyHtml}</div>
  </div>`;
}

// Zaman Hiyerarşisi artık iç içe/girintili akordeon değil, tek seferde tek
// seviye gösteren bir sürükle-tıkla (drill-down) liste: Yıl seçilince sadece
// o yılın ayları, ay seçilince sadece o ayın haftaları, hafta seçilince
// sadece o haftanın günleri ekranda kalır; "← Geri" ile bir üst seviyeye
// dönülür. Navigasyon durumu _rpState.nav'da tutulur.
function _rpNavItem(level, icon, label, toplam, onclick){
  return `<div class="rapor-nav-item rapor-h-${level}" onclick="${onclick}">
    <div class="rapor-acc-title-row"><span>${icon} ${_rpEsc(label)}</span><span class="rapor-nav-chevron">›</span></div>
    <div class="rapor-acc-stats-line">${_rpCompactStatsLine(toplam)}</div>
  </div>`;
}

function renderRaporNav(agac){
  if(!agac.length) return '<div class="rapor-empty">Henüz kayıtlı çalışma yok.</div>';
  const nav = _rpState.nav;
  const yil = nav.yil ? agac.find(y=>y.key===nav.yil) : null;
  const ay = yil && nav.ay ? yil.aylar.find(a=>a.key===nav.ay) : null;
  const hafta = ay && nav.hafta ? ay.haftalar.find(h=>h.key===nav.hafta) : null;

  // Demo aç/kapa gibi veri değişimlerinde eski yol artık yoksa en başa dön.
  let level = nav.level;
  if(level !== 'year' && !yil) level = 'year';
  else if(level === 'week' && !ay) level = 'month';
  else if(level === 'day' && !hafta) level = 'week';

  const crumbs = [yil, ay, hafta].filter(Boolean).map(n=>n.label);
  const backBtn = level !== 'year' ? `<button class="rapor-nav-back" onclick="raporNavBack()">← Geri</button>` : '';
  const crumbEl = crumbs.length ? `<span class="rapor-nav-path">${crumbs.map(_rpEsc).join(' › ')}</span>` : '';
  const crumbBar = (backBtn || crumbEl) ? `<div class="rapor-nav-crumbs">${backBtn}${crumbEl}</div>` : '';

  let listHtml;
  if(level === 'year'){
    listHtml = agac.map(y=>_rpNavItem('year','📅',y.label,y.toplam,`raporNavGoto('month','${y.key}')`)).join('');
  } else if(level === 'month'){
    listHtml = yil.aylar.map(a=>_rpNavItem('month','🗓️',a.label,a.toplam,`raporNavGoto('week','${yil.key}','${a.key}')`)).join('');
  } else if(level === 'week'){
    listHtml = ay.haftalar.map(h=>_rpNavItem('week','📊',h.label,h.toplam,`raporNavGoto('day','${yil.key}','${ay.key}','${h.key}')`)).join('');
  } else {
    listHtml = hafta.gunler.map(g=>`<div class="rapor-nav-day rapor-h-day">
      <div class="rapor-acc-title-row"><span>📌 ${_rpEsc(_rpDayLabel(g.gunKey))}</span></div>
      <div class="rapor-acc-stats-line">${g.satirlar.length} konu/test · ${_rpCompactStatsLine(g.toplam)}</div>
      ${_rpRowsCards(g.satirlar, false)}
    </div>`).join('');
  }

  return `<div class="rapor-nav">${crumbBar}<div class="rapor-nav-list">${listHtml}</div></div>`;
}

function raporNavGoto(level, yilKey, ayKey, haftaKey){
  _rpState.nav = { level, yil: yilKey || null, ay: ayKey || null, hafta: haftaKey || null };
  _rpRenderBox();
}

function raporNavBack(){
  const nav = _rpState.nav;
  if(nav.level === 'day') _rpState.nav = { level:'week', yil:nav.yil, ay:nav.ay, hafta:null };
  else if(nav.level === 'week') _rpState.nav = { level:'month', yil:nav.yil, ay:null, hafta:null };
  else if(nav.level === 'month') _rpState.nav = { level:'year', yil:null, ay:null, hafta:null };
  _rpRenderBox();
}

function renderRaporFasikulOzet(fasikuller){
  if(!fasikuller.length) return '<div class="rapor-empty">Henüz kayıtlı çalışma yok.</div>';
  return fasikuller.map((f,i)=>_rpAcc('fasikul', `<span>📘 ${_rpEsc(f.fasikulAd)}</span>`,
    _rpRowsCards(f.satirlar, true), f.toplam, i===0
  )).join('');
}

// Basit deterministik sözde-rastgele üretici (Math.random yerine) —
// demo verisi her açılışta aynı görünsün diye tohumlu.
function _rpSeededRandom(seed){
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

// "🧪 Demo" açıkken gösterilecek örnek çalışma geçmişi — son ~10 hafta,
// birden fazla fasikül/konu/test, gerçekçi doğru/yanlış/boş dağılımıyla.
function _rpGenerateDemoData(){
  const fasikuller = [
    {id:'demo-ucgen2', ad:'Üçgen Akademi-2', konular:[
      {konu:'Üçgenler', testler:['Pekiştirelim-1','Pekiştirelim-2','Bölüm Değerlendirme']},
      {konu:'Açılar', testler:['Test-1','Test-2']},
    ]},
    {id:'demo-yaricap-problem', ad:'Yarıçap TYT Problemler', konular:[
      {konu:'Oran-Orantı', testler:['Öğrenme Kanıtları-1','Öğrenme Kanıtları-2']},
      {konu:'Sayılar', testler:['Pekiştirelim-1']},
    ]},
    {id:'demo-mof9-1', ad:'Möf 9.Sınıf Matematik-1', konular:[
      {konu:'Sayılar', testler:['Test-1','Test-2']},
    ]},
    {id:'demo-aktif-tyt1', ad:'Aktif TYT Matematik-1', konular:[
      {konu:'Kümeler', testler:['Test-1','Test-2']},
      {konu:'Fonksiyonlar', testler:['Test-1']},
    ]},
  ];
  const rand = _rpSeededRandom(42);
  const records = [];
  const now = new Date();
  for(let dayOffset=0; dayOffset<70; dayOffset++){
    if(rand() > 0.42) continue; // her gün çalışılmamış olsun
    const blokSayisi = 1 + Math.floor(rand()*3);
    for(let b=0; b<blokSayisi; b++){
      const fas = fasikuller[Math.floor(rand()*fasikuller.length)];
      const konuBlok = fas.konular[Math.floor(rand()*fas.konular.length)];
      const test = konuBlok.testler[Math.floor(rand()*konuBlok.testler.length)];
      const soruSayisi = 5 + Math.floor(rand()*16);
      const baseHour = 15 + Math.floor(rand()*7);
      for(let q=0; q<soruSayisi; q++){
        const d = new Date(now);
        d.setDate(d.getDate()-dayOffset);
        d.setHours(baseHour, Math.min(59, q*2), 0, 0);
        const r = rand();
        records.push({
          tarih: d.toISOString(),
          fasikulId: fas.id, fasikulAd: fas.ad,
          konu: konuBlok.konu, altKonu: test,
          correct: r < 0.68, skipped: r >= 0.68 && r < 0.8
        });
      }
    }
  }
  return records;
}

const _rpState = { real: [], meta: {}, demoOn: false, view: 'hiyerarsi', nav: { level:'year', yil:null, ay:null, hafta:null } };

function _rpActiveRecords(){
  return _rpState.demoOn ? _rpGenerateDemoData() : _rpState.real;
}

function _rpRenderBox(){
  const box = document.getElementById('calismaRaporBox');
  if(!box) return;
  const list = _rpActiveRecords();
  if(!list.length && !_rpState.demoOn){
    window.showToast?.('Bu kişi için henüz çözüm kaydı yok.', 'info');
  }
  const agac = buildRaporAgaci(list);
  const fasOzet = buildRaporFasikulOzet(list);
  const meta = _rpState.meta;
  const v = _rpState.view;
  box.innerHTML = `
    <div class="rapor-head">
      <div class="rapor-head-text">
        <h2>📊 Çalışma ve Performans Raporu</h2>
        <p class="rapor-sub">${_rpEsc(meta.name || '')}${meta.altBaslik ? ' · ' + _rpEsc(meta.altBaslik) : ''}</p>
      </div>
      <div class="rapor-head-actions">
        <button class="rapor-demo-btn${_rpState.demoOn ? ' on' : ''}" onclick="raporToggleDemo()" title="Örnek/demo veri ile önizle">🧪 Demo${_rpState.demoOn ? ' Açık' : ''}</button>
        <button class="rapor-close-btn" onclick="closeModal('calismaRaporModal')" title="Kapat">✕</button>
      </div>
    </div>
    ${_rpState.demoOn ? '<div class="rapor-demo-banner">🧪 Demo verileri gösteriliyor — bunlar gerçek çalışma kaydı değildir. Kapatınca gerçek veriler geri gelir.</div>' : ''}
    <div class="rapor-tabs">
      <button class="rapor-tab-btn${v==='hiyerarsi'?' active':''}" data-view="hiyerarsi" onclick="raporSwitchView('hiyerarsi')">🗓️ Zaman Hiyerarşisi</button>
      <button class="rapor-tab-btn${v==='fasikul'?' active':''}" data-view="fasikul" onclick="raporSwitchView('fasikul')">📘 Fasikül Bazlı Özet</button>
    </div>
    <div class="rapor-body">
      <div class="rapor-view${v==='hiyerarsi'?' active':''}" data-view="hiyerarsi">${renderRaporNav(agac)}</div>
      <div class="rapor-view${v==='fasikul'?' active':''}" data-view="fasikul">${renderRaporFasikulOzet(fasOzet)}</div>
    </div>`;
}

function openCalismaRaporu(records, meta={}){
  const modal = document.getElementById('calismaRaporModal');
  if(!modal) return;
  _rpState.real = records || [];
  _rpState.meta = meta || {};
  _rpState.demoOn = false;
  _rpState.view = 'hiyerarsi';
  _rpState.nav = { level:'year', yil:null, ay:null, hafta:null };
  modal.classList.add('open');
  _rpRenderBox();
}

function raporToggleDemo(){
  _rpState.demoOn = !_rpState.demoOn;
  _rpState.nav = { level:'year', yil:null, ay:null, hafta:null };
  _rpRenderBox();
}

function raporSwitchView(name){
  _rpState.view = name;
  document.querySelectorAll('#calismaRaporBox .rapor-tab-btn').forEach(b=>b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('#calismaRaporBox .rapor-view').forEach(v=>v.classList.toggle('active', v.dataset.view === name));
}

function raporToggleAcc(headerEl){
  headerEl.parentElement.classList.toggle('rapor-collapsed');
}

window.openCalismaRaporu = openCalismaRaporu;
window.raporToggleDemo = raporToggleDemo;
window.raporSwitchView = raporSwitchView;
window.raporToggleAcc = raporToggleAcc;
window.raporNavGoto = raporNavGoto;
window.raporNavBack = raporNavBack;
