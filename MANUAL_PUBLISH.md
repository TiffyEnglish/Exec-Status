# Manual publishing checklist

Phase 1 ships **offline HTML**. Pick one repeatable channel (edit this document when you finalize).

## Option A — SharePoint page

1. `npm run render` (populate `dist/status.html`).
2. Open tenant SharePoint Communications site → **New** → **Web part page** → add **Embed** or **File viewer** uploading `dist/status.html`.
3. Restrict permissions to Nexi executives (inherit site security group).
4. Copy **Page URL** into exec calendar invites / Teams pin.

## Option B — Teams channel attachment

1. Render file as above.
2. Navigate to Steering / PMO Teams channel → **Upload** → `status.html`.
3. Post with message `"Exec status refreshed YYYY-MM-DD"` and `@mention`.

## Option C — Email envelope

Attach `dist/status.html` plus optional PDF (**Print → Save as PDF** from browser preview).

---

## Acceptance checklist each cycle

| Check | Evidence |
|-------|----------|
| Timestamp visible (`meta.generatedAt`) | Visible in banner |
| Confidentiality footer renders | Nexi boilerplate footer |
| Jira URLs open | Spot-check NCW-/SHC- links with prod instance |
| No unredacted PHI in pasted notes | HIPAA review |

When automated hosting arrives (Phase 2), revisit this sheet and replace uploads with gated HTTPS URL.
