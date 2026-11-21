const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { createHash, randomUUID } = require("node:crypto");

// Regression cases for printed forms need authored first pages even when a new
// installation starts with empty templates. Serve fixtures in memory only.
function faceFixtures(root, keepApproved) {
  const file = path.join(root, "assets/js/seed.js");
  const text = fs.readFileSync(file, "utf8");
  const marker = text.indexOf("const ContractAssets=");
  const seed = JSON.parse(text.slice(text.indexOf("=") + 1, marker).trimEnd().replace(/;$/, ""));
  const {design} = seed.config;
  for (const [type, face] of Object.entries(require("../templates/first-page-examples.json"))) {
    const scope = "contract:" + type;
    const layout = (design.documentLayouts ||= {})[scope] ||= {};
    const current = type==="external" ? (layout.externalPages || design.externalPages)?.find(p=>p.id===1)
      : type==="installment" ? (layout.pages || design.pages)?.find(p=>p.id===1) : layout[type+"Template"] || design[type+"Template"];
    if(keepApproved && current?.nodes?.length)continue;
    if (type === "installment" || type === "external") {
      const key = type === "external" ? "externalPages" : "pages";
      layout[key] = (layout[key] || design[key]).map(p => p.id === 1 ? face : p);
    } else layout[type + "Template"] = face;
  }
  const js = Buffer.from("const ContractSeed=" + JSON.stringify(seed) + ";\n" + text.slice(marker));
  const manifestPath = path.join(root, ".web-build.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.sha256["assets/js/seed.js"] = createHash("sha256").update(js).digest("hex");
  return new Map([[file, js], [manifestPath, Buffer.from(JSON.stringify(manifest))]]);
}

module.exports = async function serve(root, { sampleFaces = false } = {}) {
  root = path.resolve(root);
  const overrides = sampleFaces ? faceFixtures(root,sampleFaces==="missing") : new Map();
  // Browser regression suites share templates only within this disposable server.
  const seedPath=path.join(root,"assets/js/seed.js");
  const source=(overrides.get(seedPath) || fs.readFileSync(seedPath)).toString();
  const config=JSON.parse(source.slice(source.indexOf("=")+1,source.indexOf(";\nconst ContractAssets="))).config;
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".wasm": "application/wasm",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
  };
  const numbers=new Map();
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Contract-Defaults","1");
    if(req.url==="/_numbers" && req.method==="POST"){
      const body=[];for await(const part of req)body.push(part);
      const data=JSON.parse(Buffer.concat(body));
      const key=JSON.stringify([data.branch,data.offline]), ledger=numbers.get(key) || new Map();
      numbers.set(key,ledger);
      const number=data.label || ledger.get(data.record) || data.prefix+"-"+(ledger.size+(data.start || 1))+(data.offline?"-F":"");
      if([...ledger].some(([id,n])=>n===number && id!==data.record))return res.writeHead(409).end('{"error":"duplicate"}');
      ledger.set(data.record,number);return res.writeHead(200,{"Content-Type":"application/json"}).end(JSON.stringify({number}));
    }
    if(req.url==="/_defaults"){
      if(req.method==="POST"){
        if(req.headers["if-match"]!==config.sharedRevision)return res.writeHead(409).end();
        const body=[];for await(const part of req)body.push(part);
        Object.assign(config,JSON.parse(Buffer.concat(body)),{sharedRevision:randomUUID()});
        return res.writeHead(200,{"Content-Type":"application/json"}).end(JSON.stringify({revision:config.sharedRevision}));
      }
      const etag='"'+config.sharedRevision+'"';
      if(req.headers["if-none-match"]===etag)return res.writeHead(304,{ETag:etag}).end();
      return res.writeHead(200,{"Content-Type":"application/json",ETag:etag}).end(JSON.stringify({config}));
    }
    let file;
    try {
      const url = new URL(req.url, "http://localhost");
      file = path.resolve(
        root,
        "." +
          decodeURIComponent(
            url.pathname === "/" ? "/index.html" : url.pathname,
          ),
      );
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (path.relative(root, file).startsWith("..")) {
      res.writeHead(403).end();
      return;
    }
    if (overrides.has(file)) {
      res.writeHead(200, { "Content-Type": types[path.extname(file)] }).end(overrides.get(file));
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
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () => server.close(),
  };
};
