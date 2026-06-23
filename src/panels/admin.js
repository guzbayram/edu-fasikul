// Admin panel — işlevler firebase/auth.js'de tanımlı ve window'a kayıtlı
// Bu modül sadece window exports'u konsolide eder.
import {
  loadKullaniciList, addKullanici, deleteKullanici,
  toggleKullaniciActive, resetKullaniciPassword
} from '../firebase/auth.js';

window.loadKullaniciList = loadKullaniciList;
window.addKullanici = addKullanici;
window.deleteKullanici = deleteKullanici;
window.toggleKullaniciActive = toggleKullaniciActive;
window.resetKullaniciPassword = resetKullaniciPassword;
