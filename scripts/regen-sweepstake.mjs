#!/usr/bin/env node
// Rebuild ONLY data/sweepstake.json from the CSV and a pre-existing
// data/teams.json snapshot. Useful when you don't have an API key handy
// but want the site to show the right picks against cached fixtures.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "data");
const CSV_PATH = resolve(ROOT, "sweepstake_teams.csv");

const NAME_ALIASES = {
  "usa": ["united states", "united states of america", "usa"],
  "south korea": ["korea republic", "republic of korea", "south korea"],
  "iran": ["iran", "islamic republic of iran", "ir iran"],
  "turkey": ["turkey", "turkiye", "türkiye"],
  "turkiye": ["turkiye", "türkiye", "turkey"],
  "ivory coast": ["cote d'ivoire", "côte d'ivoire", "ivory coast"],
  "bosnia herzegovina": ["bosnia and herzegovina", "bosnia-herzegovina", "bosnia"],
  "cape verde islands": ["cape verde", "cabo verde", "cape verde islands"],
  "dr congo": [
    "dr congo",
    "democratic republic of the congo",
    "democratic republic of congo",
    "congo dr",
  ],
  "curacao": ["curacao", "curaçao"],
  "czech republic": ["czechia", "czech republic"],
  "czechia": ["czechia", "czech republic"],
  "england": ["england"],
  "scotland": ["scotland"],
  "qatar": ["qatar"],
};

function normalise(name) {
  return String(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function aliasesFor(name) {
  const key = normalise(name);
  const set = new Set([key]);
  if (NAME_ALIASES[key]) for (const a of NAME_ALIASES[key]) set.add(normalise(a));
  return [...set];
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  const [headerLine, ...rows] = lines;
  const headers = headerLine.split(",").map((h) => h.trim());
  return rows.map((line) => {
    const cells = line.split(",");
    const row = {};
    headers.forEach((h, i) => (row[h] = (cells[i] ?? "").trim()));
    return row;
  });
}

async function main() {
  const csvText = await readFile(CSV_PATH, "utf8");
  const rows = parseCSV(csvText);

  const teamsRaw = JSON.parse(await readFile(resolve(DATA_DIR, "teams.json"), "utf8"));
  const apiTeams = Array.isArray(teamsRaw) ? teamsRaw : teamsRaw.teams ?? [];

  const teamByName = new Map();
  for (const t of apiTeams) {
    for (const n of [t.name, t.shortName, t.tla].filter(Boolean)) {
      teamByName.set(normalise(n), t);
    }
  }

  const sweepstakeTeams = rows.map((row) => {
    const candidates = aliasesFor(row.Team);
    let match = null;
    for (const c of candidates) {
      if (teamByName.has(c)) { match = teamByName.get(c); break; }
    }
    if (!match) {
      console.warn(`[regen] No match for "${row.Team}" (tried: ${candidates.join(", ")})`);
    }
    return {
      owner: row.Owner,
      tier: row.Tier,
      flag: row.Flag,
      name: row.Team,
      apiId: match?.id ?? null,
      apiName: match?.name ?? null,
      tla: match?.tla ?? null,
      crest: match?.crest ?? null,
    };
  });

  await writeFile(
    resolve(DATA_DIR, "sweepstake.json"),
    JSON.stringify(sweepstakeTeams, null, 2),
  );

  const unmatched = sweepstakeTeams.filter((t) => !t.apiId);
  console.log(`[regen] Wrote ${sweepstakeTeams.length} sweepstake entries (${unmatched.length} unmatched).`);

  try {
    const metaPath = resolve(DATA_DIR, "meta.json");
    const meta = JSON.parse(await readFile(metaPath, "utf8"));
    meta.counts = {
      ...meta.counts,
      sweepstakeTeams: sweepstakeTeams.length,
      unmatched: unmatched.length,
    };
    meta.generatedAt = new Date().toISOString();
    await writeFile(metaPath, JSON.stringify(meta, null, 2));
  } catch {
    // meta.json missing — fine, build-data.mjs will recreate it.
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
