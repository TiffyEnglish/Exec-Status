# Synced transcripts (Phase 1)

Point OneDrive / SharePoint sync here so Cursor can `@` / read files without Graph API.

Suggested layout:

| Pattern | Purpose |
|---------|---------|
| `YYYY-MM-DD__<workstream-key>.md` | One recap per steering meeting (`ucsd_wm`, `validic`). |
| `rolling-<workstream-key>.md` | Single evergreen note per client; prepend newest summary at top. |

`workstream-key` MUST match `rows[].id` in your merged JSON (see [`schema/status-report.schema.json`](../schema/status-report.schema.json)).

Security: Contents are `.gitignored` — keep real transcripts outside git; only this README commits.
