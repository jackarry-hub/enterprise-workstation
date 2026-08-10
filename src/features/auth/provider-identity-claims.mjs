const MATCH_KEY_PREFIXES = Object.freeze({
  openId: "open_id:",
  unionId: "union_id:",
  email: "email:",
});

const MAX_MATCH_KEY_LENGTH = 200;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeProviderIdentifier(kind, value) {
  if (value === undefined || value === null) return null;
  const prefix = MATCH_KEY_PREFIXES[kind];
  if (!prefix || typeof value !== "string") {
    throw new Error("invalid_provider_identifier");
  }
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length === 0 ||
    prefix.length + normalized.length > MAX_MATCH_KEY_LENGTH
  ) {
    throw new Error("invalid_provider_identifier");
  }
  return normalized;
}

export function normalizeProviderEmail(value) {
  const normalized = normalizeProviderIdentifier("email", value);
  if (normalized && !EMAIL_PATTERN.test(normalized)) {
    throw new Error("invalid_provider_email");
  }
  return normalized;
}

export function buildProviderIdentityClaims({
  openId,
  unionId,
  email,
  emailVerified = true,
  ignoreInvalidEmail = false,
}) {
  const normalizedOpenId = normalizeProviderIdentifier("openId", openId);
  const normalizedUnionId = normalizeProviderIdentifier("unionId", unionId);
  let verifiedEmail = null;
  if (emailVerified) {
    try {
      verifiedEmail = normalizeProviderEmail(email);
    } catch (error) {
      if (!ignoreInvalidEmail) throw error;
    }
  }

  const providerMatchKeys = [
    normalizedOpenId
      ? `${MATCH_KEY_PREFIXES.openId}${normalizedOpenId}`
      : null,
    normalizedUnionId
      ? `${MATCH_KEY_PREFIXES.unionId}${normalizedUnionId}`
      : null,
    verifiedEmail ? `${MATCH_KEY_PREFIXES.email}${verifiedEmail}` : null,
  ].filter(Boolean);
  const providerSubject = providerMatchKeys[0] ?? null;
  if (!providerSubject) throw new Error("missing_provider_identity");

  return {
    providerSubject,
    providerMatchKeys,
    normalizedOpenId,
    normalizedUnionId,
    verifiedEmail,
  };
}
