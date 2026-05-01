# Daily / weekly Cursor refresh ritual

1. Prep Jira baseline — Run the JQL blocks in [`PLAYBOOK.md`](PLAYBOOK.md) via Atlassian MCP; jot field gaps (new epics).
2. Pull meeting text — Open latest files under [`data/transcripts/`](data/transcripts/README.md) or paste recap snippets into Cursor chat keyed by client/product.
3. Merge JSON — Duplicate `data/example-merged.json` → `data/merged-YYYY-MM-DD.json`; update structured rows (`productReport` then `clientReport`). Keep `"meta.generatedAt"` current ISO stamp.
4. Render proof —
   ```bash
   $env:JIRA_BASE_URL="https://nexjhealth.atlassian.net/browse/"
   npm run render -- data/merged-YYYY-MM-DD.json
   ```
5. Visual QA — Open `dist/status.html` locally; zoom to 125% exec-style; fix HTML/CSS templates if banners misalign (`styles/report.css`).
6. Diff review — Show agent diff (`git diff -- data` + `dist`). Approve stakeholder wording.
7. Publish manually — Follow [`MANUAL_PUBLISH.md`](MANUAL_PUBLISH.md); send link / upload where leadership expects status.
