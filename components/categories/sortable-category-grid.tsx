"use client";

import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter,
  useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, rectSortingStrategy,
  sortableKeyboardCoordinates, useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Edit, GripVertical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CategoryIcon } from "@/components/icons/entity-icon";
import type { Category, TransactionType } from "@/types";

interface Props {
  categories: Category[];
  type: TransactionType;
  disabled: boolean;
  onReorder: (type: TransactionType, ordered: Category[]) => void;
  onEdit: (category: Category) => void;
  onDelete: (id: string) => void;
}

export function SortableCategoryGrid({ categories, type, disabled, onReorder, onEdit, onDelete }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const nameOf = (id: string | number) => categories.find(category => category.id === id)?.name ?? "分类";
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (disabled || !over || active.id === over.id) return;
    const from = categories.findIndex(category => category.id === active.id);
    const to = categories.findIndex(category => category.id === over.id);
    if (from < 0 || to < 0) return;
    onReorder(type, arrayMove(categories, from, to));
  };

  return (
    <DndContext
      id={`categories-${type}`}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      accessibility={{
        screenReaderInstructions: { draggable: "按空格键开始排序，使用方向键移动，再按空格键保存，按 Escape 键取消。" },
        announcements: {
          onDragStart: ({ active }) => `已选中${nameOf(active.id)}，使用方向键调整位置。`,
          onDragOver: ({ active, over }) => over ? `${nameOf(active.id)}移至第 ${categories.findIndex(c => c.id === over.id) + 1} 位。` : undefined,
          onDragEnd: ({ over }) => over ? "拖动结束，正在保存分类顺序。" : "已取消排序。",
          onDragCancel: () => "已取消排序。",
        },
      }}
    >
      <SortableContext items={categories} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-2 xl:grid-cols-3 gap-3" aria-label={type === "expense" ? "支出分类排序" : "收入分类排序"}>
          {categories.map(category => (
            <SortableCategoryCard key={category.id} category={category} disabled={disabled}
              sortable={categories.length > 1} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableCategoryCard({ category, disabled, sortable, onEdit, onDelete }: {
  category: Category;
  disabled: boolean;
  sortable: boolean;
  onEdit: Props["onEdit"];
  onDelete: Props["onDelete"];
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: category.id, disabled: disabled || !sortable,
  });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined }}
      className={`relative min-w-0 p-4 pt-12 rounded-lg border bg-card hover:border-primary/30 hover:shadow-sm group ${isDragging ? "border-primary shadow-lg" : ""}`}>
      <Button ref={setActivatorNodeRef} type="button" variant="ghost" size="icon"
        {...attributes} {...listeners}
        disabled={disabled || !sortable}
        aria-label={`拖动排序：${category.name}`}
        aria-roledescription="可排序分类"
        title="拖动排序；也可按空格键后用方向键移动"
        className="absolute top-1 left-1 h-9 w-8 touch-none cursor-grab active:cursor-grabbing text-muted-foreground">
        <GripVertical className="h-4 w-4" />
      </Button>
      <div className="flex flex-col items-center text-center space-y-2">
        <div className="flex items-center justify-center w-10 h-10 rounded-md text-primary bg-primary/10">
          <CategoryIcon icon={category.icon} className="size-5" />
        </div>
        <p className="max-w-full break-words font-medium">{category.name}</p>
      </div>
      <div className="absolute top-2 right-2 flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity">
        <Button variant="ghost" size="icon" className="h-7 w-7" disabled={disabled}
          aria-label={`编辑${category.name}`} onClick={() => onEdit(category)}>
          <Edit className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" disabled={disabled}
          aria-label={`删除${category.name}`} onClick={() => onDelete(category.id)}>
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
