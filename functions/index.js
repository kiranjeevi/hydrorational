// HydroRational proxy
//
// NOAA Atlas 14 and the USDA Soil Data Access service refuse browser
// requests from another origin. This function forwards those two, and a
// few other federal services, with CORS headers attached.
//
// Only the hosts in ALLOW are reachable. Deployed as /api/proxy by the
// rewrite in firebase.json.
//
// Cloud Functions need the Blaze plan to make outbound calls to
// non-Google hosts. Hosting alone runs fine on Spark, and everything
// except NOAA auto-fetch and SSURGO soils works without this function.

const { onRequest } = require("firebase-functions/v2/https");

const ALLOW = new Set([
  "hdsc.nws.noaa.gov",               // NOAA Atlas 14 rainfall
  "sdmdataaccess.sc.egov.usda.gov",  // NRCS SSURGO soils
  "hazards.fema.gov",                // FEMA NFHL flood zones
  "epqs.nationalmap.gov",            // USGS 3DEP elevation
  "hydro.nationalmap.gov"            // USGS NHD hydrography
]);

exports.proxy = onRequest(
  { region: "us-west1", cors: true, memory: "256MiB", timeoutSeconds: 30 },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(204).send("");

    const target = req.query.url;
    if (!target) return res.status(400).json({ error: "missing url parameter" });

    let u;
    try { u = new URL(target); }
    catch { return res.status(400).json({ error: "bad url" }); }

    if (u.protocol !== "https:") return res.status(400).json({ error: "https only" });
    if (!ALLOW.has(u.hostname.toLowerCase())) {
      return res.status(403).json({ error: "host not allowed", host: u.hostname });
    }

    try {
      const init = { method: req.method, headers: { "User-Agent": "HydroRational/1.0" } };
      if (req.method === "POST") {
        init.headers["Content-Type"] = req.get("content-type") || "application/json";
        init.body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      }
      const upstream = await fetch(u.toString(), init);
      const body = await upstream.text();
      res.set("Content-Type", upstream.headers.get("content-type") || "text/plain");
      res.set("Cache-Control", "public, max-age=3600");
      return res.status(upstream.status).send(body);
    } catch (err) {
      return res.status(502).json({ error: "upstream request failed", detail: String(err) });
    }
  }
);
