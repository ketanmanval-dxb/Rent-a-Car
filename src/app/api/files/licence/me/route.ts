import { getLicenceFile, serveFile } from "@/server/files";

// The signed-in user's own licence scan.
export async function GET(request: Request) {
  return serveFile(request, (viewer) => getLicenceFile(viewer, viewer.id), { route: "licence/me" });
}
