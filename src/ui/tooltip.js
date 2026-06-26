// ══════════════════════════════════════════════════════════
// Özel tooltip: native `title` mobilde basar basmaz açılıp kapanmıyor.
// Bunun yerine title'ı data-tip'e taşıyıp UZUN BASIŞta balon gösterir,
// kısa süre sonra OTOMATİK gizler. Kısa dokunuş → balon yok, normal tıklama.
// ══════════════════════════════════════════════════════════
function initTooltips(){
  let bubble = document.getElementById('tipBubble');
  if(!bubble){
    bubble = document.createElement('div');
    bubble.id = 'tipBubble';
    bubble.className = 'tip-bubble';
    document.body.appendChild(bubble);
  }
  const SHOW_AFTER = 450;   // bu kadar basılı tutunca açıklama açılır
  const AUTO_HIDE  = 1800;  // açıldıktan sonra otomatik gizlenir
  let timer = null, hideTimer = null, sx = 0, sy = 0;

  // Bir öğenin tooltip metni (title'ı bir kez data-tip'e taşı → native pop-up'ı önle)
  function tipOf(node){
    const el = node?.closest?.('[data-tip],[title]');
    if(!el) return null;
    if(el.hasAttribute('title')){
      const t = el.getAttribute('title');
      if(t) el.dataset.tip = t;
      el.removeAttribute('title');
    }
    const text = el.dataset.tip;
    return text ? { el, text } : null;
  }
  function show(t){
    bubble.textContent = t.text;
    bubble.classList.add('show');           // ölçmek için görünür yap
    const r = t.el.getBoundingClientRect();
    const bw = bubble.offsetWidth, bh = bubble.offsetHeight;
    let x = r.left + r.width/2 - bw/2;
    let y = r.top - bh - 8;
    x = Math.max(6, Math.min(window.innerWidth - bw - 6, x));
    if(y < 6) y = r.bottom + 8;             // üstte yer yoksa altına
    bubble.style.left = x + 'px';
    bubble.style.top  = y + 'px';
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, AUTO_HIDE);
  }
  function hide(){ bubble.classList.remove('show'); clearTimeout(hideTimer); }

  document.addEventListener('pointerdown', e=>{
    const t = tipOf(e.target);
    if(!t) return;
    sx = e.clientX; sy = e.clientY;
    clearTimeout(timer);
    timer = setTimeout(()=>show(t), SHOW_AFTER);
  }, true);

  function cancelPending(){ clearTimeout(timer); timer = null; }
  document.addEventListener('pointerup', cancelPending, true);
  document.addEventListener('pointercancel', cancelPending, true);
  document.addEventListener('pointermove', e=>{
    if(timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 12) cancelPending(); // kaydırınca iptal
  }, true);
  document.addEventListener('scroll', hide, true);
}
window.initTooltips = initTooltips;
document.addEventListener('DOMContentLoaded', initTooltips);
