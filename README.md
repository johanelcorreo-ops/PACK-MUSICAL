# Pack Musical Player 🎧

Una página web que reproduce la música de tu carpeta de **Google Drive** como si fuera una radio:

- **No tiene botón de pausa.** Si el navegador, los auriculares o la pantalla de bloqueo la pausan, vuelve a sonar sola.
- No se puede adelantar ni retroceder (la barra de progreso es solo visual).
- Pasa a la siguiente canción automáticamente, en orden aleatorio, sin parar nunca.
- Puede tocar solo una **muestra** de cada canción (ej. 45 segundos) para que nadie escuche el pack completo gratis.
- **Los enlaces de Google Drive nunca se muestran**: el servidor transmite el audio, así que el visitante no ve de dónde sale.
- Botón verde de **"Comprar el pack"**, pensado para el tráfico de Meta Ads.
- Si subes canciones nuevas a la carpeta, aparecen solas (se revisa cada 10 minutos).

> ⚠️ Los navegadores no dejan reproducir sonido sin que la persona toque la pantalla primero.
> Por eso la página muestra un botón **"Escuchar ahora"**. Después de ese toque, la música ya no para.

---

## 1. Preparar Google Drive (5 minutos)

1. Pon todas las canciones (mp3, m4a, wav…) en **una carpeta** de Google Drive (las subcarpetas también cuentan).
2. Copia el **ID de la carpeta**: abre la carpeta y copia lo que va después de `/folders/` en la barra de direcciones.
   `https://drive.google.com/drive/folders/`**`1AbCdEfGhIjKlMnOp`** ← eso.
3. Comparte la carpeta: **Compartir → Acceso general → "Cualquier persona con el enlace" → Lector**.
   (Nadie va a ver ese enlace; solo lo usa el servidor.)

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
   - `GDRIVE_FOLDER_ID` → el ID del paso 1
   - `GOOGLE_API_KEY` → la clave del paso 2
   - `BUY_URL` → el enlace de pago (Hotmart, Stripe, WhatsApp, etc.)
4. Espera a que termine y te dará una URL tipo `https://pack-musical-player.onrender.com`. **Esa es la que pones en tu anuncio de Meta.**

> El plan gratis de Render "se duerme" si nadie entra en 15 minutos, y la primera visita tarda ~30 s en cargar.
> Para anuncios pagados conviene el plan **Starter (~7 USD/mes)** para que cargue al instante y no pierdas clics.

También funciona en Railway, Fly.io o Google Cloud Run (hay un `Dockerfile` listo).

## Configuración

| Variable | Qué hace | Por defecto |
|---|---|---|
| `GDRIVE_FOLDER_ID` | ID de la carpeta de Drive | — (obligatoria) |
| `GOOGLE_API_KEY` | API key de Google (carpeta pública) | — |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | JSON de cuenta de servicio (carpeta privada) | — |
| `PREVIEW_SECONDS` | Segundos de cada canción antes de pasar a la siguiente. `0` = completa | `0` |
| `SHUFFLE` | Orden aleatorio | `true` |
| `SITE_TITLE` / `SITE_SUBTITLE` | Textos de la página | `Pack Musical` / `Escucha una muestra del pack` |
| `BUY_URL` / `BUY_TEXT` | Enlace y texto del botón de compra (vacío = sin botón) | — / `Comprar el pack` |
| `CACHE_MINUTES` | Cada cuánto se vuelve a leer la carpeta | `10` |

## Probar en tu computadora

```bash
npm install
cp .env.example .env   # y llena los datos
node --env-file=.env server.js
```

Abre <http://localhost:3000>.

## Límites honestos

Esto evita que la gente pause, adelante o descargue el audio desde la página, pero **nada en la web puede impedir al 100 % que alguien grabe lo que suena** en su computadora. Por eso se recomienda usar `PREVIEW_SECONDS` para mostrar solo un fragmento de cada canción y vender el pack completo.
