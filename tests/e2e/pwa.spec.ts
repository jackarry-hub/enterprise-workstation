import { expect, test } from "@playwright/test";

test("serves an installable manifest and shell-only worker", async ({ request }) => {
  const manifestResponse = await request.get("/manifest.webmanifest"); expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json(); expect(manifest.display).toBe("standalone"); expect(manifest.icons.length).toBeGreaterThan(0);
  const workerResponse = await request.get("/sw.js"); expect(workerResponse.ok()).toBe(true); const worker = await workerResponse.text();
  expect(worker).toContain("/_next/static/"); expect(worker).not.toContain("/api/"); expect(worker).not.toContain("storage");
});
