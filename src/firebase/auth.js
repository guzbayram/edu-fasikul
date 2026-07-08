import { appState } from '../state/appState.js';

const ADMIN_EMAIL = 'admin@edufasikuler.com';
export { ADMIN_EMAIL };

function esc(text){
  return String(text ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[ch]));
}

function canManageUsers(){
  return appState.user?.role === 'admin';
}

function canOpenManagementPanel(){
  const user = appState.user || {};
  return user.role === 'admin' || user.role === 'ogretmen' || String(user.email || '').toLowerCase() === ADMIN_EMAIL;
}

function syncManagementNav(){
  const canOpenManagement = canOpenManagementPanel();
  const canAdminJson = appState.user?.role === 'admin' || String(appState.user?.email || '').toLowerCase() === ADMIN_EMAIL;
  document.documentElement.classList.toggle('can-manage-users', canOpenManagement);
  document.documentElement.classList.toggle('can-admin-json', canAdminJson);
  const adminBtn = document.getElementById('navAdminBtn');
  if(adminBtn){
    adminBtn.hidden = false;
    adminBtn.style.display = canOpenManagement ? '' : 'none';
  }
  const managementShortcut = document.getElementById('managementShortcutSection');
  if(managementShortcut) managementShortcut.style.display = canOpenManagement ? '' : 'none';
}

function canViewStudent(user){
  if(appState.user?.role === 'admin') return true;
  if(appState.user?.role !== 'ogretmen') return false;
  return user?.role === 'ogrenci' && user?.assignedTeacherUid === appState.user.uid;
}

function userSessionFromProfile(profile, fallbackName, uid){
  return {
    name: profile.name || fallbackName,
    role: profile.role || 'ogrenci',
    email: profile.email || '',
    uid,
    assignedTeacherUid: profile.assignedTeacherUid || '',
    assignedTeacherEmail: profile.assignedTeacherEmail || '',
    hiddenFasikulIds: Array.isArray(profile.hiddenFasikulIds) ? profile.hiddenFasikulIds : []
  };
}

function formatDate(dateLike){
  if(!dateLike) return 'Tarih yok';
  const d = new Date(dateLike);
  if(Number.isNaN(d.getTime())) return 'Tarih yok';
  return d.toLocaleDateString('tr-TR', {day:'numeric', month:'short', year:'numeric'});
}

function formatDateTime(dateLike){
  if(!dateLike) return 'Zaman yok';
  const d = new Date(dateLike);
  if(Number.isNaN(d.getTime())) return formatDate(dateLike);
  return d.toLocaleString('tr-TR', {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'});
}

function dateTimeInputValue(dateLike){
  if(!dateLike) return '';
  const d = new Date(dateLike);
  if(Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

const STUDY_DAYS = ['Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi','Pazar'];
const STUDY_HOURS = Array.from({length:16}, (_,i)=>8+i);

function currentWeekValue(){
  const now = new Date();
  const day = now.getDay() || 7;
  const thursday = new Date(now);
  thursday.setDate(now.getDate() + 4 - day);
  const yearStart = new Date(thursday.getFullYear(), 0, 1);
  const week = Math.ceil((((thursday - yearStart) / 86400000) + 1) / 7);
  return `${thursday.getFullYear()}-W${String(week).padStart(2,'0')}`;
}

function dateInputValue(date){
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function shortDateValue(date){
  if(!date) return '';
  return `${String(date.getDate()).padStart(2,'0')}.${String(date.getMonth()+1).padStart(2,'0')}.${date.getFullYear()}`;
}

function weekValueFromDate(dateLike){
  const date = dateLike ? new Date(`${dateLike}T12:00:00`) : new Date();
  if(Number.isNaN(date.getTime())) return currentWeekValue();
  const day = date.getDay() || 7;
  const thursday = new Date(date);
  thursday.setDate(date.getDate() + 4 - day);
  const yearStart = new Date(thursday.getFullYear(), 0, 1);
  const week = Math.ceil((((thursday - yearStart) / 86400000) + 1) / 7);
  return `${thursday.getFullYear()}-W${String(week).padStart(2,'0')}`;
}

function weekRangeFromValue(weekKey){
  const match = String(weekKey || currentWeekValue()).match(/^(\d{4})-W(\d{2})$/);
  if(!match) return {start:null, end:null, label:String(weekKey || '')};
  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan4 = new Date(year, 0, 4);
  const jan4Day = jan4.getDay() || 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - jan4Day + 1 + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = d => `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
  return {start:monday, end:sunday, label:`${fmt(monday)} - ${fmt(sunday)}`};
}

function studyPlanSlotId(weekKey, dayIndex, hour){
  return `${weekKey || currentWeekValue()}_${dayIndex}_${hour}`;
}

function studyPlanSlotTimes(item){
  const range = weekRangeFromValue(item.weekKey);
  if(!range.start) return {startAt:'', endAt:''};
  const start = new Date(range.start);
  start.setDate(range.start.getDate() + Number(item.dayIndex || 0));
  start.setHours(Number(item.hour || 8), 0, 0, 0);
  const end = new Date(start);
  end.setHours(start.getHours() + Math.max(1, Number(item.durationHours || 1)));
  return {startAt:start.toISOString(), endAt:end.toISOString()};
}

function manifestFasikulOptions(){
  const dersler = window.MANIFEST?.dersler || [];
  return dersler.flatMap(ders => (ders.fasikuller||[]).map(fas => ({
    id: fas.id,
    label: `${ders.ad} / ${fas.ad}`,
    dersId: ders.id,
    dersAd: ders.ad,
    fasikulAd: fas.ad,
    fas
  })));
}

function visibleFasikulOptionsForStudent(student){
  const hidden = new Set(Array.isArray(student?.hiddenFasikulIds) ? student.hiddenFasikulIds : []);
  return manifestFasikulOptions().filter(f=>!hidden.has(f.id));
}

function manifestDersOptions(){
  return (window.MANIFEST?.dersler || []).map(ders=>({id: ders.id, ad: ders.ad}));
}

function manifestTopicOptions(fasikulId){
  const item = manifestFasikulOptions().find(f=>f.id === fasikulId);
  if(!item?.fas?.konular?.length) return [];
  return item.fas.konular.flatMap(konu => {
    const rows = [{id: konu.id || konu.ad, label: konu.ad, konuAd: konu.ad, altKonuAd: ''}];
    (konu.altKonular||[]).forEach(alt=>{
      rows.push({id: alt.id || alt.ad, label: `${konu.ad} / ${alt.ad}`, konuAd: konu.ad, altKonuAd: alt.ad});
    });
    return rows;
  });
}

function renderFasikulVisibilityControls(user){
  if(!canManageUsers() || user.role === 'admin') return '';
  const staged = window._pendingFasikulVisibility?.[user.id];
  const hidden = new Set(Array.isArray(staged) ? staged : (Array.isArray(user.hiddenFasikulIds) ? user.hiddenFasikulIds : []));
  const rows = manifestFasikulOptions();
  if(!rows.length) return '';
  return `
    <details class="fasikul-access-panel">
      <summary>Fasikül Yetkileri</summary>
      <div class="fasikul-access-grid">
        ${rows.map(row=>{
          const isHidden = hidden.has(row.id);
          return `<button class="fasikul-access-btn ${isHidden?'hidden':''}" data-user="${user.id}" data-fasikul="${row.id}" onclick="event.stopPropagation();toggleUserFasikulVisibility('${user.id}','${row.id}',${!isHidden})">
            <span>${esc(row.label)}</span>
            <b>${isHidden?'Göster':'Gizle'}</b>
          </button>`;
        }).join('')}
      </div>
      <div class="fasikul-access-actions">
        <button onclick="event.stopPropagation();applyUserFasikulVisibility('${user.id}')">Değişiklikleri Onayla</button>
      </div>
    </details>`;
}

async function fetchAllUsers(){
  const snap = await window._fsGetDocs(window._fsCollection(window._db,'kullanicilar'));
  const users = [];
  snap.forEach(d=>users.push({id:d.id, uid:d.id, ...d.data()}));
  return users;
}

function computeRecordsSummary(records){
  const today = new Date();
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - 6);
  let total=0, dogru=0, yanlis=0, bos=0, weekly=0;
  const byTopic = {};
  records.forEach(r=>{
    total++;
    const tarih = new Date(r.tarih || 0);
    if(!Number.isNaN(tarih.getTime()) && tarih >= weekStart) weekly++;
    if(r.atladi || r.skipped) bos++;
    else if(r.dogru === true || r.correct === true) dogru++;
    else yanlis++;
    const key = `${r.fasikulAd || r.fasikulId || 'Fasikül'} / ${r.konu || 'Konu'}`;
    if(!byTopic[key]) byTopic[key] = {total:0,dogru:0,yanlis:0};
    byTopic[key].total++;
    if(r.dogru === true || r.correct === true) byTopic[key].dogru++;
    else if(!(r.atladi || r.skipped)) byTopic[key].yanlis++;
  });
  const solved = dogru + yanlis;
  return {total, dogru, yanlis, bos, weekly, accuracy: solved ? Math.round(dogru / solved * 100) : 0, byTopic};
}

function expectedQuestionCountForTask(task){
  const fas = manifestFasikulOptions().find(f=>f.id === task.fasikulId);
  if(!fas?.fas) return 0;
  if(!task.konuId) return Number(fas.fas.soruSayisi || fas.fas.soru_sayisi || fas.fas.totalQuestions || 0);
  const topics = fas.fas.konular || [];
  for(const konu of topics){
    const konuId = konu.id || konu.ad;
    if(konuId === task.konuId || konu.ad === task.konuAd){
      return Number(konu.soruSayisi || konu.soru_sayisi || konu.toplamSoru || konu.soru || 0);
    }
    for(const alt of (konu.altKonular || [])){
      const altId = alt.id || alt.ad;
      if(altId === task.konuId || alt.ad === task.altKonuAd){
        return Number(alt.soruSayisi || alt.soru_sayisi || alt.toplamSoru || alt.soru || 0);
      }
    }
  }
  return 0;
}

function normTaskText(text){
  return String(text || '').toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();
}

function assignmentProgress(task, records){
  const taskTopic = normTaskText(task.altKonuAd || task.konuAd || '');
  const relevant = records.filter(r=>{
    if(task.fasikulId && r.fasikulId !== task.fasikulId) return false;
    if(taskTopic){
      const recTopic = normTaskText([r.konu, r.altKonu].filter(Boolean).join(' '));
      if(!recTopic.includes(taskTopic) && !taskTopic.includes(recTopic)) return false;
    }
    return !(r.atladi || r.skipped);
  });
  const correct = relevant.filter(r=>r.dogru === true || r.correct === true).length;
  const wrong = relevant.filter(r=>!(r.dogru === true || r.correct === true)).length;
  const expected = expectedQuestionCountForTask(task);
  const done = expected > 0 ? (correct >= expected && wrong === 0) : (correct > 0 && wrong === 0);
  return {correct, wrong, expected, done};
}

async function fetchStudentRecords(uid){
  const snap = await window._fsGetDocs(window._fsCollection(window._db,'kullanicilar',uid,'cozumler'));
  const records = [];
  snap.forEach(d=>records.push({id:d.id, ...d.data()}));
  return records;
}

async function fetchStudyPlan(uid, weekKey = currentWeekValue()){
  const snap = await window._fsGetDocs(window._fsCollection(window._db,'kullanicilar',uid,'gorevler'));
  const rows = [];
  snap.forEach(d=>{
    const data = {id:d.id, ...d.data()};
    if(data.type === 'studyPlan' && (data.weekKey || '') === weekKey) rows.push(data);
  });
  return rows;
}

function mergePendingStudyPlan(uid, weekKey, planItems){
  const deleted = new Set((window._pendingStudyPlanDeletes || []).filter(item=>item.studentUid === uid && item.weekKey === weekKey).map(item=>item.id));
  const pending = (window._pendingStudyPlanSlots || []).filter(item=>item.studentUid === uid && item.weekKey === weekKey);
  const byId = new Map(planItems.filter(item=>!deleted.has(item.id)).map(item=>[item.id, item]));
  pending.forEach(item=>byId.set(item.id, item));
  return [...byId.values()];
}

function studyPlanLabel(item){
  const topic = item.topicLabel || item.altKonuAd || item.konuAd || '';
  return topic || item.fasikulAd || item.dersAd || '';
}

function studyPlanTopicKey(item){
  const raw = item.konuAd || item.topicLabel || item.altKonuAd || item.fasikulAd || item.dersAd || 'Çalışma';
  return String(raw).split('/')[0].replace(/\s+/g,' ').trim();
}

function studyPlanColorStyle(item){
  const palette = [
    ['#7c73ff','#22c55e'],
    ['#f97316','#ef4444'],
    ['#0ea5e9','#6366f1'],
    ['#14b8a6','#84cc16'],
    ['#d946ef','#8b5cf6'],
    ['#f59e0b','#e11d48'],
    ['#06b6d4','#2563eb'],
    ['#65a30d','#16a34a']
  ];
  const key = studyPlanTopicKey(item).toLocaleLowerCase('tr-TR');
  let hash = 0;
  for(let i=0;i<key.length;i++) hash = ((hash * 31) + key.charCodeAt(i)) >>> 0;
  const [a,b] = palette[hash % palette.length];
  return `--plan-a:${a};--plan-b:${b}`;
}

function renderStudyPlanGrid(studentUid, planItems){
  window._visibleStudyPlanItems = planItems;
  const bySlot = new Map();
  planItems.forEach(item=>{
    const duration = Math.max(1, Math.min(STUDY_HOURS.length, Number(item.durationHours || 1)));
    for(let i=0;i<duration;i++){
      const coveredHour = Number(item.hour) + i;
      if(STUDY_HOURS.includes(coveredHour)){
        bySlot.set(`${item.dayIndex}_${coveredHour}`, {...item, _isStart:i===0, _coveredHour:coveredHour, _durationIndex:i});
      }
    }
  });
  return `
    <div class="study-plan-grid" role="table">
      <div class="study-plan-corner" style="grid-column:1;grid-row:1">Saat</div>
      ${STUDY_DAYS.map((day,dayIndex)=>`<div class="study-plan-day" style="grid-column:${dayIndex+2};grid-row:1">${day}</div>`).join('')}
      ${STUDY_HOURS.map((hour,hourIndex)=>`
        <div class="study-plan-hour" style="grid-column:1;grid-row:${hourIndex+2}">${String(hour).padStart(2,'0')}:00</div>
        ${STUDY_DAYS.map((day,dayIndex)=>{
          const item = bySlot.get(`${dayIndex}_${hour}`);
          if(item && !item._isStart) return '';
          if(!item) return `<button class="study-plan-cell empty" data-day="${dayIndex}" data-hour="${hour}" style="grid-column:${dayIndex+2};grid-row:${hourIndex+2}" ondragover="event.preventDefault()" ondrop="dropStudyPlanSlot(event,'${studentUid}',${dayIndex},${hour})" onclick="event.stopPropagation();prefillStudyPlanSlot(${dayIndex},${hour})">+</button>`;
          const duration = Math.max(1, Number(item.durationHours || 1));
          return `
            <div class="study-plan-cell filled" data-day="${dayIndex}" data-hour="${hour}" draggable="true" ondragstart="dragStudyPlanSlot(event,'${item.id}')" ondragover="event.preventDefault()" ondrop="dropStudyPlanSlot(event,'${studentUid}',${dayIndex},${hour})" style="grid-column:${dayIndex+2};grid-row:${hourIndex+2} / span ${duration};${studyPlanColorStyle(item)}">
              <button class="study-plan-clear" title="Sil" onclick="event.stopPropagation();clearStudyPlanSlot('${studentUid}','${item.id}')">×</button>
              <b>${String(hour).padStart(2,'0')}:00${item._isStart && duration > 1 ? ` · ${duration} saat` : ''}</b>
              <span>${esc(studyPlanLabel(item) || 'Çalışma')}</span>
              ${item.note?`<small>${esc(item.note)}</small>`:''}
              <button class="study-plan-resize" title="Süreyi uzat/kısalt" onpointerdown="startResizeStudyPlanSlot(event,'${studentUid}','${item.id}')"></button>
            </div>`;
        }).join('')}
      `).join('')}
    </div>`;
}

function renderStudyPlanEditor(studentUid, planItems){
  const student = (window._managedStudents || []).find(s=>s.id === studentUid);
  const fasOptions = visibleFasikulOptionsForStudent(student);
  const dersIds = new Set(fasOptions.map(f=>f.dersId));
  const dersOptions = manifestDersOptions().filter(d=>dersIds.has(d.id));
  const savedState = window._studyPlanFormState?.studentUid === studentUid ? window._studyPlanFormState : null;
  const week = savedState?.weekKey || document.getElementById('planWeek')?.value || currentWeekValue();
  const range = weekRangeFromValue(week);
  const pendingCount = (window._pendingStudyPlanSlots || []).filter(item=>item.studentUid === studentUid).length
    + (window._pendingStudyPlanDeletes || []).filter(item=>item.studentUid === studentUid).length;
  const modalOpen = window._studyPlanModalOpen === true || pendingCount > 0;
  return `
    <div class="managed-fold study-plan-launcher">
      <div class="study-plan-launcher-info">
        <span>🗓️ Haftalık Çalışma Planı</span>
        <b>${pendingCount ? `${pendingCount} taslak` : `${planItems.length} kayıt`}</b>
      </div>
      <button class="btn-login study-plan-open-btn" onclick="openStudyPlanModal('${studentUid}')">Programı Aç</button>
    </div>
    ${modalOpen ? `
      <div class="study-plan-modal-backdrop">
        <div class="study-plan-modal" role="dialog" aria-modal="true" aria-label="Haftalık Çalışma Planı">
          <div class="study-plan-modal-head">
            <div>
              <h3>Haftalık Çalışma Planı</h3>
              <p>${esc(student?.name || student?.email || '')} · ${esc(range.label)}</p>
            </div>
            <button class="study-plan-modal-close" title="Kapat" onclick="closeStudyPlanModal('${studentUid}')">×</button>
          </div>
          <div class="study-plan-editor">
            <div class="study-plan-controls">
              <label>Hafta
                <input id="planWeekLabel" type="text" value="${esc(range.label)}" readonly>
                <input id="planWeek" type="hidden" value="${esc(week)}">
              </label>
              <label>Hafta Seç
                <div class="study-week-nav">
                  <button type="button" title="Önceki hafta" onclick="event.stopPropagation();shiftStudyPlanWeek('${studentUid}',-1)">‹</button>
                  <span>${esc(shortDateValue(range.start))}</span>
                  <button type="button" title="Sonraki hafta" onclick="event.stopPropagation();shiftStudyPlanWeek('${studentUid}',1)">›</button>
                </div>
              </label>
              <label>Gün<select id="planDay">${STUDY_DAYS.map((day,i)=>`<option value="${i}" ${String(savedState?.dayIndex ?? '')===String(i)?'selected':''}>${day}</option>`).join('')}</select></label>
              <label>Saat<select id="planHour">${STUDY_HOURS.map(h=>`<option value="${h}" ${String(savedState?.hour ?? '')===String(h)?'selected':''}>${String(h).padStart(2,'0')}:00</option>`).join('')}</select></label>
              <label>Ders<select id="planDers" onchange="refreshPlanFasikulOptions()">
                <option value="">Tüm dersler</option>
                ${dersOptions.map(d=>`<option value="${esc(d.id)}" ${savedState?.dersId===d.id?'selected':''}>${esc(d.ad)}</option>`).join('')}
              </select></label>
              <label>Fasikül<select id="planFasikul" onchange="refreshPlanTopicOptions()">
                <option value="">Ders / fasikül seç</option>
                ${fasOptions.filter(f=>!savedState?.dersId || f.dersId === savedState.dersId).map(f=>`<option value="${esc(f.id)}" ${savedState?.fasikulId===f.id?'selected':''}>${esc(f.label)}</option>`).join('')}
              </select></label>
              <label>Konu<select id="planTopic">
                <option value="">Konu/Test seçilmedi</option>
                ${(savedState?.fasikulId ? manifestTopicOptions(savedState.fasikulId) : []).map(t=>`<option value="${esc(t.id)}" data-konu="${esc(t.konuAd)}" data-alt="${esc(t.altKonuAd)}" ${savedState?.konuId===t.id?'selected':''}>${esc(t.label)}</option>`).join('')}
              </select></label>
              <label>Not<input id="planNote" placeholder="Örn. 30 soru, konu tekrarı" value="${esc(savedState?.note || '')}"></label>
              <button class="btn-login study-plan-add" onclick="event.stopPropagation();createStudyPlanSlot('${studentUid}')">Programa Ekle</button>
            </div>
            <div class="study-plan-grid-wrap">
              ${renderStudyPlanGrid(studentUid, planItems)}
            </div>
            <div class="study-plan-approve-row">
              <button class="btn-login study-plan-approve" onclick="event.stopPropagation();approveStudyPlanChanges('${studentUid}')">Planı Onayla</button>
            </div>
          </div>
        </div>
      </div>` : ''}`;
}

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
        appState.user = userSessionFromProfile(adminProfile, 'Admin', uid);
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
          appState.user = userSessionFromProfile({...found, email}, name, uid);
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
    appState.user = userSessionFromProfile({...data, email}, name, uid);
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
  if(String(appState.user?.email || '').toLowerCase() === ADMIN_EMAIL && appState.user.role !== 'admin'){
    appState.user.role = 'admin';
  }
  document.getElementById('welcomeName').textContent = name;
  document.getElementById('profileName').textContent = name;
  const roleLabel = {ogretmen:'Öğretmen',admin:'Yönetici'}[appState.user.role] || 'Öğrenci';
  document.getElementById('profileSub').textContent = `${roleLabel} · ${appState.user.email}`;
  document.getElementById('screen-login').classList.remove('active');
  document.getElementById('screen-app').classList.add('active');
  window.recalcFasikulProgress?.();
  window.renderDerslerGrid?.();
  window.showToast?.(`Hoş geldin, ${name}! 👋`, 'success');

  syncManagementNav();
  setTimeout(syncManagementNav, 150);
  window.refreshProfileGithubJsonTools?.();

  if(appState.user && appState.user.email !== 'misafir@demo.com'){
    setTimeout(()=>{ window.loadFromFirestore?.(); }, 500);
    setTimeout(()=>{ loadMyAssignments(); loadMyStudyPlan(); }, 900);
  }

  // Onboarding turu kaldırıldı — girişte tur tetiklenmez
}

export async function doLogout(){
  if(!confirm('Çıkış yapmak istediğinize emin misiniz?')) return;
  window.stopRealtimeSync?.();
  // Bekleyen 900ms'lik bulut senk. zamanlayıcısı tamamlanmadan çıkılırsa,
  // appState.user aşağıda null'lanınca zamanlayıcı sessizce hiçbir şey
  // yapmadan çalışır — son eklenen ders/fasikül buluta hiç ulaşmaz.
  if(appState.user && appState.user.email !== 'misafir@demo.com'){
    await window.flushCloudPersist?.();
  }
  if(window._authReady && appState.user && appState.user.email !== 'misafir@demo.com'){
    try{ await window._authSignOut(window._auth); }catch(e){}
  }
  appState.user = null;
  document.documentElement.classList.remove('guest-mode');
  document.documentElement.classList.remove('can-manage-users');
  document.documentElement.classList.remove('can-admin-json');
  document.getElementById('screen-app').classList.remove('active');
  document.getElementById('screen-login').classList.add('active');
}

export async function loadKullaniciList(){
  const listEl = document.getElementById('adminUserList');
  if(!listEl) return;
  if(!window._firestoreReady){ listEl.innerHTML='<div style="color:var(--text-muted);font-size:13px">Bağlantı bekleniyor…</div>'; return; }
  listEl.innerHTML='<div style="color:var(--text-muted);font-size:13px">Yükleniyor…</div>';
  try{
    const addSection = document.getElementById('adminAddBtn')?.closest('.profil-section');
    if(addSection) addSection.style.display = canManageUsers() ? '' : 'none';
    const infoBox = document.querySelector('#panel-admin .section-title + div');
    if(infoBox && appState.user?.role === 'ogretmen'){
      infoBox.innerHTML = '👨‍🏫 Bu panelde yalnızca size bağlı öğrencileri, performanslarını ve verdiğiniz görevleri görebilirsiniz.';
    }
    const users = await fetchAllUsers();
    const teachers = users.filter(u=>u.role === 'ogretmen' && u.active !== false);
    const teacherSelect = document.getElementById('adminNewTeacher');
    if(teacherSelect){
      teacherSelect.innerHTML = '<option value="">Öğretmen seçilmedi</option>' + teachers.map(t=>
        `<option value="${esc(t.id)}">${esc(t.name || t.email)} · ${esc(t.email)}</option>`
      ).join('');
    }
    toggleTeacherAssignField();
    const visibleUsers = canManageUsers() ? users : users.filter(canViewStudent);
    document.getElementById('adminUserCount').textContent = visibleUsers.length;
    if(visibleUsers.length===0){
      listEl.innerHTML = '<div style="color:var(--text-muted);font-size:13px">Henüz kullanıcı eklenmedi.</div>';
      renderTeacherStudentPanel([], teachers);
      return;
    }
    listEl.innerHTML = visibleUsers.map(u=>`
      <div style="display:flex;flex-direction:column;gap:10px;padding:12px 14px;background:var(--bg-3);border:1px solid var(--border);border-radius:var(--radius)">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:14px">${esc(u.name||'')}</div>
            <div style="font-size:12px;color:var(--text-muted)">${esc(u.email||'')} · ${u.role==='admin'?'🔑 Yönetici':u.role==='ogretmen'?'Öğretmen':'Öğrenci'}${u.assignedTeacherEmail?` · Öğretmen: ${esc(u.assignedTeacherEmail)}`:''}${u.active===false?' · <span style="color:var(--red)">Devre Dışı</span>':''}</div>
          </div>
          ${canManageUsers()?`<button class="pref-action pref-chip" onclick="toggleKullaniciActive('${u.id}', ${u.active===false})">${u.active===false?'Etkinleştir':'Devre Dışı Bırak'}</button>`:''}
          ${canManageUsers()?`<button class="pref-action pref-chip" style="color:var(--yellow)" onclick="resetKullaniciPassword('${esc(String(u.email||'')).replace(/'/g,"\\'")}')">Şifre Sıfırla</button>`:''}
          ${canManageUsers()?`<button class="pref-action pref-chip" style="color:var(--red)" onclick="deleteKullanici('${u.id}')">Sil</button>`:''}
        </div>
        ${renderFasikulVisibilityControls(u)}
      </div>
    `).join('');
    renderTeacherStudentPanel(visibleUsers.filter(u=>u.role === 'ogrenci'), teachers);
  }catch(e){
    console.warn('Kullanıcı listesi yüklenemedi:', e);
    listEl.innerHTML = '<div style="color:var(--red);font-size:13px">Liste yüklenirken hata oluştu.</div>';
  }
}

export async function addKullanici(){
  if(!canManageUsers()){
    window.showToast?.('Kullanıcı oluşturma yetkisi yalnızca adminde.', 'error');
    return;
  }
  const name = document.getElementById('adminNewName').value.trim();
  const email = document.getElementById('adminNewEmail').value.trim().toLowerCase();
  const pass = document.getElementById('adminNewPass').value;
  const role = document.getElementById('adminNewRole').value;
  const teacherUid = document.getElementById('adminNewTeacher')?.value || '';
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
    const teacherProfile = teacherUid ? (await window._fsGetDoc(window._fsDoc(window._db,'kullanicilar',teacherUid))).data() : null;

    const docRef = window._fsDoc(window._db, 'kullanicilar', uid);
    await window._fsSetDoc(docRef, {
      name, email, role, active: true,
      assignedTeacherUid: role === 'ogrenci' ? teacherUid : '',
      assignedTeacherEmail: role === 'ogrenci' ? (teacherProfile?.email || '') : '',
      assignedTeacherName: role === 'ogrenci' ? (teacherProfile?.name || '') : '',
      hiddenFasikulIds: [],
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
        const teacherProfile = teacherUid ? (await window._fsGetDoc(window._fsDoc(window._db,'kullanicilar',teacherUid))).data() : null;
        const docRef = window._fsDoc(window._db, 'kullanicilar', uid);
        await window._fsSetDoc(docRef, {
          name, email, role, active: true,
          assignedTeacherUid: role === 'ogrenci' ? teacherUid : '',
          assignedTeacherEmail: role === 'ogrenci' ? (teacherProfile?.email || '') : '',
          assignedTeacherName: role === 'ogrenci' ? (teacherProfile?.name || '') : '',
          hiddenFasikulIds: [],
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

function renderTeacherStudentPanel(students){
  const wrap = document.getElementById('teacherStudentList');
  if(!wrap) return;
  if(!students.length){
    wrap.innerHTML = '<div style="color:var(--text-muted);font-size:13px">Bu yetki kapsamında görüntülenecek öğrenci yok.</div>';
    return;
  }
  wrap.innerHTML = `
    <div class="student-detail" id="managedStudentDetail">
      <div style="color:var(--text-muted);font-size:13px">Öğrenci seçiliyor…</div>
    </div>`;
  window._managedStudents = students;
  selectManagedStudent(students[0].id);
}

function assignmentTimeSummary(g){
  if(g.startAt || g.endAt){
    return `${formatDateTime(g.startAt)} - ${formatDateTime(g.endAt)}`;
  }
  return formatDate(g.dueDate);
}

function assignmentTitleFromSelection(fas, topicOpt){
  const topicLabel = (topicOpt?.textContent || '').trim();
  if(topicLabel && topicLabel !== 'Konu/Test seçilmedi') return topicLabel;
  return fas?.fasikulAd || 'Çalışma görevi';
}

function renderAssignmentManageCard(studentUid, g, fasOptions){
  const currentFasId = g.fasikulId || '';
  const topics = currentFasId ? manifestTopicOptions(currentFasId) : [];
  const currentTopicId = g.konuId || '';
  return `
    <details class="assignment-card assignment-edit-card ${g.status==='done'?'done':''}">
      <summary>
        <div><b>${esc(g.title || 'Görev')}</b><span>${esc(g.fasikulAd || '')}${g.konuAd?` / ${esc(g.konuAd)}`:''}</span></div>
        <div>${g.status==='done'?'Tamamlandı':'Bekliyor'} · ${esc(assignmentTimeSummary(g))}</div>
      </summary>
      <div class="assignment-edit-form">
        <select id="editFasikul_${esc(g.id)}" onchange="refreshEditAssignmentTopicOptions('${studentUid}','${esc(g.id)}')">
          <option value="">Fasikül seç</option>
          ${fasOptions.map(f=>`<option value="${esc(f.id)}" ${f.id===currentFasId?'selected':''}>${esc(f.label)}</option>`).join('')}
        </select>
        <select id="editTopic_${esc(g.id)}">
          <option value="">Konu/Test seçilmedi</option>
          ${topics.map(t=>`<option value="${esc(t.id)}" data-konu="${esc(t.konuAd)}" data-alt="${esc(t.altKonuAd)}" ${t.id===currentTopicId?'selected':''}>${esc(t.label)}</option>`).join('')}
        </select>
        <label class="assignment-time-field"><span>Başlangıç</span><input id="editStart_${esc(g.id)}" type="datetime-local" value="${esc(dateTimeInputValue(g.startAt))}"></label>
        <label class="assignment-time-field"><span>Bitiş</span><input id="editEnd_${esc(g.id)}" type="datetime-local" value="${esc(dateTimeInputValue(g.endAt))}"></label>
        <div class="assignment-edit-actions">
          <button type="button" class="btn-login" onclick="updateAssignment('${studentUid}','${esc(g.id)}')">Kaydet</button>
          <button type="button" class="danger-btn" onclick="deleteAssignment('${studentUid}','${esc(g.id)}')">Kaldır</button>
        </div>
      </div>
    </details>`;
}

export async function selectManagedStudent(uid){
  const detail = document.getElementById('managedStudentDetail');
  const student = (window._managedStudents || []).find(s=>s.id === uid);
  if(!detail || !student || !canViewStudent(student)) return;
  const keepStudyPlanModal = window._studyPlanModalOpen === true && detail.querySelector('.study-plan-modal');
  if(!keepStudyPlanModal){
    detail.innerHTML = '<div style="color:var(--text-muted);font-size:13px">Performans ve görevler yükleniyor…</div>';
  }
  try{
    let records = [];
    let gorevler = [];
    let planItems = [];
    const loadWarnings = [];
    try{
      records = await fetchStudentRecords(uid);
    }catch(e){
      console.warn('Öğrenci çözüm kayıtları yüklenemedi:', e);
      loadWarnings.push('Çözüm kayıtları okunamadı.');
    }
    const summary = computeRecordsSummary(records);
    try{
      const gorevSnap = await window._fsGetDocs(window._fsCollection(window._db,'kullanicilar',uid,'gorevler'));
      gorevSnap.forEach(d=>{
        const item = {id:d.id, ...d.data()};
        if(item.type !== 'studyPlan') gorevler.push(item);
      });
    }catch(e){
      console.warn('Öğrenci görevleri yüklenemedi:', e);
      loadWarnings.push('Görevler okunamadı.');
    }
    gorevler.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
    const fasOptions = visibleFasikulOptionsForStudent(student);
    const planWeek = window._studyPlanFormState?.studentUid === uid
      ? (window._studyPlanFormState.weekKey || currentWeekValue())
      : (document.getElementById('planWeek')?.value || currentWeekValue());
    try{
      planItems = await fetchStudyPlan(uid, planWeek);
    }catch(e){
      console.warn('Öğrenci çalışma planı yüklenemedi:', e);
      loadWarnings.push('Kayıtlı çalışma planı okunamadı; yeni plan yine oluşturulabilir.');
    }
    planItems = mergePendingStudyPlan(uid, planWeek, planItems);
    detail.innerHTML = `
      <div class="managed-student-select">
        <label>Öğrenci Seç</label>
        <select id="managedStudentSelect" onchange="selectManagedStudent(this.value)">
          ${(window._managedStudents || []).map(s=>`
            <option value="${esc(s.id)}" ${s.id === uid ? 'selected' : ''}>${esc(s.name || s.email)}${s.email ? ` · ${esc(s.email)}` : ''}</option>
          `).join('')}
        </select>
      </div>
      <div class="managed-student-head">
        <div>
          <h3>${esc(student.name || student.email)}</h3>
          <p>${esc(student.email || '')}</p>
          ${student.assignedTeacherEmail?`<p>Öğretmen: ${esc(student.assignedTeacherEmail)}</p>`:''}
        </div>
        <div class="managed-kpis">
          <span><b>${summary.total}</b> çözüldü</span>
          <span><b>%${summary.accuracy}</b> doğru</span>
          <span><b>${summary.weekly}</b> bu hafta</span>
        </div>
        <button class="watch-live-btn" onclick="watchStudentLive('${esc(uid)}','${esc(String(student.name||student.email||'')).replace(/'/g,"\\'")}')" title="Öğrencinin şu an açık olduğu sayfayı ve çizimlerini canlı gör">🔴 Canlı İzle</button>
      </div>
      ${loadWarnings.length ? `<div class="managed-warning">${loadWarnings.map(esc).join(' ')}</div>` : ''}
      <div class="managed-topic-list">
        ${Object.entries(summary.byTopic).slice(0,8).map(([name,k])=>{
          const acc = k.dogru + k.yanlis ? Math.round(k.dogru / (k.dogru+k.yanlis) * 100) : 0;
          return `<div><b>${esc(name)}</b><span>${k.total} çözüm · %${acc}</span></div>`;
        }).join('') || '<div style="color:var(--text-muted)">Henüz çözüm kaydı yok.</div>'}
      </div>
      <details class="managed-fold assignment-fold">
        <summary><span>🗓️ Görev Ata</span><b>Formu aç</b></summary>
        <div class="assignment-form">
          <select id="assignFasikul" onchange="refreshAssignTopicOptions()">
            <option value="">Fasikül seç</option>
            ${fasOptions.map(f=>`<option value="${esc(f.id)}">${esc(f.label)}</option>`).join('')}
          </select>
          <select id="assignTopic"><option value="">Konu/Test seçilmedi</option></select>
          <label class="assignment-time-field"><span>Başlangıç</span><input id="assignStart" type="datetime-local"></label>
          <label class="assignment-time-field"><span>Bitiş</span><input id="assignEnd" type="datetime-local"></label>
          <button class="btn-login" onclick="createAssignment('${uid}')">Görev Ata</button>
        </div>
      </details>
      <details class="managed-fold managed-assignments" ${window._assignmentListFoldOpen ? 'open' : ''}>
        <summary><span>📌 Verilen Görevler</span><b>${gorevler.length} görev</b></summary>
        <div class="assignment-list">
          ${gorevler.map(g=>renderAssignmentManageCard(uid, g, fasOptions)).join('') || '<div style="color:var(--text-muted);font-size:13px">Henüz görev verilmedi.</div>'}
        </div>
      </details>
      ${renderStudyPlanEditor(uid, planItems)}`;
  }catch(e){
    console.warn('Öğrenci takip bilgisi yüklenemedi:', e);
    detail.innerHTML = '<div style="color:var(--red);font-size:13px">Öğrenci bilgileri yüklenemedi.</div>';
  }
}

export function refreshAssignTopicOptions(){
  const fasikulId = document.getElementById('assignFasikul')?.value || '';
  const topicSelect = document.getElementById('assignTopic');
  if(!topicSelect) return;
  const topics = manifestTopicOptions(fasikulId);
  topicSelect.innerHTML = '<option value="">Konu/Test seçilmedi</option>' + topics.map(t=>
    `<option value="${esc(t.id)}" data-konu="${esc(t.konuAd)}" data-alt="${esc(t.altKonuAd)}">${esc(t.label)}</option>`
  ).join('');
}

export function refreshPlanFasikulOptions(){
  const dersId = document.getElementById('planDers')?.value || '';
  const fasikulSelect = document.getElementById('planFasikul');
  if(!fasikulSelect) return;
  const selectedUid = document.getElementById('managedStudentSelect')?.value || window._studyPlanFormState?.studentUid || '';
  const student = (window._managedStudents || []).find(s=>s.id === selectedUid);
  const rows = visibleFasikulOptionsForStudent(student).filter(f=>!dersId || f.dersId === dersId);
  fasikulSelect.innerHTML = '<option value="">Ders / fasikül seç</option>' + rows.map(f=>
    `<option value="${esc(f.id)}">${esc(f.label)}</option>`
  ).join('');
  refreshPlanTopicOptions();
}

export function refreshEditAssignmentTopicOptions(studentUid, taskId){
  const fasikulId = document.getElementById(`editFasikul_${taskId}`)?.value || '';
  const topicSelect = document.getElementById(`editTopic_${taskId}`);
  if(!topicSelect) return;
  const student = (window._managedStudents || []).find(s=>s.id === studentUid);
  const allowed = visibleFasikulOptionsForStudent(student).some(f=>f.id === fasikulId);
  const topics = allowed ? manifestTopicOptions(fasikulId) : [];
  topicSelect.innerHTML = '<option value="">Konu/Test seçilmedi</option>' + topics.map(t=>
    `<option value="${esc(t.id)}" data-konu="${esc(t.konuAd)}" data-alt="${esc(t.altKonuAd)}">${esc(t.label)}</option>`
  ).join('');
}

export function toggleTeacherAssignField(){
  const role = document.getElementById('adminNewRole')?.value || 'ogrenci';
  const group = document.getElementById('adminTeacherAssignGroup');
  if(group) group.style.display = role === 'ogrenci' ? '' : 'none';
}

export async function createAssignment(studentUid){
  const student = (window._managedStudents || []).find(s=>s.id === studentUid);
  if(!student || !canViewStudent(student)){ window.showToast?.('Bu öğrenci için yetkiniz yok.', 'error'); return; }
  const fasikulId = document.getElementById('assignFasikul')?.value || '';
  const fas = visibleFasikulOptionsForStudent(student).find(f=>f.id === fasikulId);
  if(fasikulId && !fas){
    window.showToast?.('Bu öğrenciye bu fasikül için yetki verilmemiş.', 'error');
    return;
  }
  const topicSel = document.getElementById('assignTopic');
  const topicOpt = topicSel?.selectedOptions?.[0];
  const startAt = document.getElementById('assignStart')?.value ? new Date(document.getElementById('assignStart').value).toISOString() : '';
  const endAt = document.getElementById('assignEnd')?.value ? new Date(document.getElementById('assignEnd').value).toISOString() : '';
  const payload = {
    title: assignmentTitleFromSelection(fas, topicOpt),
    fasikulId,
    fasikulAd: fas?.fasikulAd || '',
    dersId: fas?.dersId || '',
    dersAd: fas?.dersAd || '',
    konuId: topicSel?.value || '',
    konuAd: topicOpt?.dataset?.konu || '',
    altKonuAd: topicOpt?.dataset?.alt || '',
    period: 'tekil',
    startAt,
    endAt,
    dueDate: (endAt || startAt || '').slice(0,10),
    note: '',
    status: 'todo',
    assignedByUid: appState.user.uid,
    assignedByEmail: appState.user.email,
    assignedByName: appState.user.name,
    createdAt: new Date().toISOString()
  };
  const id = `${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  await window._fsSetDoc(window._fsDoc(window._db,'kullanicilar',studentUid,'gorevler',id), payload);
  window.showToast?.('Görev atandı', 'success');
  selectManagedStudent(studentUid);
}

export async function updateAssignment(studentUid, taskId){
  const student = (window._managedStudents || []).find(s=>s.id === studentUid);
  if(!student || !canViewStudent(student) || !taskId){ window.showToast?.('Bu görev için yetkiniz yok.', 'error'); return; }
  const fasikulId = document.getElementById(`editFasikul_${taskId}`)?.value || '';
  const fas = visibleFasikulOptionsForStudent(student).find(f=>f.id === fasikulId);
  if(fasikulId && !fas){
    window.showToast?.('Bu öğrenciye bu fasikül için yetki verilmemiş.', 'error');
    return;
  }
  const topicSel = document.getElementById(`editTopic_${taskId}`);
  const topicOpt = topicSel?.selectedOptions?.[0];
  const startValue = document.getElementById(`editStart_${taskId}`)?.value || '';
  const endValue = document.getElementById(`editEnd_${taskId}`)?.value || '';
  const startAt = startValue ? new Date(startValue).toISOString() : '';
  const endAt = endValue ? new Date(endValue).toISOString() : '';
  const payload = {
    title: assignmentTitleFromSelection(fas, topicOpt),
    fasikulId,
    fasikulAd: fas?.fasikulAd || '',
    dersId: fas?.dersId || '',
    dersAd: fas?.dersAd || '',
    konuId: topicSel?.value || '',
    konuAd: topicOpt?.dataset?.konu || '',
    altKonuAd: topicOpt?.dataset?.alt || '',
    startAt,
    endAt,
    dueDate: (endAt || startAt || '').slice(0,10),
    note: '',
    updatedAt: new Date().toISOString()
  };
  try{
    window._assignmentListFoldOpen = true;
    await window._fsSetDoc(window._fsDoc(window._db,'kullanicilar',studentUid,'gorevler',taskId), payload, {merge:true});
    window.showToast?.('Görev güncellendi', 'success');
    selectManagedStudent(studentUid);
  }catch(e){
    console.warn('Görev güncellenemedi:', e);
    window.showToast?.('Görev güncellenemedi', 'error');
  }
}

export async function deleteAssignment(studentUid, taskId){
  const student = (window._managedStudents || []).find(s=>s.id === studentUid);
  if(!student || !canViewStudent(student) || !taskId){ window.showToast?.('Bu görev için yetkiniz yok.', 'error'); return; }
  if(!confirm('Bu görevi kaldırmak istiyor musunuz?')) return;
  try{
    window._assignmentListFoldOpen = true;
    await window._fsDeleteDoc(window._fsDoc(window._db,'kullanicilar',studentUid,'gorevler',taskId));
    window.showToast?.('Görev kaldırıldı', 'success');
    selectManagedStudent(studentUid);
  }catch(e){
    console.warn('Görev kaldırılamadı:', e);
    window.showToast?.('Görev kaldırılamadı', 'error');
  }
}

export function refreshPlanTopicOptions(){
  const fasikulId = document.getElementById('planFasikul')?.value || '';
  const topicSelect = document.getElementById('planTopic');
  if(!topicSelect) return;
  const topics = manifestTopicOptions(fasikulId);
  topicSelect.innerHTML = '<option value="">Konu/Test seçilmedi</option>' + topics.map(t=>
    `<option value="${esc(t.id)}" data-konu="${esc(t.konuAd)}" data-alt="${esc(t.altKonuAd)}">${esc(t.label)}</option>`
  ).join('');
}

export function prefillStudyPlanSlot(dayIndex, hour){
  const day = document.getElementById('planDay');
  const hourSelect = document.getElementById('planHour');
  if(day) day.value = String(dayIndex);
  if(hourSelect) hourSelect.value = String(hour);
  window._studyPlanModalOpen = true;
}

export function openStudyPlanModal(studentUid){
  window._studyPlanModalOpen = true;
  selectManagedStudent(studentUid);
}

export function closeStudyPlanModal(studentUid){
  window._studyPlanModalOpen = false;
  selectManagedStudent(studentUid);
}

export function shiftStudyPlanWeek(studentUid, delta){
  const currentWeek = document.getElementById('planWeek')?.value || window._studyPlanFormState?.weekKey || currentWeekValue();
  const range = weekRangeFromValue(currentWeek);
  const start = range.start ? new Date(range.start) : new Date();
  start.setDate(start.getDate() + (Number(delta) || 0) * 7);
  const week = weekValueFromDate(dateInputValue(start));
  window._studyPlanFormState = {
    ...(window._studyPlanFormState || {}),
    studentUid,
    weekKey: week
  };
  window._studyPlanModalOpen = true;
  selectManagedStudent(studentUid);
}

export function changeStudyPlanWeek(studentUid){
  const dateValue = document.getElementById('planWeekDate')?.value || '';
  const week = weekValueFromDate(dateValue);
  const weekInput = document.getElementById('planWeek');
  if(weekInput) weekInput.value = week;
  window._studyPlanModalOpen = true;
  selectManagedStudent(studentUid);
}

function findVisibleStudyPlanItem(slotId){
  return (window._visibleStudyPlanItems || []).find(item=>item.id === slotId);
}

function stageStudyPlanItem(studentUid, original, changes){
  if(!original) return false;
  const weekKey = changes.weekKey || original.weekKey || document.getElementById('planWeek')?.value || currentWeekValue();
  const dayIndex = Number(changes.dayIndex ?? original.dayIndex ?? 0);
  const hour = Number(changes.hour ?? original.hour ?? 8);
  const id = studyPlanSlotId(weekKey, dayIndex, hour);
  const durationHours = Math.max(1, Math.min(STUDY_HOURS[STUDY_HOURS.length - 1] - hour + 1, Number(changes.durationHours ?? original.durationHours ?? 1)));
  const next = {
    ...original,
    ...changes,
    id,
    studentUid,
    weekKey,
    dayIndex,
    dayName: STUDY_DAYS[dayIndex] || '',
    hour,
    durationHours,
    updatedAt: new Date().toISOString()
  };
  const times = studyPlanSlotTimes(next);
  next.startAt = times.startAt;
  next.endAt = times.endAt;
  window._pendingStudyPlanSlots = [
    ...((window._pendingStudyPlanSlots || []).filter(item=>item.id !== original.id && item.id !== id)),
    next
  ].slice(-60);
  if(original.id !== id){
    window._pendingStudyPlanDeletes = [
      ...((window._pendingStudyPlanDeletes || []).filter(item=>item.id !== original.id)),
      {studentUid, weekKey:original.weekKey || weekKey, id: original.id}
    ].slice(-60);
  }else{
    window._pendingStudyPlanDeletes = (window._pendingStudyPlanDeletes || []).filter(item=>item.id !== id);
  }
  window._studyPlanFormState = {
    ...(window._studyPlanFormState || {}),
    studentUid,
    weekKey,
    dayIndex,
    hour,
    dersId: next.dersId || '',
    fasikulId: next.fasikulId || '',
    konuId: next.konuId || '',
    note: next.note || ''
  };
  window._studyPlanModalOpen = true;
  return true;
}

export function dragStudyPlanSlot(event, slotId){
  event.dataTransfer?.setData('text/plain', slotId);
}

export function dropStudyPlanSlot(event, studentUid, dayIndex, hour){
  event.preventDefault();
  event.stopPropagation();
  const slotId = event.dataTransfer?.getData('text/plain') || '';
  const item = findVisibleStudyPlanItem(slotId);
  if(!item) return;
  if(stageStudyPlanItem(studentUid, item, {dayIndex, hour})){
    window.showToast?.('Plan hücresi taşındı. Kaydetmek için Planı Onayla.', 'success');
    selectManagedStudent(studentUid);
  }
}

export function startResizeStudyPlanSlot(event, studentUid, slotId){
  event.preventDefault();
  event.stopPropagation();
  const item = findVisibleStudyPlanItem(slotId);
  if(!item) return;
  const startY = event.clientY;
  const startDuration = Math.max(1, Number(item.durationHours || 1));
  const grid = document.querySelector('.study-plan-grid');
  const gridRect = grid?.getBoundingClientRect();
  const rowHeight = gridRect ? Math.max(44, (gridRect.height - 36) / STUDY_HOURS.length) : 66;
  const onPointerUp = upEvent => {
    document.removeEventListener('pointerup', onPointerUp);
    const deltaRows = Math.round((upEvent.clientY - startY) / rowHeight);
    const maxDuration = STUDY_HOURS[STUDY_HOURS.length - 1] - Number(item.hour) + 1;
    const durationHours = Math.max(1, Math.min(maxDuration, startDuration + deltaRows));
    if(stageStudyPlanItem(studentUid, item, {durationHours})){
      window.showToast?.(`${durationHours} saatlik plan taslağa alındı.`, 'success');
      selectManagedStudent(studentUid);
    }
  };
  document.addEventListener('pointerup', onPointerUp, {once:true});
}

export async function createStudyPlanSlot(studentUid){
  const student = (window._managedStudents || []).find(s=>s.id === studentUid);
  if(!student || !canViewStudent(student)){ window.showToast?.('Bu öğrenci için yetkiniz yok.', 'error'); return; }
  const weekKey = document.getElementById('planWeek')?.value || currentWeekValue();
  const dayIndex = Number(document.getElementById('planDay')?.value || 0);
  const hour = Number(document.getElementById('planHour')?.value || 8);
  const fasikulId = document.getElementById('planFasikul')?.value || '';
  const fas = visibleFasikulOptionsForStudent(student).find(f=>f.id === fasikulId);
  if(!fasikulId || !fas){
    window.showToast?.('Programa eklemek için öğrencinin yetkili olduğu bir ders/fasikül seçin.', 'error');
    return;
  }
  const topicSel = document.getElementById('planTopic');
  const topicOpt = topicSel?.selectedOptions?.[0];
  const topicLabel = topicSel?.value ? (topicOpt?.textContent || '').trim() : '';
  const id = studyPlanSlotId(weekKey, dayIndex, hour);
  const payload = {
    id,
    studentUid,
    type: 'studyPlan',
    title: topicLabel || fas.fasikulAd || 'Çalışma planı',
    status: 'todo',
    period: 'haftalik-plan',
    weekKey,
    dayIndex,
    dayName: STUDY_DAYS[dayIndex] || '',
    hour,
    durationHours: 1,
    fasikulId,
    fasikulAd: fas.fasikulAd || '',
    dersId: fas.dersId || '',
    dersAd: fas.dersAd || '',
    konuId: topicSel?.value || '',
    konuAd: topicOpt?.dataset?.konu || topicLabel || '',
    altKonuAd: topicOpt?.dataset?.alt || '',
    topicLabel,
    note: document.getElementById('planNote')?.value.trim() || '',
    assignedByUid: appState.user.uid,
    assignedByEmail: appState.user.email,
    assignedByName: appState.user.name,
    updatedAt: new Date().toISOString()
  };
  const times = studyPlanSlotTimes(payload);
  payload.startAt = times.startAt;
  payload.endAt = times.endAt;
  window._studyPlanFormState = {
    studentUid,
    weekKey,
    dayIndex,
    hour,
    dersId: fas.dersId || '',
    fasikulId,
    konuId: topicSel?.value || '',
    note: payload.note
  };
  window._pendingStudyPlanSlots = [
    ...((window._pendingStudyPlanSlots || []).filter(item=>item.id !== id)),
    payload
  ].slice(-60);
  window._pendingStudyPlanDeletes = (window._pendingStudyPlanDeletes || []).filter(item=>item.id !== id);
  window._studyPlanModalOpen = true;
  window.showToast?.('Programa eklendi. Kaydetmek için Planı Onayla.', 'success');
  selectManagedStudent(studentUid);
}

export function clearStudyPlanSlot(studentUid, slotId){
  const student = (window._managedStudents || []).find(s=>s.id === studentUid);
  if(!student || !canViewStudent(student) || !slotId) return;
  const weekKey = document.getElementById('planWeek')?.value || currentWeekValue();
  window._pendingStudyPlanSlots = (window._pendingStudyPlanSlots || []).filter(item=>item.id !== slotId);
  window._pendingStudyPlanDeletes = [
    ...((window._pendingStudyPlanDeletes || []).filter(item=>item.id !== slotId)),
    {studentUid, weekKey, id: slotId}
  ].slice(-60);
  window._studyPlanModalOpen = true;
  window.showToast?.('Plan hücresi taslakta silindi. Kaydetmek için Planı Onayla.', 'success');
  selectManagedStudent(studentUid);
}

export async function approveStudyPlanChanges(studentUid){
  const student = (window._managedStudents || []).find(s=>s.id === studentUid);
  if(!student || !canViewStudent(student)){ window.showToast?.('Bu öğrenci için yetkiniz yok.', 'error'); return; }
  const pending = (window._pendingStudyPlanSlots || []).filter(item=>item.studentUid === studentUid);
  const deletes = (window._pendingStudyPlanDeletes || []).filter(item=>item.studentUid === studentUid);
  if(!pending.length && !deletes.length){
    window.showToast?.('Onaylanacak program değişikliği yok.', 'info');
    return;
  }
  try{
    const writes = [];
    pending.forEach(item=>{
      const times = studyPlanSlotTimes(item);
      const planPayload = {...item, startAt:item.startAt || times.startAt, endAt:item.endAt || times.endAt, updatedAt:new Date().toISOString()};
      const taskId = `task_${item.id}`;
      const taskPayload = {
        ...planPayload,
        id: taskId,
        type: 'planTask',
        sourcePlanId: item.id,
        title: item.topicLabel || item.title || 'Çalışma görevi',
        period: 'haftalik-plan',
        status: 'todo',
        dueDate: times.startAt ? times.startAt.slice(0,10) : '',
        createdAt: item.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      writes.push(window._fsSetDoc(window._fsDoc(window._db,'kullanicilar',studentUid,'gorevler',item.id), planPayload, {merge:true}));
      writes.push(window._fsSetDoc(window._fsDoc(window._db,'kullanicilar',studentUid,'gorevler',taskId), taskPayload, {merge:true}));
    });
    deletes.forEach(item=>{
      writes.push(window._fsDeleteDoc(window._fsDoc(window._db,'kullanicilar',studentUid,'gorevler',item.id)));
      writes.push(window._fsDeleteDoc(window._fsDoc(window._db,'kullanicilar',studentUid,'gorevler',`task_${item.id}`)));
    });
    await Promise.all([
      ...writes
    ]);
    window._pendingStudyPlanSlots = (window._pendingStudyPlanSlots || []).filter(item=>item.studentUid !== studentUid);
    window._pendingStudyPlanDeletes = (window._pendingStudyPlanDeletes || []).filter(item=>item.studentUid !== studentUid);
    window._studyPlanModalOpen = false;
    window.showToast?.('Çalışma programı onaylandı', 'success');
    selectManagedStudent(studentUid);
  }catch(e){
    console.warn('Çalışma programı onaylanamadı:', e);
    window.showToast?.('Çalışma programı onaylanamadı: ' + (e.message || e.code || 'Yetki/bağlantı hatası'), 'error');
  }
}

export async function loadMyAssignments(){
  const section = document.getElementById('studentAssignmentsSection');
  const list = document.getElementById('studentAssignmentsList');
  if(!section || !list || !appState.user || appState.user.role !== 'ogrenci' || appState.user.email === 'misafir@demo.com'){
    if(section) section.style.display='none';
    return;
  }
  section.style.display = '';
  try{
    const [snap, cozumSnap] = await Promise.all([
      window._fsGetDocs(window._fsCollection(window._db,'kullanicilar',appState.user.uid,'gorevler')),
      window._fsGetDocs(window._fsCollection(window._db,'kullanicilar',appState.user.uid,'cozumler'))
    ]);
    const tasks = [];
    snap.forEach(d=>{
      const item = {id:d.id, ...d.data()};
      if(item.type !== 'studyPlan') tasks.push(item);
    });
    const records = [];
    cozumSnap.forEach(d=>records.push({id:d.id, ...d.data()}));
    tasks.sort((a,b)=>String(a.dueDate||'9999').localeCompare(String(b.dueDate||'9999')));
    list.innerHTML = tasks.map(t=>{
      const progress = assignmentProgress(t, records);
      const progressText = progress.expected
        ? `${progress.correct}/${progress.expected} doğru${progress.wrong ? ` · ${progress.wrong} yanlış kaldı` : ''}`
        : `${progress.correct} doğru${progress.wrong ? ` · ${progress.wrong} yanlış kaldı` : ''}`;
      return `
      <div class="assignment-card ${progress.done?'done':''}">
        <div><b>${esc(t.title || 'Görev')}</b><span>${esc(t.fasikulAd || '')}${t.konuAd?` / ${esc(t.konuAd)}`:''}${t.note?` · ${esc(t.note)}`:''}</span></div>
        <div class="assignment-status ${progress.done?'done':'pending'}">${progress.done?'Tamamlandı':progressText}</div>
      </div>
    `}).join('') || '<div style="color:var(--text-muted);font-size:13px">Henüz atanmış görev yok.</div>';
  }catch(e){
    console.warn('Görevler yüklenemedi:', e);
    list.innerHTML = '<div style="color:var(--red);font-size:13px">Görevler yüklenemedi.</div>';
  }
}

export async function loadMyStudyPlan(){
  const section = document.getElementById('studentStudyPlanSection');
  const list = document.getElementById('studentStudyPlanList');
  if(!section || !list || !appState.user || appState.user.role !== 'ogrenci' || appState.user.email === 'misafir@demo.com'){
    if(section) section.style.display='none';
    return;
  }
  section.style.display = '';
  try{
    const week = currentWeekValue();
    const range = weekRangeFromValue(week);
    const items = await fetchStudyPlan(appState.user.uid, week);
    items.sort((a,b)=>(a.dayIndex-b.dayIndex) || (a.hour-b.hour));
    list.innerHTML = `
      <div class="student-plan-week">${esc(range.label)} haftası</div>
      <div class="student-plan-list">
        ${items.map(item=>`
          <div class="student-plan-item">
            <b>${esc(item.dayName || STUDY_DAYS[item.dayIndex] || '')} · ${String(item.hour).padStart(2,'0')}:00</b>
            <span>${esc(studyPlanLabel(item) || 'Çalışma')}</span>
            ${item.note?`<small>${esc(item.note)}</small>`:''}
          </div>
        `).join('') || '<div style="color:var(--text-muted);font-size:13px">Bu hafta için çalışma planı atanmadı.</div>'}
      </div>`;
  }catch(e){
    console.warn('Çalışma planı yüklenemedi:', e);
    list.innerHTML = '<div style="color:var(--red);font-size:13px">Çalışma planı yüklenemedi.</div>';
  }
}

export async function toggleUserFasikulVisibility(uid, fasikulId, hide){
  if(!canManageUsers() || !uid || !fasikulId) return;
  try{
    const docRef = window._fsDoc(window._db,'kullanicilar',uid);
    const snap = await window._fsGetDoc(docRef);
    const data = snap.exists() ? snap.data() : {};
    const current = window._pendingFasikulVisibility?.[uid] || data.hiddenFasikulIds || [];
    const hidden = new Set(Array.isArray(current) ? current : []);
    if(hide) hidden.add(fasikulId);
    else hidden.delete(fasikulId);
    window._pendingFasikulVisibility = {...(window._pendingFasikulVisibility || {}), [uid]:[...hidden]};
    const btn = document.querySelector(`.fasikul-access-btn[data-user="${uid}"][data-fasikul="${fasikulId}"]`);
    if(btn){
      btn.classList.toggle('hidden', hide);
      const label = btn.querySelector('b');
      if(label) label.textContent = hide ? 'Göster' : 'Gizle';
      btn.setAttribute('onclick', `event.stopPropagation();toggleUserFasikulVisibility('${uid}','${fasikulId}',${!hide})`);
    }
    window.showToast?.('Fasikül yetkisi taslağa alındı. Kaydetmek için onaylayın.', 'success');
  }catch(e){
    console.warn('Fasikül görünürlüğü güncellenemedi:', e);
    window.showToast?.('Fasikül yetkisi güncellenemedi', 'error');
  }
}

export async function applyUserFasikulVisibility(uid){
  if(!canManageUsers() || !uid) return;
  const staged = window._pendingFasikulVisibility?.[uid];
  if(!Array.isArray(staged)){
    window.showToast?.('Onaylanacak fasikül yetkisi değişikliği yok.', 'info');
    return;
  }
  try{
    await window._fsSetDoc(window._fsDoc(window._db,'kullanicilar',uid), {hiddenFasikulIds:staged}, {merge:true});
    delete window._pendingFasikulVisibility[uid];
    window.showToast?.('Fasikül yetkileri onaylandı', 'success');
  }catch(e){
    console.warn('Fasikül yetkileri onaylanamadı:', e);
    window.showToast?.('Fasikül yetkileri onaylanamadı', 'error');
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
