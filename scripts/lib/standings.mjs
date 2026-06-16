// Compute group standings from the match snapshot. Football-data.org's WC
// standings endpoint sometimes returns an empty array mid-tournament, so we
// derive standings ourselves to keep the Groups tab populated.
//
// Output shape matches what the frontend expects (see assets/js/app.js
// renderGroups): { stage, type, group, table: [{ position, team, ... }] }

export function computeStandingsFromMatches(matches) {
  const groupBuckets = new Map(); // groupKey -> Map(teamId -> row)

  const ensureRow = (group, team) => {
    if (!groupBuckets.has(group)) groupBuckets.set(group, new Map());
    const teams = groupBuckets.get(group);
    if (!teams.has(team.id)) {
      teams.set(team.id, {
        position: 0,
        team: {
          id: team.id,
          name: team.name,
          shortName: team.shortName,
          tla: team.tla,
          crest: team.crest,
        },
        playedGames: 0,
        won: 0,
        draw: 0,
        lost: 0,
        points: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        form: null,
      });
    }
    return teams.get(team.id);
  };

  for (const m of matches) {
    if (m.stage !== "GROUP_STAGE" || !m.group) continue;

    // Register both teams so empty rows appear before games are played.
    if (m.homeTeam?.id != null && m.homeTeam?.name) ensureRow(m.group, m.homeTeam);
    if (m.awayTeam?.id != null && m.awayTeam?.name) ensureRow(m.group, m.awayTeam);

    if (m.status !== "FINISHED") continue;
    const hs = m.score?.fullTime?.home ?? m.score?.fullTime?.homeTeam;
    const as = m.score?.fullTime?.away ?? m.score?.fullTime?.awayTeam;
    if (hs == null || as == null) continue;
    if (!m.homeTeam?.id || !m.awayTeam?.id) continue;

    const home = ensureRow(m.group, m.homeTeam);
    const away = ensureRow(m.group, m.awayTeam);

    home.playedGames += 1;
    away.playedGames += 1;
    home.goalsFor += hs;
    home.goalsAgainst += as;
    away.goalsFor += as;
    away.goalsAgainst += hs;

    if (hs > as) {
      home.won += 1; home.points += 3;
      away.lost += 1;
    } else if (hs < as) {
      away.won += 1; away.points += 3;
      home.lost += 1;
    } else {
      home.draw += 1; home.points += 1;
      away.draw += 1; away.points += 1;
    }
  }

  // Format "GROUP_A" → "Group A" so the UI matches football-data.org's
  // earlier output exactly.
  const prettyGroup = (g) =>
    g.replace(/^GROUP[_ ]?/, "Group ").replace(/\s+/g, " ").trim();

  const groups = [...groupBuckets.entries()].sort(([a], [b]) => a.localeCompare(b));

  return groups.map(([group, teams]) => {
    const table = [...teams.values()]
      .map((row) => ({ ...row, goalDifference: row.goalsFor - row.goalsAgainst }))
      .sort((a, b) =>
        b.points - a.points ||
        b.goalDifference - a.goalDifference ||
        b.goalsFor - a.goalsFor ||
        a.team.name.localeCompare(b.team.name),
      )
      .map((row, i) => ({ ...row, position: i + 1 }));
    return { stage: "GROUP_STAGE", type: "TOTAL", group: prettyGroup(group), table };
  });
}
