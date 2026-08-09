import { render, screen } from "@testing-library/react";
import { FolderKanban } from "lucide-react";
import { describe, expect, it } from "vitest";

import { DataCard } from "@/components/ui/data-card";
import { GlassCard } from "@/components/ui/glass-card";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatusBadge } from "@/components/ui/status-badge";

describe("enterprise workstation design system", () => {
  it("renders arbitrary content inside a glass surface", () => {
    render(<GlassCard>项目健康度</GlassCard>);

    expect(screen.getByText("项目健康度")).toBeVisible();
  });

  it("presents a metric with its trend", () => {
    render(
      <DataCard
        icon={FolderKanban}
        label="进行项目"
        value="26"
        trend="+2"
        trendLabel="较上月"
      />,
    );

    expect(screen.getByText("进行项目")).toBeVisible();
    expect(screen.getByText("26")).toBeVisible();
    expect(screen.getByText("+2")).toBeVisible();
  });

  it("exposes status meaning as visible text", () => {
    render(<StatusBadge status="success">已完成</StatusBadge>);

    expect(screen.getByText("已完成")).toBeVisible();
  });

  it("exposes the current progress value to assistive technology", () => {
    render(<ProgressBar aria-label="企业官网升级项目进度" value={78} />);

    expect(
      screen.getByRole("progressbar", { name: "企业官网升级项目进度" }),
    ).toHaveAttribute("aria-valuenow", "78");
  });

  it("renders a page title and supporting description", () => {
    render(
      <PageHeader
        title="首页驾驶舱"
        description="企业核心经营与协同数据总览"
      />,
    );

    expect(screen.getByRole("heading", { name: "首页驾驶舱" })).toBeVisible();
    expect(screen.getByText("企业核心经营与协同数据总览")).toBeVisible();
  });
});
