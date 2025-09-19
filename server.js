import express from "express";
import compression from "compression";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import http from "http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(compression());
app.use(express.json({ limit: "25mb" }));

// --- API: health ---
app.get("/api/status", (_req, res) => {
  res.json({ ok: true, ts: Date.now(), service: "swingalyze-api" });
});

// --- API: analyze (placeholder you can replace) ---
app.post("/api/analyze", async (req, res) => {
  // Echo input length to prove data flow; return simple, valid JSON
  const frames = Array.isArray(req.body?.frames) ? req.body.frames.length : 0;
  res.json({
    ok: true,
    received: { frames, hasVideo: Boolean(req.body?.video) },
    keyframes: ["address", "club-parallel", "top", "impact", "follow-through"],
    tempo: { back: 0.90, down: 0.30, ratio: 3.0, confidence: 0.88 },
    overlays: []
  });
});

// --- Static UI: prefer ./public if present; else repo root ---
const staticDir = fs.existsSync(path.join(__dirname, "public"))
  ? path.join(__dirname, "public")
  : __dirname;

app.use(express.static(staticDir, { fallthrough: true }));

// SPA fallback if index.html exists
app.get("*", (req, res, next) => {
  if (req.method !== "GET") return next();
  const idx = path.join(staticDir, "index.html");
  if (fs.existsSync(idx)) return res.sendFile(idx);
  return next();
});

// --- Boot: pick port (defaults 3000), show the exact URL to open ---
const START = Number(process.env.PORT || 3000);
const MAX = 3010;

function boot(port) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(app);
    srv.on("error", (e) => {
      if (e.code === "EADDRINUSE" && port < MAX) {
        console.log(`[srv] ${port} in use → ${port + 1}`);
        resolve(boot(port + 1));
      } else {
        reject(e);
      }
    });
    srv.listen(port, "0.0.0.0", () => {
      const chosen = srv.address().port;
      const url = process.env.CODESPACE_NAME
        ? `https://${process.env.CODESPACE_NAME}-${chosen}.app.github.dev`
        : `http://localhost:${chosen}`;
      console.log(`[srv] Listening on ${chosen}`);
      console.log(`[srv] Open: ${url}`);
      resolve({ srv, port: chosen });
    });
  });
}

boot(START).catch((e) => { console.error(e); process.exit(1); });
