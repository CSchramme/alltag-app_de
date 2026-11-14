'use strict';
// Web-Push nach RFC 8291 (Verschlüsselung, aes128gcm) und RFC 8292 (VAPID) – nur mit Node-Bordmitteln,
// damit auf dem Server kein `npm install` nötig ist.
const crypto = require('crypto');

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(s, 'base64url');

// Format wie bei der Bibliothek web-push: öffentlicher Schlüssel = 65 Byte (0x04‖x‖y), privater = 32 Byte, beide base64url
function generateVapidKeys() {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const { x, y, d } = privateKey.export({ format: 'jwk' });
  return { publicKey: b64u(Buffer.concat([Buffer.from([4]), unb64u(x), unb64u(y)])), privateKey: d };
}

function vapidHeader(endpoint, vapid, subject) {
  const pub = unb64u(vapid.publicKey);
  const key = crypto.createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: vapid.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: 'jwk',
  });
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${vapid.publicKey}`;
}

function encrypt(payload, keys) {
  const uaPublic = unb64u(keys.p256dh), auth = unb64u(keys.auth);
  const ecdh = crypto.createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const hkdf = (ikm, salt, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from(info), len));
  const ikm = hkdf(ecdh.computeSecret(uaPublic), auth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32);
  const salt = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-128-gcm', hkdf(ikm, salt, 'Content-Encoding: aes128gcm\0', 16), hkdf(ikm, salt, 'Content-Encoding: nonce\0', 12));
  const data = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header);
  header.writeUInt32BE(4096, 16); // Datensatzgröße
  header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, data]);
}

async function sendPush(sub, payload, vapid, { ttl = 12 * 3600, subject = 'mailto:alltag@example.com' } = {}) {
  const res = await fetch(sub.endpoint, {
    method: 'POST', body: encrypt(payload, sub.keys), signal: AbortSignal.timeout(15000),
    headers: { TTL: String(ttl), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Authorization: vapidHeader(sub.endpoint, vapid, subject) },
  });
  if (!res.ok) throw Object.assign(new Error(`Push ${res.status} ${await res.text().catch(() => '')}`.trim()), { statusCode: res.status });
}

module.exports = { generateVapidKeys, vapidHeader, encrypt, sendPush };
