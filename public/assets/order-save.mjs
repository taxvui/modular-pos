// Only errors that follow the server's idempotency lookup prove that this exact
// operation did not commit. Auth, transport and unrecognized errors keep intent.
const rejected=new Set(['VERSION_CONFLICT','ORDER_FINALIZED','ORDER_NOT_FOUND','VARIANT_UNAVAILABLE','MODIFIER_UNAVAILABLE',
 'POSITION_NOT_FOUND','INVALID_ORDER','INVALID_POSITION','INVALID_QUANTITY','INVALID_MODIFIERS','DUPLICATE_MODIFIER',
 'DELIVERY_DETAILS_REQUIRED','ORDER_TOTAL_TOO_LARGE','23505']);
export async function saveOrderDurably(queue,payload,operationId,display,send,onStarted=()=>{}){
 const record=await queue.beginSave(payload,operationId,display);
 onStarted(record);
 let result;
 try{result=await send(structuredClone(record.payload),record.operationId);}
 catch(error){if(rejected.has(error.message))await queue.finishSave(record.operationId);throw error;}
 const receipt=typeof result?.order_id==='string'&&result.order_id.length>0&&(!record.payload.p_order_id||record.payload.p_order_id===result.order_id)&&
  Number.isSafeInteger(Number(result.revision))&&Number(result.revision)>=1&&result.total_amount!=null&&Number.isSafeInteger(Number(result.total_amount))&&Number(result.total_amount)>=0;
 const reviewed=['REVIEW_REQUIRED','CANCELLED'].includes(result?.status)&&result.operation_id===record.operationId&&typeof result.review_id==='string'&&result.review_id.length>0;
 if(!receipt&&!reviewed)throw new Error('INVALID_SERVER_ACK');
 await queue.finishSave(record.operationId);
 return result;
}
