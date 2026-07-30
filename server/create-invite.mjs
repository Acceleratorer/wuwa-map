import { WayfinderRepository } from "./database.mjs";
import { hashToken, randomToken } from "./security.mjs";

const profileId = process.argv[2] ?? "friend";
const hours = Number(process.argv[3] ?? "72");
if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 30) {
  throw new Error("Invite hours phải nằm trong khoảng 1 đến 720.");
}

const repository = new WayfinderRepository(
  process.env.DATABASE_PATH ?? "./data/wayfinder.sqlite",
);

try {
  const code = randomToken(24);
  const now = Date.now();
  const expiresAt = now + hours * 60 * 60 * 1000;
  const profile = repository.createInvite({
    codeHash: hashToken(code),
    profileId,
    expiresAt,
    now,
  });

  const appOrigin = new URL(
    (process.env.APP_ORIGIN ?? "http://127.0.0.1:8787").split(",")[0].trim(),
  );
  const inviteUrl = new URL("/wuwa-map/", appOrigin);
  inviteUrl.searchParams.set("invite", code);

  console.log(`Profile: ${profile.name} (${profile.id})`);
  console.log(`Expires: ${new Date(expiresAt).toISOString()}`);
  console.log(`Invite: ${inviteUrl.href}`);
} finally {
  repository.close();
}
