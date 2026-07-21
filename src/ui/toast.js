import { appState } from '../state/appState.js';

function closeModal(id){ document.getElementById(id).classList.remove('open'); }
function showKbModal(){ document.getElementById('kbModal').classList.add('open'); }

// ══════════════════════════════
// TOAST
// ══════════════════════════════
function showToast(msg, type='info'){
  const container=document.getElementById('toastContainer');
  const toast=document.createElement('div');
  toast.className=`toast toast-${type}`;
  const icons={success:'✅',error:'❌',info:'ℹ️'};
  toast.innerHTML=`<span>${icons[type]||'ℹ️'}</span><span style="flex:1">${msg}</span><span class="toast-close" onclick="this.parentElement.remove()">×</span>`;
  container.appendChild(toast);
  setTimeout(()=>{ toast.classList.add('hiding'); setTimeout(()=>toast.remove(),300); },3500);
}

// ── Window exports ──
window.closeModal = closeModal;
window.showKbModal = showKbModal;
window.showToast = showToast;
