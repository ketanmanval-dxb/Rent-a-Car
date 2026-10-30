// File storage contract (vehicle photos, driving licences, damage images).
// Concrete provider chosen by STORAGE_PROVIDER (see ./index.ts).
// Objects are private: never hand out direct paths/URLs for licence uploads;
// stream them through a route that checks the owner or an admin.

export interface StoredObject {
  key: string;
  contentType: string;
  size: number;
}

export interface StorageProvider {
  readonly name: string;
  put(key: string, body: Uint8Array, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<(StoredObject & { body: Uint8Array }) | null>;
  delete(key: string): Promise<void>;
}
