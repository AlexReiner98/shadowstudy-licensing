require('dotenv').config();
const zod = require('zod');
//const crypto = require('crypto');
const jose = require('jose');


function nowSec() { return Math.floor(Date.now() / 1000); }

async function signJWT(payload, ttlSec)
{
    const secret = new TextEncoder().encode(process.env.SIGNING_SECRET)
    return await new jose.SignJWT(payload)
        .setProtectedHeader({alg: "HS256"})
        .setIssuedAt()
        .setIssuer(process.env.ISSUER)
        .setExpirationTime(ttlSec)
        .sign(secret);
}

async function verifyJWT(token, expectedAud)
{
    const secret = new TextEncoder().encode(process.env.SIGNING_SECRET)
    const { payload } = await jose.jwtVerify(token, secret, {
        issuer: process.env.ISSUER,
        audience: expectedAud
    });
    return payload;
}

module.exports = {nowSec, signJWT, verifyJWT}