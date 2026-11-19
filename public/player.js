// App MÚSICA Y MÁS: reproductor con play/pausa, géneros, buscador y oyentes en vivo.
(async function () {
  const $ = (id) => document.getElementById(id);
  const audio = new Audio();
  audio.preload = "auto";
  audio.setAttribute("controlsList", "nodownload");

  const PAGE = 150; // canciones que se muestran por tanda
  let cfg = { stations: [] };
  let station = "0";
  let stationTracks = []; // canciones del género elegido
  let shown = []; // lo que se ve en la lista (género o resultados de búsqueda)
  let shownLimit = PAGE;
  let queue = []; // lista que se está reproduciendo
  let qi = -1;
  let current = null;
  let shuffle = true;
  let history = [];
  let errorsInARow = 0;

  document.addEventListener("contextmenu", (e) => {
    if (e.target.tagName !== "INPUT") e.preventDefault();
  });

  // ---------- Configuración ----------
  try {
    cfg = await (await fetch("/api/config")).json();
  } catch (_) {}
  shuffle = cfg.shuffle !== false;
  $("shuffleBtn").classList.toggle("on", shuffle);

  if (cfg.title) { document.title = cfg.title; $("title").textContent = cfg.title; }
  if (cfg.subtitle) $("subtitle").textContent = cfg.subtitle;

  if (cfg.priceNow) {
    $("priceNow").textContent = cfg.priceNow;
    if (cfg.priceBefore) {
      $("priceBefore").textContent = "Antes " + cfg.priceBefore;
      const a = Number(String(cfg.priceBefore).replace(/\D/g, ""));
      const b = Number(String(cfg.priceNow).replace(/\D/g, ""));
      if (a > b && b > 0) {
        $("discount").textContent = `-${Math.round((1 - b / a) * 100)}%`;
        $("discount").hidden = false;
      }
    }
    $("prices").hidden = false;
  }
  if (cfg.whatsappUrl) {
    $("waBtn").href = cfg.whatsappUrl;
    $("waBtn").hidden = false;
    $("waFloat").href = cfg.whatsappUrl;
    $("waFloat").hidden = false;
    // El botón flotante se esconde mientras el botón grande de WhatsApp está en pantalla.
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(([e]) => {
        $("waFloat").classList.toggle("away", e.isIntersecting);
      }).observe($("waBtn"));
    }
  }
  if (cfg.buyUrl) {
    $("buyBtn").href = cfg.buyUrl;
    $("buyBtn").textContent = cfg.buyText || "Comprar el pack";
    $("buyBtn").hidden = false;
  }
  function showOffer(show) {
    $("offer").hidden = !show;
    $("offerLink").hidden = !show;
  }
  showOffer(Boolean(cfg.priceNow || cfg.whatsappUrl || cfg.buyUrl));

  if (cfg.features && cfg.features.length) {
    for (const f of cfg.features) {
      const li = document.createElement("li");
      li.textContent = f;
      $("features").appendChild(li);
    }
    $("featuresCard").hidden = false;
  }

  document.body.classList.add("no-player");

  // ---------- Cifras y oferta ----------
  async function loadStats() {
    try {
      const s = await (await fetch("/api/stats", { cache: "no-store" })).json();
      const chips = [
        [s.canciones, s.canciones === 1 ? "canción" : "canciones"],
        [s.generos, s.generos === 1 ? "género" : "géneros"],
        [s.videos, s.videos === 1 ? "video" : "videos"],
      ].filter(([n]) => n > 0);
      const row = $("statsRow");
      row.innerHTML = "";
      for (const [n, label] of chips) {
        const c = document.createElement("div");
        c.className = "stat-chip";
        const b = document.createElement("b");
        b.textContent = fmtNum(n);
        const t = document.createElement("span");
        t.textContent = label;
        c.append(b, t);
        row.appendChild(c);
      }
      row.hidden = chips.length === 0;
      if (s.compradores > 0) {
        $("buyers").textContent = `✅ ${fmtNum(s.compradores)} personas ya tienen el pack`;
        $("buyers").hidden = false;
      }
      if (s.cargando) setTimeout(loadStats, 5000); // todavía se están leyendo carpetas de Drive
    } catch (_) {}
  }

  function startCountdown() {
    const end = Date.parse(cfg.offerEnds || "");
    if (!end || end <= Date.now()) return;
    const box = $("countdown");
    const pad = (n) => String(n).padStart(2, "0");
    const tick = () => {
      const left = end - Date.now();
      if (left <= 0) { box.hidden = true; clearInterval(timer); return; }
      const d = Math.floor(left / 86_400_000);
      const h = Math.floor(left / 3_600_000) % 24;
      const m = Math.floor(left / 60_000) % 60;
      const sec = Math.floor(left / 1000) % 60;
      box.textContent = "⏰ La oferta termina en ";
      const b = document.createElement("b");
      b.textContent = `${d > 0 ? d + "d " : ""}${pad(h)}:${pad(m)}:${pad(sec)}`;
      box.appendChild(b);
      box.hidden = false;
    };
    const timer = setInterval(tick, 1000);
    tick();
  }

  // Botón fijo de abajo: desbloquear con comprobante, o escribir por WhatsApp si no hay comprobantes.
  function updateCta(show, onClick) {
    $("ctaBar").hidden = !show;
    document.body.classList.toggle("has-cta", show);
    if (show) {
      $("ctaPrice").textContent = cfg.priceNow ? `· ${cfg.priceNow}` : "";
      $("ctaBtn").onclick = onClick;
    }
  }

  startCountdown();
  loadStats();

  // ---------- Géneros ----------
  function renderStations() {
    const list = cfg.stations || [];
    if (!list.length) return;
    const nav = $("stations");
    nav.innerHTML = "";
    for (const st of list) {
      const b = document.createElement("button");
      b.type = "button";
      const cover = document.createElement("span");
      cover.className = "playlist-cover";
      cover.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.textContent = st.name;
      b.append(cover, label);
      b.dataset.id = st.id;
      b.classList.toggle("on", st.id === station);
      b.setAttribute("aria-pressed", String(st.id === station));
      b.addEventListener("click", () => selectStation(st.id));
      nav.appendChild(b);
    }
    nav.hidden = false;
    $("stationsLabel").hidden = false;
  }

  function stationName(id) {
    const st = (cfg.stations || []).find((s) => s.id === id);
    return st ? st.name : "";
  }

  async function selectStation(id) {
    station = id;
    for (const b of $("stations").children) {
      const selected = b.dataset.id === id;
      b.classList.toggle("on", selected);
      b.setAttribute("aria-pressed", String(selected));
    }
    $("search").value = "";
    $("listInfo").textContent = "Cargando canciones…";
    $("songs").innerHTML = "";
    try {
      const res = await fetch("/api/playlist?station=" + encodeURIComponent(id));
      if (!res.ok) throw new Error();
      const tracks = await res.json();
      if (id !== station) return; // el usuario ya cambió de género
      stationTracks = tracks.map((t) => ({ ...t, station: id, stationName: stationName(id) }));
      showList(stationTracks, false);
    } catch (_) {
      $("listInfo").textContent = "No se pudieron cargar las canciones. Intenta de nuevo.";
    }
  }

  // ---------- Lista de canciones ----------
  function showList(list, isSearch) {
    shown = list;
    shownLimit = PAGE;
    renderList(isSearch);
  }

  function renderList(isSearch) {
    const ol = $("songs");
    ol.innerHTML = "";
    if (!shown.length) {
      $("listInfo").textContent = isSearch ? "No encontramos esa canción. Prueba con otra palabra." : "Este género no tiene canciones todavía.";
      return;
    }
    const total = shown.length;
    $("listInfo").textContent = isSearch
      ? `${total}${total >= 100 ? "+" : ""} resultado${total === 1 ? "" : "s"}`
      : `${total} canci${total === 1 ? "ón" : "ones"}`;

    shown.slice(0, shownLimit).forEach((t, i) => {
      const li = document.createElement("li");
      li.dataset.id = t.id;
      if (current && current.id === t.id) li.className = "playing";
      const n = document.createElement("span");
      n.className = "n";
      n.textContent = current && current.id === t.id ? "▶" : String(i + 1);
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = t.name;
      if (isSearch && (cfg.stations || []).length > 1) {
        const st = document.createElement("span");
        st.className = "st";
        st.textContent = t.stationName;
        name.appendChild(st);
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "song-button";
      n.setAttribute("aria-hidden", "true");
      button.append(n, name);
      button.addEventListener("click", () => playFrom(shown, i));
      li.appendChild(button);
      ol.appendChild(li);
    });

    if (shown.length > shownLimit) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "more";
      more.textContent = `Ver más (${shown.length - shownLimit} restantes)`;
      more.addEventListener("click", () => { shownLimit += PAGE; renderList(isSearch); });
      ol.appendChild(more);
    }
  }

  function markPlaying() {
    for (const li of $("songs").querySelectorAll("li")) {
      const on = current && li.dataset.id === current.id;
      li.classList.toggle("playing", !!on);
      const n = li.querySelector(".n");
      if (on) n.textContent = "▶";
      else if (n.textContent === "▶") n.textContent = String([...li.parentNode.children].indexOf(li) + 1);
    }
  }

  // ---------- Buscador ----------
  let searchTimer = 0;
  let searchSeq = 0;
  $("search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    const q = $("search").value.trim();
    const seq = ++searchSeq;
    if (!q) { showList(stationTracks, false); return; }
    searchTimer = setTimeout(() => doSearch(q, seq, 0), 250);
  });

  async function doSearch(q, seq, attempt) {
    if (attempt === 0) $("listInfo").textContent = "Buscando…";
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch("/api/search?q=" + encodeURIComponent(q), { signal: ctrl.signal });
      const data = await res.json();
      if (seq !== searchSeq) return;
      const results = Array.isArray(data) ? data : data.results || [];
      showList(results, true);
      if (data.loading) {
        // Algunos géneros todavía se están cargando: se vuelve a buscar en 3 s.
        $("listInfo").textContent = results.length
          ? $("listInfo").textContent + " · cargando más géneros…"
          : "Cargando la música, un momento…";
        if (attempt < 20) searchTimer = setTimeout(() => doSearch(q, seq, attempt + 1), 3000);
      }
    } catch (_) {
      if (seq === searchSeq) $("listInfo").textContent = "No se pudo buscar. Revisa tu conexión e intenta de nuevo.";
    } finally {
      clearTimeout(timeout);
    }
  }

  // ---------- Reproducción ----------
  function fmt(s) {
    if (!isFinite(s) || s < 0) return "0:00";
    const m = Math.floor(s / 60);
    return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  }

  function showPlayer() {
    $("player").hidden = false;
    document.body.classList.remove("no-player");
  }

  function playFrom(list, index) {
    queue = list.slice();
    history = [];
    load(index);
  }

  function load(index) {
    if (!queue.length) return;
    const target = queue[(index + queue.length) % queue.length];
    if (!allowed(target.id)) { // ya usó su canción gratis: pedir comprobante
      if (!audio.paused) audio.pause();
      openPaywall();
      return;
    }
    qi = (index + queue.length) % queue.length;
    current = queue[qi];
    audio.src = `/stream/${current.id}`;
    audio.play().catch(() => {});
    $("trackName").textContent = current.name;
    $("trackStation").textContent = current.stationName || "";
    $("seek").value = 0;
    $("tCur").textContent = "0:00";
    $("tDur").textContent = "0:00";
    showPlayer();
    markPlaying();
    setMediaSession();
  }

  function next() {
    if (!queue.length) return;
    history.push(qi);
    if (shuffle && queue.length > 1) {
      let r;
      do { r = Math.floor(Math.random() * queue.length); } while (r === qi);
      load(r);
    } else {
      load(qi + 1);
    }
  }

  function prev() {
    if (audio.currentTime > 4) { audio.currentTime = 0; return; }
    if (history.length) load(history.pop());
    else load(qi - 1);
  }

  function togglePlay() {
    if (!current) {
      if (stationTracks.length) {
        playFrom(stationTracks, shuffle ? Math.floor(Math.random() * stationTracks.length) : 0);
      }
      return;
    }
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }

  function setMediaSession() {
    if (!("mediaSession" in navigator) || !current) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.name,
      artist: cfg.title || "MÚSICA Y MÁS",
      album: current.stationName || "",
      artwork: [{ src: "/portada.jpg", sizes: "1000x1000", type: "image/jpeg" }],
    });
    const handlers = {
      play: () => audio.play().catch(() => {}),
      pause: () => audio.pause(),
      nexttrack: next,
      previoustrack: prev,
    };
    for (const [k, fn] of Object.entries(handlers)) {
      try { navigator.mediaSession.setActionHandler(k, fn); } catch (_) {}
    }
  }

  $("playBtn").addEventListener("click", togglePlay);
  $("heroPlay").addEventListener("click", togglePlay);
  $("nextBtn").addEventListener("click", next);
  $("prevBtn").addEventListener("click", prev);
  $("shuffleBtn").addEventListener("click", () => {
    shuffle = !shuffle;
    $("shuffleBtn").classList.toggle("on", shuffle);
  });

  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    if (e.key === " ") { e.preventDefault(); togglePlay(); }
  });

  function updatePlayState() {
    const playing = !audio.paused;
    $("player").classList.toggle("is-playing", playing);
    $("playBtn").setAttribute("aria-label", playing ? "Pausar" : "Reproducir");
    $("heroPlay").querySelector("span").textContent = playing ? "Pausar" : current ? "Continuar" : "Escuchar ahora";
    $("heroPlay").querySelector("svg").innerHTML = playing
      ? '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>'
      : '<path d="M8 5v14l11-7z"/>';
    sendListening();
  }
  audio.addEventListener("play", () => {
    stopVideo();
    setMediaSession();
    updatePlayState();
  });
  audio.addEventListener("pause", updatePlayState);
  audio.addEventListener("playing", () => { errorsInARow = 0; });
  audio.addEventListener("ended", next);
  audio.addEventListener("error", () => {
    if (!current) return;
    if (acc.paywall && !acc.unlocked) { openPaywall(); return; } // el servidor pidió comprobante
    errorsInARow++;
    if (errorsInARow > Math.min(5, queue.length)) {
      $("error").textContent = "No se pudo reproducir la música. Intenta recargar la página.";
      $("error").hidden = false;
      return;
    }
    setTimeout(next, 500);
  });

  // Barra de progreso (se puede adelantar) + límite de muestra opcional
  let seeking = false;
  audio.addEventListener("timeupdate", () => {
    const limit = cfg.previewSeconds > 0 ? Math.min(cfg.previewSeconds, audio.duration || Infinity) : audio.duration;
    if (!seeking && limit && isFinite(limit)) {
      $("seek").value = Math.round((audio.currentTime / limit) * 1000);
      $("tCur").textContent = fmt(audio.currentTime);
      $("tDur").textContent = fmt(limit);
    }
    if (cfg.previewSeconds > 0 && audio.currentTime >= cfg.previewSeconds) next();
  });
  $("seek").addEventListener("input", () => { seeking = true; });
  $("seek").addEventListener("change", () => {
    const limit = cfg.previewSeconds > 0 ? Math.min(cfg.previewSeconds, audio.duration || Infinity) : audio.duration;
    if (limit && isFinite(limit)) audio.currentTime = ($("seek").value / 1000) * limit;
    seeking = false;
  });

  // ---------- Oyentes en vivo (reales) ----------
  let listenerId = "";
  try { listenerId = sessionStorage.getItem("lid") || ""; } catch (_) {}
  if (!listenerId) {
    listenerId = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { sessionStorage.setItem("lid", listenerId); } catch (_) {}
  }
  async function sendListening() {
    try {
      const res = await fetch("/api/listening", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: listenerId, active: !audio.paused }),
      });
      const { count } = await res.json();
      if (count > 0) {
        $("listenersText").textContent = `${count} ${count === 1 ? "persona escuchando" : "personas escuchando"} ahora`;
        $("listeners").hidden = false;
      } else {
        $("listeners").hidden = true;
      }
    } catch (_) {}
  }
  sendListening();
  setInterval(sendListening, 20_000);

  // ---------- Videos ----------
  // El video se ve normal; si apagan la pantalla o cambian de app, su sonido sigue en un
  // reproductor de audio (los celulares pausan los videos en segundo plano, pero no el audio).
  const video = $("video");
  const bg = new Audio();
  bg.preload = "auto";
  bg.setAttribute("controlsList", "nodownload");
  let vList = [];
  let vQueue = [];
  let vi = -1;
  let vCurrent = null;
  let videoWanted = false; // la persona quiere que el video siga sonando
  let audioOnly = false; // botón "pantalla apagada" activado
  let bgActive = false; // el sonido del video está saliendo por el reproductor de audio
  let bgUnlocked = false;
  let vErrors = 0;

  const streamUrl = (t) => `/stream/${t.id}`;
  const sameSrc = (el, url) => el.getAttribute("src") === url;

  function setSrcAt(el, url, t) {
    if (sameSrc(el, url)) {
      if (t > 0) el.currentTime = t;
      return;
    }
    el.src = url;
    if (t > 0) {
      el.addEventListener("loadedmetadata", function f() {
        el.currentTime = t;
        el.removeEventListener("loadedmetadata", f);
      });
    }
  }

  // iPhone solo deja sonar un reproductor si se activó con un toque: se activa con un silencio.
  function silentUrl() {
    const n = 800, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
    const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
    w(0, "RIFF"); v.setUint32(4, 36 + n, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 8000, true);
    v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, "data"); v.setUint32(40, n, true);
    for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
    return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  }
  function unlockBg() {
    if (bgUnlocked || bgActive) return;
    bgUnlocked = true;
    const u = silentUrl();
    bg.src = u;
    bg.play().then(() => { if (bg.src === u) bg.pause(); }).catch(() => { bgUnlocked = false; });
  }

  function stopMusic() {
    if (!audio.paused) audio.pause();
  }

  function stopVideo() {
    videoWanted = false;
    if (!video.paused) video.pause();
    if (!bg.paused) bg.pause();
  }

  function playVideo(list, i) {
    vQueue = list.slice();
    unlockBg();
    loadVideo(i);
  }

  function loadVideo(i) {
    if (!vQueue.length) return;
    const target = vQueue[(i + vQueue.length) % vQueue.length];
    if (!allowed(target.id)) {
      stopVideo();
      openPaywall();
      return;
    }
    vi = (i + vQueue.length) % vQueue.length;
    vCurrent = vQueue[vi];
    $("videoTitle").textContent = vCurrent.name;
    videoWanted = true;
    stopMusic();
    if (bgActive || audioOnly) {
      startBg(0);
    } else {
      setSrcAt(video, streamUrl(vCurrent), 0);
      video.play().catch(() => {});
    }
    markVideo();
    setVideoMediaSession();
  }

  function startBg(t) {
    bgActive = true;
    setSrcAt(bg, streamUrl(vCurrent), t);
    if (!video.paused) video.pause();
    bg.play().catch(() => {});
  }

  function backToVideo() {
    if (!bgActive || !vCurrent) return;
    const t = bg.currentTime;
    const playing = !bg.paused;
    bgActive = false;
    bg.pause();
    setSrcAt(video, streamUrl(vCurrent), t);
    if (playing) video.play().catch(() => {});
  }

  function nextVideo() { loadVideo(vi + 1); }
  function prevVideo() { loadVideo(vi - 1); }

  video.addEventListener("play", () => {
    if (bgActive) { // tocaron play en el video estando en modo pantalla apagada
      audioOnly = false;
      updateAudioOnly();
      const t = bg.currentTime;
      bgActive = false;
      bg.pause();
      video.currentTime = t;
    }
    videoWanted = true;
    stopMusic();
    setVideoMediaSession();
  });
  video.addEventListener("pause", () => {
    if (!bgActive && !document.hidden) videoWanted = false;
  });
  video.addEventListener("playing", () => { vErrors = 0; });
  bg.addEventListener("playing", () => { if (bgActive) vErrors = 0; });
  video.addEventListener("ended", nextVideo);
  bg.addEventListener("ended", () => { if (bgActive) nextVideo(); });
  function onVideoError() {
    if (!vCurrent || !videoWanted) return;
    if (acc.paywall && !acc.unlocked) { stopVideo(); openPaywall(); return; }
    if (++vErrors > Math.min(5, vQueue.length)) return;
    setTimeout(nextVideo, 500);
  }
  video.addEventListener("error", onVideoError);
  bg.addEventListener("error", () => { if (bgActive) onVideoError(); });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (vCurrent && videoWanted && !bgActive) startBg(video.currentTime);
    } else if (bgActive && !audioOnly) {
      backToVideo();
    }
  });

  function updateAudioOnly() {
    $("audioOnly").classList.toggle("on", audioOnly);
    $("audioOnly").querySelector("span").textContent = audioOnly
      ? "Modo pantalla apagada activado · tocar para ver el video"
      : "Escuchar con la pantalla apagada";
  }
  $("audioOnly").addEventListener("click", () => {
    audioOnly = !audioOnly;
    updateAudioOnly();
    if (audioOnly) {
      if (!vCurrent) { if (vList.length) playVideo(vList, 0); return; }
      videoWanted = true;
      stopMusic();
      startBg(video.currentTime);
    } else {
      backToVideo();
    }
  });

  function setVideoMediaSession() {
    if (!("mediaSession" in navigator) || !vCurrent) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: vCurrent.name,
      artist: cfg.title || "MÚSICA Y MÁS",
      album: "Videos",
      artwork: [{ src: "/portada.jpg", sizes: "1000x1000", type: "image/jpeg" }],
    });
    const el = () => (bgActive ? bg : video);
    const handlers = {
      play: () => { videoWanted = true; el().play().catch(() => {}); },
      pause: () => { videoWanted = false; el().pause(); },
      nexttrack: nextVideo,
      previoustrack: prevVideo,
    };
    for (const [k, fn] of Object.entries(handlers)) {
      try { navigator.mediaSession.setActionHandler(k, fn); } catch (_) {}
    }
  }

  function renderVideoFolders() {
    const list = cfg.videoFolders || [];
    if (!list.length) return;
    const nav = $("videoFolders");
    nav.innerHTML = "";
    for (const f of list) {
      const b = document.createElement("button");
      b.type = "button";
      const cover = document.createElement("span");
      cover.className = "playlist-cover";
      cover.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.textContent = f.name;
      b.append(cover, label);
      b.dataset.id = f.id;
      b.addEventListener("click", () => selectVideoFolder(f.id));
      nav.appendChild(b);
    }
    nav.hidden = false;
    $("videoFoldersLabel").hidden = false;
  }

  let vFolderSeq = 0;
  async function selectVideoFolder(id) {
    const seq = ++vFolderSeq;
    for (const b of $("videoFolders").children) {
      const selected = b.dataset.id === id;
      b.classList.toggle("on", selected);
      b.setAttribute("aria-pressed", String(selected));
    }
    $("videoInfo").textContent = "Cargando videos…";
    $("videoList").innerHTML = "";
    try {
      const res = await fetch("/api/videos?folder=" + encodeURIComponent(id));
      if (!res.ok) throw new Error();
      const list = await res.json();
      if (seq !== vFolderSeq) return;
      vList = list;
      renderVideoList();
    } catch (_) {
      $("videoInfo").textContent = "No se pudieron cargar los videos. Intenta de nuevo.";
    }
  }

  function renderVideoList() {
    const ol = $("videoList");
    ol.innerHTML = "";
    $("videoInfo").textContent = vList.length
      ? `${vList.length} video${vList.length === 1 ? "" : "s"}`
      : "Esta carpeta no tiene videos todavía.";
    vList.forEach((t, i) => {
      const li = document.createElement("li");
      li.dataset.id = t.id;
      const n = document.createElement("span");
      n.className = "n";
      n.textContent = String(i + 1);
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = t.name;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "song-button";
      n.setAttribute("aria-hidden", "true");
      button.append(n, name);
      button.addEventListener("click", () => playVideo(vList, i));
      li.appendChild(button);
      ol.appendChild(li);
    });
    markVideo();
  }

  function markVideo() {
    [...$("videoList").children].forEach((li, i) => {
      const on = vCurrent && li.dataset.id === vCurrent.id;
      li.classList.toggle("playing", !!on);
      li.querySelector(".n").textContent = on ? "▶" : String(i + 1);
    });
  }

  // ---------- Pestañas ----------
  function showTab(tab) {
    for (const b of $("tabs").children) b.className = b.dataset.tab === tab ? "on" : "";
    $("musicCard").hidden = tab !== "music";
    $("videosCard").hidden = tab !== "videos";
  }
  for (const b of $("tabs").children) b.addEventListener("click", () => showTab(b.dataset.tab));

  // ---------- Acceso: 1 canción gratis y luego comprobante de pago ----------
  let acc = { paywall: false, unlocked: true, trialId: null, codigo: null, estado: null };
  let pollTimer = 0;

  function allowed(id) {
    if (!acc.paywall || acc.unlocked) return true;
    if (!acc.trialId) { // esta es su canción (o video) de prueba
      acc.trialId = id;
      updateAccess();
      return true;
    }
    return acc.trialId === id;
  }

  function updateAccess() {
    const el = $("access");
    if (!acc.paywall) {
      el.hidden = true;
      $("payBtn").hidden = true;
      // Sin comprobantes activados: el botón fijo lleva a WhatsApp (si hay número y precio).
      if (cfg.whatsappUrl && cfg.priceNow) {
        updateCta(true, () => window.open(cfg.whatsappUrl, "_blank", "noopener"));
        $("ctaLabel").textContent = "Comprar el pack";
      }
      return;
    }
    $("ctaLabel").textContent = "Desbloquear el catálogo";
    updateCta(!acc.unlocked, openPaywall);
    el.hidden = false;
    el.classList.toggle("ok", acc.unlocked);
    if (acc.unlocked) el.textContent = "✅ Acceso completo";
    else if (acc.estado === "pendiente") el.textContent = "⏳ Tu comprobante está en revisión";
    else if (acc.trialId) el.textContent = "🔒 Sube tu comprobante para escuchar todo";
    else el.textContent = "🎁 Escucha 1 canción gratis";
    $("payBtn").hidden = acc.unlocked;
    if (!acc.unlocked) showOffer(true); // siempre se ve el botón "Ya pagué"
  }

  async function refreshAccess() {
    try {
      const r = await (await fetch("/api/acceso", { cache: "no-store" })).json();
      const wasLocked = acc.paywall && !acc.unlocked;
      acc = { ...acc, ...r, trialId: r.trialId || acc.trialId };
      updateAccess();
      if (wasLocked && acc.unlocked) showResult("ok", `✅ <b>¡Pago verificado!</b> Ya puedes escuchar toda la música.`, true);
      clearInterval(pollTimer);
      if (acc.paywall && !acc.unlocked && acc.estado === "pendiente") pollTimer = setInterval(refreshAccess, 15000);
    } catch (_) {}
  }

  let paywallTrigger = null;
  function openPaywall() {
    if (!acc.paywall || acc.unlocked) return;
    $("pwPrice").textContent = cfg.priceNow || "el pack";
    $("pwInfo").textContent = cfg.paymentInfo ? ` a: ${cfg.paymentInfo}` : "";
    $("pwSub").textContent = acc.trialId
      ? "Ya escuchaste tu canción de prueba. Para seguir escuchando todo:"
      : "Para escuchar toda la música:";
    if (cfg.whatsappUrl) { $("pwHelp").href = cfg.whatsappUrl; $("pwHelp").hidden = false; }
    if (acc.estado === "pendiente" && acc.codigo) {
      showResult("wait", pendingText(acc.codigo));
    }
    if ($("paywall").hidden) {
      paywallTrigger = document.activeElement;
      $("paywall").hidden = false;
      $("pwClose").focus();
    }
    document.body.style.overflow = "hidden";
  }
  function closePaywall() {
    $("paywall").hidden = true;
    document.body.style.overflow = "";
    if (paywallTrigger?.getClientRects().length) paywallTrigger.focus();
    else $("heroPlay").focus();
    paywallTrigger = null;
  }
  $("pwClose").addEventListener("click", closePaywall);
  $("paywall").addEventListener("click", (e) => { if (e.target === $("paywall")) closePaywall(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("paywall").hidden) closePaywall(); });
  $("payBtn").addEventListener("click", openPaywall);
  $("access").addEventListener("click", () => { if (!acc.unlocked) openPaywall(); });

  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const pendingText = (codigo) =>
    `⏳ <b>Recibimos tu comprobante.</b> Lo estamos revisando y se desbloquea solo apenas lo confirmemos (no cierres la página).` +
    `<br>Tu código: <span class="code">${esc(codigo)}</span>`;

  function showResult(kind, html, withButton) {
    const box = $("pwResult");
    box.className = "pw-result " + kind;
    box.innerHTML = html + (withButton ? '<button type="button" class="btn btn-wa" id="pwDone">Empezar a escuchar 🎶</button>' : "");
    box.hidden = false;
    if (withButton) {
      $("pwForm").hidden = true;
      $("pwCode").hidden = true;
      $("pwDone").addEventListener("click", closePaywall);
    }
  }

  // La imagen se achica en el celular antes de enviarla (más rápido y liviano, y se lee igual).
  function prepararImagen(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const max = 1600;
        const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * s);
        c.height = Math.round(img.naturalHeight * s);
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("imagen")); };
      img.src = url;
    });
  }

  let imagenLista = null;
  $("pwFile").addEventListener("change", async () => {
    const f = $("pwFile").files[0];
    imagenLista = null;
    $("pwPreview").hidden = true;
    if (!f) return;
    $("pwFileText").textContent = "Procesando imagen…";
    try {
      imagenLista = await prepararImagen(f);
      $("pwPreview").src = imagenLista;
      $("pwPreview").hidden = false;
      $("pwFileText").textContent = "📎 Cambiar imagen";
    } catch (_) {
      $("pwFileText").textContent = "📎 Esa imagen no se pudo abrir. Elige otra";
    }
  });

  $("pwForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nombre = $("pwName").value.trim();
    const telefono = $("pwPhone").value.trim();
    if (!nombre || !telefono) return showResult("bad", "Escribe tu nombre y tu WhatsApp.");
    if (!imagenLista) return showResult("bad", "Elige la captura de pantalla del comprobante.");
    $("pwSend").disabled = true;
    $("pwSend").textContent = "Leyendo comprobante…";
    $("pwResult").hidden = true;
    try {
      const res = await fetch("/api/comprobante", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, telefono, imagen: imagenLista }),
      });
      const r = await res.json();
      if (!res.ok) throw new Error(r.error || "Error");
      if (r.estado === "aprobado") {
        acc.unlocked = true;
        acc.codigo = r.codigo;
        acc.estado = "aprobado";
        updateAccess();
        showResult(
          "ok",
          `✅ <b>¡Pago verificado!</b> Ya puedes escuchar toda la música.<br>` +
            `Tu código de acceso: <span class="code">${esc(r.codigo)}</span><br>` +
            `<small>Guárdalo: con él entras desde otro celular o computador.</small>`,
          true
        );
      } else if (r.estado === "pendiente") {
        acc.codigo = r.codigo;
        acc.estado = "pendiente";
        updateAccess();
        showResult("wait", pendingText(r.codigo));
        clearInterval(pollTimer);
        pollTimer = setInterval(refreshAccess, 15000);
      } else {
        showResult("bad", `❌ <b>${esc(r.motivo || "No pudimos aceptar este comprobante")}.</b><br>Si crees que es un error, escríbenos por WhatsApp.`);
      }
    } catch (err) {
      showResult("bad", esc(err.message || "No se pudo enviar. Revisa tu conexión e intenta de nuevo."));
    } finally {
      $("pwSend").disabled = false;
      $("pwSend").textContent = "Enviar comprobante";
    }
  });

  $("codeForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const codigo = $("codeInput").value.trim();
    if (!codigo) return;
    $("codeMsg").textContent = "Revisando…";
    try {
      const res = await fetch("/api/codigo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo }),
      });
      const r = await res.json();
      if (!res.ok) throw new Error(r.error || "Error");
      if (r.estado === "aprobado") {
        $("codeMsg").textContent = "";
        acc.unlocked = true;
        acc.estado = "aprobado";
        updateAccess();
        showResult("ok", "✅ <b>¡Listo!</b> Ya puedes escuchar toda la música en este dispositivo.", true);
      } else if (r.estado === "pendiente") {
        $("codeMsg").textContent = "Ese comprobante todavía está en revisión. Se desbloquea solo cuando lo aprobemos.";
        acc.estado = "pendiente";
        updateAccess();
        clearInterval(pollTimer);
        pollTimer = setInterval(refreshAccess, 15000);
      } else {
        $("codeMsg").textContent = "Ese código no está activo. Escríbenos por WhatsApp.";
      }
    } catch (err) {
      $("codeMsg").textContent = err.message;
    }
  });

  await refreshAccess();

  // ---------- Inicio ----------
  const hasMusic = (cfg.stations || []).length > 0;
  const hasVideos = (cfg.videoFolders || []).length > 0;
  if (hasMusic) {
    renderStations();
    selectStation(cfg.stations[0].id);
  } else {
    $("heroPlay").hidden = true;
  }
  if (hasVideos) {
    renderVideoFolders();
    selectVideoFolder(cfg.videoFolders[0].id);
  }
  if (hasMusic && hasVideos) $("tabs").hidden = false;
  showTab(hasMusic ? "music" : "videos");
})();
