import { appState } from '../state/appState.js';

async function openReader(dersId, fasikulId){
  closeDrawer();
  if(isGuestSession() && !window.GUEST_DEMO_FASIKUL_IDS?.has(fasikulId)){
    showToast('Misafir hesabında yalnızca demo fasikül kullanılabilir','info');
    return;
  }
  const ders = window.MANIFEST?.dersler.find(d=>d.id===dersId);
  const fasikul = ders?.fasikuller.find(f=>f.id===fasikulId);
  if(!fasikul) return;

  // Kullanıcı fasikülü başka bir ders altına eklediyse metadata kalıcıdır,
  // fakat ağır konu/soru verisi her açılışta GitHub kataloğundan yeniden bağlanır.
  if(fasikul.sourceType==='bundled'){
    const source=window.BUNDLED_FASIKUL_SOURCES?.find(s=>s.id===fasikul.id || s.json===fasikul.jsonFile);
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
      ? window.MANIFEST?.dersler.find(d=>d.id===dersId)?.fasikuller.find(f=>f.id===fas.id)
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
  if(window.currentDrawerDers) renderFasikulCards(window.currentDrawerDers.fasikuller, window.currentDrawerDers);
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


// ── Bu modülün fonksiyonlarını window'a kaydet ──
// main.js ve diğer modüller window.xxx ile çağırabilsin
window.openReader = openReader;
window.toggleMobileLeft = toggleMobileLeft;
window.closeReader = closeReader;
window.syncNavToPage = syncNavToPage;
window.buildKonuNav = buildKonuNav;
window.onAnaKonuChange = onAnaKonuChange;
window.renderAltKonuList = renderAltKonuList;
window.selectAltKonu = selectAltKonu;
