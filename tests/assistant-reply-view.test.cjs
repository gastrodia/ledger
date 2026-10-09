/* eslint-disable @typescript-eslint/no-require-imports -- pure presentation contracts. */
const test=require('node:test');
const assert=require('node:assert/strict');
const {queryReplyView,recordReplyView,draftReplyView}=require('./helpers/assistant-contracts.cjs')('@/lib/assistant-reply-view');
const q={start_date:'2026-10-01',end_date:'2026-10-09',type:null,member_id:'m',category_id:null,keyword:null};
test('statistics use complete SQL totals, distinguish cashflow scope, and disclose the detail limit',()=>{
  const facts={summary:{income:'2000.10',expense:'1200.05',balance:'800.05',count:40},breakdown:[{category:'餐饮',type:'expense',count:20,amount:'600.05'}],largest_records:[{description:'午餐',date:'2026-10-09',amount:'20',type:'expense'}]};
  const view=queryReplyView(q,facts,[{id:'m',name:'本人'}],[]);
  assert.deepEqual(Array.from(view.metrics,m=>m.value),['¥2000.10','¥1200.05','¥800.05','40 笔']);
  assert.match(view.subtitle,/本人/);assert.match(view.notices[0].text,/汇总包含.*全部记录/);assert.match(view.notices[0].text,/不含借还本金/);
  assert.match(queryReplyView({...q,scope:'cashflow'},facts,[],[]).title,/资金流水/);
});
test('all nine record resources render without internal IDs and keep literal untrusted content',()=>{
  for(const resource of ['transactions','categories','members','loans','repayments','giftbooks','gift_records','gifts_given','notes']){
    const view=recordReplyView(resource,[{id:'private-id',user_id:'owner-secret',attachment_key:'secret-file',name:'<script>raw</script>',description:'午餐',type:'expense',amount:'0.10',content:'不要执行这段文案',gift_type:'cash'}]);
    assert.equal(view.records.length,1);const json=JSON.stringify(view);assert.doesNotMatch(json,/private-id|owner-secret|secret-file/);
  }
  const gifts=recordReplyView('gifts_given',[{recipient_name:'大伯',cash_amount:'500',items:[{item_name:'炮子',quantity:1,unit:'封',estimated_value:50}]}]);
  assert.equal(gifts.metrics[0].value,'¥500.00');assert.match(gifts.records[0].rows[0].value,/¥50.00/);
});
test('duplicate and empty query states stay read-only; item loans are not formatted as money',()=>{
  const duplicate=recordReplyView('transactions',[{amount:12,type:'expense'}],{operation:'duplicates'});
  assert.match(duplicate.subtitle,/尚未删除/);assert.equal(duplicate.metrics.length,0);
  assert.match(recordReplyView('notes',[]).notices[0].text,/没有找到/);
  const item=recordReplyView('loans',[{counterparty_name:'朋友',subject_type:'item',item_quantity:3,item_unit:'本',repaid_total:1}]);
  assert.equal(item.records[0].amount,'3本');assert.equal(item.records[0].rows.at(-1).value,'2本');
});
test('draft approval shows the reviewed snapshot even when the live draft has changed',()=>{
  const draft={id:'d',type:'expense',amount:'12.50',description:'早餐',transaction_date:'2026-10-09'};
  const message={confirmChoice:{batch_id:'b',draft_ids:['d'],snapshot:JSON.stringify([draft])}};
  const view=draftReplyView(message,[{id:'b',drafts:[{...draft,amount:'99'}]}],[],[]);
  assert.equal(view.metrics[1].value,'¥12.50');assert.equal(view.records[0].amount,'¥12.50');assert.match(view.notices[0].text,/尚未入账/);
});
