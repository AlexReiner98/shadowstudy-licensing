// tools/export-jwk.mjs
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { importSPKI, exportJWK, calculateJwkThumbprint } from "jose";

const pubPem = readFileSync("keys/rsa-public.pem", "utf8");

// Import the public key, export as JWK
const cryptoKey = await importSPKI(pubPem, "RS256");
const jwk = await exportJWK(cryptoKey);

// Make it explicit for consumers
jwk.kty = "RSA";
jwk.alg = "RS256";
jwk.use = "sig";

// Create a stable kid from the JWK (RFC 7638 thumbprint)
jwk.kid = await calculateJwkThumbprint(jwk, "sha256");

// Write files
mkdirSync("keys", { recursive: true });
writeFileSync("keys/jwk.json", JSON.stringify(jwk, null, 2));
writeFileSync("keys/jwks.json", JSON.stringify({ keys: [jwk] }, null, 2));

console.log("Wrote keys/jwk.json and keys/jwks.json");
console.log("kid:", jwk.kid);