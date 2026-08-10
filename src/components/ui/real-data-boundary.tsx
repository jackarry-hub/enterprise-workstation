import Link from "next/link";
import { DatabaseZap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";

export function RealDataNotice({ message }: { message: string }) {
  return (
    <div
      className="flex items-center gap-3 rounded-2xl border border-primary/15 bg-primary/6 px-4 py-3 text-sm text-muted-foreground"
      role="status"
    >
      <DatabaseZap aria-hidden="true" className="size-4 shrink-0 text-primary" />
      <span>{message}</span>
    </div>
  );
}

export function RealDataUnavailable({
  title,
  description,
  backHref,
  backLabel,
}: {
  title: string;
  description: string;
  backHref: string;
  backLabel: string;
}) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-16">
      <GlassCard className="p-8 text-center">
        <DatabaseZap aria-hidden="true" className="mx-auto size-8 text-primary" />
        <h1 className="mt-3 text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
        <Button asChild className="mt-5">
          <Link href={backHref}>{backLabel}</Link>
        </Button>
      </GlassCard>
    </main>
  );
}
