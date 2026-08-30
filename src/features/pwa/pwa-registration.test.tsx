import { readFile } from "node:fs/promises";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import manifest from "@/app/manifest";
import { PwaRegistration } from "@/features/pwa/pwa-registration";

describe("QuantXY PWA", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("is installable with standalone brand metadata", () => { const value = manifest(); expect(value.display).toBe("standalone"); expect(value.start_url).toBe("/"); expect(value.icons?.some((icon) => icon.purpose === "maskable")).toBe(true); });
  it("caches allowlisted shell assets only and never names a business endpoint", async () => { const source = await readFile(path.join(process.cwd(), "public", "sw.js"), "utf8"); expect(source).toContain("/_next"); expect(source).toContain("brand|dashboard"); expect(source).not.toMatch(/\/api\//); expect(source).not.toContain("storage"); expect(source).toContain("PURGE_SENSITIVE_CACHES"); });
  it("reports offline state without pretending writes are durable", () => { vi.stubGlobal("navigator", { ...navigator, onLine: false }); render(<PwaRegistration />); expect(screen.getByText("当前离线")).toBeVisible(); expect(screen.getByText(/业务写入已暂停/)).toBeVisible(); });
});
