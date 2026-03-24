const crypto = require("crypto");

const COOKIE_NAME = "admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

function getSecret() {
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || "cambiar-esto-ya";
}

function parseCookies(cookieHeader = "") {
  return cookieHeader
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((acc, item) => {
      const index = item.indexOf("=");
      if (index === -1) return acc;
      const key = item.slice(0, index).trim();
      const value = item.slice(index + 1).trim();
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function b64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function sign(value) {
  return crypto.createHmac("sha256", getSecret()).update(value).digest("hex");
}

function createSessionToken() {
  const payload = {
    role: "admin",
    exp: Date.now() + SESSION_TTL_SECONDS * 1000
  };

  const encoded = b64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

function verifySessionToken(token) {
  if (!token || !token.includes(".")) return false;

  const [encoded, signature] = token.split(".");
  const expected = sign(encoded);

  const validSignature = crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );

  if (!validSignature) return false;

  try {
    const payload = JSON.parse(Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return payload.exp > Date.now();
  } catch {
    return false;
  }
}

function getSessionFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  return verifySessionToken(cookies[COOKIE_NAME]);
}

function setAuthCookie(res, req) {
  const token = createSessionToken();
  const secure = (req.headers["x-forwarded-proto"] || "").includes("https") || process.env.NODE_ENV === "production";
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure ? "; Secure" : ""}`);
}

function clearAuthCookie(res, req) {
  const secure = (req.headers["x-forwarded-proto"] || "").includes("https") || process.env.NODE_ENV === "production";
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`);
}

function requireAuth(req, res, next) {
  if (getSessionFromRequest(req)) return next();
  return res.status(401).json({ error: "No autorizado" });
}

module.exports = {
  COOKIE_NAME,
  getSessionFromRequest,
  setAuthCookie,
  clearAuthCookie,
  requireAuth
};
