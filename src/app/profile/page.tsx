import type { Metadata } from "next";
import { Suspense } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Container, PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";
import { requireUser } from "@/app/_data/session";
import { loadDriverProfile, profileStatus } from "@/app/_data/profile";
import { safeNext } from "@/app/_lib/action-result";
import { licenceUrl } from "@/server/profile";
import { DriverDetailsForm, LicenceUploadForm } from "./profile-forms";

export const metadata: Metadata = { title: "Profile and licence" };

export default function ProfilePage({ searchParams }: PageProps<"/profile">) {
  return (
    <Suspense fallback={<PageSkeleton rows={2} />}>
      <ProfileContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ProfileContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? safeNext(sp.next, "") : "";
  const user = await requireUser(next ? `/profile?next=${encodeURIComponent(next)}` : "/profile");
  const profile = await loadDriverProfile(user.id);
  const status = profileStatus(profile);

  return (
    <Container className="max-w-4xl py-8">
      <PageHeader
        title="Profile and licence"
        description={`Signed in as ${user.email}. These details are used on your rental agreement.`}
      />

      {sp.welcome ? (
        <Alert tone="success" className="mt-6" title="Welcome to DriveEasy">
          Add your driver details and licence now so booking takes seconds.
        </Alert>
      ) : null}

      <div className="mt-6">
        {status.complete ? (
          <Alert tone="success" title="Ready to rent">
            Your driver details and licence are on file.
            {next ? (
              <div className="mt-3">
                <LinkButton href={next} size="sm">
                  Continue booking
                </LinkButton>
              </div>
            ) : null}
          </Alert>
        ) : (
          <Alert tone="warning" title="Before your first booking">
            <ul className="list-inside list-disc">
              {status.issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </Alert>
        )}
      </div>

      <div className="mt-6 grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Driver details</CardTitle>
          </CardHeader>
          <CardBody>
            <DriverDetailsForm
              defaults={{
                fullName: profile?.fullName ?? user.name,
                phone: profile?.phone,
                dateOfBirth: profile?.dateOfBirth,
                nationality: profile?.nationality,
                licenceNumber: profile?.licenceNumber,
                licenceCountry: profile?.licenceCountry ?? "United Arab Emirates",
                licenceExpiry: profile?.licenceExpiry,
              }}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between gap-3">
            <CardTitle>Driving licence</CardTitle>
            {profile?.licenceFileKey ? <Badge tone="success">On file</Badge> : <Badge tone="warning">Missing</Badge>}
          </CardHeader>
          <CardBody className="space-y-4">
            {profile?.licenceFileKey ? (
              <p className="text-sm text-slate-700">
                Uploaded{profile.licenceUploadedAt ? ` ${formatDateTime(profile.licenceUploadedAt)}` : ""}.{" "}
                <a href={licenceUrl()} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-700 hover:underline">
                  View your licence
                </a>{" "}
                · Uploading a new file replaces it.
              </p>
            ) : null}
            <LicenceUploadForm hasProfile={Boolean(profile)} />
          </CardBody>
        </Card>
      </div>
    </Container>
  );
}
