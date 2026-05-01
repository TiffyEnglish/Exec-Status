"""One-off: consume Atlassian MCP JSON export of filter=10566; update example-merged in_dev rows."""
import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MERGED = ROOT / "data" / "example-merged.json"
# Copy-paste path or pass as argv[1]
DEFAULT_EXPORT = ROOT / "data" / "jira-filter-10566-export.json"


def display_to_initials(display_name: str) -> list[str]:
    if not display_name or not str(display_name).strip():
        return []
    parts = re.split(r"\s+", str(display_name).strip())
    if len(parts) >= 2:
        return [parts[0][0].upper() + parts[-1][0].upper()]
    # single token: first two chars
    tok = parts[0]
    return [tok[:2].upper()] if tok else []


# NCW epics -> product pillar (from existing roadmap grouping)
NCW_GROUP = {
    "NCW-80190": "Other",
    "NCW-87721": "Other",
    "NCW-87941": "Trackers",
    "NCW-88017": "Trackers",
    "NCW-88025": "Trackers",
    "NCW-87867": "Device Integration",
    "NCW-88080": "Device Integration",
    "NCW-87242": "Trackers",
    "NCW-87802": "Device Integration",
    "NCW-87239": "Live AI Features",
}

# Story-level snapshot for workload ETC / Targets (not in lightweight Jira search export).
WORKLOAD_FALLBACK_BY_KEY = {
    "CWHO-17226": (2, 1),
    "CWHO-17602": (10, 2),
    "CWHO-17730": (3, 2),
    "NCW-87721": (3, 1),
    "NCW-87941": (2, 3),
    "NCW-88017": (5, 2),
    "NCW-88025": (1, 1),
    "NCW-87867": (6, 2),
    "NCW-88080": (4, 3),
}

GROUP_RENDER_ORDER = [
    "Trackers",
    "Device Integration",
    "Ops",
    "Other",
]


def reorder_issues_by_group_then_rank(
    issues: list[dict], rank_lookup: dict[str, int]
) -> list[dict]:
    buckets: dict[str, list[dict]] = {g: [] for g in GROUP_RENDER_ORDER}
    extra_buckets: dict[str, list[dict]] = {}
    for i in issues:
        key = i["key"]
        g = project_group_for_key(key)
        target = buckets if g in buckets else extra_buckets
        if g not in target:
            target[g] = []
        target[g].append(i)

    ordered: list[dict] = []
    for g in GROUP_RENDER_ORDER:
        grp = buckets.get(g) or []
        grp.sort(key=lambda iss: rank_lookup.get(iss["key"], 999))
        ordered.extend(grp)
    for g in sorted(extra_buckets.keys()):
        grp = extra_buckets[g]
        grp.sort(key=lambda iss: rank_lookup.get(iss["key"], 999))
        ordered.extend(grp)
    return ordered


def project_group_for_key(key: str) -> str:
    if key.startswith("CWHO"):
        return "Ops"
    if key.startswith("SHC"):
        return "Device Integration"
    if key in NCW_GROUP:
        return NCW_GROUP[key]
    if key.startswith("NCW"):
        return "Trackers"
    return "Other"


def main() -> None:
    import sys

    export_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_EXPORT
    raw = json.loads(export_path.read_text(encoding="utf-8"))
    filtered = [i for i in raw["issues"] if i.get("key") != "NCW-87239"]
    rank_lookup = {i["key"]: n for n, i in enumerate(raw["issues"])}
    issues = reorder_issues_by_group_then_rank(filtered, rank_lookup)

    data = json.loads(MERGED.read_text(encoding="utf-8"))
    old_rows_by_key: dict = {}
    for sec in data["productReport"]["sections"]:
        if sec.get("id") == "in_dev":
            for row in sec.get("rows", []):
                ji = (row.get("jiraIssues") or [{}])[0]
                k = ji.get("key")
                if k:
                    old_rows_by_key[k] = row

    new_rows = []
    for issue in issues:
        key = issue["key"]
        f = issue.get("fields") or {}
        summary = f.get("summary") or key
        eaf = f.get("customfield_10178")
        etc_raw = f.get("customfield_10182")
        etc = None if etc_raw is None else round(float(etc_raw), 2)

        assignee = (f.get("assignee") or {}) or {}
        disp = assignee.get("displayName")
        owners_new = display_to_initials(disp) if disp else []

        old = old_rows_by_key.get(key, {})
        owners = old.get("owners") if old.get("owners") else owners_new
        bullets = old.get("bullets")
        if not bullets:
            st = (f.get("status") or {}).get("name") or "In scope"
            bullets = [
                f"In progress ({st}); update this status-update bullet from transcripts or planning."
            ]

        old_ji = (old.get("jiraIssues") or [{}])[0] if isinstance(old, dict) else {}
        if not isinstance(old_ji, dict):
            old_ji = {}

        ji_patch = {"key": key, "eaf": eaf}
        td = old_ji.get("todoCount")
        ip = old_ji.get("inProgressCount")
        if td is None and ip is None and key in WORKLOAD_FALLBACK_BY_KEY:
            td, ip = WORKLOAD_FALLBACK_BY_KEY[key]
        if td is not None:
            ji_patch["todoCount"] = td
        if ip is not None:
            ji_patch["inProgressCount"] = ip
        if (
            ji_patch.get("todoCount") is None
            and ji_patch.get("inProgressCount") is None
            and etc is not None
        ):
            ji_patch["etc"] = etc

        row_id = f"roadmap_{key.replace('-', '_').lower()}"
        new_rows.append(
            {
                "id": row_id,
                "name": summary.strip(),
                "projectGroup": project_group_for_key(key),
                "owners": owners,
                "bullets": bullets,
                "jiraIssues": [ji_patch],
                "targetDate": old.get("targetDate", "") if isinstance(old, dict) else "",
                "links": old.get("links", []) if isinstance(old, dict) else [],
            }
        )

    # Write only in_dev section contents
    for sec in data["productReport"]["sections"]:
        if sec.get("id") == "in_dev":
            sec["rows"] = new_rows
            break

    data["meta"]["generatedAt"] = datetime.now(timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )
    data["meta"]["source"] = "atlassian-mcp+jira-filter-10566"
    data["meta"]["jiraQuerySummary"] = (
        "In Development: NexJ roadmap filter **10566** (MCP `filter = 10566 ORDER BY rank ASC`); "
        "excluding **NCW-87239** (Live AI Features). **eaf** = **Project EAF (Cached)** (customfield_10178); "
        "workload counts for ETC/Target Wednesdays from `WORKLOAD_FALLBACK_BY_KEY` in "
        "`scripts/_sync_in_dev_from_jira_export.py` until backlog fields are exposed in MCP search. "
        "Source export: `data/jira-filter-10566-export.json`."
    )

    MERGED.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"Updated {MERGED.relative_to(ROOT)} with {len(new_rows)} in_dev rows.")


if __name__ == "__main__":
    main()
