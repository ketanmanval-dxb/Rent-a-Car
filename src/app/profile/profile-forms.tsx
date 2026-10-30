"use client";

import { useActionState, useState } from "react";
import { Field, Input, fieldAria } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/alert";
import type { ActionState } from "@/lib/action-state";
import { saveProfileAction, uploadLicenceAction } from "./actions";

export type ProfileDefaults = {
  fullName?: string;
  phone?: string;
  dateOfBirth?: string;
  nationality?: string | null;
  licenceNumber?: string;
  licenceCountry?: string;
  licenceExpiry?: string;
};

export function DriverDetailsForm({ defaults }: { defaults: ProfileDefaults }) {
  const [state, action] = useActionState<ActionState, FormData>(saveProfileAction, {});
  const fe = state.fieldErrors ?? {};
  const v = (k: keyof ProfileDefaults) => state.values?.[k] ?? defaults[k] ?? "";
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.message ? <Alert tone={state.ok ? "success" : "error"}>{state.message}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Driver's full name (as on licence)" htmlFor="fullName" error={fe.fullName} required className="sm:col-span-2">
          <Input {...fieldAria("fullName", fe.fullName)} autoComplete="name" required defaultValue={v("fullName")} />
        </Field>
        <Field label="Mobile number" htmlFor="phone" error={fe.phone} hint="Include country code, e.g. +971 50 123 4567" required>
          <Input {...fieldAria("phone", fe.phone, true)} type="tel" autoComplete="tel" required defaultValue={v("phone")} />
        </Field>
        <Field label="Date of birth" htmlFor="dateOfBirth" error={fe.dateOfBirth} hint="Drivers must be 21 or older." required>
          <Input {...fieldAria("dateOfBirth", fe.dateOfBirth, true)} type="date" autoComplete="bday" required defaultValue={v("dateOfBirth")} />
        </Field>
        <Field label="Nationality" htmlFor="nationality" error={fe.nationality}>
          <Input {...fieldAria("nationality", fe.nationality)} autoComplete="country-name" defaultValue={v("nationality")} />
        </Field>
        <Field label="Licence number" htmlFor="licenceNumber" error={fe.licenceNumber} required>
          <Input {...fieldAria("licenceNumber", fe.licenceNumber)} required defaultValue={v("licenceNumber")} />
        </Field>
        <Field label="Licence issuing country" htmlFor="licenceCountry" error={fe.licenceCountry} required>
          <Input {...fieldAria("licenceCountry", fe.licenceCountry)} required defaultValue={v("licenceCountry")} />
        </Field>
        <Field label="Licence expiry date" htmlFor="licenceExpiry" error={fe.licenceExpiry} required>
          <Input {...fieldAria("licenceExpiry", fe.licenceExpiry)} type="date" required defaultValue={v("licenceExpiry")} />
        </Field>
      </div>
      <SubmitButton pendingText="Saving…">Save driver details</SubmitButton>
    </form>
  );
}

const CLIENT_LIMIT_BYTES = 4 * 1024 * 1024;

export function LicenceUploadForm({ hasProfile }: { hasProfile: boolean }) {
  const [state, action] = useActionState<ActionState, FormData>(uploadLicenceAction, {});
  const [clientError, setClientError] = useState<string | null>(null);
  const error = clientError ?? state.fieldErrors?.licence?.[0];
  return (
    <form action={action} className="space-y-3" noValidate>
      {state.message && !state.fieldErrors ? <Alert tone={state.ok ? "success" : "error"}>{state.message}</Alert> : null}
      <Field
        label="Driving licence (photo or scan)"
        htmlFor="licence"
        error={error}
        hint="JPG, PNG or PDF, up to 4 MB. Stored privately; only you and DriveEasy staff can view it."
      >
        <Input
          {...fieldAria("licence", error, true)}
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          required
          disabled={!hasProfile}
          onChange={(e) => {
            const f = e.target.files?.[0];
            setClientError(f && f.size > CLIENT_LIMIT_BYTES ? "Files must be 4 MB or smaller." : null);
          }}
        />
      </Field>
      {!hasProfile ? <p className="text-sm text-amber-800">Save your driver details first, then upload your licence.</p> : null}
      <SubmitButton variant="outline" pendingText="Uploading…" disabled={!hasProfile || Boolean(clientError)}>
        Upload licence
      </SubmitButton>
    </form>
  );
}
