const el=id=>document.getElementById(id);
const money=n=>Number(n||0).toLocaleString('vi-VN')+' ₫';
const p=text=>{const node=document.createElement('p');node.textContent=text;return node;};
export class ShiftHistoryPanel {
 constructor({client,store,canRead,run,isCurrent}){
  Object.assign(this,{client,store,run,isCurrent,sequence:0,index:0,pages:[null],key:null,selected:null,eventIndex:0,eventPages:[null]});
  el('shiftHistoryArea').hidden=!canRead;if(!canRead)return;
  el('shiftHistoryForm').onsubmit=e=>{e.preventDefault();run(()=>this.load());};
  el('previousShiftPage').onclick=()=>run(()=>this.load(this.pages[this.index-1],this.index-1));
  el('nextShiftPage').onclick=()=>run(()=>this.load(this.pages[this.index+1],this.index+1));
  el('reloadShiftDetail').onclick=()=>run(()=>this.detail(this.selected));
  el('previousShiftEvent').onclick=()=>run(()=>this.events(this.eventPages[this.eventIndex-1],this.eventIndex-1));
  el('nextShiftEvent').onclick=()=>run(()=>this.events(this.eventPages[this.eventIndex+1],this.eventIndex+1));
 }
 destroy(){this.sequence++;this.selected=null;el('shiftHistoryArea').hidden=true;el('shiftHistoryForm').onsubmit=null;el('shiftHistoryForm').reset();
  for(const id of ['previousShiftPage','nextShiftPage','reloadShiftDetail','previousShiftEvent','nextShiftEvent']){el(id).onclick=null;el(id).hidden=true;}
  for(const id of ['shiftHistoryStatus','shiftHistoryList','shiftDetailSummary','shiftEventList','shiftEventStatus'])el(id).replaceChildren();
 }
 rpc(name,args){return this.client.request('/rest/v1/rpc/'+name,{method:'POST',body:{p_org_id:this.store.organization_id,p_store_id:this.store.id,...args}});}
 date(value){return value?new Date(value).toLocaleString('vi-VN',{timeZone:this.zone||this.store.timezone||'Asia/Ho_Chi_Minh'}):'Chưa chốt';}
 clearDetail(){this.selected=null;for(const id of ['shiftDetailSummary','shiftEventList','shiftEventStatus'])el(id).replaceChildren();for(const id of ['reloadShiftDetail','previousShiftEvent','nextShiftEvent'])el(id).hidden=true;}
 async load(cursor=null,index=0){
  if(!this.isCurrent()||!el('shiftHistoryForm').reportValidity())return;const sequence=++this.sequence;
  const args={p_from:el('shiftHistoryFrom').value||null,p_to:el('shiftHistoryTo').value||null,p_status:el('shiftHistoryFilter').value};
  if(JSON.stringify(args)!==this.key){cursor=null;index=0;}
  const data=await this.rpc('rpc_shift_history',{...args,p_before_time:cursor?.time||null,p_before_id:cursor?.id||null});
  if(!this.isCurrent()||sequence!==this.sequence)return;if(!Array.isArray(data.shifts)||data.shifts.length>50)throw new Error('INVALID_SHIFT_RESPONSE');
  this.zone=data.timezone;el('shiftHistoryFrom').value=data.from_date;el('shiftHistoryTo').value=data.to_date;
  this.key=JSON.stringify({...args,p_from:data.from_date,p_to:data.to_date});this.index=index;if(index===0)this.pages=[null];this.pages.length=index+1;if(data.next_cursor)this.pages.push(data.next_cursor);
  el('previousShiftPage').hidden=index===0;el('nextShiftPage').hidden=!data.next_cursor;this.clearDetail();
  el('shiftHistoryStatus').textContent=(data.scope==='OWN'?'Chỉ ca của tôi':'Toàn cửa hàng')+' · Trang '+(index+1)+' · '+data.shifts.length+' ca · Theo ngày mở ca, '+data.timezone;
  el('shiftHistoryList').replaceChildren(...data.shifts.map(row=>{
   const li=document.createElement('li');li.append(p(row.id+' · '+row.full_name+' · '+(row.closed_at?'Đã chốt':'Đang mở')),p(this.date(row.opened_at)+' · Đầu ca '+money(row.opening_amount)));
   if(row.closed_at)li.append(p('Dự kiến '+money(row.expected_cash)+' · Thực đếm '+money(row.counted_cash)+' · Lệch '+money(row.difference)));
   const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Xem đối soát ca';button.onclick=()=>this.run(()=>this.detail(row.id));li.append(button);return li;
  }));
  if(!data.shifts.length)el('shiftHistoryList').append(p('Không có ca phù hợp trong khoảng ngày đã chọn.'));
 }
 async detail(id){
  if(!this.isCurrent()||!id)return;const sequence=++this.sequence;
  const [data,ledger]=await Promise.all([this.rpc('rpc_shift_summary',{p_shift_id:id}),this.rpc('rpc_shift_transactions',{p_shift_id:id,p_before_time:null,p_before_kind:null,p_before_id:null})]);
  if(!this.isCurrent()||sequence!==this.sequence)return;
  if(data.shift?.id!==id||ledger.shift_id!==id||!data.totals||!Array.isArray(ledger.transactions))throw new Error('INVALID_SHIFT_RESPONSE');
  this.selected=id;this.zone=data.timezone;const s=data.shift,t=data.totals;
  const nodes=[p('Ca '+s.id+' · '+data.full_name),p('Mở '+this.date(s.opened_at)+' · '+(s.closed_at?'Chốt '+this.date(s.closed_at):'Đang mở')),p('Tiền mặt đầu ca: '+money(s.opening_amount)),
   p('Thu tiền mặt: '+money(t.cash_sales)+' · Hoàn tiền mặt: '+money(t.cash_refunds)),p('Khách đưa tiền mặt: '+money(t.cash_received)+' · Tiền thừa: '+money(t.change_given)),
   p('Thu chuyển khoản: '+money(t.transfer_sales)+' · Hoàn chuyển khoản: '+money(t.transfer_refunds)),p('Tiền mặt dự kiến: '+money(t.expected_cash)),
   p('Thu ròng của ca: '+money(t.net_collections)+' · '+t.payment_count+' thanh toán · '+t.refund_count+' khoản hoàn')];
  if(s.closed_at)nodes.push(p('Số chốt đã lưu: dự kiến '+money(s.expected_cash)+' · Thực đếm '+money(s.counted_cash)+' · Lệch '+money(s.difference)));
  else nodes.push(p('Ca chưa chốt; số liệu có thể thay đổi.'));
  nodes.push(p('Số liệu đọc lúc '+this.date(data.read_at)+'. Chỉ gồm giao dịch đã lên server; hoàn tính vào ca thực hiện hoàn.'));
  el('shiftDetailSummary').replaceChildren(...nodes);el('reloadShiftDetail').hidden=false;this.eventPages=[null];this.renderEvents(ledger,0);
 }
 async events(cursor=null,index=0){
  if(!this.isCurrent()||!this.selected)return;const sequence=++this.sequence,id=this.selected;
  const data=await this.rpc('rpc_shift_transactions',{p_shift_id:id,p_before_time:cursor?.time||null,p_before_kind:cursor?.kind||null,p_before_id:cursor?.id||null});
  if(!this.isCurrent()||sequence!==this.sequence)return;if(data.shift_id!==id||!Array.isArray(data.transactions))throw new Error('INVALID_SHIFT_RESPONSE');this.renderEvents(data,index);
 }
 renderEvents(data,index){
  this.eventIndex=index;this.eventPages.length=index+1;if(data.next_cursor)this.eventPages.push(data.next_cursor);
  el('previousShiftEvent').hidden=index===0;el('nextShiftEvent').hidden=!data.next_cursor;
  el('shiftEventStatus').textContent='Giao dịch · Trang '+(index+1)+' · '+data.transactions.length+' bản ghi';
  el('shiftEventList').replaceChildren(...data.transactions.map(row=>{
   const li=document.createElement('li');li.append(p((row.kind==='REFUND'?'Hoàn':'Thu')+' '+money(row.amount)+' · '+(row.method==='CASH'?'Tiền mặt':'Chuyển khoản')),p('Đơn '+row.order_id+' · Thanh toán '+row.payment_id),p(this.date(row.created_at)+' · '+row.full_name+' · Mã giao dịch '+row.id));
   if(row.kind==='PAYMENT'&&row.method==='CASH')li.append(p('Khách đưa '+money(row.received_amount)+' · Tiền thừa '+money(row.change_amount)));
   if(row.reason)li.append(p('Lý do: '+row.reason));return li;
  }));
  if(!data.transactions.length)el('shiftEventList').append(p('Ca chưa có giao dịch đã ghi trên server.'));
 }
}
