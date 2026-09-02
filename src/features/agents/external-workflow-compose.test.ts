import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("external workflow deployment contract", () => {
  it("passes optional server-only workflow credentials only to the workstation container", () => {
    const compose = fs.readFileSync(path.join(process.cwd(), "compose.yaml"), "utf8");
    expect(compose).toContain("QUANTXY_IMAGE_STUDIO_SERVICE_TOKEN: ${QUANTXY_IMAGE_STUDIO_SERVICE_TOKEN:-}");
    expect(compose).toContain("QUANTXY_CONTENT_WORKFLOW_SERVICE_TOKEN: ${QUANTXY_CONTENT_WORKFLOW_SERVICE_TOKEN:-}");
    expect(compose).not.toContain("NEXT_PUBLIC_QUANTXY_IMAGE_STUDIO_SERVICE_TOKEN");
    expect(compose).not.toContain("NEXT_PUBLIC_QUANTXY_CONTENT_WORKFLOW_SERVICE_TOKEN");
  });
});
