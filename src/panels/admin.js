// Admin panel — işlevler firebase/auth.js'de tanımlı ve window'a kayıtlı
// Bu modül sadece window exports'u konsolide eder.
import {
  loadKullaniciList, addKullanici, deleteKullanici,
  toggleKullaniciActive, resetKullaniciPassword,
  selectManagedStudent, refreshAssignTopicOptions,
  createAssignment, updateAssignment, deleteAssignment, loadMyAssignments,
  refreshEditAssignmentTopicOptions,
  refreshPlanFasikulOptions, refreshPlanTopicOptions, prefillStudyPlanSlot, openStudyPlanModal, closeStudyPlanModal, shiftStudyPlanWeek, changeStudyPlanWeek,
  createStudyPlanSlot, clearStudyPlanSlot, dragStudyPlanSlot, dropStudyPlanSlot, startResizeStudyPlanSlot, approveStudyPlanChanges, loadMyStudyPlan,
  toggleTeacherAssignField, toggleUserFasikulVisibility, applyUserFasikulVisibility, bulkSetUserFasikulVisibility,
  openStudentFasikulReview, closeStudentFasikulReview, reviewJumpToWrong
} from '../firebase/auth.js';

window.loadKullaniciList = loadKullaniciList;
window.addKullanici = addKullanici;
window.deleteKullanici = deleteKullanici;
window.toggleKullaniciActive = toggleKullaniciActive;
window.resetKullaniciPassword = resetKullaniciPassword;
window.selectManagedStudent = selectManagedStudent;
window.refreshAssignTopicOptions = refreshAssignTopicOptions;
window.createAssignment = createAssignment;
window.updateAssignment = updateAssignment;
window.deleteAssignment = deleteAssignment;
window.loadMyAssignments = loadMyAssignments;
window.refreshEditAssignmentTopicOptions = refreshEditAssignmentTopicOptions;
window.refreshPlanFasikulOptions = refreshPlanFasikulOptions;
window.refreshPlanTopicOptions = refreshPlanTopicOptions;
window.prefillStudyPlanSlot = prefillStudyPlanSlot;
window.openStudyPlanModal = openStudyPlanModal;
window.closeStudyPlanModal = closeStudyPlanModal;
window.shiftStudyPlanWeek = shiftStudyPlanWeek;
window.changeStudyPlanWeek = changeStudyPlanWeek;
window.createStudyPlanSlot = createStudyPlanSlot;
window.clearStudyPlanSlot = clearStudyPlanSlot;
window.dragStudyPlanSlot = dragStudyPlanSlot;
window.dropStudyPlanSlot = dropStudyPlanSlot;
window.startResizeStudyPlanSlot = startResizeStudyPlanSlot;
window.approveStudyPlanChanges = approveStudyPlanChanges;
window.loadMyStudyPlan = loadMyStudyPlan;
window.toggleTeacherAssignField = toggleTeacherAssignField;
window.toggleUserFasikulVisibility = toggleUserFasikulVisibility;
window.applyUserFasikulVisibility = applyUserFasikulVisibility;
window.bulkSetUserFasikulVisibility = bulkSetUserFasikulVisibility;
window.openStudentFasikulReview = openStudentFasikulReview;
window.closeStudentFasikulReview = closeStudentFasikulReview;
window.reviewJumpToWrong = reviewJumpToWrong;
