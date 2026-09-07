"use client";

import { TransactionLinksProvider, TransactionLinkButton } from "@/components/transactions/transaction-link";
import { useFormLeaveGuard } from "@/hooks/use-form-leave-guard";
import { useFormDraft } from "@/hooks/use-form-draft";
import { DraftNotice } from "@/components/ui/draft-notice";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import { useConfirm } from "@/hooks/use-confirm";
import { upload } from "@/lib/upload";
import {
  Plus,
  Paperclip,
  Trash2,
  Edit,
  List,
  HandCoins,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import type {
  LoanDirection,
  LoanRepayment,
  LoanStatus,
  LoanSubjectType,
  LoanWithComputed,
} from "@/types";
import { useRouter } from "next/navigation";

function formatQty(q: number) {
  const s = String(q);
  return s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

function statusLabel(s: LoanStatus) {
  if (s === "unpaid") return "未还";
  if (s === "partial") return "部分";
  return "结清";
}

type FormCloseGuard = (onClose: () => void) => Promise<boolean>;
type RegisterCloseGuard = (guard: FormCloseGuard) => () => void;

function useFormCloseBridge() {
  const guardRef = useRef<FormCloseGuard | null>(null);
  const register = useCallback((guard: FormCloseGuard) => {
    guardRef.current = guard;
    return () => { if (guardRef.current === guard) guardRef.current = null; };
  }, []);
  const close = useCallback((onClose: () => void) => {
    if (guardRef.current) void guardRef.current(onClose);
    else onClose();
  }, []);
  return { register, close };
}

export default function LoansPage() {
  const loanClose = useFormCloseBridge();
  const repaymentClose = useFormCloseBridge();
  const router = useRouter();
  const { confirm } = useConfirm();

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loans, setLoans] = useState<LoanWithComputed[]>([]);
  const [statusFilter, setStatusFilter] = useState<"open" | "all" | "settled">("open");

  const [previewAttachment, setPreviewAttachment] = useState<{
    url: string;
    name?: string;
    type?: string;
  } | null>(null);

  const [isLoanModalOpen, setIsLoanModalOpen] = useState(false);
  const [loanModalMode, setLoanModalMode] = useState<"add" | "edit">("add");
  const [editingLoan, setEditingLoan] = useState<LoanWithComputed | null>(null);
  const [loanModalDefaultDirection, setLoanModalDefaultDirection] =
    useState<LoanDirection>("owed");

  const [isRepaymentModalOpen, setIsRepaymentModalOpen] = useState(false);
  const [repaymentModalMode, setRepaymentModalMode] = useState<"add" | "edit">(
    "add"
  );
  const [repaymentLoan, setRepaymentLoan] = useState<LoanWithComputed | null>(
    null
  );
  const [editingRepayment, setEditingRepayment] = useState<LoanRepayment | null>(
    null
  );

  const [isRepaymentsListOpen, setIsRepaymentsListOpen] = useState(false);
  const [repaymentsLoan, setRepaymentsLoan] = useState<LoanWithComputed | null>(
    null
  );
  const [repayments, setRepayments] = useState<LoanRepayment[]>([]);
  const [repaymentsLoading, setRepaymentsLoading] = useState(false);
  const [repaymentsError, setRepaymentsError] = useState<string | null>(null);

  const loadLoans = () => {
    return fetch("/api/loans")
      .then(async (res) => {
        if (!res.ok) {
          if (res.status === 401) {
            router.push("/login");
            return;
          }
          throw new Error("获取欠款/借款失败");
        }
        const result = await res.json();
        setLoans(result.data || []);
        setLoadError(null);
      })
      .catch((e: unknown) => {
        console.error("加载欠款/借款失败:", e);
        setLoadError(e instanceof Error ? e.message : "加载失败，请重试");
      })
      .finally(() => setIsLoading(false));
  };

  const loadRepayments = async (loanId: string) => {
    try {
      setRepaymentsLoading(true);
      setRepaymentsError(null);
      const res = await fetch(`/api/loans/${loanId}/repayments`);
      if (!res.ok) {
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "获取归还列表失败");
      }
      const result = await res.json();
      setRepayments(result.data || []);
    } catch (e) {
      console.error("加载归还列表失败:", e);
      setRepaymentsError(e instanceof Error ? e.message : "加载失败，请重试");
    } finally {
      setRepaymentsLoading(false);
    }
  };

  useEffect(() => {
    loadLoans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusCounts = {
    all: loans.length,
    open: loans.filter((loan) => loan.status !== "settled").length,
    settled: loans.filter((loan) => loan.status === "settled").length,
  };
  const { owedLoans, lentLoans, stats } = useMemo(() => {
    const visible = loans.filter((loan) => statusFilter === "all" ||
      (statusFilter === "settled" ? loan.status === "settled" : loan.status !== "settled"));
    const owed = visible.filter((l) => l.direction === "owed");
    const lent = visible.filter((l) => l.direction === "lent");

    const calc = (arr: LoanWithComputed[]) => {
      const moneyLoans = arr.filter((l) => l.subject_type === "money");
      const due = moneyLoans.reduce((sum, l) => sum + (l.amount || 0), 0);
      const remaining = moneyLoans.reduce(
        (sum, l) => sum + (l.remaining_amount || 0),
        0
      );
      return { due, remaining };
    };

    return {
      owedLoans: owed,
      lentLoans: lent,
      stats: {
        owed: calc(owed),
        lent: calc(lent),
      },
    };
  }, [loans, statusFilter]);

  const openAddLoan = (direction: LoanDirection) => {
    setLoanModalMode("add");
    setEditingLoan(null);
    setLoanModalDefaultDirection(direction);
    setIsLoanModalOpen(true);
  };

  const openEditLoan = (loan: LoanWithComputed) => {
    setLoanModalMode("edit");
    setEditingLoan(loan);
    setLoanModalDefaultDirection(loan.direction);
    setIsLoanModalOpen(true);
  };

  const handleDeleteLoan = async (loan: LoanWithComputed) => {
    const ok = await confirm({
      title: "删除记录",
      description: `将永久删除这条借还单、${loan.repayment_count} 条归还记录及相关附件。已关联收支会保留，仅解除关联。此操作无法撤销。`,
      confirmText: "删除",
      cancelText: "取消",
    });
    if (!ok) return;

    try {
      const res = await fetch(`/api/loans/${loan.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "删除失败");
      }
      toast.success("已删除");
      await loadLoans();
    } catch (e) {
      console.error("删除借还单失败:", e);
      toast.error(e instanceof Error ? e.message : "删除失败，请重试");
    }
  };

  const openAddRepayment = (loan: LoanWithComputed) => {
    setRepaymentModalMode("add");
    setRepaymentLoan(loan);
    setEditingRepayment(null);
    setIsRepaymentModalOpen(true);
  };

  const openEditRepayment = (loan: LoanWithComputed, r: LoanRepayment) => {
    setRepaymentModalMode("edit");
    setRepaymentLoan(loan);
    setEditingRepayment(r);
    setIsRepaymentModalOpen(true);
  };

  const openRepaymentsList = async (loan: LoanWithComputed) => {
    setRepaymentsLoan(loan);
    setIsRepaymentsListOpen(true);
    await loadRepayments(loan.id);
  };

  const handleDeleteRepayment = async (repayment: LoanRepayment) => {
    const ok = await confirm({
      title: "删除归还记录",
      description: "将永久删除这条归还记录及附件，借还单的已还与未还数会重新计算。已关联收支会保留，仅解除关联。此操作无法撤销。",
      confirmText: "删除",
      cancelText: "取消",
    });
    if (!ok) return;

    try {
      const res = await fetch(`/api/loan-repayments/${repayment.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "删除失败");
      }
      toast.success("已删除");
      if (repaymentsLoan) {
        await loadRepayments(repaymentsLoan.id);
      }
      await loadLoans();
    } catch (e) {
      console.error("删除归还记录失败:", e);
      toast.error(e instanceof Error ? e.message : "删除失败，请重试");
    }
  };

  const renderLoanContainer = ({
    title,
    direction,
    items,
  }: {
    title: string;
    direction: LoanDirection;
    items: LoanWithComputed[];
  }) => {
    const s = direction === "owed" ? stats.owed : stats.lent;

    return (
      <Card>
        <CardHeader className="border-b">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2">
                <HandCoins className="h-5 w-5 text-primary" />
                {title}
              </CardTitle>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span>
                  应还合计：{" "}
                  <span className="font-semibold text-foreground">
                    {formatCurrency(s.due)}
                  </span>
                </span>
                <span>
                  未还合计：{" "}
                  <span className="font-semibold text-foreground">
                    {formatCurrency(s.remaining)}
                  </span>
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">当前显示范围汇总，仅计金额；物品不折算。</p>
            </div>

            <Button onClick={() => openAddLoan(direction)}>
              <Plus className="h-4 w-4" />
              新增
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <div className="text-center py-12 text-muted-foreground">加载中...</div>
          ) : loadError ? (
              <div role="alert" className="space-y-3 px-4 py-10 text-center">
                <p className="text-sm text-destructive">{loadError}</p>
                <Button variant="outline" onClick={() => { setIsLoading(true); setLoadError(null); void loadLoans(); }}>重新加载</Button>
              </div>
            ) : items.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>{statusFilter === "settled" ? "暂无已结清记录" : statusFilter === "open" ? "暂无未结清记录" : "暂无记录"}</p>
              {loans.some((loan) => loan.direction === direction) && statusFilter !== "all" ? (
                <Button variant="outline" className="mt-3" onClick={() => setStatusFilter("all")}>查看全部记录</Button>
              ) : <p className="mt-2 text-sm">可点击右上角“新增”开始记录。</p>}
            </div>
          ) : (
            <>
              {/* PC：表格 */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-4 font-semibold text-sm text-muted-foreground">
                        对方
                      </th>
                      <th className="text-left p-4 font-semibold text-sm text-muted-foreground">
                        标的
                      </th>
                      <th className="text-right p-4 font-semibold text-sm text-muted-foreground">
                        应还
                      </th>
                      <th className="text-right p-4 font-semibold text-sm text-muted-foreground">
                        已还
                      </th>
                      <th className="text-right p-4 font-semibold text-sm text-muted-foreground">
                        未还
                      </th>
                      <th className="text-left p-4 font-semibold text-sm text-muted-foreground">
                        状态
                      </th>
                      <th className="text-left p-4 font-semibold text-sm text-muted-foreground">
                        日期
                      </th>
                      <th className="text-right p-4 font-semibold text-sm text-muted-foreground w-44">
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((l) => {
                      const isSettled = l.status === "settled";
                      const due =
                        l.subject_type === "money"
                          ? formatCurrency(l.amount || 0)
                          : `${l.item_name || "-"} ${formatQty(
                              l.item_quantity || 0
                            )}${l.item_unit || ""}`;
                      const repaid =
                        l.subject_type === "money"
                          ? formatCurrency(l.repaid_amount_total || 0)
                          : `${formatQty(l.repaid_quantity_total || 0)}${
                              l.item_unit || ""
                            }`;
                      const remaining =
                        l.subject_type === "money"
                          ? formatCurrency(l.remaining_amount || 0)
                          : `${formatQty(l.remaining_quantity || 0)}${
                              l.item_unit || ""
                            }`;

                      return (
                        <tr
                          key={l.id}
                          className={[
                            "border-b last:border-0 hover:bg-accent/50 transition-colors",
                            isSettled ? "text-muted-foreground line-through" : "",
                          ].join(" ")}
                        >
                          <td className="p-4 font-medium"><div>{l.counterparty_name}</div><div className="mt-1"><TransactionLinkButton sourceId={l.id} label={`${l.counterparty_name}的借还记录`} /></div></td>
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <span className="truncate max-w-[260px]">{due}</span>
                              {l.attachment_key ? (
                                <button
                                  type="button"
                                  className="text-muted-foreground hover:text-foreground"
                                  onClick={() =>
                                    setPreviewAttachment({
                                      url: l.attachment_key!,
                                      name: l.attachment_name || "附件",
                                      type: l.attachment_type || undefined,
                                    })
                                  }
                                  aria-label="预览附件"
                                >
                                  <Paperclip className="h-4 w-4" />
                                </button>
                              ) : null}
                            </div>
                            {l.notes ? (
                              <div className="mt-1 text-xs text-muted-foreground truncate max-w-[360px]">
                                备注：{l.notes}
                              </div>
                            ) : null}
                          </td>
                          <td className="p-4 text-right">
                            {l.subject_type === "money"
                              ? formatCurrency(l.amount || 0)
                              : `${formatQty(l.item_quantity || 0)}${l.item_unit || ""}`}
                          </td>
                          <td className="p-4 text-right">{repaid}</td>
                          <td className="p-4 text-right">{remaining}</td>
                          <td className="p-4">
                            <Badge variant="outline" className="font-normal">
                              {statusLabel(l.status)}
                            </Badge>
                          </td>
                          <td className="p-4 text-sm text-muted-foreground">
                            {formatDate(l.occurred_at)}
                          </td>
                          <td className="p-4">
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openAddRepayment(l)}
                              >
                                归还
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openRepaymentsList(l)}
                              >
                                <List className="h-4 w-4" />
                                {l.repayment_count}
                              </Button>
                              <Button
                                variant="outline"
                                size="icon"
                                onClick={() => openEditLoan(l)}
                                aria-label="编辑"
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="outline"
                                size="icon"
                                onClick={() => handleDeleteLoan(l)}
                                aria-label="删除"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile：卡片 */}
              <div className="md:hidden divide-y">
                {items.map((l) => {
                  const isSettled = l.status === "settled";
                  const subject =
                    l.subject_type === "money"
                      ? formatCurrency(l.amount || 0)
                      : `${l.item_name || "-"} ${formatQty(
                          l.item_quantity || 0
                        )}${l.item_unit || ""}`;
                  const remaining =
                    l.subject_type === "money"
                      ? formatCurrency(l.remaining_amount || 0)
                      : `${formatQty(l.remaining_quantity || 0)}${l.item_unit || ""}`;
                  return (
                    <div
                      key={l.id}
                      className={[
                        "p-4 space-y-3",
                        isSettled ? "text-muted-foreground line-through" : "",
                      ].join(" ")}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold truncate">{l.counterparty_name}</div>
                          <div className="mt-1"><TransactionLinkButton sourceId={l.id} label={`${l.counterparty_name}的借还记录`} /></div>
                          <div className="text-sm leading-6 text-muted-foreground mt-1 truncate">
                            {subject}
                          </div>
                          {l.notes ? (
                            <div className="text-sm leading-6 text-muted-foreground mt-1 truncate">
                              备注：{l.notes}
                            </div>
                          ) : null}
                        </div>
                        <Badge variant="outline" className="font-normal shrink-0">
                          {statusLabel(l.status)}
                        </Badge>
                      </div>

                      <div className="flex items-center justify-between text-sm">
                        <div className="text-muted-foreground">
                          未还：<span className="text-foreground font-semibold">{remaining}</span>
                        </div>
                        <div className="text-muted-foreground">{formatDate(l.occurred_at)}</div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={() => openAddRepayment(l)}>
                          归还
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openRepaymentsList(l)}
                        >
                          <List className="h-4 w-4" />
                          归还 {l.repayment_count} 次
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => openEditLoan(l)}>
                          <Edit className="h-4 w-4" />
                          编辑
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleDeleteLoan(l)}>
                          <Trash2 className="h-4 w-4" />
                          删除
                        </Button>
                        {l.attachment_key ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setPreviewAttachment({
                                url: l.attachment_key!,
                                name: l.attachment_name || "附件",
                                type: l.attachment_type || undefined,
                              })
                            }
                          >
                            <Paperclip className="h-4 w-4" />
                            附件
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <DashboardLayout>
      <TransactionLinksProvider sourceType="loan" sourceIds={loans.map((record) => record.id)}>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">借还</h1>
            <p className="text-sm leading-6 text-muted-foreground mt-1">
              区分我欠别人、别人欠我，记录每次归还。借还台账不自动进入收支统计。
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap gap-2" aria-label="借还状态筛选">
            {([['open', '未结清'], ['all', '全部'], ['settled', '已结清']] as const).map(([value, label]) => (
              <Button key={value} variant={statusFilter === value ? "default" : "outline"}
                aria-pressed={statusFilter === value} onClick={() => setStatusFilter(value)}>
                {label}（{statusCounts[value]}）
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">默认显示未结清；已结清记录保留在“全部”和“已结清”中。</p>
        </div>
        <div className="grid grid-cols-1 gap-6">
          {renderLoanContainer({ title: "我欠别人", direction: "owed", items: owedLoans })}
          {renderLoanContainer({ title: "别人欠我", direction: "lent", items: lentLoans })}
        </div>

        {/* 借还单弹框 */}
        <Dialog open={isLoanModalOpen} onOpenChange={(open) => { if (open) setIsLoanModalOpen(true); else loanClose.close(() => setIsLoanModalOpen(false)); }}>
          <DialogTrigger asChild>
            {/* 占位：外部按钮触发，这里不渲染 */}
            <span />
          </DialogTrigger>
          {isLoanModalOpen ? (
            <LoanModal
              registerCloseGuard={loanClose.register}
              key={[
                loanModalMode,
                editingLoan?.id || "new",
                loanModalDefaultDirection,
              ].join(":")}
              mode={loanModalMode}
              defaultDirection={loanModalDefaultDirection}
              loan={editingLoan || undefined}
              onClose={(refresh) => {
                setIsLoanModalOpen(false);
                if (refresh) loadLoans();
              }}
            />
          ) : null}
        </Dialog>

        {/* 归还弹框 */}
        <Dialog open={isRepaymentModalOpen} onOpenChange={(open) => { if (open) setIsRepaymentModalOpen(true); else repaymentClose.close(() => setIsRepaymentModalOpen(false)); }}>
          <DialogTrigger asChild>
            <span />
          </DialogTrigger>
          {isRepaymentModalOpen && repaymentLoan ? (
            <RepaymentModal
              registerCloseGuard={repaymentClose.register}
              key={[repaymentModalMode, editingRepayment?.id || "new", repaymentLoan.id].join(
                ":"
              )}
              mode={repaymentModalMode}
              loan={loans.find((loan) => loan.id === repaymentLoan.id) || repaymentLoan}
              repayment={editingRepayment || undefined}
              onClose={async (refresh) => {
                setIsRepaymentModalOpen(false);
                if (refresh) {
                  if (repaymentsLoan) await loadRepayments(repaymentsLoan.id);
                  await loadLoans();
                }
              }}
              onPreviewAttachment={(a) => setPreviewAttachment(a)}
            />
          ) : null}
        </Dialog>

        {/* 归还列表弹框 */}
        <Dialog open={isRepaymentsListOpen} onOpenChange={setIsRepaymentsListOpen}>
          <DialogTrigger asChild>
            <span />
          </DialogTrigger>
          {repaymentsLoan ? (
            <DialogContent className="sm:max-w-[720px]">
              <DialogHeader>
                <DialogTitle>归还列表</DialogTitle>
                <DialogDescription className="flex flex-col gap-1">
                  <span>
                    {repaymentsLoan.counterparty_name} ·{" "}
                    {repaymentsLoan.subject_type === "money"
                      ? formatCurrency(repaymentsLoan.amount || 0)
                      : `${repaymentsLoan.item_name || "-"} ${formatQty(
                          repaymentsLoan.item_quantity || 0
                        )}${repaymentsLoan.item_unit || ""}`}
                  </span>
                  {repaymentsLoan.notes ? (
                    <span className="text-muted-foreground truncate">
                      备注：{repaymentsLoan.notes}
                    </span>
                  ) : null}
                </DialogDescription>
              </DialogHeader>

              <DialogBody className="space-y-4">
                <TransactionLinksProvider sourceType="repayment" sourceIds={repayments.map((record) => record.id)}>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm text-muted-foreground">
                    共 {repaymentsLoan.repayment_count} 次
                  </div>
                  <Button
                    onClick={() => {
                      setIsRepaymentsListOpen(false);
                      openAddRepayment(repaymentsLoan);
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    新增归还
                  </Button>
                </div>

                <div className="border rounded-md overflow-hidden">
                  {repaymentsLoading ? (
                    <div className="text-center py-10 text-muted-foreground">加载中...</div>
                   ) : repaymentsError ? (
                    <div role="alert" className="space-y-3 px-4 py-10 text-center">
                      <p className="text-sm text-destructive">{repaymentsError}</p>
                      <Button variant="outline" onClick={() => loadRepayments(repaymentsLoan.id)}>重新加载</Button>
                    </div>
                  ) : repayments.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground">
                      暂无归还记录
                    </div>
                  ) : (
                    <div className="divide-y">
                      {repayments.map((r) => {
                        const value =
                          repaymentsLoan.subject_type === "money"
                            ? formatCurrency(r.repaid_amount || 0)
                            : `${formatQty(r.repaid_quantity || 0)}${
                                repaymentsLoan.item_unit || ""
                              }`;
                        return (
                          <div key={r.id} className="p-4 flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="font-medium">
                                {formatDate(r.repaid_at)} · {value}
                              </div>
                              <div className="mt-1"><TransactionLinkButton sourceId={r.id} label={`${repaymentsLoan.counterparty_name}的归还记录`} /></div>
                              {r.notes ? (
                                <div className="text-sm leading-6 text-muted-foreground mt-1 break-words">
                                  {r.notes}
                                </div>
                              ) : null}
                              {r.attachment_key ? (
                                <button
                                  type="button"
                                  className="mt-2 inline-flex items-center gap-2 text-sm text-primary hover:underline"
                                  onClick={() =>
                                    setPreviewAttachment({
                                      url: r.attachment_key!,
                                      name: r.attachment_name || "附件",
                                      type: r.attachment_type || undefined,
                                    })
                                  }
                                >
                                  <Paperclip className="h-4 w-4" />
                                  查看附件
                                </button>
                              ) : null}
                            </div>

                            <div className="shrink-0 flex items-center gap-2">
                              <Button
                                variant="outline"
                                size="icon"
                                onClick={() => {
                                  setIsRepaymentsListOpen(false);
                                  openEditRepayment(repaymentsLoan, r);
                                }}
                                aria-label="编辑归还"
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="outline"
                                size="icon"
                                onClick={() => handleDeleteRepayment(r)}
                                aria-label="删除归还"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                              </TransactionLinksProvider>
              </DialogBody>

              <DialogFooter>
                <Button variant="outline" onClick={() => setIsRepaymentsListOpen(false)}>
                  关闭
                </Button>
              </DialogFooter>
            </DialogContent>
          ) : null}
        </Dialog>

        {/* 附件预览弹框（复用交易记录体验） */}
        <Dialog open={!!previewAttachment} onOpenChange={() => setPreviewAttachment(null)}>
          <DialogContent className="sm:max-w-[900px]">
            <DialogHeader>
              <DialogTitle>附件预览</DialogTitle>
              <DialogDescription>{previewAttachment?.name}</DialogDescription>
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
      </div>
      </TransactionLinksProvider>
    </DashboardLayout>
  );
}

function LoanModal({
  registerCloseGuard,
  mode,
  defaultDirection,
  loan,
  onClose,
}: {
  registerCloseGuard: RegisterCloseGuard;
  mode: "add" | "edit";
  defaultDirection: LoanDirection;
  loan?: LoanWithComputed;
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
    if (mode === "edit" && loan) {
      return {
        direction: loan.direction,
        subject_type: loan.subject_type,
        counterparty_name: loan.counterparty_name,
        occurred_at: formatDateForInput(loan.occurred_at),
        amount: loan.amount != null ? String(loan.amount) : "",
        item_name: loan.item_name || "",
        item_quantity: loan.item_quantity != null ? String(loan.item_quantity) : "",
        item_unit: loan.item_unit || "",
        notes: loan.notes || "",
      };
    }
    return {
      direction: defaultDirection,
      subject_type: "money" as LoanSubjectType,
      counterparty_name: "",
      occurred_at: getTodayDate(),
      amount: "",
      item_name: "",
      item_quantity: "",
      item_unit: "",
      notes: "",
    };
  })();

  const [formData, setFormData] = useState(initial);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [removeExistingAttachment, setRemoveExistingAttachment] = useState(false);

  // The parent keys this form by mode and record, so each opening starts fresh.


  const [initialSnapshot] = useState(() => JSON.stringify(formData));
  const draft = useFormDraft({
    scope: `loans:${mode === "edit" ? loan?.id : `new:${defaultDirection}`}`,
    value: formData,
    dirty: JSON.stringify(formData) !== initialSnapshot,
    enabled: true,
    onRestore: (restored) => {
      setFormData(restored);
      setSubmitError(null);
      setAttachment(null);
      setRemoveExistingAttachment(false);
    },
  });

  const { requestClose } = useFormLeaveGuard({
    draft,
    isBusy: isSubmitting || isUploading,
    hasPendingFiles: !!attachment,
  });
  useEffect(() => registerCloseGuard(requestClose), [registerCloseGuard, requestClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitError(null);

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

        setUploadProgress(0);
        setIsUploading(true);
        const safeName = attachment.name.replace(/[^\w.\-() ]+/g, "_");
        const pathname = `loans/${Date.now()}_${safeName}`;
        const blob = await upload(pathname, attachment, {
          access: "public",
          handleUploadUrl: "/api/blob/upload",
          contentType: attachment.type || undefined,
          onUploadProgress: ({ percentage }) => setUploadProgress(percentage),
        });
        setIsUploading(false);
        attachment_key = blob.url;
        attachment_name = attachment.name;
        attachment_type = blob.contentType || attachment.type || undefined;
      } else {
        attachment_key = undefined;
        attachment_name = undefined;
        attachment_type = undefined;
      }

      const url = mode === "add" ? "/api/loans" : `/api/loans/${loan?.id}`;
      const method = mode === "add" ? "POST" : "PATCH";

      const payload: Record<string, unknown> = {
        direction: formData.direction,
        subject_type: formData.subject_type,
        counterparty_name: formData.counterparty_name,
        occurred_at: formData.occurred_at,
        notes: formData.notes || null,
        attachment_key,
        attachment_name,
        attachment_type,
      };

      if (formData.subject_type === "money") {
        payload.amount = parseFloat(formData.amount);
      } else {
        payload.item_name = formData.item_name;
        payload.item_quantity = parseFloat(formData.item_quantity);
        payload.item_unit = formData.item_unit;
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || (mode === "add" ? "创建失败" : "更新失败"));
      }

      toast.success(mode === "add" ? "已新增" : "已更新");
      draft.clear();
      onClose(true);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "保存失败，请重试");
      console.error("保存借还单失败:", e);
      toast.error(e instanceof Error ? e.message : "操作失败，请重试");
    } finally {
      setIsSubmitting(false);
      setIsUploading(false);
    }
  };

  const hasExistingAttachment = !!loan?.attachment_key;

  return (
    <DialogContent className="sm:max-w-[560px]">
      <DialogHeader>
        <DialogTitle>{mode === "add" ? "新增欠款/借款" : "编辑欠款/借款"}</DialogTitle>
        <DialogDescription>
          {mode === "add" ? "填写借还信息，后续可多次记录归还" : "修改借还信息"}
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
        <DialogBody className="space-y-4 py-4">
          <DraftNotice draft={draft} />
          {submitError && <p role="alert" className="text-sm text-destructive">{submitError}</p>}
          <p className="text-xs text-muted-foreground">草稿不保存附件，恢复后请重新选择。</p>
          {isUploading && (
            <div className="space-y-1" role="status" aria-live="polite">
              <p className="text-sm text-muted-foreground">附件上传 {Math.round(uploadProgress)}%</p>
              <progress aria-label="附件上传进度" max={100} value={uploadProgress} className="w-full" />
            </div>
          )}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}direction`}>类型 *</Label>
            <Select
              value={formData.direction}
              onValueChange={(v) =>
                setFormData({ ...formData, direction: v as LoanDirection })
              }
            >
              <SelectTrigger id={`${idPrefix}direction`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="owed">我欠别人</SelectItem>
                <SelectItem value="lent">别人欠我</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}subject_type`}>标的 *</Label>
            <Select
              value={formData.subject_type}
              onValueChange={(v) =>
                setFormData({
                  ...formData,
                  subject_type: v as LoanSubjectType,
                  amount: "",
                  item_name: "",
                  item_quantity: "",
                  item_unit: "",
                })
              }
              disabled={mode === "edit" && (loan?.repayment_count || 0) > 0}
            >
              <SelectTrigger id={`${idPrefix}subject_type`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="money">金额（CNY）</SelectItem>
                <SelectItem value="item">物品</SelectItem>
              </SelectContent>
            </Select>
            {mode === "edit" && (loan?.repayment_count || 0) > 0 ? (
              <div className="text-xs text-muted-foreground">
                已有归还记录时不允许修改标的类型
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}counterparty`}>对方 *</Label>
            <Input
              id={`${idPrefix}counterparty`}
              value={formData.counterparty_name}
              onChange={(e) =>
                setFormData({ ...formData, counterparty_name: e.target.value })
              }
              placeholder="例如：张三"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}occurred_at`}>发生日期 *</Label>
            <Input
              id={`${idPrefix}occurred_at`}
              type="date"
              value={formData.occurred_at}
              onChange={(e) => setFormData({ ...formData, occurred_at: e.target.value })}
              required
            />
          </div>
        </div>

        {formData.subject_type === "money" ? (
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}amount`}>金额（CNY） *</Label>
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
        ) : (
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2 col-span-1">
              <Label htmlFor={`${idPrefix}item_name`}>物品名称 *</Label>
              <Input
                id={`${idPrefix}item_name`}
                value={formData.item_name}
                onChange={(e) => setFormData({ ...formData, item_name: e.target.value })}
                placeholder="例如：书"
                required
              />
            </div>
            <div className="space-y-2 col-span-1">
              <Label htmlFor={`${idPrefix}item_quantity`}>数量 *</Label>
              <Input
                id={`${idPrefix}item_quantity`}
                type="number"
                step="0.001"
                min="0.001"
                value={formData.item_quantity}
                onChange={(e) =>
                  setFormData({ ...formData, item_quantity: e.target.value })
                }
                required
              />
            </div>
            <div className="space-y-2 col-span-1">
              <Label htmlFor={`${idPrefix}item_unit`}>单位 *</Label>
              <Input
                id={`${idPrefix}item_unit`}
                value={formData.item_unit}
                onChange={(e) => setFormData({ ...formData, item_unit: e.target.value })}
                placeholder="例如：本/个/kg"
                required
              />
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}notes`}>备注</Label>
          <textarea
            id={`${idPrefix}notes`}
            className="min-h-[88px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="可记录借还原因、约定等"
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label>附件</Label>

          {mode === "edit" && hasExistingAttachment && loan?.attachment_key ? (
            <div className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">
                  {loan.attachment_name || "附件"}
                </div>
                <a
                  href={loan.attachment_key}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary hover:underline"
                >
                  打开附件
                </a>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`${idPrefix}removeAttachment`}
                  checked={removeExistingAttachment}
                  onCheckedChange={(v) => setRemoveExistingAttachment(!!v)}
                />
                <Label htmlFor={`${idPrefix}removeAttachment`} className="text-sm">
                  移除
                </Label>
              </div>
            </div>
          ) : null}

          <Input
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => {
              const f = e.target.files?.[0] || null;
              setAttachment(f);
            }}
            disabled={removeExistingAttachment}
          />
          <div className="text-xs text-muted-foreground">支持图片或 PDF，最大 10MB</div>
        </div>
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => requestClose(() => onClose(false))}>
            取消
          </Button>
          <Button type="submit" disabled={isSubmitting || isUploading}>
            {isUploading ? "上传中..." : isSubmitting ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function RepaymentModal({
  registerCloseGuard,
  mode,
  loan,
  repayment,
  onClose,
  onPreviewAttachment,
}: {
  registerCloseGuard: RegisterCloseGuard;
  mode: "add" | "edit";
  loan: LoanWithComputed;
  repayment?: LoanRepayment;
  onClose: (shouldRefresh?: boolean) => void;
  onPreviewAttachment: (a: { url: string; name?: string; type?: string }) => void;
}) {
  const idPrefix = mode === "edit" ? "edit-repayment-" : "repayment-";

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
    if (mode === "edit" && repayment) {
      return {
        repaid_at: formatDateForInput(repayment.repaid_at),
        repaid_value:
          loan.subject_type === "money"
            ? String(repayment.repaid_amount ?? "")
            : String(repayment.repaid_quantity ?? ""),
        notes: repayment.notes || "",
      };
    }
    return {
      repaid_at: getTodayDate(),
      repaid_value: "",
      notes: "",
    };
  })();

  const [formData, setFormData] = useState(initial);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [removeExistingAttachment, setRemoveExistingAttachment] = useState(false);

  const precision = loan.subject_type === "money" ? 2 : 3;
  const scale = 10 ** precision;
  const dueUnits = Math.round((loan.subject_type === "money" ? loan.amount || 0 : loan.item_quantity || 0) * scale);
  const totalUnits = Math.round((loan.subject_type === "money" ? loan.repaid_amount_total : loan.repaid_quantity_total) * scale);
  const previousUnits = mode === "edit" && repayment
    ? Math.round((loan.subject_type === "money" ? repayment.repaid_amount || 0 : repayment.repaid_quantity || 0) * scale)
    : 0;
  const otherUnits = Math.max(totalUnits - previousUnits, 0);
  const availableUnits = Math.max(dueUnits - otherUnits, 0);
  const rawValue = formData.repaid_value.trim();
  const validFormat = new RegExp(`^(?:\\d+(?:\\.\\d{0,${precision}})?|\\.\\d{1,${precision}})$`).test(rawValue);
  const enteredUnits = validFormat ? Math.round(Number(rawValue) * scale) : null;
  const valueError = rawValue && (!validFormat || enteredUnits === null || !Number.isSafeInteger(enteredUnits))
    ? `请输入最多 ${precision} 位小数的${loan.subject_type === "money" ? "金额" : "数量"}`
    : enteredUnits !== null && enteredUnits <= 0 ? "归还值必须大于 0"
    : enteredUnits !== null && enteredUnits > availableUnits ? "本次归还超出可归还余额，请核对后调整" : null;
  const remainingAfterUnits = availableUnits - (enteredUnits || 0);
  const displayValue = (units: number) => loan.subject_type === "money"
    ? `${formatCurrency(units / scale)} 元`
    : `${formatQty(units / scale)}${loan.item_unit || ""}`;

  // The parent keys this form by mode and record, so each opening starts fresh.


  const [initialSnapshot] = useState(() => JSON.stringify(formData));
  const draft = useFormDraft({
    scope: `loan-repayments:${loan.id}:${mode === "edit" ? repayment?.id : "new"}`,
    value: formData,
    dirty: JSON.stringify(formData) !== initialSnapshot,
    enabled: true,
    onRestore: (restored) => {
      setFormData(restored);
      setSubmitError(null);
      setAttachment(null);
      setRemoveExistingAttachment(false);
    },
  });

  const { requestClose } = useFormLeaveGuard({
    draft,
    isBusy: isSubmitting || isUploading,
    hasPendingFiles: !!attachment,
  });
  useEffect(() => registerCloseGuard(requestClose), [registerCloseGuard, requestClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      if (!rawValue || enteredUnits === null || valueError) {
        throw new Error(valueError || "请填写本次归还金额或数量");
      }
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

        setUploadProgress(0);
        setIsUploading(true);
        const safeName = attachment.name.replace(/[^\w.\-() ]+/g, "_");
        const pathname = `loan-repayments/${Date.now()}_${safeName}`;
        const blob = await upload(pathname, attachment, {
          access: "public",
          handleUploadUrl: "/api/blob/upload",
          contentType: attachment.type || undefined,
          onUploadProgress: ({ percentage }) => setUploadProgress(percentage),
        });
        setIsUploading(false);
        attachment_key = blob.url;
        attachment_name = attachment.name;
        attachment_type = blob.contentType || attachment.type || undefined;
      } else {
        attachment_key = undefined;
        attachment_name = undefined;
        attachment_type = undefined;
      }

      const url =
        mode === "add"
          ? `/api/loans/${loan.id}/repayments`
          : `/api/loan-repayments/${repayment?.id}`;
      const method = mode === "add" ? "POST" : "PATCH";

      const payload: Record<string, unknown> = {
        repaid_at: formData.repaid_at,
        notes: formData.notes || null,
        attachment_key,
        attachment_name,
        attachment_type,
      };

      if (loan.subject_type === "money") {
        payload.repaid_amount = parseFloat(formData.repaid_value);
      } else {
        payload.repaid_quantity = parseFloat(formData.repaid_value);
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || (mode === "add" ? "新增失败" : "更新失败"));
      }

      toast.success(mode === "add" ? "已记录归还" : "已更新归还");
      draft.clear();
      onClose(true);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "保存失败，请重试");
      console.error("保存归还记录失败:", e);
      toast.error(e instanceof Error ? e.message : "操作失败，请重试");
    } finally {
      setIsSubmitting(false);
      setIsUploading(false);
    }
  };

  const hasExistingAttachment = !!repayment?.attachment_key;

  return (
    <DialogContent className="sm:max-w-[520px]">
      <DialogHeader>
        <DialogTitle>{mode === "add" ? "新增归还" : "编辑归还"}</DialogTitle>
        <DialogDescription>
          {loan.counterparty_name} ·{" "}
          {loan.subject_type === "money"
            ? `应还 ${formatCurrency(loan.amount || 0)} / 未还 ${formatCurrency(
                loan.remaining_amount || 0
              )}`
            : `应还 ${formatQty(loan.item_quantity || 0)}${loan.item_unit || ""} / 未还 ${formatQty(
                loan.remaining_quantity || 0
              )}${loan.item_unit || ""}`}
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
        <DialogBody className="space-y-4 py-4">
          <DraftNotice draft={draft} />
          {submitError && <p role="alert" className="text-sm text-destructive">{submitError}</p>}
          <p className="text-xs text-muted-foreground">草稿不保存附件，恢复后请重新选择。</p>
          {isUploading && (
            <div className="space-y-1" role="status" aria-live="polite">
              <p className="text-sm text-muted-foreground">附件上传 {Math.round(uploadProgress)}%</p>
              <progress aria-label="附件上传进度" max={100} value={uploadProgress} className="w-full" />
            </div>
          )}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}repaid_at`}>归还日期 *</Label>
            <Input
              id={`${idPrefix}repaid_at`}
              type="date"
              value={formData.repaid_at}
              onChange={(e) => setFormData({ ...formData, repaid_at: e.target.value })}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}repaid_value`}>
              {loan.subject_type === "money" ? "归还金额（CNY） *" : "归还数量 *"}
            </Label>
            <Input
              id={`${idPrefix}repaid_value`}
              type="number"
              step={loan.subject_type === "money" ? "0.01" : "0.001"}
              min={loan.subject_type === "money" ? "0.01" : "0.001"}
              max={availableUnits / scale}
              aria-invalid={!!valueError}
              aria-describedby={`${idPrefix}balance`}
              value={formData.repaid_value}
              onChange={(e) => setFormData({ ...formData, repaid_value: e.target.value })}
              required
            />
          </div>
        </div>

        <div id={`${idPrefix}balance`} className="space-y-2 rounded-md border p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{mode === "edit" ? "扣除其他归还后，本条最多可记" : "当前可归还"}：{displayValue(availableUnits)}</span>
            <Button type="button" variant="outline" size="sm" disabled={availableUnits <= 0 || isSubmitting || isUploading}
              onClick={() => setFormData({ ...formData, repaid_value: String(availableUnits / scale) })}>
              填入剩余{loan.subject_type === "money" ? "金额" : "数量"}
            </Button>
          </div>
          {valueError ? <p role="alert" className="text-destructive">{valueError}</p> : (
            <p role="status">本次归还后剩余：{displayValue(remainingAfterUnits)}</p>
          )}
          {mode === "edit" && <p className="text-xs text-muted-foreground">计算时已扣除这条记录的原归还值，避免重复计入。</p>}
          {availableUnits === 0 && <p className="text-xs text-muted-foreground">当前无可归还余额，请先核对已有归还记录。</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}notes`}>备注</Label>
          <textarea
            id={`${idPrefix}notes`}
            className="min-h-[88px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="例如：转账、当面归还等"
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label>附件</Label>
          {mode === "edit" && hasExistingAttachment && repayment?.attachment_key ? (
            <div className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">
                  {repayment.attachment_name || "附件"}
                </div>
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() =>
                    onPreviewAttachment({
                      url: repayment.attachment_key!,
                      name: repayment.attachment_name || "附件",
                      type: repayment.attachment_type || undefined,
                    })
                  }
                >
                  预览附件
                </button>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`${idPrefix}removeAttachment`}
                  checked={removeExistingAttachment}
                  onCheckedChange={(v) => setRemoveExistingAttachment(!!v)}
                />
                <Label htmlFor={`${idPrefix}removeAttachment`} className="text-sm">
                  移除
                </Label>
              </div>
            </div>
          ) : null}

          <Input
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => setAttachment(e.target.files?.[0] || null)}
            disabled={removeExistingAttachment}
          />
          <div className="text-xs text-muted-foreground">支持图片或 PDF，最大 10MB</div>
        </div>
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => requestClose(() => onClose(false))}>
            取消
          </Button>
          <Button type="submit" disabled={isSubmitting || isUploading || !!valueError || availableUnits <= 0}>
            {isUploading ? "上传中..." : isSubmitting ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

