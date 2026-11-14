import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { NextcloudError } from "../src/lib/nextcloud/errors";

process.env.NEXTCLOUD_MODE = "simulation";

type Account = { id: string; panelUserId: string; ncUsername: string; ncEmail: string; ncDisplayName: string; planCode: string; quotaBytes: bigint; status: string; provisionedAt: Date; lastSyncedAt: Date | null };
let account: Account | null = null;
let remote: ReturnType<typeof ncUser> | null = null;
let createCount = 0;
let passwordEdits = 0;
let failCreate = false;
let createError: NextcloudError | null = null;
let failReservation = false;
let failMarkCreated = false;
let failVerification = false;
let wrongVerifiedQuota = false;
let failQuota = false;
let failPersistence = false;
let assignedQuota = "";
let lastPassword = "";

function ncUser(email = "owner@example.test") {
  return { id: "new-user", email, displayname: "Owner", enabled: true,
    quota: { quota: 100 * 1024 * 1024, total: 100 * 1024 * 1024, free: 100 * 1024 * 1024, used: 0, relative: 0 },
    lastLoginAt: null, createdAt: null };
}

const fakeDb = {
  driveAccount: {
    findFirst: async () => account,
    findUnique: async () => account,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      if (failReservation) throw new Error("PostgreSQL unavailable");
      account = { id: "reserved", panelUserId: String(data.panelUserId), ncUsername: String(data.ncUsername),
        ncEmail: String(data.ncEmail), ncDisplayName: String(data.ncDisplayName), planCode: String(data.planCode),
        quotaBytes: data.quotaBytes as bigint, status: String(data.status), provisionedAt: new Date(), lastSyncedAt: null };
      return account;
    },
    update: async ({ data }: { data: { status?: string; lastSyncedAt?: Date } }) => {
      if (failMarkCreated && data.status === "provisioning_created") throw new Error("PostgreSQL unavailable");
      if (failPersistence && data.status === "active") throw new Error("PostgreSQL unavailable");
      if (!account) throw new Error("No reservation");
      if (data.status) account.status = data.status;
      if (data.lastSyncedAt) account.lastSyncedAt = data.lastSyncedAt;
      return account;
    },
  },
  driveEvent: { findMany: async () => [] },
};

const fakeClient = {
  getUser: async () => {
    if (failVerification && account?.status === "provisioning_created") throw new NextcloudError("NC_UNREACHABLE");
    if (wrongVerifiedQuota && account?.status === "provisioning_created" && remote) {
      return { ...remote, quota: { ...remote.quota, quota: 0 } };
    }
    return remote;
  },
  createUser: async ({ password }: { password: string }) => {
    createCount++;
    lastPassword = password;
    if (createError) throw createError;
    if (failCreate) throw new NextcloudError("NC_ERROR");
    remote = ncUser();
    return { userid: "new-user" };
  },
  editUser: async (_id: string, key: string) => { if (key === "password") passwordEdits++; },
  setQuota: async (_id: string, quota: string) => {
    assignedQuota = quota;
    if (failQuota) throw new NextcloudError("NC_ERROR");
  },
};

mock.module("@/lib/db", () => ({ db: fakeDb }));
const { nextcloudClient } = await import("../src/lib/nextcloud/client");
const originalClient = { ...nextcloudClient };
Object.assign(nextcloudClient, fakeClient);
afterAll(() => Object.assign(nextcloudClient, originalClient));
const { driveService } = await import("../src/lib/drive/service");
const owner = { id: "panel-owner", email: "owner@example.test", name: "Owner" } as Parameters<typeof driveService.activate>[0];
const input = { username: "new-user", password: "Password123", planCode: "trial" };

beforeEach(() => {
  account = null; remote = null; createCount = 0; passwordEdits = 0;
  failCreate = false; createError = null; failReservation = false; failMarkCreated = false;
  failVerification = false; wrongVerifiedQuota = false;
  failQuota = false; failPersistence = false; assignedQuota = ""; lastPassword = "";
});

describe("Drive activation", () => {
  test("a new username is created, receives 100 MB, is verified, and is linked", async () => {
    const overview = await driveService.activate(owner, input);
    expect(createCount).toBe(1);
    expect(assignedQuota).toBe("100 MB");
    expect(account?.status).toBe("active");
    expect(account?.panelUserId).toBe(owner.id);
    expect(overview.state).toBe("ready");
  });

  test("an unrelated existing user is never adopted or given a new password", async () => {
    remote = ncUser(owner.email); // Matching email is not ownership proof.
    expect(driveService.activate(owner, input)).rejects.toMatchObject({ code: "USERNAME_TAKEN" });
    expect(createCount).toBe(0);
    expect(passwordEdits).toBe(0);
    expect(account).toBeNull();
  });

  test("failed creation leaves a retryable reservation", async () => {
    failCreate = true;
    expect(driveService.activate(owner, input)).rejects.toMatchObject({ code: "NC_ERROR" });
    expect(account?.status).toBe("provisioning");
    failCreate = false;
    await driveService.activate(owner, input);
    expect(createCount).toBe(2);
  });

  test("rejected common password keeps the reservation and accepts a new password", async () => {
    createError = new NextcloudError("NC_WEAK_PASSWORD", { ocsStatuscode: 107, rawDetail: "provider-only detail" });
    await expect(driveService.activate(owner, input)).rejects.toMatchObject({
      code: "WEAK_PASSWORD", publicMessage: expect.stringContaining("رمز"),
    });
    const reserved = account;
    expect(reserved?.status).toBe("provisioning");
    expect(reserved?.panelUserId).toBe(owner.id);
    const overview = await driveService.getOverview(owner);
    expect(overview.pendingUsername).toBe("new-user");
    expect(overview.state).toBe("not_provisioned");
    createError = null;
    await driveService.activate(owner, { ...input, password: "NewUniquePassword987" });
    expect(account).toBe(reserved);
    expect(lastPassword).toBe("NewUniquePassword987");
    expect(createCount).toBe(2);
    expect(passwordEdits).toBe(0);
  });

  test("another provider password rejection is returned as password validation", async () => {
    createError = new NextcloudError("NC_INVALID_PASSWORD", { ocsStatuscode: 102, rawDetail: "provider-only detail" });
    try {
      await driveService.activate(owner, input);
      throw new Error("Expected rejection");
    } catch (error) {
      expect(error).toMatchObject({ code: "INVALID_PASSWORD" });
      expect((error as { publicMessage: string }).publicMessage).toContain("سیاست امنیتی Drive");
      expect((error as { publicMessage: string }).publicMessage).not.toContain("provider-only detail");
    }
    expect(account?.status).toBe("provisioning");
  });

  test("a same-owner reservation with a different username is a recovery issue", async () => {
    createError = new NextcloudError("NC_WEAK_PASSWORD");
    await expect(driveService.activate(owner, input)).rejects.toMatchObject({ code: "WEAK_PASSWORD" });
    await expect(driveService.activate(owner, { ...input, username: "other-user" })).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(account?.status).toBe("provisioning");
    expect(createCount).toBe(1);
  });

  test("a pending same-owner reservation cannot adopt an existing remote username, even with matching email", async () => {
    createError = new NextcloudError("NC_WEAK_PASSWORD");
    await expect(driveService.activate(owner, input)).rejects.toMatchObject({ code: "WEAK_PASSWORD" });
    remote = ncUser(owner.email);
    createError = null;
    await expect(driveService.activate(owner, input)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(account?.status).toBe("provisioning");
    expect(passwordEdits).toBe(0);
    expect(createCount).toBe(1);
  });

  test("a duplicate response after reservation requires recovery, not password overwrite", async () => {
    createError = new NextcloudError("NC_USER_EXISTS");
    await expect(driveService.activate(owner, input)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(account?.status).toBe("provisioning");
    expect(passwordEdits).toBe(0);
  });

  test("authentication, network, and unexpected server failures keep distinct codes", async () => {
    for (const [providerCode, expectedCode] of [
      ["NC_AUTH_FAILED", "NC_AUTH_FAILED"],
      ["NC_UNREACHABLE", "NC_UNREACHABLE"],
      ["NC_ERROR", "NC_ERROR"],
    ] as const) {
      account = null;
      createError = new NextcloudError(providerCode);
      await expect(driveService.activate(owner, input)).rejects.toMatchObject({ code: expectedCode });
    }
  });

  test("a reservation belonging to another panel user is a username conflict", async () => {
    account = { id: "other", panelUserId: "someone-else", ncUsername: "new-user", ncEmail: owner.email,
      ncDisplayName: "Other", planCode: "trial", quotaBytes: 104857600n,
      status: "provisioning", provisionedAt: new Date(), lastSyncedAt: null };
    await expect(driveService.activate(owner, input)).rejects.toMatchObject({ code: "USERNAME_TAKEN" });
    expect(createCount).toBe(0);
  });

  test("reservation failure does not call Nextcloud", async () => {
    failReservation = true;
    await expect(driveService.activate(owner, input)).rejects.toMatchObject({ code: "NC_ERROR" });
    expect(createCount).toBe(0);
    expect(account).toBeNull();
  });

  test("failed quota assignment resumes without creating another user", async () => {
    failQuota = true;
    expect(driveService.activate(owner, input)).rejects.toMatchObject({ code: "NC_ERROR" });
    expect(account?.status).toBe("provisioning_created");
    failQuota = false;
    await driveService.activate(owner, input);
    expect(createCount).toBe(1);
    expect(passwordEdits).toBe(0);
  });

  test("verification failure remains retryable without another create", async () => {
    failVerification = true;
    await expect(driveService.activate(owner, input)).rejects.toMatchObject({ code: "NC_UNREACHABLE" });
    expect(account?.status).toBe("provisioning_created");
    failVerification = false;
    await driveService.activate(owner, input);
    expect(createCount).toBe(1);
    expect(account?.status).toBe("active");
  });

  test("wrong verified quota never finalizes the account", async () => {
    wrongVerifiedQuota = true;
    await expect(driveService.activate(owner, input)).rejects.toMatchObject({ code: "NC_ERROR" });
    expect(account?.status).toBe("provisioning_created");
    expect(createCount).toBe(1);
    wrongVerifiedQuota = false;
    await driveService.activate(owner, input);
    expect(createCount).toBe(1);
    expect(account?.status).toBe("active");
  });

  test("ambiguous creation after a database failure requires manual recovery", async () => {
    failMarkCreated = true;
    await expect(driveService.activate(owner, input)).rejects.toMatchObject({ code: "NC_ERROR" });
    expect(account?.status).toBe("provisioning");
    failMarkCreated = false;
    await expect(driveService.activate(owner, input)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(createCount).toBe(1);
    expect(passwordEdits).toBe(0);
  });

  test("failed PostgreSQL finalization resumes without creating another user", async () => {
    failPersistence = true;
    expect(driveService.activate(owner, input)).rejects.toMatchObject({ code: "NC_ERROR" });
    expect(account?.status).toBe("provisioning_created");
    failPersistence = false;
    await driveService.activate(owner, input);
    expect(createCount).toBe(1);
    expect(account?.status).toBe("active");
  });

  test("repeated activation of a linked account is rejected", async () => {
    await driveService.activate(owner, input);
    expect(driveService.activate(owner, input)).rejects.toMatchObject({ code: "ALREADY_LINKED" });
    expect(createCount).toBe(1);
  });
});
