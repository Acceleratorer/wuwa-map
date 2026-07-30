import type { Profile, ProgressRecord } from "./types";

export interface RemoteSession {
  profile: Profile;
  expiresAt: string;
}

interface ProgressResponse {
  records: ProgressRecord[];
}

const apiBase = `${import.meta.env.BASE_URL}api`;

export class SyncApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === "string") {
      return payload.error;
    }
  } catch {
    // Fall back to a generic message below.
  }
  return `API request thất bại (${response.status}).`;
}

async function apiFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  return fetch(`${apiBase}${path}`, {
    credentials: "include",
    ...options,
    headers: {
      "X-Wayfinder-Client": "web",
      ...options.headers,
    },
  });
}

export class SyncClient {
  async getSession(): Promise<RemoteSession | undefined> {
    const response = await apiFetch("/session");
    if (response.status === 401) {
      return undefined;
    }
    if (!response.ok) {
      throw new SyncApiError(await readError(response), response.status);
    }
    return (await response.json()) as RemoteSession;
  }

  async claimInvite(code: string): Promise<RemoteSession> {
    const response = await apiFetch("/invites/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!response.ok) {
      throw new SyncApiError(await readError(response), response.status);
    }
    return (await response.json()) as RemoteSession;
  }

  async pullProgress(mapId: string): Promise<ProgressRecord[]> {
    const response = await apiFetch(
      `/progress?mapId=${encodeURIComponent(mapId)}`,
    );
    if (!response.ok) {
      throw new SyncApiError(await readError(response), response.status);
    }
    return ((await response.json()) as ProgressResponse).records;
  }

  async pushProgress(
    records: ProgressRecord[],
  ): Promise<ProgressRecord[]> {
    const response = await apiFetch("/progress/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        records: records.map((record) => ({
          mapId: record.mapId,
          markerId: record.markerId,
          done: record.done,
        })),
      }),
    });
    if (!response.ok) {
      throw new SyncApiError(await readError(response), response.status);
    }
    return ((await response.json()) as ProgressResponse).records;
  }

  async logout(): Promise<void> {
    const response = await apiFetch("/logout", { method: "POST" });
    if (!response.ok && response.status !== 204) {
      throw new SyncApiError(await readError(response), response.status);
    }
  }
}
