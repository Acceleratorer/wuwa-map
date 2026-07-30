import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { WayfinderRepository } from "./database.mjs";
import {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  createSessionCookie,
  hashToken,
  parseCookies,
  randomToken,
} from "./security.mjs";

const APP_BASE = "/wuwa_map/";
const API_BASE = "/wuwa_map/api";
const MAX_BODY_BYTES = 64 * 1024;
const ID_PATTERN = /^[a-zA-Z0-9:_-]{1,128}$/;
const INVITE_PATTERN = /^[a-zA-Z0-9_-]{20,100}$/;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

class RateLimiter {
  constructor() {
    this.entries = new Map();
  }

  consume(key, limit, windowMs) {
    const now = Date.now();
    const entry = this.entries.get(key);
    if (!entry || entry.resetAt <= now) {
      this.entries.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (entry.count >= limit) {
      return false;
    }
    entry.count += 1;
    return true;
  }
}

function setSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  response.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ].join("; "),
  );
}

function sendJson(response, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    ...extraHeaders,
  });
  response.end(body);
}

function sendEmpty(response, status, extraHeaders = {}) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  response.end();
}

async function readJson(request) {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Content-Type phải là application/json.");
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      request.resume();
      throw new HttpError(413, "Request body quá lớn.");
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "JSON không hợp lệ.");
  }
}

function getClientIp(request, trustProxy) {
  if (trustProxy) {
    const forwarded = request.headers["x-forwarded-for"];
    if (typeof forwarded === "string") {
      return forwarded.split(",")[0]?.trim() ?? "unknown";
    }
  }
  return request.socket.remoteAddress ?? "unknown";
}

function assertAllowedOrigin(request, allowedOrigins) {
  const origin = request.headers.origin;
  if (typeof origin !== "string" || !allowedOrigins.has(origin)) {
    throw new HttpError(403, "Origin không được phép.");
  }
}

function assertIdentifier(value, fieldName) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new HttpError(400, `${fieldName} không hợp lệ.`);
  }
  return value;
}

function mimeType(pathname) {
  const types = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".webp": "image/webp",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
  };
  return types[extname(pathname).toLowerCase()] ?? "application/octet-stream";
}

async function serveFile(response, filePath, requestMethod) {
  const fileStats = await stat(filePath);
  if (!fileStats.isFile()) {
    throw new HttpError(404, "Không tìm thấy.");
  }

  const isHashedAsset = filePath.includes(`${sep}assets${sep}`);
  const headers = {
    "Content-Type": mimeType(filePath),
    "Content-Length": fileStats.size,
    "Cache-Control": isHashedAsset
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  };
  response.writeHead(200, headers);
  if (requestMethod === "HEAD") {
    response.end();
    return;
  }
  const stream = createReadStream(filePath);
  stream.once("error", () => response.destroy());
  stream.pipe(response);
}

export function createWayfinderServer({
  databasePath = "./data/wayfinder.sqlite",
  distDirectory = "./dist",
  allowedOrigins = [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:8787",
  ],
  cookieSecure = false,
  trustProxy = false,
  sessionDays = 180,
  logger = console,
} = {}) {
  const repository = new WayfinderRepository(databasePath);
  repository.cleanup(Date.now());
  const distRoot = resolve(distDirectory);
  const originSet = new Set(allowedOrigins);
  const rateLimiter = new RateLimiter();
  const sessionMaxAgeSeconds = sessionDays * 24 * 60 * 60;

  function authenticate(request) {
    const token = parseCookies(request.headers.cookie).get(SESSION_COOKIE_NAME);
    if (!token || !INVITE_PATTERN.test(token)) {
      return undefined;
    }
    return repository.getSession(hashToken(token), Date.now());
  }

  async function handleApi(request, response, url) {
    const clientIp = getClientIp(request, trustProxy);
    if (!rateLimiter.consume(`api:${clientIp}`, 180, 60_000)) {
      throw new HttpError(429, "Quá nhiều request. Hãy thử lại sau.");
    }

    const path = url.pathname.slice(API_BASE.length) || "/";

    if (request.method === "GET" && path === "/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "POST" && path === "/invites/claim") {
      assertAllowedOrigin(request, originSet);
      if (!rateLimiter.consume(`claim:${clientIp}`, 10, 10 * 60_000)) {
        throw new HttpError(429, "Quá nhiều lần thử invite.");
      }

      const payload = await readJson(request);
      if (
        typeof payload !== "object" ||
        payload === null ||
        typeof payload.code !== "string" ||
        !INVITE_PATTERN.test(payload.code)
      ) {
        throw new HttpError(400, "Invite code không hợp lệ.");
      }

      const sessionToken = randomToken();
      const now = Date.now();
      const profile = repository.claimInvite({
        codeHash: hashToken(payload.code),
        sessionHash: hashToken(sessionToken),
        sessionExpiresAt: now + sessionMaxAgeSeconds * 1000,
        now,
      });
      if (!profile) {
        throw new HttpError(401, "Invite đã hết hạn hoặc đã được sử dụng.");
      }

      sendJson(response, 200, {
        profile,
        expiresAt: new Date(
          now + sessionMaxAgeSeconds * 1000,
        ).toISOString(),
      }, {
        "Set-Cookie": createSessionCookie(
          sessionToken,
          sessionMaxAgeSeconds,
          cookieSecure,
        ),
      });
      return;
    }

    if (request.method === "POST" && path === "/logout") {
      assertAllowedOrigin(request, originSet);
      const token = parseCookies(request.headers.cookie).get(SESSION_COOKIE_NAME);
      if (token && INVITE_PATTERN.test(token)) {
        repository.deleteSession(hashToken(token));
      }
      sendEmpty(response, 204, {
        "Set-Cookie": clearSessionCookie(cookieSecure),
      });
      return;
    }

    const session = authenticate(request);
    if (!session) {
      throw new HttpError(401, "Thiết bị chưa được xác thực.");
    }

    if (request.method === "GET" && path === "/session") {
      sendJson(response, 200, {
        profile: session.profile,
        expiresAt: new Date(session.expiresAt).toISOString(),
      });
      return;
    }

    if (request.method === "GET" && path === "/progress") {
      const mapId = assertIdentifier(url.searchParams.get("mapId"), "mapId");
      sendJson(response, 200, {
        records: repository.getProgress(session.profile.id, mapId),
      });
      return;
    }

    if (request.method === "POST" && path === "/progress/sync") {
      assertAllowedOrigin(request, originSet);
      const payload = await readJson(request);
      if (
        typeof payload !== "object" ||
        payload === null ||
        !Array.isArray(payload.records) ||
        payload.records.length > 500
      ) {
        throw new HttpError(400, "Danh sách progress không hợp lệ.");
      }

      const records = payload.records.map((record) => {
        if (
          typeof record !== "object" ||
          record === null ||
          typeof record.done !== "boolean"
        ) {
          throw new HttpError(400, "Progress record không hợp lệ.");
        }
        return {
          mapId: assertIdentifier(record.mapId, "mapId"),
          markerId: assertIdentifier(record.markerId, "markerId"),
          done: record.done,
        };
      });

      sendJson(response, 200, {
        records: repository.syncProgress(session.profile.id, records),
      });
      return;
    }

    throw new HttpError(404, "API endpoint không tồn tại.");
  }

  async function handleStatic(request, response, url) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      throw new HttpError(405, "Method không được phép.");
    }
    if (!url.pathname.startsWith(APP_BASE)) {
      throw new HttpError(404, "Không tìm thấy.");
    }

    let relativePath;
    try {
      relativePath = decodeURIComponent(url.pathname.slice(APP_BASE.length));
    } catch {
      throw new HttpError(400, "URL không hợp lệ.");
    }

    const requestedPath = resolve(distRoot, relativePath || "index.html");
    if (
      requestedPath !== distRoot &&
      !requestedPath.startsWith(`${distRoot}${sep}`)
    ) {
      throw new HttpError(403, "Đường dẫn không được phép.");
    }

    try {
      await serveFile(response, requestedPath, request.method);
    } catch (error) {
      if (
        error instanceof HttpError ||
        (error && typeof error === "object" && error.code === "ENOENT")
      ) {
        if (extname(relativePath)) {
          throw new HttpError(404, "Không tìm thấy asset.");
        }
        await serveFile(
          response,
          resolve(distRoot, "index.html"),
          request.method,
        );
        return;
      }
      throw error;
    }
  }

  const server = createServer(async (request, response) => {
    setSecurityHeaders(response);
    try {
      const host = request.headers.host ?? "127.0.0.1";
      const url = new URL(request.url ?? "/", `http://${host}`);
      if (url.pathname.startsWith(API_BASE)) {
        await handleApi(request, response, url);
      } else {
        await handleStatic(request, response, url);
      }
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (error instanceof HttpError) {
        sendJson(response, error.status, { error: error.message });
        return;
      }
      logger.error("Unhandled request error", {
        method: request.method,
        path: request.url,
        error,
      });
      sendJson(response, 500, { error: "Lỗi server nội bộ." });
    }
  });

  return { server, repository };
}
