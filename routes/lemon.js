const express = require("express");
const crypto = require("crypto");

const router = express.Router();

router.post(
  "/webhooks/lemon",
  // Match Lemon Squeezy's content-type (application/json)
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const signature = req.get("X-Signature") || "";
      const eventName = req.get("X-Event-Name") || "";
      const secret = process.env.LS_WEBHOOK_SECRET || "";

      if (!secret) return res.status(500).send("Server not configured");
      if (!signature) return res.status(400).send("Missing signature");
      if (!eventName) return res.status(400).send("Missing event name");

      const raw = req.body; // Buffer because of express.raw
      if (!Buffer.isBuffer(raw)) {
        console.error("Body is not a Buffer (check middleware order)");
        return res.status(400).send("Invalid body");
      }

      // Verify HMAC over RAW BYTES
      const digest = crypto.createHmac("sha256", secret).update(raw).digest("hex");
      const ok =
        signature.length === digest.length &&
        crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));

      if (!ok) return res.status(400).send("Invalid signature");

      // Safe to parse AFTER verification
      const payload = JSON.parse(raw.toString("utf8"));

      switch (eventName) {
        case "subscription_created":
          console.log("🔔 created:", payload?.data?.id);
          break;
        case "subscription_updated":
          console.log("✏️ updated:", payload?.data?.id);
          break;
        case "subscription_cancelled":
          console.log("🛑 cancelled:", payload?.data?.id);
          break;
        default:
          console.log("ℹ️ ignored:", eventName);
      }

      return res.sendStatus(200);
    } catch (err) {
      console.error("Webhook error:", err);
      return res.status(500).send("Webhook handler error");
    }
  }
);

module.exports = router;
