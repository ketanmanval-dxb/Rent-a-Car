import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalStorageProvider } from "@/server/storage/local-storage";

let dir: string;
let storage: LocalStorageProvider;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "uploads-"));
  storage = new LocalStorageProvider(dir);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("LocalStorageProvider", () => {
  it("stores, reads and deletes objects with their content type", async () => {
    const body = new TextEncoder().encode("licence-bytes");
    await storage.put("licences/user-1/abc.jpg", body, "image/jpeg");
    const got = await storage.get("licences/user-1/abc.jpg");
    expect(got?.contentType).toBe("image/jpeg");
    expect(new TextDecoder().decode(got?.body)).toBe("licence-bytes");
    await storage.delete("licences/user-1/abc.jpg");
    expect(await storage.get("licences/user-1/abc.jpg")).toBeNull();
  });

  it("rejects path traversal and malformed keys", async () => {
    const body = new Uint8Array([1]);
    for (const key of ["../escape.txt", "a/../../b", "/abs", "a//b", "x.meta.json", "a\\b"]) {
      await expect(storage.put(key, body, "text/plain")).rejects.toThrow(/Invalid storage key/);
    }
  });

  it("refuses an uploads directory inside /public", () => {
    expect(() => new LocalStorageProvider("public/uploads")).toThrow(/public/);
  });
});
