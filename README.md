# piccionesebastiano.github.io

Personal site. Static HTML/CSS/JS, no build step, served by GitHub Pages.

```
index.html      the whole site (single page, anchor-navigated sections)
style.css
script.js       nav toggle, scroll reveals, count-up metrics
analytics.js    behavioural telemetry — see below
favicon.png
```

## Analytics

`analytics.js` feeds the click/attention heatmap rendered by the `cv-bot-frontend`
admin dashboard, via the `POST /site/events` endpoint on `cv-bot-backend`.

It reports pageviews, clicks (with position and the clicked element), sampled
pointer positions, deepest scroll reached, time on page, and rage clicks. Events
are queued and flushed every 10s — and on tab-hide via `fetch(…, { keepalive: true })`,
which unlike `sendBeacon` still carries the auth header.

Positions are normalised to **% of viewport width** horizontally and **absolute px
from the document top** vertically, so they survive responsive reflow and can be
replayed over the real page at any width.

**Privacy**: no cookies and no persistent identifier — the session id lives in
`sessionStorage` and dies with the tab. Only the referrer *host* is sent, never a
full URL. The whole script no-ops when the browser sends Do Not Track.

Configure via `window.SITE_ANALYTICS_CONFIG` before the script tag; by default it
reuses `window.CV_CHAT_CONFIG.widgetToken` as its auth token, so the secret is
only written once in the page.

```js
window.SITE_ANALYTICS_CONFIG = {
  endpoint: 'https://…/site/events',
  trackMoves: false,   // disable the attention layer
  flushInterval: 10000,
};
```
