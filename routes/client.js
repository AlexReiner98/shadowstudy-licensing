const express = require("express");
const crypto = require("crypto");
const httpHelpers = require("../httpHelpers");
const db = require('../db');

const mailGun = require('../mailgun.js');
const { signJWT, nowSec, verifyJWT } = require('../jwtHelpers.js');
const {SignJWT, exportJWK, generateKeyPair, decodeProtectedHeader , importPKCS8} = require('jose');
const { readFileSync } = require('fs');

const router = express.Router();
const waiters = new Map();

router.route('/device_auth')
    .post(async (req,res) => {
        const contentTypeError = httpHelpers.EnsureJson(req,res);
        if(contentTypeError) return contentTypeError;

        const maxSize = Number.parseInt(process.env.MAX_CONTENT_LENGTH);
        const contentSizeError = httpHelpers.EnsureSize(req,res,maxSize);
        if(contentSizeError) return contentSizeError;

        const fieldError = httpHelpers.EnsureFields(req.body, res, ['device_id']);
        if(fieldError) return fieldError;

        const deviceId = req.body['device_id'];

        //check activations table
        const deviceRow = await db('activations')
            .where('device_id', deviceId)
            .first();
        
        res.set('Content-Type', 'application/json');

        if(!deviceRow) // this device needs to be linked
        {
            return res.status(200).json({
                "status":"no_match",
                "token":"null"
            })
        }
        deviceRow.valid = true;

        if(deviceRow.valid) //this device is linked and license is valid ==> return success, status:ok, token: new jwt
        {
            const privatePem = readFileSync("keys/rsa-private.pem", "utf8");
            const kid = JSON.parse(readFileSync("keys/jwk.json", "utf8")).kid;

            const privateKey = await importPKCS8(privatePem, "RS256");

            const token = await new SignJWT({"device_id": deviceId})
                .setProtectedHeader({alg: 'RS256', kid: kid})
                .setIssuedAt()
                .setIssuer(process.env.ISSUER)
                .setAudience(process.env.CLIENT_AUD)
                .setExpirationTime(`${process.env.OFFLINE_TTL_SEC} seconds`)
                .sign(privateKey);

            return res.status(200).json({
                "status":"ok",
                "device_id": deviceId,
                "token":token
            })
        }
        else //this device is linked but license is not valid ==> return success + status:invalid_license, token: null
        {
            return res.status(200).json({
                "status":"invalid_license",
                "token":"null"
            })
        }
    })
    .all((req,res) => {
        res.set('Allow', 'POST');
        res.status(405).send("Method not allowed")
    });

router.route('/signup')
    .post(async (req,res) => {
        const contentTypeError = httpHelpers.EnsureJson(req,res);
        if(contentTypeError) return contentTypeError;

        const maxSize = Number.parseInt(process.env.MAX_CONTENT_LENGTH);
        const contentSizeError = httpHelpers.EnsureSize(req,res,maxSize);
        if(contentSizeError) return contentSizeError;

        const fieldError = httpHelpers.EnsureFields(req.body, res, ['name', 'email', 'device_id']);
        if(fieldError) return fieldError;

        const name = req.body['name'];
        const email = req.body['email'];
        const deviceId = req.body['device_id'];

        const jti = crypto.randomUUID();
        const expiresAt = nowSec() + process.env.MAGIC_TTL_SEC;
        const [id] = await db('magic').insert({
            token: jti, 
            expires_at: expiresAt,
        });
        

        const token = await signJWT({aud: process.env.MAGIC_AUD, email:email,device_id:deviceId, jti, magic_id:id},
            `${process.env.MAGIC_TTL_SEC} seconds`
        )

        const encoded = encodeURIComponent(token);
        const url = `localhost:3000/verify?token=${encoded}`;
        //mailGun.SendSimpleMessage(name, email, url);

        res.set('Content-Type', 'application/json');
        res.status(200).send(
        {
            "status": "Ok",
            "message": `Verification email sent to < ${name} ${email} >`,
            "status_id": id,
            "token": encoded
        });
    })
    .all((req,res) => {
        res.set('Allow', 'POST');
        res.status(405).send("Method not allowed");
    });


router.route('/activation/:id/await')
    .get(async (req,res) => {
        const timeoutMs = Math.min(Number(req.query.timeout ?? 30000), 60000);
        const id = req.params.id;
        const row = await db('magic')
            .where('id', id)
            .first();

        if(!row) return res.status(404).json({error: "not_found"});

        // if already decided, return immediately
        if(row.status !== "pending" || Date.now() > row.expires_at){
            var status = row.status;
            if(Date.now() > row.expires_at && row.status === "pending")
            {
                await db('magic')
                    .where('id', id)
                    .update({status:"expired"});
                status = "expired";
            }
            console.log(`returning json: {status: ${status}}`);
            return res.status(200).json({status: status});
        }

        //register waiter
        const set = waiters.get(id) ?? new Set();
        set.add(res);
        waiters.set(id, set);

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

router.route('/verify')
    .get(async (req,res) => {
        const token = String(req.query.token || "");
        let payload;
        try{
            payload = await verifyJWT(token, process.env.MAGIC_AUD);
        } catch (err){
            console.log(err);
            res.status(400).send("Token invalid.");
        }

        const jti = String(payload.jti || "");
        const email = String(payload.email || "");
        const deviceId = String(payload.device_id || "");
        const magicId = String(payload.magic_id || "");

        if(!jti || !email || !deviceId || !magicId) return res.status(400).send("Invalid token payload");

        const row = await db('magic')
            .where('token', jti)
            .first();

        if(!row) return res.status(400).send('Token not recognized.');
        if(row.used_at) return res.status(400).send('Token already used.');
        if(row.expires_at < nowSec()) return res.status(400).send("Token expired.");
        
        //update used_at
        await db('magic')
            .where('token', jti)
            .update({used_at: nowSec(), status:"verified"});

        //find user email if it exists
        const userRow = await db('users')
            .where('email', email)
            .first();
        
        let userId;
        //if not, add it
        if(!userRow)
        {
            [userId] = await db('users').insert({
                email: email
            });
        }
        else userId = userRow.id;

        //find this user's activation if it exists
        const activationRow = await db('activations')
            .where('user_id', userId)
            .first();
        
        //if not, add it
        if(!activationRow)
        {
            await db('activations')
            .insert(
            {
                device_id:deviceId,
                user_id:userId
            });
        } 
        else 
        {
            //update the device id
            if(activationRow.device_id !== deviceId)
            {
                await db('activations')
                .where("user_id", userId)
                .update({
                    device_id:deviceId
                })
            }
        }

        const set = waiters.get(magicId);
        if(!set) return;
        for(const res of set)
        {
            const row = await db('magic')
                .where('id', magicId)
                .first();
            res.json({ status: row.status ?? "expired"});
        }
        waiters.delete(magicId);

        return res.status(200).send('Email verified and device linked');
    })
    .all((req,res) => {
        res.set('Allow', 'GET');
        res.status(405).send("Method not allowed")
    });

    module.exports = router;