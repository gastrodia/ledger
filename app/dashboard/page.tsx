"use client";

import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  TrendingUp,
  TrendingDown,
  Plus,
  Calendar,
  Paperclip,
  Trash2,
  Edit,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useRouter } from "next/navigation";
import type { Transaction, TransactionType, Summary, Category, Member } from "@/types";
import { toast } from "@/hooks/use-toast";

export default function DashboardPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<Summary>({
    totalIncome: 0,
    totalExpense: 0,
    balance: 0,
  });
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [filterType, setFilterType] = useState<TransactionType | "all">("all");
  const [filterCategoryId, setFilterCategoryId] = useState<string>("__all__");
  
  // 获取当月第一天
  const getFirstDayOfMonth = () => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    // 使用本地时区格式化日期，避免 UTC 转换问题
    const year = firstDay.getFullYear();
    const month = String(firstDay.getMonth() + 1).padStart(2, '0');
    const day = String(firstDay.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  // 获取今天
  const getToday = () => {
    const now = new Date();
    // 使用本地时区格式化日期，避免 UTC 转换问题
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  const [startDate, setStartDate] = useState<string>(getFirstDayOfMonth());
  const [endDate, setEndDate] = useState<string>(getToday());

  // 加载交易记录
  const loadTransactions = async () => {
    try {
      setIsLoading(true);
      const params = new URLSearchParams();
      if (filterType !== "all") params.append("type", filterType);
      if (filterCategoryId && filterCategoryId !== "__all__") params.append("categoryId", filterCategoryId);
      if (startDate) params.append("startDate", startDate);
      if (endDate) params.append("endDate", endDate);

      const response = await fetch(`/api/transactions?${params.toString()}`);
      if (!response.ok) {
        if (response.status === 401) {
          router.push("/login");
          return;
        }
        throw new Error("获取交易记录失败");
      }

      const result = await response.json();
      setTransactions(result.data || []);
      setSummary(result.summary || { totalIncome: 0, totalExpense: 0, balance: 0 });
    } catch (error) {
      console.error("加载交易记录失败:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // 加载分类
  const loadCategories = async () => {
    try {
      const response = await fetch("/api/categories");
      if (response.ok) {
        const result = await response.json();
        setCategories(result.data || []);
      }
    } catch (error) {
      console.error("加载分类失败:", error);
    }
  };

  // 加载家庭成员
  const loadMembers = async () => {
    try {
      const response = await fetch("/api/members");
      if (response.ok) {
        const result = await response.json();
        setMembers(result.data || []);
      }
    } catch (error) {
      console.error("加载家庭成员失败:", error);
    }
  };

  // 初始加载
  useEffect(() => {
    loadTransactions();
    loadCategories();
    loadMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterType, filterCategoryId, startDate, endDate]);

  // 显示的交易记录就是从服务器获取的数据
  const filteredTransactions = transactions;

  // 删除交易记录
  const handleDelete = async () => {
    if (!selectedTransaction) return;

    try {
      const response = await fetch(`/api/transactions/${selectedTransaction.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("删除失败");
      }

      await loadTransactions();
      setIsDeleteDialogOpen(false);
      setSelectedTransaction(null);
    } catch (error) {
      console.error("删除交易记录失败:", error);
      toast.error("删除失败，请重试");
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              交易记录
            </h1>
            <p className="text-muted-foreground mt-1">
              管理您的收支记录，实时统计收支情况
            </p>
          </div>
          <Dialog 
            open={isAddModalOpen} 
            onOpenChange={(open) => {
              setIsAddModalOpen(open);
            }}
          >
            <DialogTrigger asChild>
              <Button className="w-full sm:w-auto">
                <Plus className="h-4 w-4" />
                添加记录
              </Button>
            </DialogTrigger>
            <AddTransactionModal 
              key={isAddModalOpen ? 'open' : 'closed'} // 每次打开时重新挂载组件，确保表单是干净的
              categories={categories} 
              members={members}
              onClose={(shouldRefresh?: boolean) => {
                setIsAddModalOpen(false);
                // 只有在成功保存时才刷新列表
                if (shouldRefresh) {
                  loadTransactions();
                }
              }} 
            />
          </Dialog>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">总收入</p>
                  <p className="text-2xl font-bold text-green-600">
                    {formatCurrency(summary.totalIncome)}
                  </p>
                </div>
                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-green-100">
                  <TrendingUp className="h-6 w-6 text-green-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">总支出</p>
                  <p className="text-2xl font-bold text-red-600">
                    {formatCurrency(summary.totalExpense)}
                  </p>
                </div>
                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100">
                  <TrendingDown className="h-6 w-6 text-red-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">结余</p>
                  <p className="text-2xl font-bold text-primary">
                    {formatCurrency(summary.balance)}
                  </p>
                </div>
                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10">
                  <Calendar className="h-6 w-6 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Transactions */}
        <Card>
          <CardHeader className="border-b">
            <div className="flex flex-col gap-4">
              <CardTitle>交易明细</CardTitle>
              {/* 筛选器 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="filter-type" className="text-xs text-muted-foreground">类型</Label>
                  <Select value={filterType} onValueChange={(value) => setFilterType(value as TransactionType | "all")}>
                    <SelectTrigger id="filter-type">
                      <SelectValue placeholder="全部类型" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部类型</SelectItem>
                      <SelectItem value="income">收入</SelectItem>
                      <SelectItem value="expense">支出</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="filter-category" className="text-xs text-muted-foreground">分类</Label>
                  <Select value={filterCategoryId} onValueChange={setFilterCategoryId}>
                    <SelectTrigger id="filter-category">
                      <SelectValue placeholder="全部分类" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">全部分类</SelectItem>
                      {categories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.icon} {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="start-date" className="text-xs text-muted-foreground">开始日期</Label>
                  <Input
                    id="start-date"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="end-date" className="text-xs text-muted-foreground">结束日期</Label>
                  <Input
                    id="end-date"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="text-center py-12 text-muted-foreground">
                <p>加载中...</p>
              </div>
            ) : filteredTransactions.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <div className="text-5xl mb-4">💰</div>
                <p className="text-lg font-medium mb-2">暂无交易记录</p>
                <p className="text-sm mb-4">开始记录您的第一笔交易吧</p>
                <Button variant="outline" onClick={() => setIsAddModalOpen(true)}>
                  <Plus className="h-4 w-4" />
                  添加第一笔记录
                </Button>
              </div>
            ) : (
              <>
                {/* PC端表格视图 */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-4 font-semibold text-sm text-muted-foreground">分类</th>
                        <th className="text-left p-4 font-semibold text-sm text-muted-foreground">描述</th>
                        <th className="text-left p-4 font-semibold text-sm text-muted-foreground">类型</th>
                        <th className="text-left p-4 font-semibold text-sm text-muted-foreground">成员</th>
                        <th className="text-left p-4 font-semibold text-sm text-muted-foreground">日期</th>
                        <th className="text-right p-4 font-semibold text-sm text-muted-foreground">金额</th>
                        <th className="text-right p-4 font-semibold text-sm text-muted-foreground w-24">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTransactions.map((transaction) => (
                        <tr
                          key={transaction.id}
                          className="border-b last:border-0 hover:bg-accent/50 transition-colors group"
                        >
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              <div
                                className="flex items-center justify-center w-10 h-10 rounded-lg text-lg shrink-0 bg-muted"
                              >
                                {transaction.category?.icon}
                              </div>
                              <span className="font-medium">{transaction.category?.name || "未分类"}</span>
                            </div>
                          </td>
                          <td className="p-4">
                            <span className="text-sm text-muted-foreground max-w-[200px] truncate block">
                              {transaction.description || "-"}
                            </span>
                          </td>
                          <td className="p-4">
                            <Badge
                              variant="outline"
                              className="font-normal"
                            >
                              {transaction.type === "income" ? "收入" : "支出"}
                            </Badge>
                          </td>
                          <td className="p-4">
                            {transaction.member ? (
                              <div className="flex items-center gap-2">
                                <span>{transaction.member.avatar}</span>
                                <span className="text-sm">{transaction.member.name}</span>
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="p-4">
                            <div className="flex items-center gap-2 text-sm">
                              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                              <span>{formatDate(transaction.transaction_date)}</span>
                            </div>
                          </td>
                          <td className="p-4 text-right">
                            <span
                              className={`font-bold text-base ${
                                transaction.type === "income" ? "text-green-600" : "text-red-600"
                              }`}
                            >
                              {transaction.type === "income" ? "+" : "-"}
                              {formatCurrency(transaction.amount)}
                            </span>
                          </td>
                          <td className="p-4">
                            <div className="flex items-center justify-end gap-1">
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-8 w-8"
                                onClick={() => {
                                  setSelectedTransaction(transaction);
                                  setIsEditModalOpen(true);
                                }}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => {
                                  setSelectedTransaction(transaction);
                                  setIsDeleteDialogOpen(true);
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* 移动端卡片视图 */}
                <div className="md:hidden divide-y">
                  {filteredTransactions.map((transaction) => (
                    <div
                      key={transaction.id}
                      className="p-4 hover:bg-accent/30 transition-colors active:bg-accent/50"
                    >
                      <div className="flex items-start gap-3">
                        {/* 左侧图标 */}
                        <div
                          className="flex items-center justify-center w-12 h-12 rounded-xl text-2xl shrink-0 shadow-sm bg-muted"
                        >
                          {transaction.category?.icon}
                        </div>

                        {/* 右侧信息 */}
                        <div className="flex-1 min-w-0 space-y-1.5">
                          {/* 分类名称、类型和操作按钮 */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <h3 className="font-semibold text-base leading-tight truncate">
                                {transaction.category?.name || "未分类"}
                              </h3>
                              <Badge
                                variant="outline"
                                className="text-xs shrink-0"
                              >
                                {transaction.type === "income" ? "收入" : "支出"}
                              </Badge>
                            </div>
                            {/* 操作按钮 */}
                            <div className="flex items-center gap-0.5 shrink-0">
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-7 w-7"
                                onClick={() => {
                                  setSelectedTransaction(transaction);
                                  setIsEditModalOpen(true);
                                }}
                              >
                                <Edit className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() => {
                                  setSelectedTransaction(transaction);
                                  setIsDeleteDialogOpen(true);
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>

                          {/* 描述 */}
                          {transaction.description && (
                            <p className="text-sm text-muted-foreground line-clamp-2">
                              {transaction.description}
                            </p>
                          )}

                          {/* 金额 */}
                          <div>
                            <span
                              className={`font-bold text-lg ${
                                transaction.type === "income" ? "text-green-600" : "text-red-600"
                              }`}
                            >
                              {transaction.type === "income" ? "+" : "-"}
                              {formatCurrency(transaction.amount)}
                            </span>
                          </div>

                          {/* 元信息 */}
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1.5">
                              <Calendar className="h-3.5 w-3.5" />
                              {formatDate(transaction.transaction_date)}
                            </span>
                            {transaction.member && (
                              <span className="flex items-center gap-1.5">
                                <span className="text-base">{transaction.member.avatar}</span>
                                <span>{transaction.member.name}</span>
                              </span>
                            )}
                            {transaction.attachment_key && (
                              <span className="flex items-center gap-1">
                                <Paperclip className="h-3.5 w-3.5" />
                                <span>附件</span>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 编辑对话框 */}
      {selectedTransaction && (
        <Dialog 
          open={isEditModalOpen} 
          onOpenChange={(open) => {
            setIsEditModalOpen(open);
            // 当对话框关闭时，清除选中的交易记录
            if (!open) {
              setSelectedTransaction(null);
            }
          }}
        >
          <EditTransactionModal
            key={selectedTransaction.id} // 使用 key 确保每次编辑不同记录时重新挂载组件
            transaction={selectedTransaction}
            categories={categories}
            members={members}
            onClose={(shouldRefresh?: boolean) => {
              setIsEditModalOpen(false);
              setSelectedTransaction(null);
              // 只有在成功保存时才刷新列表
              if (shouldRefresh) {
                loadTransactions();
              }
            }}
          />
        </Dialog>
      )}

      {/* 删除确认对话框 */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除这条交易记录吗？此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}

function AddTransactionModal({ 
  categories, 
  members, 
  onClose 
}: { 
  categories: Category[];
  members: Member[];
  onClose: (shouldRefresh?: boolean) => void;
}) {
  // 获取今天日期的辅助函数，使用本地时区
  const getTodayDate = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const [formData, setFormData] = useState({
    type: "expense" as TransactionType,
    amount: "",
    description: "",
    category_id: "",
    member_id: "",
    transaction_date: getTodayDate(),
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 根据类型筛选分类
  const filteredCategories = categories.filter(cat => cat.type === formData.type);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/transactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: formData.type,
          amount: parseFloat(formData.amount),
          description: formData.description || undefined,
          category_id: formData.category_id || undefined,
          member_id: formData.member_id || undefined,
          transaction_date: formData.transaction_date,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "创建失败");
      }

      // 保存成功时传递 true，触发列表刷新
      onClose(true);
    } catch (error) {
      console.error("创建交易记录失败:", error);
      toast.error(error instanceof Error ? error.message : "创建失败，请重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <DialogContent className="sm:max-w-[500px]">
      <DialogHeader>
        <DialogTitle>添加交易记录</DialogTitle>
        <DialogDescription>
          填写交易详情，记录您的收支情况
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4 py-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="type">交易类型 *</Label>
            <Select 
              value={formData.type} 
              onValueChange={(value) => setFormData({ 
                ...formData, 
                type: value as TransactionType,
                category_id: "" // 重置分类
              })}
            >
              <SelectTrigger id="type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="income">收入</SelectItem>
                <SelectItem value="expense">支出</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="amount">金额 *</Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              min="0.01"
              placeholder="请输入金额"
              value={formData.amount}
              onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
              required
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="category">分类</Label>
          <Select 
            value={formData.category_id} 
            onValueChange={(value) => setFormData({ ...formData, category_id: value })}
            disabled={filteredCategories.length === 0}
          >
            <SelectTrigger id="category">
              <SelectValue placeholder={
                filteredCategories.length === 0 
                  ? `暂无${formData.type === "income" ? "收入" : "支出"}分类` 
                  : "请选择分类（可选）"
              } />
            </SelectTrigger>
            <SelectContent>
              {filteredCategories.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>
                  {cat.icon} {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">描述</Label>
          <Input
            id="description"
            type="text"
            placeholder="请输入描述（可选）"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="member">家庭成员</Label>
          <Select 
            value={formData.member_id} 
            onValueChange={(value) => setFormData({ ...formData, member_id: value })}
            disabled={members.length === 0}
          >
            <SelectTrigger id="member">
              <SelectValue placeholder={members.length === 0 ? "暂无成员" : "请选择成员（可选）"} />
            </SelectTrigger>
            <SelectContent>
              {members.map((member) => (
                <SelectItem key={member.id} value={member.id}>
                  {member.avatar} {member.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="date">交易日期 *</Label>
          <Input
            id="date"
            type="date"
            value={formData.transaction_date}
            onChange={(e) => setFormData({ ...formData, transaction_date: e.target.value })}
            required
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onClose(false)} disabled={isSubmitting}>
            取消
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function EditTransactionModal({ 
  transaction,
  categories, 
  members, 
  onClose 
}: { 
  transaction: Transaction;
  categories: Category[];
  members: Member[];
  onClose: (shouldRefresh?: boolean) => void;
}) {
  // 格式化日期的辅助函数，确保使用本地时区
  const formatDateForInput = (dateString: string) => {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const [formData, setFormData] = useState({
    type: transaction.type,
    amount: transaction.amount.toString(),
    description: transaction.description || "",
    category_id: transaction.category_id || "",
    member_id: transaction.member_id || "",
    transaction_date: formatDateForInput(transaction.transaction_date),
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 当 transaction 变化时，重新初始化表单数据
  useEffect(() => {
    setFormData({
      type: transaction.type,
      amount: transaction.amount.toString(),
      description: transaction.description || "",
      category_id: transaction.category_id || "",
      member_id: transaction.member_id || "",
      transaction_date: formatDateForInput(transaction.transaction_date),
    });
  }, [transaction]);

  // 根据类型筛选分类
  const filteredCategories = categories.filter(cat => cat.type === formData.type);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/transactions/${transaction.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: formData.type,
          amount: parseFloat(formData.amount),
          description: formData.description || undefined,
          category_id: formData.category_id || undefined,
          member_id: formData.member_id || undefined,
          transaction_date: formData.transaction_date,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "更新失败");
      }

      // 保存成功时传递 true，触发列表刷新
      onClose(true);
    } catch (error) {
      console.error("更新交易记录失败:", error);
      toast.error(error instanceof Error ? error.message : "更新失败，请重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <DialogContent className="sm:max-w-[500px]">
      <DialogHeader>
        <DialogTitle>编辑交易记录</DialogTitle>
        <DialogDescription>
          修改交易详情
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4 py-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="edit-type">交易类型 *</Label>
            <Select 
              value={formData.type} 
              onValueChange={(value) => setFormData({ 
                ...formData, 
                type: value as TransactionType,
                category_id: "" // 重置分类
              })}
            >
              <SelectTrigger id="edit-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="income">收入</SelectItem>
                <SelectItem value="expense">支出</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-amount">金额 *</Label>
            <Input
              id="edit-amount"
              type="number"
              step="0.01"
              min="0.01"
              placeholder="请输入金额"
              value={formData.amount}
              onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
              required
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="edit-category">分类</Label>
          <Select 
            value={formData.category_id} 
            onValueChange={(value) => setFormData({ ...formData, category_id: value })}
            disabled={filteredCategories.length === 0}
          >
            <SelectTrigger id="edit-category">
              <SelectValue placeholder={
                filteredCategories.length === 0 
                  ? `暂无${formData.type === "income" ? "收入" : "支出"}分类` 
                  : "请选择分类（可选）"
              } />
            </SelectTrigger>
            <SelectContent>
              {filteredCategories.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>
                  {cat.icon} {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="edit-description">描述</Label>
          <Input
            id="edit-description"
            type="text"
            placeholder="请输入描述（可选）"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="edit-member">家庭成员</Label>
          <Select 
            value={formData.member_id} 
            onValueChange={(value) => setFormData({ ...formData, member_id: value })}
            disabled={members.length === 0}
          >
            <SelectTrigger id="edit-member">
              <SelectValue placeholder={members.length === 0 ? "暂无成员" : "请选择成员（可选）"} />
            </SelectTrigger>
            <SelectContent>
              {members.map((member) => (
                <SelectItem key={member.id} value={member.id}>
                  {member.avatar} {member.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="edit-date">交易日期 *</Label>
          <Input
            id="edit-date"
            type="date"
            value={formData.transaction_date}
            onChange={(e) => setFormData({ ...formData, transaction_date: e.target.value })}
            required
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onClose(false)} disabled={isSubmitting}>
            取消
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
