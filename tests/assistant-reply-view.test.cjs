/* eslint-disable @typescript-eslint/no-require-imports -- pure presentation contracts. */
const test=require('node:test');
const assert=require('node:assert/strict');
const {queryReplyView,recordReplyView,draftReplyView,draftMatchesReplyView}=require('./helpers/assistant-contracts.cjs')('@/lib/assistant-reply-view');
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

test('draft comparison preserves date mismatches, distinguishes merchant evidence from related purposes, and hides identifiers',()=>{
  const base={draft_id:'draft-secret',description:'零食很忙',type:'expense',transaction_date:'2026-10-09',amount_cents:980,status:'possible_match',candidate_count:1,candidates_limited:false,
    candidates:[{id:'transaction-secret',member_id:'member-secret',category_id:'category-secret',description:'零食很忙',transaction_date:'2026-10-08',amount_cents:980,same_description:true,match_reason:"merchant",date_difference_days:-1}]};
  const view=draftMatchesReplyView({date_window_days:7,rows:[base,{...base,description:'阿里云服务购买',amount_cents:3900,candidates:[{...base.candidates[0],description:'.top域名续费',amount_cents:3900,same_description:false,match_reason:"purpose"}]},{...base,status:'no_match',candidate_count:0,candidates:[]}]},[{id:'member-secret',name:'本人'}],[{id:'category-secret',name:'餐饮'}]);
  assert.equal(view.metrics[0].label,'疑似重复');
  assert.equal(view.metrics[0].value,'1 笔');
  assert.equal(view.metrics[1].value,'1 笔');
  assert.match(view.records[0].subtitle,/2026-10-09/);
  assert.match(view.records[0].rows[0].value,/2026-10-08.*¥9.80.*本人.*餐饮/);
  assert.match(view.records[0].rows[0].value,/早 1 天/);
  assert.equal(view.records[0].badge.label,'疑似重复');
  assert.equal(view.records[1].badge.label,'用途相关，待核对');
  assert.match(view.records[1].rows[0].value,/用途相关/);
  assert.match(view.records[2].rows[0].value,/前后 7 天/);
  assert.doesNotMatch(JSON.stringify(view),/draft-secret|transaction-secret|member-secret|category-secret/);
});
