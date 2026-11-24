/* connorvanscyoc.com
   Everything is a static file from public/, except /api/*, which runs here.

   /api/bananas
     GET  anyone: the banana log, as { events: [...], updated }
     PUT  Connor's phone only (Authorization: Bearer <BANANA_KEY>): replace the log
   /api/pie
     GET  anyone: totals from the Pie Chart of Life tracker (see pie.js)
   /api/tracker/script, /api/tracker/gps
     the tracker app's own requests, owner key required (see tracker() below)
   The log lives in the BANANAS key-value store. Before the first change each day,
   the previous log is copied to backup:YYYY-MM-DD and kept for 120 days. */

import { pie } from "./pie.js";

const TYPES = new Set(["eat", "away", "buy", "open", "count"]);
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, PUT, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS },
  });
}

function clean(list) {
  if (!Array.isArray(list) || list.length > 200000) return null;
  const out = [];
  for (const e of list) {
    if (!e || !TYPES.has(e.t)) return null;
    const n = Number(e.n), ts = Number(e.ts);
    if (!Number.isFinite(n) || n < 0 || !Number.isFinite(ts)) return null;
    out.push({ id: String(e.id || ts).slice(0, 64), t: e.t, n, ts });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

async function bananas(req, env) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (!env.BANANAS) return json({ error: "Storage isn't connected yet." }, 503);

  if (req.method === "GET") {
    const raw = await env.BANANAS.get("events");
    return json(raw ? JSON.parse(raw) : { events: [], updated: null });
  }

  if (req.method === "PUT") {
    const auth = req.headers.get("authorization") || "";
    if (!env.BANANA_KEY || auth !== "Bearer " + env.BANANA_KEY) return json({ error: "Wrong key." }, 401);

    let body;
    try { body = await req.json(); } catch { return json({ error: "Not JSON." }, 400); }
    const events = clean(body && body.events);
    if (!events) return json({ error: "That isn't a valid banana log." }, 400);

    const previous = await env.BANANAS.get("events");
    const prevCount = previous ? (JSON.parse(previous).events || []).length : 0;
    // A phone with wiped storage would send an empty log. Never let that erase the real one.
    if (events.length === 0 && prevCount > 0) return json({ error: "Refusing to replace the log with nothing." }, 409);

    if (previous) {
      const day = new Date().toISOString().slice(0, 10);
      const backupKey = "backup:" + day;
      if (!(await env.BANANAS.get(backupKey))) {
        await env.BANANAS.put(backupKey, previous, { expirationTtl: 120 * 86400 });
      }
    }
    const updated = Date.now();
    await env.BANANAS.put("events", JSON.stringify({ events, updated }));
    return json({ ok: true, count: events.length, updated });
  }

  return json({ error: "Method not allowed." }, 405);
}


/* /api/tracker/script and /api/tracker/gps: the tracker app's two Apps Script addresses,
   kept as secrets (PIE_SCRIPT_URL, TRACKER_GPS_URL). Owner key required. Method, query
   string and body pass through untouched, so the app behaves exactly as it did before. */
async function tracker(req, env, which) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const auth = req.headers.get("authorization") || "";
  if (!env.BANANA_KEY || auth !== "Bearer " + env.BANANA_KEY) return json({ success: false, error: "Wrong key." }, 401);
  const base = which === "gps" ? env.TRACKER_GPS_URL : env.PIE_SCRIPT_URL;
  if (!base) return json({ success: false, error: "Not connected yet." }, 503);

  // Pass the query string through byte for byte (trip descriptions are user text).
  const target = new URL(base);
  const extra = new URL(req.url).search.slice(1);
  if (extra) target.search = (target.search ? target.search.slice(1) + "&" : "") + extra;
  const init = { method: req.method, redirect: "follow", headers: {} };
  const type = req.headers.get("content-type");
  if (type) init.headers["content-type"] = type;
  if (req.method !== "GET" && req.method !== "HEAD") init.body = await req.text();

  const res = await fetch(target.toString(), init);
  // A new entry or an edit changes the pie; let the public totals refresh right away.
  if (which === "script" && (req.method === "POST" || target.searchParams.has("action")) && env.BANANAS) {
    await env.BANANAS.delete("pie:summary");
  }
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") || "application/json", "cache-control": "no-store" },
  });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/api/bananas") return bananas(req, env);
    if (url.pathname === "/api/pie") return pie(req, env, json);
    if (url.pathname === "/api/tracker/script") return tracker(req, env, "script");
    if (url.pathname === "/api/tracker/gps") return tracker(req, env, "gps");
    return env.ASSETS.fetch(req);
  },
};
