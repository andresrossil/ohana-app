// Retain public hashed build files for users who still have a previous version open.
// No user records, credentials, HTML pages or Supabase content are copied.
import { readdir, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
if (!process.env.GITHUB_ACTIONS && !process.env.OHANA_PRESERVE_ASSETS)
  process.exit(0);
const origin = "https://andresrossil.github.io/ohana-app/";
const root = "dist",
  current = (await readdir(join(root, "assets"))).filter(valid);
function valid(name) {
  return /^[A-Za-z0-9_-]+\.(js|css|woff2?|png|jpe?g|webp|svg)$/.test(name);
}
async function fetchFile(path) {
  const response = await fetch(new URL(path, origin), {
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!response.ok) throw Error("HTTP " + response.status);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 5 * 1024 * 1024)
    throw Error("Asset exceeds preservation limit");
  return bytes;
}
let previous = [], bootstrap = false;
try {
  const history = JSON.parse(
    new TextDecoder().decode(
      await fetchFile("asset-history.json?build=" + Date.now()),
    ),
  );
  previous = history.generations
    .filter(Array.isArray)
    .slice(0, 2)
    .map((g) => g.filter((n) => typeof n === "string" && valid(n)));
} catch {
  // Bootstrap once for deployments which predate the manifest.
  try {
    const html = new TextDecoder().decode(
      await fetchFile("?build=" + Date.now()),
    );
    const seeds = [
      ...html.matchAll(/assets\/([A-Za-z0-9_-]+\.(?:js|css))/g),
    ].map((m) => m[1]);
    previous = [seeds];
    bootstrap = true;
  } catch {
    console.log(
      "Previous public deployment unavailable; publishing the current build.",
    );
  }
}
const saved = new Set(current),
  discovered = new Set(previous.flat());
const queue = [...discovered];
let copied = 0,
  total = 0;
await mkdir(join(root, "assets"), { recursive: true });
for (let offset = 0; offset < queue.length && offset < 256; offset += 6) {
  await Promise.all(
    queue.slice(offset, Math.min(offset + 6, 256)).map(async (name) => {
      if (saved.has(name)) return;
      try {
        const bytes = await fetchFile("assets/" + name);
        total += bytes.byteLength;
        if (total > 25 * 1024 * 1024) throw Error("Preservation size limit");
        await writeFile(join(root, "assets", name), bytes);
        saved.add(name);
        copied++;
        if (
        bootstrap &&
          /\.(js|css)$/.test(name)
        ) {
          for (const m of new TextDecoder()
            .decode(bytes)
            .matchAll(/([A-Za-z0-9_-]+-[A-Za-z0-9_-]+\.(?:js|css|woff2?))/g)) {
            if (valid(m[1]) && !discovered.has(m[1])) {
              discovered.add(m[1]);
              queue.push(m[1]);
            }
          }
        }
      } catch {
        console.log("Could not preserve public asset: " + name);
      }
    }),
  );
}
if (bootstrap)
  previous = [[...discovered]];
await writeFile(
  join(root, "asset-history.json"),
  JSON.stringify({
    generations: [current, ...previous].map((g) =>
      g.filter((n) => saved.has(n)),
    ),
  }),
);
console.log("Preserved " + copied + " prior public build assets.");
