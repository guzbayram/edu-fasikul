#!/usr/bin/env node
// MEBİ/EBA "upper-subjects" taraması JSON'unu EduFasikül uygulama şemasına çevirir.
//
// Kullanım:
//   node tools/convert-mebi-fasikul.mjs "12-Matematik (Destek).json" [cikti.json]
//
// Girdi şeması (MEBİ):  { title, topics:[ { mainNo, subNo, mainTopic, topic,
//   videoUrl, videoDuration, practice:{answerKey:[{number,correctAnswer,solutionVideoUrl}]},
//   assessment:{answerKey:[...]} } ] }
// Çıktı şeması (uygulama, "video fasikül"):
//   { ad, sinif, thumb, tip:"video", konular:[ { id, ad, altKonular:[
//       { id, ad, konuVideoUrl, videoDuration, sorular:[ {no,onizleme,cevap,zorluk,cozumVideoUrl,grup} ] } ] } ] }

import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

function slugify(str, fallback = 'x') {
  const map = { ç:'c', ğ:'g', ı:'i', İ:'i', ö:'o', ş:'s', ü:'u', Ç:'c', Ğ:'g', Ö:'o', Ş:'s', Ü:'u' };
  const s = String(str || '')
    .replace(/[çğıİöşüÇĞÖŞÜ]/g, c => map[c] || c)
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || fallback;
}

function answerKeyToSorular(block, grup, startNo, etiket) {
  const out = [];
  const ak = (block && Array.isArray(block.answerKey)) ? block.answerKey : [];
  ak.forEach((q, i) => {
    out.push({
      no: startNo + i,
      onizleme: `${etiket} S.${q.number ?? (i + 1)}`,
      cevap: (q.correctAnswer || '').toString().trim().toUpperCase() || '?',
      zorluk: 'orta',
      cozumVideoUrl: q.solutionVideoUrl || '',
      grup
    });
  });
  return out;
}

function convert(raw) {
  const topics = Array.isArray(raw.topics) ? raw.topics.slice() : [];
  // Ana konu (mainNo) → konu;  alt konu (subNo) → altKonu
  topics.sort((a, b) => (a.mainNo - b.mainNo) || (a.subNo - b.subNo));

  const konuMap = new Map(); // mainNo -> konu
  for (const t of topics) {
    const mainNo = t.mainNo ?? 0;
    if (!konuMap.has(mainNo)) {
      konuMap.set(mainNo, {
        id: `konu-${mainNo}-${slugify(t.mainTopic, 'konu')}`,
        ad: t.mainTopic || t.topic || `Konu ${mainNo}`,
        altKonular: []
      });
    }
    const konu = konuMap.get(mainNo);

    let no = 1;
    const sorular = [
      ...answerKeyToSorular(t.practice, 'practice', no, 'Alıştırma')
    ];
    no += sorular.length;
    sorular.push(...answerKeyToSorular(t.assessment, 'assessment', no, 'Değerlendirme'));

    konu.altKonular.push({
      id: `alt-${mainNo}-${t.subNo ?? 1}-${slugify(t.topic, 'alt')}`,
      ad: t.topic || t.mainTopic || `Alt konu ${t.subNo}`,
      konuVideoUrl: t.videoUrl || (Array.isArray(t.videoUrls) ? t.videoUrls[0] : '') || '',
      videoDuration: t.videoDuration || '',
      sorular
    });
  }

  const konular = [...konuMap.values()];
  return {
    ad: raw.title || 'Video Fasikül',
    sinif: 8,
    thumb: '🎬',
    tip: 'video',
    sourceUrl: raw.sourceUrl || '',
    konular
  };
}

function main() {
  const [, , inPath, outArg] = process.argv;
  if (!inPath) {
    console.error('Kullanım: node tools/convert-mebi-fasikul.mjs <girdi.json> [cikti.json]');
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(inPath, 'utf8'));
  const result = convert(raw);

  const outPath = outArg || inPath.replace(/\.json$/i, '') + '-kart.json';
  writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');

  // Özet
  const altCount = result.konular.reduce((s, k) => s + k.altKonular.length, 0);
  const soruCount = result.konular.reduce((s, k) => s + k.altKonular.reduce((a, ak) => a + ak.sorular.length, 0), 0);
  const eksikVideo = result.konular.flatMap(k => k.altKonular).filter(ak => !ak.konuVideoUrl).length;
  const eksikCozum = result.konular.flatMap(k => k.altKonular).flatMap(ak => ak.sorular).filter(s => !s.cozumVideoUrl).length;
  console.log(`✓ ${basename(outPath)} yazıldı`);
  console.log(`  Ana konu: ${result.konular.length} | Alt konu (video): ${altCount} | Soru: ${soruCount}`);
  console.log(`  Konu videosu eksik: ${eksikVideo} | Çözüm videosu eksik: ${eksikCozum}`);
}

main();
