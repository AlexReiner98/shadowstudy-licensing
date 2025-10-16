import express from "express";
import "dotenv/config";

const app = express();

// parse json bodies
app.use(express.json());

//health check route
app.get("/", (req,res) => {
    res.send({status: "ok", message: "Server is running!"});
});

//example webhook route
app.post("/webhooks/lemon", (req,res) => {
    console.log("Webhook recieved:", req.body);
    res.status(200).send("ok");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Express server listeneing on port ${PORT}`);
})