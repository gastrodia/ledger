"use client";

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createOrReuseTransactionCategory } from '@/lib/transaction-categories';
import type { Category, TransactionType } from '@/types';

const suggestions = { expense: ['餐饮', '交通', '购物', '住房'], income: ['工资', '奖金', '红包'] };
export function TransactionCategoryPicker({ id, type, categories, value, onChange, onCreated, onPendingChange, disabled }: {
  id: string; type: TransactionType; categories: Category[]; value: string;
  onChange: (id: string) => void; onCreated: (category: Category) => void;
  onPendingChange: (pending: boolean, busy: boolean) => void; disabled: boolean;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const creating = useRef(false);
  const filtered = categories.filter((category) => category.type === type);
  const updateName = (next: string) => { setName(next); setError(null); onPendingChange(!!next.trim(), false); };
  const create = async () => {
    if (creating.current || disabled) return;
    creating.current = true;
    setBusy(true); setError(null); setMessage(''); onPendingChange(!!name.trim(), true);
    try {
      // Web Locks also serialize two same-origin tabs where supported.
      const run = () => createOrReuseTransactionCategory({ name, type });
      const result = typeof navigator !== 'undefined' && navigator.locks
        ? await navigator.locks.request(`ledger:category:${type}:${name.trim().toLowerCase()}`, run) : await run();
      onCreated(result.category);
      setName(''); setShowCreate(false);
      setMessage(result.created ? '分类已添加并选中' : '已选用同名的现有分类');
      onPendingChange(false, false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '添加失败，请重试');
      onPendingChange(!!name.trim(), false);
    } finally { creating.current = false; setBusy(false); }
  };
  return <div className="space-y-2">
    <Label htmlFor={id}>分类</Label>
    <Select value={value || '__none__'} onValueChange={(next) => onChange(next === '__none__' ? '' : next)} disabled={disabled || busy}>
      <SelectTrigger id={id}><SelectValue placeholder="未分类" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">未分类</SelectItem>
        {filtered.map((category) => <SelectItem key={category.id} value={category.id}>{category.icon} {category.name}</SelectItem>)}
      </SelectContent>
    </Select>
    {filtered.length === 0 ? <p className="text-xs text-muted-foreground">还没有{type === 'income' ? '收入' : '支出'}分类。可以先记为未分类，也可以添加常用分类。</p> : null}
    {!showCreate ? <Button type="button" size="sm" variant="outline" disabled={disabled || busy} onClick={() => { setShowCreate(true); setMessage(''); }}>新增分类</Button> : <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap gap-2" aria-label="常用分类名称">
        {suggestions[type].map((suggestion) => <Button key={suggestion} type="button" size="sm" variant="outline" disabled={disabled || busy} onClick={() => updateName(suggestion)}>{suggestion}</Button>)}
      </div>
      <Label htmlFor={`${id}-new`} className="text-xs">分类名称（点击添加后创建）</Label>
      <Input id={`${id}-new`} value={name} maxLength={128} disabled={disabled || busy} placeholder="例如餐饮、工资" onChange={(event) => updateName(event.target.value)} />
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={disabled || busy || !name.trim()} onClick={create}>{busy ? '核对并添加中…' : '添加并选中'}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={disabled || busy} onClick={() => { updateName(''); setShowCreate(false); }}>取消新增</Button>
      </div>
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
    </div>}
    {message ? <p className="text-xs text-muted-foreground" role="status">{message}</p> : null}
  </div>;
}
