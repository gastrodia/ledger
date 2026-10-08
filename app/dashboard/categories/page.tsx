"use client";

import { useListResource, useJsonLoader } from "@/hooks/use-list-resource";
import { ListSyncFeedback } from "@/components/ui/list-sync-feedback";
import { Skeleton, SkeletonRegion } from "@/components/ui/loading-skeleton";
import { updateCategories } from "@/lib/list-updates";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
} from "@/components/ui/dialog";
import { Plus, Loader2 } from "lucide-react";
import type { Category, TransactionType } from "@/types";
import { toast } from "@/hooks/use-toast";
import { useConfirm } from "@/hooks/use-confirm";
import { SortableCategoryGrid } from "@/components/categories/sortable-category-grid";
import { CategoryIcon } from "@/components/icons/entity-icon";
import { IconPicker } from "@/components/icons/icon-picker";
import { DEFAULT_CATEGORY_ICON, isCategoryIcon } from "@/lib/entity-icon-catalog";

// 预设分类模板
const presetCategories = {
  expense: [
    { name: "餐饮", icon: "lucide:utensils" },
    { name: "交通", icon: "lucide:car" },
    { name: "购物", icon: "lucide:shopping-cart" },
    { name: "娱乐", icon: "lucide:gamepad-2" },
    { name: "医疗", icon: "lucide:pill" },
    { name: "教育", icon: "lucide:book-open" },
    { name: "住房", icon: "lucide:house" },
    { name: "其他", icon: "lucide:package" },
  ],
  income: [
    { name: "工资", icon: "lucide:wallet" },
    { name: "投资", icon: "lucide:trending-up" },
    { name: "奖金", icon: "lucide:gift" },
    { name: "兼职", icon: "lucide:briefcase" },
    { name: "红包", icon: "lucide:mail" },
    { name: "其他", icon: "lucide:banknote" },
  ],
};

export default function CategoriesPage() {
  const router = useRouter();
  const { confirm } = useConfirm();
  const [filterType] = useState<TransactionType | "all">("all");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const loader = useJsonLoader<{ data: Category[] }>("/api/categories");
  const resource = useListResource("categories", loader);
  const { isLoading, loadError, refresh: loadCategories } = resource;
  const categories = resource.data?.data ?? [];

  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const savingOrder = useRef(false);
  const interactionsDisabled = isSavingOrder || isDeleting || isAddModalOpen;

  const handleReorder = async (type: TransactionType, ordered: Category[]) => {
    if (savingOrder.current || interactionsDisabled) return;
    const previous = categories;
    savingOrder.current = true;
    setIsSavingOrder(true);
    resource.update(current => ({ ...current, data: [...current.data.filter(category => category.type !== type), ...ordered] }), false);
    try {
      const response = await fetch("/api/categories/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, ids: ordered.map(category => category.id) }),
      });
      if (!response.ok) {
        const result = await response.json();
        if (response.status === 401) router.push("/login");
        throw new Error(result.error || "排序保存失败，请重试");
      }
      toast.success("分类顺序已保存");
      void loadCategories();
    } catch (error) {
      resource.update(current => ({ ...current, data: previous }), false);
      void loadCategories();
      toast.error(error instanceof Error ? error.message : "排序保存失败，请重试");
    } finally {
      savingOrder.current = false;
      setIsSavingOrder(false);
    }
  };

  const filteredCategories = categories.filter((c) => filterType === "all" || c.type === filterType);

  const handleEdit = (category: Category) => {
    setEditingCategory(category);
    setIsAddModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (interactionsDisabled || savingOrder.current) return;
    setIsDeleting(true);
    try {
      const confirmed = await confirm({
        title: "删除分类",
        description: "确定要删除这个分类吗？此操作无法撤销。",
        confirmText: "删除",
        cancelText: "取消",
      });
      if (!confirmed) return;

      const response = await fetch(`/api/categories/${id}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) {
        toast.error(result.error || "删除失败");
        return;
      }
      toast.success("删除成功");
      resource.update(current => ({ ...current, data: current.data.filter(row => row.id !== id) }));
    } catch (error) {
      console.error("删除分类失败:", error);
      toast.error("删除失败");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCloseModal = () => {
    setIsAddModalOpen(false);
    setEditingCategory(null);
  };

  const handleSave = (saved: Category) => {
    handleCloseModal();
    resource.update(current => ({ ...current, data: updateCategories(current.data, saved) }));
  };

  const expenseCategories = filteredCategories.filter((c) => c.type === "expense");
  const incomeCategories = filteredCategories.filter((c) => c.type === "income");

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              分类管理
            </h1>
            <p className="text-sm leading-6 text-muted-foreground mt-1">
              拖动卡片左上角手柄排序，松开后自动保存
            </p>
          </div>
          <Button disabled={interactionsDisabled} onClick={() => setIsAddModalOpen(true)}>
            <Plus className="h-4 w-4" />
            添加分类
          </Button>
        </div>

        <p role="status" aria-live="polite" className={isSavingOrder ? "text-sm text-muted-foreground" : "sr-only"}>
          {isSavingOrder ? "正在保存分类顺序…" : ""}
        </p>

        <ListSyncFeedback error={resource.refreshError} refreshing={resource.isRefreshing} onRetry={resource.refresh} />
        {/* Loading State */}
        {isLoading ? (
          <CategoriesSkeleton />
        ) : loadError ? (
          <Card>
            <CardContent className="py-12 text-center space-y-4" role="alert">
              <p className="font-medium">{loadError}</p>
              <Button variant="outline" onClick={loadCategories}>重新加载</Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Categories Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Expense Categories */}
              {expenseCategories.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">支出分类</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <SortableCategoryGrid
                      categories={expenseCategories}
                      type="expense"
                      disabled={interactionsDisabled}
                      onReorder={handleReorder}
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                    />
                  </CardContent>
                </Card>
              )}

              {/* Income Categories */}
              {incomeCategories.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">收入分类</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <SortableCategoryGrid
                      categories={incomeCategories}
                      type="income"
                      disabled={interactionsDisabled}
                      onReorder={handleReorder}
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                    />
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Empty State */}
            {filteredCategories.length === 0 && (
              <Card>
                <CardContent className="py-12 text-center">
                  <p className="text-muted-foreground">暂无分类</p>
                  <Button
                    variant="outline"
                    className="mt-4"
                    onClick={() => setIsAddModalOpen(true)}
                  >
                    <Plus className="h-4 w-4" />
                    添加第一个分类
                  </Button>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      {/* Add/Edit Modal */}
      <CategoryModal
        key={`${isAddModalOpen}:${editingCategory?.id || "new"}`}
        isOpen={isAddModalOpen}
        onClose={handleCloseModal}
        category={editingCategory}
        onSave={handleSave}
      />
    </DashboardLayout>
  );
}

function CategoriesSkeleton() {
  return (
    <SkeletonRegion label="正在加载收支分类">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {["支出分类", "收入分类"].map((title) => (
          <Card key={title}>
            <CardHeader><CardTitle className="text-lg">{title}</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {Array.from({ length: 6 }, (_, index) => (
                  <div key={index} className="min-w-0 rounded-lg border bg-card p-4 pt-12">
                    <div className="flex flex-col items-center space-y-2">
                      <Skeleton className="h-10 w-10 rounded-md" />
                      <div className="flex h-6 items-center"><Skeleton className="h-4 w-12" /></div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </SkeletonRegion>
  );
}

function CategoryModal({
  isOpen,
  onClose,
  category,
  onSave,
}: {
  isOpen: boolean;
  onClose: () => void;
  category: Category | null;
  onSave: (saved: Category) => void;
}) {
  const [formData, setFormData] = useState({
    name: category?.name || "",
    type: category?.type || "expense" as TransactionType,
    icon: category?.icon && isCategoryIcon(category.icon) ? category.icon : DEFAULT_CATEGORY_ICON,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 快速选择预设分类
  const handleSelectPreset = (preset: { name: string; icon: string }) => {
    setFormData({
      ...formData,
      name: preset.name,
      icon: preset.icon,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      toast.error("请输入分类名称");
      return;
    }

    try {
      setIsSubmitting(true);

      if (category) {
        // 更新分类
        const response = await fetch(`/api/categories/${category.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        });

        const result = await response.json();

        if (!response.ok) {
          toast.error(result.error || "更新失败");
          return;
        }

        toast.success("更新成功");
        onSave(result.data);
      } else {
        // 创建分类
        const response = await fetch("/api/categories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        });

        const result = await response.json();

        if (!response.ok) {
          toast.error(result.error || "创建失败");
          return;
        }

        toast.success("创建成功");
        onSave(result.data);
      }

    } catch (error) {
      console.error("保存分类失败:", error);
      toast.error("保存失败");
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentPresets = presetCategories[formData.type];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{category ? "编辑分类" : "添加分类"}</DialogTitle>
          <DialogDescription>
            {category ? "修改分类的信息" : "创建一个新的收支分类"}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 gap-4">
          <DialogBody className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="type">类型</Label>
            <Select 
              value={formData.type} 
              onValueChange={(value) => setFormData({ ...formData, type: value as TransactionType })}
              disabled={!!category}
            >
              <SelectTrigger id="type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="expense">支出</SelectItem>
                <SelectItem value="income">收入</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {!category && (
            <div className="space-y-2">
              <Label>快速选择预设分类</Label>
              <div className="grid grid-cols-4 gap-2">
                {currentPresets.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => handleSelectPreset(preset)}
                    className="flex flex-col items-center gap-1 p-3 rounded-lg border bg-card hover:bg-accent transition-colors"
                  >
                    <CategoryIcon icon={preset.icon} className="size-6 text-primary" />
                    <span className="text-xs">{preset.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="name">分类名称</Label>
            <Input
              id="name"
              type="text"
              placeholder="请输入分类名称"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              maxLength={128}
            />
          </div>

          <div className="space-y-2">
            <Label>分类图标</Label>
            <IconPicker
              kind="category"
              value={formData.icon}
              onChange={(icon) => setFormData({ ...formData, icon })}
            />
          </div>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              取消
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  保存中...
                </>
              ) : (
                "保存"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
