import Image from "next/image";
import { FolderOpen, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type KnowledgeHeroProps = {
  query: string;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
};

export function KnowledgeHero({ query, onQueryChange, onSearch }: KnowledgeHeroProps) {
  return (
    <header className="relative min-h-56 overflow-hidden rounded-3xl border border-white/75 bg-white/55 p-5 shadow-[0_18px_48px_rgba(43,91,155,0.08)] sm:p-7">
      <Image src="/dashboard/welcome-space-bg.png" alt="" fill priority className="pointer-events-none object-cover object-right opacity-60" sizes="(max-width: 768px) 100vw, 1200px" />
      <div className="relative z-10 max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">知识库</h1>
        <p className="mt-1.5 text-sm leading-6 text-muted-foreground sm:text-base">沉淀企业知识资产，促进知识共享与高效协作。</p>
        <div className="mt-5 rounded-2xl border border-white/80 bg-white/72 p-3 shadow-[0_12px_30px_rgba(48,94,154,0.08)] backdrop-blur-xl sm:p-4">
          <p className="mb-2 text-sm font-medium">搜索知识库</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="relative flex-1"><Search aria-hidden="true" className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input type="search" aria-label="搜索知识库" placeholder="搜索文档标题、内容或关键词" value={query} onChange={(event) => onQueryChange(event.target.value)} className="h-10 rounded-xl bg-white/75 pl-9" /></label>
            <Button type="button" className="h-10 rounded-xl px-6" onClick={onSearch}>搜索</Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>热门搜索：</span><span>员工手册</span><span>项目管理流程</span><span>合同模板</span><span>OKR 指南</span></div>
        </div>
      </div>
      <div className="pointer-events-none absolute right-[8%] bottom-8 hidden size-32 place-items-center rounded-[2.5rem] border border-white/80 bg-linear-to-br from-primary/18 to-chart-5/8 text-primary shadow-[0_28px_50px_rgba(47,125,246,0.12)] xl:grid"><FolderOpen className="size-16" strokeWidth={1.4} /></div>
    </header>
  );
}
