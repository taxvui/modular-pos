import { ShiftHistoryPanel } from './shift-history.mjs';
import { saveOrderDurably } from './order-save.mjs';
import { OrderHistoryPanel } from './order-history.mjs';
import { StaffAccessPanel } from './staff-access.mjs';
import { OfflineStore, isUnresolved } from './offline-store.mjs';
import { submitOfflineReview, receiveOfflineReviews, OfflineReviewPanel } from './offline-review.mjs';
const el=id=>document.getElementById(id);
const money=value=>`${Number(value).toLocaleString('vi-VN')} ₫`;
let api,store,context={},products=[],variants=[],modifiers=[],orders=[],cart=[],editing=null,pending=null,generation=0,dirty=false,currentShift=null,payments=[];
let outbox=null,limited=false,reviewPanel=null,staffPanel=null,historyPanel=null,shiftPanel=null;
let saveRecovery=null,recoveryOwnsCart=false,activeRun=null,historyRefund=null;
const connectionFailure=error=>error instanceof TypeError||error.status>=500||error.status===429;
const status=text=>{el('salesStatus').textContent=text;};
const rpc=(name,args)=>api.request(`/rest/v1/rpc/${name}`,{method:'POST',body:{p_org_id:store.organization_id,p_store_id:store.id,...args}});
const rows=(table,select='*',extra='')=>api.request(`/rest/v1/${table}?select=${select}&store_id=eq.${store.id}${extra}`);
function option(value,label){const o=document.createElement('option');o.value=value;o.textContent=label;return o;}
function reset(){dirty=false;cart=[];editing=null;pending=null;el('customerName').value='';el('customerPhone').value='';el('customerAddress').value='';renderCart();}
async function run(action){
 if(activeRun?.generation===generation)return;
 const token={generation};token.finished=new Promise(resolve=>{token.resolve=resolve;});activeRun=token;
 document.querySelectorAll('#orderForm input,#orderForm select,#refundForm input,#refundForm select').forEach(node=>{node.disabled=true;});
 document.querySelectorAll('#salesPanel button').forEach(b=>{b.disabled=true;});
 el('stores').disabled=true;
 try{await action();}catch(error){
  const code=error.message;
  const messages={INVALID_SHIFT_FILTER:'Khoảng ngày mở ca cần từ 1 đến 93 ngày, trạng thái và con trỏ trang phải hợp lệ.',SHIFT_NOT_FOUND:'Không tìm thấy ca tại cửa hàng đang chọn.',INVALID_SHIFT_RESPONSE:'Chưa nhận được dữ liệu đối soát hợp lệ. Hãy tải lại.',PAYMENT_ALREADY_REFUNDED:'Thanh toán này đã được hoàn. Không trả tiền cho khách lần nữa; kiểm tra chi tiết lịch sử.',PAYMENT_NOT_REFUNDABLE:'Đơn chưa có thanh toán hợp lệ để hoàn.',PAYMENT_NOT_FOUND:'Không tìm thấy thanh toán tại cửa hàng đang chọn.',SAVE_RECOVERY_REQUIRED:'Có yêu cầu lưu đơn chưa xác nhận tại máy. Hãy xác nhận lại yêu cầu gốc trước khi lưu tiếp.',LOCAL_WRITE_FAILED:'Không cập nhật được dữ liệu bền vững tại máy. Giữ trang mở, kiểm tra lưu trữ rồi xác nhận lại đúng yêu cầu.',LOCAL_STORAGE_UNAVAILABLE:'Không mở được dữ liệu tại máy. Cần khôi phục lưu trữ trình duyệt trước khi gửi đơn.',INVALID_HISTORY_FILTER:'Khoảng ngày cần từ 1 đến 93 ngày, bộ lọc và con trỏ trang phải hợp lệ.',ORDER_NOT_FOUND:'Không tìm thấy đơn tại cửa hàng đang chọn.',AUTH_REQUIRED:'Phiên đã hết hiệu lực. Đăng nhập lại để truy cập cửa hàng và hàng đợi tại máy.',SESSION_CHANGED:'Phiên làm việc đã thay đổi. Hãy kiểm tra tài khoản đang đăng nhập.',STAFF_HAS_OPEN_WORK:'Nhân viên còn ca đang mở hoặc đề nghị hủy offline chưa xử lý. Cần chốt/đối soát trước khi ngừng quyền.',SELF_ACCESS_PROTECTED:'Không thể tự thay quyền của phiên đang quản trị.',OWNER_ACCESS_PROTECTED:'Quyền chủ sở hữu được bảo vệ.',STAFF_ACCESS_MANAGED_ELSEWHERE:'Tài khoản có quyền tổ chức hoặc tùy chỉnh, không thay bằng vai trò cửa hàng tại đây.',INVITATION_ALREADY_OPEN:'Email đang có mã chờ tại cửa hàng này. Thu hồi mã cũ nếu muốn tạo lại.',STAFF_ALREADY_ACTIVE:'Nhân viên đã có quyền. Hãy đổi vai trò trong danh sách nhân viên.',INVITATION_ALREADY_USED:'Mã đã được tiếp nhận. Hãy quản lý quyền của nhân viên trong danh sách.',INVITATION_INVALID:'Mã không còn hợp lệ.',INVALID_STAFF_ROLE:'Vai trò chưa được hỗ trợ.',STAFF_NOT_FOUND:'Không tìm thấy nhân viên ở cửa hàng này.',STAFF_ROLE_CONFIGURATION_INVALID:'Vai trò hệ thống đã bị thay đổi. Cần kiểm tra cấu hình quyền trước khi cấp tiếp.',MEMBERSHIP_INACTIVE:'Thành viên tổ chức đang bị ngừng quyền.',ACCOUNT_DISABLED:'Hồ sơ tài khoản đang bị ngừng.',OFFLINE_REVIEW_REQUIRED:'Đơn đang được đề nghị hủy. Đã khóa gửi lại trong lúc quản lý đối soát.',CASH_REFUND_CONFIRMATION_REQUIRED:'Cần xác nhận đã hoàn đúng tiền cho khách trước khi duyệt hủy.',REVIEW_ALREADY_RESOLVED:'Đề nghị đã được xử lý. Hãy tải lại danh sách.',OFFLINE_SALE_ALREADY_COMMITTED:'Đơn đã lên server. Không thể hủy bản ghi offline; hãy kiểm tra đơn và dùng luồng hủy/hoàn tiền.',ONLINE_ORDER_EXISTS:'Server đã có đơn từ yêu cầu này. Hãy kiểm tra đơn trước khi xử lý; không tạo lại đơn mới.',REVIEW_NOT_FOUND:'Không tìm thấy đề nghị được cấp quyền.',OPEN_SHIFT_REQUIRED:'Bạn cần mở ca trước khi thu hoặc hoàn tiền.',INSUFFICIENT_PAYMENT:'Số tiền nhận chưa đủ hoặc vượt giới hạn cho phép.',TRANSFER_CONFIRMATION_REQUIRED:'Cần nhận đúng số tiền và xác nhận đã kiểm tra chuyển khoản.',CASH_INSUFFICIENT:'Tiền mặt dự kiến trong ca không đủ để hoàn đơn này.',SHIFT_CLOSED:'Ca đã đóng. Hãy tải lại dữ liệu.',REASON_REQUIRED:'Nhập lý do từ 3 đến 500 ký tự.',ORDER_FINALIZED:'Đơn đã hoàn tất. Không thể thu tiền hoặc sửa lần nữa.',VERSION_CONFLICT:'Đơn đã được máy khác cập nhật. Mở lại đơn để xem dữ liệu mới.',PERMISSION_DENIED:'Bạn chưa được cấp quyền thực hiện thao tác này.',IDEMPOTENCY_KEY_REUSED:'Yêu cầu đã thay đổi. Hãy tải lại danh sách đơn.', '23505':'Tên bàn bị trùng hoặc bàn đã có đơn đang mở.',VARIANT_UNAVAILABLE:'Một size đã ngừng bán. Hãy kiểm tra thực đơn.',DELIVERY_DETAILS_REQUIRED:'Đơn giao hàng cần số điện thoại và địa chỉ.'};
  status(messages[code]||'Chưa xác nhận được thao tác. Kiểm tra kết nối rồi thử lại cùng yêu cầu.');
 }finally{if(activeRun===token){activeRun=null;document.querySelectorAll('#salesPanel button').forEach(b=>{b.disabled=false;});el('saveOrder').disabled=!context.can_sell;el('stores').disabled=el('stores').options.length===0;document.querySelectorAll('#refundForm input,#refundForm select').forEach(node=>{node.disabled=false;});renderSaveRecovery();}token.resolve();}
}
function renderSelection(){
 const pid=el('productChoice').value;
 el('variantChoice').replaceChildren(...variants.filter(v=>v.product_id===pid&&v.active).map(v=>option(v.id,`${v.name} · ${money(v.price)}`)));
 el('modifierChoices').replaceChildren(...modifiers.filter(m=>m.product_id===pid&&m.active).map(m=>{
  const label=document.createElement('label');label.className='modifier-choice';const input=document.createElement('input');input.type='checkbox';input.value=m.id;label.append(input,document.createTextNode(`${m.name} +${money(m.price)}`));return label;
 }));
}
function renderCart(){
 el('orderTitle').textContent=editing?`Đang sửa đơn ${editing.id.slice(0,8)} · phiên bản ${editing.revision}`:'Đơn mới';
 el('cartItems').replaceChildren(...cart.map((line,index)=>{
  const row=document.createElement('li');const text=document.createElement('span');text.textContent=`${line.name} × ${line.quantity} · ${money(line.unit*line.quantity)}`;
  const remove=document.createElement('button');remove.type='button';remove.className='secondary';remove.textContent='Bỏ món';remove.addEventListener('click',()=>{cart.splice(index,1);dirty=true;pending=null;renderCart();});row.append(text,remove);return row;
 }));
 el('cartTotal').textContent=`Tạm tính: ${money(cart.reduce((s,l)=>s+l.quantity*l.unit,0))}`;
 el('positionField').hidden=el('channelChoice').value!=='DINE_IN';
 el('deliveryFields').hidden=el('channelChoice').value!=='DELIVERY';
 renderFinance();
}
async function refresh(){
 const current=generation,queue=outbox;
 let ps,vs,ms,tables,open,updatedAt=Date.now(),cached=false,cacheFailed=false;
 try {
  [ps,vs,ms,tables,open]=await Promise.all([rows('products','*','&active=eq.true&order=name'),rows('product_variants'),rows('product_modifiers'),rows('service_positions','*','&active=eq.true&order=name'),rows('orders','*','&order_status=eq.OPEN&order=updated_at.desc&limit=200')]);
  if(![ps,vs,ms,tables,open].every(Array.isArray))throw new Error('INVALID_CATALOG_RESPONSE');
 }catch(error){
  if(!connectionFailure(error)||!api.signedIn||!queue)throw error;
  const snapshot=await queue.cached();
  if(!snapshot||snapshot.version!==1||!Number.isFinite(snapshot.updatedAt)||
   !['products','variants','modifiers','positions'].every(key=>Array.isArray(snapshot[key])))throw error;
  ({products:ps,variants:vs,modifiers:ms,positions:tables,updatedAt}=snapshot);
  open=[];cached=true;
 }
 if(current!==generation)return;
 if(!cached&&queue){
  try{await queue.cache({version:1,updatedAt,products:ps,variants:vs,modifiers:ms,positions:tables});}
  catch{cacheFailed=true;}
  if(current!==generation)return;
 }
 limited=cached;products=ps;variants=vs;modifiers=ms;orders=open;
 const selectedProduct=el('productChoice').value,selectedVariant=el('variantChoice').value,selectedPosition=el('positionChoice').value;
 el('productChoice').replaceChildren(...products.map(p=>option(p.id,`${p.category} · ${p.name}`)));
 if(products.some(p=>p.id===selectedProduct))el('productChoice').value=selectedProduct;
 el('positionChoice').replaceChildren(option('','Chọn bàn'),...tables.map(p=>option(p.id,p.name)));
 if(tables.some(p=>p.id===selectedPosition))el('positionChoice').value=selectedPosition;
 el('openOrders').replaceChildren(...orders.map(o=>{
  const row=document.createElement('li');const label=document.createElement('span');label.textContent=`${o.id.slice(0,8)} · ${o.channel==='DINE_IN'?(tables.find(p=>p.id===o.position_id)?.name||'Tại bàn'):o.channel==='DELIVERY'?'Giao hàng':'Mang về'} · ${money(o.total_amount)}`;
  const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Mở đơn';button.addEventListener('click',()=>run(()=>openOrder(o)));row.append(label,button);return row;
 }));
 if(!orders.length){const item=document.createElement('li');item.textContent=cached?'Chưa thể tải đơn trên server. Có thể lưu đơn mới tại máy.':'Chưa có đơn đang mở.';el('openOrders').append(item);}
 renderSelection();
 if(variants.some(v=>v.id===selectedVariant&&v.active&&v.product_id===el('productChoice').value))el('variantChoice').value=selectedVariant;
 renderCart();renderPriceEditor();
 if(!cached){
  try{await refreshFinance();}catch(error){if(!connectionFailure(error))throw error;limited=true;}
 }
 if(current!==generation)return;
 el('catalogAdmin').hidden=limited||!context.can_manage_catalog;
 const time=new Date(updatedAt).toLocaleString('vi-VN',{timeZone:store.timezone||'Asia/Ho_Chi_Minh'});
 el('catalogStatus').textContent=(limited?'Đang dùng dữ liệu lưu tại máy từ '+time+'. Giá và bàn sẽ được kiểm tra khi đồng bộ.':'Đã tải menu lúc '+time+'.')+
  (cacheFailed?' Chưa lưu được bản menu bền vững. Hãy giữ trang mở.':'');
 renderFinance();
 return !limited;
}
async function openOrder(order){
 if(saveRecovery){status('Cần xác nhận yêu cầu lưu cũ trước khi mở đơn khác.');return;}
 const current=generation;
 const lines=await rows('order_items','*',`&order_id=eq.${order.id}`);
 if(current!==generation)return;
 dirty=false;editing=order;pending=null;cart=lines.map(l=>({variant_id:l.variant_id,modifier_ids:l.modifier_snapshot.map(m=>m.id),quantity:l.quantity,name:`${l.product_name} / ${l.variant_name}${l.modifier_snapshot.length?' + '+l.modifier_snapshot.map(m=>m.name).join(', '):''}`,unit:Number(l.unit_amount)}));
 el('channelChoice').value=order.channel;el('positionChoice').value=order.position_id||'';
 el('customerName').value=order.customer.name||'';el('customerPhone').value=order.customer.phone||'';el('customerAddress').value=order.customer.address||'';
 renderCart();status('Đã mở dữ liệu đơn từ server. Giá hiện tại sẽ được kiểm tra lại khi lưu.');
}
function priceRow(kind){
 const row=el('priceRowTemplate').content.firstElementChild.cloneNode(true);row.dataset.kind=kind;
 row.querySelector('input[type=text]').placeholder=kind==='variant'?'Tên size (VD: M)':'Tên topping';
 row.querySelector('button').addEventListener('click',()=>row.remove());
 (kind==='variant'?el('variantRows'):el('modifierRows')).append(row);
}
function renderPriceEditor(){
 el('priceVariant').replaceChildren(...variants.map(v=>option(v.id,`${products.find(p=>p.id===v.product_id)?.name||'Món'} / ${v.name}`)));
 selectPrice();
}
function selectPrice(){const v=variants.find(v=>v.id===el('priceVariant').value);el('newPrice').value=v?.price??'';el('variantActive').checked=v?.active??false;}
el('priceVariant').addEventListener('change',selectPrice);
el('editPriceForm').addEventListener('submit',e=>{e.preventDefault();run(async()=>{await rpc('rpc_update_variant',{p_variant_id:el('priceVariant').value,p_price:Number(el('newPrice').value),p_active:el('variantActive').checked});await refresh();status('Đã cập nhật giá/trạng thái size.');});});
el('productChoice').addEventListener('change',renderSelection);
el('channelChoice').addEventListener('change',()=>{dirty=true;renderCart();});
for(const id of ['positionChoice','customerName','customerPhone','customerAddress'])el(id).addEventListener('input',()=>{dirty=true;renderFinance();});
el('addVariant').addEventListener('click',()=>priceRow('variant'));
el('addModifier').addEventListener('click',()=>priceRow('modifier'));
el('addItem').addEventListener('click',()=>{
 if(!context.can_sell)return;
 const v=variants.find(v=>v.id===el('variantChoice').value);if(!v){status('Hãy tạo và chọn size đang bán.');return;}
 const p=products.find(p=>p.id===v.product_id);const selected=[...el('modifierChoices').querySelectorAll('input:checked')].map(i=>modifiers.find(m=>m.id===i.value));
 const quantity=Number(el('itemQuantity').value);if(!Number.isInteger(quantity)||quantity<1||quantity>999){status('Số lượng từ 1 đến 999.');return;}
 dirty=true;cart.push({variant_id:v.id,modifier_ids:selected.map(m=>m.id),quantity,name:`${p.name} / ${v.name}${selected.length?' + '+selected.map(m=>m.name).join(', '):''}`,unit:Number(v.price)+selected.reduce((s,m)=>s+Number(m.price),0)});pending=null;renderCart();
});
el('newOrder').addEventListener('click',()=>{if(saveRecovery)return;reset();status('Đã mở giỏ hàng mới.');});
el('reloadOrders').addEventListener('click',()=>run(async()=>{const online=await refresh();status(online?'Đã tải dữ liệu mới nhất.':'Chưa kết nối được server. Đang dùng menu lưu tại máy để tạo đơn mới.');}));
function renderSaveRecovery(){
 el('saveRecoveryArea').hidden=!saveRecovery;
 el('saveRecoveryInfo').textContent=saveRecovery?'Mã yêu cầu: '+saveRecovery.operationId+' · '+(saveRecovery.payload.p_order_id?'Sửa đơn '+saveRecovery.payload.p_order_id:'Đơn mới')+' · '+new Date(saveRecovery.createdAt).toLocaleString('vi-VN'):'';
 const locked=!!saveRecovery||activeRun?.generation===generation;
 document.querySelectorAll('#orderForm input,#orderForm select,#addItem,#newOrder,#cartItems button,#openOrders button').forEach(node=>{node.disabled=locked;});
 el('retryOrderSave').disabled=!context.can_sell||activeRun?.generation===generation;
}
function restoreSaveCart(record){
 cart=record.display?.cart||[];editing=record.display?.editing||null;dirty=true;pending={id:record.operationId,fingerprint:JSON.stringify(record.payload)};
 el('channelChoice').value=record.payload.p_channel;el('positionChoice').value=record.payload.p_position_id||'';
 el('customerName').value=record.payload.p_customer?.name||'';el('customerPhone').value=record.payload.p_customer?.phone||'';el('customerAddress').value=record.payload.p_customer?.address||'';renderCart();
}
async function submitSavedIntent(payload,id,display,ownsCart=true){
 const queue=outbox,client=api,target=store,current=generation;
 let result;
 try{
  result=await saveOrderDurably(queue,payload,id,display,(request,operationId)=>{
   if(!navigator.onLine)throw new TypeError('NETWORK_ERROR');
   return client.request('/rest/v1/rpc/rpc_save_order',{method:'POST',body:{...request,p_org_id:target.organization_id,p_store_id:target.id,p_operation_id:operationId}});
  },record=>{if(current===generation){saveRecovery=record;recoveryOwnsCart=ownsCart;renderSaveRecovery();}});
 }catch(error){
  if(current!==generation)throw error;
  if(error instanceof TypeError&&!payload.p_order_id&&ownsCart){
   await enqueueLocal(false,id,true);saveRecovery=null;return;
  }
  const record=await queue.pendingSave();saveRecovery=record;
  if(record&&error.message==='SAVE_RECOVERY_REQUIRED')recoveryOwnsCart=false;
  if(record&&!ownsCart)recoveryOwnsCart=false;
  if(!record)recoveryOwnsCart=false;
  throw error;
 }
 if(current!==generation)return;
 saveRecovery=null;
 if(ownsCart)reset();
 await refresh();
 if(ownsCart&&result.order_id){const order=orders.find(o=>o.id===result.order_id);if(order)await openOrder(order);}
 if(result.status==='REVIEW_REQUIRED'){status('Đơn đang được đề nghị hủy. Không tạo lại yêu cầu trong lúc quản lý đối soát.');return;}
 if(result.status==='CANCELLED'){status('Yêu cầu này đã được quản lý duyệt hủy sau đối soát. Không tạo thêm đơn.');return;}
 status(ownsCart?`Đã lưu đơn ${result.order_id.slice(0,8)} · Tổng tiền server: ${money(result.total_amount)}. Có thể thu tiền sau khi mở ca.`:'Đã xác nhận yêu cầu gốc. Giỏ đang soạn vẫn được giữ.');
}
el('retryOrderSave').addEventListener('click',()=>run(async()=>{if(saveRecovery)await submitSavedIntent(saveRecovery.payload,saveRecovery.operationId,saveRecovery.display,recoveryOwnsCart);}));
el('orderForm').addEventListener('submit',e=>{
 e.preventDefault();if(!context.can_sell)return;
 run(async()=>{
  if(saveRecovery){await submitSavedIntent(saveRecovery.payload,saveRecovery.operationId,saveRecovery.display,recoveryOwnsCart);return;}
  if(!cart.length){status('Thêm ít nhất một món trước khi lưu.');return;}
  const payload={p_channel:el('channelChoice').value,p_position_id:el('channelChoice').value==='DINE_IN'?(el('positionChoice').value||null):null,p_items:cart.map(({variant_id,modifier_ids,quantity})=>({variant_id,modifier_ids,quantity})),p_customer:{name:el('customerName').value.trim(),phone:el('customerPhone').value.trim(),address:el('customerAddress').value.trim()},p_order_id:editing?.id||null,p_expected_revision:editing?.revision||null};
  const fingerprint=JSON.stringify(payload);if(!pending||pending.fingerprint!==fingerprint)pending={id:crypto.randomUUID(),fingerprint};
  await submitSavedIntent(payload,pending.id,{cart:structuredClone(cart),editing:structuredClone(editing)},true);
 });
});
el('productForm').addEventListener('submit',e=>{
 e.preventDefault();run(async()=>{
  const prices=target=>[...el(target).children].map(row=>({name:row.querySelector('input[type=text]').value.trim(),price:Number(row.querySelector('input[type=number]').value)}));
  await rpc('rpc_create_product',{p_product:{name:el('productName').value.trim(),category:el('productCategory').value.trim(),variants:prices('variantRows'),modifiers:prices('modifierRows')}});
  el('productForm').reset();el('variantRows').replaceChildren();el('modifierRows').replaceChildren();priceRow('variant');await refresh();status('Đã lưu món, size và topping.');
 });
});
el('positionForm').addEventListener('submit',e=>{e.preventDefault();run(async()=>{await rpc('rpc_create_position',{p_name:el('positionName').value.trim()});el('positionForm').reset();await refresh();status('Đã thêm bàn.');});});
priceRow('variant');
window.addEventListener('workspace:ready',async e=>{
 const current=++generation;const detail=e.detail;
 staffPanel?.destroy();staffPanel=null;historyPanel?.destroy();historyPanel=null;shiftPanel?.destroy();shiftPanel=null;
 historyRefund=null;el('refundForm').reset();el('refundPayment').replaceChildren();el('refundTargetSummary').textContent='Chưa chọn thanh toán.';
 saveRecovery=null;recoveryOwnsCart=false;el('saveRecoveryArea').hidden=true;el('saveRecoveryInfo').textContent='';
 el('salesPanel').hidden=true;context={};limited=false;currentShift=null;payments=[];financePending.clear();reset();
 outbox=null;reviewPanel=null;el('offlineReviewArea').hidden=true;el('offlineReviewList').replaceChildren();
 if(!detail?.store)return;
 api=detail.client;store=detail.store;
 outbox=new OfflineStore({url:api.url,userId:api.userId,organizationId:store.organization_id,storeId:store.id});
 await run(async()=>{
  const result=await rpc('rpc_store_context',{});if(current!==generation)return;
  context=result;el('catalogAdmin').hidden=!context.can_manage_catalog;el('sellingArea').hidden=!context.can_sell;
  await refresh();if(current!==generation)return;
  saveRecovery=await outbox.pendingSave();if(current!==generation)return;
  if(saveRecovery){recoveryOwnsCart=true;restoreSaveCart(saveRecovery);}
  el('salesPanel').hidden=false;status('Đã tải dữ liệu cửa hàng. Có thể lưu đơn mới vào hàng đợi tại máy khi mất mạng.');
  await showOutbox();
  try{await receiveOfflineReviews(api,store,outbox);}catch(error){
   if(!connectionFailure(error))throw error;
   if(current===generation)status('Chưa nhận được kết quả đối soát từ server. Hàng đợi tại máy vẫn được giữ và hiển thị.');
  }
  if(current!==generation)return;
  await showOutbox();renderSaveRecovery();
  shiftPanel=new ShiftHistoryPanel({client:api,store,canRead:context.can_manage_shift||context.can_report,run,isCurrent:()=>current===generation});
  historyPanel=new OrderHistoryPanel({client:api,store,canRead:context.can_sell||context.can_report,run,isCurrent:()=>current===generation,canRefund:()=>context.can_refund,onRefundSelected:prepareHistoryRefund});
  staffPanel=new StaffAccessPanel({client:api,store,canManage:context.can_manage_staff,run,isCurrent:()=>current===generation,message:status});
  reviewPanel=new OfflineReviewPanel({client:api,store,canReview:context.can_review_offline,run,isCurrent:()=>current===generation,onResolved:async receipt=>{
   const queue=outbox;
   const record=(await queue.list()).find(r=>r.operationId===receipt.operation_id);
   if(record)await queue.acceptResult(record,receipt);
   if(current!==generation)return;
   await showOutbox();status('Đã duyệt hủy sau đối soát, giữ nguyên lịch sử và chặn gửi lại bản ghi.');
  }});
 });
});

const financePending=new Map();
async function financial(name,args){
 const key=JSON.stringify({name,store:store.id,args});
 if(!financePending.has(key))financePending.set(key,crypto.randomUUID());
 const result=await rpc(name,{...args,p_operation_id:financePending.get(key)});
 financePending.delete(key);return result;
}
function clearRefundConfirmation(){el('refundConfirmed').checked=false;el('refundReason').value='';}
function refundChoices(){
 const selected=el('refundPayment').value;
 const candidates=[...payments];if(historyRefund&&!candidates.some(p=>p.id===historyRefund.payment.id))candidates.unshift({...historyRefund.payment,order_id:historyRefund.order.id});
 el('refundPayment').replaceChildren(option('','Chọn thanh toán'),...candidates.map(p=>option(p.id,`${p.order_id.slice(0,8)} · ${p.method==='CASH'?'Tiền mặt':'Chuyển khoản'} · ${money(p.amount)}`)));
 if(candidates.some(p=>p.id===selected))el('refundPayment').value=selected;
 if(el('refundPayment').value!==selected)clearRefundConfirmation();
 refundSummary();
}
function refundSummary(){
 const id=el('refundPayment').value,pay=payments.find(p=>p.id===id)||(historyRefund?.payment.id===id?{...historyRefund.payment,order_id:historyRefund.order.id}:null);
 const customer=historyRefund?.payment.id===id?historyRefund.order.customer?.name:null;
 el('refundTargetSummary').textContent=pay?'Đơn '+pay.order_id+' · Thanh toán '+pay.id+' · Hoàn toàn bộ '+money(pay.amount)+' · '+(pay.method==='CASH'?'Tiền mặt':'Chuyển khoản')+(customer?' · Khách: '+customer:''):'Chưa chọn thanh toán.';
}
el('refundPayment').addEventListener('change',()=>{clearRefundConfirmation();refundSummary();});
el('refundReason').addEventListener('input',()=>{el('refundConfirmed').checked=false;});
async function prepareHistoryRefund(data){
 const current=generation;
 const permissions=await rpc('rpc_store_context',{});if(current!==generation)return;
 context=permissions;renderFinance();if(!context.can_refund)throw new Error('PERMISSION_DENIED');
 await refreshFinance();if(current!==generation)return;if(!currentShift)throw new Error('OPEN_SHIFT_REQUIRED');
 if(!data.payment?.id||data.payment.amount==null||!Number.isSafeInteger(Number(data.payment.amount))||Number(data.payment.amount)<0||data.payment.method!=='CASH'&&data.payment.method!=='TRANSFER')throw new Error('INVALID_SERVER_ACK');
 historyRefund=data;clearRefundConfirmation();refundChoices();el('refundPayment').value=data.payment.id;refundSummary();el('refundArea').open=true;
 el('refundReason').focus();status('Đã chọn giao dịch từ lịch sử. Kiểm tra mã đơn, số tiền và phương thức; chỉ xác nhận sau khi đã hoàn đủ tiền cho khách.');
}
function renderFinance(){
 el('offlineCashForm').hidden=!currentShift||!context.can_collect;
 el('financeArea').hidden=limited||!(context.can_manage_shift||context.can_collect||context.can_void);
 el('openShiftForm').hidden=!context.can_manage_shift||!!currentShift;
 el('closeShiftForm').hidden=!context.can_manage_shift||!currentShift;
 el('shiftSummary').textContent=currentShift?`Ca ${currentShift.id.slice(0,8)} · Tiền đầu ca: ${money(currentShift.opening_amount)}`:'Bạn chưa có ca đang mở.';
 el('paymentForm').hidden=!context.can_collect||!currentShift||!editing||dirty;
 el('voidForm').hidden=!context.can_void||!editing||dirty;
 el('paymentOrderSummary').textContent=editing?`Đơn ${editing.id.slice(0,8)} · Cần thu ${money(editing.total_amount)}`:'Mở một đơn đã lưu để thu tiền.';
 el('refundArea').hidden=limited||!context.can_refund||!currentShift;
 el('reportArea').hidden=limited||!context.can_report;
}
async function refreshFinance(){
 const current=generation,oldShift=currentShift?.id;
 const [shifts,paid,refunds,ownOpen]=await Promise.all([rows('cash_shifts','*','&order=opened_at.desc&limit=100'),rows('payments','*','&order=created_at.desc&limit=100'),rows('refunds','payment_id'),rows('cash_shifts','*',`&opened_by=eq.${api.userId}&closed_at=is.null&limit=1`)]);
 if(current!==generation)return;
 currentShift=ownOpen.find(s=>s.opened_by===api.userId&&!s.closed_at)||null;
 payments=paid.filter(p=>!refunds.some(r=>r.payment_id===p.id));
 if(historyRefund){
  const selected=historyRefund;
  const latest=await rpc('rpc_order_receipt',{p_order_id:selected.order.id});if(current!==generation)return;
  if(latest.refund||latest.order?.order_status!=='PAID'||latest.payment?.id!==selected.payment.id){historyRefund=null;clearRefundConfirmation();}
  else historyRefund=latest;
 }
 if(oldShift!==currentShift?.id)clearRefundConfirmation();refundChoices();
 el('shiftHistory').replaceChildren(...shifts.slice(0,20).map(s=>{const li=document.createElement('li');li.textContent=s.closed_at?`Ca ${s.id.slice(0,8)} · Dự kiến ${money(s.expected_cash)} · Thực đếm ${money(s.counted_cash)} · Lệch ${money(s.difference)}`:`Ca ${s.id.slice(0,8)} · Đang mở`;return li;}));
 if(!el('reportDate').value)el('reportDate').value=new Date().toLocaleDateString('sv-SE',{timeZone:store.timezone||'Asia/Ho_Chi_Minh'});
 renderFinance();
}
el('paymentMethod').addEventListener('change',()=>{el('transferConfirmField').hidden=el('paymentMethod').value!=='TRANSFER';el('transferConfirmed').checked=false;});
el('openShiftForm').addEventListener('submit',e=>{e.preventDefault();run(async()=>{
 const current=generation;await financial('rpc_open_shift',{p_opening_amount:Number(el('openingCash').value)});if(current!==generation)return;
 await refreshFinance();status('Đã mở ca.');
});});
el('closeShiftForm').addEventListener('submit',e=>{e.preventDefault();if(!currentShift)return;run(async()=>{
 const queued=outbox?await outbox.list():[];
 if(queued.some(r=>isUnresolved(r)&&r.payload.p_received_amount!==null)){status('Còn đơn thu tiền tại máy chưa đồng bộ. Cần xử lý trước khi chốt ca.');return;}
 const current=generation;const closed=await financial('rpc_close_shift',{p_shift_id:currentShift.id,p_counted_cash:Number(el('countedCash').value)});if(current!==generation)return;
 await refreshFinance();el('closeShiftForm').reset();status(`Đã chốt ca · Dự kiến ${money(closed.expected_cash)} · Thực đếm ${money(closed.counted_cash)} · Chênh lệch ${money(closed.difference)}.`);
});});
el('paymentForm').addEventListener('submit',e=>{e.preventDefault();if(!editing||dirty||!currentShift)return;run(async()=>{
 const current=generation;const payment=await financial('rpc_collect_payment',{p_order_id:editing.id,p_shift_id:currentShift.id,p_expected_revision:editing.revision,p_method:el('paymentMethod').value,p_received_amount:Number(el('receivedAmount').value),p_transfer_confirmed:el('transferConfirmed').checked});if(current!==generation)return;
 reset();el('paymentForm').reset();el('transferConfirmField').hidden=true;await refresh();status(`Đã thu ${money(payment.amount)} · Tiền thừa ${money(payment.change_amount)} · Đơn đã hoàn tất.`);
});});
el('voidForm').addEventListener('submit',e=>{e.preventDefault();if(!editing||dirty)return;run(async()=>{
 const current=generation;await financial('rpc_void_order',{p_order_id:editing.id,p_expected_revision:editing.revision,p_reason:el('voidReason').value.trim()});if(current!==generation)return;
 reset();el('voidForm').reset();await refresh();status('Đã hủy đơn và ghi nhận lý do.');
});});
el('refundForm').addEventListener('submit',e=>{e.preventDefault();if(!currentShift||!el('refundConfirmed').checked)return;run(async()=>{
 const current=generation,paymentId=el('refundPayment').value,target=payments.find(p=>p.id===paymentId)||(historyRefund?.payment.id===paymentId?{order_id:historyRefund.order.id}:null);
 await financial('rpc_refund_payment',{p_payment_id:paymentId,p_shift_id:currentShift.id,p_reason:el('refundReason').value.trim()});if(current!==generation)return;
 historyRefund=null;el('refundForm').reset();await refresh();if(target?.order_id)await historyPanel?.receipt(target.order_id);status('Đã ghi nhận hoàn toàn bộ, giữ nguyên lịch sử thu tiền.');
});});
el('reportForm').addEventListener('submit',e=>{e.preventDefault();run(async()=>{
 const current=generation;const report=await rpc('rpc_daily_report',{p_date:el('reportDate').value});if(current!==generation)return;
 el('reportSummary').textContent=`${report.date} · ${report.timezone} · ${report.paid_orders} thanh toán · Đã thu ${money(report.gross)} · Hoàn ${money(report.refunds)} · Thu ròng ${money(Number(report.gross)-Number(report.refunds))}`;
});});

async function enqueueLocal(cash,operationId=null,finishSave=false){
 if((pending||saveRecovery)&&!operationId){status('Lần lưu online trước chưa rõ kết quả. Bấm Lưu đơn hàng để thử lại cùng yêu cầu trước khi ghi nhận tiền mặt hoặc tạo bản lưu tại máy.');return;}
 operationId??=crypto.randomUUID();
 if(!outbox||!api?.signedIn||!context.can_sell)throw new Error('AUTH_REQUIRED');
 if(editing){status('Chỉ hỗ trợ đơn mới trong hàng đợi offline.');return;}
 if(!cart.length){status('Thêm món trước khi lưu tại máy.');return;}
 const channel=el('channelChoice').value;
 const position=channel==='DINE_IN'?(el('positionChoice').value||null):null;
 if(channel==='DINE_IN'&&!position){status('Chọn bàn trước khi lưu.');return;}
 const customer={name:el('customerName').value.trim(),phone:el('customerPhone').value.trim(),address:el('customerAddress').value.trim()};
 if(channel==='DELIVERY'&&(customer.phone.length<8||customer.address.length<3)){status('Nhập điện thoại và địa chỉ giao hàng.');return;}
 const total=cart.reduce((sum,line)=>sum+line.quantity*line.unit,0);
 const received=cash?Number(el('offlineReceived').value):null;
 if(cash&&(!currentShift||!context.can_collect||!Number.isSafeInteger(received)||received<total)){status('Cần ca đang mở và nhận đủ tiền mặt.');return;}
 const queue=outbox,current=generation;
 await queue.enqueue({p_channel:channel,p_position_id:position,
  p_items:cart.map(({variant_id,modifier_ids,quantity})=>({variant_id,modifier_ids,quantity})),
  p_customer:customer,p_expected_total:total,p_shift_id:cash?currentShift.id:null,
  p_payment_operation_id:cash?crypto.randomUUID():null,p_received_amount:received},operationId,{lines:cart.map(({name,quantity,unit})=>({name,quantity,unit})),position:el('positionChoice').selectedOptions[0]?.textContent||''},{finishSave});
 if(current!==generation)return;
 reset();el('offlineCashForm').reset();await showOutbox();
 status(cash?'Đã lưu tại máy việc nhận tiền mặt. Chưa xác nhận trên server; cần đồng bộ trước khi chốt ca.':'Đã lưu đơn bền vững tại máy. Đơn đang chờ đồng bộ.');
}
async function showOutbox(){
 const queue=outbox;if(!queue)return;
 const records=await queue.list();if(queue!==outbox)return;
 const conflicts={OFFLINE_PRICE_CONFLICT:'Giá đã thay đổi. Cần đối soát số tiền trước khi thử lại.',OPEN_SHIFT_REQUIRED:'Ca thu tiền không còn mở. Cần đối soát với quản lý.',PERMISSION_DENIED:'Tài khoản không còn quyền đồng bộ đơn này.',VARIANT_UNAVAILABLE:'Size đã ngừng bán.',MODIFIER_UNAVAILABLE:'Topping đã ngừng bán.',POSITION_NOT_FOUND:'Bàn không còn khả dụng.','23505':'Bàn đã có đơn đang mở.',IDEMPOTENCY_KEY_REUSED:'Mã yêu cầu đã được dùng cho dữ liệu khác. Cần đối soát.'};
 const pending=records.filter(isUnresolved);
 el('outboxSummary').textContent=pending.length+' đơn chưa đồng bộ · '+pending.filter(r=>r.status==='CONFLICT').length+' xung đột';
 const visible=[...pending,...records.filter(r=>!isUnresolved(r)).slice(-20).reverse()];
 el('outboxList').replaceChildren(...visible.map(record=>{
  const li=document.createElement('li');
  const details=document.createElement('details'),summary=document.createElement('summary');
  summary.textContent=record.operationId.slice(0,8)+' · '+money(record.payload.p_expected_total)+' · '+
   (record.status==='CANCELLED'?'Đã hủy sau đối soát':record.status==='ACKNOWLEDGED'?'Đã đồng bộ':record.status==='CONFLICT'?'Cần xử lý: '+(conflicts[record.error]||'Server chưa chấp nhận dữ liệu. Kiểm tra đơn và quyền tài khoản.'):'Chờ đồng bộ')+
   (record.payload.p_received_amount!==null?' · Đã ghi nhận nhận tiền mặt tại máy':'');
  details.append(summary);
  const description=document.createElement('p'),payload=record.payload;
  const channel=payload.p_channel==='DINE_IN'?'Tại bàn':payload.p_channel==='DELIVERY'?'Giao hàng':'Mang về';
  description.textContent=new Date(record.createdAt).toLocaleString('vi-VN')+' · '+channel+
   (payload.p_position_id?' · '+(record.display?.position||payload.p_position_id):'')+
   (payload.p_customer?.name?' · Khách: '+payload.p_customer.name:'')+
   (payload.p_customer?.phone?' · '+payload.p_customer.phone:'')+
   (payload.p_customer?.address?' · '+payload.p_customer.address:'');
  details.append(description);
  for(const [index,line] of (record.display?.lines||payload.p_items||[]).entries()){
   const item=document.createElement('p');
   item.textContent=(line.name||'Món '+(index+1)+' ('+line.variant_id+')')+' × '+line.quantity+
    (Number.isFinite(line.unit)?' · '+money(line.unit*line.quantity):'');
   details.append(item);
  }
  if(payload.p_received_amount!==null){
   const cash=document.createElement('p');cash.textContent='Khách đưa '+money(payload.p_received_amount)+' · Tiền thừa theo đơn tại máy '+money(payload.p_received_amount-payload.p_expected_total);details.append(cash);
  }
  if(record.result?.order_id){const receipt=document.createElement('p');receipt.textContent='Mã đơn server: '+record.result.order_id;details.append(receipt);}
  if(record.status==='CANCELLED'){
   const resolution=document.createElement('p');resolution.textContent='Lý do duyệt hủy: '+record.result.reason+
    (record.payload.p_received_amount!==null?' · Đã xác nhận hoàn '+money(record.result.cash_refund_amount)+' cho khách.':'');details.append(resolution);
  }else if(record.reviewId){const notice=document.createElement('p');notice.textContent='Đã khóa gửi lại đơn và chuyển quản lý duyệt hủy. Bấm Đồng bộ hàng đợi để nhận kết quả.';details.append(notice);
  }else if(record.status==='CONFLICT'&&context.can_sell){
   const form=document.createElement('form'),label=document.createElement('label'),note=document.createElement('input');
   label.textContent='Lý do đề nghị hủy bản ghi chưa lên server';note.required=true;note.minLength=3;note.maxLength=500;label.append(note);
   const button=document.createElement('button');button.type='submit';button.className='secondary';button.textContent='Gửi đề nghị hủy và khóa đồng bộ';const warning=document.createElement('p');warning.textContent='Chỉ gửi khi muốn hủy đơn. Chờ xác nhận đã khóa gửi lại trên server trước khi hoàn tiền cho khách.';form.append(warning,label,button);
   form.addEventListener('submit',event=>{event.preventDefault();run(async()=>{
    if(!form.reportValidity())return;
    const client=api,target=store,current=generation;
    await submitOfflineReview(client,target,queue,record,note.value.trim());
    if(current!==generation)return;
    await showOutbox();status('Đã gửi đề nghị hủy và khóa mã yêu cầu trên server. Giữ bản ghi gốc để nhận kết quả quản lý.');
   });});details.append(form);
  }
  li.append(details);return li;
 }));
 el('offlineCashForm').hidden=!currentShift||!context.can_collect;
}
async function syncLocal(retryConflicts=false){
 const queue=outbox,client=api,target=store,actor=api?.userId,current=generation;
 if(!queue)return;
 await receiveOfflineReviews(client,target,queue);
 await queue.flush(async(payload,id)=>{
  if(client.userId!==actor||!client.signedIn)throw new Error('AUTH_REQUIRED');
  return client.request('/rest/v1/rpc/rpc_sync_offline_sale',{method:'POST',body:{...payload,p_org_id:target.organization_id,p_store_id:target.id,p_operation_id:id}});
 },{retryConflicts});
 if(current!==generation)return;
 await showOutbox();
 const remaining=(await queue.list()).filter(isUnresolved);
 await refresh();
 if(!remaining.length){status('Đã đồng bộ toàn bộ hàng đợi.');}
 else status('Hàng đợi vẫn giữ trên máy. Xung đột giá, bàn, ca hoặc quyền cần được kiểm tra; không tự đổi dữ liệu đã ghi nhận.');
}
el('queueOrder').addEventListener('click',()=>run(()=>enqueueLocal(false)));
el('offlineCashForm').addEventListener('submit',e=>{e.preventDefault();run(()=>enqueueLocal(true));});
el('syncOutbox').addEventListener('click',()=>run(()=>syncLocal()));
el('retryOutbox').addEventListener('click',()=>run(()=>syncLocal(true)));
window.addEventListener('online',async()=>{const current=generation;await activeRun?.finished;if(current===generation&&api?.signedIn&&outbox)run(()=>syncLocal());});
