"use client";

import { Button } from "@/components/ui/button";

export function PrintButton({ label = "Print or save as PDF" }: { label?: string }) {
  return (
    <Button variant="outline" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
