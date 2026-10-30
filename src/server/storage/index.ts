import { LocalStorageProvider } from "./local-storage";
import type { StorageProvider } from "./types";

export * from "./types";

let instance: StorageProvider | undefined;

/** Returns the provider selected by STORAGE_PROVIDER. Server-side only. */
export function getStorage(): StorageProvider {
  if (instance) return instance;
  const kind = process.env.STORAGE_PROVIDER ?? "local";
  switch (kind) {
    case "local":
      instance = new LocalStorageProvider(process.env.LOCAL_UPLOADS_DIR ?? "./storage/uploads");
      return instance;
    // case "vercel-blob": add a BlobStorageProvider implementing StorageProvider using
    // BLOB_READ_WRITE_TOKEN (private access for licences), then set STORAGE_PROVIDER=vercel-blob.
    default:
      throw new Error(`STORAGE_PROVIDER "${kind}" is not implemented`);
  }
}
