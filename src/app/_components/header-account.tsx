import { AccountArea } from "@/components/layout/site-header";
import { getCurrentUser } from "@/app/_data/session";
import { signOutAction } from "@/app/(auth)/actions";

/** Reads the session at request time; rendered inside the header's Suspense boundary. */
export async function HeaderAccount() {
  const user = await getCurrentUser();
  return <AccountArea user={user} signOutAction={signOutAction} />;
}
