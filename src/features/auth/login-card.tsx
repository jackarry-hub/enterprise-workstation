import Image from "next/image";

import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";

const loginMessages: Readonly<Record<string, string>> = {
  login_unavailable: "登录服务暂时不可用，请稍后重试。",
  callback_failed: "登录没有完成，请重新尝试。",
};

export function LoginCard({
  action,
  errorCode,
}: {
  action: () => Promise<void>;
  errorCode: string | null;
}) {
  const errorMessage = errorCode ? loginMessages[errorCode] : null;

  return (
    <GlassCard className="w-full max-w-md p-7 sm:p-9">
      <Image
        src="/brand/quantxy-mark.png"
        alt="量子星河 QuantXY"
        width={573}
        height={381}
        className="mx-auto h-16 w-24 object-contain"
        priority
      />
      <div className="mt-5 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          登录 AI企业大脑
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          仅限量子星河内部员工使用
        </p>
      </div>
      {errorMessage ? (
        <p
          role="alert"
          className="mt-5 rounded-xl bg-destructive/8 p-3 text-sm text-destructive"
        >
          {errorMessage}
        </p>
      ) : null}
      <form action={action} className="mt-6">
        <Button type="submit" size="lg" className="w-full">
          使用飞书登录
        </Button>
      </form>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        登录后将按你的企业身份进入对应岗位工作台。
      </p>
    </GlassCard>
  );
}
