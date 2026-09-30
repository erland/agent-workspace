export function isModalAuthenticationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; message?: unknown; code?: unknown };
  const name = typeof candidate.name === "string" ? candidate.name : "";
  const code = typeof candidate.code === "string" ? candidate.code.toUpperCase() : "";
  const message = typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";

  if (name === "AuthError") return true;
  if (code === "UNAUTHENTICATED") return true;

  // Conservative fallback for SDK/version variations. Avoid classifying permission,
  // quota, throttling, timeout or service availability failures as expired credentials.
  return message.includes("unauthenticated")
    || message.includes("invalid authentication")
    || message.includes("invalid token")
    || message.includes("authentication token")
    || message.includes("token has expired")
    || message.includes("token expired");
}
