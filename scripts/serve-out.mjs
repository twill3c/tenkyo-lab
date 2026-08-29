// out/ を静的に配る。**HTTP Range に応える**(本文は Range で取るため)。
// 検品専用。本番は Vercel が配る。

import http from "node:http";
import fs from "node:fs";
import { resolve, dirname, join, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "out");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".bin": "application/octet-stream",
  ".onnx": "application/octet-stream",
  ".txt": "text/plain; charset=utf-8",
};

export function createServer(root = OUT) {
  return http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    const file = join(root, p);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found: " + p);
      return;
    }
    const size = fs.statSync(file).size;
    const type = TYPES[extname(file)] ?? "application/octet-stream";
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      if (m) {
        const start = Number(m[1]);
        const end = m[2] ? Number(m[2]) : size - 1;
        res.writeHead(206, {
          "content-type": type,
          "content-range": `bytes ${start}-${end}/${size}`,
          "content-length": end - start + 1,
          "accept-ranges": "bytes",
        });
        fs.createReadStream(file, { start, end }).pipe(res);
        return;
      }
    }
    res.writeHead(200, { "content-type": type, "content-length": size, "accept-ranges": "bytes" });
    fs.createReadStream(file).pipe(res);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2] ?? 4321);
  createServer().listen(port, () => console.log(`http://127.0.0.1:${port}/ で out/ を配っています`));
}
