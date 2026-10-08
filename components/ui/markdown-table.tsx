import type { Components } from "react-markdown";
import { cn } from "@/lib/utils";
import { HorizontalScroll } from "@/components/ui/horizontal-scroll";

const cellContentClass = "min-w-32 max-w-96 whitespace-normal [overflow-wrap:anywhere]";
const cellClass = "border-b border-border px-3 py-2 align-top";

export const markdownTableComponents: Components = {
  table: ({ children, ...props }) => {
    delete props.node;
    return <HorizontalScroll>
      <table {...props} className={cn("w-max min-w-full border-collapse", props.className)}>{children}</table>
    </HorizontalScroll>;
  },
  th: ({ children, ...props }) => {
    delete props.node;
    return <th {...props} className={cn(cellClass, props.className)}><div className={cellContentClass}>{children}</div></th>;
  },
  td: ({ children, ...props }) => {
    delete props.node;
    return <td {...props} className={cn(cellClass, props.className)}><div className={cellContentClass}>{children}</div></td>;
  },
};
