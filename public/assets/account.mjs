import './sales.mjs';
import { AuthClient } from './auth-client.mjs';
const el = id => document.getElementById(id);
let client;
let stores = [];
const message = text => { el('status').textContent = text; };
function panels() {
  el('loginPanel').hidden = Boolean(client?.signedIn);
  el('workspacePanel').hidden = !client?.signedIn;
  el('joinStorePanel').hidden = !client?.signedIn;
  if (!client?.signedIn) { el('bootstrapPanel').hidden = true; window.dispatchEvent(new CustomEvent('workspace:ready', { detail: null })); }
}
async function perform(action) {
  document.querySelectorAll('button').forEach(b => { b.disabled = true; });
  try { await action(); }
  catch (error) {
    const messages = {
      invalid_credentials: 'Email hoặc mật khẩu chưa đúng.',
      email_not_confirmed: 'Hãy xác nhận email trước khi đăng nhập.',
      WORKSPACE_ALREADY_EXISTS: 'Tài khoản đã có không gian làm việc.',
      '23505': 'Tài khoản đã có không gian làm việc hoặc mã thương hiệu đã được sử dụng.',
      AUTH_REQUIRED: 'Phiên đăng nhập đã hết hiệu lực. Vui lòng đăng nhập lại; đơn đã lưu tại máy vẫn được giữ.',
      SESSION_CHANGED: 'Phiên làm việc đã thay đổi. Vui lòng kiểm tra tài khoản đang đăng nhập.',
      INVITATION_INVALID: 'Mã không hợp lệ, đã hết hạn hoặc không dành cho email đang đăng nhập.',
      EMAIL_VERIFICATION_REQUIRED: 'Cần xác nhận email trước khi nhận quyền cửa hàng.',
      OWNER_ACCESS_PROTECTED: 'Không thể thay quyền chủ sở hữu bằng mã nhân viên.',
      STAFF_ACCESS_MANAGED_ELSEWHERE: 'Tài khoản đang có quyền tổ chức hoặc quyền tùy chỉnh; cần quản trị riêng.',
      MEMBERSHIP_INACTIVE: 'Quyền thành viên tổ chức đang bị ngừng. Liên hệ chủ quán.',
      ACCOUNT_DISABLED: 'Hồ sơ tài khoản đang bị ngừng.',
      STAFF_ALREADY_ACTIVE: 'Tài khoản đã có quyền tại cửa hàng. Chủ quán có thể đổi quyền trong danh sách nhân viên.',
      INVALID_STAFF_NAME: 'Tên hiển thị cần từ 2 đến 150 ký tự.',
      SUPABASE_NOT_CONFIGURED: 'Chưa cấu hình kết nối Supabase cho môi trường này.',
    };
    message(messages[error.message] || 'Không thực hiện được. Kiểm tra kết nối và thử lại.');
  } finally {
    panels();
    document.querySelectorAll('button').forEach(b => { b.disabled = !client; });
  }
}
function selectedStore() {
  const store = stores.find(s => s.id === el('stores').value);
  el('storeSummary').textContent = store ? `${store.name} · ${store.code}` : 'Chưa có cửa hàng được cấp quyền.';
  window.dispatchEvent(new CustomEvent('workspace:ready', { detail: { client, store } }));
}
async function loadWorkspace(preferredStore) {
  const previous=preferredStore||el('stores').value;
  const [organizations, accessibleStores] = await Promise.all([client.organizations(), client.stores()]);
  stores = accessibleStores;
  el('stores').replaceChildren(...stores.map(store => {
    const option = document.createElement('option'); option.value = store.id; option.textContent = store.name; return option;
  }));
  if(stores.some(store=>store.id===previous))el('stores').value=previous;
  el('stores').disabled = stores.length === 0;
  el('bootstrapPanel').hidden = organizations.length !== 0;
  selectedStore();
}
try {
  let sessionStorage = null;
  try { sessionStorage = window.sessionStorage; } catch { /* Storage may be denied by the browser. */ }
  client = new AuthClient({...(window.MODULAR_POS_CONFIG || {}),sessionStorage,onSessionEnd:({reason})=>{
    stores=[];el('stores').replaceChildren();el('identity').textContent='';el('storeSummary').textContent='';el('joinStoreForm').reset();
    panels();
    if(reason==='EXPIRED')message('Phiên đăng nhập đã hết hiệu lực. Đăng nhập lại để tiếp tục đồng bộ; đơn đã lưu tại máy vẫn được giữ.');
  }});
  message('Sẵn sàng đăng nhập.');
} catch {
  message('Chưa cấu hình Supabase. Cần SUPABASE_URL và SUPABASE_ANON_KEY khi build.');
  document.querySelectorAll('button').forEach(b => { b.disabled = true; });
}
el('loginForm').addEventListener('submit', event => {
  event.preventDefault();
  perform(async () => {
    const user = await client.signIn(el('email').value.trim(), el('password').value);
    el('password').value = '';
    el('identity').textContent = user.email;
    await loadWorkspace();
    message('Đã đăng nhập.');
  });
});
el('signup').addEventListener('click', () => {
  if (!el('loginForm').reportValidity()) return;
  perform(async () => {
    await client.signUp(el('email').value.trim(), el('password').value);
    el('password').value = '';
    message('Đã gửi yêu cầu tạo tài khoản. Kiểm tra email để xác nhận trước khi đăng nhập.');
  });
});
el('logout').addEventListener('click', () => perform(async () => {
  window.dispatchEvent(new CustomEvent('workspace:ready',{detail:null}));el('joinStoreForm').reset();
  try { await client.signOut(); } finally { stores = []; el('stores').replaceChildren(); el('identity').textContent = ''; }
  message('Đã đăng xuất.');
}));
el('stores').addEventListener('change', selectedStore);
el('bootstrapForm').addEventListener('submit', event => {
  event.preventDefault();
  perform(async () => {
    await client.bootstrap({ name: el('brand').value.trim(), slug: el('slug').value.trim(), storeName: el('storeName').value.trim(), address: el('address').value.trim() });
    await loadWorkspace(); message('Đã tạo cửa hàng đầu tiên.');
  });
});
panels();

if (client) perform(async () => {
  message('Đang kiểm tra phiên đăng nhập…');
  const user = await client.restoreSession();
  if (!user) { message('Sẵn sàng đăng nhập.'); return; }
  el('identity').textContent = user.email;
  await loadWorkspace();
  message('Đã khôi phục phiên đăng nhập.');
});

el('joinStoreForm').addEventListener('submit',event=>{
 event.preventDefault();perform(async()=>{
  const result=await client.request('/rest/v1/rpc/rpc_accept_staff_invitation',{method:'POST',body:{p_token:el('joinStaffToken').value.trim(),p_full_name:el('joinStaffName').value.trim()}});
  el('joinStaffToken').value='';await loadWorkspace(result.store_id);
  message('Mã đã được tiếp nhận. Cửa hàng hiển thị theo quyền hiện tại của tài khoản.');
 });
});
