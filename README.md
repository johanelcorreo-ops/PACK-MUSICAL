# MÚSICA Y MÁS 🎧

App web para escuchar y vender tu música, conectada a tus carpetas de **Google Drive**:

- **Portada** del pack y textos personalizables.
- **Reproductor completo:** play/pausa, anterior, siguiente, aleatorio y barra para adelantar.
- **Buscador** de canciones en todos los géneros a la vez (no importan tildes ni mayúsculas).
- **Videos:** pestaña de videos con su propia lista. Si apagan la pantalla o cambian de app, **el sonido del video sigue**, y al volver el video continúa en el mismo segundo. También hay un botón "Escuchar con la pantalla apagada".
- **Comprobantes de pago:** cada persona escucha **1 canción o video gratis**; para seguir sube la captura del comprobante (Nequi, Bancolombia, Daviplata, Bre-B). La app lee la referencia, el valor, la fecha y la cuenta destino, **rechaza comprobantes repetidos** y desbloquea al instante si todo cuadra. Lo dudoso queda pendiente para que tú lo revises en `/admin`.
- **Categorías por género:** una carpeta de Drive por género y la persona elige cuál escuchar.
- **"🔥 N personas escuchando ahora":** contador **real** de las personas que tienen la música sonando.
- **Precio con descuento** y botón de **WhatsApp** con mensaje listo, más un botón flotante de WhatsApp.
- **¿Qué incluye?:** lista con la información del pack.
- Funciona con mp3, m4a, wav, ogg, flac y también **mp4** (solo suena el audio).
- **Muestra opcional:** cada canción puede sonar solo X segundos (ej. 45) y pasar a la siguiente.
- **Los enlaces de Google Drive nunca se muestran**: el servidor transmite el audio.
- Si subes canciones nuevas a tus carpetas, aparecen solas (se revisa cada 10 minutos).

---

## 1. Preparar Google Drive (5 minutos)

1. Crea **una carpeta por género** en tu Google Drive y sube ahí tus canciones (las subcarpetas también cuentan).
2. Comparte cada carpeta: **Compartir → Acceso general → "Cualquier persona con el enlace" → Lector**.
   (Nadie va a ver esos enlaces; solo los usa el servidor.)
3. Arma la lista de géneros así, separados por `;` (puedes pegar el enlace completo de cada carpeta):

   ```
   Vallenato=https://drive.google.com/drive/folders/1AbC...; Reggae=https://drive.google.com/drive/folders/1XyZ...
   ```

   Eso va en la variable `GDRIVE_FOLDERS`. El orden en que los escribas es el orden de los botones.
   Si solo tienes una carpeta, puedes usar `GDRIVE_FOLDER_ID` con su enlace y no salen botones de género.

## 2. Crear la API key de Google (5 minutos)

1. Entra a <https://console.cloud.google.com/> y crea un proyecto (cualquier nombre).
2. Ve a **APIs y servicios → Biblioteca**, busca **Google Drive API** y dale **Habilitar**.
3. Ve a **APIs y servicios → Credenciales → Crear credenciales → Clave de API**. Copia la clave.
4. (Recomendado) Edita la clave → **Restricciones de API** → elige solo **Google Drive API**.

<details>
<summary>¿Prefieres que la carpeta NO sea pública? Usa una cuenta de servicio</summary>

1. En **Credenciales → Crear credenciales → Cuenta de servicio**, créala y luego en **Claves → Agregar clave → JSON**.
2. Comparte la carpeta de Drive con el email de la cuenta de servicio (`...@...iam.gserviceaccount.com`) como Lector.
3. En vez de `GOOGLE_API_KEY`, pon todo el contenido del JSON (en una sola línea) en `GOOGLE_SERVICE_ACCOUNT_JSON`.
</details>

## 3. Publicarlo en la nube (Render, gratis)

1. Crea una cuenta en <https://render.com> y conéctala con GitHub.
2. **New → Blueprint** y elige este repositorio (usa el archivo `render.yaml`).
3. Llena las variables que te pide:
   - `GDRIVE_FOLDERS` → la lista del paso 1
   - `GOOGLE_API_KEY` → la clave del paso 2
   - `BUY_URL` → el enlace de pago (Hotmart, Stripe, WhatsApp, etc.)
4. Espera a que termine y te dará una URL tipo `https://pack-musical-player.onrender.com`. **Esa es la que pones en tu anuncio de Meta.**

> El plan gratis de Render "se duerme" si nadie entra en 15 minutos, y la primera visita tarda ~30 s en cargar.
> Para anuncios pagados conviene el plan **Starter (~7 USD/mes)** para que cargue al instante y no pierdas clics.

También funciona en Railway, Fly.io o Google Cloud Run (hay un `Dockerfile` listo).

## Configuración

| Variable | Qué hace | Por defecto |
|---|---|---|
| `GDRIVE_FOLDERS` | Géneros: `Nombre=enlace; Nombre=enlace` | — |
| `VIDEO_FOLDERS` | Carpetas de videos: `Relajante=enlace; Naturaleza=enlace` (vacío = sin pestaña de videos) | — |
| `GDRIVE_FOLDER_ID` | Una sola carpeta (enlace o ID), si no usas géneros | — |
| `GOOGLE_API_KEY` | API key de Google (carpeta pública) | — |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | JSON de cuenta de servicio (carpeta privada) | — |
| `PREVIEW_SECONDS` | Segundos que suena cada canción antes de pasar a la siguiente. `0` = completa | `0` |
| `SHUFFLE` | Orden aleatorio | `true` |
| `SITE_TITLE` / `SITE_SUBTITLE` | Textos de la página | `MÚSICA Y MÁS` / `Escucha, busca y disfruta toda la música` |
| `PRICE_BEFORE` / `PRICE_NOW` | Precio antes y precio ahora (el % de descuento se calcula solo) | — |
| `WHATSAPP_NUMBER` | Tu WhatsApp con indicativo, ej. `573001234567` (vacío = sin botones de WhatsApp) | — |
| `WHATSAPP_MESSAGE` | Mensaje que te llega al tocar el botón | `Hola, quiero el pack de MÚSICA Y MÁS 🎶` |
| `PACK_FEATURES` | Puntos de "¿Qué incluye?", separados por `\|` | 4 puntos de ejemplo |
| `BUY_URL` / `BUY_TEXT` | Otro botón de compra, ej. Hotmart o Mercado Pago (vacío = sin botón) | — / `Comprar el pack` |
| `CACHE_MINUTES` | Cada cuánto se vuelve a leer la carpeta | `10` |

## Página: músicos, cifras y oferta

- **Músicos a los lados** (computador) y en una tarima debajo de la portada (celular). Por defecto son ilustraciones
  originales (`public/musicos.svg`). Para usar tus propias imágenes (por ejemplo hechas con IA), súbelas a
  `public/artistas/` — ver `public/artistas/LEEME.md`. **No uses fotos de artistas famosos.**
- **Cifras reales** debajo del título: canciones, géneros y videos que hay en tus carpetas, y
  "N personas ya tienen el pack" (comprobantes aprobados), que solo aparece desde `MIN_BUYERS_TO_SHOW` (5).
- **Cinta con los géneros**, disco girando, luces y notas animadas.
- **Botón fijo "Desbloquea TODO por $…"** abajo, mientras la persona no ha pagado.
- **Cuenta regresiva** solo si pones en `OFFER_ENDS` la fecha **real** en que termina la oferta, ej. `2026-11-30T23:59:00-05:00`.

## Descargas

Quien ya pagó (comprobante **aprobado**) puede descargar:

- **Cada canción o video**: botón ⬇ al lado de cada uno y en el reproductor de abajo.
- **El álbum completo** de un género (o todos los videos de una categoría) en un archivo **.zip** que se arma mientras se descarga.

Quien no ha pagado ve los botones con 🔒 y, al tocarlos, se abre la ventana para subir el comprobante.
Si los comprobantes no están activados, no aparecen botones de descarga.
`DOWNLOAD_ALBUMS_PER_DAY` limita cuántos álbumes .zip puede bajar cada código por día (10 por defecto), para no gastar de más la transferencia de Render.

## Comprobantes de pago

**Cómo funciona para el cliente:** escucha 1 canción (o video) gratis → al intentar otra le sale "Desbloquea toda la música" con los datos para pagar → sube la captura del comprobante → si todo cuadra se desbloquea al instante y recibe un **código de acceso** para entrar desde otro celular.

**Qué revisa la app en cada comprobante** (lee el texto de la imagen):

| Revisión | Si falla |
|---|---|
| Número de referencia / comprobante / aprobación | Queda **pendiente** |
| La referencia **no se ha usado antes** | **Rechazado** ("Este comprobante ya fue usado") |
| Valor ≥ precio (`PRICE_NOW`) | Queda pendiente |
| Fecha de los últimos `RECEIPT_MAX_DAYS` días (2 por defecto) | Queda pendiente |
| Aparece tu cuenta (`PAYMENT_ACCOUNTS`) como destino | Queda pendiente |

> ⚠️ Ninguna app puede saber si una imagen fue **editada**. Revisa de vez en cuando los aprobados contra tu Nequi/banco:
> si alguien hizo trampa, en `/admin` le das **Bloquear** y pierde el acceso al instante en todos sus dispositivos.
> Para un control 100 % automático habría que cobrar con una pasarela (Wompi, Mercado Pago, ePayco).

**Panel:** entra a `tu-pagina.onrender.com/admin` con la contraseña `ADMIN_PASSWORD`. Ahí ves cada comprobante con su imagen, lo que leyó la app y los botones Aprobar / Bloquear.

**Variables en Render → Environment:**

| Variable | Valor |
|---|---|
| `SUPABASE_URL` | Dirección del proyecto de Supabase |
| `SUPABASE_ANON_KEY` | Clave pública (anon) del proyecto |
| `MYM_SECRET` | Clave secreta guardada en la tabla `mym_settings` (mínimo 24 caracteres) |
| `ADMIN_PASSWORD` | Contraseña para entrar a `/admin` (mínimo 6 caracteres) |
| `PAYMENT_ACCOUNTS` | Tu número/cuenta a donde pagan, ej. `3016797379` (varias separadas por coma) |
| `PAYMENT_INFO` | Texto con los datos de pago que ve el cliente, ej. `Nequi, Daviplata o llave Bre-B 301 679 7379` |
| `OFFER_ENDS` | (Opcional) Fecha real de fin de la oferta para la cuenta regresiva, ej. `2026-11-30T23:59:00-05:00` |
| `DOWNLOAD_ALBUMS_PER_DAY` | Álbumes .zip por código de acceso por día (opcional, por defecto `10`) |
| `RECEIPT_MAX_DAYS` | Días de antigüedad aceptados (opcional, por defecto `2`) |

La primera canción o video sigue siendo gratis aunque falte la configuración de Supabase. En ese caso se muestran los canales de compra configurados en `BUY_URL` o `WHATSAPP_NUMBER`, y la entrega del acceso requiere configurar los comprobantes en Supabase. Para una instancia de demostración sin comprobantes, define `TRIAL_LIMIT_ENABLED=false` si quieres permitir reproducción libre.

## Videos

1. Sube tus videos (**MP4** es lo que mejor funciona en todos los celulares) a una carpeta de Drive y compártela como "Cualquier persona con el enlace".
2. En Render → Environment agrega `VIDEO_FOLDERS` con `Relajante=https://drive.google.com/drive/folders/...`.
3. Aparece la pestaña **🎬 Videos**.

> Los videos pasan por el servidor de Render. El plan gratis incluye 100 GB de transferencia al mes;
> si muchas personas ven videos largos, revisa el consumo en Render.

## Probar en tu computadora

```bash
npm install
cp .env.example .env   # y llena los datos
node --env-file=.env server.js
```

Abre <http://localhost:3000>.

## Límites honestos

Usa solo música tuya o con licencia que te permita venderla: Meta rechaza anuncios de música sin derechos y Drive puede cerrar las carpetas si las denuncian.

La página no ofrece botón de descarga, pero **nada en la web puede impedir al 100 % que alguien grabe lo que suena** en su computadora. Por eso se recomienda usar `PREVIEW_SECONDS` para mostrar solo un fragmento de cada canción y vender el pack completo.

## Cambiar la portada

La portada está en `design/portada.svg`. Para volver a generar `public/portada.jpg` y `public/og.jpg`
(la imagen que sale al compartir el enlace por WhatsApp o Facebook):

```bash
node design/render.js design/portada.svg public/portada.jpg public/og.jpg
```

O simplemente reemplaza `public/portada.jpg` por tu propia imagen cuadrada.

### Anuncios de Meta con destino al sitio web

Usa la URL pública HTTPS del reproductor que muestra Render como destino del anuncio (imagen o video). En el Administrador de anuncios, elige ventas en el sitio web. Configura los datos de pago y los comprobantes según la sección anterior para que la compra se complete en la app.

En Render → Environment, agrega `META_PIXEL_ID` con el identificador numérico del píxel o conjunto de datos de tu negocio. Guarda el cambio y vuelve a desplegar. El píxel del navegador envía `PageView` y `ViewContent` al abrir el reproductor, `InitiateCheckout` al entrar al flujo de compra y `Purchase` con el precio del pack en COP tras la aprobación de un comprobante nuevo. Configura `PRICE_AMOUNT` o `PRICE_NOW` con el precio vigente. Una compra pendiente se registra cuando el comprador vuelve al mismo navegador o mantiene la app abierta y recibe la aprobación. Los pagos finalizados en un sitio externo requieren la integración de ese proveedor para confirmar una venta.

Comprueba el recorrido en Administrador de eventos → Probar eventos antes de activar la campaña. Usa el número de soporte en `WHATSAPP_NUMBER` para ofrecer ayuda por separado.

### Opiniones de compradores

En Render puedes configurar `TESTIMONIOS_JSON` como una lista JSON de hasta seis opiniones. Cada entrada lleva `nombre` (el nombre público elegido por el comprador) y `texto` (sus palabras). Publica únicamente opiniones reales con autorización. Omite teléfonos, códigos de acceso y datos de pago. Una lista vacía oculta la sección.
