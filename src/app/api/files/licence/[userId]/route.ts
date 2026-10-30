import { getLicenceFile, serveFile } from "@/server/files";

// A user's licence scan: that user or an admin only (404 otherwise).
export async function GET(request: Request, ctx: { params: Promise<{ userId: string }> }) {
  const { userId } = await ctx.params;
  return serveFile(request, (viewer) => getLicenceFile(viewer, userId), { route: "licence/[userId]", userId });
}
