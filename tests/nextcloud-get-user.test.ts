import { afterEach, describe, expect, test } from "bun:test";
import { nextcloudClient } from "../src/lib/nextcloud/client";

const originalFetch = globalThis.fetch;
const originalMode = process.env.NEXTCLOUD_MODE;
process.env.NEXTCLOUD_MODE = "simulation";

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalMode === undefined) delete process.env.NEXTCLOUD_MODE;
  else process.env.NEXTCLOUD_MODE = originalMode;
});

function reply(httpStatus: number, statuscode: number, message: string): void {
  globalThis.fetch = (async () => new Response(JSON.stringify({
    ocs: { meta: { status: "failure", statuscode, message }, data: [] },
  }), { status: httpStatus, headers: { "content-type": "application/json" } })) as typeof fetch;
}

describe("Nextcloud getUser OCS failures", () => {
  test("HTTP 404 with verified missing-user envelope returns null", async () => {
    reply(404, 404, "User does not exist");
    expect(await nextcloudClient.getUser("new-user")).toBeNull();
  });

  test("HTTP 200 with OCS 404 User does not exist returns null", async () => {
    reply(200, 404, "User does not exist");
    expect(await nextcloudClient.getUser("new-user")).toBeNull();
  });

  test("OCS 998 missing user returns null", async () => {
    reply(404, 998, "The requested user could not be found");
    expect(await nextcloudClient.getUser("new-user")).toBeNull();
  });

  test("an invalid API endpoint's 404 is an error", async () => {
    reply(404, 998, "Invalid query, please check the syntax.");
    expect(nextcloudClient.getUser("new-user")).rejects.toMatchObject({ code: "NC_ERROR" });
  });

  test("credentials rejected by the web layer remain an auth failure", async () => {
    reply(401, 404, "User does not exist");
    expect(nextcloudClient.getUser("new-user")).rejects.toMatchObject({ code: "NC_AUTH_FAILED" });
  });
});

describe("Nextcloud createUser OCS failures", () => {
  const input = { userid: "new-user", password: "Password123" };

  test("OCS 107 compromised password is a password error", async () => {
    reply(200, 107, "Password is among the 1,000,000 most common ones. Password is present in compromised password list.");
    expect(nextcloudClient.createUser(input)).rejects.toMatchObject({ code: "NC_WEAK_PASSWORD", ocsStatuscode: 107 });
  });

  test("OCS 102 is an invalid password", async () => {
    reply(200, 102, "Invalid password");
    expect(nextcloudClient.createUser(input)).rejects.toMatchObject({ code: "NC_INVALID_PASSWORD" });
  });

  test("OCS 103 is a username conflict", async () => {
    reply(200, 103, "User already exists");
    expect(nextcloudClient.createUser(input)).rejects.toMatchObject({ code: "NC_USER_EXISTS" });
  });

  test("OCS 997 is an authentication failure", async () => {
    reply(200, 997, "Unauthorized");
    expect(nextcloudClient.createUser(input)).rejects.toMatchObject({ code: "NC_AUTH_FAILED" });
  });

  test("an invalid endpoint is a server error", async () => {
    reply(404, 998, "Invalid query, please check the syntax.");
    expect(nextcloudClient.createUser(input)).rejects.toMatchObject({ code: "NC_ERROR" });
  });
});
