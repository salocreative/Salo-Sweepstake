#!/usr/bin/env node
// Recompute data/standings.json from the existing data/matches.json snapshot
// without hitting the football-data.org API. Useful if their standings
// endpoint goes dark mid-tournament.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { computeStandingsFromMatches } from "./lib/standings.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "data");

const matches = JSON.parse(await readFile(resolve(DATA_DIR, "matches.json"), "utf8"));
const standings = computeStandingsFromMatches(matches);

await writeFile(resolve(DATA_DIR, "standings.json"), JSON.stringify(standings, null, 2));

try {
  const metaPath = resolve(DATA_DIR, "meta.json");
  const meta = JSON.parse(await readFile(metaPath, "utf8"));
  meta.counts = { ...meta.counts, standings: standings.length };
  await writeFile(metaPath, JSON.stringify(meta, null, 2));
} catch {
  // meta.json may not exist yet — fine, build-data.mjs will create it.
}

console.log(`[regen] Wrote ${standings.length} group standings.`);
for (const g of standings) {
  const top = g.table.slice(0, 4).map((r) => `${r.position}. ${r.team.name} (${r.points})`).join(", ");
  console.log(`  ${g.group}: ${top}`);
}
