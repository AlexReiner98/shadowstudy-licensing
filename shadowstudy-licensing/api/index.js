import express from "express";
import "dotenv/config";
import crypto from "node:crypto";

console.log("[conf] LEMON_WEBHOOK_SECRET length:", (process.env.LEMON_WEBHOOK_SECRET || "").trim().length);

const app = express();

// --- put this BEFORE any app.use(express.json()) ---

// Lemon posts JSON; we must get RAW bytes for HMAC
app.post("/webhooks/lemon", express.raw({ type: "application/json" }), (req, res) => {
  const secret = (process.env.LEMON_WEBHOOK_SECRET || "").trim();
  const header = (req.get("X-Signature") || "").trim(); // hex string
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
    console.log("❌ invalid signature",
      "| ct:", ct,
      "| rawLen:", raw?.length ?? 0,
      "| header(len, head8):", header.length, header.slice(0, 8),
      "| macHex(len, head8):", macHex.length, macHex.slice(0, 8)
    );
    return res.status(401).send("invalid signature");
  }

  // Parse JSON only after verification
  let json = {};
  try { json = JSON.parse(raw.toString("utf8") || "{}"); } catch {}
  console.log("✅ Lemon webhook verified:", json?.meta?.event_name ?? "unknown");

  // TODO: handle event
  return res.status(200).send("ok");
});

// ...after this route:
app.use(express.json()); // safe for all other routes

// Health
app.get("/", (_req, res) => res.send({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Express server listening on port ${PORT}`));