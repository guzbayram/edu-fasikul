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
  // Her fasikül açılışında varsayılan araç: ✋ Gez (pan/kaydır/soru geçişi)
  // — PDF yüklenince canvas applyTool(appState.drawTool) ile uygular.
  appState.drawTool = 'select';
  document.querySelectorAll('.tool-btn[data-tool]').forEach(b=>b.classList.toggle('active', b.dataset.tool==='select'));
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
  // Konu listesi görünür başlar
  document.getElementById('readerRight')?.classList.remove('soru-mode');
  document.getElementById('rpKonuSection')?.classList.remove('hidden');

  // Context menu başlat (sağ tık ile mod seçimi)
  initPDFContextMenu();

  // Son ziyaret edilen konuyu veya ilk konuyu seç
  const konular = fasikul.konular || [];
  const lastKonuId = fasikul._lastKonuId;
  const lastAltKonuId = fasikul._lastAltKonuId;
  let startKonu = (lastKonuId && konular.find(k => k.id === lastKonuId)) || konular[0];
  const visibleAlts = (startKonu?.altKonular||[]).filter(ak => ak.ad !== 'Çözümlü Sorular - Çözümler');
  let startAlt = (lastAltKonuId && visibleAlts.find(ak => ak.id === lastAltKonuId)) || visibleAlts[0] || null;
  if(startKonu){
    // ana konu listesinde aktif işaretle
    document.querySelectorAll('.ana-konu-item').forEach(el => el.classList.remove('active'));
    const itemEl = document.getElementById(`anak-${startKonu.id || startKonu.ad}`);
    if(itemEl) itemEl.classList.add('active');
  }
  if(startAlt && startAlt.sorular?.length > 0) selectAltKonu(startAlt, `altk-${startAlt.id}`);

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
  window.publishCanli?.();
}

function toggleMobileLeft(){
  toggleRpKonuSection();
}

function openKonuList(){
  const backdrop = document.getElementById('konuModalBackdrop');
  const modal    = document.getElementById('konuModal');
  if(!backdrop || !modal) return;
  backdrop.style.display = 'block';
  modal.style.display    = 'flex';
  document.getElementById('reader-overlay')?.classList.add('konu-modal-open');
  showKonuPanel();
}

function closeKonuModal(){
  document.getElementById('konuModalBackdrop').style.display = 'none';
  document.getElementById('konuModal').style.display = 'none';
  document.getElementById('reader-overlay')?.classList.remove('konu-modal-open');
}

function showKonuPanel(){
  document.getElementById('konuModalBodyA')?.classList.remove('hidden');
  document.getElementById('konuModalBodyB')?.classList.add('hidden');
  const backBtn = document.getElementById('konuModalBackBtn');
  if(backBtn) backBtn.style.display = 'none';
  const title = document.getElementById('konuModalTitle');
  if(title) title.textContent = appState.aktifFasikul?.ad || 'Konu Seç';
}

function selectAnaKonu(konu){
  if(!konu) return;
  appState.aktifKonu = konu;
  const select = document.getElementById('anaKonuSelect');
  if(select) select.value = konu.id || konu.ad || '';
  // Active görsel (modal listesinde)
  document.querySelectorAll('.ana-konu-item').forEach(el => el.classList.remove('active'));
  const itemEl = document.getElementById(`anak-${konu.id || konu.ad}`);
  if(itemEl) itemEl.classList.add('active');

  const visibleAlts = (konu.altKonular||[]).filter(ak => ak.ad !== 'Çözümlü Sorular - Çözümler');

  // Tek alt konu varsa direkt seç, altPanel'i gösterme
  if(visibleAlts.length === 1){
    selectAltKonu(visibleAlts[0], `altk-${visibleAlts[0].id}`);
    return;
  }

  // Modal başlığını güncelle
  const title = document.getElementById('konuModalTitle');
  if(title) title.textContent = konu.ad;
  // AltKonu listesini doldur
  renderAltKonuList(konu);
  // Panel B'ye geç
  document.getElementById('konuModalBodyA')?.classList.add('hidden');
  document.getElementById('konuModalBodyB')?.classList.remove('hidden');
  const backBtn = document.getElementById('konuModalBackBtn');
  if(backBtn) backBtn.style.display = 'inline-flex';
  // İlk ya da son ziyaret edilen altKonuyu highlight et
  const fas = appState.aktifFasikul;
  const lastAkId = fas?._lastAltKonuId;
  const lastAk = lastAkId && visibleAlts.find(ak => ak.id === lastAkId && konu.id === fas?._lastKonuId);
  const targetAlt = lastAk || visibleAlts[0] || null;
  if(targetAlt){
    document.querySelectorAll('#altKonuList .alt-konu-item').forEach(el => el.classList.remove('active'));
    const el = document.getElementById(`altk-${targetAlt.id}`);
    if(el){ el.classList.add('active'); el.scrollIntoView({behavior:'instant',block:'nearest'}); }
  }
}

function toggleRpKonuSection(){
  const konuSec = document.getElementById('rpKonuSection');
  const right = document.getElementById('readerRight');
  if(!konuSec) return;
  const inSoruMode = right?.classList.contains('soru-mode');
  if(inSoruMode){
    right.classList.remove('soru-mode');
  } else {
    if(konuSec.classList.contains('hidden')){
      konuSec.classList.remove('hidden');
    } else {
      konuSec.classList.add('hidden');
    }
  }
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
  const list = document.getElementById('anaKonuList');
  if(select) select.innerHTML = '';
  if(list) list.innerHTML = '';
  const konular = Array.isArray(fasikul?.konular) ? fasikul.konular : [];
  if(!konular.length){
    appState.aktifKonu = null;
    appState.aktifAltKonu = null;
    if(list) list.innerHTML = '<div style="padding:16px;font-size:12px;color:var(--text-muted)">Bu fasikülde konu eklenmemiş.</div>';
    renderSoruList([]);
    updateRightPanelTitle();
    return;
  }
  konular.forEach(k=>{
    // Hidden select option
    if(select){
      const opt = document.createElement('option');
      opt.value = k.id || k.ad; opt.textContent = k.ad;
      select.appendChild(opt);
    }
    // Görünür liste öğesi
    if(list){
      const item = document.createElement('div');
      item.className = 'ana-konu-item';
      item.id = `anak-${k.id || k.ad}`;
      const altCount = (k.altKonular||[]).filter(ak => ak.ad !== 'Çözümlü Sorular - Çözümler').length;
      item.innerHTML = `<span class="anak-name">${k.ad}</span>${altCount > 0 ? `<span class="anak-chip">${altCount}</span>` : ''}`;
      item.onclick = () => selectAnaKonu(k);
      list.appendChild(item);
    }
  });
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
  const firstAlt = visibleAlts[0] || null;

  renderAltKonuList(konu);
  if(firstAlt){
    selectAltKonu(firstAlt, `altk-${firstAlt.id}`);
  }
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
  const isVid = isVideoFasikul();
  konu.altKonular.filter(ak=> ak.ad !== 'Çözümlü Sorular - Çözümler').forEach(ak=>{
    const isKonuKartlari = isKonuKartAltKonu(ak);
    const isVideoRow = isVid && !!ak.konuVideoUrl;
    const solvedCount = ak.sorular ? ak.sorular.filter(s=>appState.sorularState[s._uid||s.no]?.answered).length : 0;
    const totalCount = ak.sorular?.length||0;
    const watched = isVideoRow ? isVideoWatched(ak) : false;
    const isDone = isVideoRow
      ? (watched && totalCount>0 && solvedCount===totalCount)
      : (!isKonuKartlari && totalCount>0 && solvedCount===totalCount);
    const item = document.createElement('div');
    const itemId = `altk-${ak.id}`;
    const isActive = appState.aktifAltKonu && (appState.aktifAltKonu === ak || appState.aktifAltKonu.id === ak.id);
    item.className='alt-konu-item'+(isDone?' done':'')+(isActive?' active':'');
    item.id = itemId;
    let chip;
    if(isVideoRow){
      chip = `<span class="akn-chip">${watched ? `✅ ${solvedCount}/${totalCount}` : '🔒 Video'}</span>`;
    } else if(totalCount>0){
      chip = `<span class="akn-chip">${isKonuKartlari ? `${totalCount} Kart` : `${solvedCount}/${totalCount}`}</span>`;
    } else { chip = ''; }
    item.innerHTML=`
      <div class="akn-icon-wrap">${isVideoRow ? '🎬' : ''}</div>
      <span class="akn-name">${ak.ad}</span>
      ${chip}`;
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
  // Son konumu fasikülde kaydet
  if(appState.aktifFasikul){
    appState.aktifFasikul._lastAltKonuId = altKonu.id;
    appState.aktifFasikul._lastKonuId = parentKonu?.id || null;
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
  // Konu modalı kapat, soru moduna geç
  closeKonuModal();
  document.getElementById('readerRight')?.classList.add('soru-mode');
  window.publishCanli?.();
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
window.toggleRpKonuSection = toggleRpKonuSection;
window.openKonuList = openKonuList;
window.closeKonuModal = closeKonuModal;
window.showKonuPanel = showKonuPanel;
window.selectAnaKonu = selectAnaKonu;
window.closeReader = closeReader;
window.syncNavToPage = syncNavToPage;
window.buildKonuNav = buildKonuNav;
window.onAnaKonuChange = onAnaKonuChange;
window.renderAltKonuList = renderAltKonuList;
window.selectAltKonu = selectAltKonu;
