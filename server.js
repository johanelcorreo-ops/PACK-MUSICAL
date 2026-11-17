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
  // Carpetas de videos: "Relajante=<enlace>; Naturaleza=<enlace>"
  videoFolders: process.env.VIDEO_FOLDERS || "",
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

function parseFolders(value, kind, idPrefix) {
  const list = [];
  for (const part of value.split(/[;\n]+/)) {
    if (!part.trim()) continue;
    const eq = part.indexOf("=");
    const name = eq > 0 ? part.slice(0, eq).trim() : `${kind === "video" ? "Videos" : "Género"} ${list.length + 1}`;
    const folderId = folderIdFrom(eq > 0 ? part.slice(eq + 1) : part);
    if (folderId) list.push({ id: idPrefix + list.length, name, folderId, kind });
  }
  return list;
}

const stations = parseFolders(config.folders, "music", "");
if (!stations.length && config.folderId) {
  stations.push({ id: "0", name: "Todo", folderId: folderIdFrom(config.folderId), kind: "music" });
}
const videoFolders = parseFolders(config.videoFolders, "video", "v");
const allSources = [...stations, ...videoFolders];

if (!allSources.length) {
  console.error("Falta GDRIVE_FOLDERS (tus carpetas de música) o VIDEO_FOLDERS (tus carpetas de videos).");
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

// ---------- Biblioteca (con caché) ----------
// Cada archivo recibe un token opaco; el ID de Drive se queda en el servidor.
const cache = new Map(); // source.id -> { at, tracks }
const inFlight = new Map(); // source.id -> promesa de carga
const byToken = new Map(); // token -> archivo de Drive
// Estable entre reinicios (y entre varias instancias) para no cortar a quien está escuchando.
const tokenSecret =
  process.env.TOKEN_SECRET || allSources.map((s) => s.folderId).join() + (config.apiKey || config.serviceAccountJson);

function tokenFor(driveId) {
  return crypto.createHmac("sha256", tokenSecret).update(driveId).digest("hex").slice(0, 20);
}

function cleanName(name) {
  return name.replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[_]+/g, " ").trim();
}

const ACCEPTS = {
  music: (f) =>
    f.mimeType.startsWith("audio/") ||
    f.mimeType === "video/mp4" || // de los mp4 de música solo suena el audio
    /\.(mp3|m4a|aac|wav|ogg|flac|mp4)$/i.test(f.name),
  video: (f) => f.mimeType.startsWith("video/") || /\.(mp4|m4v|webm|mov)$/i.test(f.name),
};

// Máximo 6 consultas a Drive al mismo tiempo (rápido, sin pasarse del límite de Google).
let activeCalls = 0;
const waitingCalls = [];
async function limited(fn) {
  while (activeCalls >= 6) await new Promise((r) => waitingCalls.push(r));
  activeCalls++;
  try {
    return await fn();
  } finally {
    activeCalls--;
    const nextCall = waitingCalls.shift();
    if (nextCall) nextCall();
  }
}

async function listFiles(folderId, accept, depth = 0) {
  const files = [];
  const subfolders = [];
  let pageToken = "";
  do {
    const data = await limited(async () => {
      const res = await driveFetch("/files", {
        q: `'${folderId}' in parents and trashed = false`,
        fields: "nextPageToken, files(id, name, mimeType)",
        pageSize: "1000",
        orderBy: "name",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
        ...(pageToken ? { pageToken } : {}),
      });
      if (!res.ok) throw new Error(`Drive respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return res.json();
    });
    for (const f of data.files || []) {
      if (f.mimeType === "application/vnd.google-apps.folder") subfolders.push(f.id);
      else if (accept(f)) files.push(f);
    }
    pageToken = data.nextPageToken || "";
  } while (pageToken);

  // Las subcarpetas se leen en paralelo.
  if (depth < 6 && subfolders.length) {
    const nested = await Promise.all(
      subfolders.map((id) =>
        listFiles(id, accept, depth + 1).catch((e) => {
          console.error("Subcarpeta omitida:", e.message);
          return [];
        })
      )
    );
    for (const n of nested) files.push(...n);
  }
  return files;
}

function refresh(source) {
  if (inFlight.has(source.id)) return inFlight.get(source.id);
  const started = Date.now();
  const p = listFiles(source.folderId, ACCEPTS[source.kind])
    .then((files) => {
      const tracks = files.map((f) => {
        const token = tokenFor(f.id);
        byToken.set(token, f);
        return { id: token, name: cleanName(f.name) };
      });
      cache.set(source.id, { at: Date.now(), tracks });
      console.log(`${source.name}: ${tracks.length} archivos (${((Date.now() - started) / 1000).toFixed(1)} s)`);
      return tracks;
    })
    .finally(() => inFlight.delete(source.id));
  inFlight.set(source.id, p);
  return p;
}

// Devuelve lo que hay en caché al instante; si está viejo, se actualiza por detrás sin hacer esperar.
async function getTracks(source) {
  const c = cache.get(source.id);
  if (c) {
    if (Date.now() - c.at > config.cacheMinutes * 60_000) {
      refresh(source).catch((e) => console.error(`No se pudo actualizar ${source.name}:`, e.message));
    }
    return c.tracks;
  }
  return refresh(source);
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
    videoFolders: videoFolders.map(({ id, name }) => ({ id, name })),
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
app.get("/api/search", (req, res) => {
  const words = normalize(String(req.query.q || "")).split(/\s+/).filter(Boolean);
  const results = [];
  let loading = false;
  if (words.length) {
    for (const st of stations) {
      const c = cache.get(st.id);
      if (!c) {
        loading = true; // este género todavía se está cargando
        refresh(st).catch(() => {});
        continue;
      }
      if (Date.now() - c.at > config.cacheMinutes * 60_000) refresh(st).catch(() => {});
      for (const t of c.tracks) {
        if (results.length >= 100) break;
        if (words.every((w) => normalize(t.name).includes(w))) {
          results.push({ ...t, station: st.id, stationName: st.name });
        }
      }
    }
  }
  res.set("Cache-Control", "no-store");
  res.json({ results, loading });
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
  if (!station) return res.json([]);
  try {
    res.set("Cache-Control", "no-store");
    res.json(await getTracks(station));
  } catch (err) {
    console.error(err.message);
    res.status(502).json({ error: "No se pudo leer la carpeta de Google Drive" });
  }
});

app.get("/api/videos", async (req, res) => {
  const folder = videoFolders.find((s) => s.id === req.query.folder) || videoFolders[0];
  if (!folder) return res.json([]);
  try {
    res.set("Cache-Control", "no-store");
    res.json(await getTracks(folder));
  } catch (err) {
    console.error(err.message);
    res.status(502).json({ error: "No se pudo leer la carpeta de videos" });
  }
});

// Transmite el audio o video desde Drive soportando Range (necesario para Safari/iOS).
app.get("/stream/:id", async (req, res) => {
  try {
    let file = byToken.get(req.params.id);
    if (!file) {
      await Promise.all(allSources.map((st) => getTracks(st).catch(() => [])));
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
  // Se cargan todas las carpetas apenas arranca, para que el buscador responda al instante.
  for (const st of allSources) {
    refresh(st).catch((e) => console.error(`No se pudo cargar ${st.name}:`, e.message));
  }
});
