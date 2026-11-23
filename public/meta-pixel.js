// Eventos de la tienda. El identificador de compra es independiente del código de acceso.
function iniciarPixelMeta(id) {
  const activo = /^\d+$/.test(id || "");
  const pendingKey = "mym-meta-compra-" + id;
  let pendiente = null;

  if (activo) {
    if (!window.fbq) {
      const fbq = function () {
        if (fbq.callMethod) fbq.callMethod.apply(fbq, arguments);
        else fbq.queue.push(arguments);
      };
      fbq.queue = [];
      fbq.push = fbq;
      fbq.loaded = true;
      fbq.version = "2.0";
      window.fbq = fbq;
      window._fbq = window._fbq || fbq;
      const script = document.createElement("script");
      script.async = true;
      script.src = "https://connect.facebook.net/es_LA/fbevents.js";
      document.head.appendChild(script);
    }
    window.fbq("set", "autoConfig", false, id);
    window.fbq("init", id);
    evento("PageView");
    evento("ViewContent", { content_name: "Acceso al catálogo musical" });
    try { pendiente = localStorage.getItem(pendingKey); } catch (_) {}
  }

  function evento(nombre, datos = {}) {
    if (activo) window.fbq("trackSingle", id, nombre, datos);
  }

  function recibida(compra) {
    if (!activo || !compra) return;
    pendiente = compra.id;
    try { localStorage.setItem(pendingKey, pendiente); } catch (_) {}
  }

  function aprobada(compra) {
    if (!activo || !compra || compra.id !== pendiente || !(compra.value > 0)) return;
    const sentKey = pendingKey + "-enviada-" + compra.id;
    function enviarUnaVez() {
      if (pendiente !== compra.id) return;
      pendiente = null;
      try {
        if (localStorage.getItem(sentKey)) return;
        localStorage.setItem(sentKey, "1");
        if (localStorage.getItem(pendingKey) === compra.id) localStorage.removeItem(pendingKey);
      } catch (_) {}
      window.fbq("trackSingle", id, "Purchase", { value: compra.value, currency: "COP" }, { eventID: compra.id });
    }
    // Dos pestañas pueden detectar la misma aprobación en el mismo instante.
    if (navigator.locks) navigator.locks.request(sentKey, enviarUnaVez).catch(enviarUnaVez);
    else enviarUnaVez();
  }

  return { evento, recibida, aprobada };
}
