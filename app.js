const express = require('express');
const app = express();
const PORT = 3000;

app.set("appVersion", '1.0.0');
app.set("serverStartTime", Date.now())

app.use(express.json());

//---------------------------------------------------------------------
//--------------------------Middlewear---------------------------------
//---------------------------------------------------------------------

app.use((err,req,res,next)=>{
    if(err instanceof SyntaxError && err.status == 400 && 'body' in err)
    {
        console.error('Bad JSON format received:', err.message);
        return res.status(400).json({
            status:400,
            message: "Invalid JSON format in request body."
        });
    }

    next(err);
});

app.use((req,res,next) => {
    res.status(404).send(`Sorry, no path to ${req.path}`);
});


//-------------------------------------------------------------
//-----------------------Routes--------------------------------
//-------------------------------------------------------------

//-----------------------GET--------------------

app.get('/', (req,res) => {
    res.status(200);
    res.send("Welcome to the root URL of the server");
});

app.get('/hello', (req,res) => {
    res.set('Content-Type', 'text/html');
    res.status(200).send("<h1>Hello GFG Learner!</h1>");
});

app.get('/version', (req,res) => {
    const version = app.get("appVersion");
    
    res.status(200).send({
        'version':version
    })
})

app.get('/health', (req,res) => {
    res.set('Content-Type', 'application/json');
    const health = {
        "ok": true,
        "uptimeMS": Date.now() - app.get("serverStartTime"),
        "contentLength": req.headers['content-length']
    }
    res.status(200).send(health);
});

//-------------------------POST-----------------------------

app.post('/echo', (req,res) => {
    const contentType = req.headers['content-type'];
    if(!contentType || !contentType.includes('application/json'))
    {
        return res.status(400).json({
            error: 'Invalid content type.',
            message: "Requests to this endpoint must have Content_Type of application/json."
        })
    }

    res.set('Content-Type', 'application/json');
    res.status(200).send(
        {
            "received": req.body,
            "received_at": Date.now()
        }
    );
});


//-----------------------------------------------------------------------------------------
//-----------------------------------------Listen------------------------------------------
//-----------------------------------------------------------------------------------------

app.listen(PORT, (error) => {
    if(!error)
    {
        console.log("Server successfully running, and app is listenering on port " + PORT);
    }
    else
    {
        console.log("Error occurred, server can't start", error);
    }
});