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
  DialogBody,
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
  FileText,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useRouter } from "next/navigation";
import type { Transaction, TransactionType, Summary, Category, Member } from "@/types";
import { toast } from "@/hooks/use-toast";
import { upload } from "@vercel/blob/client";

function SummaryCards({
  summary,
  showIncome,
  onToggleIncomeVisibility,
}: {
  summary: Summary;
  showIncome: boolean;
  onToggleIncomeVisibility: () => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-muted-foreground">总收入</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={onToggleIncomeVisibility}
                  aria-label={showIncome ? "隐藏收入金额" : "显示收入金额"}
                >
                  {showIncome ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-2xl font-bold text-green-600">
                {showIncome ? formatCurrency(summary.totalIncome) : "****"}
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
              <p className="text-2xl font-bold text-red-600">{formatCurrency(summary.totalExpense)}</p>
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
                {showIncome ? formatCurrency(summary.balance) : "****"}
              </p>
            </div>
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10">
              <Calendar className="h-6 w-6 text-primary" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<Summary>({
    totalIncome: 0,
    totalExpense: 0,
    balance: 0,
  });
  const [showIncome, setShowIncome] = useState(false);
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
  const [filterMemberId, setFilterMemberId] = useState<string>("__all__");
  const [isMobileSummaryOpen, setIsMobileSummaryOpen] = useState(false);
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<{
    url: string;
    name?: string;
    type?: string;
  } | null>(null);
  
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
      if (filterMemberId && filterMemberId !== "__all__") params.append("memberId", filterMemberId);
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
  }, [filterType, filterCategoryId, filterMemberId, startDate, endDate]);

  // 显示的交易记录就是从服务器获取的数据
  const filteredTransactions = transactions;

  const incomeCategories = categories.filter((cat) => cat.type === "income");
  const expenseCategories = categories.filter((cat) => cat.type === "expense");

  const filterTypeCategoryValue = (() => {
    if (filterType === "all") return "__all__";
    if (!filterCategoryId || filterCategoryId === "__all__") return `${filterType}::__all__`;
    return `${filterType}::${filterCategoryId}`;
  })();

  // 当类型变化/分类列表变化时，确保已选分类仍匹配当前类型
  useEffect(() => {
    // 未选择具体类型时，不允许选具体分类
    if (filterType === "all") {
      if (filterCategoryId !== "__all__") setFilterCategoryId("__all__");
      return;
    }
    if (!filterCategoryId || filterCategoryId === "__all__") return;
    const selected = categories.find((c) => c.id === filterCategoryId);
    if (!selected || selected.type !== filterType) {
      setFilterCategoryId("__all__");
    }
  }, [filterType, filterCategoryId, categories]);

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
            <TransactionModal 
              key={isAddModalOpen ? 'open' : 'closed'} // 每次打开时重新挂载组件，确保表单是干净的
              mode="add"
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
        {/* 移动端：折叠统计卡片（可手动展开） */}
        <div className="md:hidden">
          <Card>
            <CardHeader className="py-4">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base">统计概览</CardTitle>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2"
                  onClick={() => setIsMobileSummaryOpen((v) => !v)}
                >
                  {isMobileSummaryOpen ? (
                    <>
                      收起
                      <ChevronUp className="h-4 w-4" />
                    </>
                  ) : (
                    <>
                      展开
                      <ChevronDown className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            </CardHeader>
            {isMobileSummaryOpen ? (
              <CardContent className="pt-0">
                <SummaryCards
                  summary={summary}
                  showIncome={showIncome}
                  onToggleIncomeVisibility={() => setShowIncome((v) => !v)}
                />
              </CardContent>
            ) : null}
          </Card>
        </div>

        {/* 桌面端：始终显示 */}
        <div className="hidden md:block">
          <SummaryCards
            summary={summary}
            showIncome={showIncome}
            onToggleIncomeVisibility={() => setShowIncome((v) => !v)}
          />
        </div>

        {/* Transactions */}
        <Card>
          <CardHeader className="border-b">
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <CardTitle>交易明细</CardTitle>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 md:hidden"
                  onClick={() => setIsMobileFiltersOpen((v) => !v)}
                >
                  {isMobileFiltersOpen ? (
                    <>
                      收起筛选
                      <ChevronUp className="h-4 w-4" />
                    </>
                  ) : (
                    <>
                      展开筛选
                      <ChevronDown className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
              {/* 筛选器 */}
              <div
                className={`${isMobileFiltersOpen ? "grid" : "hidden"} grid-cols-1 sm:grid-cols-2 md:grid md:grid-cols-4 gap-3`}
              >
                <div className="space-y-1">
                  <Label htmlFor="filter-type-category" className="text-xs text-muted-foreground">收支分类</Label>
                  <Select
                    value={filterTypeCategoryValue}
                    onValueChange={(value) => {
                      if (value === "__all__") {
                        setFilterType("all");
                        setFilterCategoryId("__all__");
                        return;
                      }
                      const [type, category] = value.split("::") as [
                        TransactionType,
                        string | undefined,
                      ];
                      setFilterType(type);
                      setFilterCategoryId(category && category !== "__all__" ? category : "__all__");
                    }}
                  >
                    <SelectTrigger id="filter-type-category">
                      <SelectValue placeholder="全部收支" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">全部收支</SelectItem>
                      <SelectItem value="income::__all__">全部收入</SelectItem>
                      {incomeCategories.map((cat) => (
                        <SelectItem key={cat.id} value={`income::${cat.id}`}>
                          {cat.icon} {cat.name}
                        </SelectItem>
                      ))}
                      <SelectItem value="expense::__all__">全部支出</SelectItem>
                      {expenseCategories.map((cat) => (
                        <SelectItem key={cat.id} value={`expense::${cat.id}`}>
                          {cat.icon} {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="filter-member" className="text-xs text-muted-foreground">人员</Label>
                  <Select
                    value={filterMemberId}
                    onValueChange={setFilterMemberId}
                    disabled={members.length === 0}
                  >
                    <SelectTrigger id="filter-member">
                      <SelectValue placeholder={members.length === 0 ? "暂无成员" : "全部人员"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">全部人员</SelectItem>
                      {members.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.avatar} {m.name}
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
                        <th className="text-left p-4 font-semibold text-sm text-muted-foreground">附件</th>
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
                              {transaction.type === "income" && !showIncome
                                ? "****"
                                : formatCurrency(transaction.amount)}
                            </span>
                          </td>
                          <td className="p-4">
                            {transaction.attachment_key ? (
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                                onClick={() =>
                                  setPreviewAttachment({
                                    url: transaction.attachment_key!,
                                    name: transaction.attachment_name,
                                    type: transaction.attachment_type,
                                  })
                                }
                              >
                                <Paperclip className="h-4 w-4" />
                                <span className="truncate max-w-[160px]">
                                  {transaction.attachment_name || "附件"}
                                </span>
                              </button>
                            ) : (
                              <span className="text-sm text-muted-foreground">-</span>
                            )}
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
                              {transaction.type === "income" && !showIncome
                                ? "****"
                                : formatCurrency(transaction.amount)}
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
                              <button
                                type="button"
                                className="flex items-center gap-1 hover:underline"
                                onClick={() =>
                                  setPreviewAttachment({
                                    url: transaction.attachment_key!,
                                    name: transaction.attachment_name,
                                    type: transaction.attachment_type,
                                  })
                                }
                              >
                                <Paperclip className="h-3.5 w-3.5" />
                                <span>附件</span>
                              </button>
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
          <TransactionModal
            key={selectedTransaction.id} // 使用 key 确保每次编辑不同记录时重新挂载组件
            mode="edit"
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

      {/* 附件预览对话框 */}
      <Dialog
        open={!!previewAttachment}
        onOpenChange={(open) => {
          if (!open) setPreviewAttachment(null);
        }}
      >
        <DialogContent className="sm:max-w-[900px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {previewAttachment?.type === "application/pdf" ? (
                <FileText className="h-4 w-4" />
              ) : (
                <Paperclip className="h-4 w-4" />
              )}
              <span>附件预览</span>
            </DialogTitle>
            <DialogDescription>
              {previewAttachment?.name || "未命名附件"}
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="flex items-center justify-center">
            {previewAttachment?.url ? (
              previewAttachment.type?.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewAttachment.url}
                  alt={previewAttachment.name || "附件图片"}
                  className="w-full max-h-full object-contain rounded-md border"
                />
              ) : (
                <iframe
                  title={previewAttachment.name || "附件"}
                  src={previewAttachment.url}
                  className="w-full h-full rounded-md border"
                />
              )
            ) : null}
          </DialogBody>

          {previewAttachment?.url ? (
            <DialogFooter>
              <Button asChild variant="outline">
                <a href={previewAttachment.url} target="_blank" rel="noreferrer">
                  新窗口打开
                </a>
              </Button>
              <Button onClick={() => setPreviewAttachment(null)}>关闭</Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

function TransactionModal({
  mode,
  transaction,
  categories,
  members,
  onClose,
}: {
  mode: "add" | "edit";
  transaction?: Transaction;
  categories: Category[];
  members: Member[];
  onClose: (shouldRefresh?: boolean) => void;
}) {
  const idPrefix = mode === "edit" ? "edit-" : "";

  const getTodayDate = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const formatDateForInput = (dateString: string) => {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const initial = (() => {
    if (mode === "edit" && transaction) {
      return {
        type: transaction.type,
        amount: transaction.amount.toString(),
        description: transaction.description || "",
        category_id: transaction.category_id || "",
        member_id: transaction.member_id || "",
        transaction_date: formatDateForInput(transaction.transaction_date),
      };
    }
    return {
      type: "expense" as TransactionType,
      amount: "",
      description: "",
      category_id: "",
      member_id: "",
      transaction_date: getTodayDate(),
    };
  })();

  const [formData, setFormData] = useState(initial);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [removeExistingAttachment, setRemoveExistingAttachment] = useState(false);

  useEffect(() => {
    if (mode === "edit" && transaction) {
      setFormData({
        type: transaction.type,
        amount: transaction.amount.toString(),
        description: transaction.description || "",
        category_id: transaction.category_id || "",
        member_id: transaction.member_id || "",
        transaction_date: formatDateForInput(transaction.transaction_date),
      });
    }
    if (mode === "add") {
      setFormData({
        type: "expense" as TransactionType,
        amount: "",
        description: "",
        category_id: "",
        member_id: "",
        transaction_date: getTodayDate(),
      });
    }
    setAttachment(null);
    setRemoveExistingAttachment(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, transaction?.id]);

  const filteredCategories = categories.filter((cat) => cat.type === formData.type);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      let attachment_key: string | null | undefined;
      let attachment_name: string | null | undefined;
      let attachment_type: string | null | undefined;

      if (mode === "edit" && removeExistingAttachment) {
        attachment_key = null;
        attachment_name = null;
        attachment_type = null;
      } else if (attachment) {
        const isAllowed =
          attachment.type === "application/pdf" || attachment.type.startsWith("image/");
        const maxBytes = 10 * 1024 * 1024;
        if (!isAllowed) throw new Error("仅支持上传图片或 PDF");
        if (attachment.size > maxBytes) throw new Error("附件过大（最大 10MB）");

        setIsUploading(true);
        const safeName = attachment.name.replace(/[^\w.\-() ]+/g, "_");
        const pathname = `transactions/${Date.now()}_${safeName}`;
        const blob = await upload(pathname, attachment, {
          access: "public",
          handleUploadUrl: "/api/blob/upload",
          contentType: attachment.type || undefined,
        });
        attachment_key = blob.url;
        attachment_name = attachment.name;
        attachment_type = blob.contentType || attachment.type || undefined;
      } else {
        // 不动附件：PATCH 时不传字段即可
        attachment_key = undefined;
        attachment_name = undefined;
        attachment_type = undefined;
      }

      const url =
        mode === "add"
          ? "/api/transactions"
          : `/api/transactions/${transaction?.id}`;
      const method = mode === "add" ? "POST" : "PATCH";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: formData.type,
          amount: parseFloat(formData.amount),
          description: formData.description || undefined,
          category_id: formData.category_id || undefined,
          member_id: formData.member_id || undefined,
          transaction_date: formData.transaction_date,
          attachment_key,
          attachment_name,
          attachment_type,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || (mode === "add" ? "创建失败" : "更新失败"));
      }

      onClose(true);
    } catch (error) {
      console.error(mode === "add" ? "创建交易记录失败:" : "更新交易记录失败:", error);
      toast.error(error instanceof Error ? error.message : "操作失败，请重试");
    } finally {
      setIsSubmitting(false);
      setIsUploading(false);
    }
  };

  const hasExistingAttachment = !!transaction?.attachment_key;

  return (
    <DialogContent className="sm:max-w-[500px]">
      <DialogHeader>
        <DialogTitle>{mode === "add" ? "添加交易记录" : "编辑交易记录"}</DialogTitle>
        <DialogDescription>
          {mode === "add" ? "填写交易详情，记录您的收支情况" : "修改交易详情"}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
        <DialogBody className="space-y-4 py-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}type`}>交易类型 *</Label>
            <Select
              value={formData.type}
              onValueChange={(value) =>
                setFormData({
                  ...formData,
                  type: value as TransactionType,
                  category_id: "",
                })
              }
            >
              <SelectTrigger id={`${idPrefix}type`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="income">收入</SelectItem>
                <SelectItem value="expense">支出</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}amount`}>金额 *</Label>
            <Input
              id={`${idPrefix}amount`}
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
          <Label htmlFor={`${idPrefix}category`}>分类</Label>
          <Select
            value={formData.category_id}
            onValueChange={(value) => setFormData({ ...formData, category_id: value })}
            disabled={filteredCategories.length === 0}
          >
            <SelectTrigger id={`${idPrefix}category`}>
              <SelectValue
                placeholder={
                  filteredCategories.length === 0
                    ? `暂无${formData.type === "income" ? "收入" : "支出"}分类`
                    : "请选择分类（可选）"
                }
              />
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
          <Label htmlFor={`${idPrefix}description`}>描述</Label>
          <Input
            id={`${idPrefix}description`}
            type="text"
            placeholder="请输入描述（可选）"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}member`}>家庭成员</Label>
          <Select
            value={formData.member_id}
            onValueChange={(value) => setFormData({ ...formData, member_id: value })}
            disabled={members.length === 0}
          >
            <SelectTrigger id={`${idPrefix}member`}>
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
          <Label htmlFor={`${idPrefix}date`}>交易日期 *</Label>
          <Input
            id={`${idPrefix}date`}
            type="date"
            value={formData.transaction_date}
            onChange={(e) => setFormData({ ...formData, transaction_date: e.target.value })}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}attachment`}>附件（图片 / PDF，可选）</Label>

          {mode === "edit" && hasExistingAttachment && !removeExistingAttachment && !attachment ? (
            <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs">
              <a
                href={transaction!.attachment_key!}
                target="_blank"
                rel="noreferrer"
                className="truncate text-primary hover:underline"
              >
                {transaction!.attachment_name || "当前附件"}
              </a>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRemoveExistingAttachment(true)}
                disabled={isSubmitting || isUploading}
              >
                移除
              </Button>
            </div>
          ) : null}

          {mode === "edit" && removeExistingAttachment ? (
            <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs text-muted-foreground">
              <span>将移除现有附件</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRemoveExistingAttachment(false)}
                disabled={isSubmitting || isUploading}
              >
                撤销
              </Button>
            </div>
          ) : null}

          <Input
            id={`${idPrefix}attachment`}
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => {
              const file = e.target.files?.[0] || null;
              setAttachment(file);
              if (file) setRemoveExistingAttachment(false);
            }}
            disabled={isSubmitting || isUploading}
          />

          {attachment ? (
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="truncate">
                {attachment.name}（{Math.ceil(attachment.size / 1024)}KB）
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setAttachment(null)}
                disabled={isSubmitting || isUploading}
              >
                移除
              </Button>
            </div>
          ) : null}
        </div>
        </DialogBody>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onClose(false)}
            disabled={isSubmitting || isUploading}
          >
            取消
          </Button>
          <Button type="submit" disabled={isSubmitting || isUploading}>
            {isSubmitting || isUploading ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
