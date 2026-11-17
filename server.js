// Servidor que reproduce las canciones de una carpeta de Google Drive
// como una "radio" sin pausa. Los IDs reales de Drive nunca llegan al navegador.
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Readable } = require("stream");

const config = {
  port: Number(process.env.PORT) || 3000,
  folderId: process.env.GDRIVE_FOLDER_ID || "",
  apiKey: process.env.GOOGLE_API_KEY || "",
  serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "",
  previewSeconds: Number(process.env.PREVIEW_SECONDS) || 0, // 0 = canción completa
  shuffle: (process.env.SHUFFLE || "true") !== "false",
  title: process.env.SITE_TITLE || "Pack Musical",
  subtitle: process.env.SITE_SUBTITLE || "Escucha una muestra del pack",
  buyUrl: process.env.BUY_URL || "",
  buyText: process.env.BUY_TEXT || "Comprar el pack",
  cacheMinutes: Number(process.env.CACHE_MINUTES) || 10,
};

const DRIVE_API = process.env.DRIVE_API_BASE || "https://www.googleapis.com/drive/v3";

if (!config.folderId) {
  console.error("Falta GDRIVE_FOLDER_ID (el ID de la carpeta de Google Drive).");
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
let cache = { at: 0, tracks: [], byToken: new Map() };
// Estable entre reinicios (y entre varias instancias) para no cortar a quien está escuchando.
const tokenSecret = process.env.TOKEN_SECRET || config.folderId + (config.apiKey || config.serviceAccountJson);

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
      } else if (f.mimeType.startsWith("audio/") || /\.(mp3|m4a|aac|wav|ogg|flac)$/i.test(f.name)) {
        files.push(f);
      }
    }
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return files;
}

async function getTracks() {
  if (Date.now() - cache.at < config.cacheMinutes * 60_000 && cache.tracks.length) {
    return cache.tracks;
  }
  const files = await listAudioFiles(config.folderId);
  const byToken = new Map();
  const tracks = files.map((f) => {
    const token = tokenFor(f.id);
    byToken.set(token, f);
    return { id: token, name: cleanName(f.name) };
  });
  cache = { at: Date.now(), tracks, byToken };
  console.log(`Lista actualizada: ${tracks.length} canciones`);
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
  });
});

app.get("/api/playlist", async (_req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json(await getTracks());
  } catch (err) {
    console.error(err.message);
    res.status(502).json({ error: "No se pudo leer la carpeta de Google Drive" });
  }
});

// Transmite el audio desde Drive soportando Range (necesario para Safari/iOS).
app.get("/stream/:id", async (req, res) => {
  try {
    await getTracks();
    const file = cache.byToken.get(req.params.id);
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

app.use(express.static(path.join(__dirname, "public")));

app.listen(config.port, () => {
  console.log(`Reproductor listo en http://localhost:${config.port}`);
  getTracks().catch((e) => console.error("No se pudo cargar la lista:", e.message));
});
