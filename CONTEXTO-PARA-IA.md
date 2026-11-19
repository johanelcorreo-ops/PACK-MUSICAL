# Contexto del proyecto (léelo primero)

Este archivo resume todo lo necesario para seguir trabajando en **MÚSICA Y MÁS** con cualquier persona o IA.
**No contiene claves.** Los valores secretos están en Render (Environment) y los tiene el dueño.

## 1. Qué es

App web (Node.js + Express, sin framework en el frontend) para **vender un pack musical por Meta Ads**:

- Transmite música y videos desde **carpetas de Google Drive**, sin mostrar nunca los enlaces de Drive.
- La persona escucha **1 canción o video gratis**. Para seguir, sube la **captura del comprobante de pago**
  (Nequi, Bancolombia, Daviplata, Bre-B). La app la lee con OCR y desbloquea si todo cuadra.
- Tiene un panel de administración en `/admin` para revisar, aprobar o bloquear comprobantes.
- Página llamativa:
  - portada, músicos ilustrados a los lados, disco girando y cinta de géneros;
  - cifras reales y botón fijo "Desbloquea TODO";
  - WhatsApp y precio con descuento.

## 2. Dónde vive cada cosa

| Qué | Dónde |
|---|---|
| Código | GitHub `johanelcorreo-ops/PACK-MUSICAL`, rama `main` (cada mejora entró por un PR, del #1 al #7) |
| Servidor publicado | **Render**, servicio `pack-musical-player` (definido en `render.yaml`, plan free). Se actualiza solo al unir cambios en `main`. |
| Valores de configuración y claves | Render → servicio → **Environment** |
| Comprobantes de pago | **Supabase**, proyecto "Costos Restaurantes" (ref `qjshepncljsosgtpdmsf`), compartido con otra app del dueño. Todo lo de esta app empieza por `mym_`. |
| Lectura de Drive | Clave de API de **Google Cloud** (proyecto "Pack Musical") con Google Drive API activada |
| Música y videos | Carpetas de **Google Drive** del dueño, compartidas como "Cualquier persona con el enlace" |

### Supabase (no tocar las otras tablas del proyecto)

- **Tablas:**
  - `mym_comprobantes`: referencia, valor, fecha_pago, banco, nombre, telefono, codigo (único), estado (`aprobado|pendiente|rechazado|bloqueado`), motivo, texto_leido, imagen (data URL), revisado_at.
  - `mym_settings`: guarda la clave `secret`.
- **Seguridad:**
  - RLS activado y **sin políticas**, así que nadie lee las tablas directo.
  - La app solo usa funciones `SECURITY DEFINER` que exigen la clave `MYM_SECRET`: `mym_ok`, `mym_registrar` (rechaza referencias repetidas con bloqueo por referencia), `mym_estado`, `mym_listar`, `mym_imagen`, `mym_cambiar_estado`, `mym_contar`.
  - El servidor las llama por REST (`/rest/v1/rpc/...`) con la clave pública (anon).

## 3. Mapa de archivos

| Archivo | Qué hace |
|---|---|
| `server.js` | Lee carpetas de Drive (en paralelo, con caché y actualización por detrás). Además: búsqueda, `/stream/:id` con soporte de Range, oyentes en vivo, `/api/stats`, comprobantes, códigos de acceso, panel `/admin`, y la imagen de vista previa para redes. |
| `pagos.js` | OCR con `tesseract.js` (modelo español incluido en `@tesseract.js-data/spa`, sin descargas). Contiene el analizador de comprobantes (referencia, valor, fecha, banco, cuenta destino), las llamadas a Supabase y la cookie firmada (prueba gratis + código). |
| `public/index.html`, `styles.css`, `player.js` | La página. `player.js` maneja: reproductor, géneros, buscador, videos (con audio en segundo plano al apagar la pantalla), paywall, ventana del comprobante y efectos. |
| `public/admin.html` | Panel de comprobantes (contraseña `ADMIN_PASSWORD`). |
| `public/musicos.svg` | Músicos ilustrados originales (cantante, DJ, acordeonero, guitarrista, trompetista, bailarina). |
| `public/artistas/` | Si se suben imágenes aquí (`1.jpg`…`6.jpg`), reemplazan a los músicos dibujados. Ver `LEEME.md`. |
| `design/portada.svg`, `design/render.js` | Fuente de la portada y el script que genera `public/portada.jpg` y `public/og.jpg`. |
| `render.yaml`, `Dockerfile` | Despliegue. |
| `README.md` | Guía para el dueño: configurar Drive, Google Cloud, Render, comprobantes y videos. |

## 4. Variables de entorno (valores en Render)

| Variable | Para qué |
|---|---|
| `GDRIVE_FOLDERS` | Géneros de música: `Nombre=enlace; Nombre=enlace` |
| `VIDEO_FOLDERS` | Categorías de videos, mismo formato |
| `GDRIVE_FOLDER_ID` | Alternativa: una sola carpeta |
| `GOOGLE_API_KEY` / `GOOGLE_SERVICE_ACCOUNT_JSON` | Acceso a Drive (clave de API o cuenta de servicio) |
| `SITE_TITLE`, `SITE_SUBTITLE`, `PACK_FEATURES` | Textos de la página (`PACK_FEATURES` separados por `\|`) |
| `PRICE_BEFORE`, `PRICE_NOW`, `PRICE_AMOUNT` | Precios (el valor mínimo del comprobante sale de `PRICE_NOW` o `PRICE_AMOUNT`) |
| `WHATSAPP_NUMBER`, `WHATSAPP_MESSAGE` | Botones de WhatsApp |
| `BUY_URL`, `BUY_TEXT` | Otro botón de compra opcional |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `MYM_SECRET` | Comprobantes (si falta alguna, la app funciona sin bloqueo) |
| `ADMIN_PASSWORD` | Entrada al panel `/admin` |
| `PAYMENT_ACCOUNTS` | Cuenta(s) a donde deben pagar; se busca en el comprobante |
| `PAYMENT_INFO` | Datos de pago que ve el cliente |
| `RECEIPT_MAX_DAYS` | Antigüedad máxima del comprobante (2 por defecto) |
| `OFFER_ENDS` | Fecha **real** de fin de oferta para la cuenta regresiva (opcional) |
| `MIN_BUYERS_TO_SHOW` | Desde cuántos compradores se muestra "N personas ya tienen el pack" (5) |
| `PREVIEW_SECONDS` | Segundos por canción (`0` = completas, que es lo que se usa) |
| `SHUFFLE`, `CACHE_MINUTES`, `TOKEN_SECRET`, `PORT` | Ajustes técnicos |
| `DRIVE_API_BASE` | Solo para pruebas: apuntar a un Drive simulado |

## 5. Probar en local

```bash
npm ci
cp .env.example .env   # y llenar los valores
node --env-file=.env server.js
```

Para probar sin Drive ni Supabase reales se pueden levantar servidores simulados y apuntar
`DRIVE_API_BASE` y `SUPABASE_URL` a ellos (las funciones simuladas deben imitar las `mym_*`).
Las pruebas de interfaz se hicieron con Playwright en tamaño celular (390 px) y computador.

## 6. Reglas acordadas (respetarlas)

- **Solo música propia o con licencia de reventa.** Nunca conectar carpetas de packs de terceros ni música comercial sin derechos.
- **No usar fotos ni imitaciones de artistas famosos.** Tienen derechos, y Meta rechaza esos anuncios.
- **No inventar cifras:** nada de oyentes, compradores, reseñas o cuentas regresivas falsas. Todo lo que muestra la página es real.
- El OCR **no detecta comprobantes editados**. Lo que lo frena es el bloqueo de referencias repetidas y la revisión del dueño en `/admin`. Para un control 100 % automático habría que usar una pasarela (Wompi, Mercado Pago, ePayco).
- No poner claves en el repositorio (es **público**). El número de WhatsApp también va solo en Render.

## 7. Pendientes

- [ ] Borrar los 2 comprobantes de prueba (códigos `TESTAAA` y `TESTBBB`) de `mym_comprobantes`.
- [ ] Probar con un comprobante **real** de Nequi y ajustar `pagos.js` si queda "pendiente" sin motivo. El panel muestra el texto leído.
- [ ] Subir imágenes de artistas hechas con IA (personajes ficticios) a `public/artistas/`.
- [ ] En el mismo proyecto de Supabase, la otra app del dueño tiene funciones que se pueden ejecutar sin iniciar sesión, por ejemplo `guardar_clave_contable`, `fn_borrar_secreto_contable` y `ve_dinero`. Conviene revisarlas, aunque no son parte de esta app.
- [ ] Ideas que no se han hecho: pasarela de pago automática, píxel de Meta para medir campañas, página de entrega para compradores.
