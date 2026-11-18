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
  // ---- Comprobantes de pago (se activan cuando están las 3 variables de Supabase) ----
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabaseKey: process.env.SUPABASE_ANON_KEY || "",
  mymSecret: process.env.MYM_SECRET || "",
  adminPassword: process.env.ADMIN_PASSWORD || "",
  // Valor mínimo que debe tener el comprobante (si no se pone, se toma de PRICE_NOW)
  priceAmount: Number(String(process.env.PRICE_AMOUNT || process.env.PRICE_NOW || "").replace(/\D/g, "")) || 0,
  // Cuenta(s) a donde deben pagar, separadas por coma (ej. "3016797379")
  paymentAccounts: (process.env.PAYMENT_ACCOUNTS || "").split(",").map((s) => s.trim()).filter(Boolean),
  // Texto que ve el cliente con los datos para pagar
  paymentInfo: process.env.PAYMENT_INFO || "",
  receiptMaxDays: Number(process.env.RECEIPT_MAX_DAYS) || 2,
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
app.set("trust proxy", 1); // Render pasa la IP real del visitante

// ---------- Comprobantes de pago y acceso ----------
const pagos = require("./pagos");
const paywall = Boolean(config.supabaseUrl && config.supabaseKey && config.mymSecret.length >= 24);
const db = paywall ? pagos.crearDB({ url: config.supabaseUrl, key: config.supabaseKey, secret: config.mymSecret }) : null;
const cookies = pagos.crearCookies(config.mymSecret || tokenSecret);
if (!paywall) console.log("Comprobantes de pago: desactivado (faltan SUPABASE_URL, SUPABASE_ANON_KEY o MYM_SECRET).");
if (paywall && !config.priceAmount) console.warn("Ojo: falta PRICE_NOW o PRICE_AMOUNT; no se revisará el valor del comprobante.");

// Estado de cada código de acceso (se consulta a la base de datos cada 2 minutos como máximo).
const estadoCache = new Map(); // codigo -> { at, estado, motivo }
async function estadoDeCodigo(codigo) {
  if (!codigo) return null;
  const c = estadoCache.get(codigo);
  if (c && Date.now() - c.at < 120_000) return c;
  try {
    const r = await db.estado(codigo);
    const v = { at: Date.now(), estado: r.estado, motivo: r.motivo || null };
    estadoCache.set(codigo, v);
    return v;
  } catch (err) {
    console.error(err.message);
    return c || null; // si la base no responde, se usa lo último conocido
  }
}

async function acceso(req) {
  const ck = cookies.leer(req);
  if (!paywall) return { ck, unlocked: true };
  const est = await estadoDeCodigo(ck.c);
  return { ck, est, unlocked: est ? est.estado === "aprobado" : false };
}

// ¿Puede reproducir este archivo? (1 canción o video gratis por dispositivo)
async function puedeReproducir(req, res, id) {
  const a = await acceso(req);
  if (a.unlocked) return true;
  if (!a.ck.t) {
    cookies.escribir(res, { ...a.ck, t: id });
    return true;
  }
  return a.ck.t === id;
}

app.get("/api/acceso", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const a = await acceso(req);
  res.json({
    paywall,
    unlocked: a.unlocked,
    trialId: a.ck.t || null,
    codigo: a.ck.c || null,
    estado: a.est ? a.est.estado : null,
    motivo: a.est ? a.est.motivo : null,
  });
});

// Límite de envíos por IP (para que no llenen la base de imágenes).
const envios = new Map(); // ip -> [tiempos]
function demasiadosEnvios(ip) {
  const ahora = Date.now();
  const lista = (envios.get(ip) || []).filter((t) => ahora - t < 3600_000);
  lista.push(ahora);
  envios.set(ip, lista);
  return lista.length > 6;
}

app.post("/api/comprobante", express.json({ limit: "4mb" }), async (req, res) => {
  if (!paywall) return res.status(404).json({ error: "Los comprobantes no están activados" });
  if (demasiadosEnvios(req.ip)) {
    return res.status(429).json({ error: "Demasiados intentos. Espera un rato o escríbenos por WhatsApp." });
  }
  const nombre = String(req.body.nombre || "").trim().slice(0, 120);
  const telefono = String(req.body.telefono || "").replace(/[^\d+ ]/g, "").trim().slice(0, 40);
  const imagen = String(req.body.imagen || "");
  const m = imagen.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!nombre || !telefono) return res.status(400).json({ error: "Escribe tu nombre y tu WhatsApp." });
  if (!m) return res.status(400).json({ error: "Sube la imagen del comprobante (foto o captura de pantalla)." });
  const buffer = Buffer.from(m[2], "base64");
  if (buffer.length < 5_000 || buffer.length > 3_000_000) {
    return res.status(400).json({ error: "La imagen no es válida. Sube una captura de pantalla del comprobante." });
  }

  try {
    let texto = "";
    try {
      texto = await pagos.leerImagen(buffer);
    } catch (err) {
      console.error("No se pudo leer el comprobante:", err.message);
    }
    const r = pagos.analizarComprobante(texto, {
      precio: config.priceAmount || 1,
      maxDias: config.receiptMaxDays,
      cuentas: config.paymentAccounts,
    });
    if (!texto.trim()) {
      r.estado = "pendiente";
      r.motivo = "No se pudo leer el texto de la imagen";
    }
    const guardado = await db.registrar({
      ...r,
      nombre,
      telefono,
      codigo: pagos.nuevoCodigo(),
      texto,
      imagen,
    });
    if (guardado.estado !== "rechazado") {
      const ck = cookies.leer(req);
      cookies.escribir(res, { ...ck, c: guardado.codigo });
      estadoCache.set(guardado.codigo, { at: Date.now(), estado: guardado.estado, motivo: guardado.motivo });
    }
    console.log(`Comprobante ${guardado.estado}: ${r.banco} ref ${r.referencia} valor ${r.valor} fecha ${r.fecha}`);
    res.json({
      estado: guardado.estado,
      motivo: guardado.motivo,
      codigo: guardado.estado === "rechazado" ? null : guardado.codigo,
      leido: { referencia: r.referencia, valor: r.valor, fecha: r.fecha, banco: r.banco },
    });
  } catch (err) {
    console.error(err.message);
    res.status(502).json({ error: "No pudimos guardar tu comprobante. Intenta de nuevo o escríbenos por WhatsApp." });
  }
});

// Usar un código de acceso en otro celular o computador.
app.post("/api/codigo", express.json({ limit: "1kb" }), async (req, res) => {
  if (!paywall) return res.status(404).json({ error: "Los comprobantes no están activados" });
  if (demasiadosEnvios("codigo:" + req.ip)) return res.status(429).json({ error: "Demasiados intentos. Espera un rato." });
  const codigo = String(req.body.codigo || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  if (codigo.length < 5) return res.status(400).json({ error: "Escribe el código completo." });
  estadoCache.delete(codigo);
  const est = await estadoDeCodigo(codigo);
  if (!est || est.estado === "no_existe") return res.status(404).json({ error: "Ese código no existe." });
  if (est.estado === "aprobado" || est.estado === "pendiente") {
    cookies.escribir(res, { ...cookies.leer(req), c: codigo });
  }
  res.json({ estado: est.estado, motivo: est.motivo });
});

// ---------- Panel de administración (/admin) ----------
function esAdmin(req) {
  const pass = String(req.headers["x-admin-password"] || "");
  if (!config.adminPassword || config.adminPassword.length < 6) return false;
  const a = crypto.createHash("sha256").update(pass).digest();
  const b = crypto.createHash("sha256").update(config.adminPassword).digest();
  return crypto.timingSafeEqual(a, b);
}
app.use("/api/admin", (req, res, next) => {
  if (!paywall) return res.status(404).json({ error: "Los comprobantes no están activados" });
  if (!config.adminPassword) return res.status(403).json({ error: "Falta configurar ADMIN_PASSWORD en Render." });
  if (demasiadosEnvios("admin:" + req.ip) && !esAdmin(req)) return res.status(429).json({ error: "Demasiados intentos." });
  if (!esAdmin(req)) return res.status(401).json({ error: "Contraseña incorrecta" });
  res.set("Cache-Control", "no-store");
  next();
});
app.get("/api/admin/comprobantes", async (_req, res) => {
  try { res.json(await db.listar(500)); } catch (err) { res.status(502).json({ error: err.message }); }
});
app.get("/api/admin/imagen/:id", async (req, res) => {
  try {
    const img = await db.imagen(req.params.id);
    const m = String(img || "").match(/^data:(image\/[a-z]+);base64,(.+)$/);
    if (!m) return res.status(404).end();
    res.type(m[1]).send(Buffer.from(m[2], "base64"));
  } catch (err) { res.status(502).json({ error: err.message }); }
});
app.post("/api/admin/estado", express.json({ limit: "1kb" }), async (req, res) => {
  const estado = String(req.body.estado || "");
  if (!["aprobado", "pendiente", "rechazado", "bloqueado"].includes(estado)) return res.status(400).json({ error: "Estado no válido" });
  try {
    const r = await db.cambiarEstado(String(req.body.id || ""), estado);
    estadoCache.clear(); // el cambio se aplica de inmediato
    res.json(r);
  } catch (err) { res.status(502).json({ error: err.message }); }
});
app.get("/admin", (_req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));

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
    paywall,
    paymentInfo: config.paymentInfo,
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
    if (!(await puedeReproducir(req, res, req.params.id))) {
      return res.status(402).json({ error: "Sube tu comprobante de pago para escuchar todo" });
    }

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
