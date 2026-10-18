import { createServer } from "node:http";
import { postgres } from "./db.ts";
import { createApi } from "./api.ts";
const connection = process.env.DATABASE_URL;
if (!connection) throw Error("DATABASE_URL is required");
const db = postgres(connection),
  api = createApi(db);
const port = Number(process.env.PORT ?? 3001);
const server = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 16_384) {
        res.writeHead(413);
        res.end();
        return;
      }
      chunks.push(chunk);
    }
    const request = new Request(`http://localhost${req.url}`, {
      method: req.method,
      headers: new Headers(
        Object.entries(req.headers).flatMap(([key, value]) =>
          value === undefined
            ? []
            : [[key, Array.isArray(value) ? value.join(",") : value]],
        ),
      ),
      body: ["GET", "HEAD"].includes(req.method ?? "GET")
        ? undefined
        : Buffer.concat(chunks),
    });
    const response = await api(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  } catch {
    res.writeHead(500);
    res.end('{"error":"Internal server error"}');
  }
});
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.listen(port, process.env.HOST ?? "127.0.0.1", () =>
  console.log(`LU4 RB API listening on port ${port}`),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    server.close(() => {
      void db.close().then(() => process.exit(0));
    }),
  );
