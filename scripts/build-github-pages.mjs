import { existsSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const apiDirectory = path.join(root, "src", "app", "api");
const authCallbackDirectory = path.join(root, "src", "app", "auth", "callback");
const loginDirectory = path.join(root, "src", "app", "login");
const accessPendingDirectory = path.join(root, "src", "app", "access-pending");
const authActionsFile = path.join(root, "src", "features", "auth", "actions.ts");
const projectActionsDirectory = path.join(root, "src", "features", "projects", "actions");
const middlewareFile = path.join(root, "src", "middleware.ts");
const backupDirectory = path.join(root, ".github-pages-backup");

async function runBuild() {
  const command = process.platform === "win32"
    ? "cmd.exe"
    : path.join(root, "node_modules", ".bin", "next");
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "node_modules\\.bin\\next.cmd build"]
    : ["build"];
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: {
        ...process.env,
        CUSTOMER_DEMO_MODE: "true",
        GITHUB_PAGES: "true",
        NEXT_PUBLIC_STATIC_AI_DEMO: "true",
      },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`GitHub Pages build failed with exit code ${code}`)));
  });
}

await rm(backupDirectory, { recursive: true, force: true });
await mkdir(backupDirectory, { recursive: true });

try {
  if (existsSync(apiDirectory)) await cp(apiDirectory, path.join(backupDirectory, "api"), { recursive: true });
  if (existsSync(authCallbackDirectory)) await cp(authCallbackDirectory, path.join(backupDirectory, "auth-callback"), { recursive: true });
  if (existsSync(loginDirectory)) await cp(loginDirectory, path.join(backupDirectory, "login"), { recursive: true });
  if (existsSync(accessPendingDirectory)) await cp(accessPendingDirectory, path.join(backupDirectory, "access-pending"), { recursive: true });
  if (existsSync(authActionsFile)) await cp(authActionsFile, path.join(backupDirectory, "auth-actions.ts"));
  if (existsSync(projectActionsDirectory)) await cp(projectActionsDirectory, path.join(backupDirectory, "project-actions"), { recursive: true });
  if (existsSync(middlewareFile)) await cp(middlewareFile, path.join(backupDirectory, "middleware.ts"));
  await rm(apiDirectory, { recursive: true, force: true });
  await rm(authCallbackDirectory, { recursive: true, force: true });
  await rm(loginDirectory, { recursive: true, force: true });
  await rm(accessPendingDirectory, { recursive: true, force: true });
  await writeFile(authActionsFile, [
    "export async function signInWithFeishu() {}",
    "export async function signOut() {}",
    "",
  ].join("\n"));
  await mkdir(projectActionsDirectory, { recursive: true });
  await writeFile(path.join(projectActionsDirectory, "create-project-milestone.ts"), [
    "import type { Milestone } from '@/features/projects/types';",
    "export type CreateMilestoneInput = { projectPublicId: string; ownerMembershipId: string; name: string; startDate?: string; dueDate: string; progress: number; };",
    "export type CreateMilestoneResult = { ok: true; milestone: Milestone } | { ok: false; reason: 'invalid' | 'unavailable' | 'failed'; message: string };",
    "export async function createProjectMilestone(input: CreateMilestoneInput): Promise<CreateMilestoneResult> { void input; return { ok: false, reason: 'unavailable', message: '演示数据保存在当前浏览器。' }; }",
    "",
  ].join("\n"));
  await rm(middlewareFile, { force: true });
  await runBuild();
} finally {
  if (existsSync(path.join(backupDirectory, "api"))) {
    await mkdir(path.dirname(apiDirectory), { recursive: true });
    await cp(path.join(backupDirectory, "api"), apiDirectory, { recursive: true });
  }
  if (existsSync(path.join(backupDirectory, "auth-callback"))) {
    await mkdir(path.dirname(authCallbackDirectory), { recursive: true });
    await cp(path.join(backupDirectory, "auth-callback"), authCallbackDirectory, { recursive: true });
  }
  if (existsSync(path.join(backupDirectory, "login"))) {
    await mkdir(path.dirname(loginDirectory), { recursive: true });
    await cp(path.join(backupDirectory, "login"), loginDirectory, { recursive: true });
  }
  if (existsSync(path.join(backupDirectory, "access-pending"))) {
    await mkdir(path.dirname(accessPendingDirectory), { recursive: true });
    await cp(path.join(backupDirectory, "access-pending"), accessPendingDirectory, { recursive: true });
  }
  if (existsSync(path.join(backupDirectory, "auth-actions.ts"))) {
    await mkdir(path.dirname(authActionsFile), { recursive: true });
    await cp(path.join(backupDirectory, "auth-actions.ts"), authActionsFile);
  }
  if (existsSync(path.join(backupDirectory, "project-actions"))) {
    await mkdir(path.dirname(projectActionsDirectory), { recursive: true });
    await cp(path.join(backupDirectory, "project-actions"), projectActionsDirectory, { recursive: true });
  }
  if (existsSync(path.join(backupDirectory, "middleware.ts"))) {
    await cp(path.join(backupDirectory, "middleware.ts"), middlewareFile);
  }
  await rm(backupDirectory, { recursive: true, force: true });
}
