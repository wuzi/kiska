import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { fixtureId } from "./profiles.mjs";
const database = process.env.PERF_DATABASE_URL;
const origin = process.env.KISKA_URL || "http://127.0.0.1:8080";
if (
  !database ||
  !/(^|_)(perf|benchmark)(_|$)/.test(new URL(database).pathname.slice(1))
)
  throw new Error(
    "Set PERF_DATABASE_URL to a dedicated migrated measurement database",
  );
const session = process.env.PERF_SESSION || randomBytes(32).toString("hex");
const sql = (args) =>
  execFileSync("psql", [database, "-X", "-v", "ON_ERROR_STOP=1", ...args], {
    encoding: "utf8",
  });
sql([
  "-v",
  "session_hash=" + createHash("sha256").update(session).digest("hex"),
  "-f",
  fileURLToPath(new URL("./seed.sql", import.meta.url)),
]);
const board = fixtureId("board", 1),
  post = fixtureId("post", 1);
const existing = sql([
  "-Atc",
  "SELECT id FROM media WHERE post_id='" +
    post +
    "' AND ready AND bound LIMIT 1",
]).trim();
if (!existing) {
  // Deterministic map illustration for the pinned route suggestion.
  const u32 = (n) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n >>> 0);
    return b;
  };
  const chunk = (type, data) => {
    const bytes = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const b of bytes) {
      crc ^= b;
      for (let i = 0; i < 8; i++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return Buffer.concat([u32(data.length), bytes, u32(crc ^ 0xffffffff)]);
  };
  const w = 600,
    h = 320,
    pixels = Buffer.alloc((1 + w * 3) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const offset = y * (1 + w * 3) + 1 + 3 * x;
      const height =
        Math.sin(x / 75) + Math.sin(y / 60) + Math.sin((x + y) / 95);
      const river = Math.abs(y - (h / 2 + 70 * Math.sin(x / 82)));
      const color =
        river < 8
          ? [104, 169, 188]
          : Math.abs((((height + 3) * 6) % 1) - 0.5) < 0.08
            ? [147, 174, 143]
            : height > 1
              ? [192, 210, 169]
              : [223, 232, 203];
      for (let i = 0; i < 3; i++) pixels[offset + i] = color[i];
    }
  const bytes = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk(
      "IHDR",
      Buffer.concat([u32(w), u32(h), Buffer.from([8, 2, 0, 0, 0])]),
    ),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  const result = await fetch(
    origin + "/api/v1/boards/" + board + "/media?kind=post",
    {
      method: "POST",
      headers: {
        "Content-Type": "image/png",
        "X-Kiska": "1",
        Cookie: "pb_session=" + session,
      },
      body: bytes,
    },
  );
  if (!result.ok)
    throw new Error(
      "Fixture image upload returned " +
        result.status +
        " " +
        (await result.text()),
    );
  const { id } = await result.json();
  if (!/^[a-f\d-]{36}$/i.test(id)) throw new Error("Invalid staged image ID");
  sql([
    "-c",
    "UPDATE media SET bound=true,post_id='" +
      post +
      "',position=0 WHERE id='" +
      id +
      "' AND ready AND NOT bound AND board_id='" +
      board +
      "'",
  ]);
}
const path = resolve(process.env.PERF_ARTIFACTS || "../artifacts/perf");
await mkdir(path, { recursive: true });
await writeFile(
  resolve(process.env.PERF_SESSION_FILE || resolve(path, "session")),
  session,
  { mode: 0o600 },
);
console.log(
  "Seeded two organizations, 10,000 posts, 1,000 comments, 20,000 votes and a stored attachment. Session in",
  resolve(process.env.PERF_SESSION_FILE || resolve(path, "session")),
);
