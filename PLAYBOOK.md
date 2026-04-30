# PLAYBOOK.md — Exec status Phase 1 (Cursor + Atlassian MCP)

Use this playbook on each refresh. Update **saved JQL** and **projects** when your taxonomy changes.

Detailed mechanics live in **§§3–8**; **§2** is the ordered checklist agents should follow.

## 1. Prerequisites in Cursor

- Open this repo as the workspace: `Projects/exec-status-site` (see project root README).
- Enable the **Atlassian** MCP integration and sign in if prompted.
- Set environment variable `**JIRA_BASE_URL`** when running the renderer locally (recommended in `.env.local`, not committed), e.g. `https://nexjhealth.atlassian.net/browse/` so Jira keys link correctly in `dist/status.html`.
- `**meta.generatedAt`** should begin with a **calendar date** `**YYYY-MM-DD`** (optionally followed by time). The renderer treats that date prefix as the **report day** for **Last Updated** and for workload Target math (`EXEC_STATUS_REFERENCE_DATE` still overrides). This avoids showing the wrong calendar day when an ISO timestamp with `**Z`** falls on another date in local time.

Example (PowerShell, current session):

```powershell
$env:JIRA_BASE_URL = "https://nexjhealth.atlassian.net/browse/"
node scripts/render.mjs data/merged.json
```

---

## 2. End-to-end refresh checklist (agent runbook)

Execute in order. **Do not run `npm run render` until step 4 is approved** (step 5).


| Step  | Action                                   | Details                                                                                                                                                                                                                                                                                   |
| ----- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | **In Development** ← Jira                | Sync `productReport.sections[]` where `**id` = `in_dev`** to filter **10566** (§3). For each `**jiraIssues[]`** row: refresh `**eaf`** from Jira **before** updating `**todoCount`** / `**inProgressCount`** used for **ETC** / **% Cmp.** (§3 **EAF before ETC and % Cmp.**).            |
| **2** | **Client Project Status** ← Confluence   | Map PROJ portfolio slices → `clientReport` per §4. `**serviceTier`** must follow §4 table: **Service Type** (`in_config_dev` only) vs **Org Subscription Type** (`live_active` / `in_maintenance` only)—never swap. Plus labels, ADF Page Properties, blanks/TBD rules, maintenance sort. |
| **3** | **Status updates** ← reference materials | Refresh **all** narrative columns from **unused** transcripts/notes/decks using **explicit mentions only** (§5). Applies to **product** rows (`statusStages` / `bullets` / `meetingNotes`) and **client** rows (`bullets` / optional `meetingNotes`).                                     |
| **4** | **Review & approval**                    | Produce a **change summary** (§7): diff or bullet list of JSON edits—added/removed rows, material field changes, new bullets. **Stop for human approval** before rendering.                                                                                                               |
| **5** | **Render**                               | After approval: `**npm run render`** (or `npm run render -- path/to/merged.json`). Spot-check `dist/status.html`.                                                                                                                                                                         |


Other product sections (Live AI, In Design, roadmap JQL) are optional between refreshes unless you are explicitly updating those slides—**step 1** in this checklist focuses on the **In Development** table unless you expand scope in the request.

---

## 3. Product-facing work (Roadmap / feature rows)

### In Development slide — aligns to saved roadmap filter (Atlassian MCP)

The **In Development** HTML section (`sections[].id` = `in_dev`) mirrors the issue list returned by NexJ roadmap filter **10566**:

```jql
filter = 10566 ORDER BY rank ASC
```

[Open in Jira](https://nexjhealth.atlassian.net/issues?filter=10566).

**Definition of done (step 1)**

1. Rows under `**in_dev`** correspond to the **current** filter **10566** result set (add/remove/update rows as issues enter or leave the filter).
2. `**projectGroup`** is repeated on consecutive rows where you want a **Project** column rowspan (e.g. Trackers, Device Integration).
3. Each epic/feature row has `**jiraIssues[]`** with keys; sync `**eaf`** per item **4** below **before** relying on workload `**todoCount`** / `**inProgressCount`** for **ETC**, **% Cmp.**, or narrative that assumes those metrics are current.
4. `**eaf`** on each `**jiraIssues[]`** row matches **Project EAF (Cached)** in Jira (Atlassian MCP → patch file → `**npm run jira:eaf -- --patch`**, or REST fallback)—see §3 **Refresh EAF**.
5. Omit **Prompt Updates / Live Jai** (`NCW-87239`) from `**in_dev`** if it belongs under **Live AI Features** instead.

**Slide row order:** `**scripts/render.mjs`** sorts `**in_dev`** rows by `**projectGroup`** (case-insensitive), then `**name`**. Ordering does **not** follow Jira filter rank—the checklist instead verifies **keys / summaries** match filter **10566**.

Group epics by repeating `**projectGroup`** on consecutive rows (**rowspan** in the Project column)—e.g. **Trackers**, **Device Integration**, **Ops Platform Improvements**, **Other**.

Put **linked issue keys** (`jiraIssues[].key`) **in the Feature column** beneath the row title, and `**jiraIssues[].eaf`** (Jira **Project EAF (Cached)** on epics — refreshed via **§3 EAF**) **in the EAF column**, aligned with **ETC** and **% Cmp.** columns.

### Target column (weekly Wednesday)

For each Jira item, the **Target** column can show a **Wednesday** release date derived at render time from workload counts on the issue:

1. Set `**jiraIssues[].todoCount`** (To Do items) and/or `**jiraIssues[].inProgressCount`** (In Progress items). If either is present, the renderer computes a date; otherwise it falls back to a manual `**jiraIssues[].targetDate`** string when provided.
2. **Reference “today”**: environment `**EXEC_STATUS_REFERENCE_DATE`** (`YYYY-MM-DD`) if set; else the **date prefix** of `**meta.generatedAt`** (`YYYY-MM-DD` from the start of the ISO string, interpreted as that calendar day—not shifted by UTC); else today (local).
3. Let **W** = **ceil**(**To Do** × 1.5 + **In Progress** × 1). Advance **W** **working days** forward (Mon–Fri only; weekends do not count).
4. From that calendar date, round **up** to the **next Wednesday** on or after it (weekly release train).

Row-level `**targetDate`** (optional) still renders as a headline line above per-issue targets when non-empty.

### EAF before ETC and % Cmp.

For **every** `**jiraIssues[]`** entry that participates in the **In Development** metrics columns (**ETC**, **% Cmp.**, **EAF**):

1. **Capture `eaf` first** — populate `**jiraIssues[].eaf`** from Jira **Project EAF (Cached)** (§3 **Refresh EAF**) so the merged JSON matches live Jira for that key.
2. **Then** set or refresh `**todoCount`** / `**inProgressCount`** (and optional `**etc**`) from Jira when you use workload-based **ETC** and derived **% Cmp.**

The renderer evaluates **ETC** and **% Cmp.** **after** reading `**eaf`**: % Cmp. = (EAF − ETC) ÷ EAF only when `**eaf` > 0** and ETC resolves. If `**eaf`** is missing while workload counts exist, **ETC** may still render but **% Cmp.** falls back to stored `**percentComplete`** or stays empty—**do not treat % as authoritative until `eaf` is present** for that issue.

### ETC, % Cmp., and EAF (render-time)

Once `**eaf`** is current per issue (above), `**npm run render**` computes:

- **ETC** = (**To Do** × 1.5) + (**In Progress** × 1) whenever `**todoCount`** or `**inProgressCount**` is set on the issue; otherwise the renderer uses stored `**etc**` when present.
- **% Cmp.** (**% Complete**) = **(EAF − ETC) ÷ EAF** (rounded, clamped 0–100) when `**eaf` > 0** and ETC resolves; otherwise it falls back to stored `**percentComplete`** when present.

---

## 4. Client-facing work (Deployments / tiers)

### Client Project Status — Confluence Portfolio (`PROJ`)

The HTML **Client Project Status Report** (`clientReport` in merged JSON) can be aligned to the live portfolio hub:

**[PROJ space overview / Portfolio](https://nexjhealth.atlassian.net/wiki/spaces/PROJ/overview)**

That page uses **Include** macros for three reporting pages; each embeds a **Page Properties Report** (`detailssummary`) that lists child pages by **label**. Use **Atlassian MCP** (after auth): `searchConfluenceUsingCql` to list pages per slice, then `**getConfluencePage`** with `**contentFormat`: `adf`** to read each page’s **Page Properties** table (the Markdown export is often empty for these pages).

**CQL slices (match the embedded reports; `space = PROJ`)**


| Exec Status section    | Labels (both required)                             |
| ---------------------- | -------------------------------------------------- |
| Pre Go Live            | `project_summary` + `implementation_not_completed` |
| Live & Active Projects | `project_summary` + `active`                       |
| In Maintenance         | `project_summary` + `maintenance`                  |


Sort results by **page title** if you want parity with Confluence’s “project name” column.

**Confluence Page Properties → JSON `serviceTier` (mandatory sourcing)**

**Do not invent, default, or infer** `serviceTier` from programme name, other rows, or prior weeks unless Confluence still matches—every refresh must copy from the **correct** Page Properties column for that portfolio slice:


| Exec Status JSON section (`sections[].id`) | Confluence slice (labels)                          | **Only** field that populates `serviceTier` |
| ------------------------------------------ | -------------------------------------------------- | ------------------------------------------- |
| `**in_config_dev`** (Pre Go Live)          | `project_summary` + `implementation_not_completed` | **Service Type**                            |
| `**live_active`** (Live & Active)          | `project_summary` + `active`                       | **Org Subscription Type**                   |
| `**in_maintenance`** (In Maintenance)      | `project_summary` + `maintenance`                  | **Org Subscription Type**                   |


Many PROJ templates show **both** Service Type and Org Subscription Type on the same page. For **Pre Go Live**, use **Service Type** for `serviceTier` even if Org Subscription Type is filled in; for **Live** and **In Maintenance**, use **Org Subscription Type** only—not Service Type.

Perform the following mapping:


| Confluence (Page Properties)       | JSON field          | Notes                                                                                                |
| ---------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------- |
| *(page title)*                     | `name`              | Treat as **Project Name**.                                                                           |
| **Service Type**                   | `serviceTier`       | **Pre Go Live (`in_config_dev`) only.**                                                              |
| **Org Subscription Type**          | `serviceTier`       | `**live_active` and `in_maintenance` only.**                                                         |
| **Project Manager** (`@mention`s)  | `owners[]`          | Use **initials** only (e.g. `GY`, `SS                                                                |
| **Next Subscription Renewal Date** | `availabilityNotes` | Append or refresh segment `Renewal: M/D/YYYY` (US-style). Treat `**TBD`** as blank for this segment. |
| **Service Days Left**              | `availabilityNotes` | Segment `Available Days:` plus numeric value (keep decimals if present).                             |


If any mapped Confluence value is **blank** (or renewal is only **TBD**), **leave the corresponding JSON field unchanged** from the previous exec snapshot—do not overwrite with empty strings unless you intend to clear narrative.

**HTML rendering (client tables)**

- Every section always shows **Service** and **Timeline / Availability** columns. `**serviceTier`** must follow the **section-specific** Confluence rules in the table above (never swap Service Type vs Org Subscription Type).
- If the correct Page Properties cell is blank after trim, show **—** in HTML until Confluence is updated—still **do not** substitute Org Subscription for Pre Go Live or Service Type for Live/Maintenance.
- **Timeline / Availability** uses `**availabilityNotes`** when non-empty after trim; else `**targetDate`** when non-empty; else **—**. Prefer **omitting** `**availabilityNotes`** over `**""`** when there is no timeline copy.

Manual `**jiraIssues[].targetDate`** values in `**YYYY-MM-DD`** form are displayed as `**M/D/YYYY**` using the numeric date parts (no UTC midnight parsing), so they stay aligned with US-style renewal strings.

**Row lifecycle**

- **Add** a JSON row when a Confluence page appears in the slice’s CQL results and you want it on the exec deck; assign a **stable** `**rows[].id`** (slug) so transcript keys and merges stay consistent across weeks.
- **Remove** (or stop updating) a row when the page **drops out** of that slice’s labels—your choice whether to delete from JSON or archive outside this repo.
- If the **page title** changes in Confluence but it is the same programme, keep `**id`** and update `**name`** to match Confluence.

**Section headers in JSON**

- **Pre Go Live**.
- **Live & Active Projects**.
- **In Maintenance**.

**In Maintenance — row order in JSON**

Do **not** sort by Confluence **Last Update**. Order rows as follows:

1. All rows with **non-empty** `bullets` (status narrative), **then** rows with **empty** `bullets`.
2. Within each of those two groups, sort by **next renewal date** ascending (parse `Renewal: M/D/YYYY` from `availabilityNotes`; earliest renewal first).

Client `**bullets`** / `**meetingNotes`** from transcripts and decks follow **§5**.

---

## 5. Status updates from reference materials (product + client)

Use **synced reference files**—see `**data/transcripts/README.md`**. Typical locations:


| Source                         | Location                                  | Notes                                                                                                                                     |
| ------------------------------ | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Meeting transcripts / standups | `data/transcripts/*.txt`, `*.md`          | Primary; OneDrive sync per README.                                                                                                        |
| Decks / exports                | e.g. `**data/decks/*.pptx`** (if present) | **No automated extractor** in Phase 1—paste speaker notes or slide bullets into chat / JSON, or summarize explicitly dated sections only. |


### Explicit mention rule

Update `**statusStages`** / `**bullets`** / `**meetingNotes`** (product) or `**bullets`** / `**meetingNotes**` (client) **only** when the reference **explicitly names** the feature or client (agreed names, issue keys, or unmistakable programme labels). Do **not** invent narrative from vague phrases (“the client”, “the dashboard”) without disambiguation.

### Exec-facing wording (no source citations in bullets)

Do **not** append transcript or meeting references to `**bullets[]`** or `**statusStages[].bullets[]`**—avoid suffixes like `(AI touchpoint YYYY-MM-DD)`, `(stand-up YYYY-MM-DD)`, or similar. The exec slide reads as final copy; provenance belongs in `**meta.transcriptPaths`** and optionally `**meetingNotes**`, not in the rendered status column.

### “Unused” / recent inputs

Prefer sources **newer than the last publish**:

- Compare file **modified time** or embedded **meeting date** in the note header to `**meta.generatedAt`** (or the date in your output filename).
- Optionally maintain `**meta.transcriptPaths`** (see schema) listing files consumed this run so the next refresh can skip duplicates—**append** paths when you treat a file as fully mined for this cycle.

### Product rows (`productReport`)

- `**statusStages[]`** ( `**done` / `in_progress` / `next`** buckets ) — preferred when the slide uses the three-band Status updates layout.
- `**bullets[]`** — flat list when not using `**statusStages`**.
- `**meetingNotes**` — optional longer paste keyed to the row.

### Client rows (`clientReport`)

- `**bullets[]**` — status-update column; may stay empty when Confluence + refs have nothing explicit (renderer leaves the cell blank).
- `**meetingNotes**` — optional; same rule as product.

Copilot / Teams summaries may be pasted into chat and distilled under the explicit-mention rule before committing to JSON.

---

## 6. Review gate & render HTML

### Review & approval (required before render)

1. Summarize **changes** for the approver: edited `**data/*.json`** path(s); **added/removed** product or client rows; notable **Confluence field** updates; **new or revised bullets** sourced from which files.
2. Optional: show `**git diff`** on the merged JSON or paste key sections into chat.
3. **Pause** until the approver confirms—then proceed to render.

### Run render

```bash
npm run render -- data/merged-YYYY-MM-DD.json
# or defaults to data/example-merged.json
npm run render
```

Open `**dist/status.html**` in a browser, verify:

- Bands (green / blue / purple) match section intent.
- Jira badges open correctly with your base URL env.
- Last updated `**meta**` stamp.
- Status-update columns match approved narrative.

---

## 7. MCP tool usage summary


| Step                     | MCP / tool                                                                                                                                                                                                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pull Jira slice / fields | **Atlassian** → `**searchJiraIssuesUsingJql`**, `**getJiraIssue`** (include `**customfield_***` from `**JIRA_EAF_FIELD_ID**` in `.env.example`) → `**npm run jira:eaf -- --patch**` — apply **EAF** per issue **before** reconciling **todoCount** / **inProgressCount** for **ETC** / **%** |
| Client portfolio pages   | **Atlassian** → `searchConfluenceUsingCql`, `getConfluencePage` (**ADF**) for PROJ labeled pages                                                                                                                                                                                             |
| Read transcripts / notes | **Read file** (`data/transcripts/...`) in Cursor workspace                                                                                                                                                                                                                                   |
| Decks / binaries         | Open locally or paste excerpts—Phase 1 has no PPTX parser in-repo                                                                                                                                                                                                                            |
| Author JSON              | Cursor agent edits merged JSON conforming to `**schema/`**                                                                                                                                                                                                                                   |
| Render                   | `**node scripts/render.mjs`** locally — client tables always include Service + Timeline; `**in_dev`** sorted Project → Feature                                                                                                                                                               |


No SharePoint MCP is required — OneDrive synced paths are ordinary files Cursor can read.

---

## Troubleshooting

- **Wrong Service column value**: confirm JSON `**sections[].id`**—Pre Go Live uses **Service Type** only; Live & Maintenance use **Org Subscription Type** only (§4). Never mix columns across slices.
- **Wrong calendar day on “Last Updated” or product Targets**: ensure `**meta.generatedAt`** starts with the intended `**YYYY-MM-DD`** (see §1). Avoid relying on a bare UTC midnight instant alone when authoring snapshots by hand.
- **Wrong or missing % Cmp.**: confirm `**eaf`** is populated **before** trusting derived **%**; without `**eaf` > 0**, the renderer will not compute **(EAF − ETC) ÷ EAF**. Refresh **Project EAF (Cached)** first, then workload counts.
- **Wrong field for %**: map your portfolio’s `% complete`, **story points remaining**, etc. Inspect an issue JSON from Jira MCP and record the field id in PLAYBOOK appendix (add table as you firm it).
- **Next-gen vs classic**: Epic link field names differ; adjust JQL snippets accordingly.

