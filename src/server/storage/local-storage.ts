import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StorageProvider, StoredObject } from "./types";

// Stores files under a private directory outside /public, so Next.js never
// serves them directly. Content type is kept in a sidecar .meta.json file.

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

export class LocalStorageProvider implements StorageProvider {
  readonly name = "local";
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = path.resolve(rootDir);
    const publicDir = path.resolve("public");
    if (this.root === publicDir || this.root.startsWith(publicDir + path.sep)) {
      throw new Error("Uploads directory must not be inside /public");
    }
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<StoredObject> {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
    const meta: StoredObject = { key, contentType, size: body.byteLength };
    await writeFile(`${file}.meta.json`, JSON.stringify(meta));
    return meta;
  }

  async get(key: string) {
    const file = this.resolve(key);
    try {
      const [body, meta] = await Promise.all([readFile(file), readFile(`${file}.meta.json`, "utf8")]);
      return { ...(JSON.parse(meta) as StoredObject), body: new Uint8Array(body) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    const file = this.resolve(key);
    await Promise.all([rm(file, { force: true }), rm(`${file}.meta.json`, { force: true })]);
  }

  /** Reject traversal and odd keys; keys look like "licences/<userId>/<uuid>.jpg". */
  private resolve(key: string): string {
    if (!KEY_PATTERN.test(key) || key.split("/").some((seg) => seg === "." || seg === "..") || key.endsWith(".meta.json")) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    const file = path.resolve(this.root, key);
    if (!file.startsWith(this.root + path.sep)) throw new Error(`Invalid storage key: ${key}`);
    return file;
  }
}
