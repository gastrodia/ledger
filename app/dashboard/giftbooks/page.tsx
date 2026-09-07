"use client";

import { useFormLeaveGuard } from "@/hooks/use-form-leave-guard";
import { useFormDraft } from "@/hooks/use-form-draft";
import { DraftNotice } from "@/components/ui/draft-notice";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { Plus, BookHeart, CalendarDays, MapPin, Trash2, Pencil, ChevronRight, LogIn } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useConfirm } from "@/hooks/use-confirm";
import type { GiftBook, GiftBookSummary } from "@/types";

type GiftBookListItem = GiftBook & { summary?: GiftBookSummary };

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

export default function GiftBooksPage() {
  const createClose = useFormCloseBridge();
  const editClose = useFormCloseBridge();
  const router = useRouter();
  const { confirm } = useConfirm();

  const [giftbooks, setGiftbooks] = useState<GiftBookListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingGiftBook, setEditingGiftBook] = useState<GiftBookListItem | null>(null);

  const loadGiftBooks = async () => {
    try {
      setIsLoading(true);
      setLoadError(null);
      const res = await fetch("/api/giftbooks");
      if (!res.ok) {
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        throw new Error("获取礼簿失败");
      }
      const result = await res.json();
      setGiftbooks(result.data || []);
      setLoadError(null);
    } catch (e) {
      console.error("加载礼簿失败:", e);
      setLoadError("加载礼簿失败，请检查网络后重试。");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    fetch("/api/giftbooks")
      .then(async (res) => {
        if (res.status === 401) {
          if (active) router.push("/login");
          return;
        }
        if (!res.ok) throw new Error("获取礼簿失败");
        const result = await res.json();
        if (active) { setGiftbooks(result.data || []); setLoadError(null); }
      })
      .catch(() => {
        if (active) setLoadError("加载礼簿失败，请检查网络后重试。");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => { active = false; };
  }, [router]);

  const handleDelete = async (id: string) => {
    let recordCount = giftbooks.find((book) => book.id === id)?.summary?.recordCount;
    if (!Number.isSafeInteger(recordCount) || recordCount! < 0) {
      try {
        const details = await fetch(`/api/giftbooks/${id}`);
        if (!details.ok) throw new Error("无法核实礼簿记录数量，请稍后重试");
        const result = await details.json();
        recordCount = result.data?.summary?.recordCount;
        if (!Number.isSafeInteger(recordCount) || recordCount! < 0) throw new Error("无法核实礼簿记录数量，请稍后重试");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "无法核实删除范围");
        return;
      }
    }
    const ok = await confirm({
      title: "删除礼簿",
      description: `将永久删除本礼簿、${recordCount} 条礼金/礼品明细及相关附件。已关联收支会保留，仅解除关联。此操作无法撤销。`,
      confirmText: "删除",
      cancelText: "取消",
    });
    if (!ok) return;

    try {
      const res = await fetch(`/api/giftbooks/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "删除失败");
      }
      toast.success("礼簿已删除");
      await loadGiftBooks();
    } catch (e) {
      console.error("删除礼簿失败:", e);
      toast.error(e instanceof Error ? e.message : "删除失败，请重试");
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">礼簿</h1>
            <p className="text-muted-foreground mt-1">管理人情往来记录；每本汇总涵盖全部礼金与礼品明细，不自动进入收支统计。</p>
          </div>

          <Dialog open={isCreateOpen} onOpenChange={(open) => { if (open) setIsCreateOpen(true); else createClose.close(() => setIsCreateOpen(false)); }}>
            <DialogTrigger asChild>
              <Button className="w-full sm:w-auto">
                <Plus className="h-4 w-4" />
                新建礼簿
              </Button>
            </DialogTrigger>
            <CreateGiftBookModal
              enabled={isCreateOpen}
              registerCloseGuard={createClose.register}
              key={isCreateOpen ? "open" : "closed"}
              onClose={(refresh) => {
                setIsCreateOpen(false);
                if (refresh) loadGiftBooks();
              }}
            />
          </Dialog>
        </div>

        <Card>
          <CardHeader className="border-b">
            <CardTitle>我的礼簿</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="text-center py-12 text-muted-foreground">加载中...</div>
            ) : loadError ? (
              <div role="alert" className="space-y-3 px-4 py-10 text-center">
                <p className="text-sm text-destructive">{loadError}</p>
                <Button variant="outline" onClick={loadGiftBooks}>重新加载</Button>
              </div>
            ) : giftbooks.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <div className="text-5xl mb-4">📒</div>
                <p className="text-lg font-medium mb-2">还没有礼簿</p>
                <p className="text-sm mb-4">新建一个礼簿（例如：张三婚礼），再开始记礼</p>
                <Button variant="outline" onClick={() => setIsCreateOpen(true)}>
                  <Plus className="h-4 w-4" />
                  新建第一个礼簿
                </Button>
              </div>
            ) : (
              <>
                {/* PC：表格（进入 = 点礼簿名） */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-4 font-semibold text-sm text-muted-foreground">礼簿</th>
                        <th className="text-left p-4 font-semibold text-sm text-muted-foreground">日期 / 地点</th>
                        <th className="text-left p-4 font-semibold text-sm text-muted-foreground">类型</th>
                        <th className="text-right p-4 font-semibold text-sm text-muted-foreground">礼金合计</th>
                        <th className="text-right p-4 font-semibold text-sm text-muted-foreground">礼品估值</th>
                        <th className="text-right p-4 font-semibold text-sm text-muted-foreground">礼金/礼品明细数</th>
                        <th className="text-right p-4 font-semibold text-sm text-muted-foreground w-28">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {giftbooks.map((gb) => (
                        <tr
                          key={gb.id}
                          className="border-b last:border-0 hover:bg-accent/50 transition-colors"
                        >
                          <td className="p-4">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-muted shrink-0">
                                <BookHeart className="h-5 w-5 text-primary" />
                              </div>
                              <div className="min-w-0">
                                <Link
                                  href={`/dashboard/giftbooks/${gb.id}`}
                                  className="font-semibold truncate hover:underline block"
                                >
                                  {gb.name}
                                </Link>
                              </div>
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="space-y-1 text-sm">
                              <div className="flex items-center gap-2 text-muted-foreground">
                                <CalendarDays className="h-3.5 w-3.5" />
                                <span>{gb.event_date ? formatDate(gb.event_date) : "-"}</span>
                              </div>
                              <div className="flex items-center gap-2 text-muted-foreground">
                                <MapPin className="h-3.5 w-3.5" />
                                <span className="truncate max-w-[240px]">{gb.location || "-"}</span>
                              </div>
                            </div>
                          </td>
                          <td className="p-4">
                            {gb.event_type ? (
                              <Badge variant="outline" className="font-normal">
                                {gb.event_type}
                              </Badge>
                            ) : (
                              <span className="text-sm text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="p-4 text-right">
                            <span className="font-bold text-green-600">
                              {formatCurrency(gb.summary?.cashTotal ?? 0)}
                            </span>
                          </td>
                          <td className="p-4 text-right">
                            <span className="font-semibold text-primary">
                              {formatCurrency(gb.summary?.itemEstimatedTotal ?? 0)}
                            </span>
                          </td>
                          <td className="p-4 text-right">
                            <span className="text-sm text-muted-foreground">{gb.summary?.recordCount ?? 0}</span>
                          </td>
                          <td className="p-4">
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                                <Link href={`/dashboard/giftbooks/${gb.id}`} aria-label="进入礼簿">
                                  <LogIn className="h-4 w-4" />
                                </Link>
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => setEditingGiftBook(gb)}
                                aria-label="编辑礼簿"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => handleDelete(gb.id)}
                                aria-label="删除礼簿"
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

                {/* 移动端：卡片（进入 = 点标题，右侧仅作为指示，不做大按钮） */}
                <div className="md:hidden divide-y">
                  {giftbooks.map((gb) => (
                    <div key={gb.id} className="p-4 hover:bg-accent/30 transition-colors">
                      <div className="flex items-start gap-3">
                        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-muted shrink-0">
                          <BookHeart className="h-6 w-6 text-primary" />
                        </div>

                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <Link
                                href={`/dashboard/giftbooks/${gb.id}`}
                                className="font-semibold text-base leading-tight truncate flex items-center gap-1"
                              >
                                <span className="truncate">{gb.name}</span>
                                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                              </Link>
                              <div className="flex flex-wrap items-center gap-2 mt-1">
                                {gb.event_type ? (
                                  <Badge variant="outline" className="text-xs">
                                    {gb.event_type}
                                  </Badge>
                                ) : null}
                                <span className="text-xs text-muted-foreground">明细 {gb.summary?.recordCount ?? 0} 条</span>
                              </div>
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => setEditingGiftBook(gb)}
                                aria-label="编辑礼簿"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => handleDelete(gb.id)}
                                aria-label="删除礼簿"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-2 text-xs">
                            <div className="rounded-lg bg-muted/50 p-2">
                              <div className="text-muted-foreground">礼金</div>
                              <div className="font-semibold text-green-600 mt-0.5">
                                {formatCurrency(gb.summary?.cashTotal ?? 0)}
                              </div>
                            </div>
                            <div className="rounded-lg bg-muted/50 p-2">
                              <div className="text-muted-foreground">礼品估值</div>
                              <div className="font-semibold text-primary mt-0.5">
                                {formatCurrency(gb.summary?.itemEstimatedTotal ?? 0)}
                              </div>
                            </div>
                            <div className="rounded-lg bg-muted/50 p-2">
                              <div className="text-muted-foreground">记录</div>
                              <div className="font-bold text-primary mt-0.5">{gb.summary?.recordCount ?? 0}</div>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                            {gb.event_date ? (
                              <span className="flex items-center gap-1.5">
                                <CalendarDays className="h-3.5 w-3.5" />
                                {formatDate(gb.event_date)}
                              </span>
                            ) : null}
                            {gb.location ? (
                              <span className="flex items-center gap-1.5">
                                <MapPin className="h-3.5 w-3.5" />
                                <span className="truncate max-w-[220px]">{gb.location}</span>
                              </span>
                            ) : null}
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

      {/* 编辑礼簿 */}
      {editingGiftBook && (
        <Dialog
          open={!!editingGiftBook}
          onOpenChange={(open) => {
            if (!open) editClose.close(() => setEditingGiftBook(null));
          }}
        >
          <EditGiftBookModal
            registerCloseGuard={editClose.register}
            giftbook={editingGiftBook}
            onClose={(refresh) => {
              setEditingGiftBook(null);
              if (refresh) loadGiftBooks();
            }}
          />
        </Dialog>
      )}
    </DashboardLayout>
  );
}

function CreateGiftBookModal({ onClose, enabled, registerCloseGuard }: { onClose: (refresh?: boolean) => void; enabled: boolean; registerCloseGuard: RegisterCloseGuard }) {
  const getTodayDate = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    event_type: "",
    event_date: getTodayDate(),
    location: "",
    description: "",
  });

  const [initialSnapshot] = useState(() => JSON.stringify(formData));
  const draft = useFormDraft({
    scope: "giftbooks:new",
    value: formData,
    dirty: JSON.stringify(formData) !== initialSnapshot,
    enabled: enabled,
    onRestore: (restored) => {
      setFormData(restored);
      setSubmitError(null);
    },
  });

  const { requestClose } = useFormLeaveGuard({
    draft,
    isBusy: isSubmitting,
  });
  useEffect(() => registerCloseGuard(requestClose), [registerCloseGuard, requestClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/giftbooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          event_type: formData.event_type || undefined,
          event_date: formData.event_date || undefined,
          location: formData.location || undefined,
          description: formData.description || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "创建失败");
      }
      toast.success("礼簿创建成功");
      draft.clear();
      onClose(true);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "保存失败，请重试");
      console.error("创建礼簿失败:", e);
      toast.error(e instanceof Error ? e.message : "创建失败，请重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <DialogContent className="sm:max-w-[520px]">
      <DialogHeader>
        <DialogTitle>新建礼簿</DialogTitle>
        <DialogDescription>建议用“事件名+日期”，例如：张三婚礼 2026-02-01</DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
        <DialogBody className="space-y-4 py-4">
          <DraftNotice draft={draft} />
          {submitError && <p role="alert" className="text-sm text-destructive">{submitError}</p>}
          <div className="space-y-2">
            <Label htmlFor="gb-name">礼簿名 *</Label>
            <Input
              id="gb-name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="例如：张三婚礼"
              required
              maxLength={128}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="gb-type">事件类型</Label>
              <Input
                id="gb-type"
                value={formData.event_type}
                onChange={(e) => setFormData({ ...formData, event_type: e.target.value })}
                placeholder="例如：婚礼/乔迁/满月"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gb-date">事件日期</Label>
              <Input
                id="gb-date"
                type="date"
                value={formData.event_date}
                onChange={(e) => setFormData({ ...formData, event_date: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="gb-location">地点</Label>
            <Input
              id="gb-location"
              value={formData.location}
              onChange={(e) => setFormData({ ...formData, location: e.target.value })}
              placeholder="可选"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="gb-desc">备注</Label>
            <Input
              id="gb-desc"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="可选"
            />
          </div>
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => requestClose(() => onClose(false))} disabled={isSubmitting}>
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

function EditGiftBookModal({
  registerCloseGuard,
  giftbook,
  onClose,
}: {
  registerCloseGuard: RegisterCloseGuard;
  giftbook: GiftBookListItem;
  onClose: (refresh?: boolean) => void;
}) {
  const formatDateForInput = (dateString: string | null | undefined) => {
    if (!dateString) return "";
    const d = new Date(dateString);
    if (Number.isNaN(d.getTime())) {
      // 兜底：如果后端返回的是 YYYY-MM-DD，这里也能直接回显
      return String(dateString).slice(0, 10);
    }
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: giftbook.name || "",
    event_type: giftbook.event_type || "",
    event_date: formatDateForInput(giftbook.event_date),
    location: giftbook.location || "",
    description: giftbook.description || "",
  });

  const [initialSnapshot] = useState(() => JSON.stringify(formData));
  const draft = useFormDraft({
    scope: `giftbooks:${giftbook.id}:edit`,
    value: formData,
    dirty: JSON.stringify(formData) !== initialSnapshot,
    enabled: true,
    onRestore: (restored) => {
      setFormData(restored);
      setSubmitError(null);
    },
  });

  const { requestClose } = useFormLeaveGuard({
    draft,
    isBusy: isSubmitting,
  });
  useEffect(() => registerCloseGuard(requestClose), [registerCloseGuard, requestClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/giftbooks/${giftbook.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          event_type: formData.event_type || null,
          event_date: formData.event_date || null,
          location: formData.location || null,
          description: formData.description || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "更新失败");
      }
      toast.success("礼簿已更新");
      draft.clear();
      onClose(true);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "保存失败，请重试");
      console.error("更新礼簿失败:", e);
      toast.error(e instanceof Error ? e.message : "更新失败，请重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <DialogContent className="sm:max-w-[520px]">
      <DialogHeader>
        <DialogTitle>编辑礼簿</DialogTitle>
        <DialogDescription>更新礼簿名、日期、地点等信息</DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
        <DialogBody className="space-y-4 py-4">
          <DraftNotice draft={draft} />
          {submitError && <p role="alert" className="text-sm text-destructive">{submitError}</p>}
          <div className="space-y-2">
            <Label htmlFor="gb-edit-name">礼簿名 *</Label>
            <Input
              id="gb-edit-name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              maxLength={128}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="gb-edit-type">事件类型</Label>
              <Input
                id="gb-edit-type"
                value={formData.event_type}
                onChange={(e) => setFormData({ ...formData, event_type: e.target.value })}
                placeholder="例如：婚礼/乔迁/满月"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gb-edit-date">事件日期</Label>
              <Input
                id="gb-edit-date"
                type="date"
                value={formData.event_date}
                onChange={(e) => setFormData({ ...formData, event_date: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="gb-edit-location">地点</Label>
            <Input
              id="gb-edit-location"
              value={formData.location}
              onChange={(e) => setFormData({ ...formData, location: e.target.value })}
              placeholder="可选"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="gb-edit-desc">备注</Label>
            <Input
              id="gb-edit-desc"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="可选"
            />
          </div>
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => requestClose(() => onClose(false))} disabled={isSubmitting}>
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

