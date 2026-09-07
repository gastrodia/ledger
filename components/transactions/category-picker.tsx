"use client";

import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Category, TransactionType } from '@/types';

export function TransactionCategoryPicker({ id, type, categories, value, onChange, disabled }: {
  id: string; type: TransactionType; categories: Category[]; value: string;
  onChange: (id: string) => void; disabled: boolean;
}) {
  const filtered = categories.filter((category) => category.type === type);
  return <div className="space-y-2">
    <Label htmlFor={id}>分类 *</Label>
    <Select value={value} onValueChange={onChange} disabled={disabled} required>
      <SelectTrigger id={id}><SelectValue placeholder="请选择分类" /></SelectTrigger>
      <SelectContent>
        {filtered.map((category) => <SelectItem key={category.id} value={category.id}>{category.icon} {category.name}</SelectItem>)}
      </SelectContent>
    </Select>
    {filtered.length === 0 ? <p className="text-xs text-muted-foreground">还没有{type === 'income' ? '收入' : '支出'}分类。请先在分类管理中添加分类。</p> : null}
  </div>;
}
