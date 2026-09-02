import { expect, test } from "@playwright/test";

const COMMERCIAL_ROUTES = [
  "/people",
  "/approvals",
  "/dashboard",
  "/settings",
  "/notifications",
  "/help",
  "/knowledge",
  "/assistant",
  "/scheduler",
  "/agents",
] as const;

type AccessibilityIssue = {
  selector: string;
  type: string;
};

for (const route of COMMERCIAL_ROUTES) {
  test(`${route} exposes a named, keyboard-reachable application surface`, async ({ page }) => {
    await page.goto(route, { waitUntil: "networkidle" });
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page).toHaveTitle(/\S/);

    const issues = await page.evaluate(() => {
      const output: AccessibilityIssue[] = [];
      const rendered = (element: Element) => {
        const html = element as HTMLElement;
        const style = window.getComputedStyle(html);
        return html.getClientRects().length > 0
          && style.visibility !== "hidden"
          && style.display !== "none";
      };
      const selector = (element: Element) => {
        const html = element as HTMLElement;
        return html.id ? `#${html.id}` : html.tagName.toLowerCase();
      };
      const referencedText = (element: Element) => (element.getAttribute("aria-labelledby") ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
        .join(" ")
        .trim();
      const controlName = (element: Element) => {
        const html = element as HTMLElement;
        const input = element as HTMLInputElement;
        const label = "labels" in input
          ? [...(input.labels ?? [])].map((item) => item.textContent?.trim() ?? "").join(" ").trim()
          : "";
        return (
          element.getAttribute("aria-label")
          || referencedText(element)
          || label
          || element.getAttribute("title")
          || input.placeholder
          || html.innerText?.trim()
          || ""
        ).trim();
      };

      const ids = new Map<string, number>();
      for (const element of document.querySelectorAll("[id]")) {
        const id = element.id;
        ids.set(id, (ids.get(id) ?? 0) + 1);
      }
      for (const [id, count] of ids) {
        if (count > 1) output.push({ type: "duplicate_id", selector: `#${id}` });
      }

      for (const element of document.querySelectorAll(
        "button,a[href],input:not([type='hidden']),select,textarea,[role='button'],[role='link']",
      )) {
        if (rendered(element) && controlName(element).length === 0) {
          output.push({ type: "unnamed_control", selector: selector(element) });
        }
      }
      for (const image of document.querySelectorAll("img")) {
        if (rendered(image) && !image.hasAttribute("alt")) {
          output.push({ type: "image_without_alt", selector: selector(image) });
        }
      }
      return output;
    });

    expect(issues).toEqual([]);
    await page.keyboard.press("Tab");
    await expect.poll(async () => page.evaluate(() => document.activeElement !== document.body)).toBe(true);
  });
}
