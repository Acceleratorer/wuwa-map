import type { Profile } from "./types";

function filenameSlug(value: string, fallback: string): string {
  const slug = value
    .normalize("NFD")
    .replace(/[đĐ]/g, (character) => (character === "Đ" ? "D" : "d"))
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || fallback;
}

export function createBackupFilename(
  profile: Pick<Profile, "id" | "name">,
  exportedAt = new Date(),
): string {
  const profileName = filenameSlug(profile.name, "profile");
  const profileId = filenameSlug(profile.id, "unknown");
  const date = exportedAt.toISOString().slice(0, 10);

  return `wayfinder-backup-${profileName}-${profileId}-${date}.json`;
}
