const el=id=>document.getElementById(id);
const money=n=>Number(n||0).toLocaleString('vi-VN')+' ₫';
const stateName={OPEN:'Đang mở',PAID:'Đã thanh toán',VOID:'Đã hủy',REFUNDED:'Đã hoàn tiền'};
const channelName={TAKEAWAY:'Mang về',DINE_IN:'Tại bàn',DELIVERY:'Giao hàng'};
const paragraph=text=>{const p=document.createElement('p');p.textContent=text;return p;};
export class OrderHistoryPanel {
 constructor({client,store,canRead,run,isCurrent}){
  Object.assign(this,{client,store,run,isCurrent,pages:[null],index:0,key:null,sequence:0});
  el('orderHistoryArea').hidden=!canRead;if(!canRead)return;
  el('orderHistoryForm').onsubmit=e=>{e.preventDefault();run(()=>this.load());};
  el('previousHistory').onclick=()=>run(()=>this.load(this.pages[this.index-1],this.index-1));
  el('nextHistory').onclick=()=>run(()=>this.load(this.pages[this.index+1],this.index+1));
 }
 destroy(){this.sequence++;el('orderHistoryArea').hidden=true;el('orderHistoryForm').onsubmit=null;el('orderHistoryForm').reset();
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
  el('historyReceipt').replaceChildren();
  el('historyOrders').replaceChildren(...result.orders.map(row=>{
   const li=document.createElement('li');li.append(paragraph(row.id+' · '+stateName[row.order_status]+(row.refund_id?' · Đã hoàn tiền':'')+' · '+money(row.total_amount)),
    paragraph(this.date(row.created_at,result.timezone)+' · '+channelName[row.channel]+(row.customer?.name?' · '+row.customer.name:'')));
   const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Xem chi tiết';button.onclick=()=>this.run(()=>this.receipt(row.id));li.append(button);return li;
  }));
  if(!result.orders.length)el('historyOrders').append(paragraph('Không có đơn phù hợp trong khoảng ngày đã chọn.'));
 }
 async receipt(id){
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
  el('historyReceipt').replaceChildren(...nodes);
 }
}
