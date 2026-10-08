"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AssistantImage } from "@/lib/assistant-images";

interface Props {
  images: AssistantImage[];
  disabled: boolean;
  onReorder: (images: AssistantImage[]) => void;
  onPreview: (image: AssistantImage) => void;
  onRemove: (image: AssistantImage) => void;
}

export function SortableAssistantImages({ images, disabled, onReorder, onPreview, onRemove }: Props) {
  const [ids] = useState(() => new WeakMap<AssistantImage, string>());
  const items = useMemo(() => images.map(image => {
    let id = ids.get(image);
    if (!id) { id = crypto.randomUUID(); ids.set(image, id); }
    return { id, image };
  }), [images, ids]);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const reorder = ({ active, over }: DragEndEvent) => {
    if (disabled || !over || active.id === over.id) return;
    const from = items.findIndex(item => item.id === active.id);
    const to = items.findIndex(item => item.id === over.id);
    if (from >= 0 && to >= 0) onReorder(arrayMove(images, from, to));
  };
  return <DndContext id="assistant-images" sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorder}
    accessibility={{
      screenReaderInstructions: { draggable: "按空格键开始排序，使用左右方向键移动，再按空格键完成，按 Escape 键取消。" },
      announcements: {
        onDragStart: ({ active }) => `开始移动第 ${items.findIndex(item => item.id === active.id) + 1} 张截图。`,
        onDragOver: ({ over }) => over ? `移至第 ${items.findIndex(item => item.id === over.id) + 1} 位。` : undefined,
        onDragEnd: ({ over }) => over ? "截图顺序已调整。" : "已取消排序。",
        onDragCancel: () => "已取消排序。",
      },
    }}>
    <SortableContext items={items.map(item => item.id)} strategy={horizontalListSortingStrategy}>
      <div className="flex gap-2 overflow-x-auto overscroll-x-contain py-1" aria-label="截图排序">
        {items.map((item, index) => <SortableImage key={item.id} {...item} index={index}
          disabled={disabled} sortable={images.length > 1} onPreview={onPreview} onRemove={onRemove} />)}
      </div>
    </SortableContext>
  </DndContext>;
}

function SortableImage({ id, image, index, disabled, sortable, onPreview, onRemove }: {
  id: string; image: AssistantImage; index: number; disabled: boolean; sortable: boolean;
  onPreview: Props["onPreview"]; onRemove: Props["onRemove"];
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: disabled || !sortable });
  return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined }}
    className="relative w-[72px] shrink-0">
    <Button ref={setActivatorNodeRef} type="button" variant="ghost" {...attributes} {...listeners}
      className={cn("block h-14 w-full touch-pan-x select-none overflow-hidden rounded-lg border border-border p-0", sortable && !disabled && "cursor-grab active:cursor-grabbing", isDragging && "border-primary ring-2 ring-primary/25")}
      aria-label={`预览第 ${index + 1} 张截图：${image.name}`} aria-roledescription={sortable && !disabled ? "可拖动排序的截图" : undefined}
      title={sortable && !disabled ? "点击预览，长按或拖动调整顺序" : "点击预览"} onClick={() => onPreview(image)}>
      <Image src={image.data} alt={`第 ${index + 1} 张截图`} width={72} height={56} unoptimized draggable={false} className="h-full w-full object-cover" />
    </Button>
    <Button type="button" variant="ghost" className="absolute right-0 top-0 flex size-6 items-center justify-center rounded-bl-lg rounded-tr-lg bg-background/90 p-0 text-foreground [&_svg]:size-3.5"
      aria-label={`移除第 ${index + 1} 张截图`} disabled={disabled} onClick={() => onRemove(image)}><X /></Button>
  </div>;
}
