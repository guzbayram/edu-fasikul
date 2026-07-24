export async function registerEduServiceWorker() {
  if (!('serviceWorker' in navigator)) return false;
  try {
    await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
    return true;
  } catch (err) {
    console.warn('Service worker kaydedilemedi:', err);
    return false;
  }
}

export async function requestEduNotificationPermission() {
  if (!('Notification' in window)) {
    window.showToast?.('Bu tarayıcı bildirim desteklemiyor.', 'info');
    return 'unsupported';
  }
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') {
    window.showToast?.('Bildirim izni tarayıcı ayarlarında kapalı.', 'info');
    return 'denied';
  }
  const result = await Notification.requestPermission();
  window.showToast?.(result === 'granted' ? 'Bildirimler açıldı' : 'Bildirim izni verilmedi', result === 'granted' ? 'success' : 'info');
  return result;
}

export function eduNotify(title, body, data = {}) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  navigator.serviceWorker?.ready
    .then(reg => reg.showNotification(title, { body, data, icon: './icon-192.png', badge: './icon-192.png' }))
    .catch(() => new Notification(title, { body, data }));
  return true;
}

registerEduServiceWorker();

window.requestEduNotificationPermission = requestEduNotificationPermission;
window.eduNotify = eduNotify;
