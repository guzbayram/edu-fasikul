const ONBOARD_STEPS=[
  {
    title:'Konu Navigatörü 📚',
    desc:'Sol panelden ana konu ve alt konuları seç. Her konu PDF\'deki ilgili sayfaya atlar.',
    target:'readerRight',
    pos:{left:'300px',top:'120px'}
  },
  {
    title:'Çizim Araçları ✏️',
    desc:'Üst araç çubuğunda kalem, vurgulayıcı ve metin aracıyla PDF üzerine not alabilirsin. Tüm çizimler otomatik kaydedilir.',
    target:'readerToolbar',
    pos:{left:'50%',top:'80px',transform:'translateX(-50%)'}
  },
  {
    title:'Soru Paneli 🎯',
    desc:'Sağ panelden soruları çöz, test başlat, süre tut. Hatalı sorular otomatik defterine eklenir.',
    target:'readerRight',
    pos:{right:'360px',top:'120px'}
  }
];
let onboardStep=0;

function startOnboarding(){
  if(document.getElementById('reader-overlay').classList.contains('open')){
    showOnboardStep(0);
  } else {
    // Open reader first then tour
    const firstDers=window.MANIFEST.dersler[0];
    const firstFas=firstDers.fasikuller[0];
    window.openReader(firstDers.id, firstFas.id);
    setTimeout(()=>showOnboardStep(0), 500);
  }
}

function showOnboardStep(idx){
  onboardStep=idx;
  const steps=ONBOARD_STEPS;
  if(idx>=steps.length){ endOnboarding(); return; }
  const step=steps[idx];
  const overlay=document.getElementById('onboardOverlay');
  const tip=document.getElementById('onboardTip');
  overlay.style.display='block';
  tip.style.display='block';
  document.getElementById('onboardTitle').textContent=step.title;
  document.getElementById('onboardDesc').textContent=step.desc;
  // Position
  Object.assign(tip.style,{left:'',top:'',right:'',transform:'',...step.pos});
  // Dots
  const dots=document.getElementById('onboardDots');
  dots.innerHTML='';
  steps.forEach((_,i)=>{
    const d=document.createElement('div');
    d.className='onboard-dot'+(i===idx?' active':'');
    dots.appendChild(d);
  });
  // Button label
  document.getElementById('onboardNextBtn').textContent=idx===steps.length-1?'Başlayalım! 🚀':'İleri →';
  // Highlight target
  document.querySelectorAll('.onboard-highlight').forEach(el=>el.classList.remove('onboard-highlight'));
  const target=document.getElementById(step.target);
  if(target) target.style.outline='2px solid var(--mat)';
  setTimeout(()=>{ if(target) target.style.outline=''; }, 3000);
}

function onboardNext(){
  showOnboardStep(onboardStep+1);
}

function endOnboarding(){
  document.getElementById('onboardOverlay').style.display='none';
  document.getElementById('onboardTip').style.display='none';
  localStorage.setItem('edu_onboarded','1');
  window.showToast('Tur tamamlandı! İyi çalışmalar 🎓','success');
}

// ── Window exports ──
window.startOnboarding = startOnboarding;
window.showOnboardStep = showOnboardStep;
window.onboardNext = onboardNext;
window.endOnboarding = endOnboarding;
