import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { JSDOM } from "jsdom";

test("keeps a rejected server login visible when the browser autofills again", async () => {
  const html = await readFile(
    path.join(process.cwd(), "quantxy-ai-workbench-fused.html"),
    "utf8",
  );
  let loginAttempts = 0;
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:3011/quantxy-ai-workbench-fused.html",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = async (url) => {
        if (String(url) === "/api/demo-auth/session") {
          return response(true, { authenticated: false });
        }
        if (String(url) === "/api/demo-auth/login") {
          loginAttempts += 1;
          return response(false, { error: "invalid_credentials" });
        }
        return response(false, {});
      };
    },
  });

  await waitFor(() => dom.window.document.querySelector('[data-act="login-submit"]'));
  input(dom, "#loginUser", "admin");
  input(dom, "#loginPass", "bad-password");
  dom.window.document.querySelector('[data-act="login-submit"]').click();

  await waitFor(() => loginAttempts === 1);
  await waitFor(() => dom.window.document.querySelector('[role="alert"]')?.textContent);
  input(dom, "#loginPass", "123456");

  assert.equal(
    dom.window.document.querySelector('[role="alert"]')?.textContent,
    "账号或密码错误，请重新输入",
  );
  dom.window.close();
});

function input(dom, selector, value) {
  const element = dom.window.document.querySelector(selector);
  assert.ok(element);
  element.value = value;
  element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

function response(ok, body) {
  return {
    ok,
    json: async () => body,
  };
}

async function waitFor(read) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for demo login state");
}
