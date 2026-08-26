import { describe, expect, it } from "vitest";

import { metadata } from "@/app/layout";

describe("root commercial metadata", () => {
  it("does not publish excluded attendance or leave keywords", () => {
    expect(metadata.keywords).not.toContain("考勤");
    expect(metadata.keywords).not.toContain("请假");
  });
});
