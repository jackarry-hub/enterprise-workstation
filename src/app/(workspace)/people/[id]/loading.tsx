import { GlassCard } from "@/components/ui/glass-card";

export default function EmployeeDetailLoading() {
  return (
    <main className="mx-auto flex w-full max-w-420 animate-pulse flex-col gap-4 px-3 pt-5 pb-10 sm:px-4 lg:px-5 lg:pt-7">
      <div className="h-7 w-32 rounded-xl bg-muted" />
      <GlassCard className="h-48" />
      <div className="grid gap-4 xl:grid-cols-2">
        <GlassCard className="h-72" />
        <GlassCard className="h-72" />
        <GlassCard className="h-52 xl:col-span-2" />
      </div>
    </main>
  );
}
