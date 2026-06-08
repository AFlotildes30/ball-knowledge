#!/usr/bin/env python3
"""
Ball Knowledge — Player Data Pipeline
Fetches NBA season stats from stats.nba.com (via nba_api), filters to
MPG >= 20 and GP >= 20, finds each player's best season per team/decade,
computes era-adjusted composite scores, and writes data/players.json.

Usage:
  pip3 install nba_api
  python3 scripts/fetch_players.py

  # Dry-run: inspect current data without API calls
  python3 scripts/fetch_players.py --dry-run

  # Only regenerate specific eras
  python3 scripts/fetch_players.py --eras 1990s 2000s
"""

import argparse
import json
import math
import time
import warnings
from collections import defaultdict
from pathlib import Path

warnings.filterwarnings("ignore")

from nba_api.stats.endpoints import leaguedashplayerstats, leagueleaders

OUTPUT_PATH = Path(__file__).parent.parent / "data" / "players.json"

# ---------------------------------------------------------------------------
# Target combos
# ---------------------------------------------------------------------------

TBE = {
    "1960s": ["BOS", "PHI", "LAL", "NYK", "SAC", "HOU", "ATL"],
    "1970s": ["NYK", "MIL", "GSW", "POR", "LAL", "OKC", "SAC", "UTA"],
    "1980s": ["BOS", "LAL", "DET", "CHI", "HOU", "PHI"],
    "1990s": ["CHI", "UTA", "HOU", "SAS", "ORL", "NYK", "OKC", "IND"],
    "2000s": ["LAL", "SAS", "MIA", "DET", "DAL", "PHX", "PHI", "CLE", "MIN"],
    "2010s": ["GSW", "MIA", "OKC", "SAS", "CLE", "TOR", "HOU", "MIL", "BOS", "NOP"],
    "2020s": ["DEN", "MIL", "LAL", "BKN", "PHX", "DAL", "BOS", "OKC", "MIN", "IND"],
}

# Combos that are manually curated — never overwrite with API data.
SKIP_COMBOS = {"BOS-1960s", "PHI-1960s", "LAL-1960s", "NYK-1960s", "SAC-1960s"}

# Seasons per decade (NBA season start year → "YYYY-YY" format)
ERA_SEASONS = {
    "1960s": list(range(1960, 1970)),
    "1970s": list(range(1970, 1980)),
    "1980s": list(range(1980, 1990)),
    "1990s": list(range(1990, 2000)),
    "2000s": list(range(2000, 2010)),
    "2010s": list(range(2010, 2020)),
    "2020s": list(range(2020, 2025)),
}

# Eligibility thresholds
MIN_MPG = 20.0
MIN_GP  = 20

# Era adjustment: higher = era was lower-scoring (stats worth slightly more)
ERA_ADJ = {
    "1970s": 1.12,
    "1980s": 1.06,
    "1990s": 1.10,
    "2000s": 1.05,
    "2010s": 1.02,
    "2020s": 1.00,
}

# stats.nba.com uses different abbreviations for historical franchises.
# This maps start-year ranges to the API abbreviation.
# Format: "GAME_ABBR": [(through_year_inclusive, api_abbr), ..., (9999, api_abbr)]
# Evaluated in order; first matching range wins.
HIST_ABBR: dict = {
    "GSW": [(1970, "SFW"), (1995, "GOS"), (9999, "GSW")],
    "PHI": [(1995, "PHL"), (9999, "PHI")],
    "UTA": [(1978, "NOJ"), (1995, "UTH"), (9999, "UTA")],
    "SAS": [(1995, "SAN"), (9999, "SAS")],
    # Franchise continuity mappings
    "OKC": [(2007, "SEA"), (9999, "OKC")],
    "SAC": [(1971, "CIN"), (1984, "KCK"), (9999, "SAC")],
    "ATL": [(1967, "STL"), (9999, "ATL")],
    "HOU": [(1970, "SDR"), (9999, "HOU")],
    "NOP": [(2012, "NOH"), (9999, "NOP")],
}


def api_abbr(game_abbr: str, year: int) -> str:
    """Return the abbreviation stats.nba.com uses for game_abbr in a given season start year."""
    for threshold, abbr in HIST_ABBR.get(game_abbr, [(9999, game_abbr)]):
        if year <= threshold:
            return abbr
    return game_abbr

# SPG/BPG not officially tracked before 1973-74
SPG_BPG_START_YEAR = 1973

# ---------------------------------------------------------------------------
# Season format helpers
# ---------------------------------------------------------------------------

def season_str(year: int) -> str:
    """Convert start year to NBA season string: 1995 → '1995-96'"""
    return f"{year}-{str(year + 1)[2:]}"


def era_for_year(year: int) -> str:
    decade = (year // 10) * 10
    return f"{decade}s"


# ---------------------------------------------------------------------------
# API fetchers
# ---------------------------------------------------------------------------

def fetch_season_leaders(year: int) -> list[dict]:
    """
    Fetch all players with stats for a season using LeagueLeaders.
    Returns list of dicts keyed by stat column name.
    Used for seasons 1970-71 through 1995-96.
    """
    ldr = leagueleaders.LeagueLeaders(
        season=season_str(year),
        stat_category_abbreviation="PTS",
        per_mode48="PerGame",
        season_type_all_star="Regular Season",
        timeout=60,
    )
    rs = ldr.get_json()
    import json as _json
    rs = _json.loads(rs)["resultSet"]
    headers = rs["headers"]
    rows = rs["rowSet"]
    return [dict(zip(headers, r)) for r in rows]


def fetch_season_dash(year: int) -> list[dict]:
    """
    Fetch all players with stats for a season using LeagueDashPlayerStats.
    Returns list of dicts keyed by stat column name.
    Used for seasons 1996-97 onwards (more comprehensive than LeagueLeaders).
    """
    ds = leaguedashplayerstats.LeagueDashPlayerStats(
        season=season_str(year),
        per_mode_detailed="PerGame",
        measure_type_detailed_defense="Base",
        season_type_all_star="Regular Season",
        timeout=60,
    )
    import json as _json
    data = _json.loads(ds.get_json())["resultSets"][0]
    headers = data["headers"]
    rows = data["rowSet"]
    records = [dict(zip(headers, r)) for r in rows]
    # Normalize column names to match LeagueLeaders schema
    col_map = {
        "PLAYER_NAME": "PLAYER",
        "PTS": "PTS",
        "REB": "REB",
        "AST": "AST",
        "STL": "STL",
        "BLK": "BLK",
        "GP":  "GP",
        "MIN": "MIN",
        "TEAM_ABBREVIATION": "TEAM",
    }
    normalized = []
    for r in records:
        n = {}
        for src, dst in col_map.items():
            if src in r:
                n[dst] = r[src]
        n["PLAYER_ID"] = r.get("PLAYER_ID")
        normalized.append(n)
    return normalized


def fetch_season(year: int) -> list[dict]:
    """Choose the right endpoint based on season year."""
    if year >= 1996:
        return fetch_season_dash(year)
    else:
        return fetch_season_leaders(year)


# ---------------------------------------------------------------------------
# Scoring formula
# ---------------------------------------------------------------------------

def compute_score(ppg: float, rpg: float, apg: float,
                  spg: float, bpg: float, era: str) -> int:
    """
    Era-adjusted composite score on a 40–99 scale.

    Calibration: score = min(99, max(40, round(0.76 * raw + 31)))
      Jordan 1986-87 (37.1/5.5/5.9/2.9/1.5, adj=1.06) → 99
      Jokic  2021-22 (27.1/13.8/7.9/1.5/0.7, adj=1.00) → 99
      Solid starter  (15/5/3/1/0.5)                     → 66
      Fringe starter (10/4/2/0.8/0.3)                   → 55
      Low role player (7/3/1.5/0.5/0.2)                 → 48
    """
    adj = ERA_ADJ.get(era, 1.0)
    raw = (
        ppg * adj * 2.0
        + rpg * adj * 1.0
        + apg * adj * 1.5
        + spg * 5.0
        + bpg * 4.0
    )
    return min(99, max(40, round(0.76 * raw + 31)))


# ---------------------------------------------------------------------------
# Initials helper
# ---------------------------------------------------------------------------

def make_initials(name: str) -> str:
    parts = name.split()
    if len(parts) >= 2:
        return parts[0][0] + parts[-1][0]
    return name[:2].upper()


# ---------------------------------------------------------------------------
# Position mapping
# ---------------------------------------------------------------------------

# nba_api returns positions like "G", "F", "C", "G-F", "F-G", "F-C", "C-F"
POS_EXPAND = {
    "G":   ["PG", "SG"],
    "G-F": ["SG", "SF"],
    "F-G": ["SF", "SG"],
    "F":   ["SF", "PF"],
    "F-C": ["PF", "C"],
    "C-F": ["C", "PF"],
    "C":   ["C"],
}

# LeagueLeaders doesn't return position — look it up by player ID cache
# We fall back to a rough heuristic based on stats when unknown
_POSITION_CACHE: dict[int, list[str]] = {}


def guess_position(ppg: float, rpg: float, apg: float) -> list[str]:
    """Very rough position guess from stats when no position data is available."""
    if rpg >= 9:
        return ["C", "PF"] if rpg >= 11 else ["PF", "C"]
    if apg >= 7:
        return ["PG"]
    if apg >= 4:
        return ["PG", "SG"]
    if rpg >= 6:
        return ["SF", "PF"]
    return ["SF", "SG"]


def get_positions(player_id: int, pos_str: str,
                  ppg: float, rpg: float, apg: float) -> list[str]:
    if player_id and player_id in _POSITION_CACHE:
        return _POSITION_CACHE[player_id]
    if pos_str:
        pos = POS_EXPAND.get(pos_str.strip(), None)
        if pos:
            if player_id:
                _POSITION_CACHE[player_id] = pos
            return pos
    # Fall back to stat-based guess
    pos = guess_position(ppg, rpg, apg)
    if player_id:
        _POSITION_CACHE[player_id] = pos
    return pos


# ---------------------------------------------------------------------------
# Per-combo build
# ---------------------------------------------------------------------------

def build_combo(abbr: str, era: str, seasons: list[int]) -> list[dict]:
    """
    Collect all eligible players for a team/era combo.
    For each player, return their best single season (highest composite score).
    """
    # player_id → list of season dicts
    player_seasons: dict = defaultdict(list)

    for year in seasons:
        print(f"    {season_str(year)}", end=" ", flush=True)
        try:
            rows = fetch_season(year)
        except Exception as e:
            print(f"ERR({e})")
            time.sleep(2)
            continue

        target = api_abbr(abbr, year)
        eligible = [
            r for r in rows
            if str(r.get("TEAM", "")).upper() == target
            and float(r.get("MIN", 0) or 0) >= MIN_MPG
            and int(r.get("GP", 0) or 0) >= MIN_GP
        ]
        print(f"→ {len(eligible)} players")

        for r in eligible:
            pid = r.get("PLAYER_ID") or r.get("PLAYER", "unknown")
            player_seasons[pid].append({
                "name":  r.get("PLAYER", ""),
                "pid":   r.get("PLAYER_ID"),
                "year":  year,
                "gp":    int(r.get("GP", 0) or 0),
                "mpg":   float(r.get("MIN", 0) or 0),
                "ppg":   float(r.get("PTS", 0) or 0),
                "rpg":   float(r.get("REB", 0) or 0),
                "apg":   float(r.get("AST", 0) or 0),
                "spg":   float(r.get("STL", 0) or 0),
                "bpg":   float(r.get("BLK", 0) or 0),
                "pos":   r.get("POSITION", r.get("POS", "")),
            })

        time.sleep(0.7)  # respect stats.nba.com rate limits

    if not player_seasons:
        return []

    results = []
    for pid, seasons_list in player_seasons.items():
        best = max(
            seasons_list,
            key=lambda s: compute_score(s["ppg"], s["rpg"], s["apg"],
                                         s["spg"], s["bpg"], era)
        )
        score = compute_score(best["ppg"], best["rpg"], best["apg"],
                               best["spg"], best["bpg"], era)
        positions = get_positions(
            best["pid"], best["pos"],
            best["ppg"], best["rpg"], best["apg"]
        )
        season_label = f"{best['year']}-{str(best['year'] + 1)[2:]}"
        untracked = best["year"] < SPG_BPG_START_YEAR

        entry = {
            "name":  best["name"],
            "canon": best["name"],
            "pos":   positions,
            "ppg":   round(best["ppg"], 1),
            "rpg":   round(best["rpg"], 1),
            "apg":   round(best["apg"], 1),
            "spg":   round(best["spg"], 1),
            "bpg":   round(best["bpg"], 1),
            "best":  season_label,
            "init":  make_initials(best["name"]),
            "score": score,
        }
        if untracked:
            entry["note"] = "SPG/BPG untracked"

        results.append(entry)

    results.sort(key=lambda p: p["score"], reverse=True)
    return results


# ---------------------------------------------------------------------------
# Position enrichment via PlayerSummary (optional, fills _POSITION_CACHE)
# ---------------------------------------------------------------------------

def enrich_positions(player_ids: list[int]) -> None:
    """
    Fetch position info for a batch of player IDs.
    Skips IDs already cached. Batches to avoid hammering the API.
    """
    try:
        from nba_api.stats.endpoints import commonplayerinfo
    except ImportError:
        return

    missing = [pid for pid in player_ids if pid not in _POSITION_CACHE]
    for i, pid in enumerate(missing):
        if i > 0 and i % 20 == 0:
            time.sleep(1)
        try:
            info = commonplayerinfo.CommonPlayerInfo(player_id=pid, timeout=30)
            import json as _json
            d = _json.loads(info.get_json())
            row = d["resultSets"][0]["rowSet"]
            hdrs = d["resultSets"][0]["headers"]
            if row:
                pos_str = dict(zip(hdrs, row[0])).get("POSITION", "")
                pos = POS_EXPAND.get(pos_str.strip(), None)
                if pos:
                    _POSITION_CACHE[pid] = pos
            time.sleep(0.3)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Pipeline entry point
# ---------------------------------------------------------------------------

def run_pipeline(target_eras: list[str] = None, dry_run: bool = False) -> None:
    # Load existing data as baseline (preserves 1960s manual entries)
    with open(OUTPUT_PATH) as f:
        existing = json.load(f)

    if dry_run:
        print("=== Dry run — current dataset ===")
        for combo, players in sorted(existing["db"].items()):
            print(f"  {combo}: {len(players)} players  "
                  f"(scores {min(p['score'] for p in players)}–{max(p['score'] for p in players)})")
        total = sum(len(v) for v in existing["db"].values())
        print(f"\nTotal: {len(existing['db'])} combos, {total} players")
        return

    db = dict(existing["db"])
    eras_to_run = target_eras or list(TBE.keys())

    for era in eras_to_run:
        if era not in ERA_SEASONS:
            print(f"\nNo season map for {era}, skipping")
            continue

        seasons = ERA_SEASONS[era]
        teams   = TBE[era]

        print(f"\n{'='*50}")
        print(f"Era: {era}  |  teams: {', '.join(teams)}  |  seasons: {seasons[0]}–{seasons[-1]}")
        print(f"{'='*50}")

        for abbr in teams:
            combo = f"{abbr}-{era}"
            if combo in SKIP_COMBOS:
                print(f"\n  [{combo}] — skipping (manually curated)")
                continue
            print(f"\n  [{combo}]")
            players = build_combo(abbr, era, seasons)
            if players:
                db[combo] = players
                print(f"  → {len(players)} players stored")
            else:
                print(f"  → No data — keeping existing entry")
            time.sleep(0.5)

    # Write output, preserving all existing fields
    output = dict(existing)
    output["db"] = db
    with open(OUTPUT_PATH, "w") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    total = sum(len(v) for v in db.values())
    print(f"\n✓ Wrote {len(db)} combos, {total} total players → {OUTPUT_PATH}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ball Knowledge data pipeline")
    parser.add_argument("--dry-run", action="store_true",
                        help="Inspect current data without API calls")
    parser.add_argument("--eras", nargs="+",
                        help="Only regenerate these eras (e.g. --eras 1990s 2000s)")
    args = parser.parse_args()
    run_pipeline(target_eras=args.eras, dry_run=args.dry_run)
