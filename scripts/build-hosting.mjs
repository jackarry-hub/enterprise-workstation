import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = process.cwd();
const isWindows = process.platform === "win32";

if (!isWindows) {
  // Ask Next.js for the standalone server tree OpenNext consumes. Keeping this
  // explicit avoids relying on an internal Next.js environment flag.
  process.env.OPENNEXT_SITES_BUILD = "true";
}

function runBinary(name, args) {
  const executable = join(
    projectRoot,
    "node_modules",
    ".bin",
    `${name}${isWindows ? ".cmd" : ""}`,
  );
  const result = spawnSync(executable, args, {
    cwd: projectRoot,
    env: process.env,
    shell: isWindows,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

runBinary("next", ["build"]);

// The local Windows demo runs with `next start`. Sites builds on Linux and
// needs the Cloudflare-compatible OpenNext bundle plus a stable dist contract.
if (isWindows) process.exit(0);

runBinary("opennextjs-cloudflare", ["build", "--skipNextBuild"]);

const openNextDir = resolve(projectRoot, ".open-next");
const defaultHandler = join(
  openNextDir,
  "server-functions",
  "default",
  "handler.mjs",
);
const distDir = resolve(projectRoot, "dist");
const serverDir = join(distDir, "server");

if (!existsSync(join(openNextDir, "worker.js"))) {
  throw new Error("OpenNext build did not produce .open-next/worker.js");
}

// Sites runs the generated module tree directly. Wrangler would normally turn
// the remaining CommonJS calls for Node built-ins into ESM imports during its
// deploy bundle. Provide that small compatibility layer here so the same tree
// also runs correctly when uploaded without a second, very expensive bundle.
if (existsSync(defaultHandler)) {
  const requireShimMarker = "/* sites-node-require-shim */";
  const handlerSource = readFileSync(defaultHandler, "utf8");
  if (!handlerSource.startsWith(requireShimMarker)) {
    const requireShim = `${requireShimMarker}
import * as __sitesAsyncHooks from "node:async_hooks";
import * as __sitesBuffer from "node:buffer";
import * as __sitesCrypto from "node:crypto";
import * as __sitesFs from "node:fs";
import * as __sitesHttp from "node:http";
import * as __sitesHttps from "node:https";
import * as __sitesPath from "node:path";
import * as __sitesStream from "node:stream";
import * as __sitesStreamWeb from "node:stream/web";
import * as __sitesUrl from "node:url";
import * as __sitesUtil from "node:util";
import * as __sitesVm from "node:vm";
import * as __sitesZlib from "node:zlib";

const __sitesRequireModules = {
  "async_hooks": __sitesAsyncHooks,
  "node:async_hooks": __sitesAsyncHooks,
  "buffer": __sitesBuffer,
  "crypto": __sitesCrypto,
  "node:crypto": __sitesCrypto,
  "fs": __sitesFs,
  "http": __sitesHttp,
  "https": __sitesHttps,
  "path": __sitesPath,
  "node:path": __sitesPath,
  "stream": __sitesStream,
  "node:stream": __sitesStream,
  "node:stream/web": __sitesStreamWeb,
  "url": __sitesUrl,
  "util": __sitesUtil,
  "vm": __sitesVm,
  "node:zlib": __sitesZlib,
  "@builder.io/partytown/integration": {},
};

function require(specifier) {
  const loaded = __sitesRequireModules[specifier];
  if (loaded) return loaded;
  throw new Error(\`Unsupported runtime require: \${specifier}\`);
}
`;
    writeFileSync(defaultHandler, `${requireShim}${handlerSource}`);
  }
}

rmSync(distDir, { force: true, recursive: true });
mkdirSync(serverDir, { recursive: true });
cpSync(openNextDir, serverDir, { recursive: true });
rmSync(join(serverDir, "assets"), { force: true, recursive: true });
cpSync(join(openNextDir, "assets"), join(distDir, "assets"), { recursive: true });
copyFileSync(join(openNextDir, "worker.js"), join(serverDir, "index.js"));

const hostingConfig = join(projectRoot, ".openai", "hosting.json");
if (existsSync(hostingConfig)) {
  const distHostingDir = join(distDir, ".openai");
  mkdirSync(distHostingDir, { recursive: true });
  copyFileSync(hostingConfig, join(distHostingDir, "hosting.json"));
}
