const ENVIRONMENT_NAMES = new Map([
  ["local", "Local"],
  ["ci", "CI/Test"],
  ["test", "CI/Test"],
  ["ci/test", "CI/Test"],
  ["staging", "Staging"],
  ["internal", "Internal"],
  ["production", "Customer Production"],
  ["customer production", "Customer Production"],
  ["customer-production", "Customer Production"],
]);

const CANONICAL_DATABASE_COMMANDS = new Set([
  "db:reset:test",
  "db:migrate:dry-run",
  "db:test",
  "db:seed:validate",
  "db:rollback:test",
]);

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const ALLOWED_STAGING_SSLMODES = new Set(["require", "verify-ca", "verify-full"]);

function forbidden() {
  return new Error("environment_mutation_forbidden");
}

function commandForbidden() {
  return new Error("database_command_forbidden");
}

function normalizeEnvironment(environment) {
  if (typeof environment !== "string") return "Unknown";
  return ENVIRONMENT_NAMES.get(environment.trim().toLowerCase()) ?? "Unknown";
}

function parseDatabaseUrl(databaseUrl) {
  if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") return null;
  const raw = databaseUrl.trim();
  try {
    return { raw, url: new URL(raw) };
  } catch {
    return null;
  }
}

function isPostgresConnection(parsed) {
  return Boolean(
    parsed
    && (parsed.url.protocol === "postgres:" || parsed.url.protocol === "postgresql:")
    && parsed.url.hash === ""
    && !parsed.raw.includes("#")
    && !parsed.url.hostname.includes(",")
    && !parsed.url.host.includes(","),
  );
}

function isExactLocalSupabasePostgres(parsed) {
  if (!isPostgresConnection(parsed) || parsed.raw.includes("?")) return false;
  const { url } = parsed;
  return LOCAL_HOSTS.has(url.hostname.toLowerCase())
    && url.port === "54322"
    && url.pathname === "/postgres"
    && url.username === "postgres";
}

function readStagingFingerprint(environment = process.env) {
  const values = Object.fromEntries([
    ["host", environment.QUANTXY_STAGING_DATABASE_HOST],
    ["port", environment.QUANTXY_STAGING_DATABASE_PORT],
    ["name", environment.QUANTXY_STAGING_DATABASE_NAME],
    ["user", environment.QUANTXY_STAGING_DATABASE_USER],
    ["sslmode", environment.QUANTXY_STAGING_DATABASE_SSLMODE],
  ].map(([key, value]) => [key, typeof value === "string" ? value.trim() : ""]));
  if (Object.values(values).some((value) => value === "")) return null;

  const validHost = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(values.host);
  const validPort = /^[1-9][0-9]{0,4}$/.test(values.port)
    && Number(values.port) <= 65535;
  const validNameAndUser = /^[a-zA-Z0-9_.-]+$/.test(values.name)
    && /^[a-zA-Z0-9_.-]+$/.test(values.user);
  if (
    !validHost
    || LOCAL_HOSTS.has(values.host.toLowerCase())
    || !validPort
    || !validNameAndUser
    || !ALLOWED_STAGING_SSLMODES.has(values.sslmode)
  ) {
    return null;
  }

  return {
    host: values.host.toLowerCase(),
    port: values.port,
    name: values.name,
    user: values.user,
    sslmode: values.sslmode,
  };
}

function hasOnlyConfiguredStagingTlsQuery(parsed, staging) {
  const { raw, url } = parsed;
  if (!raw.includes("?") || url.search === "") return false;
  if (url.search !== `?sslmode=${staging.sslmode}`) return false;
  const entries = [...url.searchParams.entries()];
  return entries.length === 1 && entries[0][0] === "sslmode" && entries[0][1] === staging.sslmode;
}

function isExactStagingPostgres(parsed) {
  if (!isPostgresConnection(parsed)) return false;
  const staging = readStagingFingerprint();
  if (!staging) return false;
  const { url } = parsed;
  return url.hostname.toLowerCase() === staging.host
    && url.port === staging.port
    && url.pathname === `/${staging.name}`
    && url.username === staging.user
    && hasOnlyConfiguredStagingTlsQuery(parsed, staging);
}

export class EnvironmentFingerprint {
  constructor({ command, environment, target }) {
    this.command = command;
    this.environment = environment;
    this.target = target;
    Object.freeze(this);
  }

  toJSON() {
    return {
      command: this.command,
      environment: this.environment,
      target: this.target,
    };
  }
}

export function assertSafeDatabaseTarget({ command, environment, databaseUrl }) {
  if (typeof command !== "string" || !CANONICAL_DATABASE_COMMANDS.has(command)) {
    throw commandForbidden();
  }

  const normalizedEnvironment = normalizeEnvironment(environment);
  if (
    normalizedEnvironment === "Unknown"
    || normalizedEnvironment === "Internal"
    || normalizedEnvironment === "Customer Production"
  ) {
    throw forbidden();
  }

  const parsed = parseDatabaseUrl(databaseUrl);
  if (normalizedEnvironment === "Local" || normalizedEnvironment === "CI/Test") {
    if (!isExactLocalSupabasePostgres(parsed)) throw forbidden();
    return new EnvironmentFingerprint({
      command,
      environment: normalizedEnvironment,
      target: "local_supabase_postgres",
    });
  }

  if (
    normalizedEnvironment !== "Staging"
    || command !== "db:migrate:dry-run"
    || !isExactStagingPostgres(parsed)
  ) {
    throw forbidden();
  }

  return new EnvironmentFingerprint({
    command,
    environment: normalizedEnvironment,
    target: "staging_postgres",
  });
}
