#!/usr/bin/env node
/
 * Reads Jira issue keys from data/example-merged.json (nested jiraIssues[].key),
 * pulls each issue via Jira Cloud REST API, resolves a "% Complete"–style field where possible,
 * and writes updated percentComplete onto each jiraIssues[] object.
 *
 * Requires:
 *   JIRA_EMAIL (or ATLASSIAN_EMAIL)
 *   JIRA_TOKEN (API token — or ATLASSIAN_API_TOKEN)
 * Optional:
 *   JIRA_HOST (default nexjhealth.atlassian.net)
 *   JIRA_MERGED_JSON (relative to repo root — default data/example-merged.json)
 *
 * Usage (PowerShell):
 *   $env:JIRA_EMAIL = "you@nexjhealth.com"
 *   $env:JIRA_TOKEN = "<API token>"
 *   npm run jira:percent -- --dry-run
 *   npm run jira:percent -- --verbose
 *   npm run render
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function parseArgs(argv) {
  const out = { dryRun: false, verbose: false };
  for (const a of argv) {
    if (a === '--dry-run') out.dryRun = true;
    if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  return out;
}

function collectKeysFromMergedText(raw) {
  const m = [...raw.matchAll(/"key"\s*:\s*"([A-Z][A-Z0-9]+-\d+)"/g)];
  return [...new Set(m.map((x) => x[1]))].sort();
}

function walkUpdatePercent(j, keyToPct) {
  let n = 0;
  function visit(o) {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach(visit);
    if (typeof o.key === 'string' && Object.prototype.hasOwnProperty.call(o, 'percentComplete')) {
      const k = o.key;
      if (Object.prototype.hasOwnProperty.call(keyToPct, k) && keyToPct[k] != null) {
        o.percentComplete = keyToPct[k];
        n++;
      }
    }
    for (const v of Object.values(o)) visit(v);
  }
  visit(j);
  return n;
}

function toPct(v) {
  if (typeof v === 'number' && v >= 0 && v <= 100) return Math.round(v);
  if (typeof v === 'string') {
    const m = /^(\d{1,3})\s*%?\s*$/.exec(v.trim());
    if (m) return Math.min(100, Number(m[1]));
  }
  if (v && typeof v === 'object') {
    if (typeof v.value === 'number') return toPct(v.value);
    if (typeof v.value === 'string') return toPct(v.value);
  }
  return null;
}

function extractPercentFromFields(fields, preferredFieldId) {
  if (!fields || typeof fields !== 'object') return null;

  if (
    preferredFieldId &&
    Object.prototype.hasOwnProperty.call(fields, preferredFieldId)
  ) {
    const p = toPct(fields[preferredFieldId]);
    if (p != null) return { percent: p, source: preferredFieldId };
  }

  for (const [fieldId, val] of Object.entries(fields)) {
    if (!fieldId.startsWith('customfield_')) continue;
    const p = toPct(val);
    if (p != null) return { percent: p, source: fieldId };
  }

  const agg = fields.aggregateprogress;
  if (agg && typeof agg.percent === 'number' && !Number.isNaN(agg.percent)) {
    return { percent: Math.round(agg.percent), source: 'aggregateprogress.percent' };
  }

  return null;
}

async function jiraFetchJson(host, email, token, pathname) {
  const url = `https://${host}${pathname}`;
  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json'
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${pathname} → ${res.status}: ${text.slice(0, 400)}`);
  }
  return res.json();
}

async function getPreferredPercentFieldId(host, email, token) {
  try {
    const arr = await jiraFetchJson(host, email, token, `/rest/api/3/field`);
    const ranked = [];
    for (const f of arr) {
      const name = (f?.name || '').trim();
      let score = 0;
      if (/%/.test(name) && /\bcomplete/i.test(name)) score = 100;
      else if (/\bpercent\b.*\bcomplete\b/i.test(name)) score = 90;
      else if (/\bpct\b/i.test(name) && /\bcomplete/i.test(name)) score = 80;
      else if (/^%?\s*complete$/i.test(name)) score = 70;
      if (score && f?.schema?.custom) ranked.push({ id: f.id, score });
    }
    ranked.sort((a, b) => b.score - a.score);
    return ranked[0]?.id || null;
  } catch {
    return null;
  }
}

async function fetchIssuePct(host, email, token, key, preferredFieldId) {
  const fieldsParam = preferredFieldId
    ? `?fields=${encodeURIComponent(`${preferredFieldId},aggregateprogress`)}`
    : '';

  let issue = await jiraFetchJson(
    host,
    email,
    token,
    `/rest/api/3/issue/${encodeURIComponent(key)}${fieldsParam}`
  );
  let inferred = extractPercentFromFields(issue.fields, preferredFieldId);

  if (!inferred && preferredFieldId) {
    issue = await jiraFetchJson(
      host,
      email,
      token,
      `/rest/api/3/issue/${encodeURIComponent(key)}`
    );
    inferred = extractPercentFromFields(issue.fields, null);
  }

  return { issueKey: issue.key, inferred };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mergedPath = path.join(
    ROOT,
    process.env.JIRA_MERGED_JSON || 'data/example-merged.json'
  );
  const raw = fs.readFileSync(mergedPath, 'utf8');
  const keys = collectKeysFromMergedText(raw);

  console.log(
    `Found ${keys.length} issue keys in ${path.relative(ROOT, mergedPath)}: ${keys.join(', ')}`
  );

  if (args.dryRun) {
    console.log('Dry-run: no credentials required; skipping Jira.');
    process.exit(0);
  }

  const email = process.env.JIRA_EMAIL || process.env.ATLASSIAN_EMAIL || '';
  const token = process.env.JIRA_TOKEN || process.env.ATLASSIAN_API_TOKEN || '';
  const host = process.env.JIRA_HOST || 'nexjhealth.atlassian.net';

  if (!email || !token) {
    console.error(`
Missing JIRA_EMAIL / JIRA_TOKEN.

Atlassian API token:
  https://id.atlassian.com/manage-profile/security/api-tokens

PowerShell:

  $env:JIRA_HOST = "${host}"
  $env:JIRA_EMAIL = "you@company.com"
  $env:JIRA_TOKEN = "<token>"

`);
    process.exit(1);
  }

  console.log(`Resolving % complete field hints on ${host} …`);
  const preferredFieldId = await getPreferredPercentFieldId(host, email, token);
  if (preferredFieldId && args.verbose) {
    console.log(`Preferred Portfolio-style field id: ${preferredFieldId}`);
  }

  const keyToPct = {};
  for (const key of keys) {
    try {
      const { inferred } = await fetchIssuePct(host, email, token, key, preferredFieldId);
      if (args.verbose) {
        console.log(
          key,
          inferred
            ? `→ ${inferred.percent}% (${inferred.source})`
            : '→ (could not infer % complete — unchanged)'
        );
      }
      if (inferred) keyToPct[key] = inferred.percent;
    } catch (e) {
      console.warn(key, '-', String(e.message || e));
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  const j = JSON.parse(raw);
  const updatedRows = walkUpdatePercent(j, keyToPct);
  fs.writeFileSync(mergedPath, JSON.stringify(j, null, 2) + '\n', 'utf8');

  console.log(
    `Updated percentComplete on ${updatedRows} jiraIssues row(s); saved ${path.relative(ROOT, mergedPath)}.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
