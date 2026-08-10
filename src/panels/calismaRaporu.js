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
    if(!ay.haftalar.has(haftaKey)) ay.haftalar.set(haftaKey, {key:haftaKey, label:`${week}. Hafta (${_rpShortDate(monday)} – ${_rpShortDate(sunday)} ${sunday.getFullYear()})`, ts:monday.getTime(), gunler:[], toplam:{soru:0,dogru:0,yanlis:0,bos:0}});
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

function _rpRowsTable(rows, tarihSutunu){
  return `<table class="rapor-table"><thead><tr>
      ${tarihSutunu ? '<th>Tarih</th>' : '<th>Fasikül</th>'}
      <th>Ana Konu</th><th>Alt Konu / Test</th>
      <th class="tc">Soru</th><th class="tc">Doğru</th><th class="tc">Yanlış</th><th class="tc">Boş</th><th class="tc">Net</th><th class="tc">Başarı</th>
    </tr></thead><tbody>
      ${rows.map(s=>{
        const net = _rpNet(s.dogru, s.yanlis), basari = _rpBasari(s.dogru, s.yanlis);
        const ilkSutun = tarihSutunu
          ? _rpEsc(new Date(s.tarih+'T00:00:00').toLocaleDateString('tr-TR',{day:'2-digit',month:'short',year:'numeric'}))
          : `<span class="rapor-tag">${_rpEsc(s.fasikulAd)}</span>`;
        return `<tr>
          <td>${ilkSutun}</td>
          <td>${_rpEsc(s.konu)}</td>
          <td>${_rpEsc(s.altKonu)}</td>
          <td class="tc">${s.soru}</td>
          <td class="tc rp-dogru">${s.dogru}</td>
          <td class="tc rp-yanlis">${s.yanlis}</td>
          <td class="tc rp-bos">${s.bos}</td>
          <td class="tc"><b>${_rpFmtNet(net)}</b></td>
          <td class="tc">${_rpBadge(basari)}</td>
        </tr>`;
      }).join('') || `<tr><td colspan="9" class="rapor-empty-row">Kayıt yok.</td></tr>`}
    </tbody></table>`;
}

// Yıl/Ay/Hafta başlıkları tek satırlık özet gösterir (kompakt); Gün ve
// Fasikül seviyeleri asıl detay katmanı olduğundan tam kutu-grid kalır.
function _rpCompactStatsLine(t){
  const net = _rpNet(t.dogru, t.yanlis);
  return `${t.soru} soru · <b class="rp-dogru">${t.dogru} D</b> / <b class="rp-yanlis">${t.yanlis} Y</b> · <span class="rp-bos">${t.bos} boş</span> · Net <b>${_rpFmtNet(net)}</b>`;
}

function _rpAcc(level, headerHtml, bodyHtml, toplam, open){
  const compact = level === 'year' || level === 'month' || level === 'week';
  return `<div class="rapor-acc rapor-lvl-${level}${open ? '' : ' rapor-collapsed'}">
    <div class="rapor-acc-header rapor-h-${level}" onclick="raporToggleAcc(this)">
      <div class="rapor-acc-title-row">
        ${headerHtml}
        <span class="rapor-toggle-icon">▾</span>
      </div>
      ${compact ? `<div class="rapor-acc-stats-line">${_rpCompactStatsLine(toplam)}</div>` : ''}
    </div>
    ${compact ? '' : _rpSummaryGrid(toplam)}
    <div class="rapor-content-body">${bodyHtml}</div>
  </div>`;
}

function renderRaporHiyerarsi(agac){
  if(!agac.length) return '<div class="rapor-empty">Henüz kayıtlı çalışma yok.</div>';
  return agac.map((yil,yi)=>_rpAcc('year', `<span>📅 ${_rpEsc(yil.label)}</span>`,
    yil.aylar.map((ay,ai)=>_rpAcc('month', `<span>🗓️ ${_rpEsc(ay.label)}</span>`,
      ay.haftalar.map((hafta,hi)=>_rpAcc('week', `<span>📊 ${_rpEsc(hafta.label)}</span>`,
        hafta.gunler.map((gun,gi)=>_rpAcc('day', `<span>📌 ${_rpEsc(_rpDayLabel(gun.gunKey))} — ${gun.satirlar.length} konu/test</span>`,
          _rpRowsTable(gun.satirlar, false), gun.toplam, gi===0 && hi===0 && ai===0 && yi===0
        )).join(''), hafta.toplam, hi===0 && ai===0 && yi===0
      )).join(''), ay.toplam, ai===0 && yi===0
    )).join(''), yil.toplam, yi===0
  )).join('');
}

function renderRaporFasikulOzet(fasikuller){
  if(!fasikuller.length) return '<div class="rapor-empty">Henüz kayıtlı çalışma yok.</div>';
  return fasikuller.map((f,i)=>_rpAcc('fasikul', `<span>📘 ${_rpEsc(f.fasikulAd)}</span>`,
    _rpRowsTable(f.satirlar, true), f.toplam, i===0
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

const _rpState = { real: [], meta: {}, demoOn: false, view: 'hiyerarsi' };

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
      <div class="rapor-view${v==='hiyerarsi'?' active':''}" data-view="hiyerarsi">${renderRaporHiyerarsi(agac)}</div>
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
  modal.classList.add('open');
  _rpRenderBox();
}

function raporToggleDemo(){
  _rpState.demoOn = !_rpState.demoOn;
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
