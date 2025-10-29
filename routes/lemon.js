const express = require("express");
const crypto = require("crypto");
const db = require("../db");


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
      //console.log(payload);

      const email = payload['data']['attributes']['user_email'];
      const status = payload['data']['attributes']['status'];
      if(!email || !status)
      {
        return res.status(417).send("Mising email or status");
      }
      
      let subscriptionId;
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

          
          //see if a pending subscription already exists
          const subRow = await db('subscriptions as s')
            .where('s.user_id', user_id)
            .first();
          
          if(subRow)
          {
            subscriptionId = subRow.id;
            //update subscription row
            await db('subscriptions as s')
              .where('s.id', subscriptionId)
              .first()
              .update({
                'status':status,
                'seats':1
              })
          }
          else{
          //create a new subscription row tied to email
          [subscriptionId] = await db('subscriptions')
            .insert({
              'status':status,
              'seats':1,
              'user_id':user_id
            }); 
          }
            
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

      

      return res.status(200).send('Email verified and device linked');

    } catch (err) {
      console.error("Webhook error:", err);
      return res.status(500).send("Webhook handler error");
    }
  }
);

module.exports = router;
