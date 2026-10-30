import { getDamageImage, serveFile } from "@/server/files";

// Damage report image: admins, or the customer whose reservation the report is on.
export async function GET(request: Request, ctx: { params: Promise<{ reportId: string; index: string }> }) {
  const { reportId, index } = await ctx.params;
  return serveFile(request, (viewer) => getDamageImage(viewer, reportId, Number(index)), { route: "damage", reportId });
}
