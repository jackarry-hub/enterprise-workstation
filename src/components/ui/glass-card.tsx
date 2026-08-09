import * as React from "react";

import { cn } from "@/lib/utils";

export function GlassCard({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="glass-card"
      className={cn(
        "rounded-2xl border border-glass-border bg-glass shadow-[0_16px_45px_rgba(44,84,142,0.08)] backdrop-blur-xl",
        className,
      )}
      {...props}
    />
  );
}
