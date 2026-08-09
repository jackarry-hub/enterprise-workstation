import Image from "next/image";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";

type TaskCenterHeroProps = {
  query: string;
  onQueryChange: (value: string) => void;
};

export function TaskCenterHero({ query, onQueryChange }: TaskCenterHeroProps) {
  return (
    <header className="relative min-h-32 overflow-hidden rounded-3xl border border-white/75 bg-white/55 px-5 py-5 shadow-[0_18px_48px_rgba(43,91,155,0.08)] sm:min-h-40 sm:px-7 sm:py-7">
      <Image
        src="/dashboard/welcome-space-bg.png"
        alt=""
        fill
        priority
        className="pointer-events-none object-cover object-right opacity-68"
        sizes="(max-width: 768px) 100vw, 1200px"
      />
      <div className="relative z-10 flex max-w-2xl flex-col gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">任务管理</h1>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground sm:text-base">
            聚焦任务执行，清晰掌握每一项工作的责任与进度。
          </p>
        </div>
        <label className="relative block max-w-md">
          <Search aria-hidden="true" className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="搜索任务或项目"
            placeholder="搜索任务或项目"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            className="h-10 rounded-xl border-white/80 bg-white/78 pl-9 shadow-[0_8px_22px_rgba(46,95,158,0.06)] backdrop-blur-xl"
          />
        </label>
      </div>
    </header>
  );
}
