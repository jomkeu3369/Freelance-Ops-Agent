// Fragment only: never read query parameters, log, or persist an ownership token.
export function verificationTokenFromFragment(fragment) {
  if (typeof fragment !== "string" || !fragment.startsWith("#")) return null;
  const params = new URLSearchParams(fragment.slice(1));
  const tokens = params.getAll("token");
  if (tokens.length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(tokens[0])) return null;
  return tokens[0];
}

export function verificationPasswordError(password, confirmation) {
  if (typeof password !== "string" || password.length < 12 || password.length > 72 || password !== confirmation) return "MISMATCH";
  if (new TextEncoder().encode(password).length > 72) return "UTF8_LENGTH";
  return null;
}
