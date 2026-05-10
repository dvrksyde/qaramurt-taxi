export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { verifyDriverToken } from "@/lib/driverAuth";
import fs from "fs";
import path from "path";

const GRAPH_VERSION = "1";
const GRAPH_PATH = path.join(process.cwd(), "src", "app", "api", "driver", "graph", "ghgraph.zip");

export async function GET(req: NextRequest) {
  const auth = verifyDriverToken(req);
  if (!auth) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  if (!fs.existsSync(GRAPH_PATH)) {
    return NextResponse.json({ error: "Graph not found on server" }, { status: 404 });
  }

  const stat = fs.statSync(GRAPH_PATH);
  const fileStream = fs.createReadStream(GRAPH_PATH);

  const webStream = new ReadableStream({
    start(controller) {
      fileStream.on("data", (chunk) => controller.enqueue(chunk));
      fileStream.on("end", () => controller.close());
      fileStream.on("error", (err) => controller.error(err));
    },
    cancel() {
      fileStream.destroy();
    },
  });

  return new NextResponse(webStream, {
    headers: {
      "Content-Type":        "application/zip",
      "Content-Length":      String(stat.size),
      "X-Graph-Version":     GRAPH_VERSION,
      "Cache-Control":       "no-store",
      "Content-Disposition": 'attachment; filename="ghgraph.zip"',
    },
  });
}
