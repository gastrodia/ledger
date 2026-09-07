import type { Category, TransactionType } from '@/types';

export async function createOrReuseTransactionCategory(
  input: { name: string; type: TransactionType; icon?: string },
  fetcher: typeof fetch = fetch,
): Promise<{ category: Category; created: boolean }> {
  const name = input.name.trim();
  if (!name || name.length > 128) throw new Error('分类名称需为 1–128 个字符');
  const existingResponse = await fetcher(`/api/categories?type=${input.type}`, { cache: 'no-store' });
  const existingBody = await existingResponse.json().catch(() => ({}));
  if (!existingResponse.ok || !Array.isArray(existingBody.data)) throw new Error(existingBody.error || '无法核对已有分类，请重试');
  const existing = (existingBody.data as Category[]).find((category) => category.type === input.type && category.name.trim().toLowerCase() === name.toLowerCase());
  if (existing) return { category: existing, created: false };
  const response = await fetcher('/api/categories', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, name }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.data?.id) throw new Error(body.error || '分类创建未确认，请重试后核对');
  return { category: body.data, created: true };
}
