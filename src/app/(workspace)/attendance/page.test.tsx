import { describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  redirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: navigation.redirect }));

import AttendanceRoute from "@/app/(workspace)/attendance/page";

describe("legacy attendance route", () => {
  it("redirects old bookmarks to task delivery", async () => {
    await expect(Promise.resolve().then(() => AttendanceRoute())).rejects.toThrow("NEXT_REDIRECT:/tasks");
    expect(navigation.redirect).toHaveBeenCalledWith("/tasks");
  });
});
