import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { requireAdmin } from "@/app/_data/session";
import { adminListBranches, adminListCategories } from "@/server/admin";
import { listFeatures } from "@/server/catalog";
import { VehicleForm } from "../vehicle-form";

export const metadata: Metadata = { title: "Add vehicle" };

export default function NewVehiclePage() {
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-slate-500">
        <Link href="/admin/fleet" className="hover:text-slate-900">← Fleet</Link>
      </nav>
      <PageHeader title="Add vehicle" />
      <Suspense fallback={<Skeleton className="mt-6 h-96" />}>
        <Content />
      </Suspense>
    </>
  );
}

async function Content() {
  const admin = await requireAdmin("/admin/fleet/new");
  const [branches, categories, features] = await Promise.all([adminListBranches(admin.id), adminListCategories(admin.id), listFeatures()]);
  if (!branches.ok || !categories.ok) return <Alert tone="error">Could not load branches or categories.</Alert>;
  return (
    <Card className="mt-6">
      <CardBody>
        <VehicleForm branches={branches.branches} categories={categories.categories} features={features} />
      </CardBody>
    </Card>
  );
}
