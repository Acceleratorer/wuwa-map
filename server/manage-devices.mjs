import { WayfinderRepository } from "./database.mjs";

function printUsage() {
  console.log("Usage:");
  console.log("  pnpm devices list [profile]");
  console.log("  pnpm devices revoke <session-id>");
  console.log("  pnpm devices revoke-all <profile> --confirm");
}

function formatDate(timestamp) {
  return new Date(timestamp).toISOString();
}

const [command = "list", argument, confirmation] = process.argv.slice(2);
const repository = new WayfinderRepository(
  process.env.DATABASE_PATH ?? "./data/wayfinder.sqlite",
);

try {
  repository.cleanup(Date.now());

  if (command === "list") {
    const sessions = repository.listSessions({
      profileId: argument,
    });
    if (sessions.length === 0) {
      console.log("Không có thiết bị đang hoạt động.");
    } else {
      console.table(
        sessions.map((session) => ({
          session: session.id,
          profile: `${session.profileName} (${session.profileId})`,
          created: formatDate(session.createdAt),
          lastSeen: formatDate(session.lastSeenAt),
          expires: formatDate(session.expiresAt),
        })),
      );
    }
  } else if (command === "revoke") {
    if (!argument) {
      printUsage();
      process.exitCode = 1;
    } else {
      const deleted = repository.revokeSessionByPrefix(argument);
      if (deleted === 0) {
        throw new Error("Không tìm thấy session tương ứng.");
      }
      console.log(`Đã thu hồi thiết bị ${argument}.`);
    }
  } else if (command === "revoke-all") {
    if (!argument || confirmation !== "--confirm") {
      printUsage();
      process.exitCode = 1;
    } else {
      const deleted = repository.revokeSessionsByProfile(argument);
      console.log(
        `Đã thu hồi ${deleted} thiết bị của profile ${argument}.`,
      );
    }
  } else {
    printUsage();
    process.exitCode = 1;
  }
} finally {
  repository.close();
}
