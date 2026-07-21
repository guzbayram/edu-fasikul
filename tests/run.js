/**
 * EduFasikül — Otomatik Test Paketi
 * Çalıştırma: node tests/run.js
 *
 * Test grupları:
 *  1. _hesaplaIstatistik   — temel istatistik hesaplama
 *  2. getAnsweredRecords   — tekilleştirme (alias key deduplication)
 *  3. getDashboardStats    — bulut/yerel birleştirme mantığı
 *  4. recalcFasikulProgress — fasikül ilerleme hesaplama
 *  5. calcCurrentStreak    — seri hesaplama
 *  6. getDailyCounts       — günlük dağılım
 *  7. safeDateKey          — tarih normalizasyonu
 *  8. _canonicalAnswerKey  — anahtar normalizasyonu
 *  9. Sıfırlama tutarlılığı — resetAllData / resetFasikulData mantığı
 * 10. Çapraz tutarlılık    — anasayfa ↔ fasikül kartı eşleşmesi
 */

'use strict';

// ─── TEST RUNNER ────────────────────────────────────────────────────────────
let _pass = 0, _fail = 0, _group = '';
const results = [];

function group(name) {
  _group = name;
  console.log(`\n\x1b[36m▶ ${name}\x1b[0m`);
}

function assert(desc, condition, detail = '') {
  if (condition) {
    _pass++;
    console.log(`  \x1b[32m✓\x1b[0m ${desc}`);
    results.push({ ok: true, group: _group, desc });
  } else {
    _fail++;
    const msg = detail ? ` → ${detail}` : '';
    console.log(`  \x1b[31m✗\x1b[0m ${desc}${msg}`);
    results.push({ ok: false, group: _group, desc, detail });
  }
}

function assertEqual(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(desc, ok, `beklenen: ${JSON.stringify(expected)}, gerçek: ${JSON.stringify(actual)}`);
}

function assertGte(desc, actual, min) {
  assert(desc, actual >= min, `${actual} >= ${min} değil`);
}

// ─── MOCK ORTAMI ────────────────────────────────────────────────────────────
// Tarayıcı API'lerini simüle et
const _lsStore = {};
global.localStorage = {
  getItem:    k    => _lsStore[k] ?? null,
  setItem:    (k,v)=> { _lsStore[k] = String(v); },
  removeItem: k    => { delete _lsStore[k]; },
  get length()     { return Object.keys(_lsStore).length; },
  key:        i    => Object.keys(_lsStore)[i] ?? null,
};
global.window = {};
global.document = { getElementById: () => null };

// ─── UYGULAMA STATE & MANIFEST ─────────────────────────────────────────────
let appState = {
  sorularState:          {},
  hatalilar:             [],
  drawings:              {},
  cloudIstatistik:       null,
  cloudSolutionsLoaded:  false,
  aktifFasikul:          null,
  aktifKonu:             null,
  aktifAltKonu:          null,
};

let MANIFEST = {
  dersler: [
    {
      id: 'mat', ad: 'Matematik', progPct: 0,
      fasikuller: [
        { id: 'fas-a', ad: 'Fasikül A', soruSayisi: 10, progPct: 0, _solvedCount: 0, sonCalisma: '—' },
        { id: 'fas-b', ad: 'Fasikül B', soruSayisi: 5,  progPct: 0, _solvedCount: 0, sonCalisma: '—' },
      ]
    },
    {
      id: 'fiz', ad: 'Fizik', progPct: 0,
      fasikuller: [
        { id: 'fas-c', ad: 'Fasikül C', soruSayisi: 8, progPct: 0, _solvedCount: 0, sonCalisma: '—' },
      ]
    }
  ]
};

// ─── UYGULAMA FONKSİYONLARINI TANIMLA ──────────────────────────────────────
// index.html'deki saf (pure) fonksiyonlar buraya kopyalandı.
// DOM, Firebase ve PDF'e bağımlı olmayanlar test edilebilir.

function safeDateKey(dateLike) {
  const d = dateLike ? new Date(dateLike) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function _canonicalAnswerKey(key, s) {
  const fid = String(s?.fasikulId || '');
  let base = String(key || '');
  if (fid && base.startsWith(`${fid}__`)) base = base.slice(fid.length + 2);
  return `${fid}__${base}`;
}

function getAnsweredRecords() {
  const seenObjects = new Set(), seenKeys = new Set(), records = [];
  Object.entries(appState.sorularState || {}).forEach(([key, s]) => {
    if (!s || !s.answered || seenObjects.has(s)) return;
    const canonical = _canonicalAnswerKey(key, s);
    if (seenKeys.has(canonical)) return;
    seenObjects.add(s); seenKeys.add(canonical); records.push(s);
  });
  return records;
}

function _hesaplaIstatistik(records = getAnsweredRecords()) {
  let toplam = 0, dogru = 0, yanlis = 0, bos = 0;
  const konular = {};
  records.forEach(s => {
    toplam++;
    const konu = s.konu || 'Diğer';
    if (!konular[konu]) konular[konu] = { dogru: 0, yanlis: 0 };
    if (s.skipped)       { bos++;    }
    else if (s.correct)  { dogru++;  konular[konu].dogru++;  }
    else                 { yanlis++; konular[konu].yanlis++; }
  });
  return { toplam, dogru, yanlis, bos, konular };
}

function getDashboardStats() {
  const records    = getAnsweredRecords();
  const calculated = _hesaplaIstatistik();
  const cloud      = appState.cloudIstatistik || {};
  const cloudTotal = Number(cloud.toplam || 0);
  const useCalc    = appState.cloudSolutionsLoaded || cloudTotal === 0;

  const pending = useCalc
    ? { toplam: 0, dogru: 0, yanlis: 0, bos: 0, konular: {} }
    : _hesaplaIstatistik(records.filter(s => !s._synced));

  const toplam  = useCalc ? calculated.toplam  : cloudTotal                    + pending.toplam;
  const dogru   = useCalc ? calculated.dogru   : Number(cloud.dogru   || 0)   + pending.dogru;
  const yanlis  = useCalc ? calculated.yanlis  : Number(cloud.yanlis  || 0)   + pending.yanlis;
  const bos     = useCalc ? calculated.bos     : Number(cloud.bos     || 0)   + pending.bos;
  const konular = useCalc
    ? calculated.konular
    : JSON.parse(JSON.stringify(cloud.konular || {}));

  if (!useCalc && pending.toplam) {
    Object.entries(pending.konular || {}).forEach(([konu, k]) => {
      if (!konular[konu]) konular[konu] = { dogru: 0, yanlis: 0 };
      konular[konu].dogru  += Number(k.dogru  || 0);
      konular[konu].yanlis += Number(k.yanlis || 0);
    });
  }
  return { toplam, dogru, yanlis, bos, konular, records };
}

function getDailyCounts(records) {
  const counts = {};
  records.forEach(r => {
    const key = safeDateKey(r.tarih);
    if (key) counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

function calcCurrentStreak(counts) {
  let streak = 0;
  const d = new Date();
  for (let i = 0; i < 365; i++) {
    const key = d.toISOString().slice(0, 10);
    if ((counts[key] || 0) > 0) { streak++; d.setDate(d.getDate() - 1); }
    else break;
  }
  return streak;
}

function recalcFasikulProgress() {
  const records = getAnsweredRecords();
  const fasikulSolved = {};
  records.forEach(s => {
    if (!s.fasikulId || s.skipped) return;
    fasikulSolved[s.fasikulId] = (fasikulSolved[s.fasikulId] || 0) + 1;
  });
  MANIFEST.dersler.forEach(ders => {
    let dersTotal = 0, dersSolved = 0;
    ders.fasikuller.forEach(fas => {
      const solved = fasikulSolved[fas.id] || 0;
      const total  = fas.soruSayisi || 0;
      fas._solvedCount = solved;
      fas.progPct      = total > 0 ? Math.min(100, Math.round((solved / total) * 100)) : 0;
      dersTotal  += total;
      dersSolved += solved;
    });
    ders.progPct = dersTotal > 0 ? Math.min(100, Math.round((dersSolved / dersTotal) * 100)) : 0;
  });
}

// ─── YARDIMCI FONKSİYONLAR ─────────────────────────────────────────────────
function makeRecord(overrides = {}) {
  return {
    answered:       true,
    selected:       'A',
    correct:        true,
    correct_answer: 'A',
    skipped:        false,
    fasikulId:      'fas-a',
    fasikulAd:      'Fasikül A',
    konu:           'Sayılar',
    altKonu:        'Tam Sayılar',
    zorluk:         'orta',
    tarih:          new Date().toISOString(),
    timeSec:        30,
    _synced:        true,
    ...overrides
  };
}

function resetMockState() {
  appState.sorularState         = {};
  appState.hatalilar            = [];
  appState.drawings             = {};
  appState.cloudIstatistik      = null;
  appState.cloudSolutionsLoaded = false;
  MANIFEST.dersler.forEach(d => {
    d.progPct = 0;
    d.fasikuller.forEach(f => { f.progPct = 0; f._solvedCount = 0; f.sonCalisma = '—'; });
  });
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 1 — safeDateKey
// ════════════════════════════════════════════════════════════════════════════
group('safeDateKey — tarih normalizasyonu');

assert('Geçerli ISO string → YYYY-MM-DD döner',
  safeDateKey('2025-06-15T10:30:00.000Z') === '2025-06-15');

assert('null girdi → boş string döner',
  safeDateKey(null) === '');

assert('Geçersiz string → boş string döner',
  safeDateKey('geçersiz-tarih') === '');

assert('Date objesi çalışır',
  safeDateKey(new Date('2025-01-01')) === '2025-01-01');

// ════════════════════════════════════════════════════════════════════════════
// TEST 2 — _canonicalAnswerKey
// ════════════════════════════════════════════════════════════════════════════
group('_canonicalAnswerKey — anahtar normalizasyonu');

assert('Prefix olmayan key → fasid__key formatında döner',
  _canonicalAnswerKey('s1', { fasikulId: 'fas-a' }) === 'fas-a__s1');

assert('fas-a__ ön eki varsa soyulur → aynı canonical key',
  _canonicalAnswerKey('fas-a__s1', { fasikulId: 'fas-a' }) === 'fas-a__s1');

assert('fasId yoksa boş prefix',
  _canonicalAnswerKey('s1', {}) === '__s1');

{
  const k1 = _canonicalAnswerKey('fas-a__s1', { fasikulId: 'fas-a' });
  const k2 = _canonicalAnswerKey('s1',        { fasikulId: 'fas-a' });
  assert('Alias key ile orijinal key aynı canonical değeri üretir', k1 === k2);
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 3 — getAnsweredRecords — tekilleştirme
// ════════════════════════════════════════════════════════════════════════════
group('getAnsweredRecords — tekilleştirme (deduplication)');

resetMockState();

// Senaryo: aynı cevap iki farklı key ile kaydedilmiş (alias)
{
  const rec = makeRecord({ fasikulId: 'fas-a' });
  appState.sorularState['s1']         = rec;
  appState.sorularState['fas-a__s1']  = rec; // aynı obje, alias key
  const records = getAnsweredRecords();
  assertEqual('Alias key olan aynı obje bir kez sayılır', records.length, 1);
}

resetMockState();

// Senaryo: farklı sorular
{
  appState.sorularState['s1'] = makeRecord({ fasikulId: 'fas-a', altKonu: 'A' });
  appState.sorularState['s2'] = makeRecord({ fasikulId: 'fas-a', altKonu: 'B' });
  appState.sorularState['s3'] = makeRecord({ fasikulId: 'fas-b', altKonu: 'C' });
  const records = getAnsweredRecords();
  assertEqual('3 farklı soru 3 kayıt döner', records.length, 3);
}

resetMockState();

// Senaryo: cevaplanmamış soru sayılmaz
{
  appState.sorularState['s1'] = makeRecord({ answered: true  });
  appState.sorularState['s2'] = makeRecord({ answered: false });
  appState.sorularState['s3'] = { answered: false, fasikulId: 'fas-a' };
  const records = getAnsweredRecords();
  assertEqual('Cevaplanmamış sorular hariç tutulur', records.length, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 4 — _hesaplaIstatistik
// ════════════════════════════════════════════════════════════════════════════
group('_hesaplaIstatistik — temel istatistik hesaplama');

{
  const records = [];
  const result = _hesaplaIstatistik(records);
  assertEqual('Boş kayıt → toplam 0', result.toplam, 0);
  assertEqual('Boş kayıt → doğru 0',  result.dogru,  0);
  assertEqual('Boş kayıt → yanlış 0', result.yanlis,  0);
  assertEqual('Boş kayıt → boş 0',    result.bos,     0);
}

{
  const records = [
    makeRecord({ correct: true,  skipped: false, konu: 'Sayılar'  }),
    makeRecord({ correct: true,  skipped: false, konu: 'Sayılar'  }),
    makeRecord({ correct: false, skipped: false, konu: 'Geometri' }),
    makeRecord({ correct: false, skipped: true,  konu: 'Geometri' }), // skipped → boş
  ];
  const r = _hesaplaIstatistik(records);
  assertEqual('4 soru → toplam 4', r.toplam, 4);
  assertEqual('2 doğru',           r.dogru,  2);
  assertEqual('1 yanlış (skipped yanlış sayılmaz)', r.yanlis, 1);
  assertEqual('1 boş (skipped)',   r.bos,    1);
  assertEqual('Sayılar konusunda 2 doğru', r.konular['Sayılar']?.dogru, 2);
  assertEqual('Geometri konusunda 1 yanlış (skipped sayılmaz)', r.konular['Geometri']?.yanlis, 1);
}

{
  // Sadece skipped (boş geçilen) sorular
  const records = [
    makeRecord({ correct: false, skipped: true }),
    makeRecord({ correct: false, skipped: true }),
  ];
  const r = _hesaplaIstatistik(records);
  assertEqual('Sadece boş: toplam 2', r.toplam, 2);
  assertEqual('Sadece boş: doğru 0',  r.dogru,  0);
  assertEqual('Sadece boş: yanlış 0', r.yanlis,  0);
  assertEqual('Sadece boş: boş 2',    r.bos,     2);
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 5 — getDashboardStats — bulut/yerel birleştirme
// ════════════════════════════════════════════════════════════════════════════
group('getDashboardStats — kaynak seçimi ve birleştirme');

resetMockState();

{
  // cloudSolutionsLoaded=true → yerel veriden hesaplanır
  appState.cloudSolutionsLoaded = true;
  appState.cloudIstatistik = { toplam: 999, dogru: 999, yanlis: 0, bos: 0, konular: {} };
  appState.sorularState['s1'] = makeRecord({ correct: true,  _synced: true });
  appState.sorularState['s2'] = makeRecord({ correct: false, _synced: true });
  const stats = getDashboardStats();
  assertEqual('cloudSolutionsLoaded=true → yerel 2 soru sayılır', stats.toplam, 2);
  assertEqual('cloudSolutionsLoaded=true → bulut 999 yok sayılır', stats.dogru, 1);
}

resetMockState();

{
  // cloudSolutionsLoaded=false, cloudTotal=0 → yerel hesap
  appState.cloudSolutionsLoaded = false;
  appState.cloudIstatistik = null;
  appState.sorularState['s1'] = makeRecord({ correct: true, _synced: false });
  const stats = getDashboardStats();
  assertEqual('cloudTotal=0 → yerel 1 soru sayılır', stats.toplam, 1);
}

resetMockState();

{
  // cloudSolutionsLoaded=false, cloudTotal>0, yerel sync edilmemiş ek kayıtlar var
  appState.cloudSolutionsLoaded = false;
  appState.cloudIstatistik = { toplam: 5, dogru: 4, yanlis: 1, bos: 0, konular: {} };
  // 2 yeni, sync edilmemiş cevap
  appState.sorularState['s1'] = makeRecord({ correct: true,  _synced: false });
  appState.sorularState['s2'] = makeRecord({ correct: false, _synced: false });
  const stats = getDashboardStats();
  assertEqual('Bulut(5) + yerel pending(2) = 7 toplam', stats.toplam, 7);
  assertEqual('Bulut doğru(4) + yerel doğru(1) = 5', stats.dogru, 5);
  assertEqual('Bulut yanlış(1) + yerel yanlış(1) = 2', stats.yanlis, 2);
}

resetMockState();

{
  // Tamamen sıfır durum
  appState.cloudSolutionsLoaded = false;
  appState.cloudIstatistik = null;
  const stats = getDashboardStats();
  assertEqual('Sıfır durum: toplam 0', stats.toplam, 0);
  assertEqual('Sıfır durum: doğru 0',  stats.dogru,  0);
  assertEqual('Sıfır durum: yanlış 0', stats.yanlis,  0);
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 6 — recalcFasikulProgress
// ════════════════════════════════════════════════════════════════════════════
group('recalcFasikulProgress — fasikül ilerleme hesaplama');

resetMockState();

{
  // Boş durum: tüm progPct 0
  recalcFasikulProgress();
  const fasA = MANIFEST.dersler[0].fasikuller[0];
  const fasB = MANIFEST.dersler[0].fasikuller[1];
  assertEqual('Boş durum: fas-a progPct=0', fasA.progPct, 0);
  assertEqual('Boş durum: fas-b progPct=0', fasB.progPct, 0);
  assertEqual('Boş durum: mat progPct=0',   MANIFEST.dersler[0].progPct, 0);
}

resetMockState();

{
  // fas-a (soruSayisi=10): 5 doğru cevap, 0 atlama
  for (let i = 1; i <= 5; i++) {
    appState.sorularState[`fas-a__s${i}`] = makeRecord({ fasikulId: 'fas-a', correct: true, skipped: false });
  }
  recalcFasikulProgress();
  const fasA = MANIFEST.dersler[0].fasikuller[0];
  assertEqual('5/10 soru → progPct=50', fasA.progPct, 50);
  assertEqual('5/10 soru → _solvedCount=5', fasA._solvedCount, 5);
}

resetMockState();

{
  // Skipped sorular progPct'e sayılmaz
  for (let i = 1; i <= 3; i++) {
    appState.sorularState[`fas-a__s${i}`] = makeRecord({ fasikulId: 'fas-a', correct: true,  skipped: false });
  }
  for (let i = 4; i <= 6; i++) {
    appState.sorularState[`fas-a__s${i}`] = makeRecord({ fasikulId: 'fas-a', correct: false, skipped: true });
  }
  recalcFasikulProgress();
  const fasA = MANIFEST.dersler[0].fasikuller[0];
  assertEqual('3 doğru + 3 atlama (10 soru): progPct=30 (skipped sayılmaz)', fasA.progPct, 30);
  assertEqual('_solvedCount=3 (skipped hariç)', fasA._solvedCount, 3);
}

resetMockState();

{
  // Farklı fasikül sorular birbirini etkilemez
  for (let i = 1; i <= 10; i++) {
    appState.sorularState[`fas-a__s${i}`] = makeRecord({ fasikulId: 'fas-a', correct: true });
  }
  for (let i = 1; i <= 2; i++) {
    appState.sorularState[`fas-b__s${i}`] = makeRecord({ fasikulId: 'fas-b', correct: true });
  }
  recalcFasikulProgress();
  const fasA = MANIFEST.dersler[0].fasikuller[0]; // soruSayisi=10
  const fasB = MANIFEST.dersler[0].fasikuller[1]; // soruSayisi=5
  assertEqual('fas-a 10/10 → progPct=100', fasA.progPct, 100);
  assertEqual('fas-b 2/5  → progPct=40',  fasB.progPct, 40);
}

resetMockState();

{
  // Ders-level progPct: ağırlıklı ortalama
  // fas-a: soruSayisi=10, 5 çözüldü
  // fas-b: soruSayisi=5,  5 çözüldü
  for (let i = 1; i <= 5; i++) {
    appState.sorularState[`fas-a__s${i}`] = makeRecord({ fasikulId: 'fas-a', correct: true });
  }
  for (let i = 1; i <= 5; i++) {
    appState.sorularState[`fas-b__s${i}`] = makeRecord({ fasikulId: 'fas-b', correct: true });
  }
  recalcFasikulProgress();
  // 10/15 toplam → %67
  const mat = MANIFEST.dersler[0];
  assertEqual('Ders progPct ağırlıklı ortalama: 10/15 → 67', mat.progPct, 67);
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 7 — getDailyCounts
// ════════════════════════════════════════════════════════════════════════════
group('getDailyCounts — günlük dağılım');

{
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = (() => { const d = new Date(); d.setDate(d.getDate()-1); return d.toISOString().slice(0,10); })();
  const records = [
    { tarih: `${today}T10:00:00.000Z`     },
    { tarih: `${today}T14:00:00.000Z`     },
    { tarih: `${yesterday}T09:00:00.000Z` },
    { tarih: 'invalid-date'               }, // geçersiz
    { tarih: null                          }, // null
  ];
  const counts = getDailyCounts(records);
  assertEqual('Bugün 2 soru', counts[today],     2);
  assertEqual('Dün 1 soru',   counts[yesterday], 1);
  assertEqual('Geçersiz tarih sayılmaz', Object.keys(counts).length, 2);
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 8 — calcCurrentStreak
// ════════════════════════════════════════════════════════════════════════════
group('calcCurrentStreak — seri hesaplama');

{
  // Boş → seri 0
  assertEqual('Boş kayıt → seri 0', calcCurrentStreak({}), 0);
}

{
  // Sadece bugün → seri 1
  const today = new Date().toISOString().slice(0, 10);
  assertEqual('Sadece bugün → seri 1', calcCurrentStreak({ [today]: 5 }), 1);
}

{
  // Bugün + dün + önceki gün = seri 3
  const days = {};
  for (let i = 0; i < 3; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    days[d.toISOString().slice(0, 10)] = 1;
  }
  assertEqual('3 ardışık gün → seri 3', calcCurrentStreak(days), 3);
}

{
  // Bugün yok ama dün var → seri 0 (bugün boş = seri kırıldı)
  const yesterday = (() => { const d = new Date(); d.setDate(d.getDate()-1); return d.toISOString().slice(0,10); })();
  assertEqual('Bugün boş, dün dolu → seri 0', calcCurrentStreak({ [yesterday]: 3 }), 0);
}

{
  // 7 gün ardışık
  const days = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    days[d.toISOString().slice(0, 10)] = 2;
  }
  assertEqual('7 gün ardışık → seri 7', calcCurrentStreak(days), 7);
}

{
  // 10 gün ama 5. günde boşluk var
  const days = {};
  for (let i = 0; i < 10; i++) {
    if (i === 4) continue; // boşluk
    const d = new Date(); d.setDate(d.getDate() - i);
    days[d.toISOString().slice(0, 10)] = 1;
  }
  assertEqual('4. günde boşluk → seri 4 (boşluktan öncesi)', calcCurrentStreak(days), 4);
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 9 — Sıfırlama tutarlılığı
// ════════════════════════════════════════════════════════════════════════════
group('Sıfırlama tutarlılığı — resetAllData / resetFasikulData mantığı');

{
  // resetAllData mantığını simüle et (Firestore kısmı hariç, saf state temizliği)
  resetMockState();
  for (let i = 1; i <= 10; i++) {
    appState.sorularState[`fas-a__s${i}`] = makeRecord({ fasikulId: 'fas-a', correct: true });
  }
  appState.hatalilar = [{ fasikulId: 'fas-a', konu: 'Sayılar' }];
  appState.cloudIstatistik = { toplam: 10, dogru: 10, yanlis: 0, bos: 0 };

  // Sıfırla
  appState.sorularState         = {};
  appState.hatalilar            = [];
  appState.cloudIstatistik      = null;
  appState.cloudSolutionsLoaded = false;
  MANIFEST.dersler.forEach(d => {
    d.progPct = 0;
    d.fasikuller.forEach(f => { f.progPct = 0; f._solvedCount = 0; });
  });

  recalcFasikulProgress();
  const stats = getDashboardStats();
  assertEqual('Sıfırlama sonrası: toplam 0', stats.toplam, 0);
  assertEqual('Sıfırlama sonrası: doğru 0',  stats.dogru,  0);
  assertEqual('Sıfırlama sonrası: yanlış 0', stats.yanlis, 0);
  assertEqual('Sıfırlama sonrası: cloudIstatistik null', appState.cloudIstatistik, null);
  assertEqual('fas-a progPct=0 sıfırlama sonrası', MANIFEST.dersler[0].fasikuller[0].progPct, 0);
}

{
  // resetFasikulData mantığı — sadece bir fasikülü sıfırla
  resetMockState();
  for (let i = 1; i <= 5; i++) {
    appState.sorularState[`fas-a__s${i}`] = makeRecord({ fasikulId: 'fas-a', correct: true });
  }
  for (let i = 1; i <= 3; i++) {
    appState.sorularState[`fas-b__s${i}`] = makeRecord({ fasikulId: 'fas-b', correct: true });
  }
  appState.hatalilar = [
    { fasikulId: 'fas-a', konu: 'Sayılar' },
    { fasikulId: 'fas-b', konu: 'Geometri' },
  ];

  // fas-a'yı sıfırla
  const fasId = 'fas-a';
  Object.keys(appState.sorularState).forEach(key => {
    const s = appState.sorularState[key];
    if ((s && s.fasikulId === fasId) || key.startsWith(fasId + '__')) {
      delete appState.sorularState[key];
    }
  });
  appState.hatalilar = appState.hatalilar.filter(h => h.fasikulId !== fasId);
  MANIFEST.dersler[0].fasikuller[0].progPct = 0;
  MANIFEST.dersler[0].fasikuller[0]._solvedCount = 0;

  recalcFasikulProgress();
  const stats = getDashboardStats();

  assertEqual('fas-a sıfırlandı: fas-a progPct=0', MANIFEST.dersler[0].fasikuller[0].progPct, 0);
  assertEqual('fas-b etkilenmedi: fas-b progPct=60 (3/5)', MANIFEST.dersler[0].fasikuller[1].progPct, 60);
  assertEqual('fas-a sıfırlandı: sadece fas-b kayıtları kalır (3)', stats.toplam, 3);
  assertEqual('fas-a hatalıları silindi: 1 hatalı kaldı', appState.hatalilar.length, 1);
  assertEqual('Kalan hatalı fas-b\'ye ait', appState.hatalilar[0].fasikulId, 'fas-b');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 10 — Çapraz tutarlılık (anasayfa ↔ fasikül kartları)
// ════════════════════════════════════════════════════════════════════════════
group('Çapraz tutarlılık — anasayfa istatistikleri ↔ fasikül kartları');

resetMockState();

{
  // 7 soru: fas-a'ya 5, fas-b'ye 2
  for (let i = 1; i <= 5; i++) {
    appState.sorularState[`fas-a__s${i}`] = makeRecord({ fasikulId: 'fas-a', correct: i <= 4, skipped: false });
  }
  for (let i = 1; i <= 2; i++) {
    appState.sorularState[`fas-b__s${i}`] = makeRecord({ fasikulId: 'fas-b', correct: false, skipped: false });
  }
  appState.cloudSolutionsLoaded = true;

  recalcFasikulProgress();
  const stats = getDashboardStats();

  // Anasayfa toplamı
  assertEqual('Anasayfa: 7 toplam soru', stats.toplam, 7);
  assertEqual('Anasayfa: 4 doğru', stats.dogru, 4);
  assertEqual('Anasayfa: 3 yanlış', stats.yanlis, 3);

  // Fasikül kartları
  const fasA = MANIFEST.dersler[0].fasikuller[0]; // soruSayisi=10
  const fasB = MANIFEST.dersler[0].fasikuller[1]; // soruSayisi=5
  assertEqual('fas-a: 5 çözüldü (_solvedCount)', fasA._solvedCount, 5);
  assertEqual('fas-b: 2 çözüldü (_solvedCount)', fasB._solvedCount, 2);

  // Tutarlılık: toplam çözülen = fasikül kartlarındaki toplam
  const kartToplam = fasA._solvedCount + fasB._solvedCount;
  assertEqual('Anasayfa toplam === fasikül kartları toplamı', stats.toplam, kartToplam);

  // Fasikül yüzdeleri makul
  assertEqual('fas-a progPct=50 (5/10)', fasA.progPct, 50);
  assertEqual('fas-b progPct=40 (2/5)',  fasB.progPct, 40);
}

resetMockState();

{
  // Alias key olduğunda tutarlılık korunmalı
  const rec = makeRecord({ fasikulId: 'fas-a', correct: true });
  appState.sorularState['s1']        = rec;
  appState.sorularState['fas-a__s1'] = rec; // aynı obje, alias

  appState.cloudSolutionsLoaded = true;
  recalcFasikulProgress();
  const stats = getDashboardStats();

  assertEqual('Alias ile anasayfa toplam 1 (not 2)', stats.toplam, 1);
  assertEqual('Alias ile fasikül _solvedCount 1',    MANIFEST.dersler[0].fasikuller[0]._solvedCount, 1);
  assert('Anasayfa == fasikül kart: alias durumunda tutarlı',
    stats.toplam === MANIFEST.dersler[0].fasikuller[0]._solvedCount);
}

resetMockState();

{
  // Farklı konu grupları: konular tablosu ile toplam uyuşmalı
  const konular_test = ['Sayılar', 'Geometri', 'Cebir'];
  konular_test.forEach((konu, ki) => {
    for (let i = 0; i < 3; i++) {
      appState.sorularState[`${konu}-s${i}`] = makeRecord({
        fasikulId: 'fas-a', konu, correct: i < 2, skipped: false
      });
    }
  });
  appState.cloudSolutionsLoaded = true;
  const stats = getDashboardStats();

  const konularToplam = Object.values(stats.konular || {}).reduce((sum, k) => sum + k.dogru + k.yanlis, 0);
  assertEqual('Konular toplamı (doğru+yanlış) = toplam - boş',
    konularToplam, stats.toplam - stats.bos);
}

// ════════════════════════════════════════════════════════════════════════════
// SONUÇ
// ════════════════════════════════════════════════════════════════════════════
const failed = results.filter(r => !r.ok);

console.log('\n' + '═'.repeat(60));
console.log(`  Toplam: ${_pass + _fail} test  |  ` +
  `\x1b[32m${_pass} geçti\x1b[0m  |  ` +
  `\x1b[31m${_fail} başarısız\x1b[0m`);
console.log('═'.repeat(60));

if (failed.length) {
  console.log('\n\x1b[31mBaşarısız testler:\x1b[0m');
  failed.forEach(t => {
    console.log(`  [${t.group}] ${t.desc}`);
    if (t.detail) console.log(`    → ${t.detail}`);
  });
  process.exit(1);
} else {
  console.log('\n\x1b[32m  Tüm testler geçti ✓\x1b[0m');
  process.exit(0);
}
