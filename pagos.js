// Comprobantes de pago: lectura del comprobante (OCR), validaciones antifraude,
// prueba gratis de 1 canción y acceso por código.
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const MESES = {
  enero: 1, ene: 1, febrero: 2, feb: 2, marzo: 3, mar: 3, abril: 4, abr: 4, mayo: 5, may: 5,
  junio: 6, jun: 6, julio: 7, jul: 7, agosto: 8, ago: 8, septiembre: 9, setiembre: 9, sep: 9, sept: 9, set: 9,
  octubre: 10, oct: 10, noviembre: 11, nov: 11, diciembre: 12, dic: 12,
};

// ---------- Lectura del texto del comprobante ----------

function quitarTildes(t) {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// El banco es el primero que aparece en el texto (el encabezado de la app que hizo el pago).
function detectarBanco(t) {
  const candidatos = [
    ["Nequi", /nequi/i],
    ["Daviplata", /daviplata/i],
    ["Bancolombia", /bancolombia|a la mano/i],
    ["Bre-B", /bre\s*-?\s*b\b/i],
  ];
  let mejor = ["Otro", Infinity];
  for (const [nombre, re] of candidatos) {
    const i = t.search(re);
    if (i >= 0 && i < mejor[1]) mejor = [nombre, i];
  }
  return mejor[0];
}

// Número de referencia / comprobante / aprobación (el "consecutivo").
function leerReferencia(texto) {
  const t = quitarTildes(texto);
  const patrones = [
    /referencia\s*(?:de\s*pago)?\s*(?:no\.?|n[°º]|#|:)?\s*\n?\s*([A-Z]{0,3}\s?\d[\dA-Z]{4,})/i,
    /comprobante\s*(?:no\.?|n[°º]|#|:|numero)?\s*\n?\s*(?:no\.?|#|:)?\s*([A-Z]{0,3}\d[\dA-Z]{4,})/i,
    /(?:aprobacion|autorizacion)\s*(?:no\.?|n[°º]|#|:)?\s*\n?\s*([A-Z]{0,3}\d[\dA-Z]{4,})/i,
    /(?:id|codigo|numero|no\.?)\s*(?:de\s*(?:la\s*)?)?(?:transaccion|operacion|transferencia|movimiento)\s*(?:no\.?|#|:)?\s*\n?\s*([A-Z0-9][A-Z0-9-]{5,})/i,
  ];
  for (const re of patrones) {
    const m = t.match(re);
    if (m) {
      const ref = m[1].replace(/[\s-]/g, "").toUpperCase();
      if ((ref.match(/\d/g) || []).length >= 4) return ref;
    }
  }
  return null;
}

// "$ 12.900,00" -> 12900 ; "$12,900.00" -> 12900
function aPesos(s) {
  let v = s.trim().replace(/[.,]\d{2}$/, ""); // quita centavos
  v = v.replace(/[.,\s]/g, "");
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function leerValores(texto) {
  const t = quitarTildes(texto);
  const valores = [];
  for (const m of t.matchAll(/\$\s?(\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d{2})?|\d{4,}(?:[.,]\d{2})?)/g)) {
    const v = aPesos(m[1]);
    if (v) valores.push(v);
  }
  for (const m of t.matchAll(/(?:valor|monto|cuanto\??|total|cop)\s*:?\s*\n?\s*\$?\s?(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?)/gi)) {
    const v = aPesos(m[1]);
    if (v) valores.push(v);
  }
  return valores;
}

function leerFecha(texto, ahora = new Date()) {
  const t = quitarTildes(texto).toLowerCase();
  const valida = (d, m, a) => {
    if (a < 100) a += 2000;
    const f = new Date(Date.UTC(a, m - 1, d));
    return f.getUTCDate() === d && f.getUTCMonth() === m - 1 && a >= 2020 && a <= ahora.getUTCFullYear() + 1 ? f : null;
  };
  let m = t.match(/(\d{1,2})\s+de\s+([a-z]+)\s+(?:de\s+|del\s+)?(\d{4})/);
  if (m && MESES[m[2]]) return valida(+m[1], MESES[m[2]], +m[3]);
  m = t.match(/(\d{1,2})\s+([a-z]{3,10})\.?\s+(?:de\s+)?(\d{4})/);
  if (m && MESES[m[2]]) return valida(+m[1], MESES[m[2]], +m[3]);
  m = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return valida(+m[3], +m[2], +m[1]);
  m = t.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) return valida(+m[1], +m[2], +m[3]);
  return null;
}

// Hoy en Colombia (UTC-5), a medianoche UTC para comparar solo fechas.
function hoyColombia(ahora = new Date()) {
  const c = new Date(ahora.getTime() - 5 * 3600_000);
  return new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), c.getUTCDate()));
}

const fmtPesos = (n) => "$" + Math.round(n).toLocaleString("es-CO");

/**
 * Analiza el texto leído del comprobante y decide si se aprueba solo o queda pendiente.
 * (Los comprobantes repetidos los rechaza la base de datos.)
 */
function analizarComprobante(texto, { precio, maxDias = 2, cuentas = [] }, ahora = new Date()) {
  const referencia = leerReferencia(texto);
  const valores = leerValores(texto);
  const fecha = leerFecha(texto, ahora);
  const banco = detectarBanco(texto);
  const problemas = [];

  if (!referencia) problemas.push("No se pudo leer el número de referencia");

  let valor = null;
  if (!valores.length) {
    problemas.push("No se pudo leer el valor pagado");
  } else {
    valor = valores.find((v) => v >= precio) || Math.max(...valores);
    if (valor < precio) problemas.push(`El valor leído (${fmtPesos(valor)}) es menor al precio (${fmtPesos(precio)})`);
  }

  if (!fecha) {
    problemas.push("No se pudo leer la fecha");
  } else {
    const dias = Math.round((hoyColombia(ahora) - fecha) / 86_400_000);
    if (dias > maxDias) problemas.push(`El comprobante es de hace ${dias} días`);
    if (dias < -1) problemas.push("La fecha del comprobante es futura");
  }

  if (cuentas.length) {
    const soloDigitos = texto.replace(/\D/g, "");
    const bajo = quitarTildes(texto).toLowerCase();
    const destinoOk = cuentas.some((c) => {
      const d = c.replace(/\D/g, "");
      if (d.length >= 7) return soloDigitos.includes(d) || soloDigitos.includes(d.slice(-4));
      return c.trim().length >= 3 && bajo.includes(quitarTildes(c).toLowerCase().trim());
    });
    if (!destinoOk) problemas.push("No se ve tu cuenta como destino del pago");
  }

  return {
    referencia,
    valor,
    fecha: fecha ? fecha.toISOString().slice(0, 10) : null,
    banco,
    estado: problemas.length ? "pendiente" : "aprobado",
    motivo: problemas.join(". ") || null,
  };
}

// ---------- OCR (se carga solo cuando llega un comprobante y se apaga si no se usa) ----------

let worker = null;
let workerTimer = null;
let ocrQueue = Promise.resolve();

async function getWorker() {
  if (!worker) {
    const { createWorker } = require("tesseract.js");
    const langDir = path.join(path.dirname(require.resolve("@tesseract.js-data/spa/package.json")), "4.0.0_best_int");
    worker = createWorker("spa", 1, { langPath: langDir, gzip: true, cachePath: os.tmpdir() });
  }
  clearTimeout(workerTimer);
  workerTimer = setTimeout(async () => {
    const w = worker;
    worker = null;
    try { (await w).terminate(); } catch (_) {}
  }, 5 * 60_000); // libera memoria a los 5 minutos sin uso
  return worker;
}

function leerImagen(buffer) {
  // Una lectura a la vez para no pasarse de memoria en el plan gratis.
  const job = ocrQueue.then(async () => {
    const w = await getWorker();
    const { data } = await w.recognize(buffer);
    return data.text || "";
  });
  ocrQueue = job.catch(() => {});
  return job;
}

// ---------- Base de datos (Supabase, funciones protegidas con clave secreta) ----------

function crearDB({ url, key, secret }) {
  async function rpc(fn, args) {
    const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_secret: secret, ...args }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Supabase ${fn}: ${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  }
  return {
    registrar: (c) =>
      rpc("mym_registrar", {
        p_referencia: c.referencia, p_valor: c.valor, p_fecha: c.fecha, p_banco: c.banco,
        p_nombre: c.nombre, p_telefono: c.telefono, p_codigo: c.codigo, p_estado: c.estado,
        p_motivo: c.motivo, p_texto: c.texto, p_imagen: c.imagen,
      }),
    estado: (codigo) => rpc("mym_estado", { p_codigo: codigo }),
    listar: (limite = 300) => rpc("mym_listar", { p_limite: limite }),
    imagen: (id) => rpc("mym_imagen", { p_id: id }),
    cambiarEstado: (id, estado) => rpc("mym_cambiar_estado", { p_id: id, p_estado: estado }),
    contar: () => rpc("mym_contar", {}),
  };
}

// ---------- Cookie firmada (prueba gratis + código de acceso) ----------

function crearCookies(secret) {
  const key = crypto.createHash("sha256").update("mym-cookie:" + secret).digest();
  const sign = (s) => crypto.createHmac("sha256", key).update(s).digest("base64url").slice(0, 32);
  return {
    leer(req) {
      const raw = (req.headers.cookie || "").split(/;\s*/).find((c) => c.startsWith("mym="));
      if (!raw) return {};
      const [data, sig] = raw.slice(4).split(".");
      if (!data || !sig || sign(data) !== sig) return {};
      try { return JSON.parse(Buffer.from(data, "base64url").toString()); } catch (_) { return {}; }
    },
    escribir(res, value) {
      const data = Buffer.from(JSON.stringify(value)).toString("base64url");
      res.append(
        "Set-Cookie",
        `mym=${data}.${sign(data)}; Path=/; Max-Age=${60 * 60 * 24 * 365 * 2}; HttpOnly; SameSite=Lax; Secure`
      );
    },
  };
}

function nuevoCodigo() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin 0/O ni 1/I para no confundir
  let s = "";
  for (const b of crypto.randomBytes(7)) s += abc[b % abc.length];
  return s;
}

module.exports = { analizarComprobante, leerImagen, crearDB, crearCookies, nuevoCodigo, aPesos };
