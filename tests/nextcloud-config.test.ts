// ============================================================================
// Nextcloud configuration tests (audit §5.3): NEXTCLOUD_ALLOW_INSECURE is a
// DEVELOPMENT override — production must enforce HTTPS for admin credentials.
// Simulation mode must never be accepted in production (§5.4).
// ============================================================================

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { getNextcloudConfig } from "../src/lib/nextcloud/config";

const WATCHED = [
  "NODE_ENV",
  "NEXTCLOUD_MODE",
  "NEXTCLOUD_BASE_URL",
  "NEXTCLOUD_ADMIN_USER",
  "NEXTCLOUD_ADMIN_APP_PASSWORD",
  "NEXTCLOUD_ALLOW_INSECURE",
] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const key of WATCHED) saved[key] = process.env[key];
  process.env.NEXTCLOUD_MODE = "live";
  process.env.NEXTCLOUD_BASE_URL = "http://drive.example.test";
  process.env.NEXTCLOUD_ADMIN_USER = "admin";
  process.env.NEXTCLOUD_ADMIN_APP_PASSWORD = "app-password";
  process.env.NEXTCLOUD_ALLOW_INSECURE = "false";
  delete process.env.NODE_ENV;
});

afterEach(() => {
  for (const key of WATCHED) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("Nextcloud HTTPS enforcement (audit §5.3)", () => {
  test("production + ALLOW_INSECURE=true + plain HTTP is NOT configured (flag ignored)", () => {
    process.env.NODE_ENV = "production";
    process.env.NEXTCLOUD_ALLOW_INSECURE = "true";
    const config = getNextcloudConfig();
    expect(config.configured).toBe(false);
    expect(config.allowInsecure).toBe(false); // the override itself is neutralized
  });

  test("production + HTTPS + credentials is configured", () => {
    process.env.NODE_ENV = "production";
    process.env.NEXTCLOUD_BASE_URL = "https://drive.example.test";
    const config = getNextcloudConfig();
    expect(config.configured).toBe(true);
    expect(config.allowInsecure).toBe(false);
  });

  test("development + ALLOW_INSECURE=true + plain HTTP stays configurable (dev override)", () => {
    process.env.NEXTCLOUD_ALLOW_INSECURE = "true";
    const config = getNextcloudConfig();
    expect(config.configured).toBe(true);
    expect(config.allowInsecure).toBe(true);
  });

  test("simulation mode is rejected in production (audit §5.4)", () => {
    process.env.NODE_ENV = "production";
    process.env.NEXTCLOUD_MODE = "simulation";
    expect(() => getNextcloudConfig()).toThrow(/not allowed in production/);
  });
});
