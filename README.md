# Exec status site — Phase 1

HTML-first replacements for Nexi executive **Product Status** & **Client Project Status** decks. Structured data lives in JSON (see **`schema/`**), rendered via a zero-dependency Node script.

```
schema/status-report.schema.json   # Canonical shape
data/example-merged.json            # Skeleton + sample rows
scripts/render.mjs                # Generates dist/status.html
styles/report.css                  # Themes (green / blue / purple bands)
PLAYBOOK.md                        # MCP Jira queries + Cursor workflow
RITUAL.md                          # Operational cadence
MANUAL_PUBLISH.md                  # How to physically publish rendered HTML
data/transcripts/README.md        # Naming rules for synced meeting notes
```

## Quick render

```powershell
cd C:\Users\TiffanyEnglish\Projects\exec-status-site
$env:JIRA_BASE_URL = "https://<YOUR>.atlassian.net/browse/"
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
