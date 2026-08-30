import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { scanPublicSourceTerms } from "../../scripts/scan-formal-public-surface.mjs";

describe("excluded public scope", () => {
  it("removes public routes, labels, links and documentation references", async () => {
    const root = process.cwd();
    expect(existsSync(path.join(root, "src/app/(workspace)/leave/page.tsx"))).toBe(false);
    expect(existsSync(path.join(root, "src/app/(workspace)/attendance/page.tsx"))).toBe(false);
    expect(await scanPublicSourceTerms(root)).toEqual([]);
  });
});
