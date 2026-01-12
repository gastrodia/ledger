"use client";

import { useState, useEffect } from "react";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Edit, Trash2, Loader2 } from "lucide-react";
import type { Category, TransactionType } from "@/types";
import { toast } from "@/hooks/use-toast";
import { useConfirm } from "@/hooks/use-confirm";

// 预设分类模板
const presetCategories = {
  expense: [
    { name: "餐饮", icon: "🍜" },
    { name: "交通", icon: "🚗" },
    { name: "购物", icon: "🛒" },
    { name: "娱乐", icon: "🎮" },
    { name: "医疗", icon: "💊" },
    { name: "教育", icon: "📚" },
    { name: "住房", icon: "🏠" },
    { name: "其他", icon: "📦" },
  ],
  income: [
    { name: "工资", icon: "💰" },
    { name: "投资", icon: "📈" },
    { name: "奖金", icon: "🎁" },
    { name: "兼职", icon: "💼" },
    { name: "红包", icon: "🧧" },
    { name: "其他", icon: "💵" },
  ],
};

export default function CategoriesPage() {
  const router = useRouter();
  const { confirm } = useConfirm();
  const [categories, setCategories] = useState<Category[]>([]);
  const [filterType, setFilterType] = useState<TransactionType | "all">("all");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // 加载分类
  const loadCategories = async () => {
    try {
      setIsLoading(true);
      const params = new URLSearchParams();
      if (filterType !== "all") params.append("type", filterType);

      const response = await fetch(`/api/categories?${params.toString()}`);
      if (!response.ok) {
        if (response.status === 401) {
          router.push("/login");
          return;
        }
        throw new Error("获取分类失败");
      }

      const result = await response.json();
      setCategories(result.data || []);
    } catch (error) {
      console.error("加载分类失败:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // 初始加载
  useEffect(() => {
    loadCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterType]);

  const filteredCategories = categories.filter((c) => filterType === "all" || c.type === filterType);

  const handleEdit = (category: Category) => {
    setEditingCategory(category);
    setIsAddModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    const confirmed = await confirm({
      title: "删除分类",
      description: "确定要删除这个分类吗？此操作无法撤销。",
      confirmText: "删除",
      cancelText: "取消",
    });
    
    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(`/api/categories/${id}`, {
        method: "DELETE",
      });

      const result = await response.json();

      if (!response.ok) {
        toast.error(result.error || "删除失败");
        return;
      }

      toast.success("删除成功");
      loadCategories();
    } catch (error) {
      console.error("删除分类失败:", error);
      toast.error("删除失败");
    }
  };

  const handleCloseModal = () => {
    setIsAddModalOpen(false);
    setEditingCategory(null);
  };

  const handleSave = () => {
    handleCloseModal();
    loadCategories();
  };

  const expenseCategories = filteredCategories.filter((c) => c.type === "expense");
  const incomeCategories = filteredCategories.filter((c) => c.type === "income");

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              分类管理
            </h1>
            <p className="text-muted-foreground mt-1">
              管理您的收入和支出分类
            </p>
          </div>
          <Button onClick={() => setIsAddModalOpen(true)}>
            <Plus className="h-4 w-4" />
            添加分类
          </Button>
        </div>

        {/* Filter */}
        <div className="flex items-center gap-4">
          <Select value={filterType} onValueChange={(value) => setFilterType(value as TransactionType | "all")}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="全部类型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部类型</SelectItem>
              <SelectItem value="income">收入</SelectItem>
              <SelectItem value="expense">支出</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Loading State */}
        {isLoading ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
              <p className="text-muted-foreground mt-4">加载中...</p>
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
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {expenseCategories.map((category) => (
                        <CategoryCard
                          key={category.id}
                          category={category}
                          onEdit={handleEdit}
                          onDelete={handleDelete}
                        />
                      ))}
                    </div>
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
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {incomeCategories.map((category) => (
                        <CategoryCard
                          key={category.id}
                          category={category}
                          onEdit={handleEdit}
                          onDelete={handleDelete}
                        />
                      ))}
                    </div>
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
        isOpen={isAddModalOpen}
        onClose={handleCloseModal}
        category={editingCategory}
        onSave={handleSave}
      />
    </DashboardLayout>
  );
}

function CategoryCard({
  category,
  onEdit,
  onDelete,
}: {
  category: Category;
  onEdit: (category: Category) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="relative p-4 rounded-xl border bg-card hover:shadow-md transition-all cursor-pointer group">
      <div className="flex flex-col items-center text-center space-y-2">
        <div className="flex items-center justify-center w-12 h-12 rounded-xl text-2xl bg-accent">
          {category.icon || "📁"}
        </div>
        <div>
          <p className="font-medium">{category.name}</p>
        </div>
      </div>
      <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onEdit(category)}
        >
          <Edit className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive hover:text-destructive"
          onClick={() => onDelete(category.id)}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
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
  onSave: () => void;
}) {
  const [formData, setFormData] = useState({
    name: "",
    type: "expense" as TransactionType,
    icon: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 当 category 变化时更新表单数据
  useEffect(() => {
    if (category) {
      setFormData({
        name: category.name,
        type: category.type,
        icon: category.icon || "",
      });
    } else {
      setFormData({
        name: "",
        type: "expense",
        icon: "",
      });
    }
  }, [category, isOpen]);

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
      }

      onSave();
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
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
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
                    <span className="text-2xl">{preset.icon}</span>
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
            <Label htmlFor="icon">图标 (Emoji)</Label>
            <Input
              id="icon"
              type="text"
              placeholder="请输入图标 Emoji"
              value={formData.icon}
              onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
              maxLength={10}
            />
          </div>

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
