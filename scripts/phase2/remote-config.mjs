import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

const REQUIRED_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_DB_URL",
];

function decodeJwtRole(value) {
  const payload = value.split(".")[1];
  if (!payload) return null;

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).role;
  } catch {
    return null;
  }
}

function isSecretKey(value) {
  return value.startsWith("sb_secret_") || decodeJwtRole(value) === "service_role";
}

export function validateRemoteConfig(env) {
  const values = Object.fromEntries(
    REQUIRED_KEYS.map((key) => [key, env[key]?.trim()]),
  );
  const missing = REQUIRED_KEYS.filter((key) => !values[key]);
  if (missing.length > 0) {
    throw new Error(`Supabase 远程配置缺失：${missing.join(", ")}`);
  }

  let projectUrl;
  try {
    projectUrl = new URL(values.NEXT_PUBLIC_SUPABASE_URL);
  } catch {
    throw new Error("Supabase 远程配置无效：NEXT_PUBLIC_SUPABASE_URL");
  }
  const hostMatch = projectUrl.hostname.match(/^([a-z0-9]+)\.supabase\.co$/);
  if (
    projectUrl.protocol !== "https:"
    || projectUrl.username.length > 0
    || projectUrl.password.length > 0
    || !hostMatch
  ) {
    throw new Error("Supabase 远程配置无效：NEXT_PUBLIC_SUPABASE_URL");
  }

  const publishableKey = values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceRoleKey = values.SUPABASE_SERVICE_ROLE_KEY;
  if (isSecretKey(publishableKey)) {
    throw new Error(
      "Supabase 远程配置无效：NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
  }
  if (!isSecretKey(serviceRoleKey)) {
    throw new Error("Supabase 远程配置无效：SUPABASE_SERVICE_ROLE_KEY");
  }

  let dbUrl;
  try {
    dbUrl = new URL(values.SUPABASE_DB_URL);
  } catch {
    throw new Error("Supabase 远程配置无效：SUPABASE_DB_URL");
  }
  const projectRef = hostMatch[1];
  let databasePassword = "";
  try {
    databasePassword = decodeURIComponent(dbUrl.password);
  } catch {
    throw new Error("Supabase 远程配置无效：SUPABASE_DB_URL");
  }
  if (
    !["postgres:", "postgresql:"].includes(dbUrl.protocol)
    || dbUrl.username.length === 0
    || databasePassword.length === 0
    || /your[-_ ]password|your_database_password/i.test(databasePassword)
    || dbUrl.hostname !== `db.${projectRef}.supabase.co`
    || dbUrl.pathname !== "/postgres"
  ) {
    throw new Error("Supabase 远程配置无效：SUPABASE_DB_URL");
  }

  return {
    url: projectUrl.toString().replace(/\/$/, ""),
    publishableKey,
    serviceRoleKey,
    dbUrl: values.SUPABASE_DB_URL,
    projectRef,
  };
}

export function loadRemoteConfig(cwd = process.cwd()) {
  loadEnvConfig(cwd);
  return validateRemoteConfig(process.env);
}

export function summarizeRemoteConfig(config) {
  return {
    projectRef: config.projectRef,
    projectUrl: `https://${config.projectRef}.supabase.co`,
    publishableKey: "configured",
    serviceRoleKey: "configured",
    databaseUrl: "configured",
  };
}
