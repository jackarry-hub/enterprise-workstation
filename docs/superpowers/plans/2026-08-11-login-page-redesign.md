# 量子星河登录页改版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `/login` 改造成参考图风格的蓝白玻璃拟态企业登录页，同时保持唯一飞书 OAuth 登录入口和现有身份跳转逻辑不变。

**Architecture:** 保留 `src/app/login/page.tsx` 的服务端会话查询与重定向，把视觉内容拆分为无状态的 `LoginHero` 和继续承载服务端表单动作的 `LoginCard`。主视觉使用独立 PNG 资产，布局和响应式规则使用现有 Tailwind CSS 设计令牌完成，不引入新的运行时依赖。

**Tech Stack:** Next.js 15、React 19、Tailwind CSS 4、Shadcn Button、Lucide React、Vitest、Testing Library

## Global Constraints

- 只供量子星河内部使用。
- 页面只显示一个“使用飞书登录”按钮，不显示账号、密码、短信验证码或虚假登录入口。
- 保留 `signInWithFeishu`、现有会话查询、角色落地页跳转和 OAuth Provider 扩展能力。
- 能力文案固定为“项目协同、任务交付、组织协作”，不出现上下班打卡、薪资或审批入口。
- 延续白色、浅蓝渐变、透明卡片和大圆角风格。
- 不新增 Agent、项目、任务或其他第一阶段以外的业务能力。

## File Structure

- Create: `src/features/auth/login-hero.tsx` — 品牌、价值主张、三项能力和科技主视觉。
- Create: `src/features/auth/login-hero.test.tsx` — 保护批准后的业务文案边界。
- Create: `public/login/ai-workstation-hero.png` — 与参考图匹配的蓝白透明科技主视觉。
- Modify: `src/features/auth/login-card.tsx` — 单一飞书登录卡、错误提示和安全说明。
- Modify: `src/features/auth/login-card.test.tsx` — 验证唯一登录动作和安全错误边界。
- Modify: `src/app/login/page.tsx` — 组合桌面横向和移动端纵向布局。
- Create: `design-qa.md` — 记录同尺寸视觉检查结果。

---

### Task 1: 创建品牌能力区和科技主视觉

**Files:**
- Create: `src/features/auth/login-hero.test.tsx`
- Create: `src/features/auth/login-hero.tsx`
- Create: `public/login/ai-workstation-hero.png`

**Interfaces:**
- Consumes: `/brand/quantxy-logo.png` 与生成的 `/login/ai-workstation-hero.png`。
- Produces: 无属性的 `LoginHero()` React 组件，供 `/login` 服务端页面直接渲染。

- [ ] **Step 1: 写失败测试**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LoginHero } from "@/features/auth/login-hero";

describe("LoginHero", () => {
  it("presents the approved flat-work company capabilities", () => {
    render(<LoginHero />);

    expect(screen.getByRole("heading", { name: "高效协同 · 智领未来" })).toBeVisible();
    expect(screen.getByText("项目协同")).toBeVisible();
    expect(screen.getByText("任务交付")).toBeVisible();
    expect(screen.getByText("组织协作")).toBeVisible();
    expect(document.body).not.toHaveTextContent(/打卡|薪资|审批/);
  });
});
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `npm test -- src/features/auth/login-hero.test.tsx --maxWorkers=1`

Expected: FAIL，错误指出 `@/features/auth/login-hero` 不存在。

- [ ] **Step 3: 生成真实主视觉资产**

使用内置图片生成工具和参考图，目标文件为 `public/login/ai-workstation-hero.png`，使用以下完整提示：

```text
Create a production-ready square PNG hero asset for a Chinese enterprise AI workstation login page, visually matching the supplied reference. Center a premium translucent blue glass architectural cube cluster on a circular layered technology platform, with an isometric slightly top-down camera, soft white and ice-blue lighting, crisp transparent acrylic edges, subtle cobalt highlights, a few restrained orbital light trails and tiny floating glass spheres. Keep the object isolated with generous transparent or near-white negative space around all sides so it can overlap a responsive web layout. No text, no logo, no people, no UI controls, no icons, no watermark. Minimal elegant corporate style, pale blue-white palette, high fidelity, clean edges, 1:1 composition, suitable for display around 720 by 720 CSS pixels.
```

- [ ] **Step 4: 实现 LoginHero**

```tsx
import Image from "next/image";
import { CheckCheck, Network, UsersRound } from "lucide-react";

const capabilities = [
  { title: "项目协同", description: "目标清晰对齐，进展实时可见", icon: Network, iconClassName: "from-blue-500 to-blue-400" },
  { title: "任务交付", description: "按成果提交，工作时间地点自由", icon: CheckCheck, iconClassName: "from-cyan-500 to-emerald-400" },
  { title: "组织协作", description: "扁平沟通协同，让信息顺畅流动", icon: UsersRound, iconClassName: "from-indigo-500 to-violet-400" },
] as const;

export function LoginHero() {
  return (
    <section aria-labelledby="login-hero-title" className="relative min-w-0 lg:min-h-[46rem]">
      <div className="relative z-10 flex items-center gap-4">
        <Image src="/brand/quantxy-logo.png" alt="量子星河 QuantXY" width={244} height={72} className="h-auto w-44 object-contain sm:w-52" priority />
        <span aria-hidden="true" className="h-10 w-px bg-slate-300" />
        <p className="text-lg font-semibold text-slate-900 sm:text-xl">AI 企业大脑</p>
      </div>
      <div className="relative z-10 mt-12 max-w-xl lg:mt-20">
        <h1 id="login-hero-title" className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
          高效协同 · <span className="text-blue-600">智领未来</span>
        </h1>
        <p className="mt-5 text-base text-slate-600 sm:text-lg">让目标、任务与成果在同一个工作空间清晰流动</p>
      </div>
      <ul className="relative z-10 mt-10 hidden space-y-6 md:block lg:mt-12">
        {capabilities.map(({ title, description, icon: Icon, iconClassName }) => (
          <li key={title} className="flex items-center gap-5">
            <span className={`grid size-14 place-items-center rounded-2xl bg-linear-to-br text-white shadow-lg ${iconClassName}`}><Icon className="size-6" /></span>
            <span><strong className="block text-lg text-slate-900">{title}</strong><small className="mt-1 block text-sm text-slate-500">{description}</small></span>
          </li>
        ))}
      </ul>
      <Image src="/login/ai-workstation-hero.png" alt="" width={960} height={960} className="pointer-events-none absolute bottom-[-5rem] right-[-4rem] hidden h-auto w-[72%] object-contain lg:block" priority />
    </section>
  );
}
```

- [ ] **Step 5: 运行测试并确认通过**

Run: `npm test -- src/features/auth/login-hero.test.tsx --maxWorkers=1`

Expected: PASS。

- [ ] **Step 6: 提交可独立验收的品牌能力区**

```powershell
git add public/login/ai-workstation-hero.png src/features/auth/login-hero.tsx src/features/auth/login-hero.test.tsx
git commit -m "feat: add login page brand hero"
```

### Task 2: 改造飞书登录卡和响应式页面组合

**Files:**
- Modify: `src/features/auth/login-card.test.tsx`
- Modify: `src/features/auth/login-card.tsx`
- Modify: `src/app/login/page.tsx`

**Interfaces:**
- Consumes: `LoginHero`、`signInWithFeishu`、`getWorkspaceSession`、现有错误码白名单。
- Produces: `/login` 的桌面横向布局和移动端纵向布局；OAuth 行为签名不变。

- [ ] **Step 1: 写失败测试**

将登录卡主用例改为：

```tsx
expect(screen.getByRole("heading", { name: "企业员工登录" })).toBeVisible();
expect(screen.getByRole("button", { name: "使用飞书登录" })).toBeVisible();
expect(screen.getAllByRole("button")).toHaveLength(1);
expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
expect(screen.queryByLabelText(/邮箱|手机号|密码|验证码/)).not.toBeInTheDocument();
expect(screen.getByText("仅限量子星河内部员工使用")).toBeVisible();
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `npm test -- src/features/auth/login-card.test.tsx --maxWorkers=1`

Expected: FAIL，当前卡片标题仍为“登录 AI企业大脑”。

- [ ] **Step 3: 实现单一飞书登录卡**

保留 `loginMessages` 和 `getLoginMessage` 白名单逻辑，将卡片正文替换为：

```tsx
<GlassCard className="w-full max-w-[36rem] rounded-[2rem] border-white/90 bg-white/72 p-8 shadow-[0_28px_80px_rgba(75,120,190,0.16)] sm:p-12">
  <div className="text-center">
    <p className="text-sm font-medium tracking-[0.18em] text-blue-600">QUANTXY WORKSPACE</p>
    <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">企业员工登录</h2>
    <p className="mt-3 text-sm text-slate-500">仅限量子星河内部员工使用</p>
  </div>
  {errorMessage ? <p role="alert" className="mt-6 rounded-xl bg-destructive/8 p-3 text-sm text-destructive">{errorMessage}</p> : null}
  <form action={action} className="mt-10">
    <Button type="submit" size="lg" className="h-14 w-full rounded-xl bg-linear-to-r from-blue-600 to-blue-500 text-base shadow-lg shadow-blue-500/20">使用飞书登录</Button>
  </form>
  <p className="mt-8 border-t border-slate-200/80 pt-6 text-center text-xs leading-5 text-slate-500">登录后将按你的组织身份进入对应工作台</p>
</GlassCard>
```

- [ ] **Step 4: 在 LoginPage 中组合布局**

保留当前会话查询、异常处理和 `redirect(session.landingPath)` 原样，只替换返回的视觉层：

```tsx
<main id="main-content" className="workspace-mesh min-h-screen overflow-hidden px-4 py-4 sm:px-6 lg:p-8">
  <div className="mx-auto grid min-h-[calc(100vh-2rem)] max-w-[1680px] items-center gap-8 rounded-[2rem] border border-white/80 bg-white/28 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,.9)] backdrop-blur-sm lg:grid-cols-[minmax(0,1.5fr)_minmax(28rem,.9fr)] lg:p-14">
    <LoginHero />
    <div className="relative z-10 flex justify-center lg:justify-end">
      <LoginCard action={signInWithFeishu} errorCode={sessionLookupFailed ? "login_unavailable" : error ?? null} />
    </div>
  </div>
</main>
```

- [ ] **Step 5: 运行组件测试和静态检查**

Run: `npm test -- src/features/auth/login-hero.test.tsx src/features/auth/login-card.test.tsx --maxWorkers=1`

Expected: PASS，且测试确认只有一个按钮。

Run: `npm run typecheck && npm run lint`

Expected: 两条命令均退出码 0，无 TypeScript 或 ESLint 错误。

- [ ] **Step 6: 提交可工作的登录页**

```powershell
git add src/app/login/page.tsx src/features/auth/login-card.tsx src/features/auth/login-card.test.tsx
git commit -m "feat: redesign feishu login experience"
```

### Task 3: 生产构建与视觉对照验收

**Files:**
- Create: `design-qa.md`
- Verify: `src/app/login/page.tsx`
- Verify: `src/features/auth/login-hero.tsx`
- Verify: `src/features/auth/login-card.tsx`

**Interfaces:**
- Consumes: 参考图、完成后的 `/login`、桌面视口 1672×941 和移动视口 390×844。
- Produces: 可供用户检查的本地登录页和结论为 `passed` 的视觉验收记录。

- [ ] **Step 1: 运行生产构建**

Run: `npm run build`

Expected: 构建成功，路由清单包含 `/login`。

- [ ] **Step 2: 启动本地预览**

Run: `npm run dev -- --port 3007`

Expected: 登录页可在 Codex Desktop 内置浏览器打开。若当前工具无法控制内置浏览器，需要改用 Playwright 时，先取得用户许可。

- [ ] **Step 3: 进行同尺寸视觉对照**

在 1672×941 下，将参考图和实现截图并排检查：品牌位置、标题字号、左右视觉重心、主视觉尺寸、登录卡宽高、圆角、阴影、背景亮度和按钮位置。修复明显的裁切、拥挤、对齐和对比度差异后，再检查 390×844 下是否首屏可见登录按钮且无横向滚动。

- [ ] **Step 4: 创建视觉验收记录**

```markdown
# Login Design QA

- Reference viewport: 1672×941
- Mobile viewport: 390×844
- Single Feishu action: passed
- Desktop visual structure: passed
- Mobile layout and overflow: passed
- Error-state readability: passed

final result: passed
```

- [ ] **Step 5: 运行最终验证**

Run: `npm test -- src/features/auth/login-hero.test.tsx src/features/auth/login-card.test.tsx --maxWorkers=1 && npm run typecheck && npm run lint && npm run build`

Expected: 所有命令退出码 0。

- [ ] **Step 6: 提交视觉验收记录**

```powershell
git add design-qa.md
git commit -m "docs: record login design verification"
```
