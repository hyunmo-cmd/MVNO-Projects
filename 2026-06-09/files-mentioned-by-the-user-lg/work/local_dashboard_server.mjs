import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUTS = path.join(ROOT, "outputs");
const PORT = 8765;
const MAPPING_CSV_URL = "https://docs.google.com/spreadsheets/d/1JvFX6LNIs5FA79_kPNWYLaY3Jy1WDwoHOhTOusYL2VI/export?format=csv&gid=1865155113";

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
  return crypto.createHash(name.toLowerCase().replace("-", "")).update(bytes).digest();
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
  const match = xml.match(new RegExp(`<[^>]*:?${tag}\\b[^>]*>`));
  if (!match) return "";
  const attrMatch = match[0].match(new RegExp(`${name}="([^"]*)"`));
  return attrMatch ? attrMatch[1] : "";
}

function parseCfb(buffer) {
  const data = Buffer.from(buffer);
  if (!(data[0] === 0xd0 && data[1] === 0xcf && data[2] === 0x11 && data[3] === 0xe0)) {
    throw new Error("Office 암호화 파일 형식이 아닙니다.");
  }
  const sectorSize = 1 << u16(data, 30);
  const miniSectorSize = 1 << u16(data, 32);
  const firstDir = i32(data, 48);
  const miniCutoff = u32(data, 56);
  const firstMiniFat = i32(data, 60);
  const miniFatCount = u32(data, 64);
  const firstDifat = i32(data, 68);
  const difatCount = u32(data, 72);
  const sec = (sid) => data.subarray((sid + 1) * sectorSize, (sid + 2) * sectorSize);
  const difat = [];
  for (let i = 0; i < 109; i++) {
    const sid = i32(data, 76 + i * 4);
    if (sid >= 0) difat.push(sid);
  }
  let difatSid = firstDifat;
  for (let d = 0; d < difatCount && difatSid >= 0; d++) {
    const s = sec(difatSid);
    for (let i = 0; i < sectorSize / 4 - 1; i++) {
      const sid = i32(s, i * 4);
      if (sid >= 0) difat.push(sid);
    }
    difatSid = i32(s, sectorSize - 4);
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
      seen.add(sid);
      out.push(sid);
      sid = fat[sid];
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
    entries.push({
      name: utf16(dirBytes.subarray(off, off + nameLen - 2)),
      type: dirBytes[off + 66],
      start: i32(dirBytes, off + 116),
      size: u32(dirBytes, off + 120),
    });
  }
  const root = entries.find((entry) => entry.type === 5);
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
    let sid = start;
    const seen = new Set();
    while (sid >= 0 && sid !== -2 && sid !== 0xfffffffe && !seen.has(sid)) {
      seen.add(sid);
      chunks.push(miniStream.subarray(sid * miniSectorSize, (sid + 1) * miniSectorSize));
      sid = miniFat[sid];
    }
    return Buffer.concat(chunks).subarray(0, size);
  }
  const streams = {};
  for (const entry of entries) {
    if (entry.type === 2) {
      streams[entry.name] = entry.size < miniCutoff ? readMini(entry.start, entry.size) : readRegular(entry.start, entry.size);
    }
  }
  return streams;
}

function decryptOffice(buffer, password) {
  const streams = parseCfb(buffer);
  const info = streams.EncryptionInfo;
  const pkg = streams.EncryptedPackage;
  if (!info || !pkg) throw new Error("암호화 정보를 찾지 못했습니다.");
  const xmlStart = info[0] === 4 && info[4] === 0x40 ? 8 : 4;
  const xml = info.subarray(xmlStart).toString("utf8").replace(/\0+$/g, "");
  const hashName = attr(xml, "encryptedKey", "hashAlgorithm") || attr(xml, "keyData", "hashAlgorithm") || "SHA512";
  const blockSize = Number(attr(xml, "encryptedKey", "blockSize") || attr(xml, "keyData", "blockSize") || 16);
  const keyBytes = Number(attr(xml, "encryptedKey", "keyBits") || attr(xml, "keyData", "keyBits") || 256) / 8;
  const spinCount = Number(attr(xml, "encryptedKey", "spinCount") || 100000);
  const salt = Buffer.from(attr(xml, "encryptedKey", "saltValue"), "base64");
  const packageSalt = Buffer.from(attr(xml, "keyData", "saltValue"), "base64");
  let baseHash = hash(hashName, Buffer.concat([salt, utf16le(password)]));
  for (let i = 0; i < spinCount; i++) baseHash = hash(hashName, Buffer.concat([le32(i), baseHash]));
  const derive = (blockKey) => padTo(hash(hashName, Buffer.concat([baseHash, Buffer.from(blockKey)])), keyBytes);
  const secret = aesCbcDecrypt(
    derive([0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6]),
    padTo(salt, blockSize, 0),
    Buffer.from(attr(xml, "encryptedKey", "encryptedKeyValue"), "base64"),
  );
  const size = Number(pkg.readBigUInt64LE(0));
  const chunks = [];
  for (let offset = 8, block = 0; offset < pkg.length; offset += 4096, block++) {
    const part = pkg.subarray(offset, Math.min(offset + 4096, pkg.length));
    const iv = padTo(hash(hashName, Buffer.concat([packageSalt, le32(block)])), blockSize, 0);
    chunks.push(aesCbcDecrypt(secret.subarray(0, keyBytes), iv, part));
  }
  return Buffer.concat(chunks).subarray(0, size);
}

function unzip(buffer) {
  const data = Buffer.from(buffer);
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 66000); i--) {
    if (u32(data, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("xlsx 압축 구조를 찾지 못했습니다.");
  const total = u16(data, eocd + 10);
  let ptr = u32(data, eocd + 16);
  const entries = {};
  for (let i = 0; i < total; i++) {
    const method = u16(data, ptr + 10);
    const compressedSize = u32(data, ptr + 20);
    const nameLen = u16(data, ptr + 28);
    const extraLen = u16(data, ptr + 30);
    const commentLen = u16(data, ptr + 32);
    const localOffset = u32(data, ptr + 42);
    const name = data.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf8");
    const localNameLen = u16(data, localOffset + 26);
    const localExtraLen = u16(data, localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = data.subarray(start, start + compressedSize);
    entries[name] = method === 0 ? compressed : zlib.inflateRawSync(compressed);
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function unescapeXml(value) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}
function sharedStrings(entries) {
  const xml = entries["xl/sharedStrings.xml"]?.toString("utf8");
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[\s\S]*?<\/si>/g)].map((match) => {
    return [...match[0].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join("");
  });
}
function firstSheetPath(entries) {
  const workbook = entries["xl/workbook.xml"]?.toString("utf8");
  const rels = entries["xl/_rels/workbook.xml.rels"]?.toString("utf8");
  const rid = workbook?.match(/<sheet\b[^>]*r:id="([^"]+)"/)?.[1];
  if (rid && rels) {
    const re = new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`);
    const target = rels.match(re)?.[1];
    if (target) return "xl/" + target.replace(/^\/?xl\//, "");
  }
  return "xl/worksheets/sheet1.xml";
}
function colIndex(ref) {
  const letters = (ref.match(/[A-Z]+/i)?.[0] || "").toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}
function excelSerial(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return String(value || "");
  const epoch = Date.UTC(1899, 11, 30);
  const date = new Date(epoch + n * 86400000);
  const pad = (v) => String(v).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}
function rowsFromSheet(entries) {
  const shared = sharedStrings(entries);
  const xml = entries[firstSheetPath(entries)]?.toString("utf8");
  if (!xml) throw new Error("첫 번째 시트를 찾지 못했습니다.");
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b[\s\S]*?<\/row>/g)) {
    const row = [];
    for (const cellMatch of rowMatch[0].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const ref = attrs.match(/\br="([^"]+)"/)?.[1] || "";
      const type = attrs.match(/\bt="([^"]+)"/)?.[1] || "";
      const i = colIndex(ref);
      let value = "";
      if (type === "s") {
        value = shared[Number(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] || 0)] || "";
      } else if (type === "inlineStr") {
        value = [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join("");
      } else {
        value = unescapeXml(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] || "");
      }
      row[i] = value;
    }
    rows.push(row.map((v) => v ?? ""));
  }
  return rows;
}
function payloadFromWorkbook(buffer) {
  const entries = unzip(buffer);
  const rows = rowsFromSheet(entries);
  const headers = rows[0].map((v) => String(v || "").trim());
  const idx = Object.fromEntries(headers.map((name, i) => [name, i]));
  for (const name of ["개통번호", "고객명", "요금제코드"]) {
    if (!(name in idx)) throw new Error(`필수 컬럼이 없습니다: ${name}`);
  }
  const pick = (row, name) => row[idx[name]] || "";
  const customers = rows.slice(1).filter((row) => row.some(Boolean)).map((row) => ({
    phone: pick(row, "개통번호"),
    name: pick(row, "고객명"),
    planCode: pick(row, "요금제코드"),
    planName: pick(row, "요금제명"),
    openedAt: excelSerial(pick(row, "개통일")),
    status: pick(row, "상태"),
    joinType: pick(row, "개통구분"),
    agency: pick(row, "대리점"),
    channel: pick(row, "총판"),
  })).filter((row) => row.planCode);
  return { customers };
}

function parseMultipart(buffer, contentType) {
  const boundary = contentType.match(/boundary=(.+)$/)?.[1]?.replace(/^"|"$/g, "");
  if (!boundary) throw new Error("업로드 형식을 읽지 못했습니다.");
  const parts = {};
  for (const raw of buffer.toString("binary").split(`--${boundary}`)) {
    if (!raw.includes("\r\n\r\n")) continue;
    const [headerText, bodyText] = raw.split("\r\n\r\n");
    const name = headerText.match(/name="([^"]+)"/)?.[1];
    if (!name) continue;
    const start = Buffer.byteLength(raw.slice(0, raw.indexOf("\r\n\r\n") + 4), "binary");
    let body = Buffer.from(raw, "binary").subarray(start);
    if (body.subarray(-2).toString("binary") === "\r\n") body = body.subarray(0, -2);
    parts[name] = body;
  }
  return parts;
}

function getText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        getText(new URL(res.headers.location, url).toString()).then(resolve, reject);
        res.resume();
        return;
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        if (res.statusCode !== 200) reject(new Error(`HTTP ${res.statusCode}`));
        else resolve(Buffer.concat(chunks).toString("utf8"));
      });
    }).on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (req.method === "GET" && url.pathname === "/api/mapping-csv") {
      const csv = await getText(MAPPING_CSV_URL);
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store" });
      res.end(csv);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/parse-excel") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const parts = parseMultipart(Buffer.concat(chunks), req.headers["content-type"] || "");
      let file = parts.file;
      const password = (parts.password || Buffer.alloc(0)).toString("utf8");
      if (!file?.length) throw new Error("파일이 첨부되지 않았습니다.");
      if (file[0] === 0xd0 && file[1] === 0xcf) {
        if (!password) throw new Error("암호화된 파일입니다. 파일 암호를 입력해 주세요.");
        file = decryptOffice(file, password);
      }
      const payload = payloadFromWorkbook(file);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(payload));
      return;
    }
    const name = url.pathname === "/" ? "lg-plan-benefit-dashboard.html" : decodeURIComponent(url.pathname.slice(1));
    if (name.includes("..") || name.includes("/") || name.includes("\\")) throw new Error("Forbidden");
    const filePath = path.join(OUTPUTS, name);
    const data = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": name.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  } catch (error) {
    const status = req.url?.startsWith("/api/") ? 400 : 404;
    res.writeHead(status, { "Content-Type": req.url?.startsWith("/api/") ? "application/json; charset=utf-8" : "text/plain; charset=utf-8" });
    res.end(req.url?.startsWith("/api/") ? JSON.stringify({ error: error.message }) : error.message);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`http://127.0.0.1:${PORT}/lg-plan-benefit-dashboard.html`);
});
