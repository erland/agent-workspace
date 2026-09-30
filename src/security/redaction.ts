const GENERIC_SECRET_PATTERNS: readonly RegExp[] = [
  /(authorization\s*:\s*bearer\s+)[^\s]+/gi,
  /((?:MODAL_TOKEN_SECRET|MODAL_TOKEN_ID|OAUTH_REFRESH_TOKEN|CLIENT_SECRET|ACCESS_TOKEN|REFRESH_TOKEN)\s*[=:]\s*)[^\s"']+/gi,
  /\b(?:ov|oc|ak|sk)-[A-Za-z0-9._~-]{8,}\b/g
];

export function redactSensitiveText(text: string, secretValues: readonly string[] = []): string {
  let result = text;
  for (const secret of secretValues) {
    if (secret.length < 4) continue;
    result = result.split(secret).join("[REDACTED]");
  }
  for (const pattern of GENERIC_SECRET_PATTERNS) {
    result = result.replace(pattern, (_match, prefix?: string) =>
      typeof prefix === "string" ? `${prefix}[REDACTED]` : "[REDACTED]"
    );
  }
  return result;
}
