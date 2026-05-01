#!/usr/bin/env node
/**
 * For each epic key under productReport.sections (id: in_dev) → jiraIssues[].key,
 * fetches child issues via JQL "Epic Link" = KEY (fallback: parent = KEY), then tallies:
 *   todoCount — Jira status category To Do (new)
 *   inProgressCount — In Progress category, excluding status names that match Code Review / QA Review
 *   codeReviewCount — status name matches /code review/i (e.g. Code Review 2, Code Review Passed)
 *   qaReviewCount — status name is QA Review (case-insensitive)
 *   closedCount — status category Done (done)
 *
 * Requires: JIRA_EMAIL (or ATLASSIAN_EMAIL), JIRA_TOKEN (or ATLASSIAN_API_TOKEN)
 * Optional: JIRA_HOST (default nexjhealth.atlassian.net), JIRA_MERGED_JSON
 *
 * Usage:
 *   npm run jira:workload -- --dry-run
 *   npm run jira:workload -- --verbose
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function loadEnvLocalOptional() {
  const fp = path.join(ROOT, '.env.local');
  if (!fs.existsSync(fp)) return;
  const raw = fs.readFileSync(fp, 'utf8');
  for (const line of raw.split('\n')) {
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
  const out = { dryRun: false, verbose: false };
  for (const a of argv) {
    if (a === '--dry-run') out.dryRun = true;
    if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  return out;
}

function collectInDevEpicKeys(data) {
  const sections = data?.productReport?.sections;
  if (!Array.isArray(sections)) return [];
  const inDev = sections.find((s) => s && s.id === 'in_dev');
  if (!inDev || !Array.isArray(inDev.rows)) return [];
  const keys = [];
  for (const row of inDev.rows) {
    for (const ji of row.jiraIssues || []) {
      if (ji && typeof ji.key === 'string' && /^[A-Z][A-Z0-9]+-\d+$/.test(ji.key)) {
        keys.push(ji.key);
      }
    }
  }
  return [...new Set(keys)];
}

function walkApplyWorkload(data, keyToCounts) {
  let n = 0;
  const sections = data?.productReport?.sections;
  if (!Array.isArray(sections)) return 0;
  const inDev = sections.find((s) => s && s.id === 'in_dev');
  if (!inDev?.rows) return 0;
  for (const row of inDev.rows) {
    for (const ji of row.jiraIssues || []) {
      const k = ji?.key;
      if (!k || !keyToCounts[k]) continue;
      const c = keyToCounts[k];
      ji.todoCount = c.todoCount;
      ji.inProgressCount = c.inProgressCount;
      ji.codeReviewCount = c.codeReviewCount;
      ji.qaReviewCount = c.qaReviewCount;
      ji.closedCount = c.closedCount;
      n++;
    }
  }
  return n;
}

async function jiraSearchPage(host, email, token, jql, startAt) {
  const url = `https://${host}/rest/api/3/search`;
  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      jql,
      startAt,
      maxResults: 100,
      fields: ['status']
    })
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`${jql.slice(0, 80)} → ${res.status}: ${text.slice(0, 400)}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return res.json();
}

export function tallyEpicChildStatuses(issues) {
  let todoCount = 0;
  let inProgressCount = 0;
  let codeReviewCount = 0;
  let qaReviewCount = 0;
  let closedCount = 0;
  for (const issue of issues || []) {
    const status = issue?.fields?.status;
    const cat = status?.statusCategory?.key;
    const name = String(status?.name || '').trim();

    if (cat === 'done') {
      closedCount++;
      continue;
    }
    if (cat === 'new') {
      todoCount++;
      continue;
    }
    if (/code review/i.test(name)) {
      codeReviewCount++;
      continue;
    }
    if (/^qa review$/i.test(name)) {
      qaReviewCount++;
      continue;
    }
    if (cat === 'indeterminate') {
      inProgressCount++;
      continue;
    }
    inProgressCount++;
  }
  return {
    todoCount,
    inProgressCount,
    codeReviewCount,
    qaReviewCount,
    closedCount
  };
}

async function countEpicWorkload(host, email, token, epicKey, verbose) {
  const jqls = [`"Epic Link" = ${epicKey}`, `parent = ${epicKey}`];
  let lastErr = null;

  for (const jql of jqls) {
    const allIssues = [];
    let startAt = 0;
    try {
      for (;;) {
        const page = await jiraSearchPage(host, email, token, jql, startAt);
        const issues = page.issues || [];
        allIssues.push(...issues);
        if (issues.length < 100) break;
        startAt += 100;
        if (startAt > 10000) break;
      }
      if (verbose)
        console.error(
          `  ${epicKey}: JQL ok (${jql.split('=')[0].trim()}=…,) total ${allIssues.length}`
        );
      return tallyEpicChildStatuses(allIssues);
    } catch (e) {
      lastErr = e;
      if (verbose) console.error(`  ${epicKey}: JQL failed: ${jql}`, e.message);
      if (e.status === 400) continue;
      throw e;
    }
  }
  throw lastErr || new Error(`No JQL worked for ${epicKey}`);
}

async function main() {
  loadEnvLocalOptional();
  const args = parseArgs(process.argv.slice(2));
  const email = process.env.JIRA_EMAIL || process.env.ATLASSIAN_EMAIL;
  const token = process.env.JIRA_TOKEN || process.env.ATLASSIAN_API_TOKEN;
  const host = (process.env.JIRA_HOST || 'nexjhealth.atlassian.net').replace(
    /^https?:\/\//,
    ''
  );

  const mergedPath = path.join(
    ROOT,
    process.env.JIRA_MERGED_JSON || 'data/example-merged.json'
  );

  if (!email || !token) {
    console.error(
      'Set JIRA_EMAIL and JIRA_TOKEN (or ATLASSIAN_*) to pull epic workloads.'
    );
    process.exit(1);
  }

  const raw = fs.readFileSync(mergedPath, 'utf8');
  const data = JSON.parse(raw);
  const keys = collectInDevEpicKeys(data);
  if (!keys.length) {
    console.error('No in_dev jiraIssues keys found in merged file.');
    process.exit(1);
  }

  /** @type {Record<string, ReturnType<typeof tallyEpicChildStatuses>>} */
  const keyToCounts = {};

  for (const epicKey of keys) {
    const counts = await countEpicWorkload(host, email, token, epicKey, args.verbose);
    keyToCounts[epicKey] = counts;
    console.log(
      `${epicKey}\tToDo\t${counts.todoCount}\tInProg\t${counts.inProgressCount}\tCR\t${counts.codeReviewCount}\tQA\t${counts.qaReviewCount}\tClosed\t${counts.closedCount}`
    );
  }

  const updated = walkApplyWorkload(data, keyToCounts);
  if (args.dryRun) {
    console.log(`Dry run: would update ${updated} jiraIssues row(s).`);
    return;
  }

  fs.writeFileSync(mergedPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(`Updated ${updated} jiraIssues row(s) → ${path.relative(ROOT, mergedPath)}`);
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
