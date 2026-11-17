// Servidor de la app: lee las canciones de carpetas de Google Drive y las transmite.
// Los IDs reales de Drive nunca llegan al navegador.
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Readable } = require("stream");

const config = {
  port: Number(process.env.PORT) || 3000,
  folderId: process.env.GDRIVE_FOLDER_ID || "",
  // Varias carpetas = varias "estaciones": "Vallenato=<enlace o ID>; Reggae=<enlace o ID>"
  folders: process.env.GDRIVE_FOLDERS || "",
  apiKey: process.env.GOOGLE_API_KEY || "",
  serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "",
  previewSeconds: Number(process.env.PREVIEW_SECONDS) || 0, // 0 = canción completa
  shuffle: (process.env.SHUFFLE || "true") !== "false",
  title: process.env.SITE_TITLE || "MÚSICA Y MÁS",
  subtitle: process.env.SITE_SUBTITLE || "Escucha, busca y disfruta toda la música",
  buyUrl: process.env.BUY_URL || "",
  buyText: process.env.BUY_TEXT || "Comprar el pack",
  // Información del pack (los puntos se separan con "|")
  features: (process.env.PACK_FEATURES ||
    "Todos los géneros organizados por carpetas|Descarga en MP3 y MP4|Entrega inmediata por WhatsApp|Acceso para siempre")
    .split("|").map((f) => f.trim()).filter(Boolean),
  priceBefore: process.env.PRICE_BEFORE || "",
  priceNow: process.env.PRICE_NOW || "",
  whatsappNumber: (process.env.WHATSAPP_NUMBER || "").replace(/\D/g, ""),
  whatsappMessage: process.env.WHATSAPP_MESSAGE || "Hola, quiero el pack de MÚSICA Y MÁS 🎶",
  cacheMinutes: Number(process.env.CACHE_MINUTES) || 10,
};

const DRIVE_API = process.env.DRIVE_API_BASE || "https://www.googleapis.com/drive/v3";

// Acepta el ID o el enlace completo de la carpeta.
function folderIdFrom(value) {
  const v = value.trim();
  const m = v.match(/folders\/([A-Za-z0-9_-]+)/) || v.match(/[?&]id=([A-Za-z0-9_-]+)/);
  return m ? m[1] : v;
}

const stations = [];
for (const part of config.folders.split(/[;\n]+/)) {
  if (!part.trim()) continue;
  const eq = part.indexOf("=");
  const name = eq > 0 ? part.slice(0, eq).trim() : `Estación ${stations.length + 1}`;
  const folder = folderIdFrom(eq > 0 ? part.slice(eq + 1) : part);
  if (folder) stations.push({ name, folderId: folder });
}
if (!stations.length && config.folderId) {
  stations.push({ name: "Todo", folderId: folderIdFrom(config.folderId) });
}
stations.forEach((st, i) => (st.id = String(i)));

if (!stations.length) {
  console.error("Falta GDRIVE_FOLDERS o GDRIVE_FOLDER_ID (tu carpeta de Google Drive).");
  process.exit(1);
}
if (!config.apiKey && !config.serviceAccountJson) {
  console.error("Falta GOOGLE_API_KEY o GOOGLE_SERVICE_ACCOUNT_JSON.");
  process.exit(1);
}

// ---------- Autenticación con Google ----------
let authClient = null;
if (config.serviceAccountJson) {
  const { GoogleAuth } = require("google-auth-library");
  authClient = new GoogleAuth({
    credentials: JSON.parse(config.serviceAccountJson),
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
}

async function driveFetch(urlPath, params = {}, extraHeaders = {}) {
  const url = new URL(DRIVE_API + urlPath);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers = { ...extraHeaders };
  if (authClient) {
    const token = await authClient.getAccessToken();
    headers.Authorization = `Bearer ${token}`;
  } else {
    url.searchParams.set("key", config.apiKey);
  }
  return fetch(url, { headers });
}

// ---------- Lista de canciones (con caché) ----------
// Cada canción recibe un token opaco; el ID de Drive se queda en el servidor.
const cache = new Map(); // station.id -> { at, tracks }
const byToken = new Map(); // token -> archivo de Drive
// Estable entre reinicios (y entre varias instancias) para no cortar a quien está escuchando.
const tokenSecret =
  process.env.TOKEN_SECRET || stations.map((s) => s.folderId).join() + (config.apiKey || config.serviceAccountJson);

function tokenFor(driveId) {
  return crypto.createHmac("sha256", tokenSecret).update(driveId).digest("hex").slice(0, 20);
}

function cleanName(name) {
  return name.replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[_]+/g, " ").trim();
}

async function listAudioFiles(folderId, depth = 0) {
  const files = [];
  let pageToken = "";
  do {
    const res = await driveFetch("/files", {
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, size)",
      pageSize: "1000",
      orderBy: "name",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      ...(pageToken ? { pageToken } : {}),
    });
    if (!res.ok) {
      throw new Error(`Drive respondió ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    for (const f of data.files || []) {
      if (f.mimeType === "application/vnd.google-apps.folder" && depth < 3) {
        files.push(...(await listAudioFiles(f.id, depth + 1))); // también subcarpetas
      } else if (
        f.mimeType.startsWith("audio/") ||
        f.mimeType === "video/mp4" || // de los mp4 solo suena el audio
        /\.(mp3|m4a|aac|wav|ogg|flac|mp4)$/i.test(f.name)
      ) {
        files.push(f);
      }
    }
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return files;
}

async function getTracks(station) {
  const c = cache.get(station.id);
  if (c && c.tracks.length && Date.now() - c.at < config.cacheMinutes * 60_000) return c.tracks;
  const files = await listAudioFiles(station.folderId);
  const tracks = files.map((f) => {
    const token = tokenFor(f.id);
    byToken.set(token, f);
    return { id: token, name: cleanName(f.name) };
  });
  cache.set(station.id, { at: Date.now(), tracks });
  console.log(`${station.name}: ${tracks.length} canciones`);
  return tracks;
}

// ---------- App ----------
const app = express();
app.disable("x-powered-by");

app.get("/api/config", (_req, res) => {
  res.json({
    title: config.title,
    subtitle: config.subtitle,
    buyUrl: config.buyUrl,
    buyText: config.buyText,
    previewSeconds: config.previewSeconds,
    shuffle: config.shuffle,
    stations: stations.map(({ id, name }) => ({ id, name })),
    features: config.features,
    priceBefore: config.priceBefore,
    priceNow: config.priceNow,
    whatsappUrl: config.whatsappNumber
      ? `https://wa.me/${config.whatsappNumber}?text=${encodeURIComponent(config.whatsappMessage)}`
      : "",
  });
});

// Buscador: busca en todos los géneros a la vez.
function normalize(t) {
  return t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
app.get("/api/search", async (req, res) => {
  const words = normalize(String(req.query.q || "")).split(/\s+/).filter(Boolean);
  if (!words.length) return res.json([]);
  const results = [];
  for (const st of stations) {
    let tracks = [];
    try { tracks = await getTracks(st); } catch (_) { continue; }
    for (const t of tracks) {
      const n = normalize(t.name);
      if (words.every((w) => n.includes(w))) {
        results.push({ ...t, station: st.id, stationName: st.name });
        if (results.length >= 100) return res.json(results);
      }
    }
  }
  res.json(results);
});

// Oyentes reales: cada navegador que está sonando avisa cada 20 s.
const listeners = new Map(); // id -> última señal
app.post("/api/listening", express.json({ limit: "1kb" }), (req, res) => {
  const id = String((req.body && req.body.id) || "").slice(0, 40);
  if (id && req.body.active) listeners.set(id, Date.now());
  else if (id) listeners.delete(id);
  const cutoff = Date.now() - 60_000;
  for (const [k, t] of listeners) if (t < cutoff) listeners.delete(k);
  res.json({ count: listeners.size });
});

app.get("/api/playlist", async (req, res) => {
  const station = stations.find((s) => s.id === req.query.station) || stations[0];
  try {
    res.set("Cache-Control", "no-store");
    res.json(await getTracks(station));
  } catch (err) {
    console.error(err.message);
    res.status(502).json({ error: "No se pudo leer la carpeta de Google Drive" });
  }
});

// Transmite el audio desde Drive soportando Range (necesario para Safari/iOS).
app.get("/stream/:id", async (req, res) => {
  try {
    let file = byToken.get(req.params.id);
    if (!file) {
      await Promise.all(stations.map((st) => getTracks(st).catch(() => [])));
      file = byToken.get(req.params.id);
    }
    if (!file) return res.status(404).end();

    const headers = {};
    if (req.headers.range) headers.Range = req.headers.range;
    const upstream = await driveFetch(
      `/files/${encodeURIComponent(file.id)}`,
      { alt: "media", supportsAllDrives: "true" },
      headers
    );
    if (!upstream.ok && upstream.status !== 206) {
      console.error(`Error al transmitir ${file.name}: ${upstream.status}`);
      return res.status(502).end();
    }

    res.status(upstream.status);
    for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const v = upstream.headers.get(h);
      if (v) res.set(h, v);
    }
    if (!upstream.headers.get("content-type")) res.set("Content-Type", file.mimeType || "audio/mpeg");
    res.set("Content-Disposition", "inline");
    res.set("Cache-Control", "private, max-age=3600");

    const body = Readable.fromWeb(upstream.body);
    req.on("close", () => body.destroy());
    body.pipe(res);
  } catch (err) {
    console.error(err.message);
    if (!res.headersSent) res.status(502).end();
  }
});

// Página principal: Facebook y WhatsApp necesitan la dirección completa de la imagen de vista previa.
const fs = require("fs");
const indexHtml = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8");
const escapeHtml = (t) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
app.get(["/", "/index.html"], (req, res) => {
  const origin = `${req.headers["x-forwarded-proto"] || req.protocol}://${req.get("host")}`;
  const title = escapeHtml(config.title);
  const desc = escapeHtml(config.subtitle);
  res.type("html").send(
    indexHtml
      .replace('content="/og.jpg"', `content="${origin}/og.jpg"`)
      .replaceAll("<title>MÚSICA Y MÁS</title>", `<title>${title}</title>`)
      .replaceAll('content="MÚSICA Y MÁS"', `content="${title}"`)
      .replaceAll('content="Escucha, busca y disfruta toda la música. Todos los géneros."', `content="${desc}"`)
  );
});

app.use(express.static(path.join(__dirname, "public")));

app.listen(config.port, () => {
  console.log(`Reproductor listo en http://localhost:${config.port}`);
  for (const st of stations) {
    getTracks(st).catch((e) => console.error(`No se pudo cargar ${st.name}:`, e.message));
  }
});
