# Exec status site — Phase 1

HTML-first replacements for Nexi executive Product Status & Client Project Status decks. Structured data lives in JSON (see `schema/`), rendered via a zero-dependency Node script.

```
schema/status-report.schema.json   # Canonical shape
data/example-merged.json            # Screenshot-based sample data for layout review before Jira/transcripts
scripts/render.mjs                # Generates dist/status.html
scripts/jira-sync-eaf.mjs         # npm run jira:eaf — REST Pull EAF | npm run jira:eaf:apply — apply MCP-built patch file
scripts/jira-pull-epic-workloads.mjs  # npm run jira:workload — REST pull epic child status counts
styles/report.css                  # Themes (green / blue / purple bands)
PLAYBOOK.md                        # MCP Jira queries + Cursor workflow
RITUAL.md                          # Operational cadence
MANUAL_PUBLISH.md                  # How to physically publish rendered HTML
data/transcripts/README.md        # Naming rules for synced meeting notes
```

Product table columns: Feature → Owner → Status (`statusLabel` chip, or roll-up from `statusStages`) → Status updates → Jira (non–In Development) → ETC → % Cmp. → EAF (In Development metric layout) → Target (optional row `targetDate`; per-issue Wednesday from workload fields on `jiraIssues[]` when set — see PLAYBOOK.md §3 Workload — else `jiraIssues[].targetDate`). ETC and % Cmp. (% Complete) derive at render from `eaf` (Project EAF (Cached) from Jira) and workload counts (To Do / In Progress / Code Review / QA Review weights); prefer Atlassian MCP → `data/jira-eaf-patch.json` → `npm run jira:eaf:apply` (or `npm run jira:eaf -- --patch …`); `npm run jira:workload` refreshes epic child counts when REST credentials are set; REST `npm run jira:eaf` is the fallback when MCP isn’t available.

## Quick render

```powershell
cd C:\Users\TiffanyEnglish\Projects\exec-status-site
$env:JIRA_BASE_URL = "https://nexjhealth.atlassian.net/browse/"
npm install   # noop unless you extend tooling later
npm run render
start dist/status.html   # sanity check
```

## Editing flow

1. Copy `data/example-merged.json` to `data/merged-YYYY-MM-DD.json`.
2. Fill from Jira (Atlassian MCP) + transcript notes (`data/transcripts/`).
3. `npm run render -- data/merged-YYYY-MM-DD.json`.
4. Publish per `MANUAL_PUBLISH.md`.

## Branding disclaimer

Corporate footer text references Nexi Health Inc.—adjust if templating externally.
