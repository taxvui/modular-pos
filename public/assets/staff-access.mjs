const el=id=>document.getElementById(id);
const roleName=role=>role==='MANAGER'?'Quản lý cửa hàng':'Thu ngân';
export function invitationToken(){
 const bytes=crypto.getRandomValues(new Uint8Array(32));
 return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
}
export class StaffAccessPanel {
 constructor({client,store,canManage,run,isCurrent,message}){
  Object.assign(this,{client,store,run,isCurrent,message,offset:0,pending:new Map(),codeId:null});
  el('staffAdminArea').hidden=!canManage;
  if(!canManage)return;
  el('createStaffInviteForm').onsubmit=event=>{event.preventDefault();run(()=>this.create());};
  el('reloadStaff').onclick=()=>run(()=>this.refresh());
  el('previousStaff').onclick=()=>run(()=>this.refresh(Math.max(0,this.offset-100)));
  el('nextStaff').onclick=()=>run(()=>this.refresh(this.offset+100));
  el('copyStaffCode').onclick=async()=>{
   if(!this.isCurrent())return;
   try{await navigator.clipboard.writeText(el('staffInviteCode').value);message('Đã sao chép mã. Chỉ gửi cho đúng nhân viên được mời.');}
   catch{el('staffInviteCode').select();message('Chọn mã và sao chép thủ công để đưa cho đúng nhân viên.');}
  };
 }
 rpc(name,args){return this.client.request('/rest/v1/rpc/'+name,{method:'POST',body:{p_org_id:this.store.organization_id,p_store_id:this.store.id,...args}});}
 clearCode(){this.codeId=null;el('staffInviteCode').value='';el('staffInviteCodeArea').hidden=true;}
 destroy(){
  this.pending.clear();this.clearCode();el('createStaffInviteForm').reset();
  el('createStaffInviteForm').onsubmit=null;
  for(const id of ['reloadStaff','previousStaff','nextStaff','copyStaffCode'])el(id).onclick=null;
  el('staffAdminArea').hidden=true;el('staffMembers').replaceChildren();el('staffInvitations').replaceChildren();
 }
 async create(){
  if(!this.isCurrent()||!el('createStaffInviteForm').reportValidity())return;
  const email=el('staffInviteEmail').value.trim().toLowerCase(),role=el('staffInviteRole').value;
  const key='invite:'+JSON.stringify({email,role});
  if(!this.pending.has(key))this.pending.set(key,{id:crypto.randomUUID(),token:invitationToken()});
  const pending=this.pending.get(key);
  const result=await this.rpc('rpc_create_staff_invitation',{p_operation_id:pending.id,p_email:email,p_role:role,p_token:pending.token});
  if(!result.id||result.email!==email||result.role_code!==role)throw new Error('INVALID_SERVER_ACK');
  if(!this.isCurrent())return;
  this.pending.delete(key);
  if(result.status==='OPEN'){
   this.codeId=result.id;el('staffInviteCode').value=pending.token;
   el('staffInviteCodeInfo').textContent=email+' · '+roleName(role)+' · Hết hạn '+new Date(result.expires_at).toLocaleString('vi-VN');
   el('staffInviteCodeArea').hidden=false;
  }else this.clearCode();
  el('createStaffInviteForm').reset();await this.refresh();
  if(result.status!=='OPEN'){this.message('Mã của yêu cầu trước đã được sử dụng hoặc thu hồi. Tải danh sách để kiểm tra trạng thái.');return;}
  this.message('Đã tạo mã dùng một lần cho đúng email. Lưu mã để đưa cho nhân viên; sau khi đóng hoặc tải lại trang cần thu hồi và tạo mã mới nếu chưa sao chép.');
 }
 async refresh(offset=this.offset){
  if(!this.isCurrent())return;
  const data=await this.rpc('rpc_store_staff_snapshot',{p_offset:offset});
  if(!this.isCurrent())return;
  this.offset=offset;
  el('staffCount').textContent=data.members_total?'Nhân viên '+(offset+1)+'–'+(offset+data.members.length)+' / '+data.members_total:'Chưa có nhân viên được cấp quyền bằng mã.';
  el('previousStaff').hidden=offset===0;el('nextStaff').hidden=offset+data.members.length>=data.members_total;
  el('staffMembers').replaceChildren(...data.members.map(row=>this.member(row)));
  el('staffInvitations').replaceChildren(...data.invitations.map(row=>this.invitation(row)));
  if(this.codeId&&!data.invitations.some(row=>row.id===this.codeId&&row.status==='OPEN'))this.clearCode();
 }
 invitation(row){
  const li=document.createElement('li'),text=document.createElement('p');
  const labels={OPEN:'Chờ tiếp nhận',ACCEPTED:'Đã tiếp nhận',REVOKED:'Đã thu hồi',EXPIRED:'Đã hết hạn'};
  text.textContent=row.email+' · '+roleName(row.role_code)+' · '+labels[row.status]+' · '+new Date(row.expires_at).toLocaleString('vi-VN');li.append(text);
  if(row.status==='OPEN'){
   const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Thu hồi mã';
   button.onclick=()=>this.run(async()=>{
    if(!this.isCurrent())return;
    await this.rpc('rpc_revoke_staff_invitation',{p_invitation_id:row.id});
    if(!this.isCurrent())return;
    if(this.codeId===row.id)this.clearCode();await this.refresh();this.message('Đã thu hồi mã. Mã cũ không cấp được quyền nữa.');
   });li.append(button);
  }
  return li;
 }
 member(row){
  const li=document.createElement('li'),details=document.createElement('details'),summary=document.createElement('summary');
  summary.textContent=row.full_name+' · '+row.email+' · '+roleName(row.role_code)+' · '+(row.active?'Đang có quyền':'Đã ngừng quyền');details.append(summary);
  if(row.user_id===this.client.userId){li.append(details);return li;}
  const form=document.createElement('form'),roleLabel=document.createElement('label'),role=document.createElement('select');role.name='role';roleLabel.textContent='Vai trò tại cửa hàng';
  for(const code of ['CASHIER','MANAGER']){const option=document.createElement('option');option.value=code;option.textContent=roleName(code);role.append(option);}role.value=row.role_code;roleLabel.append(role);
  const activeLabel=document.createElement('label'),active=document.createElement('input');active.type='checkbox';active.name='active';active.checked=row.active;activeLabel.className='modifier-choice';activeLabel.append(active,document.createTextNode('Có quyền truy cập cửa hàng này'));
  const reasonLabel=document.createElement('label'),reason=document.createElement('input');reason.name='reason';reason.required=true;reason.minLength=3;reason.maxLength=500;reasonLabel.textContent='Lý do thay đổi';reasonLabel.append(reason);
  const workLabel=document.createElement('label'),work=document.createElement('input');work.type='checkbox';workLabel.className='modifier-choice';workLabel.append(work,document.createTextNode('Đã đồng bộ đơn tại máy và chốt ca của nhân viên trước khi ngừng quyền'));
  const toggle=()=>{workLabel.hidden=active.checked;work.required=!active.checked;};active.onchange=toggle;toggle();
  const submit=document.createElement('button');submit.type='submit';submit.className='secondary';submit.textContent='Lưu quyền cửa hàng';form.append(roleLabel,activeLabel,reasonLabel,workLabel,submit);
  form.onsubmit=event=>{event.preventDefault();this.run(async()=>{
   if(!this.isCurrent()||!form.reportValidity())return;
   const args={p_user_id:row.user_id,p_role:role.value,p_active:active.checked,p_expected_revision:row.revision,p_reason:reason.value.trim()};
   const key='change:'+JSON.stringify(args);if(!this.pending.has(key))this.pending.set(key,{id:crypto.randomUUID()});
   const result=await this.rpc('rpc_set_store_staff',{...args,p_operation_id:this.pending.get(key).id});
   if(result.user_id!==row.user_id||result.role_code!==args.p_role||result.active!==args.p_active)throw new Error('INVALID_SERVER_ACK');
   if(!this.isCurrent())return;
   this.pending.delete(key);await this.refresh();this.message('Đã cập nhật quyền tại cửa hàng. Các mã chờ của nhân viên ở cửa hàng này cũng đã được thu hồi.');
  });};
  details.append(form);li.append(details);return li;
 }
}
