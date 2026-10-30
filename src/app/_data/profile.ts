// Server-only adapter over db's driver-profile functions.
import { getDriverProfile, type DriverProfile } from "@/server/profile";

export type { DriverProfile };

export async function loadDriverProfile(userId: string): Promise<DriverProfile | null> {
  return getDriverProfile(userId);
}

const MISSING_LABELS: Record<string, string> = {
  licenceFile: "Upload a photo or scan of your driving licence.",
  licenceExpiry: "Your driving licence has expired. Update the expiry date and upload the new licence.",
  dateOfBirth: "Drivers must be at least 21 years old.",
};

/** Uses db's completeness rule (all fields, licence uploaded and valid, age). */
export function profileStatus(p: DriverProfile | null): { complete: boolean; issues: string[] } {
  if (!p) return { complete: false, issues: ["Add your driver details and upload your driving licence."] };
  return { complete: p.complete, issues: p.missing.map((m) => MISSING_LABELS[m] ?? `Check: ${m}`) };
}
