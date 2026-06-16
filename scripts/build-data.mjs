#!/usr/bin/env node
/**
 * Build static JSON snapshots for the Family Sweepstake site.
 *
 *  - Parses ./sweepstake_teams.csv into ./data/sweepstake.json
 *  - Fetches WC teams / matches / standings from football-data.org
 *  - Matches our CSV team names to API team IDs (with manual aliases)
 *  - Writes everything to ./data so the site can be served statically.
 *
 * Required env var: FOOTBALL_DATA_API_KEY
 *   Get one free at https://www.football-data.org/client/register
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { computeStandingsFromMatches } from "./lib/standings.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "data");
const CSV_PATH = resolve(ROOT, "sweepstake_teams.csv");

const API_BASE = "https://api.football-data.org/v4";
const COMPETITION = "WC";
const API_KEY = process.env.FOOTBALL_DATA_API_KEY;

if (!API_KEY) {
  console.error(
    "[build-data] Missing FOOTBALL_DATA_API_KEY env var. Get one at https://www.football-data.org/client/register",
  );
  process.exit(1);
}

// Manual aliases for names that differ between our CSV and football-data.org.
// Left side = our normalised CSV name, right side = candidates the API may use.
const NAME_ALIASES = {
  "usa": ["united states", "united states of america", "usa"],
  "south korea": ["korea republic", "republic of korea", "south korea"],
  "iran": ["iran", "islamic republic of iran", "ir iran"],
  "turkey": ["turkey", "turkiye", "türkiye"],
  "turkiye": ["turkiye", "türkiye", "turkey"],
  "ivory coast": ["cote d'ivoire", "côte d'ivoire", "ivory coast"],
  "bosnia": ["bosnia and herzegovina", "bosnia-herzegovina", "bosnia"],
  "bosnia herzegovina": ["bosnia and herzegovina", "bosnia-herzegovina", "bosnia"],
  "cabo verde": ["cape verde", "cabo verde", "cape verde islands"],
  "cape verde islands": ["cape verde", "cabo verde", "cape verde islands"],
  "dr congo": [
    "dr congo",
    "democratic republic of the congo",
    "democratic republic of congo",
    "congo dr",
  ],
  "curacao": ["curacao", "curaçao"],
  "czechia": ["czechia", "czech republic"],
  "czech republic": ["czechia", "czech republic"],
  "england": ["england"],
  "scotland": ["scotland"],
  "qatar": ["qatar"],
};

function normalise(name) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function aliasesFor(name) {
  const key = normalise(name);
  const set = new Set([key]);
  if (NAME_ALIASES[key]) {
    for (const alias of NAME_ALIASES[key]) set.add(normalise(alias));
  }
  return [...set];
}

// Minimal CSV parser (no quoted-comma support needed for this file)
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

async function api(path) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, { headers: { "X-Auth-Token": API_KEY } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status} ${res.statusText} for ${url}: ${body}`);
  }
  return res.json();
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });

  console.log("[build-data] Reading CSV…");
  const csvText = await readFile(CSV_PATH, "utf8");
  const rows = parseCSV(csvText);

  console.log(`[build-data] Fetching ${COMPETITION} teams…`);
  const teamsRes = await api(`/competitions/${COMPETITION}/teams`);
  const apiTeams = teamsRes.teams ?? [];

  // Build a lookup: normalised name (and short name, TLA) -> team
  const teamByName = new Map();
  for (const t of apiTeams) {
    for (const n of [t.name, t.shortName, t.tla].filter(Boolean)) {
      teamByName.set(normalise(n), t);
    }
  }

  // Resolve every CSV team to an API team (when possible)
  const sweepstakeTeams = rows.map((row) => {
    const candidates = aliasesFor(row.Team);
    let match = null;
    for (const c of candidates) {
      if (teamByName.has(c)) {
        match = teamByName.get(c);
        break;
      }
    }
    if (!match) {
      console.warn(`[build-data] No API match for "${row.Team}" (tried: ${candidates.join(", ")})`);
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

  console.log(`[build-data] Fetching ${COMPETITION} matches…`);
  const matchesRes = await api(`/competitions/${COMPETITION}/matches`);
  const matches = (matchesRes.matches ?? []).map((m) => ({
    id: m.id,
    utcDate: m.utcDate,
    status: m.status,
    matchday: m.matchday,
    stage: m.stage,
    group: m.group,
    venue: m.venue,
    homeTeam: m.homeTeam && {
      id: m.homeTeam.id,
      name: m.homeTeam.name,
      shortName: m.homeTeam.shortName,
      tla: m.homeTeam.tla,
      crest: m.homeTeam.crest,
    },
    awayTeam: m.awayTeam && {
      id: m.awayTeam.id,
      name: m.awayTeam.name,
      shortName: m.awayTeam.shortName,
      tla: m.awayTeam.tla,
      crest: m.awayTeam.crest,
    },
    score: m.score && {
      winner: m.score.winner,
      duration: m.score.duration,
      fullTime: m.score.fullTime,
      halfTime: m.score.halfTime,
    },
  }));

  // football-data.org's WC standings endpoint has been flaky (returns an
  // empty array even mid-tournament). Compute standings from the match
  // snapshot instead — that data is always available and consistent with
  // what the Fixtures tab is showing.
  console.log(`[build-data] Computing standings from matches…`);
  const standings = computeStandingsFromMatches(matches);

  const meta = {
    competition: COMPETITION,
    competitionName: teamsRes.competition?.name ?? "FIFA World Cup",
    season: teamsRes.season ?? matchesRes.filters?.season ?? null,
    generatedAt: new Date().toISOString(),
    counts: {
      teams: apiTeams.length,
      matches: matches.length,
      standings: standings.length,
      sweepstakeTeams: sweepstakeTeams.length,
      unmatched: sweepstakeTeams.filter((t) => !t.apiId).length,
    },
  };

  await writeFile(resolve(DATA_DIR, "sweepstake.json"), JSON.stringify(sweepstakeTeams, null, 2));
  await writeFile(resolve(DATA_DIR, "teams.json"), JSON.stringify(apiTeams, null, 2));
  await writeFile(resolve(DATA_DIR, "matches.json"), JSON.stringify(matches, null, 2));
  await writeFile(resolve(DATA_DIR, "standings.json"), JSON.stringify(standings, null, 2));
  await writeFile(resolve(DATA_DIR, "meta.json"), JSON.stringify(meta, null, 2));

  console.log("[build-data] Done.");
  console.log(JSON.stringify(meta.counts, null, 2));
}

main().catch((err) => {
  console.error("[build-data] Failed:", err);
  process.exit(1);
});
