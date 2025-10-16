import express from "express";
import "dotenv/config";
import crypto from "node:crypto";

const app = express();

const seen = new Set();

// Lemon posts JSON; we must get RAW bytes for HMAC
app.post("/webhooks/lemon", 
  express.raw({ type: "application/json", limit: "1mb" }),
  (req, res) => {
  
  const secret = (process.env.LEMON_WEBHOOK_SECRET || "").trim();
  if (!secret) return res.status(500).send("server not configured");

  const header = (req.get("X-Signature") || "").trim(); // hex string
  if (!/^[0-9a-f]{64}$/i.test(header)) {
    return res.status(401).send("invalid signature");
  }

  const raw = req.body; // Buffer from express.raw
  const ct = req.get("content-type");

  // Compute HMAC over the *raw* body
  const macHex = crypto.createHmac("sha256", secret).update(raw).digest("hex");

  // timingSafeEqual with hex → hex
  let ok = false;
  try {
    const a = Buffer.from(header, "hex");
    const b = Buffer.from(macHex, "hex");
    ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    ok = false;
  }

  if (!ok) {
    console.log("❌ invalid signature");
    return res.status(401).send("invalid signature");
  }

  // Parse JSON only after verification
  let json = {};
  try { json = JSON.parse(raw.toString("utf8") || "{}"); } catch {}
  console.log("✅ Lemon webhook verified:", json?.meta?.event_name ?? "unknown");

  // handle event
  const evt = (req.get("X-Event-Name") || json?.meta?.event_name || "unknown").toLowerCase();

  // prevent double apply updates
  const key = `${evt}:${json?.data?.id || macHex}`;
  if (seen.has(key)) return res.status(200).send("ok");
  seen.add(key); setTimeout(() => seen.delete(key), 300000);

  

  return res.status(200).send("ok");
});

// ...after this route:
app.use(express.json()); // safe for all other routes

// Health
app.get("/", (_req, res) => res.send({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Express server listening on port ${PORT}`));