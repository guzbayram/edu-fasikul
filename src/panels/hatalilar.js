import { appState } from '../state/appState.js';

function renderHatalilar(){
  const list=document.getElementById('hataliList');
  list.innerHTML='';
  const dersFilter=document.getElementById('hataliDersFilter').value;
  let filtered=[...appState.hatalilar];
  if(dersFilter) filtered=filtered.filter(h=>h.ders===dersFilter);
  const sort=document.getElementById('hataliSortFilter').value;
  if(sort==='yanlis') filtered.sort((a,b)=>b.yanlisSayisi-a.yanlisSayisi);
  else if(sort==='ders') filtered.sort((a,b)=>a.ders.localeCompare(b.ders));

  if(!filtered.length){
    list.innerHTML='<div style="text-align:center;padding:48px;color:var(--text-muted)"><div style="font-size:48px;margin-bottom:12px">🎉</div><div style="font-size:16px;font-weight:600">Harika! Hiç hatalı sorun yok.</div></div>';
    return;
  }
  const dersRenkler={mat:'var(--mat)',fiz:'var(--fiz)',kim:'var(--kim)',bio:'var(--bio)',tar:'var(--tar)',edb:'var(--edb)'};
  filtered.forEach((h,i)=>{
    const card=document.createElement('div');
    card.className='hatali-card';
    card.innerHTML=`
      <div class="hatali-ders-dot" style="background:${dersRenkler[h.ders]||'var(--mat)'}"></div>
      <div class="hatali-info">
        <div class="hatali-breadcrumb">${h.dersAd} → ${h.konu}</div>
        <div class="hatali-soru-no">Soru ${h.soruEtiket || h.soruNo}</div>
        <div class="hatali-meta">${h.tarih} · <span>${h.yanlisSayisi}× yanlış</span></div>
      </div>
      <div class="hatali-actions">
        <button class="hatali-action ha-pdf" onclick="openHataliInReader(${appState.hatalilar.indexOf(h)})">📄 PDF'de Gör</button>
        <button class="hatali-action ha-ok" onclick="removeHatali(${appState.hatalilar.indexOf(h)});showToast('Öğrenildi olarak işaretlendi ✅','success')">✅ Öğrendim</button>
        <button class="hatali-action ha-sil" onclick="removeHatali(${appState.hatalilar.indexOf(h)})">🗑️</button>
      </div>`;
    list.appendChild(card);
  });
}
function removeHatali(idx){
  const removed = appState.hatalilar[idx];
  appState.hatalilar.splice(idx,1);
  document.getElementById('hataliCount').textContent=appState.hatalilar.length;
  document.getElementById('hataliCountBig').textContent=`${appState.hatalilar.length} Soru`;
  // Buluttan da sil
  const uid = window._getUserKey?.();
  if(uid && removed?.soruKey) window.removeHataliCloud?.(uid, removed.soruKey);
  try{ localStorage.setItem('edu_hatalilar',JSON.stringify(appState.hatalilar)); }catch(e){}
  renderHatalilar();
  window.showToast?.('Hatalılar defterinden kaldırıldı','info');
}
function startTekrarModu(){
  if(!appState.hatalilar.length){ showToast('Hatalılar listeniz boş!','info'); return; }
  // Build a virtual alt konu from hatalilar
  const allSorular = [];
  appState.hatalilar.forEach(h => {
    // Try to find in manifest
    for(const ders of window.MANIFEST.dersler){
      for(const fas of ders.fasikuller||[]){
        for(const konu of fas.konular||[]){
          for(const ak of konu.altKonular||[]){
            const s = ak.sorular?.find(q=>q.no===h.soruNo);
            if(s) { allSorular.push({...s, sayfa: s.sayfa||ak.sayfa, _dersId:ders.id, _fasId:fas.id}); }
          }
        }
      }
    }
  });
  if(!allSorular.length){
    // Create dummy questions from hatalilar
    appState.hatalilar.forEach(h=>{
      allSorular.push({no:h.soruNo, onizleme:`Soru ${h.soruNo} — ${h.konu}`, cevap:'A', zorluk:'orta', sayfa:1});
    });
  }
  // Pick first ders/fasikul as context (or use mat/analitik as fallback)
  const firstH = appState.hatalilar[0];
  let contextDers = window.MANIFEST.dersler.find(d=>d.id===firstH.ders)||window.MANIFEST.dersler[0];
  let contextFas = contextDers.fasikuller[0];

  appState.aktifDers = contextDers;
  appState.aktifFasikul = contextFas;
  appState.aktifAltKonu = {
    id:'tekrar-modu',
    ad:`Tekrar Modu (${allSorular.length} Hatalı Soru)`,
    sayfa:1,
    sorular:allSorular
  };
  appState.sorularState = {};
  appState.activeQuestionIdx = 0;

  // Open reader
  openReader(contextDers, contextFas);

  setTimeout(()=>{
    updateRightPanelTitle('🔁 Tekrar Modu');
    renderSoruList(allSorular);
    const startBtn = document.getElementById('startTestBtn');
    startBtn.classList.add('tekrar-modu-active');
    showToast(`Tekrar modu: ${allSorular.length} hatalı soru yüklendi 🔁`, 'info');
  }, 300);
}
function findHataliContext(h){
  const wantedKeys = [h.soruKey, h.uid, h.soruNo].filter(v=>v!==undefined && v!==null).map(v=>String(v));
  for(const ders of window.MANIFEST.dersler){
    if(h.ders && ders.id !== h.ders) continue;
    for(const fas of ders.fasikuller||[]){
      if(h.fasikulId && fas.id !== h.fasikulId) continue;
      if(!h.fasikulId && h.fasikulAd && fas.ad !== h.fasikulAd) continue;
      for(const konu of fas.konular||[]){
        if(h.konuId && konu.id !== h.konuId) continue;
        for(const ak of konu.altKonular||[]){
          if(h.altKonuId && ak.id !== h.altKonuId) continue;
          const s = ak.sorular?.find(q=>{
            const modernKey = `${fas.id}__${ak.id}_${q.no}`;
            const legacyKey = `${ak.id}_${q.no}`;
            const qKey = String(q._uid || modernKey);
            const qNo = String(q.no);
            return wantedKeys.includes(qKey)
              || wantedKeys.includes(legacyKey)
              || wantedKeys.includes(qNo)
              || (h.sayfa && Number(q.sayfa || ak.sayfa) === Number(h.sayfa));
          });
          if(s){
            s._uid = `${fas.id}__${ak.id}_${s.no}`;
            if(!s.sayfa && ak.sayfa) s.sayfa = ak.sayfa;
            return {ders, fas, konu, ak, s, page:s.sayfa || ak.sayfa || h.sayfa || 1};
          }
        }
      }
    }
  }
  return null;
}

async function openHataliInReader(idx){
  const h = appState.hatalilar[idx];
  if(!h) return;
  const ctx = findHataliContext(h);
  if(ctx){
    openReader(ctx.ders.id, ctx.fas.id);
    appState.aktifKonu = ctx.konu;
    const select = document.getElementById('anaKonuSelect');
    if(select) select.value = ctx.konu.id;
    renderAltKonuList(ctx.konu);
    selectAltKonu(ctx.ak, `altk-${ctx.ak.id}`);
    const opened = await ensureReaderPdfLoaded(ctx.page);
    if(opened){
      goToPage(ctx.page);
      showToast(`Soru ${h.soruEtiket || ctx.s.no} PDF'de açıldı`,'success');
    }
    return;
  }
  showToast('PDF sayfası bulunamadı','error');
}

// ── Window exports ──
window.renderHatalilar = renderHatalilar;
window.removeHatali = removeHatali;
window.startTekrarModu = startTekrarModu;
window.findHataliContext = findHataliContext;
window.openHataliInReader = openHataliInReader;
