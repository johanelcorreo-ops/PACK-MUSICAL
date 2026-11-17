// Reproductor continuo: no tiene botón de pausa y, si el navegador o los
// controles del sistema lo pausan, vuelve a sonar automáticamente.
(async function () {
  const $ = (id) => document.getElementById(id);
  const audio = new Audio();
  audio.preload = "auto";
  audio.controls = false;
  audio.setAttribute("controlsList", "nodownload noplaybackrate");
  audio.disableRemotePlayback = true;

  let cfg = {};
  let playlist = [];
  let order = [];
  let pos = -1;
  let started = false;
  let changing = false;
  let errorsInARow = 0;

  // Evita menú contextual y atajos de teclado (espacio, k, flechas...).
  document.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("keydown", (e) => {
    if ([" ", "k", "K", "MediaPlayPause", "MediaStop", "ArrowLeft", "ArrowRight"].includes(e.key)) {
      e.preventDefault();
    }
  });

  try {
    cfg = await (await fetch("/api/config")).json();
    document.title = cfg.title;
    $("title").textContent = cfg.title;
    $("subtitle").textContent = cfg.subtitle;
    if (cfg.buyUrl) {
      $("buy").href = cfg.buyUrl;
      $("buy").textContent = cfg.buyText;
      $("buy").hidden = false;
    }
  } catch (_) {}

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function showError(msg) {
    $("error").textContent = msg;
    $("error").hidden = false;
  }

  async function loadPlaylist() {
    const res = await fetch("/api/playlist");
    if (!res.ok) throw new Error("playlist");
    playlist = await res.json();
    if (!playlist.length) throw new Error("vacía");
    order = cfg.shuffle ? shuffle(playlist) : playlist.slice();
  }

  function setMediaSession(track) {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: track.name, artist: cfg.title });
    // Anula pausa/stop/adelantar desde auriculares, pantalla de bloqueo, etc.
    const noop = () => { if (audio.paused) audio.play().catch(() => {}); };
    for (const action of ["pause", "stop", "seekbackward", "seekforward", "seekto", "previoustrack", "nexttrack"]) {
      try { navigator.mediaSession.setActionHandler(action, noop); } catch (_) {}
    }
    try { navigator.mediaSession.setActionHandler("play", () => audio.play().catch(() => {})); } catch (_) {}
  }

  async function next() {
    changing = true;
    pos++;
    if (pos >= order.length) {
      pos = 0;
      try { await loadPlaylist(); } catch (_) {} // refresca por si subiste canciones nuevas
    }
    const track = order[pos];
    $("now").textContent = track.name;
    $("counter").textContent = `${pos + 1} / ${order.length}`;
    $("fill").style.width = "0%";
    audio.src = `/stream/${track.id}`;
    audio.volume = 1;
    setMediaSession(track);
    try {
      await audio.play();
    } catch (_) {}
    changing = false;
  }

  // Si algo pausa el audio (que no sea el final de la canción), se reanuda.
  audio.addEventListener("pause", () => {
    if (!started || changing || audio.ended) return;
    setTimeout(() => audio.play().catch(() => {}), 50);
  });
  document.addEventListener("visibilitychange", () => {
    if (started && !document.hidden && audio.paused) audio.play().catch(() => {});
  });

  audio.addEventListener("playing", () => {
    errorsInARow = 0;
    $("eq").classList.add("on");
  });
  audio.addEventListener("waiting", () => $("eq").classList.remove("on"));
  audio.addEventListener("ended", next);
  audio.addEventListener("error", () => {
    if (!started) return;
    errorsInARow++;
    if (errorsInARow > Math.min(5, order.length)) {
      showError("No se pudo reproducir la música. Intenta recargar la página.");
      return;
    }
    setTimeout(next, 500);
  });

  // Barra de progreso (solo visual, no se puede adelantar) + límite de muestra.
  audio.addEventListener("timeupdate", () => {
    const limit = cfg.previewSeconds > 0 ? Math.min(cfg.previewSeconds, audio.duration || Infinity) : audio.duration;
    if (limit && isFinite(limit)) {
      $("fill").style.width = Math.min(100, (audio.currentTime / limit) * 100) + "%";
    }
    if (cfg.previewSeconds > 0 && !changing) {
      const left = cfg.previewSeconds - audio.currentTime;
      if (left <= 3 && left > 0) audio.volume = Math.max(0, left / 3); // fundido de salida
      if (left <= 0) next();
    }
  });

  // Los navegadores exigen un toque del usuario antes de reproducir sonido.
  $("start").addEventListener("click", async () => {
    $("start").disabled = true;
    try {
      await loadPlaylist();
    } catch (_) {
      $("start").disabled = false;
      showError("No hay canciones disponibles en este momento.");
      return;
    }
    started = true;
    $("start").hidden = true;
    $("player").hidden = false;
    await next();
  });
})();
