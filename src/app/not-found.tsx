import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
      <EmptyState
        title="Page not found"
        description="The page you are looking for does not exist, or you do not have access to it."
        action={<LinkButton href="/">Back to home</LinkButton>}
      />
    </div>
  );
}
