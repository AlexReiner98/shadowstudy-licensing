//import { EnsureContentSize,EnsureJsonContent } from './httpHelpers.js';

const express = require('express');
const httpHelpers = require('./httpHelpers.js');
const mailGun = require('./mailgun.js');
const { default: Mailgun } = require('mailgun.js');
const { signJWT, nowSec, verifyJWT } = require('./jwtHelpers.js');
const app = express();
const PORT = 3000;

const env = process.env.NODE_ENV;
if(env === 'development') console.log("Running in development env");
else if(env === 'production') console.log("Running in production env");

app.set("appVersion", '1.0.0');
app.set("serverStartTime", Date.now())
app.set("maxContentLength", 2000);

app.use(express.json());

const db = require('./db');

//---------------------------------------------------------------------
//--------------------------Middleware---------------------------------
//---------------------------------------------------------------------

const router = express.Router();

router.route('/')
    .get((req,res) => {
        res.status(200).send("Welcome to the root of the server");
    })
    .all((req,res) => {
        res.set('Allow','GET');
        res.status(405).send("Method not allowed");
    });

router.route('/version')
    .get((req,res) => {
        res.set('Allow', 'GET');
        const version = app.get("appVersion");
        res.status(200).send({
        'version':version
        });
    })
    .all((req,res) => {
        res.set('Allow','GET');
        res.status(405).send("Method not allowed");
    });

router.route('/health')
    .get((req, res) => {
        res.set('Content-Type', 'application/json');
        const health = {
            "ok": true,
            "uptimeMS": Date.now() - app.get("serverStartTime"),
            "contentLength": req.headers['content-length']
        }
        res.status(200).send(health);
    })
    .all((req,res) => {
        res.set('Allow', 'GET');
        res.status(405).send("Method not allowed")
    });

router.route('/echo')
    .post((req,res) => {
        const contentTypeError = httpHelpers.EnsureJson(req,res);
        if(contentTypeError) return contentTypeError;

        const maxSize = app.get('maxContentLength');
        const contentSizeError = httpHelpers.EnsureSize(req,res,maxSize);
        if(contentSizeError) return contentSizeError;

        res.set('Content-Type', 'application/json');
        res.status(200).send(
            {
                "received": req.body,
                "received_at": Date.now(),
                "contentLength": req.headers['content-length']
            }
        );
    })
    .all((req,res) => {
        res.set('Allow', 'POST');
        res.status(405).send("Method not allowed")
    });

router.route('/device_auth')
    .post(async (req,res) => {
        const contentTypeError = httpHelpers.EnsureJson(req,res);
        if(contentTypeError) return contentTypeError;

        const maxSize = app.get('maxContentLength');
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

        if(deviceRow.valid) //this device is linked and license is valid ==> return success, status:ok, token: new jwt
        {
            //sign token
            //const jti = randomUUID();
            //const token = await signJWT({aud: process.env.CLIENT_AUD, jti},
            //`${process.env.OFFLINE_TTL_SEC} seconds`);
            const issuedAt = nowSec();
            const expiresAt = nowSec() + process.env.OFFLINE_TTL_SEC;

            const token = `{{\r\n    \"device_id\": \"${deviceId}\",\r\n    \"token_issued_at\": \"${issuedAt}\",\r\n    \"token_expires_at\": \"${expiresAt}\"\r\n}}`
            return res.status(200).json({
                "status":"ok",
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

        const maxSize = app.get('maxContentLength');
        const contentSizeError = httpHelpers.EnsureSize(req,res,maxSize);
        if(contentSizeError) return contentSizeError;

        const fieldError = httpHelpers.EnsureFields(req.body, res, ['name', 'email', 'device_id']);
        if(fieldError) return fieldError;

        const name = req.body['name'];
        const email = req.body['email'];
        const deviceId = req.body['device_id'];
        
        const jti = crypto.randomUUID();
        const token = await signJWT({aud: process.env.MAGIC_AUD, email:email,device_id:deviceId, jti},
            `${process.env.MAGIC_TTL_SEC} seconds`
        )

        const expiresAt = nowSec() + process.env.MAGIC_TTL_SEC;
        await db('magic').insert({
            token: jti, 
            expires_at: expiresAt,
        });

        const encoded = encodeURIComponent(token);
        const url = `localhost:3000/verify?token=${encoded}`;
        //mailGun.SendSimpleMessage(name, email, url);

        res.set('Content-Type', 'application/json');
        res.status(200).send(
        {
            "status": "Ok",
            "message": `Verification email sent to < ${name} ${email} >`,
            "token": encoded
        });
    })
    .all((req,res) => {
        res.set('Allow', 'POST');
        res.status(405).send("Method not allowed");
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

        if(!jti) return res.status(400).send("Invalid token payload");

        const row = db('magic')
            .where('token', jti)
            .first();

        if(!row) return res.status(400).send('Token not recognized.');
        if(row.used_at) return res.status(400).send('Token already used.');
        if(row.expires_at < nowSec()) return res.status(400).send("Token expired.");
        
        //update used_at
        await db('magic')
            .where('token', jti)
            .update({used_at: nowSec()});

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
        
        let activationId;
        //if not, add it
        if(!activationRow)
        {
            [activationId] = await db('activations').insert(
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
                await db('activations').update({
                    device_id:deviceId,
                    updated_at:nowSec()
                })
            }
        }

        //create new offline token

        return res.status(200).send('Email verified and device linked');
    })
    .all((req,res) => {
        res.set('Allow', 'GET');
        res.status(405).send("Method not allowed")
    });

app.use('/', router);

app.use((err,req,res,next)=>{
    if(err instanceof SyntaxError && err.status == 400 && 'body' in err)
    {
        console.error('Bad JSON format received:', err.message);
        return res.status(400).json({
            status:400,
            message: "Invalid JSON format in request body.",
            error: err
        });
    }

    next(err);
});

app.use((req,res) => {
    if(req)
    res.status(404).json({
        status: 404,
        message: `Can't find ${req.path} on this server!`
    });
});

//-----------------------------------------------------------------------------------------
//-----------------------------------------Listen------------------------------------------
//-----------------------------------------------------------------------------------------

const server = app.listen(PORT, (error) => {
    if(!error)
    {
        console.log("Server successfully running, and app is listening on port " + PORT);
    }
    else
    {
        console.log("Error occurred, server can't start", error);
    }
});

process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
    });
})

process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
    });
})