/* eslint-disable @typescript-eslint/no-require-imports -- node:test for the database cleanup CLI. */
const test = require('node:test');
const assert = require('node:assert/strict');

test('cleanup previews by default and clears only obsolete values in one atomic statement', async () => {
  const { cleanEntityIcons } = await import('../scripts/clean-entity-icons.mjs');
  const categories = [{ icon: '🍜' }, { icon: 'lucide:folder' }, { icon: null }, { icon: '' }];
  const members = [{ avatar: '👨' }, { avatar: 'lucide:user-round' }, { avatar: 'initials' }, { avatar: null }, { avatar: 'family:father' }, { avatar: 'text:mother' }];
  const queries = [];
  const sql = async (parts, ...values) => {
    const text = parts.join('?');
    queries.push({ text, values });
    const [categoryIds, avatarIds] = values.map((value) => JSON.parse(value));
    const oldCategories = categories.filter(({ icon }) => icon !== null && !categoryIds.includes(icon));
    const oldMembers = members.filter(({ avatar }) => avatar !== null && !avatarIds.includes(avatar));
    if (text.includes('UPDATE categories')) {
      oldCategories.forEach((row) => { row.icon = null; });
      oldMembers.forEach((row) => { row.avatar = null; });
    }
    return [{ categories: String(oldCategories.length), members: String(oldMembers.length) }];
  };

  assert.deepEqual(await cleanEntityIcons(sql), { categories: 2, members: 1 });
  assert.equal(queries.length, 1);
  assert.doesNotMatch(queries[0].text, /UPDATE|DELETE|INSERT/);
  assert.equal(categories[0].icon, '🍜');
  assert.equal(members[0].avatar, '👨');

  assert.deepEqual(await cleanEntityIcons(sql, { apply: true }), { categories: 2, members: 1 });
  assert.equal(queries.length, 2);
  assert.match(queries[1].text, /WITH cleaned_categories AS/);
  assert.match(queries[1].text, /UPDATE categories SET icon = NULL/);
  assert.match(queries[1].text, /UPDATE members SET avatar = NULL/);
  assert.match(queries[1].text, /icon IS NOT NULL\s+AND icon NOT IN/);
  assert.match(queries[1].text, /avatar IS NOT NULL\s+AND avatar NOT IN/);
  assert.doesNotMatch(queries[1].text, /DELETE|INSERT|UPDATE transactions|SET name|sort_order/);
  assert.deepEqual(categories.map(({ icon }) => icon), [null, 'lucide:folder', null, null]);
  assert.deepEqual(members.map(({ avatar }) => avatar), [null, 'lucide:user-round', 'initials', null, 'family:father', 'text:mother']);
  assert.deepEqual(await cleanEntityIcons(sql, { apply: true }), { categories: 0, members: 0 });
});

test('cleanup propagates SQL failures instead of reporting a successful migration', async () => {
  const { cleanEntityIcons } = await import('../scripts/clean-entity-icons.mjs');
  await assert.rejects(cleanEntityIcons(async () => { throw Error('unavailable'); }, { apply: true }), /unavailable/);
});
