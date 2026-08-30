import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const READY_ROUTE_SEGMENTS = [
  "people",
  "approvals",
  "analytics",
  "settings",
  "notifications",
  "help",
  "knowledge",
  "assistant",
  "scheduler",
  "agents",
];
const PUBLIC_SOURCE_FILES = [
  "README.md",
  "docs/企业工作站使用说明.md",
  "scripts/build_usage_manual.py",
  "src/app/layout.tsx",
  "src/config/navigation.ts",
  "src/features/help/help-center.tsx",
  "src/app/(workspace)/help/page.tsx",
  "src/features/settings/settings-workspace.tsx",
  "src/features/settings/components/permission-matrix.tsx",
  "src/features/salary/payroll-workspace.tsx",
  "src/features/salary/components/payroll-aside.tsx",
  "src/features/approvals/approvals-workspace.tsx",
  "src/features/approvals/approval-meta.ts",
];

function normalize(value) {
  return value.replaceAll("\\", "/");
}

function relative(root, file) {
  return normalize(path.relative(root, file));
}

async function filesBelow(directory) {
  if (!existsSync(directory)) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(target) : [target];
  }));
  return nested.flat();
}

function isSourceFile(file) {
  return SOURCE_EXTENSIONS.includes(path.extname(file))
    && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);
}

async function resolveSourceImport(root, importer, specifier) {
  if (!(specifier.startsWith("@/") || specifier.startsWith("."))) return null;
  const base = specifier.startsWith("@/")
    ? path.join(root, "src", specifier.slice(2))
    : path.resolve(path.dirname(importer), specifier);
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const metadata = await stat(candidate);
    if (metadata.isFile() && isSourceFile(candidate)) return path.resolve(candidate);
  }
  return null;
}

function importedSpecifiers(source) {
  const values = [];
  const pattern = /(?:from\s*|import\s*\(|require\s*\()\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) values.push(match[1]);
  return values;
}

export async function formalEntryFiles(root = process.cwd()) {
  const files = [
    path.join(root, "src", "middleware.ts"),
    path.join(root, "src", "app", "layout.tsx"),
    path.join(root, "src", "app", "(workspace)", "layout.tsx"),
  ];
  for (const segment of READY_ROUTE_SEGMENTS) {
    files.push(...await filesBelow(path.join(root, "src", "app", "(workspace)", segment)));
  }
  files.push(...await filesBelow(path.join(root, "src", "app", "api", "workstation")));
  files.push(...await filesBelow(path.join(root, "src", "app", "api", "health")));
  return [...new Set(files.filter((file) => existsSync(file) && isSourceFile(file)).map((file) => path.resolve(file)))];
}

export async function scanFormalImports(root = process.cwd()) {
  const queue = await formalEntryFiles(root);
  const visited = new Set();
  const violations = [];

  while (queue.length > 0) {
    const file = queue.shift();
    if (!file || visited.has(file)) continue;
    visited.add(file);
    const source = await readFile(file, "utf8");
    const publicPath = relative(root, file);
    if (/(^|\/)(?:[^/]*(?:mock|fixture)[^/]*)($|\/)/i.test(publicPath)
      || /\/features\/operations\/(?:operations-data|use-operations)\.[^/]+$/i.test(`/${publicPath}`)) {
      violations.push({ kind: "forbidden-production-import", file: publicPath });
    }
    if (/\b(?:localStorage|indexedDB)\b/.test(source)) {
      violations.push({ kind: "browser-business-storage", file: publicPath });
    }
    for (const specifier of importedSpecifiers(source)) {
      const resolved = await resolveSourceImport(root, file, specifier);
      if (resolved && !visited.has(resolved)) queue.push(resolved);
    }
  }

  return {
    entries: (await formalEntryFiles(root)).map((file) => relative(root, file)),
    files: [...visited].map((file) => relative(root, file)).sort(),
    violations: violations.sort((left, right) => left.file.localeCompare(right.file)),
  };
}

function allowlistPatternMatches(file, pattern) {
  const escaped = normalize(pattern)
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "::DOUBLE_STAR::")
    .replaceAll("*", "[^/]*")
    .replaceAll("::DOUBLE_STAR::", ".*");
  return new RegExp(`^${escaped}$`).test(normalize(file));
}

function isAllowlisted(file, allowlist) {
  return allowlist.some((pattern) => allowlistPatternMatches(file, pattern));
}

async function scanFilesForTerms(root, files, terms, allowlist = [], tokenBoundaries = false) {
  if (!terms) return [];
  const pattern = new RegExp(
    tokenBoundaries ? `(?:^|[^A-Za-z_])(?:${terms})(?:$|[^A-Za-z_])` : terms,
    "i",
  );
  const matches = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    const publicPath = relative(root, file);
    if (isAllowlisted(publicPath, allowlist)) continue;
    const source = await readFile(file, "utf8");
    source.split(/\r?\n/).forEach((line, index) => {
      if (pattern.test(line)) matches.push({ file: publicPath, line: index + 1 });
    });
  }
  return matches;
}

export async function scanPublicSourceTerms(root = process.cwd(), terms = "leave|attendance|请假|考勤", allowlist = []) {
  const files = PUBLIC_SOURCE_FILES.map((file) => path.join(root, file));
  const routeFiles = (await filesBelow(path.join(root, "src", "app")))
    .filter((file) => /[\\/](?:page|layout)\.[cm]?[jt]sx?$/.test(file) && isSourceFile(file));
  return scanFilesForTerms(root, [...files, ...routeFiles], terms, allowlist);
}

export async function scanBuiltPublicOutput(root = process.cwd(), terms = "leave|attendance|请假|考勤") {
  const buildRoot = path.join(root, ".next");
  if (!existsSync(buildRoot)) {
    return [{ file: ".next", line: 0, reason: "built-output-missing" }];
  }
  const routeRoots = READY_ROUTE_SEGMENTS.flatMap((segment) => [
    path.join(buildRoot, "server", "app", "(workspace)", segment),
    path.join(buildRoot, "static", "chunks", "app", "(workspace)", segment),
  ]);
  const sharedRoots = [
    path.join(buildRoot, "server", "app", "(workspace)", "layout"),
    path.join(buildRoot, "static", "chunks", "app", "(workspace)", "layout"),
  ];
  const files = (await Promise.all([...routeRoots, ...sharedRoots].map(filesBelow)))
    .flat()
    .filter((file) => /\.(?:js|html|txt|rsc)$/.test(file));
  return scanFilesForTerms(root, files, terms, [], true);
}

function parseArguments(argv) {
  const valueAfter = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  return {
    root: path.resolve(valueAfter("--root") ?? process.cwd()),
    formalImports: argv.includes("--formal-imports") || !argv.some((item) => item.startsWith("--")),
    builtPublicOutput: argv.includes("--built-public-output"),
    terms: valueAfter("--terms") ?? "leave|attendance|请假|考勤",
    allowlist: (valueAfter("--allowlist") ?? "").split(",").map((item) => item.trim()).filter(Boolean),
  };
}

export async function runScan(options) {
  const report = { formalImports: null, publicSourceTerms: [], builtPublicOutput: [] };
  if (options.formalImports) report.formalImports = await scanFormalImports(options.root);
  report.publicSourceTerms = await scanPublicSourceTerms(options.root, options.terms, options.allowlist);
  if (options.builtPublicOutput) {
    report.builtPublicOutput = await scanBuiltPublicOutput(options.root, options.terms);
  }
  const violationCount = (report.formalImports?.violations.length ?? 0)
    + report.publicSourceTerms.length
    + report.builtPublicOutput.length;
  return { status: violationCount === 0 ? "PASS" : "FAIL", violationCount, ...report };
}

async function main() {
  const report = await runScan(parseArguments(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== "PASS") process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
