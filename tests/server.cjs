const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

module.exports = async function serve(root, prefix = "/") {
  root = path.resolve(root);
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
  };
  const server = http.createServer((req, res) => {
    let file;
    try {
      const url = new URL(req.url, "http://localhost");
      if (!url.pathname.startsWith(prefix)) {
        res.writeHead(404).end();
        return;
      }
      file = path.resolve(root, "./" + decodeURIComponent(
        url.pathname.slice(prefix.length) || "index.html",
      ));
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (path.relative(root, file).startsWith("..")) {
      res.writeHead(403).end();
      return;
    }
    fs.stat(file, (error, stat) => {
      if (error || !stat.isFile()) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        "Content-Type": types[path.extname(file)] || "application/octet-stream",
        "Content-Length": stat.size,
      });
      fs.createReadStream(file).pipe(res);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}${prefix}`,
    close: () => server.close(),
  };
};
