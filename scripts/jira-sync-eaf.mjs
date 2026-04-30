#!/usr/bin/env node
/**
 * Writes **`jiraIssues[].eaf`** (Project EAF (Cached)) into merged JSON.
 *
 * **Preferred (Cursor):** use **Atlassian MCP** (`getJiraIssue` or `searchJiraIssuesUsingJql`) with your site’s
 * EAF custom field id (see `.env.example` → **`JIRA_EAF_FIELD_ID`**), build a JSON map **`{ "NCW-88017": 25.5, … }`**,
 * then apply **without** API tokens:
 *
 *   npm run jira:eaf -- --patch data/jira-eaf-patch.json
 *
 * Keys may be ignored when prefixed with **`_`** (e.g. **`"_note"`**) for scratch metadata.
 *
 * **CLI fallback:** when **`JIRA_EMAIL`** + **`JIRA_TOKEN`** are set, this script can fetch via Jira REST
 * (`GET /rest/api/3/field` resolves **Project EAF (Cached)** unless **`JIRA_EAF_FIELD_ID`** is set).
 *
 * ETC and % Cmp. (% Complete) are **computed at HTML render time** (`scripts/render.mjs`) from:
 *   workload ETC = (# To Do × 1.5) + (# In Progress × 1)
 *   % = (EAF − ETC) / EAF  (when EAF &gt; 0)
 *
 * REST requires:
 *   JIRA_EMAIL (or ATLASSIAN_EMAIL)
 *   JIRA_TOKEN (or ATLASSIAN_API_TOKEN)
 * Optional:
 *   JIRA_HOST (default nexjhealth.atlassian.net)
 *   JIRA_EAF_FIELD_ID — optional for REST; document the same id for MCP **`fields`** arrays
 *   JIRA_MERGED_JSON — path relative to repo root (default data/example-merged.json)
 *
 * Usage:
 *   npm run jira:eaf -- --patch data/jira-eaf-patch.json
 *   npm run jira:eaf:apply    # package.json alias → same with default patch path
 *   npm run jira:eaf -- --dry-run
 *   npm run jira:eaf -- --verbose
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

/** Load `.env.local` from repo root (KEY=value, # comments); does not override existing env vars. */
function loadEnvLocalOptional() {
  const fp = path.join(ROOT, '.env.local');
  if (!fs.existsSync(fp)) return;
  const raw = fs.readFileSync(fp, 'utf8');
  for (const line of raw.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}

function parseArgs(argv) {
  const out = { dryRun: false, verbose: false, patchFile: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
    else if (a === '--patch') {
      out.patchFile = argv[i + 1] ?? null;
      i++;
    }
  }
  return out;
}

/** @returns {Promise<string>} */
async function readStdinUtf8() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Parse `{ "NCW-1": 12.5, "_note": "..." }` → map of issue key → finite number.
 * Ignores keys starting with `_`.
 */
function parsePatchJson(raw) {
  const o = JSON.parse(raw);
  if (!o || typeof o !== 'object' || Array.isArray(o)) {
    throw new Error('Patch JSON must be a flat object of issue keys to numbers.');
  }
  /** @type {Record<string, number>} */
  const keyToEaf = {};
  for (const [k, v] of Object.entries(o)) {
    if (k.startsWith('_')) continue;
    if (!/^[A-Z][A-Z0-9]+-\d+$/.test(k)) {
      throw new Error(`Invalid patch key (expected ISSUE-123): ${JSON.stringify(k)}`);
    }
    const n = extractNumericEaf(v);
    if (n == null) throw new Error(`Non-numeric EAF for ${k}: ${JSON.stringify(v)}`);
    keyToEaf[k] = n;
  }
  return keyToEaf;
}

function collectKeysFromMergedText(raw) {
  const m = [...raw.matchAll(/"key"\s*:\s*"([A-Z][A-Z0-9]+-\d+)"/g)];
  return [...new Set(m.map((x) => x[1]))].sort();
}

function walkUpdateEaf(j, keyToEaf) {
  let n = 0;
  function visit(o) {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach(visit);
    if (
      typeof o.key === 'string' &&
      /^[A-Z][A-Z0-9]+-\d+$/.test(o.key) &&
      Object.prototype.hasOwnProperty.call(keyToEaf, o.key) &&
      keyToEaf[o.key] != null
    ) {
      o.eaf = keyToEaf[o.key];
      n++;
    }
    for (const v of Object.values(o)) visit(v);
  }
  visit(j);
  return n;
}

function extractNumericEaf(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const x = Number(raw.trim());
    return Number.isNaN(x) ? null : x;
  }
  if (typeof raw === 'object') {
    if (typeof raw.value === 'number') return raw.value;
    if (typeof raw.value === 'string') return extractNumericEaf(raw.value);
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

function normalizeFieldName(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Finds the custom field named **Project EAF (Cached)** (epics/features).
 * Optional `JIRA_EAF_FIELD_ID` skips lookup (value still stored as `eaf` in merged JSON).
 */
async function resolveEafFieldId(host, email, token, verbose) {
  const override = process.env.JIRA_EAF_FIELD_ID?.trim();
  if (override) {
    console.log(`Using EAF field id from JIRA_EAF_FIELD_ID (${override}); skipping name lookup.`);
    return override;
  }

  const arr = await jiraFetchJson(host, email, token, '/rest/api/3/field');
  const ranked = [];

  for (const f of arr) {
    if (!f?.id?.startsWith('customfield_')) continue;
    const name = normalizeFieldName(f.name).toLowerCase();

    let score = 0;
    // Prefer exact "Project EAF (Cached)" per NexJ Health Jira naming.
    if (name === 'project eaf (cached)') score = 300;
    else if (/\bproject eaf\b/.test(name) && name.includes('cached')) score = 200;
    else if (/\bproject eaf\b/.test(name)) score = 50;

    if (score) ranked.push({ id: f.id, disp: f.name, score });
  }

  ranked.sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best) {
    throw new Error(
      'Could not find a custom field named "Project EAF (Cached)". Set JIRA_EAF_FIELD_ID to your field id.'
    );
  }
  console.log(`Resolved Jira "Project EAF (Cached)" field -> ${best.id} (${best.disp})`);
  if (verbose && ranked.length > 1) {
    console.log(
      'Other Project EAF-like fields:',
      ranked.slice(1, 5).map((r) => `${r.id} (${r.disp})`).join(', ')
    );
  }
  return best.id;
}

async function fetchIssueEaf(host, email, token, key, fieldId) {
  const issue = await jiraFetchJson(
    host,
    email,
    token,
    `/rest/api/3/issue/${encodeURIComponent(key)}?fields=${encodeURIComponent(fieldId)}`
  );
  const raw = issue.fields?.[fieldId];
  const n = extractNumericEaf(raw);
  return { issueKey: issue.key, eaf: n };
}

async function main() {
  loadEnvLocalOptional();
  const args = parseArgs(process.argv.slice(2));
  const mergedPath = path.join(
    ROOT,
    process.env.JIRA_MERGED_JSON || 'data/example-merged.json'
  );

  if (args.patchFile) {
    const patchSource =
      args.patchFile === '-'
        ? await readStdinUtf8()
        : fs.readFileSync(path.resolve(ROOT, args.patchFile), 'utf8');
    const keyToEaf = parsePatchJson(patchSource);
    const rawMerged = fs.readFileSync(mergedPath, 'utf8');
    const j = JSON.parse(rawMerged);
    const updatedRows = walkUpdateEaf(j, keyToEaf);
    if (args.verbose) {
      for (const k of Object.keys(keyToEaf).sort()) {
        console.log(k, `→ EAF=${keyToEaf[k]}`);
      }
    }
    fs.writeFileSync(mergedPath, `${JSON.stringify(j, null, 2)}\n`, 'utf8');
    console.log(
      `Applied EAF patch (${Object.keys(keyToEaf).length} key(s)) → ${updatedRows} jiraIssues row(s); saved ${path.relative(ROOT, mergedPath)}.`
    );
    return;
  }

  const raw = fs.readFileSync(mergedPath, 'utf8');
  const keys = collectKeysFromMergedText(raw);

  console.log(
    `Found ${keys.length} issue keys in ${path.relative(ROOT, mergedPath)}`
  );

  if (args.dryRun) {
    console.log('Dry-run: no credentials required; skipping Jira.');
    console.log(
      'Tip: prefer Atlassian MCP for reads, then npm run jira:eaf -- --patch <map.json>.'
    );
    process.exit(0);
  }

  const email = process.env.JIRA_EMAIL || process.env.ATLASSIAN_EMAIL || '';
  const token = process.env.JIRA_TOKEN || process.env.ATLASSIAN_API_TOKEN || '';
  const host = process.env.JIRA_HOST || 'nexjhealth.atlassian.net';

  if (!email || !token) {
    console.error(`
Missing JIRA_EMAIL / JIRA_TOKEN (REST path).

Preferred in Cursor: read **Project EAF (Cached)** with **Atlassian MCP** (\`getJiraIssue\` / \`searchJiraIssuesUsingJql\`),
build a JSON map \`{ "NCW-88017": 25.5, … }\`, then apply locally:

  npm run jira:eaf -- --patch data/jira-eaf-patch.json

REST fallback — Atlassian API token:
  https://id.atlassian.com/manage-profile/security/api-tokens

PowerShell:

  $env:JIRA_HOST = "${host}"
  $env:JIRA_EMAIL = "you@company.com"
  $env:JIRA_TOKEN = "<token>"
  # Optional: $env:JIRA_EAF_FIELD_ID = "customfield_12345"

`);
    process.exit(1);
  }

  const fieldId = await resolveEafFieldId(host, email, token, args.verbose);

  console.log(`Fetching EAF from ${host} …`);

  const keyToEaf = {};
  for (const key of keys) {
    try {
      const r = await fetchIssueEaf(host, email, token, key, fieldId);
      if (args.verbose) {
        console.log(
          key,
          r.eaf != null ? `→ EAF=${r.eaf}` : '→ (no EAF parsed — unchanged)'
        );
      }
      if (r.eaf != null) keyToEaf[key] = r.eaf;
    } catch (e) {
      console.warn(key, '-', String(e.message || e));
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  const j = JSON.parse(raw);
  const updatedRows = walkUpdateEaf(j, keyToEaf);
  fs.writeFileSync(mergedPath, `${JSON.stringify(j, null, 2)}\n`, 'utf8');

  console.log(
    `Updated eaf on ${updatedRows} jiraIssues row(s); saved ${path.relative(ROOT, mergedPath)}.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
