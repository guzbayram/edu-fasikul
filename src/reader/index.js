import { appState } from '../state/appState.js';

function isPhoneReaderViewport(){
  if(!window.matchMedia) return false;
  return window.matchMedia('(orientation:portrait) and (max-width:700px)').matches ||
    window.matchMedia('(orientation:landscape) and (max-height:500px)').matches;
}

function markLastWorked(altKonu=null){
  const fas = appState.aktifFasikul;
  if(!fas) return;
  const now = new Date();
  const mins = now.getMinutes().toString().padStart(2,'0');
  const parentKonu = altKonu ? getParentKonuForAlt(altKonu) : appState.aktifKonu;
  fas._lastWorkedAt = Date.now();
  fas._lastKonuAd = parentKonu?.ad || fas._lastKonuAd || '';
  fas._lastAltKonuAd = altKonu?.ad || fas._lastAltKonuAd || '';
  fas.sonCalisma = `Bugün ${now.getHours()}:${mins}`;
  const dersId = appState.aktifDers?.id;
  const fasRef = dersId
    ? window.MANIFEST?.dersler.find(d=>d.id===dersId)?.fasikuller.find(f=>f.id===fas.id)
    : null;
  if(fasRef && fasRef !== fas){
    fasRef._lastWorkedAt = fas._lastWorkedAt;
    fasRef._lastKonuAd = fas._lastKonuAd;
    fasRef._lastAltKonuAd = fas._lastAltKonuAd;
    fasRef.sonCalisma = fas.sonCalisma;
  }
}

async function openReader(dersId, fasikulId){
  closeDrawer();
  if(isGuestSession() && !window.GUEST_DEMO_FASIKUL_IDS?.has(fasikulId)){
    showToast('Misafir hesabında yalnızca demo fasikül kullanılabilir','info');
    return;
  }
  const hidden = new Set(Array.isArray(appState.user?.hiddenFasikulIds) ? appState.user.hiddenFasikulIds : []);
  if(appState.user?.role !== 'admin' && hidden.has(fasikulId)){
    showToast('Bu fasikül hesabınız için gizlenmiş.','info');
    return;
  }
  const ders = window.MANIFEST?.dersler.find(d=>d.id===dersId);
  const fasikul = ders?.fasikuller.find(f=>f.id===fasikulId);
  if(!fasikul) return;

  // Kullanıcı fasikülü başka bir ders altına eklediyse metadata kalıcıdır,
  // fakat ağır konu/soru verisi her açılışta GitHub kataloğundan yeniden bağlanır.
  const bundledSource = window.BUNDLED_FASIKUL_SOURCES?.find(s =>
    s.id === fasikul.id ||
    String(s.json || '').normalize('NFC') === String(fasikul.jsonFile || '').normalize('NFC')
  );
  if(bundledSource){
    const raw=await readBundledJson(bundledSource);
    // GitHub kataloğundaki konu/soru hiyerarşisini fasiküle bağla. Eski yerel
    // kayıtta sourceType eksik olsa bile JSON adı/id eşleşiyorsa güncelle.
    if(raw) hydrateBundledFasikul(fasikul,raw,bundledSource);
  }

  appState.aktifDers = ders;
  appState.aktifFasikul = fasikul;
  normalizeFasikulKonular(fasikul.konular || [], {
    fasikulId: fasikul.id,
    sourceId: bundledSource?.id,
    json: fasikul.jsonFile || bundledSource?.json
  });
  appState.currentPage = 1;
  appState.undoStack = [];
  appState.redoStack = [];
  // Telefonda ilk dokunuş çoğunlukla sayfayı konumlandırmak için yapılıyor;
  // bu yüzden telefon açılışında pan/el, tablet ve bilgisayarda kalem hazır gelsin.
  const defaultTool = isPhoneReaderViewport() ? 'select' : 'pen';
  appState.drawTool = defaultTool;
  document.querySelectorAll('.tool-btn[data-tool]').forEach(b=>b.classList.toggle('active', b.dataset.tool===defaultTool));
  // PDF state reset
  appState.pdfDoc = null;
  appState.pdfDocFasikulId = null;
  document.getElementById('pdfUploadZone').style.display = '';
  document.getElementById('readerCanvasWrap').style.display = 'none';

  // Total pages from manifest
  const allPages = fasikul.konular.flatMap(k=>k.altKonular||[]).map(a=>a.sayfa||1);
  const maxPage = fasikul.konular.reduce((m,k)=>Math.max(m,k.sayfaBitis||1),1);
  // Bazı kitaplarda (ör. Matematik Atölyem) cevap anahtarı kitabın en
  // sonunda ayrı bir bölüm ve konu verisine hiç işlenmemiş sayfalar
  // içerebiliyor — sadece konulardan hesaplanan maxPage bu durumda
  // gerçek sayfa sayısının altında kalıp okuyucunun cevap sayfalarına
  // hiç gidememesine yol açıyordu. cevapAnahtariSayfalari (varsa) da
  // sayfa sayısı hesabına dahil edilir.
  const maxCevapPage = Array.isArray(fasikul.cevapAnahtariSayfalari) && fasikul.cevapAnahtariSayfalari.length
    ? Math.max(...fasikul.cevapAnahtariSayfalari)
    : 0;
  appState.totalPages = Math.max(maxPage, maxCevapPage, 20);

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
  window.scheduleReaderViewportReflow?.();
  // Telefonda eski yan panel kısa süre bile görünmesin; Adsız 22 paneline hemen geç.
  window.autoSolveForLandscape?.();
  setTimeout(()=>window.autoSolveForLandscape?.(), 350);
  // iOS: body kaydırılmışsa fixed overlay'de dokunma/çizim scrollY kadar kayıyor.
  // Body'yi mevcut konumda kilitle (scrollY=0) → koordinat hizalı.
  appState._savedScrollY = window.scrollY || window.pageYOffset || 0;
  document.body.style.top = `-${appState._savedScrollY}px`;
  document.body.classList.add('reader-locked');
  // Konu listesi görünür başlar
  document.getElementById('readerRight')?.classList.remove('soru-mode');
  document.getElementById('rpKonuSection')?.classList.remove('hidden');

  // Context menu başlat (sağ tık ile mod seçimi)
  initPDFContextMenu();

  // Son ziyaret edilen konuyu veya ilk konuyu seç
  const konular = fasikul.konular || [];
  const lastKonuId = fasikul._lastKonuId;
  const lastAltKonuId = fasikul._lastAltKonuId;
  const hasSolvable = k => (k?.altKonular||[]).some(ak => ak.ad !== 'Çözümlü Sorular - Çözümler' && (ak.sorular||[]).length);
  // İlk konu artık soru içermeyen bir TOC başlığı olabilir (topics+tests karışık).
  // Başlangıçta ilk ÇÖZÜLEBİLİR konuyu (test) seç ki soru paneli açılsın.
  let startKonu = (lastKonuId && konular.find(k => k.id === lastKonuId && hasSolvable(k)))
    || konular.find(hasSolvable) || konular[0];
  const visibleAlts = (startKonu?.altKonular||[]).filter(ak => ak.ad !== 'Çözümlü Sorular - Çözümler');
  // "Konu Sayfaları" gibi sorusuz (saf anlatım) alt konular listede İLK sırada
  // olabilir (ör. Aktif TYT Matematik fasikülleri) — varsayılan olarak seçilirse
  // soru paneli boş açılır (cevap butonları/konu listesi gözükmez). Sorusu OLAN
  // ilk alt konuyu tercih et, hiçbiri yoksa ilk alt konuya geri düş.
  let startAlt = (lastAltKonuId && visibleAlts.find(ak => ak.id === lastAltKonuId))
    || visibleAlts.find(ak => (ak.sorular||[]).length > 0)
    || visibleAlts[0] || null;
  if(startKonu){
    // ana konu listesinde aktif işaretle
    document.querySelectorAll('.ana-konu-item').forEach(el => el.classList.remove('active'));
    const itemEl = document.getElementById(`anak-${startKonu.id || startKonu.ad}`);
    if(itemEl) itemEl.classList.add('active');
  }
  if(startAlt && startAlt.sorular?.length > 0) selectAltKonu(startAlt, `altk-${startAlt.id}`);
  else markLastWorked(null);

  // PDF'i önce profil sayfasında bir kez bağlanan klasörden otomatik aç.
  // Klasörde bulunamazsa eski kayıtlı PDF yedeğine bakılır; en son manuel yükleme alanı görünür.
  try{
    const openedFromFolder = await ensureReaderPdfLoaded(appState.currentPage);
    if(!openedFromFolder){
      const saved = await getPDFFromDB(dersId, fasikulId);
      if(saved && saved.blob){
        await loadPDFFile(saved.blob);
      }
    }
  }catch(e){ /* yoksay */ }
  window.publishCanli?.();
  window.startCanliPresence?.();   // aynı fasikülde canlı katılımcı listesi
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

function openTopicPage(konu, closeModal=true){
  if(!konu) return;
  appState.aktifKonu = konu;
  appState.aktifAltKonu = null;
  appState.activeQuestionIdx = 0;
  if(appState.aktifFasikul){
    appState.aktifFasikul._lastKonuId = konu.id || null;
    appState.aktifFasikul._lastAltKonuId = null;
  }
  const select = document.getElementById('anaKonuSelect');
  if(select) select.value = konu.id || konu.ad || '';
  document.querySelectorAll('.ana-konu-item').forEach(el => el.classList.remove('active'));
  const itemEl = document.getElementById(`anak-${konu.id || konu.ad}`);
  if(itemEl) itemEl.classList.add('active');
  renderAltKonuList(konu);
  updateRightPanelTitle(konu.ad);
  const rpSay = document.getElementById('rpSoruSayisi');
  if(rpSay) rpSay.textContent = 'Konu';
  const list = document.getElementById('soruList');
  if(list){
    list.innerHTML = `<div class="tek-soru-card" id="tekSoruCard"><div style="text-align:center;padding:32px 18px;color:var(--text-muted)"><div style="font-size:30px;margin-bottom:8px">📄</div><div style="font-size:12px;opacity:.75">Konu anlatım sayfası — bu bölümde çözülecek soru yok.</div></div></div>`;
  }
  renderSoruStrip([]);
  updateTestProgress();
  // Konu anlatımında da sol paneldeki "Konu Listesi" başlığı/butonu görünür
  // kalsın; sadece eski test/soru kartı temizlenir.
  document.getElementById('readerRight')?.classList.add('soru-mode');
  appState._suppressNavSync = false;
  if(konu.sayfa) goToPage(konu.sayfa);
  if(closeModal) closeKonuModal();
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
  if(!visibleAlts.length){
    openTopicPage(konu, true);
    return;
  }

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
  const targetAlt = lastAk || visibleAlts.find(ak => (ak.sorular||[]).length > 0) || visibleAlts[0] || null;
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
  window.stopCanliPresence?.();   // canlı oturumdan çık (kendi presence dokümanını sil)
  const returnDersId = appState.aktifDers?.id || window.currentDrawerDers?.id || null;
  saveDrawing();
  stopTimer();
  // sonCalisma güncelle (fasikül kapatılmadan önce)
  if(appState.aktifFasikul){
    const fas = appState.aktifFasikul;
    const hasActivity = Object.values(appState.sorularState||{}).some(s=>s&&s.fasikulId===fas.id&&s.answered);
    if(hasActivity) markLastWorked(appState.aktifAltKonu);
  }
  recalcFasikulProgress();
  updateDashboard();
  persistManifest();
  renderDerslerGrid();
  if(window.currentDrawerDers) renderFasikulCards(window.currentDrawerDers.fasikuller, window.currentDrawerDers);
  document.getElementById('reader-overlay').classList.remove('open');
  window.clearReaderViewport?.();
  // Body kilidini aç ve önceki scroll konumunu geri yükle
  document.body.classList.remove('reader-locked');
  document.body.style.top = '';
  window.scrollTo(0, appState._savedScrollY || 0);
  appState.aktifFasikul = null;
  appState.aktifAltKonu = null;
  appState.pdfDoc = null;
  appState.pdfDocFasikulId = null;
  // Tüm fabric canvas'ları temizle
  Object.values(appState.fabricCanvases||{}).forEach(fc=>{ try{fc.dispose();}catch(e){} });
  appState.fabricCanvases = {};
  if(appState.fabricCanvas){ try{appState.fabricCanvas.dispose();}catch(e){} appState.fabricCanvas=null; }
  if(appState._pageObserver){ appState._pageObserver.disconnect(); appState._pageObserver=null; }
  if(returnDersId){
    setTimeout(()=>window.openDrawer?.(null, returnDersId), 0);
  }
}

// ── Konu Nav
// ── Sayfa numarasına göre sol paneli (ana konu + alt konu) senkronize et

function altKonuHasExactPage(altKonu, pageNum){
  if(!altKonu || !pageNum) return false;
  const page = Number(pageNum);
  if(Number(altKonu.sayfa) === page) return true;
  return (altKonu.sorular || []).some(s => questionCoversPage(s, page));
}

function questionCoversPage(soru, pageNum){
  const page = Number(pageNum || 0);
  const start = Number(soru?.sayfa || 0);
  if(!page || !start) return false;
  const end = Number(soru?.sayfaBitis || start);
  return page >= start && page <= end;
}

function renderQuestionlessTopicPage(owner, pageNum, text){
  if(!owner) return;
  appState.aktifKonu = owner;
  appState.aktifAltKonu = null;
  appState.activeQuestionIdx = 0;

  const select = document.getElementById('anaKonuSelect');
  if(select) select.value = owner.id || owner.ad || '';
  renderAltKonuList(owner);
  updateRightPanelTitle(owner.ad);
  window.updateKonuDropdownLabel?.();

  const rpSay = document.getElementById('rpSoruSayisi');
  if(rpSay) rpSay.textContent = 'Konu';
  const list = document.getElementById('soruList');
  if(list){
    list.innerHTML = `<div class="tek-soru-card" style="text-align:center;padding:32px 18px;color:var(--text-muted)"><div style="font-size:30px;margin-bottom:8px">📄</div><div style="font-size:12px;opacity:.75">${text || 'Bu sayfada cevaplanacak seçenekli soru yok.'}</div></div>`;
  }
  window.renderSoruStrip?.([]);
  window.updateTestProgress?.();
}

function getActiveOwnerForExactPage(pageNum){
  const activeAlt = appState.aktifAltKonu;
  if(activeAlt && altKonuHasExactPage(activeAlt, pageNum)){
    return {
      konu: getParentKonuForAlt(activeAlt) || appState.aktifKonu,
      alt: activeAlt
    };
  }
  const activeKonu = appState.aktifKonu;
  if(!activeAlt && activeKonu && Number(activeKonu.sayfa || 0) === Number(pageNum)){
    return { konu: activeKonu, alt: null };
  }
  return { konu: null, alt: null };
}

// Sağdaki PDF'in bulunduğu konu/test başlığını "S.N / Sayfa" satırının üstünde göster.
function updatePageCrumb(pageNum){
  const el = document.getElementById('pageCrumb');
  if(!el) return;
  const fas = appState.aktifFasikul;
  const page = pageNum || appState.currentPage;
  if(!fas?.konular?.length || !page){ el.style.display='none'; return; }
  let owner = null;
  const activeOwner = getActiveOwnerForExactPage(page);
  if(activeOwner.konu) owner = activeOwner.konu;
  // 1) Sayfaya TAM oturan tek sayfalık konu (ör. bir konu anlatım başlığı
  //    tam bu sayfada başlıyorsa) — bu en spesifik eşleşme, her zaman kazanır.
  if(!owner) owner = fas.konular.find(k => k.sayfa === page && !(k.sayfaBasl && k.sayfaBitis && k.sayfaBitis > k.sayfaBasl));
  // 2) Yoksa: aralığı kapsayan VEYA tekil sayfası <= page olan konular arasında
  //    en YÜKSEK başlangıç sayfası kazanır (eşitlikte en dar aralık). Böylece
  //    hem "Kazanım Tadında Sorular" gibi kitabın tamamını kapsayan numarasız
  //    üst başlıklar asıl testlerin/konuların önüne geçmiyor, hem de aralığı
  //    olmayan tekil sayfa konu anlatım başlıkları (ör. "Doğal Sayılarla
  //    Çarpma İşlemi") kendi sayfasından bir sonraki başlığa kadar geçerli
  //    kalıyor — yalnızca EN SON eşleşen tam sayfaya sahip olduğu için değil.
  if(!owner){
    let bestPage = -1;
    let bestWidth = Infinity;
    for(const k of fas.konular){
      const inRange = k.sayfaBasl && k.sayfaBitis && page>=k.sayfaBasl && page<=k.sayfaBitis;
      const candidatePage = inRange ? k.sayfaBasl : ((k.sayfa||0) <= page ? k.sayfa : null);
      if(candidatePage == null) continue;
      const width = inRange ? (k.sayfaBitis - k.sayfaBasl) : 0;
      if(candidatePage > bestPage || (candidatePage === bestPage && width < bestWidth)){
        bestPage = candidatePage; bestWidth = width; owner = k;
      }
    }
  }
  if(!owner){ el.style.display='none'; return; }
  const isTest = owner.tur==='test' || (owner.altKonular||[]).some(ak=>(ak.sorular||[]).length);
  el.innerHTML = `<span class="pc-ico">${isTest?'📝':'📄'}</span><span class="pc-text">${owner.ad}</span><span class="pc-page">s.${page}</span>`;
  el.style.display='';
}

function syncNavToPage(pageNum){
  updatePageCrumb(pageNum);
  if(appState._suppressNavSync) return;
  const fas = appState.aktifFasikul;
  if(!fas || !fas.konular) return;

  // Hangi ana konu bu sayfayı kapsar? TÜM kitap taranır — yalnızca dizideki
  // ilk "kart bazlı" konuyla sınırlı kalınmaz. Her testin kendi üst konusu
  // olduğu kitaplarda (ör. Arı Soru Bankası, Matematik Atölyem) eski kod
  // döngüyü İLK testte (Test 1) "en yakın sayfa" bulur bulmaz kırıyordu; bu
  // yüzden sayfa Test 1'i çoktan geçmiş olsa bile sol panel hep Test 1'in
  // son sorusunda donup kalıyordu. Şimdi tam eşleşme bulunur bulunmaz kesin
  // kazanır, yoksa TÜM konular/alt konular arasından pageNum'a en yakın
  // (sayfası <= pageNum olan en büyük sayfa) aday seçilir.
  let targetKonu = null;
  let targetAlt = null;
  let bestPage = -1;
  const activeOwner = getActiveOwnerForExactPage(pageNum);
  if(activeOwner.konu && activeOwner.alt){
    targetKonu = activeOwner.konu;
    targetAlt = activeOwner.alt;
    bestPage = Number(pageNum);
  }

  outer:
  for(const konu of (targetAlt ? [] : fas.konular)){
    // Kart bazlı konu: her soru kendi sayfasında → sorular içinde sayfa ara
    // Kart bazlı tespit: altKonunun sorularında sayfa alanı varsa → her soru ayrı sayfada
    const _ilkAk = konu.altKonular?.[0];
    const _konuKartBazli = _ilkAk && _ilkAk.sorular?.length > 0 && !!_ilkAk.sorular[0]?.sayfa;
    if(_konuKartBazli){
      let firstQuestionPage = Infinity;
      for(const ak of konu.altKonular || []){
        // Tam eşleşme (kesin sahip) → kesin kazanır. Kartlar süreksiz
        // sayfalarda olabildiği için (ör. Konu Kartları: 1,2,11,21) gevşek
        // "ilk..son" aralığı yanlış altKonuyu seçtiriyordu.
        if((ak.sorular||[]).some(s => questionCoversPage(s, pageNum))){
          targetKonu = konu; targetAlt = ak;
          break outer;
        }
        // Tam eşleşme yoksa: sayfası <= pageNum olan en yakın kart (kitap geneli)
        for(const s of ak.sorular || []){
          const sp = s.sayfa || 0;
          if(sp && sp < firstQuestionPage) firstQuestionPage = sp;
          if(sp <= pageNum && sp > bestPage){ bestPage = sp; targetKonu = konu; targetAlt = ak; }
        }
      }
      // Bazı fasiküllerde ünite açılış/uygulama sayfası, ilk seçenekli sorudan
      // bir sayfa önce gelir. Bu sayfada A-E seçenekli soru yoksa önceki testin
      // son kartı panelde kalmamalı.
      if(firstQuestionPage !== Infinity && firstQuestionPage - pageNum === 1 && pageNum > bestPage){
        bestPage = pageNum;
        targetKonu = konu;
        targetAlt = null;
      }
      continue;
    }

    // Normal konu: alt konular arasında tam sayfa eşleşmesi ara
    let normalNearest = null;
    for(const ak of konu.altKonular || []){
      if(ak.sayfa === pageNum){
        targetKonu = konu;
        targetAlt = ak;
        break outer;
      }
      if((ak.sayfa||0) <= pageNum) normalNearest = ak;
    }
    if(normalNearest && normalNearest.sayfa > bestPage){
      bestPage = normalNearest.sayfa;
      targetKonu = konu;
      targetAlt = normalNearest;
    }

    // Bu konunun gerçek sorusu yoksa (salt konu anlatım başlığı — ör. "Konu
    // Tekrarı" gibi geniş aralıklı bir yer tutucu OLABİLİR ya da "Doğal
    // Sayılarla Çarpma İşlemi" gibi TEK sayfaya sabit bir başlık) sayfaBasl-
    // sayfaBitis aralığına ya da tekil sayfa numarasına bakılır. Bu adaylar
    // gerçek testlerle AYNI bestPage yarışına girer — yalnızca kitap
    // genelinde daha yakın bir gerçek soru adayı yoksa kazanır, aksi halde
    // (ör. "Kazanım Tadında Sorular" gibi kitabın tamamını kapsayan
    // numarasız üst başlıklar) gerçek testlerin önüne geçmez.
    const konuHasRealAlt = (konu.altKonular||[]).some(ak=>(ak.sorular||[]).length);
    if(!konuHasRealAlt){
      const inRange = konu.sayfaBasl && konu.sayfaBitis && pageNum>=konu.sayfaBasl && pageNum<=konu.sayfaBitis;
      const candidatePage = inRange ? konu.sayfaBasl : ((konu.sayfa||0) <= pageNum ? konu.sayfa : null);
      if(candidatePage != null && candidatePage > bestPage){
        bestPage = candidatePage;
        targetKonu = konu;
        if(inRange){
          // Aralık içinde en yakın alt konuyu bul (sayfası <= currentPage olan en son)
          let best = null;
          for(const ak of konu.altKonular || []){
            if((ak.sayfa || 0) <= pageNum) best = ak;
          }
          targetAlt = best || konu.altKonular?.[0] || null;
        } else {
          targetAlt = null;
        }
      }
    }
  }

  // Test/alt konu bulunamadıysa → bu bir KONU (anlatım) sayfası olabilir.
  // Sol paneli o konuya çevir ki eski testin kartında takılı kalmasın.
  if(!targetAlt){
    // Yukarıdaki döngü zaten targetKonu'yu (konu anlatım başlığı kazandıysa)
    // doğru şekilde belirlemiş olabilir — o zaman tekrar aramaya gerek yok.
    // Yalnızca hiçbir aday bulunamadıysa (ör. kitabın en başı, içerik
    // başlamadan önceki sayfalar) bağımsız bir son çare araması yapılır.
    let owner = targetKonu;
    if(!owner){
      for(const k of fas.konular){ if((k.sayfa||0)<=pageNum && (!owner || (k.sayfa||0)>=(owner.sayfa||0))) owner=k; }
    }
    const ownerIsTest = owner && (owner.tur==='test' || (owner.altKonular||[]).some(ak=>(ak.sorular||[]).length));
    if(owner && !ownerIsTest){
      if(appState.aktifKonu?.id !== owner.id || appState.aktifAltKonu){
        // Konu adı zaten updateRightPanelTitle() ile üstteki başlıkta gösteriliyor —
        // burada tekrar basmıyoruz (mükerrer görünüp satır bölünmesine yol açıyordu).
        renderQuestionlessTopicPage(owner, pageNum, 'Konu anlatım sayfası — bu bölümde çözülecek soru yok.');
      }
      return;
    }
    if(owner && ownerIsTest){
      renderQuestionlessTopicPage(owner, pageNum, 'Bu sayfada cevaplanacak seçenekli soru yok.');
      return;
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
      const exactIdx = sorular.findIndex(s => questionCoversPage(s, pageNum));
      if(exactIdx < 0){
        renderQuestionlessTopicPage(targetKonu, pageNum, 'Bu sayfada cevaplanacak seçenekli soru yok.');
        return;
      }
      appState.activeQuestionIdx = exactIdx;
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
      // Aynı sayfada birden fazla soru olabilir. Sayfa değişince o sayfanın ilk
      // sorusuna geç; kullanıcı aynı sayfadaki başka bir soruyu seçtiyse koru.
      const sorular = targetAlt.sorular || [];
      const activeIsOnPage = questionCoversPage(sorular[appState.activeQuestionIdx], pageNum);
      let bestIdx = activeIsOnPage ? appState.activeQuestionIdx : sorular.findIndex(s => questionCoversPage(s, pageNum));
      if(bestIdx < 0){
        renderQuestionlessTopicPage(targetKonu, pageNum, 'Bu sayfada cevaplanacak seçenekli soru yok.');
        return;
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
  // Konu Listesi, sağdaki PDF'teki gerçek sayfa sırasını yansıtsın diye
  // gösterim sırasında sayfaya göre sıralanır — JSON'daki dizi sırası çoğu
  // kaynakta "önce tüm Kazanım testleri, sonra tüm Alıştırma testleri..."
  // şeklinde bölüm bölüm gruplanmış olabiliyor, oysa kitapta bu testler
  // sayfa sayfa iç içe geçmiş durumda.
  const konularSirali = [...konular].sort((a,b)=>{
    const pa = a.sayfaBasl ?? a.sayfa ?? Infinity;
    const pb = b.sayfaBasl ?? b.sayfa ?? Infinity;
    return pa - pb;
  });
  konularSirali.forEach(k=>{
    // Hidden select option
    if(select){
      const opt = document.createElement('option');
      opt.value = k.id || k.ad; opt.textContent = k.ad;
      select.appendChild(opt);
    }
    // Görünür liste öğesi
    if(list){
      const item = document.createElement('div');
      item.id = `anak-${k.id || k.ad}`;
      const solvable = (k.altKonular||[]).filter(ak => ak.ad !== 'Çözümlü Sorular - Çözümler' && (ak.sorular||[]).length);
      if(!solvable.length){
        // TOC başlığı (soru yok) → tıklayınca ilgili PDF sayfasına git; liste
        // açık kalsın ki kullanıcı konu anlatım başlıkları arasında gezebilsin.
        item.className = 'ana-konu-item ana-konu-topic';
        item.innerHTML = `<span class="anak-name">📄 ${k.ad}</span>${k.sayfa ? `<span class="anak-chip">s.${k.sayfa}</span>` : ''}`;
        item.onclick = () => {
          openTopicPage(k, false);
        };
      } else {
        item.className = 'ana-konu-item ana-konu-test';
        const soruSayisi = solvable.reduce((s,ak)=>s+(ak.sorular||[]).length,0);
        const sayfaChip = k.sayfa ? `<span class="anak-chip anak-chip-page">s.${k.sayfa}</span>` : '';
        item.innerHTML = `<span class="anak-name">📝 ${k.ad}</span><span class="anak-chip">${soruSayisi}</span>${sayfaChip}`;
        item.onclick = () => selectAnaKonu(k);
      }
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
  const firstAlt = visibleAlts.find(ak => (ak.sorular||[]).length > 0) || visibleAlts[0] || null;

  renderAltKonuList(konu);
  if(firstAlt){
    selectAltKonu(firstAlt, `altk-${firstAlt.id}`);
  } else {
    openTopicPage(konu, true);
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
  markLastWorked(altKonu);
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
