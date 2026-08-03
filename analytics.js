/**
 * Site analytics — click/attention heatmap, scroll depth, time on page.
 *
 * Nessun cookie e nessun identificatore persistente: l'id di sessione vive in
 * sessionStorage e muore con la scheda. Le posizioni sono normalizzate in
 * percentuale della larghezza del viewport (x) e in pixel assoluti dal top del
 * documento (y), così sopravvivono al reflow responsive.
 *
 * Configurabile con window.SITE_ANALYTICS_CONFIG prima di includere lo script.
 */
(function () {
  'use strict';

  // Il token del widget di chat è lo stesso WIDGET_SECRET che protegge
  // /site/events: lo riusiamo invece di ripeterlo nella pagina.
  const CHAT_CONFIG = window.CV_CHAT_CONFIG || {};

  const CONFIG = Object.assign(
    {
      endpoint: 'https://cv-bot-backend-production.up.railway.app/site/events',
      token: CHAT_CONFIG.widgetToken || '',
      flushInterval: 10000, // ms
      maxBatch: 25,         // il backend ne accetta 40 per richiesta
      trackMoves: true,
      moveSampleMs: 250,    // campionamento del puntatore
      maxMovesPerView: 120, // tetto per pageview: la telemetria resta prevedibile
    },
    window.SITE_ANALYTICS_CONFIG || {},
  );

  // Il sito dentro un iframe è l'anteprima della dashboard heatmap, non una
  // visita: contarla sporcherebbe le statistiche con il traffico di chi le
  // guarda. Il flag ?preview=1 è il marcatore esplicito usato dalla dashboard,
  // il controllo sul frame copre qualunque altro incorporamento.
  function isPreview() {
    try {
      if (window.top !== window.self) return true;
    } catch (_) {
      return true; // accesso negato ⇒ siamo comunque incorniciati
    }
    return /(^|[?&])preview=1(&|$)/.test(location.search);
  }

  // Do Not Track e browser senza le API che servono: nessuna raccolta.
  if (
    navigator.doNotTrack === '1' ||
    window.doNotTrack === '1' ||
    !window.fetch ||
    !window.sessionStorage ||
    isPreview()
  ) {
    return;
  }

  // ─── Sessione ──────────────────────────────────────────────────────────────

  const SESSION_KEY = 'site-analytics-session';

  function sessionId() {
    try {
      let id = sessionStorage.getItem(SESSION_KEY);
      if (!id) {
        id = (window.crypto && crypto.randomUUID)
          ? crypto.randomUUID()
          : 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
        sessionStorage.setItem(SESSION_KEY, id);
      }
      return id;
    } catch (_) {
      return 'anon';
    }
  }

  const SESSION = sessionId();

  // ─── Contesto ──────────────────────────────────────────────────────────────

  function device() {
    const w = window.innerWidth;
    if (w < 768) return 'mobile';
    if (w < 1024) return 'tablet';
    return 'desktop';
  }

  function path() {
    // La query string è rumore per l'aggregazione: la pagina è il path.
    return location.pathname.slice(0, 200) || '/';
  }

  function docHeight() {
    const b = document.body;
    const e = document.documentElement;
    return Math.max(b.scrollHeight, b.offsetHeight, e.scrollHeight, e.offsetHeight, e.clientHeight);
  }

  function referrerHost() {
    // Solo l'host: il path del referrer può contenere dati altrui.
    try {
      if (!document.referrer) return '';
      const host = new URL(document.referrer).host;
      return host === location.host ? '' : host.slice(0, 100);
    } catch (_) {
      return '';
    }
  }

  // ─── Coda e invio ──────────────────────────────────────────────────────────

  const queue = [];
  let flushTimer = null;

  function push(event) {
    queue.push(Object.assign({ path: path(), device: device() }, event));
    if (queue.length >= CONFIG.maxBatch) flush();
    else if (!flushTimer) flushTimer = setTimeout(flush, CONFIG.flushInterval);
  }

  // keepalive tiene viva la richiesta oltre la pagina e — a differenza di
  // sendBeacon — porta con sé l'header del token.
  function flush(keepalive) {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (queue.length === 0) return;

    const events = queue.splice(0, 40);

    fetch(CONFIG.endpoint, {
      method: 'POST',
      keepalive: !!keepalive,
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        CONFIG.token ? { 'X-Widget-Token': CONFIG.token } : {},
      ),
      body: JSON.stringify({ sessionId: SESSION, events: events }),
    }).catch(function () {}); // la telemetria non deve mai rompere la pagina

    if (queue.length > 0 && !flushTimer) flushTimer = setTimeout(flush, CONFIG.flushInterval);
  }

  // ─── Selettore stabile ─────────────────────────────────────────────────────

  // Percorso corto e leggibile: id se c'è, altrimenti tag + prima classe,
  // risalendo al massimo di tre livelli. Serve a raggruppare i click per
  // elemento, non a fare da selettore CSS universale.
  function describe(el) {
    const parts = [];
    let node = el;
    let depth = 0;

    while (node && node.nodeType === 1 && depth < 3) {
      if (node.id) {
        parts.unshift('#' + node.id);
        break;
      }
      let part = node.tagName.toLowerCase();
      const cls = (node.getAttribute('class') || '').trim().split(/\s+/)[0];
      if (cls) part += '.' + cls;
      parts.unshift(part);
      node = node.parentElement;
      depth++;
    }

    return parts.join(' > ').slice(0, 160);
  }

  function labelFor(el) {
    const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
    if (text) return text.slice(0, 80);
    return (el.getAttribute('aria-label') || el.getAttribute('title') || '').slice(0, 80);
  }

  // ─── Pageview ──────────────────────────────────────────────────────────────

  let viewStart = Date.now();
  let maxScroll = 0;
  let movesThisView = 0;
  let leaveSent = false;

  function sendPageview() {
    viewStart = Date.now();
    maxScroll = 0;
    movesThisView = 0;
    leaveSent = false;

    push({
      type: 'pageview',
      docHeight: docHeight(),
      viewportWidth: window.innerWidth,
      referrer: referrerHost(),
    });
  }

  // ─── Click + rage click ────────────────────────────────────────────────────

  const RAGE_WINDOW_MS = 700;
  const RAGE_RADIUS_PX = 30;
  const RAGE_THRESHOLD = 3;
  let recentClicks = [];

  function isRage(pageX, pageY) {
    const now = Date.now();
    recentClicks = recentClicks.filter(function (c) { return now - c.t < RAGE_WINDOW_MS; });
    recentClicks.push({ x: pageX, y: pageY, t: now });

    const near = recentClicks.filter(function (c) {
      return Math.abs(c.x - pageX) < RAGE_RADIUS_PX && Math.abs(c.y - pageY) < RAGE_RADIUS_PX;
    });
    return near.length >= RAGE_THRESHOLD;
  }

  // capture: registriamo il click anche se un handler lo ferma o naviga via.
  document.addEventListener('click', function (e) {
    const vw = window.innerWidth || 1;
    const pageY = e.clientY + window.scrollY;

    const target = e.target && e.target.nodeType === 1 ? e.target : null;
    const el = target ? (target.closest('a, button, [role="button"], input, label, summary') || target) : null;

    push({
      type: 'click',
      x: Math.min(100, Math.max(0, (e.clientX / vw) * 100)),
      y: Math.max(0, pageY),
      viewportWidth: vw,
      selector: el ? describe(el) : '',
      label: el ? labelFor(el) : '',
      rage: isRage(e.clientX, pageY),
    });
  }, true);

  // ─── Movimento campionato (heatmap di attenzione) ──────────────────────────

  if (CONFIG.trackMoves) {
    let lastMove = 0;
    window.addEventListener('mousemove', function (e) {
      const now = Date.now();
      if (now - lastMove < CONFIG.moveSampleMs) return;
      if (movesThisView >= CONFIG.maxMovesPerView) return;
      lastMove = now;
      movesThisView++;

      const vw = window.innerWidth || 1;
      push({
        type: 'move',
        x: Math.min(100, Math.max(0, (e.clientX / vw) * 100)),
        y: Math.max(0, e.clientY + window.scrollY),
      });
    }, { passive: true });
  }

  // ─── Scroll depth ──────────────────────────────────────────────────────────

  let scrollScheduled = false;
  window.addEventListener('scroll', function () {
    if (scrollScheduled) return;
    scrollScheduled = true;
    requestAnimationFrame(function () {
      scrollScheduled = false;
      const height = docHeight();
      const scrollable = height - window.innerHeight;
      // Una pagina che sta tutta nel viewport è vista al 100% per definizione.
      const pct = scrollable <= 0 ? 100 : ((window.scrollY + window.innerHeight) / height) * 100;
      if (pct > maxScroll) maxScroll = Math.min(100, pct);
    });
  }, { passive: true });

  // ─── Uscita ────────────────────────────────────────────────────────────────

  function sendLeave() {
    if (leaveSent) return;
    leaveSent = true;
    push({
      type: 'leave',
      scroll: Math.round(maxScroll * 100) / 100,
      seconds: Math.min(7200, Math.round((Date.now() - viewStart) / 1000)),
      docHeight: docHeight(),
    });
    flush(true);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') sendLeave();
    // Tornando visibili la pagina riparte come una nuova permanenza.
    else if (leaveSent) { viewStart = Date.now(); leaveSent = false; }
  });
  window.addEventListener('pagehide', sendLeave);

  // ─── SPA / navigazione ad ancore ───────────────────────────────────────────

  let lastPath = path();
  window.addEventListener('popstate', function () {
    if (path() === lastPath) return;
    sendLeave();
    lastPath = path();
    sendPageview();
  });

  sendPageview();
})();
