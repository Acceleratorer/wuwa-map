import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createWayfinderServer } from "./app.mjs";
import { hashToken } from "./security.mjs";

const origin = "http://wayfinder.test";
const tempDirectory = mkdtempSync(join(tmpdir(), "wayfinder-server-"));
const databasePath = join(tempDirectory, "test.sqlite");
const silentLogger = { error() {} };
const { server, repository } = createWayfinderServer({
  databasePath,
  distDirectory: join(tempDirectory, "missing-dist"),
  allowedOrigins: [origin],
  cookieSecure: false,
  logger: silentLogger,
});

let baseUrl;

before(async () => {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not expose a TCP address.");
  }
  baseUrl = `http://127.0.0.1:${address.port}/wuwa_map/api`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  repository.close();
  rmSync(tempDirectory, { recursive: true, force: true });
});

async function api(path, options = {}) {
  return fetch(`${baseUrl}${path}`, options);
}

function jsonHeaders() {
  return {
    "Content-Type": "application/json",
    Origin: origin,
  };
}

test("one-time invite creates a session and syncs authorized progress", async () => {
  const anonymous = await api("/session");
  assert.equal(anonymous.status, 401);

  const inviteCode = "test_invite_code_1234567890";
  const now = Date.now();
  repository.createInvite({
    codeHash: hashToken(inviteCode),
    profileId: "friend",
    expiresAt: now + 60_000,
    now,
  });

  const claim = await api("/invites/claim", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ code: inviteCode }),
  });
  assert.equal(claim.status, 200);
  const claimBody = await claim.json();
  assert.equal(claimBody.profile.id, "friend");

  const setCookie = claim.headers.get("set-cookie");
  assert.ok(setCookie?.includes("HttpOnly"));
  assert.ok(setCookie?.includes("SameSite=Strict"));
  const cookie = setCookie.split(";")[0];

  const reusedInvite = await api("/invites/claim", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ code: inviteCode }),
  });
  assert.equal(reusedInvite.status, 401);

  const session = await api("/session", {
    headers: { Cookie: cookie },
  });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).profile.id, "friend");

  const unauthorizedSync = await api("/progress/sync", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ records: [] }),
  });
  assert.equal(unauthorizedSync.status, 401);

  const sync = await api("/progress/sync", {
    method: "POST",
    headers: { ...jsonHeaders(), Cookie: cookie },
    body: JSON.stringify({
      records: [
        {
          mapId: "clean-room-demo",
          markerId: "demo-chest-01",
          done: true,
        },
      ],
    }),
  });
  assert.equal(sync.status, 200);
  const syncBody = await sync.json();
  assert.equal(syncBody.records.length, 1);
  assert.equal(syncBody.records[0].done, true);
  assert.equal(syncBody.records[0].pendingSync, false);

  const progress = await api("/progress?mapId=clean-room-demo", {
    headers: { Cookie: cookie },
  });
  assert.equal(progress.status, 200);
  const progressBody = await progress.json();
  assert.equal(progressBody.records.length, 1);
  assert.equal(progressBody.records[0].markerId, "demo-chest-01");
  assert.deepEqual(
    repository.getProgress("owner", "clean-room-demo"),
    [],
  );

  const logout = await api("/logout", {
    method: "POST",
    headers: { Origin: origin, Cookie: cookie },
  });
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get("set-cookie") ?? "", /Max-Age=0/);

  const expiredSession = await api("/session", {
    headers: { Cookie: cookie },
  });
  assert.equal(expiredSession.status, 401);
});

test("state-changing endpoints reject foreign origins and invalid input", async () => {
  const invalidOrigin = await api("/invites/claim", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://attacker.example",
    },
    body: JSON.stringify({ code: "test_invite_code_1234567890" }),
  });
  assert.equal(invalidOrigin.status, 403);

  const invalidBody = await api("/invites/claim", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ code: "short" }),
  });
  assert.equal(invalidBody.status, 400);

  const wrongContentType = await api("/invites/claim", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "text/plain" },
    body: "{}",
  });
  assert.equal(wrongContentType.status, 415);
});
