// Salo Sweepstake — World Cup 2026
// Vanilla ES module that loads pre-built JSON snapshots from /data
// and renders the three tabs: Teams, Groups, Fixtures.

const OWNER_ORDER = ["Carl", "Josh", "Toby", "Sarah", "Sophie", "James", "Kurt", "Lauren"];
const OWNER_COLORS = {
  Carl: "#3b82f6",
  Josh: "#ec4899",
  Toby: "#10b981",
  Sarah: "#f59e0b",
  Sophie: "#a855f7",
  James: "#ef4444",
  Kurt: "#06b6d4",
  Lauren: "#f97316",
};
const TIER_ORDER = [
  "Elite",
  "Strong",
  "Challengers",
  "Competitive",
  "Outsiders",
  "Underdogs",
];

const STAGE_LABELS = {
  GROUP_STAGE: "Group Stage",
  LAST_16: "Round of 16",
  ROUND_OF_16: "Round of 16",
  QUARTER_FINALS: "Quarter-finals",
  SEMI_FINALS: "Semi-finals",
  THIRD_PLACE: "3rd-place Play-off",
  FINAL: "Final",
  PRELIMINARY_ROUND: "Preliminary Round",
};

const state = {
  sweepstake: [],
  matches: [],
  standings: [],
  teams: [],
  meta: null,
  byApiId: new Map(),         // apiId -> sweepstake entry
  byNormName: new Map(),      // normalised api name -> sweepstake entry
  fixturesFilter: "upcoming",
  ownerFilter: "",
};

// ---------- helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function normalise(name) {
  if (name == null) return "";
  return String(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(s = "") {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

function findSweepstakeForApiTeam(team) {
  if (!team) return null;
  if (team.id && state.byApiId.has(team.id)) return state.byApiId.get(team.id);
  const norm = normalise(team.name);
  if (state.byNormName.has(norm)) return state.byNormName.get(norm);
  return null;
}

function ownerBadge(owner) {
  if (!owner) return "";
  return `<span class="owner-chip" style="--owner:${OWNER_COLORS[owner] ?? "#999"}">${escapeHtml(owner)}</span>`;
}

function teamCrest(team, sweepEntry) {
  const crest = team?.crest || sweepEntry?.crest;
  if (crest) {
    return `<img class="crest" loading="lazy" alt="" src="${escapeHtml(crest)}" />`;
  }
  if (sweepEntry?.flag) {
    return `<span class="crest crest-flag" aria-hidden="true">${sweepEntry.flag}</span>`;
  }
  return `<span class="crest crest-placeholder" aria-hidden="true">⚽</span>`;
}

function formatKickoff(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const date = d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date} · ${time}`;
}

// ---------- leaderboard ----------
// Award 3 for win, 1 for draw using each match's full-time score where the
// owner's team plays. Bonus 5 points whenever an owner's team advances past
// the group stage (i.e. appears in any knockout match).
function computeLeaderboard() {
  const totals = Object.fromEntries(
    OWNER_ORDER.map((o) => [o, { owner: o, points: 0, wins: 0, draws: 0, losses: 0, played: 0, goalsFor: 0, goalsAgainst: 0, alive: 0, eliminated: 0 }]),
  );

  const teamPoints = new Map();      // sweepstake key -> points
  const teamPlayed = new Map();      // sweepstake key -> bool (has played at least once)
  const teamAdvanced = new Set();    // sweepstake key

  const keyOf = (entry) => `${entry.owner}::${entry.name}`;

  for (const m of state.matches) {
    const home = findSweepstakeForApiTeam(m.homeTeam);
    const away = findSweepstakeForApiTeam(m.awayTeam);
    const isKnockout = m.stage && m.stage !== "GROUP_STAGE";

    if (isKnockout && m.status !== "POSTPONED" && m.status !== "CANCELLED") {
      if (home) teamAdvanced.add(keyOf(home));
      if (away) teamAdvanced.add(keyOf(away));
    }

    if (m.status !== "FINISHED") continue;

    const hs = m.score?.fullTime?.home ?? m.score?.fullTime?.homeTeam ?? null;
    const as = m.score?.fullTime?.away ?? m.score?.fullTime?.awayTeam ?? null;
    if (hs == null || as == null) continue;

    const winner = m.score?.winner;
    const apply = (entry, gf, ga, result) => {
      if (!entry) return;
      const k = keyOf(entry);
      const t = totals[entry.owner];
      if (!t) return;
      t.played += 1;
      t.goalsFor += gf;
      t.goalsAgainst += ga;
      teamPlayed.set(k, true);
      if (result === "W") {
        t.wins += 1;
        t.points += 3;
        teamPoints.set(k, (teamPoints.get(k) ?? 0) + 3);
      } else if (result === "D") {
        t.draws += 1;
        t.points += 1;
        teamPoints.set(k, (teamPoints.get(k) ?? 0) + 1);
      } else {
        t.losses += 1;
      }
    };

    const homeResult = winner === "HOME_TEAM" ? "W" : winner === "DRAW" ? "D" : "L";
    const awayResult = winner === "AWAY_TEAM" ? "W" : winner === "DRAW" ? "D" : "L";
    apply(home, hs, as, homeResult);
    apply(away, as, hs, awayResult);
  }

  // Bonus for advancing past groups
  for (const key of teamAdvanced) {
    const owner = key.split("::")[0];
    totals[owner].points += 5;
  }

  // Alive / eliminated tally per owner. A team is "eliminated" if all its
  // group-stage games are finished and it did not appear in any knockout
  // fixture. Otherwise we treat it as still alive.
  const groupGamesByTeam = new Map(); // key -> { total, finished }
  for (const m of state.matches) {
    if (m.stage !== "GROUP_STAGE") continue;
    for (const side of ["homeTeam", "awayTeam"]) {
      const entry = findSweepstakeForApiTeam(m[side]);
      if (!entry) continue;
      const k = keyOf(entry);
      const rec = groupGamesByTeam.get(k) ?? { total: 0, finished: 0 };
      rec.total += 1;
      if (m.status === "FINISHED") rec.finished += 1;
      groupGamesByTeam.set(k, rec);
    }
  }

  for (const entry of state.sweepstake) {
    const k = keyOf(entry);
    const rec = groupGamesByTeam.get(k);
    const advanced = teamAdvanced.has(k);
    const groupsDone = rec && rec.total > 0 && rec.finished >= rec.total;
    const t = totals[entry.owner];
    if (!t) continue;
    if (advanced) t.alive += 1;
    else if (groupsDone) t.eliminated += 1;
    else t.alive += 1; // not yet eliminated
  }

  return Object.values(totals).sort((a, b) => b.points - a.points || b.wins - a.wins || b.goalsFor - a.goalsFor);
}

function renderLeaderboard() {
  const board = computeLeaderboard();
  const el = $("#leaderboard");
  el.innerHTML = board
    .map((row, i) => `
      <article class="owner-card" style="--owner:${OWNER_COLORS[row.owner] ?? "#999"}">
        <div class="owner-rank">${i + 1}</div>
        <div class="owner-meta">
          <h2>${escapeHtml(row.owner)}</h2>
          <p class="owner-sub">${row.alive} alive · ${row.eliminated} out</p>
        </div>
        <div class="owner-points">
          <strong>${row.points}</strong>
          <span>pts</span>
        </div>
        <dl class="owner-stats">
          <div><dt>W</dt><dd>${row.wins}</dd></div>
          <div><dt>D</dt><dd>${row.draws}</dd></div>
          <div><dt>L</dt><dd>${row.losses}</dd></div>
          <div><dt>GF</dt><dd>${row.goalsFor}</dd></div>
          <div><dt>GA</dt><dd>${row.goalsAgainst}</dd></div>
        </dl>
      </article>
    `)
    .join("");
}

// ---------- teams tab ----------
function teamStatus(entry) {
  const k = `${entry.owner}::${entry.name}`;
  // Quick lookup of fixtures involving this team
  let played = 0;
  let wins = 0;
  let draws = 0;
  let losses = 0;
  let advanced = false;
  let groupTotal = 0;
  let groupFinished = 0;
  let nextFixture = null;

  for (const m of state.matches) {
    const home = findSweepstakeForApiTeam(m.homeTeam);
    const away = findSweepstakeForApiTeam(m.awayTeam);
    const isHome = home && `${home.owner}::${home.name}` === k;
    const isAway = away && `${away.owner}::${away.name}` === k;
    if (!isHome && !isAway) continue;

    if (m.stage && m.stage !== "GROUP_STAGE" && m.status !== "POSTPONED" && m.status !== "CANCELLED") {
      advanced = true;
    }

    if (m.stage === "GROUP_STAGE") {
      groupTotal += 1;
      if (m.status === "FINISHED") groupFinished += 1;
    }

    if (m.status === "FINISHED") {
      played += 1;
      const winner = m.score?.winner;
      if (winner === "DRAW") draws += 1;
      else if ((isHome && winner === "HOME_TEAM") || (isAway && winner === "AWAY_TEAM")) wins += 1;
      else losses += 1;
    } else if (["SCHEDULED", "TIMED", "IN_PLAY", "PAUSED", "LIVE"].includes(m.status)) {
      if (!nextFixture || new Date(m.utcDate) < new Date(nextFixture.utcDate)) {
        nextFixture = m;
      }
    }
  }

  const eliminated = !advanced && groupTotal > 0 && groupFinished >= groupTotal;

  return {
    played,
    wins,
    draws,
    losses,
    nextFixture,
    eliminated,
    advanced,
  };
}

function renderTeams() {
  const view = $("#teams-view");

  const grouped = OWNER_ORDER.map((owner) => ({
    owner,
    teams: state.sweepstake.filter((t) => t.owner === owner),
  }));

  view.classList.remove("loading");
  view.innerHTML = `
    <div class="teams-grid">
      ${grouped.map(({ owner, teams }) => {
        const byTier = TIER_ORDER.map((tier) => ({
          tier,
          items: teams.filter((t) => t.tier === tier),
        }));
        return `
          <section class="owner-block" style="--owner:${OWNER_COLORS[owner] ?? "#999"}">
            <header class="owner-block-head">
              <h2>${escapeHtml(owner)}</h2>
              <span class="owner-count">${teams.length} teams</span>
            </header>
            ${byTier.map(({ tier, items }) => items.length ? `
              <div class="tier">
                <h3 class="tier-title">${escapeHtml(tier)}</h3>
                <ul class="team-list">
                  ${items.map((entry) => {
                    const status = teamStatus(entry);
                    const stateClass = status.advanced ? "is-advanced" : status.eliminated ? "is-out" : "is-alive";
                    const stateLabel = status.advanced
                      ? "Through"
                      : status.eliminated
                        ? "Eliminated"
                        : status.played > 0
                          ? `${status.wins}W ${status.draws}D ${status.losses}L`
                          : "Yet to play";
                    const next = status.nextFixture;
                    const nextLine = next
                      ? `<span class="next">Next: ${escapeHtml(formatKickoff(next.utcDate))} vs ${escapeHtml(
                          (findSweepstakeForApiTeam(next.homeTeam)?.name === entry.name ? next.awayTeam?.shortName ?? next.awayTeam?.name : next.homeTeam?.shortName ?? next.homeTeam?.name) ?? "TBD",
                        )}</span>`
                      : status.advanced
                        ? `<span class="next">Through to ${escapeHtml(STAGE_LABELS[next?.stage] ?? "knockouts")}</span>`
                        : status.eliminated
                          ? `<span class="next">Group stage finished</span>`
                          : `<span class="next">Awaiting fixtures</span>`;
                    return `
                      <li class="team-row ${stateClass}">
                        ${teamCrest(null, entry)}
                        <div class="team-name">
                          <strong>${entry.flag ? entry.flag + " " : ""}${escapeHtml(entry.name)}</strong>
                          ${nextLine}
                        </div>
                        <span class="state-pill">${escapeHtml(stateLabel)}</span>
                      </li>
                    `;
                  }).join("")}
                </ul>
              </div>
            ` : "").join("")}
          </section>
        `;
      }).join("")}
    </div>
  `;
}

// ---------- groups tab ----------
function renderGroups() {
  const view = $("#groups-view");
  const groupTables = state.standings.filter((s) => s.stage === "GROUP_STAGE" || s.group);

  if (!groupTables.length) {
    view.classList.remove("loading");
    view.innerHTML = `
      <div class="empty">
        <p>Group standings will appear once the tournament starts and football-data.org publishes tables.</p>
      </div>
    `;
    return;
  }

  view.classList.remove("loading");
  view.innerHTML = `
    <div class="groups-grid">
      ${groupTables.map((g) => `
        <article class="group-card">
          <header class="group-head">
            <h3>${escapeHtml(g.group || "Group")}</h3>
          </header>
          <table class="group-table">
            <thead>
              <tr><th>#</th><th class="team-col">Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr>
            </thead>
            <tbody>
              ${g.table.map((row) => {
                const entry = findSweepstakeForApiTeam(row.team);
                return `
                  <tr class="${entry ? "owned" : ""}" style="${entry ? `--owner:${OWNER_COLORS[entry.owner] ?? "#999"}` : ""}">
                    <td class="rank">${row.position}</td>
                    <td class="team-col">
                      <div class="team-cell">
                        ${teamCrest(row.team, entry)}
                        <div class="team-cell-text">
                          <span class="team-cell-name">${escapeHtml(row.team?.name ?? "")}</span>
                          ${entry ? ownerBadge(entry.owner) : ""}
                        </div>
                      </div>
                    </td>
                    <td>${row.playedGames}</td>
                    <td>${row.won}</td>
                    <td>${row.draw}</td>
                    <td>${row.lost}</td>
                    <td>${row.goalDifference > 0 ? "+" : ""}${row.goalDifference}</td>
                    <td><strong>${row.points}</strong></td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </article>
      `).join("")}
    </div>
  `;
}

// ---------- fixtures tab ----------
function renderFixtures() {
  const view = $("#fixtures-view");
  const now = Date.now();

  let list = state.matches.slice().sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

  if (state.ownerFilter) {
    list = list.filter((m) => {
      const h = findSweepstakeForApiTeam(m.homeTeam);
      const a = findSweepstakeForApiTeam(m.awayTeam);
      return (h && h.owner === state.ownerFilter) || (a && a.owner === state.ownerFilter);
    });
  }

  switch (state.fixturesFilter) {
    case "upcoming":
      list = list.filter((m) => ["SCHEDULED", "TIMED", "POSTPONED"].includes(m.status) || new Date(m.utcDate).getTime() > now);
      list = list.slice(0, 30);
      break;
    case "live":
      list = list.filter((m) => ["IN_PLAY", "PAUSED", "LIVE"].includes(m.status));
      break;
    case "recent":
      list = list.filter((m) => m.status === "FINISHED").slice(-30).reverse();
      break;
    case "all":
    default:
      break;
  }

  if (!list.length) {
    view.classList.remove("loading");
    view.innerHTML = `<div class="empty"><p>No matches to show.</p></div>`;
    return;
  }

  // Group matches by date
  const byDay = new Map();
  for (const m of list) {
    const dayKey = new Date(m.utcDate).toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    if (!byDay.has(dayKey)) byDay.set(dayKey, []);
    byDay.get(dayKey).push(m);
  }

  view.classList.remove("loading");
  view.innerHTML = [...byDay.entries()].map(([day, matches]) => `
    <section class="day-group">
      <h3 class="day-head">${escapeHtml(day)}</h3>
      <ul class="match-list">
        ${matches.map((m) => renderMatch(m)).join("")}
      </ul>
    </section>
  `).join("");
}

function renderMatch(m) {
  const home = findSweepstakeForApiTeam(m.homeTeam);
  const away = findSweepstakeForApiTeam(m.awayTeam);
  const time = new Date(m.utcDate).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const stage = STAGE_LABELS[m.stage] ?? (m.stage || "");
  const groupLabel = m.group ? `· ${escapeHtml(m.group)}` : "";

  const hs = m.score?.fullTime?.home ?? m.score?.fullTime?.homeTeam;
  const as = m.score?.fullTime?.away ?? m.score?.fullTime?.awayTeam;
  const showScore = m.status === "FINISHED" || ["IN_PLAY", "PAUSED", "LIVE"].includes(m.status);

  const statusBadge = (() => {
    if (m.status === "FINISHED") return `<span class="status finished">FT</span>`;
    if (["IN_PLAY", "LIVE"].includes(m.status)) return `<span class="status live">● LIVE</span>`;
    if (m.status === "PAUSED") return `<span class="status live">HT</span>`;
    if (m.status === "POSTPONED") return `<span class="status postponed">Postponed</span>`;
    if (m.status === "CANCELLED") return `<span class="status cancelled">Cancelled</span>`;
    return `<span class="status scheduled">${escapeHtml(time)}</span>`;
  })();

  return `
    <li class="match">
      <div class="match-meta">
        <span class="stage">${escapeHtml(stage)} ${groupLabel}</span>
        ${statusBadge}
      </div>
      <div class="match-body">
        <div class="side ${home ? "owned" : ""}" style="${home ? `--owner:${OWNER_COLORS[home.owner]}` : ""}">
          ${teamCrest(m.homeTeam, home)}
          <div class="side-text">
            <span class="side-name">${escapeHtml(m.homeTeam?.name ?? "TBD")}</span>
            ${home ? ownerBadge(home.owner) : ""}
          </div>
        </div>
        <div class="score">
          ${showScore && hs != null && as != null
            ? `<span>${hs}</span><span class="sep">–</span><span>${as}</span>`
            : `<span class="vs">vs</span>`}
        </div>
        <div class="side away ${away ? "owned" : ""}" style="${away ? `--owner:${OWNER_COLORS[away.owner]}` : ""}">
          <div class="side-text">
            <span class="side-name">${escapeHtml(m.awayTeam?.name ?? "TBD")}</span>
            ${away ? ownerBadge(away.owner) : ""}
          </div>
          ${teamCrest(m.awayTeam, away)}
        </div>
      </div>
      ${m.venue ? `<div class="venue">${escapeHtml(m.venue)}</div>` : ""}
    </li>
  `;
}

// ---------- tabs ----------
const TAB_IDS = ["groups", "leaderboard", "fixtures", "teams"];

function activateTab(name) {
  $$(".tab").forEach((b) => {
    const active = b.dataset.tab === name;
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", String(active));
  });
  for (const id of TAB_IDS) {
    const panel = $(`#panel-${id}`);
    if (panel) panel.hidden = id !== name;
  }
}

function wireTabs() {
  $$(".tab").forEach((b) => {
    b.addEventListener("click", () => activateTab(b.dataset.tab));
  });
  $$(".seg").forEach((b) => {
    b.addEventListener("click", () => {
      state.fixturesFilter = b.dataset.filter;
      $$(".seg").forEach((s) => s.classList.toggle("active", s === b));
      renderFixtures();
    });
  });
  $("#owner-filter").addEventListener("change", (e) => {
    state.ownerFilter = e.target.value;
    renderFixtures();
  });
}

function populateOwnerFilter() {
  const sel = $("#owner-filter");
  for (const owner of OWNER_ORDER) {
    const opt = document.createElement("option");
    opt.value = owner;
    opt.textContent = owner;
    sel.appendChild(opt);
  }
}

function renderMetaPill() {
  const el = $("#last-updated");
  if (!state.meta?.generatedAt) {
    el.textContent = "No data yet — run the build script";
    return;
  }
  const d = new Date(state.meta.generatedAt);
  el.textContent = `Updated ${d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`;
}

async function init() {
  wireTabs();
  populateOwnerFilter();

  try {
    const [sweepstake, matches, standings, teams, meta] = await Promise.all([
      loadJSON("./data/sweepstake.json"),
      loadJSON("./data/matches.json"),
      loadJSON("./data/standings.json"),
      loadJSON("./data/teams.json"),
      loadJSON("./data/meta.json"),
    ]);
    state.sweepstake = sweepstake;
    state.matches = matches;
    state.standings = standings;
    state.teams = teams;
    state.meta = meta;

    for (const entry of sweepstake) {
      if (entry.apiId != null) state.byApiId.set(entry.apiId, entry);
      if (entry.apiName) state.byNormName.set(normalise(entry.apiName), entry);
      state.byNormName.set(normalise(entry.name), entry);
    }

    renderMetaPill();
    renderLeaderboard();
    renderTeams();
    renderGroups();
    renderFixtures();
  } catch (err) {
    console.error(err);
    $("#teams-view").innerHTML = `<div class="empty"><p>Couldn't load data. Run <code>npm run build:data</code> first.</p></div>`;
  }
}

init();
