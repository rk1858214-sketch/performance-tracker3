const AUTH_USERS_KEY = 'performanceTrackerUsers';
const AUTH_SESSION_KEY = 'performanceTrackerSession';
const DEFAULT_USERS = {
  admin: { username: 'admin', password: 'admin123', role: 'admin', displayName: 'Admin' },
  viewer: { username: 'viewer', password: 'viewer123', role: 'viewer', displayName: 'Viewer' }
};

function clone(obj){ return JSON.parse(JSON.stringify(obj)); }
function ensureUsers(){
  const raw = localStorage.getItem(AUTH_USERS_KEY);
  if(!raw){
    localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(DEFAULT_USERS));
    return clone(DEFAULT_USERS);
  }
  try {
    const parsed = JSON.parse(raw);
    const merged = { ...clone(DEFAULT_USERS), ...parsed };
    localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(merged));
    return merged;
  } catch (_) {
    localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(DEFAULT_USERS));
    return clone(DEFAULT_USERS);
  }
}
function getUsers(){ return ensureUsers(); }
function saveUsers(users){ localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(users)); }
function getCurrentSession(){ try { return JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || 'null'); } catch (_) { return null; } }
function getCurrentUser(){ const session = getCurrentSession(); return session?.username ? getUsers()[session.username] || null : null; }
function isAuthenticated(){ return !!getCurrentUser(); }
function requireAuth(){ if(!isAuthenticated()){ window.location.href='login.html'; return false; } return true; }
function isAdmin(){ return getCurrentUser()?.role === 'admin'; }
function loginUser(username,password){
  const user = getUsers()[String(username||'').trim()];
  if(!user || user.password !== String(password||'')) return { ok:false, message:'اسم المستخدم أو كلمة المرور غير صحيحة' };
  localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({ username:user.username, role:user.role, loginAt:new Date().toISOString() }));
  return { ok:true, user };
}
function logout(){ localStorage.removeItem(AUTH_SESSION_KEY); window.location.href='login.html'; }
function validatePassword(newPassword, confirmPassword){
  const pwd = String(newPassword||'');
  if(pwd.length < 4) return 'كلمة المرور يجب ألا تقل عن 4 أحرف';
  if(pwd !== String(confirmPassword||'')) return 'تأكيد كلمة المرور غير مطابق';
  return '';
}
function changeMyPassword(currentPassword, newPassword, confirmPassword){
  const user = getCurrentUser();
  if(!user) return { ok:false, message:'يجب تسجيل الدخول أولًا' };
  if(user.password !== String(currentPassword||'')) return { ok:false, message:'كلمة المرور الحالية غير صحيحة' };
  const validation = validatePassword(newPassword, confirmPassword);
  if(validation) return { ok:false, message:validation };
  const users = getUsers();
  users[user.username].password = String(newPassword);
  saveUsers(users);
  return { ok:true, message:'تم تغيير كلمة المرور بنجاح' };
}
function adminUpdatePassword(targetUsername, newPassword, confirmPassword){
  if(!isAdmin()) return { ok:false, message:'هذه العملية متاحة للـ admin فقط' };
  const users = getUsers();
  if(!users[targetUsername]) return { ok:false, message:'المستخدم غير موجود' };
  const validation = validatePassword(newPassword, confirmPassword);
  if(validation) return { ok:false, message:validation };
  users[targetUsername].password = String(newPassword);
  saveUsers(users);
  return { ok:true, message:`تم تحديث كلمة مرور ${targetUsername}` };
}
window.getUsers=getUsers; window.saveUsers=saveUsers; window.getCurrentUser=getCurrentUser; window.requireAuth=requireAuth;
window.isAdmin=isAdmin; window.loginUser=loginUser; window.logout=logout; window.changeMyPassword=changeMyPassword;
window.adminUpdatePassword=adminUpdatePassword; window.ensureUsers=ensureUsers;
ensureUsers();
