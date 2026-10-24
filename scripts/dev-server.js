// Local stand-in for Vercel: serves index.html and runs api/llm.js with a Vercel-like req/res.
// Usage: node scripts/dev-server.js [port]   (env: PORT, plus the same variables as on Vercel)
// MOCK_PROVIDERS=1 answers Gemini/Groq/Mistral calls with a local fake (for tests, no keys or network).
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.argv[2] || process.env.PORT || 3000);
const mock = process.env.MOCK_PROVIDERS ? require("./mock-providers") : null;
if (mock) mock.install();
const API = path.join(ROOT, "api", "llm.js");
let handler = require(API);
// a fresh copy of the function, as after a cold start on Vercel (clears its cooldown memory)
const reloadHandler = () => { delete require.cache[require.resolve(API)]; handler = require(API); };

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

function vercelRes(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(obj)); return res; };
  res.send = (body) => { res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body)); return res; };
  return res;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;
  if (/application\/json/i.test(req.headers["content-type"] || "")) { try { return JSON.parse(raw); } catch { return raw; } }
  return raw;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname === "/api/llm" || url.pathname === "/api/llm/") {
      req.query = Object.fromEntries(url.searchParams);
      req.body = await readBody(req);
      return await handler(req, vercelRes(res));
    }
    // test hook, only with MOCK_PROVIDERS: GET shows modes and calls; POST {"gemini":"429","coldStart":true,"resetCalls":true}
    if (mock && url.pathname === "/__mock") {
      if (req.method === "POST") {
        const opts = (await readBody(req)) || {};
        if (opts.coldStart) reloadHandler();
        mock.configure(opts);
      }
      return vercelRes(res).status(200).json(mock.snapshot());
    }
    const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep) || /(^|[\\/])(\.|api[\\/]|node_modules|scripts|tests)/.test(path.relative(ROOT, file)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.statusCode = 404; return res.end("Not found");
    }
    res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) { res.statusCode = 500; res.end("Server error"); }
  }
});

server.listen(PORT, () => console.log(`Guided Intake running on http://localhost:${PORT}${process.env.MOCK_PROVIDERS ? " (mock providers)" : ""}`));
