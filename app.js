//import { EnsureContentSize,EnsureJsonContent } from './httpHelpers.js';

const express = require('express');
const httpHelpers = require('./httpHelpers.js');
const mailGun = require('./mailgun.js');
const { default: Mailgun } = require('mailgun.js');
const app = express();
const PORT = 3000;

const env = process.env.NODE_ENV;
if(env === 'development') console.log("Running in development env");
else if(env === 'production') console.log("Running in production env");

app.set("appVersion", '1.0.0');
app.set("serverStartTime", Date.now())
app.set("maxContentLength", 2000);

app.use(express.json());

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

router.route('/signup')
    .post((req,res) => {
        const contentTypeError = httpHelpers.EnsureJson(req,res);
        if(contentTypeError) return contentTypeError;

        const maxSize = app.get('maxContentLength');
        const contentSizeError = httpHelpers.EnsureSize(req,res,maxSize);
        if(contentSizeError) return contentSizeError;

        const fieldError = httpHelpers.EnsureFields(req.body, res, ['email', 'fingerprint']);
        if(fieldError) return fieldError;

        const email = req.body['email'];
        const fingerprint = req.body['fingerprint'];

        //check if db contains email, if so, compare machine fingerprint

        //if no email associated, send verification email
        mailGun.SendSimpleMessage('Alex', email);

        res.set('Content-Type', 'application/json');
        res.status(200).send(
        {
            "status": "Ok",
            "message": `Verification email sent to ${email}`
        });
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