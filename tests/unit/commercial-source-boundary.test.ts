import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { scanFormalImports } from "../../scripts/scan-formal-public-surface.mjs";

describe("commercial production source boundary", () => {
  it("keeps the formal dependency graph server-backed and the migration assets quarantined", async () => {
    const report = await scanFormalImports(process.cwd());
    expect(report.violations).toEqual([]);
    expect(report.files.some((file) => file.includes("quantxy-ai-workbench-fused"))).toBe(false);
    expect(existsSync(path.join(process.cwd(), "quantxy-ai-workbench-fused.html"))).toBe(true);
    expect(existsSync(path.join(process.cwd(), "public/workstation-server-adapter.js"))).toBe(true);
  });
});
