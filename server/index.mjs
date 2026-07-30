import { createWayfinderServer } from "./app.mjs";

function parseBoolean(value, fallback) {
  if (value === undefined) {
    return fallback;
  }
  return value === "true";
}

function parsePositiveNumber(value, fallback, name) {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return parsed;
}

const host = process.env.HOST ?? "127.0.0.1";
const port = parsePositiveNumber(process.env.PORT, 8787, "PORT");
const sessionDays = parsePositiveNumber(
  process.env.SESSION_DAYS,
  3650,
  "SESSION_DAYS",
);
const appOrigins = (process.env.APP_ORIGIN ??
  "http://127.0.0.1:8787,http://127.0.0.1:5173,http://localhost:5173")
  .split(",")
  .map((origin) => new URL(origin.trim()).origin);

const { server, repository } = createWayfinderServer({
  databasePath: process.env.DATABASE_PATH ?? "./data/wayfinder.sqlite",
  distDirectory: "./dist",
  allowedOrigins: appOrigins,
  cookieSecure: parseBoolean(
    process.env.COOKIE_SECURE,
    process.env.NODE_ENV === "production",
  ),
  trustProxy: parseBoolean(process.env.TRUST_PROXY, false),
  sessionDays,
});

server.listen(port, host, () => {
  console.log(`Wayfinder listening on http://${host}:${port}/wuwa-map/`);
});

function shutdown() {
  server.close(() => {
    repository.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
