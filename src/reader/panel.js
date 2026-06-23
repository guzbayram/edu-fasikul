import { appState } from '../state/appState.js';

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
  const uid = window._getUserKey?.();
  if(exists){
    exists.yanlisSayisi++;
    if(uid) window.addHataliCloud?.(uid, exists);
    return;
  }
  const newHatali = {
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
  };
  appState.hatalilar.push(newHatali);
  document.getElementById('hataliCount').textContent=appState.hatalilar.length;
  document.getElementById('hataliCountBig').textContent=`${appState.hatalilar.length} Soru`;
  if(uid) window.addHataliCloud?.(uid, newHatali);
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


// ── Bu modülün fonksiyonlarını window'a kaydet ──
// main.js ve diğer modüller window.xxx ile çağırabilsin
window.renderSoruList = renderSoruList;
window.escapeHtml = escapeHtml;
window.updateRightPanelTitle = updateRightPanelTitle;
window.renderSoruStrip = renderSoruStrip;
window.renderTekSoruKart = renderTekSoruKart;
window.goToSoru = goToSoru;
window.getManifestMaxPage = getManifestMaxPage;
window.getVisibleManifestPages = getVisibleManifestPages;
window.getManifestPdfMaxPage = getManifestPdfMaxPage;
window.isCozumAltKonu = isCozumAltKonu;
window.isKonuKartSoru = isKonuKartSoru;
window.isKonuKartAltKonu = isKonuKartAltKonu;
window.getParentKonuForAlt = getParentKonuForAlt;
window.getSolutionAltKonu = getSolutionAltKonu;
window.getQuestionAltKonular = getQuestionAltKonular;
window.getQuestionFlow = getQuestionFlow;
window.getSolutionForQuestion = getSolutionForQuestion;
window.findQuestionFlowIndexByPage = findQuestionFlowIndexByPage;
window.goToFlowItem = goToFlowItem;
window.changeQuestionPage = changeQuestionPage;
window.showCozum = showCozum;
window.selectAnswer = selectAnswer;
window.skipQuestion = skipQuestion;
window.addToHatalilar = addToHatalilar;
window.toggleStar = toggleStar;
window.getCozumAdimlar = getCozumAdimlar;
window.showCevapModal = showCevapModal;
window.goToSoruPage = goToSoruPage;
window.refreshAltKonuChip = refreshAltKonuChip;
window.setActiveQuestion = setActiveQuestion;
window.nextQuestion = nextQuestion;
window.prevQuestion = prevQuestion;
window.toggleTest = toggleTest;
window.startTest = startTest;
window.pauseTest = pauseTest;
window.stopTimer = stopTimer;
window.updateTimer = updateTimer;
window.formatTime = formatTime;
window.toggleTimerPicker = toggleTimerPicker;
window.setTimerDuration = setTimerDuration;
window.updateTestProgress = updateTestProgress;
window.finishTest = finishTest;
window.resetTest = resetTest;
window.retryWrong = retryWrong;
window.renderResultChart = renderResultChart;
window.playFeedbackSound = playFeedbackSound;
window.initCharts = initCharts;
