import * as React from "react"

import { cn } from "@/lib/utils"

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background hover:border-slate-300 px-3 py-1 text-base shadow-none transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          // Keep iOS's native date content inside narrow form columns.
          type === "date" && "min-w-0 max-w-full appearance-none [&::-webkit-date-and-time-value]:min-w-0 [&::-webkit-date-and-time-value]:text-left [&::-webkit-datetime-edit]:min-w-0 [&::-webkit-datetime-edit]:p-0",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
