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

const DESTRUCTIVE_STAGING_COMMANDS = new Set([
  "db:reset:test",
  "db:seed:validate",
  "db:rollback:test",
  "db:test",
]);

function forbidden() {
  return new Error("environment_mutation_forbidden");
}

function normalizeEnvironment(environment) {
  if (typeof environment !== "string") return "Unknown";
  return ENVIRONMENT_NAMES.get(environment.trim().toLowerCase()) ?? "Unknown";
}

function parseDatabaseUrl(databaseUrl) {
  if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") return null;
  try {
    return new URL(databaseUrl);
  } catch {
    return null;
  }
}

function isLocalSupabasePostgres(url) {
  return Boolean(
    url
    && (url.protocol === "postgres:" || url.protocol === "postgresql:")
    && (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]")
    && url.port === "54322",
  );
}

function isStagingPostgres(url) {
  const configuredHost = process.env.QUANTXY_STAGING_DATABASE_HOST;
  const expectedHost = typeof configuredHost === "string"
    ? configuredHost.trim().toLowerCase()
    : "";
  return Boolean(
    url
    && (url.protocol === "postgres:" || url.protocol === "postgresql:")
    && /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/i.test(expectedHost)
    && expectedHost === url.hostname.toLowerCase()
    && url.hostname !== "127.0.0.1"
    && url.hostname !== "localhost"
    && url.hostname !== "[::1]"
    && url.port !== "",
  );
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
  const normalizedEnvironment = normalizeEnvironment(environment);
  if (
    normalizedEnvironment === "Unknown"
    || normalizedEnvironment === "Internal"
    || normalizedEnvironment === "Customer Production"
  ) {
    throw forbidden();
  }

  const url = parseDatabaseUrl(databaseUrl);
  if (normalizedEnvironment === "Local" || normalizedEnvironment === "CI/Test") {
    if (!isLocalSupabasePostgres(url)) throw forbidden();
    return new EnvironmentFingerprint({
      command,
      environment: normalizedEnvironment,
      target: "local_supabase_postgres",
    });
  }

  if (
    normalizedEnvironment !== "Staging"
    || command !== "db:migrate:dry-run"
    || DESTRUCTIVE_STAGING_COMMANDS.has(command)
    || !isStagingPostgres(url)
  ) {
    throw forbidden();
  }

  return new EnvironmentFingerprint({
    command,
    environment: normalizedEnvironment,
    target: "staging_postgres",
  });
}
