import fs from "node:fs/promises";
import crypto from "node:crypto";
import zlib from "node:zlib";

const file = "C:/Users/user/Desktop/개통 내역/LG개통내역_2026-06-09 (2).xlsx";
const password = "12345678";

function u16(d, o) { return d[o] | (d[o + 1] << 8); }
function u32(d, o) { return (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0; }
function i32(d, o) { const v = u32(d, o); return v > 0x7fffffff ? v - 0x100000000 : v; }
function utf16(bytes) {
  let out = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = bytes[i] | (bytes[i + 1] << 8);
    if (!code) break;
    out += String.fromCharCode(code);
  }
  return out;
}
function utf16le(text) {
  const out = Buffer.alloc(text.length * 2);
  for (let i = 0; i < text.length; i++) out.writeUInt16LE(text.charCodeAt(i), i * 2);
  return out;
}
function le32(v) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0);
  return b;
}
function hash(name, bytes) {
  const alg = name.toLowerCase().replace("-", "");
  return crypto.createHash(alg).update(bytes).digest();
}
function padTo(bytes, size, fill = 0x36) {
  if (bytes.length === size) return bytes;
  const out = Buffer.alloc(size, fill);
  Buffer.from(bytes).copy(out, 0, 0, Math.min(bytes.length, size));
  return out;
}
function aesCbcDecrypt(key, iv, data) {
  const decipher = crypto.createDecipheriv(`aes-${key.length * 8}-cbc`, key, iv);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}
function attr(xml, tag, name) {
  const m = xml.match(new RegExp(`<[^>]*:?${tag}\\b[^>]*>`));
  if (!m) return "";
  const am = m[0].match(new RegExp(`${name}="([^"]*)"`));
  return am ? am[1] : "";
}
function cfb(buffer) {
  const data = Buffer.from(buffer);
  const sectorSize = 1 << u16(data, 30);
  const miniSectorSize = 1 << u16(data, 32);
  const firstDir = i32(data, 48);
  const miniCutoff = u32(data, 56);
  const firstMiniFat = i32(data, 60);
  const miniFatCount = u32(data, 64);
  const firstDifat = i32(data, 68);
  const difatCount = u32(data, 72);
  const sec = sid => data.subarray((sid + 1) * sectorSize, (sid + 2) * sectorSize);
  const difat = [];
  for (let i = 0; i < 109; i++) { const sid = i32(data, 76 + i * 4); if (sid >= 0) difat.push(sid); }
  let ds = firstDifat;
  for (let d = 0; d < difatCount && ds >= 0; d++) {
    const s = sec(ds);
    for (let i = 0; i < sectorSize / 4 - 1; i++) { const sid = i32(s, i * 4); if (sid >= 0) difat.push(sid); }
    ds = i32(s, sectorSize - 4);
  }
  const fat = [];
  for (const sid of difat) {
    const s = sec(sid);
    for (let i = 0; i < sectorSize / 4; i++) fat.push(i32(s, i * 4));
  }
  function chain(start) {
    const out = [];
    let sid = start;
    const seen = new Set();
    while (sid >= 0 && sid !== -2 && sid !== 0xfffffffe && !seen.has(sid)) {
      seen.add(sid); out.push(sid); sid = fat[sid];
    }
    return out;
  }
  function readRegular(start, size) {
    return Buffer.concat(chain(start).map(sec)).subarray(0, size);
  }
  const dirBytes = Buffer.concat(chain(firstDir).map(sec));
  const entries = [];
  for (let off = 0; off + 128 <= dirBytes.length; off += 128) {
    const nameLen = u16(dirBytes, off + 64);
    if (!nameLen) continue;
    entries.push({ name: utf16(dirBytes.subarray(off, off + nameLen - 2)), type: dirBytes[off + 66], start: i32(dirBytes, off + 116), size: u32(dirBytes, off + 120) });
  }
  const root = entries.find(e => e.type === 5);
  const miniStream = root ? readRegular(root.start, root.size) : Buffer.alloc(0);
  const miniFat = [];
  if (firstMiniFat >= 0) {
    for (const sid of chain(firstMiniFat).slice(0, miniFatCount)) {
      const s = sec(sid);
      for (let i = 0; i < sectorSize / 4; i++) miniFat.push(i32(s, i * 4));
    }
  }
  function readMini(start, size) {
    const chunks = [];
    let sid = start; const seen = new Set();
    while (sid >= 0 && sid !== -2 && sid !== 0xfffffffe && !seen.has(sid)) {
      seen.add(sid);
      chunks.push(miniStream.subarray(sid * miniSectorSize, (sid + 1) * miniSectorSize));
      sid = miniFat[sid];
    }
    return Buffer.concat(chunks).subarray(0, size);
  }
  const streams = {};
  for (const e of entries) if (e.type === 2) streams[e.name] = e.size < miniCutoff ? readMini(e.start, e.size) : readRegular(e.start, e.size);
  return streams;
}
async function decrypt(buf) {
  const streams = cfb(buf);
  console.log(Object.keys(streams));
  const info = streams.EncryptionInfo;
  const pkg = streams.EncryptedPackage;
  const xmlStart = info[0] === 4 && info[4] === 0x40 ? 8 : 4;
  const xml = info.subarray(xmlStart).toString("utf8").replace(/\0+$/g, "");
  console.log(xml.slice(0, 200));
  const hashName = attr(xml, "encryptedKey", "hashAlgorithm") || attr(xml, "keyData", "hashAlgorithm") || "SHA512";
  const blockSize = Number(attr(xml, "encryptedKey", "blockSize") || attr(xml, "keyData", "blockSize") || 16);
  const keyBytes = Number(attr(xml, "encryptedKey", "keyBits") || attr(xml, "keyData", "keyBits") || 256) / 8;
  const spinCount = Number(attr(xml, "encryptedKey", "spinCount") || 100000);
  const salt = Buffer.from(attr(xml, "encryptedKey", "saltValue"), "base64");
  const packageSalt = Buffer.from(attr(xml, "keyData", "saltValue"), "base64");
  let baseHash = hash(hashName, Buffer.concat([salt, utf16le(password)]));
  for (let i = 0; i < spinCount; i++) baseHash = hash(hashName, Buffer.concat([le32(i), baseHash]));
  const derive = blockKey => padTo(hash(hashName, Buffer.concat([baseHash, Buffer.from(blockKey)])), keyBytes);
  const iv0 = padTo(salt, blockSize, 0);
  const secret = aesCbcDecrypt(derive([0x14,0x6e,0x0b,0xe7,0xab,0xac,0xd0,0xd6]), iv0, Buffer.from(attr(xml, "encryptedKey", "encryptedKeyValue"), "base64"));
  const size = Number(pkg.readBigUInt64LE(0));
  const chunks = [];
  for (let offset = 8, block = 0; offset < pkg.length; offset += 4096, block++) {
    const part = pkg.subarray(offset, Math.min(offset + 4096, pkg.length));
    const iv = padTo(hash(hashName, Buffer.concat([packageSalt, le32(block)])), blockSize, 0);
    chunks.push(aesCbcDecrypt(secret.subarray(0, keyBytes), iv, part));
  }
  return Buffer.concat(chunks).subarray(0, size);
}

const input = await fs.readFile(file);
const out = await decrypt(input);
console.log(out.subarray(0, 8), out.length);
console.log('zip?', out[0] === 0x50 && out[1] === 0x4b);
