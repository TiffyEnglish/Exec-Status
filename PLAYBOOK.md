# PLAYBOOK.md — Exec status Phase 1 (Cursor + Atlassian MCP)

Use this playbook on each refresh. Update **saved JQL** and **projects** when your taxonomy changes.

## 1. Prerequisites in Cursor

- Open this repo as the workspace: `Projects/exec-status-site` (see project root README).
- Enable the **Atlassian** MCP integration and sign in if prompted.
- Set environment variable **`JIRA_BASE_URL`** when running the renderer locally (recommended in `.env.local`, not committed), e.g. `https://yourcompany.atlassian.net/browse/` so Jira keys link correctly in `dist/status.html`.

Example (PowerShell, current session):

```powershell
$env:JIRA_BASE_URL = "https://yourcompany.atlassian.net/browse/"
node scripts/render.mjs data/merged.json
```

---

## 2. Product-facing work (Roadmap / feature rows)

Paste or adapt queries in the MCP Jira UI / `search Jira`. Replace `PROJ`, `NCW`, labels, etc.

**Open epics/features for the product roadmap table**

```jql
project in (NCW, NCW_OTHER) AND type in ("Epic", Story) AND statusCategory != Done ORDER BY updated DESC
```

**Issues under a named epic (adjust “New Tracker Model” epic name/key)**

```jql
"Epic Link" = NCW-88000 ORDER BY rank ASC
```

Or by parent linkage for next-gen projects:

```jql
parent = NCW-87854 ORDER BY key ASC
```

**Recently updated bugs/risk affecting release narrative**

```jql
project = NCW AND priority in (High, Highest) AND statusCategory != Done AND updated >= -7d ORDER BY updated DESC
```

For each MCP result set:

1. Capture **Issue key**, **summary**, **status**, **%**, **resolution / due** into `data/example-merged.json` or a copied `data/merged-{date}.json` following **`schema/status-report.schema.json`**.
2. Preserve **nested child issues** in `rows[].jiraIssues[]`.

---

## 3. Client-facing work (Deployments / tiers)

Typically each client aligns to labels, components, or a dedicated **Jira project**.

**Portfolio slice by label**

```jql
project = CARE AND labels in (ucsdh, uhclient) ORDER BY assignee ASC, updated DESC
```

**Per-client Epic**

```jql
"Epic Link" = SHC-134 ORDER BY rank ASC
```

Swap in keys from **Client Status** slides (Epic keys, trackers). Map tiers into `serviceTier` and owners into `owners[]`.

---

## 4. Merge meeting narrative

See `data/transcripts/README.md`:

- Match transcript filename or inline notes to **`rows[].meetingNotes`** or append bullets using `COPYWRITER` edits in Cursor.
- Copilot summaries can be pasted into chat and assigned to **`meetingNotes`**.

---

## 5. Render HTML & review

```bash
npm run render -- data/merged-YYYY-MM-DD.json
# or defaults to data/example-merged.json
npm run render
```

Open `dist/status.html` in a browser, verify:

- Bands (green / blue / purple) match section intent.
- Jira badges open correctly with your base URL env.
- Last updated meta stamp.

---

## 6. MCP tool usage summary

| Step               | MCP / tool                                                     |
|--------------------|----------------------------------------------------------------|
| Pull Jira details  | **Atlassian** → `searchJiraIssuesUsingJql` equivalent in UI    |
| Read transcripts   | **Read file** (`data/transcripts/...`) in Cursor workspace      |
| Author JSON        | Cursor agent edits `merged.json` conforming to **schema/**     |
| Render             | **`node scripts/render.mjs`** locally (same machine, Phase 2 later) |

No SharePoint MCP is required — OneDrive synced paths are ordinary files Cursor can read.

---

## Troubleshooting

- **Wrong field for %**: map your portfolio’s `% complete`, **story points remaining**, etc. Inspect an issue JSON from Jira MCP and record the field id in PLAYBOOK appendix (add table as you firm it).
- **Next-gen vs classic**: Epic link field names differ; adjust JQL snippets accordingly.
