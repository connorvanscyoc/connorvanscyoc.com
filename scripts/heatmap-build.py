"""Turn a Strava archive into the heatmap's data file.

Usage: python3 build.py <unzipped Strava archive dir> <out tracks.json> [<Nike export tcx dir>]
Keeps rides, runs, walks and hikes. Each track is simplified (points closer
than ~6 m to the line are dropped) and stored as an encoded polyline.
"""
import csv, gzip, io, json, math, sys, os, datetime, re
import xml.etree.ElementTree as ET
import fitdecode

KEEP = {"Ride": "ride", "Run": "run", "Walk": "walk", "Hike": "hike",
        "E-Bike Ride": "ride", "Virtual Ride": None, "Trail Run": "run"}
TOL_M = 6.0
from zoneinfo import ZoneInfo
ET_TZ = ZoneInfo("America/New_York")


def read_gpx(data):
    pts = []
    for ev, el in ET.iterparse(io.BytesIO(data)):
        if el.tag.endswith("trkpt") or el.tag.endswith("rtept"):
            pts.append((float(el.get("lat")), float(el.get("lon"))))
            el.clear()
    return pts


def read_tcx(data):
    pts = []
    root = ET.fromstring(data.strip())
    for tp in root.iter():
        if tp.tag.endswith("Position"):
            lat = lon = None
            for c in tp:
                if c.tag.endswith("LatitudeDegrees"): lat = float(c.text)
                if c.tag.endswith("LongitudeDegrees"): lon = float(c.text)
            if lat is not None and lon is not None: pts.append((lat, lon))
    return pts


def read_fit(data):
    pts = []
    with fitdecode.FitReader(io.BytesIO(data)) as fr:
        for frame in fr:
            if isinstance(frame, fitdecode.FitDataMessage) and frame.name == "record":
                if frame.has_field("position_lat") and frame.has_field("position_long"):
                    la, lo = frame.get_value("position_lat"), frame.get_value("position_long")
                    if la is not None and lo is not None:
                        pts.append((la * 180 / 2**31, lo * 180 / 2**31))
    return pts


def read_track(path):
    data = open(path, "rb").read()
    name = path
    if name.endswith(".gz"):
        data = gzip.decompress(data); name = name[:-3]
    if name.endswith(".gpx"): return read_gpx(data)
    if name.endswith(".tcx"): return read_tcx(data)
    if name.endswith(".fit"): return read_fit(data)
    return []


def simplify(pts, tol):
    """Ramer-Douglas-Peucker on a local flat projection, iterative."""
    if len(pts) < 3: return pts
    lat0 = math.radians(sum(p[0] for p in pts) / len(pts))
    xy = [(p[1] * 111320 * math.cos(lat0), p[0] * 110540) for p in pts]
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = xy[a]; bx, by = xy[b]; dx, dy = bx - ax, by - ay; L = dx * dx + dy * dy
        best, bi = -1, -1
        for i in range(a + 1, b):
            px, py = xy[i]
            if L == 0: d = math.hypot(px - ax, py - ay)
            else:
                t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L))
                d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
            if d > best: best, bi = d, i
        if best > tol:
            keep[bi] = True; stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]


def split_gaps(pts, max_km=2.0):
    """Break a track where the GPS jumps (paused recordings, glitches)."""
    out, cur = [], []
    for p in pts:
        if cur:
            q = cur[-1]
            d = math.hypot((p[0] - q[0]) * 110.54, (p[1] - q[1]) * 111.32 * math.cos(math.radians(p[0])))
            if d > max_km: out.append(cur); cur = []
        cur.append(p)
    if cur: out.append(cur)
    return [s for s in out if len(s) > 1]


def encode(pts, prec=1e5):
    res, plat, plon = [], 0, 0
    for lat, lon in pts:
        la, lo = round(lat * prec), round(lon * prec)
        for v in (la - plat, lo - plon):
            v = ~(v << 1) if v < 0 else (v << 1)
            while v >= 0x20:
                res.append(chr((0x20 | (v & 0x1f)) + 63)); v >>= 5
            res.append(chr(v + 63))
        plat, plon = la, lo
    return "".join(res)


def main(src, out):
    rows = list(csv.reader(open(os.path.join(src, "activities.csv"), encoding="utf-8")))
    h = rows[0]
    col = lambda n, k=0: [i for i, x in enumerate(h) if x == n][k]
    iT, iD, iF, iM = col("Activity Type"), col("Activity Date"), col("Filename"), col("Distance", 1)
    acts, skipped = [], {}
    for r in rows[1:]:
        kind = KEEP.get(r[iT])
        if not kind or not r[iF]:
            skipped[r[iT]] = skipped.get(r[iT], 0) + 1; continue
        pts = [p for p in read_track(os.path.join(src, r[iF])) if abs(p[0]) > 0.01 or abs(p[1]) > 0.01]
        if len(pts) < 2:
            skipped["no GPS: " + r[iT]] = skipped.get("no GPS: " + r[iT], 0) + 1; continue
        segs = [simplify(s, TOL_M) for s in split_gaps(pts)]
        when = datetime.datetime.strptime(r[iD], "%b %d, %Y, %I:%M:%S %p").replace(tzinfo=datetime.timezone.utc)
        acts.append({"k": kind, "d": when.astimezone(ET_TZ).strftime("%Y-%m-%d"), "t": when.isoformat(), "m": round(float(r[iM] or 0) / 1609.344, 2),
                     "n": len(pts), "p": [encode(s) for s in segs]})
    acts.sort(key=lambda a: a["d"])
    json.dump({"source": "strava", "built": datetime.date.today().isoformat(), "activities": acts},
              open(out, "w"), separators=(",", ":"))
    print(len(acts), "activities;", "skipped:", skipped)
    tot = {}
    for a in acts: tot.setdefault(a["k"], [0, 0]); tot[a["k"]][0] += 1; tot[a["k"]][1] += a["m"]
    print({k: (n, round(m)) for k, (n, m) in tot.items()}, "points:", sum(len(p) for a in acts for p in a["p"]) // 4, "~")
    print("bytes", os.path.getsize(out), "range", acts[0]["d"], acts[-1]["d"])


def add_nike(out, nike_dir):
    """Add Nike Run Club runs (TCX), skipping any that Strava already has (same start within 15 min)."""
    import glob, re
    D = json.load(open(out))
    have = [(datetime.datetime.fromisoformat(a["t"]), a) for a in D["activities"] if a.get("t")]
    added = dup = nogps = swapped = 0
    for f in glob.glob(os.path.join(nike_dir, "*.tcx")):
        s = open(f, encoding="utf-8", errors="ignore").read()
        sport = re.search(r'<Activity Sport="([^"]*)"', s).group(1)
        if sport not in ("Running", "undefined"): continue
        t = datetime.datetime.fromisoformat(re.search(r"<Id>\s*([^<\s]*)\s*</Id>", s).group(1).replace("Z", "+00:00"))
        pts = [p for p in read_tcx(s.encode()) if abs(p[0]) > 0.01 or abs(p[1]) > 0.01]
        same = [a for h, a in have if abs((t - h).total_seconds()) < 900]
        if same:
            # The same run is in Strava (which only keeps runs with GPS). Use whichever copy has the fuller GPS track.
            dup += 1
            if len(pts) > 1.25 * same[0].get("n", 0):
                same[0]["p"] = [encode(simplify(seg, TOL_M)) for seg in split_gaps(pts)]; swapped += 1
            continue
        if len(pts) < 2: nogps += 1; continue
        meters = sum(float(x) for x in re.findall(r"<Lap[^>]*>\s*<TotalTimeSeconds>\s*[^<]*</TotalTimeSeconds>\s*<DistanceMeters>\s*([^<\s]*)", s))
        local = t.astimezone(ET_TZ)
        D["activities"].append({"k": "run", "d": local.strftime("%Y-%m-%d"), "t": t.isoformat(), "m": round(meters / 1609.344, 2), "src": "nrc",
                                "p": [encode(simplify(seg, TOL_M)) for seg in split_gaps(pts)]})
        added += 1
    D["activities"].sort(key=lambda a: a["d"])
    D["source"] = "strava+nrc"
    for a in D["activities"]: a.pop("n", None)
    json.dump(D, open(out, "w"), separators=(",", ":"))
    print("nike: added", added, "already in strava", dup, "(Nike's GPS used for", swapped, ") no gps", nogps, "bytes", os.path.getsize(out))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
    if len(sys.argv) > 3: add_nike(sys.argv[2], sys.argv[3])
