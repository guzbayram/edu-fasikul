// ── Çalışma ve Performans Raporu ────────────────────────────
// Admin/öğretmenin bir öğrenciyi VE öğrencinin kendi kendini takip
// edebileceği ortak rapor modalı. İki görünüm sunar:
//   1) Zaman Hiyerarşisi: Yıl → Ay → Hafta → Gün → Fasikül/Konu/Test tablosu
//   2) Fasikül Bazlı Özet: her fasikül için tüm zamanlı çözüm geçmişi
// Kaynak veri appState.sorularState (kendi) veya Firestore
// kullanicilar/{uid}/cozumler (yönetilen öğrenci) — alan adları farklı
// olduğundan (correct/skipped vs dogru/atladi) ikisini de kabul eder.
import { appState } from '../state/appState.js';

function _rpEsc(t){
  return String(t ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
// onclick="fn('...')" içine gömülen değerler için: önce HTML-özel
// karakterler (attribute güvenliği), sonra \ ve ' JS string-escape edilir
// (HTML-entity DEĞİL — aksi halde tarayıcı decode edince JS string'i kırar).
function _rpJsStr(t){
  return String(t ?? '')
    .replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\\/g,'\\\\').replace(/'/g,"\\'");
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

// tarih alanı new Date().toISOString() ile (UTC an) kaydediliyor. toISOString()
// ile geri dilimlemek UTC takvim gününü verir — TR (UTC+3) yerel saatle 00:00-02:59
// arası kaydedilen çözümler yanlışlıkla BİR ÖNCEKİ güne düşer. Rapor kullanıcının
// yerel takvim gününü göstermeli, bu yüzden getFullYear/Month/Date (yerel) kullan.
function _rpLocalDayKey(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// records → gün bazlı gruplar (her günde fasikül+anaKonu+altKonu/test satırları)
function _rpBuildGunler(records){
  const gunler = {};
  (records || []).forEach(r=>{
    if(!r || !r.tarih) return;
    const tarih = new Date(r.tarih);
    if(Number.isNaN(tarih.getTime())) return;
    const gunKey = _rpLocalDayKey(tarih);
    if(!gunler[gunKey]) gunler[gunKey] = {
      gunKey, ts: new Date(gunKey+'T00:00:00').getTime(),
      satirlar: new Map(), toplam: {soru:0, dogru:0, yanlis:0, bos:0}
    };
    const gun = gunler[gunKey];
    const satirKey = `${r.fasikulId || r.fasikulAd || ''}|${r.konu || ''}|${r.altKonu || ''}`;
    if(!gun.satirlar.has(satirKey)) gun.satirlar.set(satirKey, {
      fasikulAd: r.fasikulAd || r.fasikulId || 'Fasikül',
      fasikulId: r.fasikulId || '', dersId: r.dersId || '',
      konu: r.konu || '—', altKonu: r.altKonu || '—', tarih: gunKey,
      soru:0, dogru:0, yanlis:0, bos:0, ilkTs: tarih.getTime(), kayitlar: []
    });
    const s = gun.satirlar.get(satirKey);
    s.soru++; gun.toplam.soru++;
    const dogruMu = _rpDogruMu(r), bosMu = _rpBosMu(r);
    if(bosMu){ s.bos++; gun.toplam.bos++; }
    else if(dogruMu){ s.dogru++; gun.toplam.dogru++; }
    else { s.yanlis++; gun.toplam.yanlis++; }
    s.kayitlar.push({ts: tarih.getTime(), dogru: dogruMu, bos: bosMu});
    if(tarih.getTime() < s.ilkTs) s.ilkTs = tarih.getTime();
  });
  return Object.values(gunler).sort((a,b)=>b.ts-a.ts).map(g=>({
    ...g, satirlar: [...g.satirlar.values()]
      .map(s=>({...s, kayitlar: s.kayitlar.slice().sort((a,b)=>a.ts-b.ts)}))
      .sort((a,b)=>a.ilkTs-b.ilkTs)
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
    const gunKey = _rpLocalDayKey(tarih);
    const fasKey = r.fasikulId || r.fasikulAd || 'fasikul';
    if(!fasikuller.has(fasKey)) fasikuller.set(fasKey, {
      fasikulAd: r.fasikulAd || r.fasikulId || 'Fasikül',
      fasikulId: r.fasikulId || '', dersId: r.dersId || '',
      satirlar: new Map(), toplam:{soru:0,dogru:0,yanlis:0,bos:0}, sonTs:0
    });
    const fas = fasikuller.get(fasKey);
    const satirKey = `${gunKey}|${r.konu||''}|${r.altKonu||''}`;
    if(!fas.satirlar.has(satirKey)) fas.satirlar.set(satirKey, {
      tarih: gunKey, ts: tarih.getTime(), konu: r.konu || '—', altKonu: r.altKonu || '—',
      fasikulAd: r.fasikulAd || r.fasikulId || 'Fasikül',
      fasikulId: r.fasikulId || '', dersId: r.dersId || '',
      soru:0, dogru:0, yanlis:0, bos:0, kayitlar: []
    });
    const s = fas.satirlar.get(satirKey);
    s.soru++; fas.toplam.soru++;
    const dogruMu = _rpDogruMu(r), bosMu = _rpBosMu(r);
    if(bosMu){ s.bos++; fas.toplam.bos++; }
    else if(dogruMu){ s.dogru++; fas.toplam.dogru++; }
    else { s.yanlis++; fas.toplam.yanlis++; }
    s.kayitlar.push({ts: tarih.getTime(), dogru: dogruMu, bos: bosMu});
    if(tarih.getTime() > fas.sonTs) fas.sonTs = tarih.getTime();
  });
  return [...fasikuller.values()].sort((a,b)=>b.sonTs-a.sonTs).map(f=>({
    ...f, satirlar: [...f.satirlar.values()]
      .map(s=>({...s, kayitlar: s.kayitlar.slice().sort((a,b)=>a.ts-b.ts)}))
      .sort((a,b)=>b.ts-a.ts)
  }));
}

// Aynı test (fasikül+konu+altKonu), gösterilen günün DIŞINDA başka hangi
// günlerde de çözülmüş — bir günün kartı testin sadece bir kısmını gösteriyor
// olabilir (öğrenci aynı teste birden fazla günde devam etmiş olabilir).
function _rpOtherGunlerForTest(fasikulId, konu, altKonu, excludeGunKey){
  const gunler = new Map();
  _rpActiveRecords().forEach(r=>{
    if(!r || !r.tarih) return;
    if((r.fasikulId || '') !== (fasikulId || '')) return;
    if((r.konu || '') !== (konu || '')) return;
    if((r.altKonu || '') !== (altKonu || '')) return;
    const tarih = new Date(r.tarih);
    if(Number.isNaN(tarih.getTime())) return;
    const gunKey = _rpLocalDayKey(tarih);
    if(gunKey === excludeGunKey) return;
    if(!gunler.has(gunKey)) gunler.set(gunKey, {gunKey, soru:0, dogru:0, yanlis:0, bos:0});
    const g = gunler.get(gunKey);
    g.soru++;
    if(_rpBosMu(r)) g.bos++;
    else if(_rpDogruMu(r)) g.dogru++;
    else g.yanlis++;
  });
  return [...gunler.values()].sort((a,b)=>b.gunKey.localeCompare(a.gunKey));
}

// Bir testin (altKonu) MANIFEST'teki gerçek toplam soru sayısı — kayıt
// sayısı (öğrencinin o güne kadar çözdüğü) ile karıştırılmasın diye
// "N T / M Ç" (Toplam/Çözülen) biçiminde göstermek için. Bulunamazsa null.
function _rpTotalSoru(fasikulId, altKonuAd){
  if(!fasikulId || !altKonuAd) return null;
  for(const ders of (window.MANIFEST?.dersler || [])){
    const fas = ders.fasikuller?.find(f => f.id === fasikulId);
    if(!fas) continue;
    for(const konu of (fas.konular || [])){
      const alt = (konu.altKonular || []).find(a => a.ad === altKonuAd);
      if(alt) return Array.isArray(alt.sorular) ? alt.sorular.length : null;
    }
    return null;
  }
  return null;
}

// Bir testin (altKonu) MANIFEST'teki başlangıç sayfa numarası — kart
// üzerinde "Konu Testi-18 › Konu Testi-18" satırının sağına "s.76" olarak
// eklenir, öğretmen/admin fasikülde testin nerede başladığını rapor
// ekranından (fasikülü açmadan) görebilsin diye.
function _rpAltKonuSayfa(fasikulId, altKonuAd){
  if(!fasikulId || !altKonuAd) return null;
  for(const ders of (window.MANIFEST?.dersler || [])){
    const fas = ders.fasikuller?.find(f => f.id === fasikulId);
    if(!fas) continue;
    for(const konu of (fas.konular || [])){
      const alt = (konu.altKonular || []).find(a => a.ad === altKonuAd);
      if(alt) return alt.sayfa || null;
    }
    return null;
  }
  return null;
}

// Bir fasikülün MANIFEST'teki TÜM testlerinin toplam soru sayısı — Fasikül
// Bazlı Özet başlığında da aynı "N T / M Ç" biçimini kullanmak için
// (_rpTotalSoru tek bir test/altKonu içindi, bu fasikülün tamamını toplar).
function _rpFasikulTotalSoru(fasikulId){
  if(!fasikulId) return null;
  for(const ders of (window.MANIFEST?.dersler || [])){
    const fas = ders.fasikuller?.find(f => f.id === fasikulId);
    if(!fas) continue;
    let total = 0;
    (fas.konular || []).forEach(k => (k.altKonular || []).forEach(a => {
      total += Array.isArray(a.sorular) ? a.sorular.length : 0;
    }));
    return total;
  }
  return null;
}

// Geniş tablo yerine dikey kartlar — modal genişliği ne olursa olsun
// yatay scroll gerekmeden tüm veri (fasikül/tarih, konu, soru/doğru/
// yanlış/boş/net/başarı) okunabilsin diye iki satıra bölünmüş kart.
// Fasikül id'si bilinen satırlar tıklanabilir: ilgili fasikülü o testin
// başladığı sayfada açar (öğretmen için — çözümü/çizimi PDF üzerinde görsün).
function _rpRowsCards(rows, tarihSutunu){
  if(!rows.length) return '<div class="rapor-empty-row">Kayıt yok.</div>';
  return `<div class="rapor-satir-list">${rows.map(s=>{
    const net = _rpNet(s.dogru, s.yanlis), basari = _rpBasari(s.dogru, s.yanlis);
    const ustEtiket = tarihSutunu
      ? `<span class="rapor-tag rapor-tag-tarih">${_rpEsc(new Date(s.tarih+'T00:00:00').toLocaleDateString('tr-TR',{day:'2-digit',month:'short',year:'numeric'}))}</span>`
      : `<span class="rapor-tag">${_rpEsc(s.fasikulAd)}</span>`;
    const acilabilir = !!s.fasikulId;
    const onclick = acilabilir
      ? ` onclick="raporOpenSatir('${_rpJsStr(s.dersId)}','${_rpJsStr(s.fasikulId)}','${_rpJsStr(s.konu)}','${_rpJsStr(s.altKonu)}')"`
      : '';
    const toplamSoru = _rpTotalSoru(s.fasikulId, s.altKonu);
    const soruEtiket = toplamSoru ? `${toplamSoru} T / ${s.soru} Ç` : `${s.soru} soru`;
    const konuTam = `${s.konu} › ${s.altKonu}`;
    const baslangicSayfa = _rpAltKonuSayfa(s.fasikulId, s.altKonu);
    const sayfaEtiket = baslangicSayfa ? ` <span class="rapor-satir-sayfa">s.${baslangicSayfa}</span>` : '';

    const digerGunSayisi = s.fasikulId ? _rpOtherGunlerForTest(s.fasikulId, s.konu, s.altKonu, s.tarih).length : 0;
    const cokGunluEtiket = digerGunSayisi
      ? ` · <span class="rapor-satir-cokgun" title="Bu test, gösterilen günün dışında ${digerGunSayisi} farklı günde daha çözülmüş">📆 +${digerGunSayisi} gün</span>` : '';

    const detayIdx = _rpDetailStore.push({
      fasikulAd: s.fasikulAd, fasikulId: s.fasikulId, dersId: s.dersId,
      konu: s.konu, altKonu: s.altKonu, tarih: s.tarih, kayitlar: s.kayitlar || []
    }) - 1;

    return `<div class="rapor-satir-card${acilabilir ? ' tiklanabilir' : ''}"${onclick}>
      <div class="rapor-satir-top">
        ${ustEtiket}
        <span class="rapor-satir-icons">
          <span class="rapor-satir-saat" title="Bu testin cevaplanma saatlerini gör" onclick="event.stopPropagation();raporGosterZamanDamgalari(${detayIdx})">🕐</span>
          ${acilabilir ? '<span class="rapor-satir-ac" title="Fasikülde bu testi aç">📄</span>' : ''}
        </span>
      </div>
      <div class="rapor-satir-konu" title="${_rpEsc(konuTam)}">${_rpEsc(s.konu)} <span class="ok">›</span> ${_rpEsc(s.altKonu)}${sayfaEtiket}</div>
      <div class="rapor-satir-stats">
        ${soruEtiket} · <b class="rp-dogru">${s.dogru} D</b> / <b class="rp-yanlis">${s.yanlis} Y</b> · <span class="rp-bos">${s.bos} boş</span> · Net <b>${_rpFmtNet(net)}</b> · ${_rpBadge(basari)}${cokGunluEtiket}
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

// statsHtml: satır kartlarıyla (_rpRowsCards) aynı görünümde hazır HTML —
// çağıran taraf oluşturur (bkz. renderRaporFasikulOzet), böylece fasikül
// başlığı da testlerdeki "N T / M Ç · D/Y · boş · Net · %" biçimini kullanır.
function _rpAcc(level, headerHtml, bodyHtml, statsHtml, open){
  return `<div class="rapor-acc rapor-lvl-${level}${open ? '' : ' rapor-collapsed'}">
    <div class="rapor-acc-header rapor-h-${level}" onclick="raporToggleAcc(this)">
      <div class="rapor-acc-title-row">
        ${headerHtml}
        <span class="rapor-toggle-icon">▾</span>
      </div>
      <div class="rapor-acc-stats-line">${statsHtml}</div>
    </div>
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
    // Günler varsayılan olarak KAPALI gelir — kullanıcı istediği günü
    // başlığına tıklayıp açar (bir haftanın tüm günlerini birden açık
    // göstermek, çok test çözülen haftalarda listeyi çok uzatıyordu).
    listHtml = hafta.gunler.map(g=>{
      const statsHtml = `${g.satirlar.length} konu/test · ${_rpCompactStatsLine(g.toplam)}`;
      return _rpAcc('day', `<span>📌 ${_rpEsc(_rpDayLabel(g.gunKey))}</span>`, _rpRowsCards(g.satirlar, false), statsHtml, false);
    }).join('');
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

// Bir konu/test kartına tıklanınca: fasikülü aç (yönetilen öğrenci raporuysa
// öğretmenin salt-okunur inceleme modunda, kendi raporuysa normal okuyucuda)
// ve o testin başladığı sayfaya git — öğretmen çözümü/çizimi PDF'te görsün.
async function raporOpenSatir(dersId, fasikulId, konuAd, altKonuAd){
  if(!fasikulId){ window.showToast?.('Bu satır için fasikül bilgisi yok.', 'error'); return; }
  window.closeModal?.('calismaRaporModal');
  const studentUid = _rpState.meta.studentUid;
  try{
    if(studentUid){
      // İnceleme "✕ İncelemeyi Kapat" ile bitince aynı rapor durumuna
      // (aynı yıl/ay/hafta/gün konumuna) geri dönebilelim diye anlık durumu sakla.
      window._raporReturnAfterReview = { records: _rpState.real, meta: _rpState.meta, nav: {..._rpState.nav} };
      await window.openStudentFasikulReview?.(studentUid, _rpState.meta.name || 'Öğrenci', dersId, fasikulId);
    } else {
      await window.openReader?.(dersId, fasikulId);
    }
  }catch(e){
    console.warn('Rapor: fasikül açılamadı:', e);
    window.showToast?.('Fasikül açılamadı.', 'error');
    return;
  }
  const fas = appState.aktifFasikul;
  if(!fas){ return; } // açılış reddedildi (yetki/hata) — openReader zaten kendi toast'ını gösterdi
  const allAlts = (fas.konular || []).flatMap(k => k.altKonular || []);
  const hedef = allAlts.find(ak => ak.ad === altKonuAd);
  if(hedef) window.selectAltKonu?.(hedef, `altk-${hedef.id}`);
  else window.showToast?.('Bu testin sayfası bulunamadı, fasikül başından açıldı.', 'info');
}

function renderRaporFasikulOzet(fasikuller){
  if(!fasikuller.length) return '<div class="rapor-empty">Henüz kayıtlı çalışma yok.</div>';
  return fasikuller.map((f,i)=>{
    const t = f.toplam;
    const net = _rpNet(t.dogru, t.yanlis), basari = _rpBasari(t.dogru, t.yanlis);
    const toplamSoru = _rpFasikulTotalSoru(f.fasikulId);
    const soruEtiket = toplamSoru ? `${toplamSoru} T / ${t.soru} Ç` : `${t.soru} soru`;
    const statsHtml = `${soruEtiket} · <b class="rp-dogru">${t.dogru} D</b> / <b class="rp-yanlis">${t.yanlis} Y</b> · <span class="rp-bos">${t.bos} boş</span> · Net <b>${_rpFmtNet(net)}</b> · ${_rpBadge(basari)}`;
    return _rpAcc('fasikul', `<span>📘 ${_rpEsc(f.fasikulAd)}</span>`, _rpRowsCards(f.satirlar, true), statsHtml, i===0);
  }).join('');
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
// Her _rpRenderBox() çağrısında sıfırlanır; kart üzerindeki "🕐" butonları
// buradaki dizinlerine (onclick="raporGosterZamanDamgalari(N)") referans verir —
// tam satır verisini (kayıtlar dahi) onclick string'ine gömmek yerine burada tutulur.
let _rpDetailStore = [];

function _rpActiveRecords(){
  return _rpState.demoOn ? _rpGenerateDemoData() : _rpState.real;
}

function _rpRenderBox(){
  const box = document.getElementById('calismaRaporBox');
  if(!box) return;
  _rpDetailStore = [];
  const list = _rpActiveRecords();
  if(!list.length && !_rpState.demoOn){
    window.showToast?.('Bu kişi için henüz çözüm kaydı yok.', 'info');
  }
  const agac = buildRaporAgaci(list);
  const fasOzet = buildRaporFasikulOzet(list);
  const meta = _rpState.meta;
  const v = _rpState.view;
  // Admin/öğretmen birden fazla öğrenciyi yönetiyorsa (2+), sabit isim metni
  // yerine açılır liste göster — raporu kapatıp Kullanıcı Yönetimi'ne dönmeden
  // başka bir öğrencinin raporuna geçebilsin.
  const managedStudents = window._managedStudents || [];
  const nameHtml = (meta.studentUid && managedStudents.length >= 2)
    ? `<select class="rapor-sub rapor-sub-name rapor-student-select" onchange="raporSwitchStudent(this.value)" title="Öğrenci değiştir">
        ${managedStudents.map(s=>`<option value="${_rpEsc(s.id)}" ${s.id===meta.studentUid?'selected':''}>${_rpEsc(s.name || s.email || 'Öğrenci')}</option>`).join('')}
      </select>`
    : `<p class="rapor-sub rapor-sub-name">${_rpEsc(meta.name || '')}${meta.altBaslik ? ' · ' + _rpEsc(meta.altBaslik) : ''}</p>`;
  box.innerHTML = `
    <div class="rapor-head">
      <div class="rapor-head-text">
        <h2>📊 Çalışma ve Performans Raporu</h2>
        ${nameHtml}
      </div>
      <div class="rapor-head-actions">
        <button class="rapor-demo-btn${_rpState.demoOn ? ' on' : ''}" onclick="raporToggleDemo()" title="Örnek/demo veri ile önizle">🧪 Demo${_rpState.demoOn ? ' Açık' : ''}</button>
        <button class="rapor-close-btn" onclick="closeModal('calismaRaporModal');closeModal('raporTestDetayModal')" title="Kapat">✕</button>
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

// Rapor başlığındaki öğrenci açılır listesinden başka bir öğrenci seçilince:
// o öğrencinin çözüm kayıtlarını (Firestore) çekip aynı modalda raporu
// baştan (yıl seviyesinden) render eder.
async function raporSwitchStudent(uid){
  if(!uid || uid === _rpState.meta.studentUid) return;
  const student = (window._managedStudents || []).find(s=>s.id === uid);
  if(!student){ window.showToast?.('Öğrenci bulunamadı.', 'error'); return; }
  window.showToast?.('Öğrenci verisi yükleniyor…', 'info');
  let records;
  try{
    records = await window.fetchStudentRecords?.(uid) || [];
  }catch(e){
    console.warn('Öğrenci raporu yüklenemedi:', e);
    window.showToast?.('Öğrenci verisi yüklenemedi.', 'error');
    return;
  }
  window._lastManagedStudentUid = uid;
  window._lastManagedStudentRecords = records;
  _rpState.real = records;
  _rpState.meta = {name: student.name || student.email || 'Öğrenci', studentUid: uid};
  _rpState.demoOn = false;
  _rpState.view = 'hiyerarsi';
  _rpState.nav = { level:'year', yil:null, ay:null, hafta:null };
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

// Bir test kartının "🕐" butonu: o testin gösterilen gündeki her sorusunun
// cevaplanma saatini + (varsa) testin başka günlerde çözülmüş kısımlarını gösterir.
function raporGosterZamanDamgalari(idx){
  const row = _rpDetailStore[idx];
  const modal = document.getElementById('raporTestDetayModal');
  const box = document.getElementById('raporTestDetayBox');
  if(!row || !modal || !box) return;

  const digerGunler = row.fasikulId ? _rpOtherGunlerForTest(row.fasikulId, row.konu, row.altKonu, row.tarih) : [];
  const digerHtml = digerGunler.length ? `<div class="rapor-digerler">
      <div class="rapor-digerler-baslik">📆 Bu test başka günlerde de çözülmüş:</div>
      ${digerGunler.map(g=>`<div class="rapor-digerler-satir">${_rpEsc(_rpDayLabel(g.gunKey))} — ${g.soru} soru (<b class="rp-dogru">${g.dogru} D</b> / <b class="rp-yanlis">${g.yanlis} Y</b>${g.bos ? ` / ${g.bos} boş` : ''})</div>`).join('')}
    </div>` : '';

  const kayitlar = row.kayitlar || [];
  const kayitHtml = kayitlar.length ? kayitlar.map((k,i)=>{
    const saat = new Date(k.ts).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    const durum = k.bos ? '⬜ Boş' : (k.dogru ? '✅ Doğru' : '❌ Yanlış');
    return `<div class="rapor-zaman-satir"><span class="rapor-zaman-no">${i+1}.</span><span class="rapor-zaman-saat">${saat}</span><span class="rapor-zaman-durum">${durum}</span></div>`;
  }).join('') : '<div class="rapor-empty-row">Zaman kaydı yok.</div>';

  box.innerHTML = `
    <div class="rapor-head">
      <div class="rapor-head-text">
        <h3>🕐 ${_rpEsc(row.konu)} <span class="ok">›</span> ${_rpEsc(row.altKonu)}</h3>
        <p class="rapor-sub">${_rpEsc(row.fasikulAd || '')} · ${_rpEsc(_rpDayLabel(row.tarih))}</p>
      </div>
      <button class="rapor-close-btn" onclick="closeModal('raporTestDetayModal')" title="Kapat">✕</button>
    </div>
    ${digerHtml}
    <div class="rapor-zaman-list">${kayitHtml}</div>`;
  modal.classList.add('open');
}

// closeStudentFasikulReview() ("✕ İncelemeyi Kapat") her çalıştığında çağrılır;
// inceleme rapordan açılmadıysa (bayrak yoksa) sessizce hiçbir şey yapmaz.
function raporReopenAfterReview(){
  const saved = window._raporReturnAfterReview;
  if(!saved) return;
  window._raporReturnAfterReview = null;
  const modal = document.getElementById('calismaRaporModal');
  if(!modal) return;
  _rpState.real = saved.records;
  _rpState.meta = saved.meta;
  _rpState.demoOn = false;
  _rpState.view = 'hiyerarsi';
  _rpState.nav = saved.nav;
  modal.classList.add('open');
  _rpRenderBox();
}

window.openCalismaRaporu = openCalismaRaporu;
window.raporSwitchStudent = raporSwitchStudent;
window.raporToggleDemo = raporToggleDemo;
window.raporSwitchView = raporSwitchView;
window.raporToggleAcc = raporToggleAcc;
window.raporNavGoto = raporNavGoto;
window.raporNavBack = raporNavBack;
window.raporOpenSatir = raporOpenSatir;
window.raporReopenAfterReview = raporReopenAfterReview;
window.raporGosterZamanDamgalari = raporGosterZamanDamgalari;
