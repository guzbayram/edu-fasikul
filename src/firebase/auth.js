import { appState } from '../state/appState.js';

const ADMIN_EMAIL = 'admin@edufasikuler.com';
export { ADMIN_EMAIL };

export async function doLogin(){
  const email = document.getElementById('emailInput').value.trim().toLowerCase();
  const pass = document.getElementById('passInput').value;
  const err = document.getElementById('formError');
  const btn = document.querySelector('.btn-login');
  if(!email){ err.textContent='E-posta gerekli.'; err.classList.add('show'); return; }
  if(pass.length < 6){ err.textContent='Şifre en az 6 karakter olmalıdır.'; err.classList.add('show'); return; }
  err.classList.remove('show');

  if(!window._authReady || !window._firestoreReady){
    err.textContent='Bağlantı kuruluyor, lütfen birkaç saniye sonra tekrar deneyin.';
    err.classList.add('show');
    return;
  }

  if(btn){ btn.disabled=true; btn.textContent='Giriş yapılıyor…'; }
  try{
    const cred = await window._authSignIn(window._auth, email, pass);
    const uid = cred.user.uid;

    const docRef = window._fsDoc(window._db, 'kullanicilar', uid);
    const snap = await window._fsGetDoc(docRef);

    if(!snap.exists()){
      if(email === ADMIN_EMAIL){
        const adminProfile = { name:'Admin', email, role:'admin', active:true, createdAt:new Date().toISOString(), addedBy:'system' };
        await window._fsSetDoc(docRef, adminProfile);
        appState.user = { name:'Admin', role:'admin', email, uid };
        enterApp('Admin');
        return;
      }
      try{
        const col = window._fsCollection(window._db,'kullanicilar');
        const allSnap = await window._fsGetDocs(col);
        let found = null;
        allSnap.forEach(d=>{ if(d.data().email===email) found={id:d.id, ...d.data()}; });
        if(found){
          await window._fsSetDoc(docRef, {...found, uid, guncelleme:new Date().toISOString()});
          if(found.active===false){
            await window._authSignOut(window._auth);
            err.textContent='Bu hesap devre dışı bırakılmış.';
            err.classList.add('show');
            return;
          }
          const name = found.name || email.split('@')[0];
          appState.user = { name, role:found.role||'ogrenci', email, uid };
          enterApp(name);
          return;
        }
      }catch(e2){ console.warn('E-posta ile arama hatası:',e2); }
      await window._authSignOut(window._auth);
      err.textContent='Bu hesap yönetici tarafından eklenmemiş veya silinmiş.';
      err.classList.add('show');
      return;
    }
    const data = snap.data();
    if(data.active === false){
      await window._authSignOut(window._auth);
      err.textContent='Bu hesap devre dışı bırakılmış. Yöneticinizle iletişime geçin.';
      err.classList.add('show');
      return;
    }
    const name = data.name || email.split('@')[0].replace(/[._]/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
    appState.user = { name, role: data.role||'ogrenci', email, uid };
    enterApp(name);
  }catch(e){
    console.warn('Giriş hatası:', e);
    const code = e.code || '';
    if(code.includes('user-not-found') || code.includes('invalid-credential') || code.includes('wrong-password')){
      err.textContent='E-posta veya şifre hatalı.';
    } else if(code.includes('too-many-requests')){
      err.textContent='Çok fazla başarısız deneme. Lütfen biraz bekleyin.';
    } else {
      err.textContent='Giriş sırasında bir hata oluştu. Tekrar deneyin.';
    }
    err.classList.add('show');
  }finally{
    if(btn){ btn.disabled=false; btn.textContent='Giriş Yap →'; }
  }
}

export function doGuest(){
  appState.user={name:'Misafir',role:'ogrenci',email:'misafir@demo.com'};
  document.documentElement.classList.add('guest-mode');
  enterApp('Misafir');
}

export function enterApp(name){
  document.getElementById('welcomeName').textContent = name;
  document.getElementById('profileName').textContent = name;
  const roleLabel = {ogretmen:'Öğretmen',admin:'Yönetici'}[appState.user.role] || 'Öğrenci';
  document.getElementById('profileSub').textContent = `${roleLabel} · ${appState.user.email}`;
  document.getElementById('screen-login').classList.remove('active');
  document.getElementById('screen-app').classList.add('active');
  window.recalcFasikulProgress?.();
  window.renderDerslerGrid?.();
  window.showToast?.(`Hoş geldin, ${name}! 👋`, 'success');

  const adminBtn = document.getElementById('navAdminBtn');
  if(adminBtn) adminBtn.style.display = (appState.user.role==='admin') ? '' : 'none';
  const profilAdminBtn = document.getElementById('profilAdminBtn');
  if(profilAdminBtn) profilAdminBtn.style.display = (appState.user.role==='admin') ? '' : 'none';

  if(appState.user && appState.user.email !== 'misafir@demo.com'){
    setTimeout(()=>{ window.loadFromFirestore?.(); }, 500);
  }

  if(window._showOnboardOnLogin){
    window._showOnboardOnLogin = false;
    setTimeout(()=>{
      window.showToast?.('İlk girişin! Sana kısa bir tur yapayım 👋','info');
      setTimeout(()=>window.startOnboarding?.(), 2500);
    }, 800);
  }
}

export async function doLogout(){
  if(!confirm('Çıkış yapmak istediğinize emin misiniz?')) return;
  window.stopRealtimeSync?.();
  if(window._authReady && appState.user && appState.user.email !== 'misafir@demo.com'){
    try{ await window._authSignOut(window._auth); }catch(e){}
  }
  appState.user = null;
  document.documentElement.classList.remove('guest-mode');
  document.getElementById('screen-app').classList.remove('active');
  document.getElementById('screen-login').classList.add('active');
}

export async function loadKullaniciList(){
  const listEl = document.getElementById('adminUserList');
  if(!listEl) return;
  if(!window._firestoreReady){ listEl.innerHTML='<div style="color:var(--text-muted);font-size:13px">Bağlantı bekleniyor…</div>'; return; }
  listEl.innerHTML='<div style="color:var(--text-muted);font-size:13px">Yükleniyor…</div>';
  try{
    const colRef = window._fsCollection(window._db,'kullanicilar');
    const snap = await window._fsGetDocs(colRef);
    const users=[];
    snap.forEach(d=>users.push({id:d.id, ...d.data()}));
    document.getElementById('adminUserCount').textContent = users.length;
    if(users.length===0){
      listEl.innerHTML = '<div style="color:var(--text-muted);font-size:13px">Henüz kullanıcı eklenmedi.</div>';
      return;
    }
    listEl.innerHTML = users.map(u=>`
      <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--bg-3);border:1px solid var(--border);border-radius:var(--radius)">
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:14px">${(u.name||'').replace(/</g,'&lt;')}</div>
          <div style="font-size:12px;color:var(--text-muted)">${(u.email||'').replace(/</g,'&lt;')} · ${u.role==='admin'?'🔑 Yönetici':u.role==='ogretmen'?'Öğretmen':'Öğrenci'}${u.active===false?' · <span style="color:var(--red)">Devre Dışı</span>':''}</div>
        </div>
        <button class="pref-action pref-chip" onclick="toggleKullaniciActive('${u.id}', ${u.active===false})">${u.active===false?'Etkinleştir':'Devre Dışı Bırak'}</button>
        <button class="pref-action pref-chip" style="color:var(--yellow)" onclick="resetKullaniciPassword('${(u.email||'').replace(/'/g,"\\'")}')">Şifre Sıfırla</button>
        <button class="pref-action pref-chip" style="color:var(--red)" onclick="deleteKullanici('${u.id}')">Sil</button>
      </div>
    `).join('');
  }catch(e){
    console.warn('Kullanıcı listesi yüklenemedi:', e);
    listEl.innerHTML = '<div style="color:var(--red);font-size:13px">Liste yüklenirken hata oluştu.</div>';
  }
}

export async function addKullanici(){
  const name = document.getElementById('adminNewName').value.trim();
  const email = document.getElementById('adminNewEmail').value.trim().toLowerCase();
  const pass = document.getElementById('adminNewPass').value;
  const role = document.getElementById('adminNewRole').value;
  const err = document.getElementById('adminFormError');
  err.classList.remove('show');
  if(!name || !email){ err.textContent='Ad ve e-posta gerekli.'; err.classList.add('show'); return; }
  if(pass.length < 6){ err.textContent='Şifre en az 6 karakter olmalıdır.'; err.classList.add('show'); return; }
  if(email === ADMIN_EMAIL){ err.textContent='Bu e-posta adresi kullanılamaz.'; err.classList.add('show'); return; }
  if(!window._firestoreReady || !window._authReady){ err.textContent='Bağlantı kuruluyor, tekrar deneyin.'; err.classList.add('show'); return; }

  const addBtn = document.getElementById('adminAddBtn');
  if(addBtn){ addBtn.disabled=true; addBtn.textContent='Ekleniyor…'; }
  try{
    const cred = await window._authCreateUser(window._authCreator, email, pass);
    const uid = cred.user.uid;

    const docRef = window._fsDoc(window._db, 'kullanicilar', uid);
    await window._fsSetDoc(docRef, {
      name, email, role, active: true,
      addedBy: appState.user?.email || 'admin',
      createdAt: new Date().toISOString()
    });

    document.getElementById('adminNewName').value='';
    document.getElementById('adminNewEmail').value='';
    document.getElementById('adminNewPass').value='';
    window.showToast?.(`${name} başarıyla eklendi ✅`, 'success');
    loadKullaniciList();
  }catch(e){
    console.warn('Kullanıcı eklenemedi:', e);
    const code = e.code || '';
    if(code.includes('email-already-in-use')){
      try {
        const existing = await window._authSignIn(window._authCreator, email, pass);
        const uid = existing.user.uid;
        const docRef = window._fsDoc(window._db, 'kullanicilar', uid);
        await window._fsSetDoc(docRef, {
          name, email, role, active: true,
          addedBy: appState.user?.email || 'admin',
          createdAt: new Date().toISOString()
        });
        document.getElementById('adminNewName').value='';
        document.getElementById('adminNewEmail').value='';
        document.getElementById('adminNewPass').value='';
        window.showToast?.(`${name} başarıyla eklendi ✅`, 'success');
        loadKullaniciList();
        return;
      } catch(_) {
        err.textContent='Bu e-posta Firebase\'de kayıtlı ve şifresi farklı. Firebase Console > Authentication\'dan hesabı silip tekrar deneyin.';
      }
    } else if(code.includes('invalid-email')){
      err.textContent='Geçersiz e-posta adresi.';
    } else if(code.includes('weak-password')){
      err.textContent='Şifre çok zayıf, en az 6 karakter kullanın.';
    } else {
      err.textContent='Kullanıcı eklenirken hata oluştu: ' + (e.message||code);
    }
    err.classList.add('show');
  }finally{
    if(addBtn){ addBtn.disabled=false; addBtn.textContent='Kullanıcı Ekle'; }
  }
}

export async function deleteKullanici(uid){
  if(!confirm('Bu kullanıcıyı silmek istediğinize emin misiniz? Bu işlem geri alınamaz.')) return;
  try{
    await window._fsDeleteDoc(window._fsDoc(window._db,'kullanicilar', uid));
    window.showToast?.('Kullanıcı erişimi kaldırıldı','success');
    loadKullaniciList();
  }catch(e){
    console.warn('Kullanıcı silinemedi:', e);
    window.showToast?.('Silme işlemi başarısız','error');
  }
}

export async function toggleKullaniciActive(uid, makeActive){
  try{
    const docRef = window._fsDoc(window._db,'kullanicilar', uid);
    await window._fsSetDoc(docRef, {active: makeActive}, {merge:true});
    window.showToast?.(makeActive ? 'Hesap etkinleştirildi' : 'Hesap devre dışı bırakıldı', 'success');
    loadKullaniciList();
  }catch(e){
    console.warn('Durum güncellenemedi:', e);
    window.showToast?.('İşlem başarısız','error');
  }
}

export async function resetKullaniciPassword(email){
  if(!email){ window.showToast?.('E-posta bulunamadı','error'); return; }
  if(!confirm(`${email} adresine şifre sıfırlama e-postası gönderilsin mi?`)) return;
  try{
    await window._authSendPasswordReset(window._auth, email);
    window.showToast?.('Şifre sıfırlama e-postası gönderildi 📧','success');
  }catch(e){
    console.warn('Şifre sıfırlama hatası:', e);
    window.showToast?.('E-posta gönderilemedi: ' + (e.message||e.code),'error');
  }
}
