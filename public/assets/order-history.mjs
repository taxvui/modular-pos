const el=id=>document.getElementById(id);
const money=n=>Number(n||0).toLocaleString('vi-VN')+' ₫';
const stateName={OPEN:'Đang mở',PAID:'Đã thanh toán',VOID:'Đã hủy',REFUNDED:'Đã hoàn tiền'};
const channelName={TAKEAWAY:'Mang về',DINE_IN:'Tại bàn',DELIVERY:'Giao hàng'};
const paragraph=text=>{const p=document.createElement('p');p.textContent=text;return p;};
export class OrderHistoryPanel {
 constructor({client,store,canRead,run,isCurrent,canRefund=()=>false,onRefundSelected=()=>{},canOpen=()=>false,onOpenOrder=()=>{}}){
  Object.assign(this,{client,store,run,isCurrent,canRefund,onRefundSelected,canOpen,onOpenOrder,pages:[null],index:0,key:null,sequence:0});
  el('orderHistoryArea').hidden=!canRead;if(!canRead)return;
  el('orderHistoryForm').onsubmit=e=>{e.preventDefault();run(()=>this.load());};
  el('previousHistory').onclick=()=>run(()=>this.load(this.pages[this.index-1],this.index-1));
  el('nextHistory').onclick=()=>run(()=>this.load(this.pages[this.index+1],this.index+1));
 }
 destroy(){this.sequence++;this.timelineView=null;el('orderHistoryArea').hidden=true;el('orderHistoryForm').onsubmit=null;el('orderHistoryForm').reset();
  for(const id of ['previousHistory','nextHistory']){el(id).onclick=null;el(id).hidden=true;}
  for(const id of ['historyOrders','historyReceipt','historyStatus'])el(id).replaceChildren();
 }
 rpc(name,args){return this.client.request('/rest/v1/rpc/'+name,{method:'POST',body:{p_org_id:this.store.organization_id,p_store_id:this.store.id,...args}});}
 date(value,zone=this.store.timezone||'Asia/Ho_Chi_Minh'){return new Date(value).toLocaleString('vi-VN',{timeZone:zone});}
 async load(cursor=null,index=0){
  if(!this.isCurrent()||!el('orderHistoryForm').reportValidity())return;
  const sequence=++this.sequence;
  const args={p_from:el('historyFrom').value||null,p_to:el('historyTo').value||null,p_status:el('historyFilter').value,p_search:el('historySearch').value.trim()};
  let key=JSON.stringify(args);if(key!==this.key){cursor=null;index=0;}
  const result=await this.rpc('rpc_order_history',{...args,p_before_time:cursor?.time||null,p_before_id:cursor?.id||null});
  if(!this.isCurrent()||sequence!==this.sequence)return;
  if(!Array.isArray(result.orders)||result.orders.length>50)throw new Error('INVALID_HISTORY_RESPONSE');
  el('historyFrom').value=result.from_date;el('historyTo').value=result.to_date;
  key=JSON.stringify({...args,p_from:result.from_date,p_to:result.to_date});this.key=key;this.index=index;
  if(index===0)this.pages=[null];this.pages.length=index+1;if(result.next_cursor)this.pages.push(result.next_cursor);
  el('previousHistory').hidden=index===0;el('nextHistory').hidden=!result.next_cursor;
  el('historyStatus').textContent='Trang '+(index+1)+' · '+result.orders.length+' đơn · Theo ngày tạo đơn, múi giờ '+result.timezone;
  this.timelineView=null;el('historyReceipt').replaceChildren();
  el('historyOrders').replaceChildren(...result.orders.map(row=>{
   const li=document.createElement('li');li.append(paragraph(row.id+' · '+stateName[row.order_status]+(row.refund_id?' · Đã hoàn tiền':'')+' · '+money(row.total_amount)),
    paragraph(this.date(row.created_at,result.timezone)+' · '+channelName[row.channel]+(row.customer?.name?' · '+row.customer.name:'')));
   const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Xem chi tiết';button.onclick=()=>this.run(()=>this.receipt(row.id));li.append(button);return li;
  }));
  if(!result.orders.length)el('historyOrders').append(paragraph('Không có đơn phù hợp trong khoảng ngày đã chọn.'));
 }
 async receipt(id,{selectRefund=false}={}){
  if(!this.isCurrent())return;const sequence=++this.sequence;
  const data=await this.rpc('rpc_order_receipt',{p_order_id:id});
  if(!this.isCurrent()||sequence!==this.sequence)return;
  if(data.order?.id!==id||!Array.isArray(data.items))throw new Error('INVALID_HISTORY_RESPONSE');
  const order=data.order,nodes=[paragraph('Mã đơn: '+order.id),paragraph(stateName[order.order_status]+' · '+channelName[order.channel]+(data.position_name?' · '+data.position_name:'')),paragraph('Tạo lúc '+this.date(order.created_at,data.timezone))];
  if(order.customer?.name||order.customer?.phone||order.customer?.address)nodes.push(paragraph('Khách: '+[order.customer.name,order.customer.phone,order.customer.address].filter(Boolean).join(' · ')));
  for(const item of data.items){const options=(item.modifier_snapshot||[]).map(m=>m.name).join(', ');nodes.push(paragraph(item.product_name+' / '+item.variant_name+(options?' + '+options:'')+' × '+item.quantity+' · '+money(item.unit_amount)+' / món · '+money(item.line_amount)));}
  nodes.push(paragraph('Tổng đơn: '+money(order.total_amount)));
  const pay=data.payment,refund=data.refund;
  if(pay){nodes.push(paragraph('Thanh toán '+pay.id+' · '+(pay.method==='CASH'?'Tiền mặt':'Chuyển khoản')+' · '+this.date(pay.created_at,data.timezone)),paragraph('Đã thu '+money(pay.amount)+' · Khách đưa '+money(pay.received_amount)+' · Tiền thừa '+money(pay.change_amount)));}
  else nodes.push(paragraph('Chưa ghi nhận thanh toán trên server.'));
  if(refund)nodes.push(paragraph('Đã hoàn '+money(refund.amount)+' · '+this.date(refund.created_at,data.timezone)+' · Lý do: '+refund.reason));
  if(data.void_reason)nodes.push(paragraph('Lý do hủy: '+data.void_reason));
  if(pay)nodes.push(paragraph('Thu ròng của đơn: '+money(Number(pay.amount)-Number(refund?.amount||0))));
  if(order.order_status==='OPEN'&&this.canOpen()){
   const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Mở đơn để sửa hoặc thu tiền';button.dataset.action='open-history-order';
   button.onclick=()=>this.run(async()=>{if(!this.isCurrent()||!this.canOpen())return;await this.onOpenOrder(order.id);});nodes.push(button);
  }
  const eligible=pay&&!refund&&order.order_status==='PAID';
  if(eligible&&this.canRefund()){
   const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Chọn giao dịch này để hoàn tiền';button.dataset.action='prepare-refund';
   button.onclick=()=>this.run(()=>this.receipt(id,{selectRefund:true}));nodes.push(button);
  }
  nodes.push(this.createTimeline(id,sequence));
  el('historyReceipt').replaceChildren(...nodes);
  if(selectRefund){
   if(!this.canRefund())throw new Error('PERMISSION_DENIED');
   if(!eligible)throw new Error(refund||order.order_status==='REFUNDED'?'PAYMENT_ALREADY_REFUNDED':'PAYMENT_NOT_REFUNDABLE');
   await this.onRefundSelected(data);
  }
 }
 createTimeline(id,sequence){
  const area=document.createElement('details'),title=document.createElement('summary');title.textContent='Nhật ký thao tác của đơn';
  const list=document.createElement('ul'),status=paragraph('Chưa tải nhật ký.'),button=text=>{const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=text;return b;};
  list.className='order-events';status.setAttribute('role','status');status.dataset.role='order-events-status';list.dataset.role='order-events-list';
  const reload=button('Tải nhật ký mới nhất'),prev=button('Nhật ký trước'),next=button('Nhật ký tiếp');
  reload.dataset.action='load-order-events';prev.dataset.action='previous-order-events';next.dataset.action='next-order-events';prev.hidden=true;next.hidden=true;
  const view={id,sequence,list,status,prev,next,pages:[null],index:0};this.timelineView=view;
  reload.onclick=()=>this.run(()=>this.loadTimeline(view));
  prev.onclick=()=>this.run(()=>this.loadTimeline(view,view.pages[view.index-1],view.index-1));
  next.onclick=()=>this.run(()=>this.loadTimeline(view,view.pages[view.index+1],view.index+1));
  area.append(title,paragraph('Mới nhất trước, 50 thao tác mỗi trang. Tên người và bàn là tên hiện tại; mã định danh được giữ để đối chiếu.'),reload,status,list,prev,next);return area;
 }
 async loadTimeline(view,cursor=null,index=0){
  if(!this.isCurrent()||this.timelineView!==view||this.sequence!==view.sequence)return;
  const data=await this.rpc('rpc_order_events',{p_order_id:view.id,p_before_time:cursor?.time||null,p_before_id:cursor?.id||null});
  if(!this.isCurrent()||this.timelineView!==view||this.sequence!==view.sequence)return;
  if(data.order_id!==view.id||!Array.isArray(data.events)||data.events.length>50)throw new Error('INVALID_EVENT_RESPONSE');
  if(index===0)view.pages=[null];view.index=index;view.pages.length=index+1;if(data.next_cursor)view.pages.push(data.next_cursor);
  view.prev.hidden=index===0;view.next.hidden=!data.next_cursor;
  view.status.textContent='Nhật ký · Trang '+(index+1)+' · '+data.events.length+' thao tác · Đọc lúc '+this.date(data.read_at,data.timezone);
  const names={'pos.order.saved':'Lưu đơn','pos.order.transferred':'Chuyển bàn','pos.payment.collected':'Thu tiền','pos.order.voided':'Hủy đơn','pos.payment.refunded':'Hoàn tiền'};
  view.list.replaceChildren(...data.events.map(event=>{
   const li=document.createElement('li'),d=event.details||{};
   li.append(paragraph((event.action==='pos.order.saved'&&Number(d.revision)===1?'Tạo đơn':names[event.action]||'Thao tác')+' · '+this.date(event.created_at,data.timezone)),paragraph(event.full_name+' · Người thực hiện: '+(event.actor_id||'Hệ thống')+' · Mã nhật ký: '+event.id));
   if(d.revision!=null)li.append(paragraph('Phiên bản '+d.revision+(d.total_amount!=null?' · Tổng đơn '+money(d.total_amount):'')));
   if(event.action==='pos.order.transferred')li.append(paragraph('Từ bàn '+(d.from_position_name||'')+' ('+d.from_position_id+') → '+(d.to_position_name||'')+' ('+d.to_position_id+')'));
   if(d.amount!=null)li.append(paragraph((d.method==='CASH'?'Tiền mặt':'Chuyển khoản')+' · '+money(d.amount)));
   if(d.received_amount!=null)li.append(paragraph('Khách đưa '+money(d.received_amount)+' · Tiền thừa '+money(d.change_amount)));
   if(d.payment_id)li.append(paragraph('Thanh toán '+d.payment_id+(d.refund_id?' · Khoản hoàn '+d.refund_id:'')));
   if(d.shift_id)li.append(paragraph('Ca thực hiện '+d.shift_id));
   if(event.reason)li.append(paragraph('Lý do: '+event.reason));return li;
  }));
  if(!data.events.length)view.list.append(paragraph('Chưa có thao tác phù hợp đã ghi trên server.'));
 }

}
