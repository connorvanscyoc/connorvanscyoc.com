/* Reads mapchart.net save files and matches them to US county shapes.
   To update the map: export both maps from mapchart.net and replace
   counties/data/mapchart-visited.txt and counties/data/mapchart-slept.txt. */
(function (root) {
  const STATES = {"01":"AL","02":"AK","04":"AZ","05":"AR","06":"CA","08":"CO","09":"CT","10":"DE","11":"DC","12":"FL","13":"GA","15":"HI","16":"ID","17":"IL","18":"IN","19":"IA","20":"KS","21":"KY","22":"LA","23":"ME","24":"MD","25":"MA","26":"MI","27":"MN","28":"MS","29":"MO","30":"MT","31":"NE","32":"NV","33":"NH","34":"NJ","35":"NM","36":"NY","37":"NC","38":"ND","39":"OH","40":"OK","41":"OR","42":"PA","44":"RI","45":"SC","46":"SD","47":"TN","48":"TX","49":"UT","50":"VT","51":"VA","53":"WA","54":"WV","55":"WI","56":"WY"};
  const STATE_NAMES = {AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",CT:"Connecticut",DE:"Delaware",DC:"District of Columbia",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming"};
  // Connecticut's 2022 planning regions; mapchart lists them next to the old counties, which the map uses
  const CT_REGIONS = /^(Western_Connecticut|Greater_Bridgeport|South_Central_Connecticut|Lower_Connecticut_River_Valley|Southeastern_Connecticut|Northeastern_Connecticut|Capitol|Naugatuck_Valley|Northwest_Hills)__CT$/;

  const norm = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const isCity = id => Number(id.slice(2)) >= 500 && ["51", "24", "29", "32"].includes(id.slice(0, 2));

  function buildIndex(features) {
    const idx = new Map();
    for (const f of features) {
      const st = STATES[f.id.slice(0, 2)]; if (!st) continue;
      const key = st + ":" + norm(f.properties.name);
      (idx.get(key) || idx.set(key, []).get(key)).push(f);
    }
    return idx;
  }

  function matchPath(path, idx) {
    const m = path.match(/^(.*)__([A-Z]{2})$/); if (!m) return null;
    let [, raw, st] = m;
    if (st === "DC") return (idx.get("DC:districtofcolumbia") || [])[0] || null;
    let want = null;
    if (/_Co_*$/.test(raw) || /_County$/.test(raw)) { want = "county"; raw = raw.replace(/_Co_*$|_County$/, ""); }
    else if (/_City$/.test(raw)) { want = "city"; raw = raw.replace(/_City$/, ""); }
    let list = idx.get(st + ":" + norm(raw));
    if (!list && want === "city") list = idx.get(st + ":" + norm(raw + "city"));
    if (!list) return null;
    if (list.length === 1) return list[0];
    if (want === "county") return list.find(f => !isCity(f.id)) || list[0];
    return list.find(f => isCity(f.id)) || list[0];   // mapchart's plain name is the city when both exist
  }

  function parseSave(text) {
    const save = typeof text === "string" ? JSON.parse(text) : text;
    return Object.values(save.groups || {}).map(g => ({ label: g.label, paths: g.paths }));
  }

  /* Returns { status: Map(fips -> "slept" | "visited"), unmatched: [...] } */
  function combine(features, visitedSave, sleptSave) {
    const idx = buildIndex(features);
    const status = new Map(), unmatched = [];
    const add = (paths, kind) => {
      for (const p of paths) {
        if (CT_REGIONS.test(p)) continue;
        const f = matchPath(p, idx);
        if (!f) { unmatched.push(p); continue; }
        if (kind === "slept" || !status.has(f.id)) status.set(f.id, kind);
      }
    };
    for (const g of parseSave(visitedSave)) add(g.paths, "visited");
    for (const g of parseSave(sleptSave)) add(g.paths, /night|slept|sleep/i.test(g.label) ? "slept" : "visited");
    return { status, unmatched };
  }

  root.CountyData = { combine, STATES, STATE_NAMES, isCity };
  if (typeof module !== "undefined") module.exports = root.CountyData;
})(typeof window !== "undefined" ? window : globalThis);
