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
  $("offer").hidden = !(cfg.priceNow || cfg.whatsappUrl || cfg.buyUrl);

  if (cfg.features && cfg.features.length) {
    for (const f of cfg.features) {
      const li = document.createElement("li");
      li.textContent = f;
      $("features").appendChild(li);
    }
    $("featuresCard").hidden = false;
  }

  document.body.classList.add("no-player");

  // ---------- Géneros ----------
  function renderStations() {
    const list = cfg.stations || [];
    if (list.length < 2) return;
    const nav = $("stations");
    nav.innerHTML = "";
    for (const st of list) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = st.name;
      b.dataset.id = st.id;
      b.className = st.id === station ? "on" : "";
      b.addEventListener("click", () => selectStation(st.id));
      nav.appendChild(b);
    }
    nav.hidden = false;
  }

  function stationName(id) {
    const st = (cfg.stations || []).find((s) => s.id === id);
    return st ? st.name : "";
  }

  async function selectStation(id) {
    station = id;
    for (const b of $("stations").children) b.className = b.dataset.id === id ? "on" : "";
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
      li.append(n, name);
      li.addEventListener("click", () => playFrom(shown, i));
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
    if (!q) { showList(stationTracks, false); return; }
    searchTimer = setTimeout(async () => {
      const seq = ++searchSeq;
      $("listInfo").textContent = "Buscando…";
      try {
        const res = await fetch("/api/search?q=" + encodeURIComponent(q));
        const results = await res.json();
        if (seq === searchSeq) showList(results, true);
      } catch (_) {
        if (seq === searchSeq) $("listInfo").textContent = "No se pudo buscar. Intenta de nuevo.";
      }
    }, 250);
  });

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
  audio.addEventListener("play", updatePlayState);
  audio.addEventListener("pause", updatePlayState);
  audio.addEventListener("playing", () => { errorsInARow = 0; });
  audio.addEventListener("ended", next);
  audio.addEventListener("error", () => {
    if (!current) return;
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

  // ---------- Inicio ----------
  renderStations();
  selectStation((cfg.stations && cfg.stations[0] && cfg.stations[0].id) || "0");
})();
