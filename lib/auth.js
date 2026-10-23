import {
  createHmac,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const SESSION_COOKIE = "sg_admin_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const PASSWORD_ALGORITHM = "pbkdf2_sha256";
const PASSWORD_ITERATIONS = 310_000;
const PASSWORD_KEY_LENGTH = 32;

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function configuredUsername() {
  return String(process.env.ADMIN_USERNAME || "").trim();
}

function signingSecret() {
  return String(process.env.SESSION_SECRET || "");
}

function parseCookies(header) {
  return String(header || "")
    .split(";")
    .reduce((cookies, item) => {
      const separator = item.indexOf("=");
      if (separator < 1) return cookies;
      const name = item.slice(0, separator).trim();
      const value = item.slice(separator + 1).trim();
      cookies[name] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function sign(value) {
  return createHmac("sha256", signingSecret()).update(value).digest("base64url");
}

export function createPasswordHash(password, salt = randomBytes(18).toString("base64url")) {
  const digest = pbkdf2Sync(String(password), salt, PASSWORD_ITERATIONS, PASSWORD_KEY_LENGTH, "sha256").toString("base64url");
  return `${PASSWORD_ALGORITHM}$${PASSWORD_ITERATIONS}$${salt}$${digest}`;
}

export function isAuthConfigured() {
  return Boolean(configuredUsername() && process.env.ADMIN_PASSWORD_HASH && signingSecret().length >= 32);
}

export function verifyAdminCredentials(username, password) {
  if (!isAuthConfigured() || !safeEqual(String(username).trim(), configuredUsername())) return false;

  const [algorithm, iterationsValue, salt, expectedDigest] = String(process.env.ADMIN_PASSWORD_HASH).split("$");
  const iterations = Number(iterationsValue);
  if (algorithm !== PASSWORD_ALGORITHM || !salt || !expectedDigest || !Number.isInteger(iterations) || iterations < 100_000 || iterations > 1_000_000) {
    return false;
  }

  const actualDigest = pbkdf2Sync(String(password), salt, iterations, PASSWORD_KEY_LENGTH, "sha256").toString("base64url");
  return safeEqual(actualDigest, expectedDigest);
}

export function createSessionToken(username) {
  if (!isAuthConfigured()) throw new Error("Autenticação não configurada");
  const payload = Buffer.from(JSON.stringify({
    sub: username,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    nonce: randomBytes(12).toString("base64url"),
  })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token) {
  if (!isAuthConfigured() || !token) return null;
  const separator = token.lastIndexOf(".");
  if (separator < 1) return null;
  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!safeEqual(signature, sign(payload))) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!safeEqual(data.sub, configuredUsername()) || !Number.isFinite(data.exp) || data.exp <= Math.floor(Date.now() / 1000)) return null;
    return { username: data.sub };
  } catch {
    return null;
  }
}

export function authenticatedUser(request) {
  const cookies = parseCookies(request.headers?.cookie);
  return verifySessionToken(cookies[SESSION_COOKIE]);
}

export function requireAuth(request, response) {
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (!isAuthConfigured()) {
    response.status(503).json({ error: "Autenticação ainda não configurada" });
    return null;
  }
  const user = authenticatedUser(request);
  if (!user) {
    response.status(401).json({ error: "Autenticação necessária" });
    return null;
  }
  return user;
}

export function setSessionCookie(response, token) {
  const secure = process.env.VERCEL || process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${secure}`);
}

export function clearSessionCookie(response) {
  const secure = process.env.VERCEL || process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

