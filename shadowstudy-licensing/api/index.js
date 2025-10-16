import express from "express";
import "dotenv/config";
import crypto from "node:crypto";
import Database from "better-sqlite3";

//
// ─────────────────────────────  DB SETUP  ─────────────────────────────
//
const db = new Database(process.env.LICENSE_DB_PATH || "./data/license.db");
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("foreign_keys = ON");

// Minimal operational schema
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS webhook_events (
  id            TEXT PRIMARY KEY,
  received_at   DATETIME NOT NULL,
  event_name    TEXT NOT NULL,
  raw_json      TEXT NOT NULL,
  applied       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS applied_keys (
  logical_key    TEXT PRIMARY KEY,
  first_event_id TEXT NOT NULL,
  applied_at     DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS licenses (
  license_id     TEXT PRIMARY KEY,
  product_id     TEXT NOT NULL,
  key            TEXT NOT NULL,
  key_hash       TEXT NOT NULL,
  status         TEXT NOT NULL,
  plan           TEXT,
  seats_total    INTEGER NOT NULL DEFAULT 1,
  seats_used     INTEGER NOT NULL DEFAULT 0,
  valid_from     DATETIME,
  valid_until    DATETIME,
  features_json  TEXT NOT NULL,
  updated_at     DATETIME NOT NULL
);

CREATE UNIQUE INDEX idx_licenses_key_hash ON licenses(key_hash);

CREATE TABLE IF NOT EXISTS installations (
  install_id          TEXT PRIMARY KEY,
  license_id          TEXT NOT NULL REFERENCES licenses(license_id) ON DELETE CASCADE,
  machine_fingerprint TEXT NOT NULL,
  first_seen          DATETIME NOT NULL,
  last_seen           DATETIME NOT NULL,
  UNIQUE (license_id, machine_fingerprint)
);
`);

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_licenses_key_hash ON licenses(key_hash);
`);

const stmtInsertAppliedKey = db.prepare(`
  INSERT INTO applied_keys (logical_key, first_event_id, applied_at)
  VALUES (?, ?, ?)
`);

// Helper to make a stable logical key from payload
function makeLogicalKey(payload) {
  const d = payload?.data || {};
  const type = String(d?.type || "unknown");
  const id = String(d?.id || "");
  const a = d?.attributes || {};
  const ver = String(a?.updated_at || a?.created_at || "");
  return `${type}:${id}:${ver}`;
}

// Prepared statements
const stmtInsertEvent = db.prepare(`
  INSERT INTO webhook_events (id, received_at, event_name, raw_json, applied)
  VALUES (@id, @received_at, @event_name, @raw_json, 0)
`);
const stmtMarkApplied = db.prepare(`UPDATE webhook_events SET applied = 1 WHERE id = ?`);

const stmtUpsertLicense = db.prepare(`
  INSERT INTO licenses (
    license_id,
    product_id,
    key,
    key_hash,
    status,
    plan,
    seats_total,
    seats_used,
    valid_from,
    valid_until,
    features_json,
    updated_at
  ) VALUES (
    @license_id,
    @product_id,
    @key,
    @key_hash,
    @status,
    @plan,
    @seats_total,
    @seats_used,
    @valid_from,
    @valid_until,
    @features_json,
    @updated_at
  )
  ON CONFLICT(license_id) DO UPDATE SET
    product_id    = excluded.product_id,
    key           = excluded.key,
    key_hash      = excluded.key_hash,
    status        = excluded.status,
    plan          = excluded.plan,
    seats_total   = excluded.seats_total,
    seats_used    = excluded.seats_used,
    valid_from    = excluded.valid_from,
    valid_until   = excluded.valid_until,
    features_json = excluded.features_json,
    updated_at    = excluded.updated_at
`);

// Tiny helper: parse dates safely
const toISO = (d) => (d ? new Date(d).toISOString() : null);

function hashKey(key) {
  return crypto.createHash("sha256").update(String(key || "")).digest("hex");
}



// Map Lemon Squeezy payload → our license snapshot (defensive defaults)
function mapLemonToLicense(evtName, payload) {
  const d = payload?.data || {};
  const a = d?.attributes || {};

  const license_id  = String(d.id || "");
  const product_id  = String(a.product_id || a.variant_id || "shadow-study");
  const key         = String(a.key || a.license_key || "");
  const status      = String(a.status || a.state || "unknown");
  const plan        = String(a.plan || a.variant_name || "");
  const seats_total = Number(a.max_activations ?? a.seat_count ?? 1);
  const seats_used  = Number(a.activations_count ?? a.seats_used ?? 0);

  const valid_from  = a.created_at ? new Date(a.created_at).toISOString() : null;
  const valid_until = a.expires_at ? new Date(a.expires_at).toISOString()
                   : a.renews_at ? new Date(a.renews_at).toISOString()
                   : null;

  // ⬇️ Here's the critical part:
  const updated_at_source = a.updated_at || a.created_at || new Date().toISOString();
  const updated_at = new Date(updated_at_source).toISOString();

  const features = {
    pro: /pro/i.test(plan),
    max_version: "1.x"
  };

  return {
    license_id,
    product_id,
    key,
    status,
    plan,
    seats_total,
    seats_used,
    valid_from,
    valid_until,
    features_json: JSON.stringify(features),
    updated_at   // ⬅️ LS timestamp, not local time
  };
}

function mapLicenseKeyPayload(payload) {
  const d = payload?.data || {};
  const a = d?.attributes || {};

  // LS fields (check your actual payloads and adjust if needed)
  const license_id    = String(d.id || "");                // LS license object id
  const product_id    = String(a.product_id ?? a.variant_id ?? "shadow-study");
  const license_key   = String(a.key ?? a.license_key ?? "");  // the actual license key string
  const status        = String(a.status ?? a.state ?? "unknown"); // e.g., active/revoked/expired
  const plan          = String(a.variant_name ?? a.plan ?? "");
  const seats_total   = Number.isFinite(a?.max_activations) ? a.max_activations
                       : Number.isFinite(a?.seat_count)     ? a.seat_count : 1;
  const seats_used    = Number.isFinite(a?.activations_count) ? a.activations_count
                       : Number.isFinite(a?.seats_used)        ? a.seats_used : 0;

  const valid_from    = a.created_at ? new Date(a.created_at).toISOString() : null;
  const valid_until   = a.expires_at ? new Date(a.expires_at).toISOString()
                        : a.renews_at ? new Date(a.renews_at).toISOString()
                        : null;

  // ✅ Use LS’s timestamp (updated_at || created_at) — not local time
  const updated_at_src = a.updated_at || a.created_at || new Date().toISOString();
  const updated_at     = new Date(updated_at_src).toISOString();

  // Feature flags are up to you; start simple
  const features = {
    pro: /pro/i.test(plan),
    max_version: "1.x"
  };

  return {
    license_id,
    product_id,
    key: license_key,
    key_hash: hashKey(license_key),   // if you add a column, see note below
    status,
    plan,
    seats_total,
    seats_used,
    valid_from,
    valid_until,
    features_json: JSON.stringify(features),
    updated_at
  };
}

// Apply a verified event (in a single transaction for idempotency)
const applyEventTxn = db.transaction((eventRow, payload) => {
  // Always store the raw delivery (good audit trail)
  stmtInsertEvent.run(eventRow);

  // Build logical key (resource + version). If missing, fall back to data.id only.
  const logicalKey = makeLogicalKey(payload) || (payload?.data?.id ? `fallback:${payload.data.id}` : "");

  // Try to claim this logical key once; if already claimed, it's a duplicate business state
  if (logicalKey) {
    try {
      stmtInsertAppliedKey.run(logicalKey, eventRow.id, new Date().toISOString());
    } catch (e) {
      if (String(e?.message || "").includes("UNIQUE constraint failed: applied_keys.logical_key")) {
        // Already processed this exact LS resource+timestamp
        console.log(
          `↩️ Duplicate delivery skipped: ${eventRow.event_name} (${logicalKey})`
        );
        stmtMarkApplied.run(eventRow.id);
        return;
      }
      throw e; // Real DB error bubbles up
    }
  }

  // Proceed with your existing mapping & upsert (idempotent by license_id)
  const evt = (eventRow.event_name || "").toLowerCase();
  if (evt.includes("license_key") || evt.includes("subscription") || evt.includes("order")) {
    const lic = mapLemonToLicense(evt, payload);

    // IMPORTANT: use LS's timestamp for updated_at, not "now", so repeated deliveries remain a no-op
    const a = payload?.data?.attributes || {};
    lic.updated_at = new Date(a?.updated_at || a?.created_at || Date.now()).toISOString();

    if (lic.license_id && lic.key) {
      stmtUpsertLicense.run(lic);
    }
  }

  stmtMarkApplied.run(eventRow.id);
});

//
// ─────────────────────────────  HTTP SERVER  ─────────────────────────────
//
const app = express();

// Webhook: raw body ONLY for this route
app.post("/webhooks/lemon", express.raw({ type: "application/json", limit: "1mb" }), (req, res) => {
  const secret = (process.env.LEMON_WEBHOOK_SECRET || "").trim();
  if (!secret) return res.status(500).send("server not configured");

  const header = (req.get("X-Signature") || "").trim();          // hex HMAC from LS
  if (!/^[0-9a-f]{64}$/i.test(header)) return res.status(401).send("invalid signature");

  const raw = req.body; // Buffer
  const macHex = crypto.createHmac("sha256", secret).update(raw).digest("hex");

  // timingSafeEqual
  let ok = false;
  try {
    const a = Buffer.from(header, "hex");
    const b = Buffer.from(macHex, "hex");
    ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {}
  if (!ok) return res.status(401).send("invalid signature");

  // Parse JSON after verification
  let json;
  try { json = JSON.parse(raw.toString("utf8") || "{}"); } catch { json = {}; }

  // Id for idempotency: prefer header if LS provides one; else hash raw
  const eventId = (req.get("X-Event-Id") || "").trim()
               || crypto.createHash("sha256").update(raw).digest("hex");
  const eventName = (req.get("X-Event-Name") || json?.meta?.event_name || "unknown").trim();

  const eventRow = {
    id: eventId,
    received_at: new Date().toISOString(),
    event_name: eventName,
    raw_json: JSON.stringify(json)
  };

  try {
    applyEventTxn(eventRow, json);
    console.log(`✅ Applied ${eventName} (${eventId})`);
    return res.status(200).send("ok");
  } catch (e) {
    // If duplicate (already processed), treat as idempotent success
    if (String(e?.message || "").includes("UNIQUE constraint failed: webhook_events.id")) {
      console.log(`↩️ Duplicate event ignored (${eventId})`);
      return res.status(200).send("ok");
    }
    console.error("❌ Failed to apply event:", e);
    return res.status(500).send("error");
  }
});

// JSON parser for the rest of your app after the webhook route
app.use(express.json());

// Health
app.get("/", (_req, res) => res.send({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Express listening on ${PORT}`));

process.on("SIGINT", () => { db.close(); process.exit(0); });
process.on("SIGTERM", () => { db.close(); process.exit(0); });