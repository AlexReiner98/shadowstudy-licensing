const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const httpHelpers = require("../httpHelpers");
const { stat } = require("fs");

const router = express.Router();

const subWaiters = new Map();

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
      //console.log(payload);

      const email = payload['data']['attributes']['user_email'];
      const status = payload['data']['attributes']['status'];
      if(!email || !status)
      {
        return res.status(417).send("Mising email or status");
      }
      

      switch (eventName) {
        case "subscription_created":
          //check if email already exists
          
          const emailRow = await db('users')
            .where('email', email)
            .first();

          //if not, create a new email row
          let user_id;
          if(!emailRow){
            console.log('inserting user email');
            user_id = await db('users').insert({
              'email': email
            });
          } else {
            console.log('updating user id');
            user_id = emailRow.id;
          }

          console.log('status' + status);
          console.log('seats:'+1);
          console.log('userid' + user_id);
          //create a new subscription row tied to email
          [subscriptionId] = await db('subscriptions')
            .insert({
              'status': status,
              'seats':1,
              'user_id': user_id
            });
            
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

router.route('/subscription/:user_id/await')
    .get(async (req,res) => {
        const timeoutMs = Math.min(Number(req.query.timeout ?? 30000), 60000);
        const user_id = req.params.user_id;
        const row = await db('subscriptions')
            .where('user_id', user_id);

        //if(!row) return res.status(404).json({error: "not_found"});

        // if already decided, return immediately
        if(row && Date.now() > row.expires_at)
        {
            var status = row.status;
            await db('subscriptions')
                .where('user_id', user_id)
                .update({status:"expired"});
            console.log(`returning json: {status: ${status}}`);
            return res.status(200).json({status: status});
        }
        else if(row &&(row.status === "on_trial" || row.status === "active")){
            console.log(`returning json: {status: ${status}}`);
            return res.status(200).json({status: status});
        }

        //register waiter
        const set = subWaiters.get(id) ?? new Set();
        set.add(res);
        subWaiters.set(id, set);

        //safety: close after timeout
        const t = setTimeout(() => {
            set.delete(res);
            res.json({status: "pending"});
        },timeoutMs);

        //if client disconnects
        req.on("close", () => {
            clearTimeout(t);
            set.delete(res);
        });
    })
    .all((req,res) => {
        res.set('Allow', 'GET');
        res.status(405).send("Method not allowed")
    });

module.exports = router;
