import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const root = process.cwd();
const htmlPath = path.join(root, "quantxy-ai-workbench-fused.html");

async function loadUpdateAiConfig({ crypto, fetch }) {
  const html = await readFile(htmlPath, "utf8");
  const start = html.indexOf("var AI_CONFIG_REQUEST_ID_PATTERN=");
  const end = html.indexOf("function stripFence", start);
  assert.notEqual(start, -1, "AI config save must define a secure request-id contract");
  assert.notEqual(end, -1, "AI config save source must have a bounded function region");

  const context = {
    window: { crypto },
    S: {
      aiConfig: { saving: false, error: "", model: "deepseek-chat", loaded: false },
      aiKeyDraft: "",
      showKey: false,
      aiTest: null,
    },
    LOGIN: { authenticated: true },
    el: () => null,
    toast: () => {},
    render: () => {},
    fetch,
    applyAiConfig: () => {},
    aiConfigError: () => "request failed",
    expireSession: () => {},
    JSON,
    Error,
    Promise,
  };
  vm.createContext(context);
  new vm.Script(html.slice(start, end)).runInContext(context);
  return context;
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test("AI config save sends the one secure UUID generated for its attempt as Idempotency-Key", async () => {
  const requestId = "40000000-0000-4000-8000-000000000010";
  let generated = 0;
  const requests = [];
  const context = await loadUpdateAiConfig({
    crypto: {
      randomUUID() {
        generated += 1;
        return requestId;
      },
    },
    fetch(url, init) {
      requests.push({ url, init });
      return Promise.resolve({
        status: 200,
        ok: true,
        text: async () => JSON.stringify({ model: "deepseek-chat" }),
      });
    },
  });

  context.updateAiConfig(false);
  await flush();

  assert.equal(generated, 1, "one save attempt generates one UUID");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/ai/config");
  assert.equal(requests[0].init.headers["Idempotency-Key"], requestId);
  assert.match(requests[0].init.headers["Idempotency-Key"], /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test("AI config save fails closed when secure UUID generation is unavailable", async () => {
  let fetchCalled = false;
  const messages = [];
  const context = await loadUpdateAiConfig({
    crypto: {},
    fetch() {
      fetchCalled = true;
      return Promise.resolve({ status: 200, ok: true, text: async () => "{}" });
    },
  });
  context.toast = (message) => messages.push(message);

  context.updateAiConfig(false);
  await flush();

  assert.equal(fetchCalled, false);
  assert.equal(context.S.aiConfig.saving, false);
  assert.match(String(messages[0]), /安全请求标识/);
});
