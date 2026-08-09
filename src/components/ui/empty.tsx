import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="empty" className={cn("flex w-full flex-col items-center justify-center gap-4 rounded-xl border-dashed p-8 text-center", className)} {...props} />;
}

function EmptyHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="empty-header" className={cn("flex max-w-sm flex-col items-center gap-2", className)} {...props} />;
}

const emptyMediaVariants = cva("mb-2 flex shrink-0 items-center justify-center", {
  variants: { variant: { default: "bg-transparent", icon: "size-10 rounded-xl bg-muted text-foreground [&_svg]:size-5" } },
  defaultVariants: { variant: "default" },
});

function EmptyMedia({ className, variant, ...props }: React.ComponentProps<"div"> & VariantProps<typeof emptyMediaVariants>) {
  return <div data-slot="empty-icon" className={cn(emptyMediaVariants({ variant }), "grid place-items-center", className)} {...props} />;
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="empty-title" className={cn("text-sm font-medium", className)} {...props} />;
}

function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="empty-description" className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle };

