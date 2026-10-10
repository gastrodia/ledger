/* eslint-disable @typescript-eslint/no-require-imports -- isolated matching policy. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { draftMatchReason } = require('./helpers/assistant-contracts.cjs')('@/lib/assistant-draft-match-rules');
const categories = new Set(['fund']);
const saved = (description, extra = {}) => ({ description, date_difference_days: -1, ...extra });
test('payment wrappers, punctuation and long truncated labels preserve merchant evidence without merging generic labels', () => {
  assert.equal(draftMatchReason({description:'扫码付款-德生龙社区厨房（永香路店）'},saved('德生龙社区厨房(永香路店)'),categories),'merchant');
  assert.equal(draftMatchReason({description:'蚂蚁财富-建信纳斯达克1...'},saved('蚂蚁财富-建信纳斯达克100'),categories),'merchant');
  assert.equal(draftMatchReason({description:'无备注'},saved('无备注'),categories),null);
  assert.equal(draftMatchReason({description:'小店'},saved('小店餐饮'),categories),null);
});
test('same amounts need independent merchant/purpose evidence; explicit different members cannot be merged', () => {
  assert.equal(draftMatchReason({description:'零食很忙'},saved('扫收钱码付款-给椰子店',{date_difference_days:-7}),categories),null);
  assert.equal(draftMatchReason({description:'基金申购',category_id:'fund'},saved('阳朔桂粉记快餐店',{category_id:'food'}),categories),null);
  assert.equal(draftMatchReason({description:'零食很忙',member_id:'a'},saved('零食很忙',{member_id:'b'}),categories),null);
  assert.equal(draftMatchReason({description:'阿里云服务购买'},saved('.top域名续费'),categories),'purpose');
  assert.equal(draftMatchReason({description:'阿里云服务购买'},saved('.top域名续费',{date_difference_days:-2}),categories),null);
});
