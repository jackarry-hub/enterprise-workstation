import { createHash, timingSafeEqual } from "node:crypto";

export type DemoAuthEnv = {
  username: string;
  password: string;
  tenantId: string;
  signingKey: Uint8Array;
};

const UUID_PATTERN =
  /^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function getDemoAuthEnv(): DemoAuthEnv {
  const username = process.env.WORKSTATION_DEMO_USERNAME?.trim() || "admin";
  const password = process.env.WORKSTATION_DEMO_PASSWORD?.trim() || "";
  const tenantId = process.env.WORKSTATION_DEMO_TENANT_ID?.trim() || "";
  const encodedMasterKey = process.env.AI_CONFIG_ENCRYPTION_KEY?.trim() || "";

  const missing = [
    !password && "WORKSTATION_DEMO_PASSWORD",
    !tenantId && "WORKSTATION_DEMO_TENANT_ID",
    !encodedMasterKey && "AI_CONFIG_ENCRYPTION_KEY",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`演示登录服务端配置缺失：${missing.join(", ")}`);
  }
  if (!isSafeUsername(username) || password.length < 6 || password.length > 200) {
    throw new Error("演示登录服务端配置无效：WORKSTATION_DEMO_USERNAME 或 WORKSTATION_DEMO_PASSWORD");
  }
  if (!UUID_PATTERN.test(tenantId)) {
    throw new Error("演示登录服务端配置无效：WORKSTATION_DEMO_TENANT_ID");
  }

  const masterKey = decode32ByteKey(encodedMasterKey);
  if (!masterKey) {
    throw new Error("演示登录服务端配置无效：AI_CONFIG_ENCRYPTION_KEY");
  }

  const signingKey = createHash("sha256")
    .update("quantxy-demo-session-v1\0", "utf8")
    .update(masterKey)
    .digest();

  return {
    username,
    password,
    tenantId,
    signingKey: new Uint8Array(signingKey),
  };
}

export function verifyDemoCredentials(
  username: string,
  password: string,
  env: DemoAuthEnv,
) {
  return safeTextEqual(username.trim(), env.username)
    && safeTextEqual(password, env.password);
}

function safeTextEqual(actual: string, expected: string) {
  const actualDigest = createHash("sha256").update(actual, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

function isSafeUsername(value: string) {
  return value.length >= 1
    && value.length <= 64
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function decode32ByteKey(value: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    return null;
  }
  try {
    const decoded = Buffer.from(value, "base64");
    return decoded.length === 32 ? decoded : null;
  } catch {
    return null;
  }
}
