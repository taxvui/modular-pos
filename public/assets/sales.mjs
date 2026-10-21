import { StaffAccessPanel } from './staff-access.mjs';
import { OfflineStore, isUnresolved } from './offline-store.mjs';
import { submitOfflineReview, receiveOfflineReviews, OfflineReviewPanel } from './offline-review.mjs';
const el=id=>document.getElementById(id);
const money=value=>`${Number(value).toLocaleString('vi-VN')} ₫`;
let api,store,context={},products=[],variants=[],modifiers=[],orders=[],cart=[],editing=null,pending=null,generation=0,dirty=false,currentShift=null,payments=[];
let outbox=null,limited=false,reviewPanel=null,staffPanel=null;
const connectionFailure=error=>error instanceof TypeError||error.status>=500||error.status===429;
const status=text=>{el('salesStatus').textContent=text;};
const rpc=(name,args)=>api.request(`/rest/v1/rpc/${name}`,{method:'POST',body:{p_org_id:store.organization_id,p_store_id:store.id,...args}});
const rows=(table,select='*',extra='')=>api.request(`/rest/v1/${table}?select=${select}&store_id=eq.${store.id}${extra}`);
function option(value,label){const o=document.createElement('option');o.value=value;o.textContent=label;return o;}
function reset(){dirty=false;cart=[];editing=null;pending=null;el('customerName').value='';el('customerPhone').value='';el('customerAddress').value='';renderCart();}
async function run(action){
 document.querySelectorAll('#salesPanel button').forEach(b=>{b.disabled=true;});
 el('stores').disabled=true;
 try{await action();}catch(error){
  const code=error.message;
  const messages={STAFF_HAS_OPEN_WORK:'Nhân viên còn ca đang mở hoặc đề nghị hủy offline chưa xử lý. Cần chốt/đối soát trước khi ngừng quyền.',SELF_ACCESS_PROTECTED:'Không thể tự thay quyền của phiên đang quản trị.',OWNER_ACCESS_PROTECTED:'Quyền chủ sở hữu được bảo vệ.',STAFF_ACCESS_MANAGED_ELSEWHERE:'Tài khoản có quyền tổ chức hoặc tùy chỉnh, không thay bằng vai trò cửa hàng tại đây.',INVITATION_ALREADY_OPEN:'Email đang có mã chờ tại cửa hàng này. Thu hồi mã cũ nếu muốn tạo lại.',STAFF_ALREADY_ACTIVE:'Nhân viên đã có quyền. Hãy đổi vai trò trong danh sách nhân viên.',INVITATION_ALREADY_USED:'Mã đã được tiếp nhận. Hãy quản lý quyền của nhân viên trong danh sách.',INVITATION_INVALID:'Mã không còn hợp lệ.',INVALID_STAFF_ROLE:'Vai trò chưa được hỗ trợ.',STAFF_NOT_FOUND:'Không tìm thấy nhân viên ở cửa hàng này.',STAFF_ROLE_CONFIGURATION_INVALID:'Vai trò hệ thống đã bị thay đổi. Cần kiểm tra cấu hình quyền trước khi cấp tiếp.',MEMBERSHIP_INACTIVE:'Thành viên tổ chức đang bị ngừng quyền.',ACCOUNT_DISABLED:'Hồ sơ tài khoản đang bị ngừng.',OFFLINE_REVIEW_REQUIRED:'Đơn đang được đề nghị hủy. Đã khóa gửi lại trong lúc quản lý đối soát.',CASH_REFUND_CONFIRMATION_REQUIRED:'Cần xác nhận đã hoàn đúng tiền cho khách trước khi duyệt hủy.',REVIEW_ALREADY_RESOLVED:'Đề nghị đã được xử lý. Hãy tải lại danh sách.',OFFLINE_SALE_ALREADY_COMMITTED:'Đơn đã lên server. Không thể hủy bản ghi offline; hãy kiểm tra đơn và dùng luồng hủy/hoàn tiền.',ONLINE_ORDER_EXISTS:'Server đã có đơn từ yêu cầu này. Hãy kiểm tra đơn trước khi xử lý; không tạo lại đơn mới.',REVIEW_NOT_FOUND:'Không tìm thấy đề nghị được cấp quyền.',OPEN_SHIFT_REQUIRED:'Bạn cần mở ca trước khi thu hoặc hoàn tiền.',INSUFFICIENT_PAYMENT:'Số tiền nhận chưa đủ hoặc vượt giới hạn cho phép.',TRANSFER_CONFIRMATION_REQUIRED:'Cần nhận đúng số tiền và xác nhận đã kiểm tra chuyển khoản.',CASH_INSUFFICIENT:'Tiền mặt dự kiến trong ca không đủ để hoàn đơn này.',SHIFT_CLOSED:'Ca đã đóng. Hãy tải lại dữ liệu.',REASON_REQUIRED:'Nhập lý do từ 3 đến 500 ký tự.',ORDER_FINALIZED:'Đơn đã hoàn tất. Không thể thu tiền hoặc sửa lần nữa.',VERSION_CONFLICT:'Đơn đã được máy khác cập nhật. Mở lại đơn để xem dữ liệu mới.',PERMISSION_DENIED:'Bạn chưa được cấp quyền thực hiện thao tác này.',IDEMPOTENCY_KEY_REUSED:'Yêu cầu đã thay đổi. Hãy tải lại danh sách đơn.', '23505':'Tên bàn bị trùng hoặc bàn đã có đơn đang mở.',VARIANT_UNAVAILABLE:'Một size đã ngừng bán. Hãy kiểm tra thực đơn.',DELIVERY_DETAILS_REQUIRED:'Đơn giao hàng cần số điện thoại và địa chỉ.'};
  status(messages[code]||'Chưa xác nhận được thao tác. Kiểm tra kết nối rồi thử lại cùng yêu cầu.');
 }finally{document.querySelectorAll('#salesPanel button').forEach(b=>{b.disabled=false;});el('saveOrder').disabled=!context.can_sell;el('stores').disabled=el('stores').options.length===0;}
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
el('newOrder').addEventListener('click',()=>{reset();status('Đã mở giỏ hàng mới.');});
el('reloadOrders').addEventListener('click',()=>run(async()=>{const online=await refresh();status(online?'Đã tải dữ liệu mới nhất.':'Chưa kết nối được server. Đang dùng menu lưu tại máy để tạo đơn mới.');}));
el('orderForm').addEventListener('submit',e=>{
 e.preventDefault();if(!context.can_sell)return;
 run(async()=>{
  const current=generation;
  if(!cart.length){status('Thêm ít nhất một món trước khi lưu.');return;}
  const payload={p_channel:el('channelChoice').value,p_position_id:el('channelChoice').value==='DINE_IN'?(el('positionChoice').value||null):null,p_items:cart.map(({variant_id,modifier_ids,quantity})=>({variant_id,modifier_ids,quantity})),p_customer:{name:el('customerName').value.trim(),phone:el('customerPhone').value.trim(),address:el('customerAddress').value.trim()},p_order_id:editing?.id||null,p_expected_revision:editing?.revision||null};
  const fingerprint=JSON.stringify(payload);
  if(!pending||pending.fingerprint!==fingerprint)pending={id:crypto.randomUUID(),fingerprint};
  let result;
  try {
    if (!navigator.onLine) throw new TypeError('NETWORK_ERROR');
    result=await rpc('rpc_save_order',{...payload,p_operation_id:pending.id});
  } catch(error) {
    if (!(error instanceof TypeError)) throw error;
    if (editing) { status('Mất mạng: chưa hỗ trợ sửa đơn server khi offline. Giỏ vẫn được giữ.'); return; }
    await enqueueLocal(false,pending.id); return;
  }
  if(current!==generation)return;
  if(result.status==='REVIEW_REQUIRED'){status('Đơn đang được đề nghị hủy. Không tạo lại yêu cầu trong lúc quản lý đối soát.');return;}
  if(result.status==='CANCELLED'){reset();await refresh();status('Yêu cầu này đã được quản lý duyệt hủy sau đối soát. Không tạo thêm đơn.');return;}
  pending=null;reset();await refresh();const order=orders.find(o=>o.id===result.order_id);if(order)await openOrder(order);
  status(`Đã lưu đơn ${result.order_id.slice(0,8)} · Tổng tiền server: ${money(result.total_amount)}. Có thể thu tiền sau khi mở ca.`);
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
 staffPanel?.destroy();staffPanel=null;
 el('salesPanel').hidden=true;context={};limited=false;currentShift=null;payments=[];financePending.clear();reset();
 outbox=null;reviewPanel=null;el('offlineReviewArea').hidden=true;el('offlineReviewList').replaceChildren();
 if(!detail?.store)return;
 api=detail.client;store=detail.store;
 outbox=new OfflineStore({url:api.url,userId:api.userId,organizationId:store.organization_id,storeId:store.id});
 await run(async()=>{
  const result=await rpc('rpc_store_context',{});if(current!==generation)return;
  context=result;el('catalogAdmin').hidden=!context.can_manage_catalog;el('sellingArea').hidden=!context.can_sell;
  await refresh();if(current!==generation)return;
  el('salesPanel').hidden=false;status('Đã tải dữ liệu cửa hàng. Có thể lưu đơn mới vào hàng đợi tại máy khi mất mạng.');
  await showOutbox();
  try{await receiveOfflineReviews(api,store,outbox);}catch(error){
   if(!connectionFailure(error))throw error;
   if(current===generation)status('Chưa nhận được kết quả đối soát từ server. Hàng đợi tại máy vẫn được giữ và hiển thị.');
  }
  if(current!==generation)return;
  await showOutbox();
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
 const current=generation;
 const [shifts,paid,refunds,ownOpen]=await Promise.all([rows('cash_shifts','*','&order=opened_at.desc&limit=100'),rows('payments','*','&order=created_at.desc&limit=100'),rows('refunds','payment_id'),rows('cash_shifts','*',`&opened_by=eq.${api.userId}&closed_at=is.null&limit=1`)]);
 if(current!==generation)return;
 currentShift=ownOpen.find(s=>s.opened_by===api.userId&&!s.closed_at)||null;
 payments=paid.filter(p=>!refunds.some(r=>r.payment_id===p.id));
 el('refundPayment').replaceChildren(option('','Chọn thanh toán'),...payments.map(p=>option(p.id,`${p.order_id.slice(0,8)} · ${p.method==='CASH'?'Tiền mặt':'Chuyển khoản'} · ${money(p.amount)}`)));
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
 const current=generation;await financial('rpc_refund_payment',{p_payment_id:el('refundPayment').value,p_shift_id:currentShift.id,p_reason:el('refundReason').value.trim()});if(current!==generation)return;
 el('refundForm').reset();await refresh();status('Đã ghi nhận hoàn toàn bộ, giữ nguyên lịch sử thu tiền.');
});});
el('reportForm').addEventListener('submit',e=>{e.preventDefault();run(async()=>{
 const current=generation;const report=await rpc('rpc_daily_report',{p_date:el('reportDate').value});if(current!==generation)return;
 el('reportSummary').textContent=`${report.date} · ${report.timezone} · ${report.paid_orders} thanh toán · Đã thu ${money(report.gross)} · Hoàn ${money(report.refunds)} · Thu ròng ${money(Number(report.gross)-Number(report.refunds))}`;
});});

async function enqueueLocal(cash,operationId=null){
 if(pending&&!operationId){status('Lần lưu online trước chưa rõ kết quả. Bấm Lưu đơn hàng để thử lại cùng yêu cầu trước khi ghi nhận tiền mặt hoặc tạo bản lưu tại máy.');return;}
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
  p_payment_operation_id:cash?crypto.randomUUID():null,p_received_amount:received},operationId,{lines:cart.map(({name,quantity,unit})=>({name,quantity,unit})),position:el('positionChoice').selectedOptions[0]?.textContent||''});
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
window.addEventListener('online',()=>{if(api?.signedIn&&outbox)run(()=>syncLocal());});
