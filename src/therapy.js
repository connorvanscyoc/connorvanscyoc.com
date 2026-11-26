// Every therapy session, for /therapy.
//
// SEED is the session list from the "Every Therapy Session" calendar (Nov 2026),
// kept exactly as it was: date -> number of payments that day.
// New sessions come from THERAPY_SCRIPT_URL, a small Apps Script on Connor's Gmail
// that lists his Venmo payments to his therapist. Only payments after SEED_THROUGH
// are added, so the history above never changes.
// Only dates leave this file: no amounts, captions or names.

const SEED = {
  "2022-06-08": 1, "2022-06-13": 1, "2022-06-17": 1, "2022-06-20": 1, "2022-06-27": 1,
  "2022-07-07": 1, "2022-07-12": 1, "2022-07-17": 1, "2022-07-27": 1, "2022-08-19": 1,
  "2022-09-21": 1, "2022-11-28": 1, "2022-12-12": 1, "2022-12-21": 1,
  "2023-02-21": 1, "2023-04-04": 1, "2023-04-26": 1, "2023-06-27": 1, "2023-07-18": 1,
  "2023-08-24": 1, "2023-09-05": 1, "2023-09-08": 1, "2023-09-22": 1, "2023-11-07": 1,
  "2024-01-23": 1, "2024-04-23": 1, "2024-05-30": 1, "2024-08-21": 1, "2024-10-22": 1,
  "2025-01-03": 1, "2025-01-07": 1, "2025-01-16": 1, "2025-01-29": 1, "2025-03-25": 1,
  "2025-04-15": 1, "2025-04-28": 1, "2025-05-05": 1, "2025-05-21": 1, "2025-07-16": 1,
  "2025-07-24": 1, "2025-08-07": 1, "2025-08-19": 1, "2025-09-08": 1, "2025-10-03": 1,
  "2025-10-08": 1, "2025-10-14": 1, "2025-10-24": 1, "2025-10-30": 1,
  "2026-02-03": 1, "2026-06-01": 1, "2026-07-16": 1, "2026-07-21": 1, "2026-07-28": 2,
  "2026-08-04": 1, "2026-08-10": 1, "2026-08-18": 1, "2026-08-25": 1, "2026-09-03": 1,
  "2026-10-13": 1, "2026-11-05": 1, "2026-11-10": 1, "2026-11-23": 1
};
const START = "2022-06-08";
const SEED_THROUGH = "2026-11-23";      // payment date of the last session in SEED
const CACHE_KEY = "therapy:data";
const CACHE_MS = 6 * 60 * 60 * 1000;    // ask Gmail at most every 6 hours

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const decode = (s) => String(s || "")
  .replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");

// "11/23 session" -> 2026-11-23, "8/10 and 8/18 sessions" -> two dates,
// "April 15th session" -> 04-15. The year comes from the payment; a caption date
// more than two weeks after the payment means the session was the year before.
// No date in the caption -> the payment date.
export function sessionDates(paidOn, caption) {
  const [py, pm, pd] = paidOn.split("-").map(Number);
  const paid = Date.UTC(py, pm - 1, pd);
  const found = [];
  const text = decode(caption).toLowerCase();
  for (const m of text.matchAll(/\b(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?/g)) {
    found.push([Number(m[1]), Number(m[2]), m[3] ? Number(m[3].length === 2 ? "20" + m[3] : m[3]) : null]);
  }
  for (const m of text.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/g)) {
    found.push([MONTHS.indexOf(m[1]) + 1, Number(m[2]), null]);
  }
  const out = [];
  for (const [mo, d, y0] of found) {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    let y = y0 || py;
    if (!y0 && Date.UTC(y, mo - 1, d) - paid > 14 * 864e5) y -= 1;
    out.push(iso(y, mo, d));
  }
  return out.length ? [...new Set(out)] : [paidOn];
}

async function fromGmail(env) {
  const res = await fetch(env.THERAPY_SCRIPT_URL, { redirect: "follow" });
  if (!res.ok) throw new Error("Gmail script returned " + res.status);
  const body = await res.json();
  if (!body || !Array.isArray(body.payments)) throw new Error("Gmail script reply has no payments list");
  const days = {};
  for (const p of body.payments) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date || "") || p.date <= SEED_THROUGH) continue;
    for (const d of sessionDates(p.date, p.note)) days[d] = (days[d] || 0) + 1;
  }
  return days;
}

async function load(env) {
  const cached = await env.BANANAS.get(CACHE_KEY, "json");
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) return cached;
  if (!env.THERAPY_SCRIPT_URL) return { fetchedAt: Date.now(), added: {}, connected: false };
  try {
    const fresh = { fetchedAt: Date.now(), added: await fromGmail(env), connected: true };
    await env.BANANAS.put(CACHE_KEY, JSON.stringify(fresh));
    return fresh;
  } catch (err) {
    console.log("therapy: " + err.message);
    return cached || { fetchedAt: Date.now(), added: {}, connected: false };
  }
}

export async function therapy(req, env, json) {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const data = await load(env);
  const days = { ...SEED };
  for (const [d, n] of Object.entries(data.added || {})) if (d > SEED_THROUGH || !days[d]) days[d] = (days[d] || 0) + n;
  return json({ start: START, checkedAt: data.fetchedAt, connected: data.connected, days });
}
