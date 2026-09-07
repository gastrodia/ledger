"use client";

import { useState, useEffect, useRef, Suspense } from "react";
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
  Search,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useRouter } from "next/navigation";
import type { Transaction, TransactionType, Summary, Category, Member } from "@/types";
import { toast } from "@/hooks/use-toast";
import { upload } from "@/lib/upload";
import { useFormDraft } from "@/hooks/use-form-draft";
import { DraftNotice } from "@/components/ui/draft-notice";
import { useTransactionNavigation, useTransactionScrollRestore } from "@/hooks/use-transaction-navigation";
import { useFormLeaveGuard } from "@/hooks/use-form-leave-guard";
import { groupTransactionsByDay } from "@/lib/transaction-days";
import { TransactionCategoryPicker } from "@/components/transactions/category-picker";

type DatePreset = "today" | "month" | "lastMonth";
function getTransactionDateRange(preset: DatePreset, now = new Date()) {
  const format = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  if (preset === "today") return { start: format(now), end: format(now) };
  if (preset === "lastMonth") return {
    start: format(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
    end: format(new Date(now.getFullYear(), now.getMonth(), 0)),
  };
  return {
    start: format(new Date(now.getFullYear(), now.getMonth(), 1)),
    end: format(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

function SummaryCards({
  summary,
  showIncome,
  onToggleIncomeVisibility,
}: {
  summary: Summary | null;
  showIncome: boolean;
  onToggleIncomeVisibility: () => void;
}) {
  if (!summary) return <p className="p-4 text-sm text-muted-foreground" role="status">当前筛选暂无可用汇总</p>;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <Card>
        <CardContent className="pt-4 sm:pt-5">
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
            <div className="flex items-center justify-center w-10 h-10 rounded-md bg-green-100">
              <TrendingUp className="h-6 w-6 text-green-600" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4 sm:pt-5">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">总支出</p>
              <p className="text-2xl font-bold text-red-600">{formatCurrency(summary.totalExpense)}</p>
            </div>
            <div className="flex items-center justify-center w-10 h-10 rounded-md bg-red-100">
              <TrendingDown className="h-6 w-6 text-red-600" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4 sm:pt-5">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">结余</p>
              <p className="text-2xl font-bold text-primary">
                {showIncome ? formatCurrency(summary.balance) : "****"}
              </p>
            </div>
            <div className="flex items-center justify-center w-10 h-10 rounded-md bg-primary/10">
              <Calendar className="h-6 w-6 text-primary" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function DashboardPage() {
  return <Suspense fallback={<DashboardLayout><p className="p-8 text-muted-foreground">正在加载交易记录…</p></DashboardLayout>}>
    <DashboardContent />
  </Suspense>;
}

function DashboardContent() {
  const router = useRouter();
  const navigation = useTransactionNavigation({
    startDate: getTransactionDateRange("month").start, endDate: getTransactionDateRange("month").end,
    type: "all", categoryId: "__all__", memberId: "__all__", q: "",
  });
  const { startDate, endDate, type: filterType, categoryId: filterCategoryId, memberId: filterMemberId, q: searchText } = navigation.filters;
  const setStartDate = (value: string) => navigation.setFilters((current) => ({ ...current, startDate: value }));
  const setEndDate = (value: string) => navigation.setFilters((current) => ({ ...current, endDate: value }));
  const setFilterType = (value: TransactionType | "all") => navigation.setFilters((current) => ({ ...current, type: value }));
  const setFilterCategoryId = (value: string) => navigation.setFilters((current) => ({ ...current, categoryId: value }));
  const setFilterMemberId = (value: string) => navigation.setFilters((current) => ({ ...current, memberId: value }));
  const addCloseRef = useRef<(() => Promise<boolean>) | null>(null);
  const editCloseRef = useRef<(() => Promise<boolean>) | null>(null);
  const [categoriesReload, setCategoriesReload] = useState(0);
  const [summary, setSummary] = useState<Summary>({
    totalIncome: 0,
    totalExpense: 0,
    balance: 0,
  });
  const [showIncome, setShowIncome] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [membersStatus, setMembersStatus] = useState<"loading" | "ready" | "error">("loading");
  const [membersReload, setMembersReload] = useState(0);
  const retryMembers = () => { setMembersStatus("loading"); setMembersReload((value) => value + 1); };
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [hasAnyTransactions, setHasAnyTransactions] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<{ key: string; message: string } | null>(null);
  const [isMobileSummaryOpen, setIsMobileSummaryOpen] = useState(false);
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState({ q: "", startDate, endDate });
  const [previewAttachment, setPreviewAttachment] = useState<{
    url: string;
    name?: string;
    type?: string;
  } | null>(null);
  
  const dateRangeError = !startDate || !endDate
    ? "请选择开始和结束日期后查看记录。"
    : startDate > endDate ? "开始日期不能晚于结束日期，请调整日期范围。" : null;
  const clearFilters = () => {
    const range = getTransactionDateRange("month");
    navigation.setFilters({ q: "", type: "all", categoryId: "__all__", memberId: "__all__", startDate: range.start, endDate: range.end });
  };

  const effectiveCategoryId = filterCategoryId || "__all__";
  const params = new URLSearchParams();
  if (filterType !== "all") params.set("type", filterType);
  if (effectiveCategoryId !== "__all__") params.set("categoryId", effectiveCategoryId);
  if (filterMemberId !== "__all__") params.set("memberId", filterMemberId);
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  if (searchText.trim()) params.set("q", searchText.trim());
  const query = params.toString();
  const requestKey = navigation.ready ? `${query}:${reload}` : "";
  const isLoading = !dateRangeError && (!requestKey || loadedQuery !== requestKey);
  const currentError = loadError?.key === requestKey ? loadError.message : null;
  const visibleSummary = isLoading || dateRangeError || currentError ? null : summary;
  const loadTransactions = () => setReload((value) => value + 1);

  useEffect(() => {
    if (dateRangeError || !requestKey) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(`/api/transactions?${query}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!response.ok) {
          if (response.status === 401) { router.push("/login"); return; }
          const errorBody = await response.json().catch(() => ({}));
          throw new Error(errorBody.error || "获取交易记录失败，请重试");
        }
        const result = await response.json();
        if (controller.signal.aborted) return;
        setLoadError(null);
        setHasAnyTransactions(typeof result.hasAnyTransactions === "boolean" ? result.hasAnyTransactions : null);
        setTransactions(result.data || []);
        setSummary(result.summary || { totalIncome: 0, totalExpense: 0, balance: 0 });
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("加载交易记录失败:", error);
          setLoadError({ key: requestKey, message: error instanceof Error ? error.message : "获取交易记录失败，请重试" });
        }
      } finally {
        if (!controller.signal.aborted) setLoadedQuery(requestKey);
      }
    };
    void load();
    return () => controller.abort();
  }, [query, requestKey, router, dateRangeError]);

  useEffect(() => {
    const controller = new AbortController();
    // 加载分类
    const loadCategories = async () => {
      try {
        const response = await fetch("/api/categories", { signal: controller.signal });
        if (response.ok) {
          const result = await response.json();
          if (controller.signal.aborted) return;
          setCategories(result.data || []);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("加载分类失败:", error);
      }
    };

    void loadCategories();
    return () => controller.abort();
  }, [categoriesReload]);

  useEffect(() => {
    const controller = new AbortController();
    const loadMembers = async () => {
      try {
        const response = await fetch("/api/members", { signal: controller.signal });
        if (!response.ok) throw new Error("加载家庭成员失败");
        const result = await response.json();
        if (controller.signal.aborted) return;
        setMembers(result.data || []);
        setMembersStatus("ready");
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("加载家庭成员失败:", error);
        setMembersStatus("error");
      }
    };
    void loadMembers();
    return () => controller.abort();
  }, [membersReload]);

  // 显示的交易记录就是从服务器获取的数据
  const filteredTransactions = transactions;
  const dailyGroups = groupTransactionsByDay(filteredTransactions);
  useTransactionScrollRestore(navigation.session, navigation.ready && !isLoading && !currentError && !dateRangeError);
  const onCategoryCreated = (category: Category) => {
    setCategories((current) => [...current.filter((item) => item.id !== category.id), category]);
    setCategoriesReload((value) => value + 1);
  };

  const incomeCategories = categories.filter((cat) => cat.type === "income");
  const expenseCategories = categories.filter((cat) => cat.type === "expense");

  const filterTypeCategoryValue = (() => {
    if (filterType === "all") {
      if (effectiveCategoryId === "__all__") return "__all__";
      const categoryType = categories.find((category) => category.id === effectiveCategoryId)?.type || "all";
      return `${categoryType}::${effectiveCategoryId}`;
    }
    if (effectiveCategoryId === "__all__") return `${filterType}::__all__`;
    return `${filterType}::${effectiveCategoryId}`;
  })();

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
            <h1 className="text-2xl font-semibold tracking-tight">
              交易记录
            </h1>
            <p className="text-sm leading-6 text-muted-foreground mt-1">
              管理您的收支记录，实时统计收支情况
            </p>
          </div>
          <Dialog 
            open={isAddModalOpen} 
            onOpenChange={(open) => {
              if (open) setIsAddModalOpen(true);
              else if (addCloseRef.current) void addCloseRef.current();
              else setIsAddModalOpen(false);
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
              isOpen={isAddModalOpen}
              closeGuardRef={addCloseRef}
              onCategoryCreated={onCategoryCreated}
              onSaved={loadTransactions}
              categories={categories} 
              members={members}
              membersStatus={membersStatus}
              onRetryMembers={retryMembers}
              onManageMembers={() => router.push("/dashboard/members")}
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
                  summary={visibleSummary}
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
            summary={visibleSummary}
            showIncome={showIncome}
            onToggleIncomeVisibility={() => setShowIncome((v) => !v)}
          />
        </div>

        {/* Transactions */}
        <Card>
          <CardHeader className="border-b">
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="shrink-0">交易明细</CardTitle>
                <div className="flex items-center gap-1">
                  <Dialog open={isSearchOpen} onOpenChange={(open) => {
                    if (open) setSearchDraft({ q: searchText, startDate, endDate });
                    setIsSearchOpen(open);
                  }}>
                    <DialogTrigger asChild>
                      <Button type="button" variant={searchText ? "secondary" : "ghost"} size="sm" className="h-8 px-2">
                        <Search className="h-4 w-4" />{searchText ? "搜索中" : "搜索与日期"}
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[420px]">
                      <DialogHeader>
                        <DialogTitle>搜索与快捷日期</DialogTitle>
                        <DialogDescription>在指定日期范围内查找记录。</DialogDescription>
                      </DialogHeader>
                      <form onSubmit={(event) => {
                        event.preventDefault();
                        navigation.setFilters((current) => ({ ...current, ...searchDraft, q: searchDraft.q.trim() }));
                        setIsSearchOpen(false);
                      }} className="flex min-h-0 flex-1 flex-col">
                        <DialogBody className="space-y-4 py-4">
                          <div className="space-y-1">
                            <Label htmlFor="transaction-search">搜索备注（可选）</Label>
                            <Input id="transaction-search" type="search" placeholder="输入备注关键词，如午餐、房租"
                              value={searchDraft.q} onChange={(event) => setSearchDraft({ ...searchDraft, q: event.target.value })} />
                          </div>
                          <div className="flex gap-2" role="group" aria-label="快捷日期">
                            {([["today", "今天"], ["month", "本月"], ["lastMonth", "上月"]] as const).map(([preset, label]) => {
                              const range = getTransactionDateRange(preset);
                              const active = searchDraft.startDate === range.start && searchDraft.endDate === range.end;
                              return <Button key={preset} type="button" size="sm" variant={active ? "default" : "outline"}
                                aria-pressed={active} onClick={() => setSearchDraft({ ...searchDraft, startDate: range.start, endDate: range.end })}>{label}</Button>;
                            })}
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <Label htmlFor="search-start-date">开始日期</Label>
                              <Input id="search-start-date" type="date" required value={searchDraft.startDate}
                                onChange={(event) => setSearchDraft({ ...searchDraft, startDate: event.target.value })} />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor="search-end-date">结束日期</Label>
                              <Input id="search-end-date" type="date" required min={searchDraft.startDate} value={searchDraft.endDate}
                                onChange={(event) => setSearchDraft({ ...searchDraft, endDate: event.target.value })} />
                            </div>
                          </div>
                        </DialogBody>
                        <DialogFooter>
                          <Button type="button" variant="outline" onClick={() => { clearFilters(); setIsSearchOpen(false); }}>重置为本月</Button>
                          <Button type="submit" disabled={!searchDraft.startDate || !searchDraft.endDate || searchDraft.startDate > searchDraft.endDate}>查看记录</Button>
                        </DialogFooter>
                      </form>
                    </DialogContent>
                  </Dialog>
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
                        TransactionType | "all",
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
                      <SelectItem value="all::none">未分类（全部收支）</SelectItem>
                      {filterTypeCategoryValue.startsWith("all::") && effectiveCategoryId !== "none" ?
                        <SelectItem value={filterTypeCategoryValue}>指定分类</SelectItem> : null}
                      <SelectItem value="income::__all__">全部收入</SelectItem>
                      <SelectItem value="income::none">未分类收入</SelectItem>
                      {incomeCategories.map((cat) => (
                        <SelectItem key={cat.id} value={`income::${cat.id}`}>
                          {cat.icon} {cat.name}
                        </SelectItem>
                      ))}
                      <SelectItem value="expense::__all__">全部支出</SelectItem>
                      <SelectItem value="expense::none">未分类支出</SelectItem>
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
                  >
                    <SelectTrigger id="filter-member">
                      <SelectValue placeholder={members.length === 0 ? "暂无成员" : "全部人员"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">全部人员</SelectItem>
                      <SelectItem value="none">未指定成员</SelectItem>
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
            {dateRangeError ? (
              <div className="p-8 text-center text-destructive" role="alert">{dateRangeError}</div>
            ) : isLoading ? (
              <div className="text-center py-12 text-muted-foreground">
                <p>加载中...</p>
              </div>
            ) : currentError ? (
              <div className="space-y-3 p-8 text-center" role="alert">
                <p className="text-destructive">{currentError}</p>
                <Button type="button" variant="outline" onClick={loadTransactions}>重新加载</Button>
              </div>
            ) : filteredTransactions.length === 0 && hasAnyTransactions === false ? (
              <div className="text-center py-12 text-muted-foreground">
                <div className="text-5xl mb-4">💰</div>
                <p className="text-lg font-medium mb-2">暂无交易记录</p>
                <p className="text-sm mb-4">开始记录您的第一笔交易吧</p>
                <Button variant="outline" onClick={() => setIsAddModalOpen(true)}>
                  <Plus className="h-4 w-4" />
                  添加第一笔记录
                </Button>
              </div>
            ) : filteredTransactions.length === 0 ? (
              <div className="space-y-3 p-8 text-center text-muted-foreground">
                <p className="font-medium">当前筛选没有匹配的记录</p>
                <p className="text-sm">试试其他关键词或日期范围。</p>
                <Button type="button" variant="outline" onClick={clearFilters}>重置筛选，查看本月</Button>
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
                    {dailyGroups.map((day) => <tbody key={day.date}>
                      <tr className="bg-muted/70 border-b">
                        <th colSpan={8} scope="rowgroup" className="p-4 text-left">
                          <div className="flex items-center justify-between gap-3">
                            <span>{day.date}</span>
                            <span className="text-xs font-normal text-muted-foreground">收入 {showIncome ? formatCurrency(day.income) : "****"} · 支出 {formatCurrency(day.expense)}</span>
                          </div>
                        </th>
                      </tr>
                      {day.transactions.map((transaction) => (
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
                    </tbody>)}
                  </table>
                </div>

                {/* 移动端卡片视图 */}
                <div className="md:hidden">
                  {dailyGroups.map((day) => <section key={day.date} aria-label={`${day.date}的交易`}>
                    <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/70 px-4 py-3">
                      <h3 className="text-sm font-semibold">{day.date}</h3>
                      <p className="text-xs text-muted-foreground">收入 {showIncome ? formatCurrency(day.income) : "****"} · 支出 {formatCurrency(day.expense)}</p>
                    </div>
                    <div className="divide-y">
                  {day.transactions.map((transaction) => (
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
                  </section>)}
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
            if (open) setIsEditModalOpen(true);
            else if (editCloseRef.current) void editCloseRef.current();
            else { setIsEditModalOpen(false); setSelectedTransaction(null); }
          }}
        >
          <TransactionModal
            key={selectedTransaction.id} // 使用 key 确保每次编辑不同记录时重新挂载组件
            mode="edit"
            isOpen={isEditModalOpen}
            closeGuardRef={editCloseRef}
            onCategoryCreated={onCategoryCreated}
            onSaved={loadTransactions}
            transaction={selectedTransaction}
            categories={categories}
            members={members}
            membersStatus={membersStatus}
            onRetryMembers={retryMembers}
            onManageMembers={() => router.push("/dashboard/members")}
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
              确定要删除这条交易记录吗？此操作无法撤销。关联的台账记录会保留，收支关联将解除。
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
  membersStatus,
  onRetryMembers,
  onManageMembers,
  onClose,
  onSaved,
  isOpen,
  closeGuardRef,
  onCategoryCreated,
}: {
  closeGuardRef: React.MutableRefObject<(() => Promise<boolean>) | null>;
  onCategoryCreated: (category: Category) => void;
  mode: "add" | "edit";
  isOpen: boolean;
  onSaved: () => void;
  transaction?: Transaction;
  categories: Category[];
  members: Member[];
  membersStatus: "loading" | "ready" | "error";
  onRetryMembers: () => void;
  onManageMembers: () => void;
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
  const [baseline, setBaseline] = useState(() => JSON.stringify(initial));
  const [showOptional, setShowOptional] = useState(() => !!(
    transaction?.description || transaction?.attachment_key
  ));
  const amountRef = useRef<HTMLInputElement>(null);
  const attachmentRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [pendingCategory, setPendingCategory] = useState(false);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const draft = useFormDraft({
    scope: mode === "add" ? "transaction:new" : `transaction:${transaction?.id}`,
    value: formData,
    onRestore: (value) => {
      setFormData(value);
      if (value.description) setShowOptional(true);
    },
    dirty: JSON.stringify(formData) !== baseline,
    enabled: isOpen,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [removeExistingAttachment, setRemoveExistingAttachment] = useState(false);

  const { requestClose } = useFormLeaveGuard({
    draft: { needsProtection: draft.needsProtection || pendingCategory },
    hasPendingFiles: !!attachment || removeExistingAttachment,
    isBusy: isSubmitting || isUploading || creatingCategory,
  });
  useEffect(() => {
    const guard = () => requestClose(() => onClose(false));
    closeGuardRef.current = guard;
    return () => { if (closeGuardRef.current === guard) closeGuardRef.current = null; };
  }, [closeGuardRef, onClose, requestClose]);

  const needsMember = mode === "add" && (membersStatus !== "ready" || !members.some((member) => member.id === formData.member_id));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current || creatingCategory) return;
    if (pendingCategory) {
      toast.error("请先添加分类或取消新增分类，再保存交易");
      return;
    }
    if (needsMember) {
      toast.error("请选择有效的家庭成员后再保存");
      return;
    }
    const keepOpen = mode === "add" && (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "continue";
    submittingRef.current = true;
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
        setUploadProgress(0);
        const safeName = attachment.name.replace(/[^\w.\-() ]+/g, "_");
        const pathname = `transactions/${Date.now()}_${safeName}`;
        const blob = await upload(pathname, attachment, {
          access: "public",
          handleUploadUrl: "/api/blob/upload",
          contentType: attachment.type || undefined,
          onUploadProgress: ({ percentage }) => setUploadProgress(Math.round(percentage)),
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
          description: formData.description || null,
          category_id: formData.category_id || null,
          member_id: formData.member_id || null,
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

      draft.clear();
      if (keepOpen) {
        const next = { ...formData, amount: "", description: "" };
        setFormData(next);
        setBaseline(JSON.stringify(next));
        setAttachment(null);
        setRemoveExistingAttachment(false);
        setUploadProgress(0);
        if (attachmentRef.current) attachmentRef.current.value = "";
        onSaved();
        toast.success("已保存，继续记下一笔");
        amountRef.current?.focus();
      } else {
        onClose(true);
      }
    } catch (error) {
      console.error(mode === "add" ? "创建交易记录失败:" : "更新交易记录失败:", error);
      toast.error(error instanceof Error ? error.message : "操作失败，请重试");
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
      setIsUploading(false);
    }
  };

  const hasExistingAttachment = !!transaction?.attachment_key;

  return (
    <DialogContent className="sm:max-w-[500px]">
      <DialogHeader>
        <DialogTitle>{mode === "add" ? "快速记一笔" : "编辑交易记录"}</DialogTitle>
        <DialogDescription>
          {mode === "add" ? "填写金额并选择家庭成员，备注与附件可稍后补充" : "修改交易详情"}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
        <DialogBody className="space-y-4 py-4">
        <DraftNotice draft={draft} />
        <div className="space-y-2 rounded-lg border bg-muted/30 p-4">
          <Label htmlFor={`${idPrefix}amount`}>金额（元） *</Label>
          <Input ref={amountRef} id={`${idPrefix}amount`} type="number" step="0.01" min="0.01"
            inputMode="decimal" autoFocus placeholder="0.00" className="h-14 text-3xl font-semibold md:text-3xl"
            value={formData.amount} onChange={(event) => setFormData({ ...formData, amount: event.target.value })} required />
        </div>
        <div className="flex gap-2" role="group" aria-label="收支类型">
          {(["expense", "income"] as const).map((type) => (
            <Button key={type} type="button" className="flex-1" variant={formData.type === type ? "default" : "outline"}
              aria-pressed={formData.type === type} disabled={isSubmitting || isUploading || creatingCategory}
              onClick={() => setFormData({ ...formData, type, category_id: formData.type === type ? formData.category_id : "" })}>
              {type === "expense" ? "支出" : "收入"}
            </Button>
          ))}
        </div>

        <TransactionCategoryPicker id={`${idPrefix}category`} type={formData.type} categories={categories}
          value={formData.category_id} disabled={isSubmitting || isUploading}
          onChange={(category_id) => setFormData((current) => ({ ...current, category_id }))}
          onCreated={(category) => {
            onCategoryCreated(category);
            setFormData((current) => current.type === category.type ? { ...current, category_id: category.id } : current);
          }}
          onPendingChange={(pending, busy) => { setPendingCategory(pending); setCreatingCategory(busy); }} />

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
          <Label htmlFor={`${idPrefix}member`}>家庭成员{mode === "add" ? " *" : "（可选）"}</Label>
          <Select
            value={formData.member_id || (mode === "add" ? "" : "__none__")}
            onValueChange={(value) => setFormData({ ...formData, member_id: value === "__none__" ? "" : value })}
            required={mode === "add"}
            disabled={membersStatus !== "ready" || members.length === 0 || isSubmitting || isUploading}
          >
            <SelectTrigger id={`${idPrefix}member`} aria-describedby={`${idPrefix}member-help`}>
              <SelectValue placeholder={membersStatus === "loading" ? "正在加载成员…" : "请选择家庭成员"} />
            </SelectTrigger>
            <SelectContent>
              {mode === "edit" ? <SelectItem value="__none__">不指定成员</SelectItem> : null}
              {members.map((member) => (
                <SelectItem key={member.id} value={member.id}>
                  {member.avatar} {member.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div id={`${idPrefix}member-help`} className="text-sm text-muted-foreground" aria-live="polite">
            {membersStatus === "error" ? <>
              家庭成员加载失败。
              <Button type="button" variant="link" className="h-auto px-1 py-0" onClick={onRetryMembers}>重新加载</Button>
            </> : membersStatus === "ready" && members.length === 0 ? <>
              暂无家庭成员，请先添加成员再记账。
              <Button type="button" variant="link" className="h-auto px-1 py-0"
                onClick={() => { void requestClose(onManageMembers); }}>添加家庭成员</Button>
            </> : membersStatus === "ready" && needsMember ? "请选择家庭成员后保存。" : null}
          </div>
        </div>

        <Button type="button" variant="ghost" className="w-full justify-between"
          aria-expanded={showOptional} aria-controls={`${idPrefix}optional-fields`}
          onClick={() => setShowOptional((open) => !open)}>
          备注与附件（可选）
          {showOptional ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
        <div id={`${idPrefix}optional-fields`} hidden={!showOptional} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}description`}>备注</Label>
          <Input
            id={`${idPrefix}description`}
            type="text"
            placeholder="如午餐、超市采购（可选）"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
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
            ref={attachmentRef}
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
                onClick={() => { setAttachment(null); if (attachmentRef.current) attachmentRef.current.value = ""; }}
                disabled={isSubmitting || isUploading}
              >
                移除
              </Button>
            </div>
          ) : null}
        </div>
        </div>
        {isUploading ? <div className="space-y-1" role="status">
          <p className="text-sm text-muted-foreground">附件上传中 {uploadProgress}%</p>
          <progress className="w-full" max={100} value={uploadProgress} aria-label="附件上传进度" />
        </div> : null}
        </DialogBody>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => { void requestClose(() => onClose(false)); }}
            disabled={isSubmitting || isUploading}
          >
            取消
          </Button>
          <Button type="submit" name="action" value="save" disabled={isSubmitting || isUploading || creatingCategory || needsMember}>
            {isSubmitting || isUploading ? "保存中..." : "保存"}
          </Button>
          {mode === "add" ? <Button type="submit" name="action" value="continue" variant="outline" disabled={isSubmitting || isUploading || creatingCategory || needsMember}>
            保存并继续
          </Button> : null}
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
