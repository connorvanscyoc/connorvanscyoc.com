/* Pie Chart of Life, public summary.

   The tracker app on Connor's phone logs every arrival in a place (a state or a
   country) to a Google Sheet. This reads that log through the same Apps Script
   address the app uses (the PIE_SCRIPT_URL secret) and turns it into totals:
   time spent in each place, for his whole life and for each year of it.

   Privacy: only totals leave here, never individual entries or a current location. */

const LAG_DAYS = 0;   // Connor's call: totals can be fully up to date
const CACHE_KEY = "pie:data";
const CACHE_MS = 10 * 60 * 1000;          // re-read the sheet at most every 10 minutes
const BIRTH = Date.parse("1996-11-04T07:31:00-05:00");
const DAY = 86400000;

// Same lists and colors as the tracker app, so the two agree.
const US_STATES = new Set(["Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia","Wisconsin","Wyoming"]);
const US_ALL = new Set([...US_STATES, "Washington DC", "Puerto Rico", "Guam", "US Virgin Islands", "American Samoa", "Northern Mariana Islands"]);
// (The app repeats a red and a purple in its first ten; the site swaps those two for pink and teal so no two big slices look alike.)
const COLORS = ["#e94560","#4d96ff","#ffd93d","#6bcb77","#ff9f43","#a855f7","#06b6d4","#ec4899","#84cc16","#14b8a6","#f43f5e","#8b5cf6","#f97316","#6366f1","#22c55e","#eab308","#ef4444","#3b82f6","#10b981","#f59e0b","#8b5cf6","#ec4899"];

const isFlight = (loc) => /^flights?$/i.test(loc || "");
const clean = (loc) => (isFlight(loc) ? "Flights" : String(loc || "").trim());

/* entries: [{ t: ms, loc }] sorted. Seconds per place between a and b. */
function totalsBetween(entries, a, b) {
  const out = {};
  for (let i = 0; i < entries.length; i++) {
    const s = entries[i].t, e = i + 1 < entries.length ? entries[i + 1].t : b;
    const lo = Math.max(s, a), hi = Math.min(e, b);
    if (hi > lo) out[entries[i].loc] = (out[entries[i].loc] || 0) + (hi - lo) / 1000;
  }
  return out;
}

export function summarize(rows, now = Date.now()) {
  const cutoff = now - LAG_DAYS * DAY;
  const entries = rows
    .map((r) => ({ t: Date.parse(r.timestamp), loc: clean(r.location) }))
    .filter((e) => Number.isFinite(e.t) && e.loc && e.t <= cutoff)
    .sort((x, y) => x.t - y.t);
  if (!entries.length) return null;

  const start = entries[0].t;
  const life = totalsBetween(entries, start, cutoff);
  const ranked = Object.keys(life).sort((a, b) => life[b] - life[a]);
  const colors = Object.fromEntries(ranked.map((loc, i) => [loc, COLORS[i % COLORS.length]]));
  const toDays = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round((v / 86400) * 10) / 10]));

  // One pie per year of life, birthday to birthday.
  const years = [];
  for (let age = 0; ; age++) {
    const a = new Date(BIRTH); a.setFullYear(a.getFullYear() + age);
    const b = new Date(BIRTH); b.setFullYear(b.getFullYear() + age + 1);
    if (a.getTime() >= cutoff) break;
    years.push({
      age, year: a.getFullYear(), partial: b.getTime() > cutoff,
      days: toDays(totalsBetween(entries, a.getTime(), Math.min(b.getTime(), cutoff))),
    });
  }

  const places = new Set(entries.map((e) => e.loc).filter((l) => !isFlight(l)));
  const flights = entries.filter((e) => isFlight(e.loc)).length;
  const nonUS = [...places].filter((l) => !US_ALL.has(l)).length;
  const visitedUS = [...places].some((l) => US_ALL.has(l));

  return {
    through: new Date(cutoff).toISOString(),
    lagDays: LAG_DAYS,
    born: new Date(BIRTH).toISOString(),
    daysMapped: Math.round((cutoff - start) / DAY),
    places: places.size,
    states: [...places].filter((l) => US_STATES.has(l)).length,
    countries: (visitedUS ? 1 : 0) + nonUS,
    flights,
    crossings: entries.length - flights,
    order: ranked,
    colors,
    life: toDays(life),
    years,
  };
}

async function readSheet(env) {
  const res = await fetch(env.PIE_SCRIPT_URL, { redirect: "follow", headers: { accept: "application/json" } });
  if (!res.ok) throw new Error("sheet " + res.status);
  const body = await res.json();
  if (!body || !body.success || !Array.isArray(body.data)) throw new Error("unexpected sheet reply");
  return body.data;
}

/* The public timeline: when Connor arrived in each place, and nothing else
   (no trip descriptions, no coordinates). Places are listed once and
   referenced by index to keep it small. */
function timelineOf(rows, summary) {
  const entries = rows
    .map((r) => ({ t: Date.parse(r.timestamp), loc: clean(r.location) }))
    .filter((e) => Number.isFinite(e.t) && e.loc)
    .sort((a, b) => a.t - b.t);
  const places = summary.order.slice();
  for (const e of entries) if (!places.includes(e.loc)) places.push(e.loc);
  const index = Object.fromEntries(places.map((p, i) => [p, i]));
  return { places, colors: summary.colors, born: summary.born, entries: entries.map((e) => [e.t, index[e.loc]]) };
}

async function load(env) {
  const cached = await env.BANANAS.get(CACHE_KEY, "json");
  if (cached && cached.timeline && Date.now() - cached.fetchedAt < CACHE_MS) return cached;
  try {
    const rows = await readSheet(env);
    const summary = summarize(rows);
    if (!summary) throw new Error("no entries");
    const fresh = { fetchedAt: Date.now(), summary, timeline: timelineOf(rows, summary) };
    await env.BANANAS.put(CACHE_KEY, JSON.stringify(fresh));
    return fresh;
  } catch (err) {
    // The sheet can be slow or briefly unavailable; an older copy is better than nothing.
    if (cached && cached.timeline) return cached;
    throw err;
  }
}

export async function pie(req, env, json, what) {
  if (req.method !== "GET") return json({ error: "Method not allowed." }, 405);
  if (!env.PIE_SCRIPT_URL || !env.BANANAS) return json({ error: "Not connected yet." }, 503);
  try {
    const data = await load(env);
    return json(what === "timeline" ? data.timeline : data.summary);
  } catch (err) {
    return json({ error: "Couldn't read the tracker right now." }, 502);
  }
}

export const PIE_CACHE_KEY = CACHE_KEY;
