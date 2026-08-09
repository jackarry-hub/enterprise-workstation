import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";

type StatusBadgeProps = {
  children: ReactNode;
  status: "active" | "success" | "warning" | "neutral";
};

const statusVariants = {
  active: "info",
  success: "success",
  warning: "warning",
  neutral: "neutral",
} as const;

export function StatusBadge({ children, status }: StatusBadgeProps) {
  return <Badge variant={statusVariants[status]}>{children}</Badge>;
}
