import { createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE_NAME = "wf_session";

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function parseCookies(header) {
  const cookies = new Map();
  if (!header) {
    return cookies;
  }

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    cookies.set(name, value);
  }
  return cookies;
}

export function createSessionCookie(token, maxAgeSeconds, secure) {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${token}`,
    "Path=/wuwa-map/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

export function clearSessionCookie(secure) {
  const attributes = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/wuwa-map/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
  ];
  if (secure) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}
