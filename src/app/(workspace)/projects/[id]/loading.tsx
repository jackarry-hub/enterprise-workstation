import { GlassCard } from "@/components/ui/glass-card";

export default function ProjectDetailLoading() {
  return (
    <main aria-label="正在加载项目详情" className="mx-auto flex w-full max-w-420 animate-pulse flex-col gap-4 px-3 pt-4 pb-26 sm:px-4 lg:px-5 lg:pt-6 lg:pb-8">
      <GlassCard className="h-47 p-6">
        <div className="h-7 w-56 rounded-xl bg-brand-soft" />
        <div className="mt-4 h-4 w-96 max-w-full rounded-lg bg-muted" />
        <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((item) => <div key={item} className="h-15 rounded-2xl bg-muted" />)}
        </div>
      </GlassCard>
      <div className="h-13 rounded-2xl border border-glass-border bg-glass" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.75fr)]">
        <GlassCard className="h-96" />
        <GlassCard className="h-96" />
      </div>
    </main>
  );
}
