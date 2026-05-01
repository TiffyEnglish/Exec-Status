#!/usr/bin/env node
/**
 * Reads schema-conform merged data (JSON) and writes dist/status.html.
 * Default input: data/example-merged.json
 * Override: EXEC_STATUS_MERGED (repo-relative or absolute), or pass a path as argv[2].
 * Usage: node scripts/render.mjs [path/to/input.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

/** Load `.env.local` from repo root; does not override existing env vars. */
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

loadEnvLocalOptional();

function resolveInputPath(p) {
  if (!p || !String(p).trim()) return null;
  const raw = String(p).trim();
  return path.isAbsolute(raw) ? raw : path.join(ROOT, raw);
}

function defaultMergedInputPath() {
  return path.join(ROOT, 'data', 'example-merged.json');
}

const execMerged = resolveInputPath(process.env.EXEC_STATUS_MERGED);
const argvMerged = resolveInputPath(process.argv[2]);

const INPUT = execMerged || argvMerged || defaultMergedInputPath();

const inputPickReason = execMerged
  ? 'EXEC_STATUS_MERGED'
  : argvMerged
    ? 'cli path'
    : 'default · data/example-merged.json';

function loadMerged(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}
const DIST = path.join(ROOT, 'dist');
const OUT_FILE = path.join(DIST, 'status.html');

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function themeClass(theme) {
  const t = theme || 'neutral';
  return { green: 'green', blue: 'blue', purple: 'purple', neutral: 'neutral' }[t]
    ? t
    : 'neutral';
}

function linksHtml(links = []) {
  if (!links.length) return '';
  return links
    .map(
      (l) =>
        `<span class="links"><a href="${esc(l.href)}">${esc(l.label)}</a></span>`
    )
    .join(' ');
}

function jiraBrowsePrefix() {
  const prefix = process.env.JIRA_BASE_URL || 'https://nexjhealth.atlassian.net/browse/';
  return String(prefix).replace(/\/?$/, '/');
}

/** Local calendar midnight (avoids TZ drift for date-only math). */
function stripLocalDate(d) {
  const x = new Date(d.getTime());
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * Calendar date from ISO timestamp prefix `YYYY-MM-DD` — interpret as that civil date for the report
 * (not UTC instant → local), avoiding header / reference-date off-by-one near timezone boundaries.
 */
function calendarDateFromIsoPrefix(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? '').trim());
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  const dt = new Date(y, mo - 1, d);
  return Number.isNaN(dt.getTime()) ? null : stripLocalDate(dt);
}

function isWeekendLocal(d) {
  const day = stripLocalDate(d).getDay();
  return day === 0 || day === 6;
}

/**
 * EXEC_STATUS_REFERENCE_DATE=YYYY-MM-DD overrides; else meta.generatedAt date; else now.
 */
function resolveTargetReferenceDate(meta) {
  const envRaw = process.env.EXEC_STATUS_REFERENCE_DATE?.trim();
  if (envRaw && /^\d{4}-\d{2}-\d{2}$/.test(envRaw)) {
    const [y, m, dd] = envRaw.split('-').map(Number);
    const d = new Date(y, m - 1, dd);
    if (!Number.isNaN(d.getTime())) return stripLocalDate(d);
  }
  const fromMeta =
    meta?.generatedAt && calendarDateFromIsoPrefix(meta.generatedAt);
  if (fromMeta) return fromMeta;
  let d = meta?.generatedAt ? new Date(meta.generatedAt) : new Date();
  if (Number.isNaN(d.getTime())) d = new Date();
  return stripLocalDate(d);
}

/** Advance from startDate by whole working days only (skip Sat/Sun). First step moves off "today". */
function addWholeWorkingDaysAfterStart(startDate, wholeDays) {
  const n = Math.max(0, Math.ceil(Number(wholeDays) || 0));
  const d = stripLocalDate(new Date(startDate));
  let remaining = n;
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    if (!isWeekendLocal(d)) remaining -= 1;
  }
  return stripLocalDate(d);
}

/** Calendar Wednesday on or after d (releases weekly on Wednesdays). */
function nextWednesdayOnOrAfterCal(day) {
  const d = stripLocalDate(new Date(day));
  const dow = d.getDay();
  const want = 3;
  const delta = (want - dow + 7) % 7;
  d.setDate(d.getDate() + delta);
  return d;
}

/**
 * Nominal completion = ceil(workload ETC units) working days after reference date,
 * then snap up to next Wednesday on the calendar (release train).
 * ETC units match workloadEtcSum (To Do / In Progress / Code Review / QA Review weights).
 */
function computedReleaseWednesday(workloadUnits, referenceDate) {
  const wd = Math.ceil(Math.max(0, workloadUnits) - 1e-12);
  const nominal = addWholeWorkingDaysAfterStart(referenceDate, wd);
  return nextWednesdayOnOrAfterCal(nominal);
}

const WORKLOAD_COUNT_KEYS = [
  'todoCount',
  'inProgressCount',
  'codeReviewCount',
  'qaReviewCount',
  'closedCount'
];

function issueShouldComputeTarget(issue) {
  return WORKLOAD_COUNT_KEYS.some((k) => issue?.[k] != null);
}

function effectiveWorkloadTodo(issue) {
  return issue.todoCount != null ? Math.max(0, Number(issue.todoCount) || 0) : 0;
}

function effectiveWorkloadInProgress(issue) {
  return issue.inProgressCount != null
    ? Math.max(0, Number(issue.inProgressCount) || 0)
    : 0;
}

function effectiveWorkloadCodeReview(issue) {
  return issue.codeReviewCount != null
    ? Math.max(0, Number(issue.codeReviewCount) || 0)
    : 0;
}

function effectiveWorkloadQaReview(issue) {
  return issue.qaReviewCount != null
    ? Math.max(0, Number(issue.qaReviewCount) || 0)
    : 0;
}

/**
 * ETC from workload when any workload count is set:
 * To Do × 1.5 + In Progress × 1 + Code Review × 0.5 + QA Review × 0.25.
 * (Closed is tracked for reporting only; it does not add to ETC.)
 */
function workloadEtcSum(issue) {
  if (!issueShouldComputeTarget(issue)) return null;
  return (
    effectiveWorkloadTodo(issue) * 1.5 +
    effectiveWorkloadInProgress(issue) * 1 +
    effectiveWorkloadCodeReview(issue) * 0.5 +
    effectiveWorkloadQaReview(issue) * 0.25
  );
}

function resolvedEtcNumeric(issue) {
  const w = workloadEtcSum(issue);
  if (w != null) return w;
  if (issue.etc != null && issue.etc !== '') {
    const n = Number(issue.etc);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

/** % complete = (EAF − ETC) / EAF when both known and EAF &gt; 0; else stored percentComplete. */
function resolvedPercentNumeric(issue) {
  const etcN = resolvedEtcNumeric(issue);
  const eafN = issue.eaf != null ? Number(issue.eaf) : NaN;
  if (
    etcN != null &&
    !Number.isNaN(etcN) &&
    !Number.isNaN(eafN) &&
    eafN > 0
  ) {
    const pct = ((eafN - etcN) / eafN) * 100;
    return Math.round(Math.min(100, Math.max(0, pct)));
  }
  if (issue.percentComplete != null) {
    const p = Number(issue.percentComplete);
    return Number.isNaN(p)
      ? null
      : Math.round(Math.min(100, Math.max(0, p)));
  }
  return null;
}

function formatEtcHumanLike(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  const x = Number(n);
  return Number.isInteger(x) ? String(x) : String(Math.round(x * 100) / 100);
}

/** Strips trailing "(override)" from manual target labels shown in the Target column. */
function displayTargetLabel(raw) {
  if (raw == null) return '';
  let s = String(raw)
    .trim()
    .replace(/\s*\(override\)\s*$/i, '')
    .trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) {
    const y = +iso[1];
    const mo = +iso[2];
    const d = +iso[3];
    return `${mo}/${d}/${y}`;
  }
  return s;
}

/** Formats a computed target as calendar date only (narrow column — no weekday). */
function formatTargetDateNumeric(d) {
  return stripLocalDate(d).toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric'
  });
}

/**
 * Target label for one Jira row: explicit targetDate replaces workload Wednesdays when present
 * (vendor blocks, steering commitments).
 */
function issueTargetDisplayString(issue, referenceDate) {
  if (issue.targetDate != null && String(issue.targetDate).trim() !== '') {
    return displayTargetLabel(String(issue.targetDate).trim());
  }
  if (referenceDate != null && issueShouldComputeTarget(issue)) {
    const units = workloadEtcSum(issue);
    if (units == null) return '';
    const d = computedReleaseWednesday(units, referenceDate);
    return formatTargetDateNumeric(d);
  }
  return '';
}

function formatIssueTracking(issue, opts = {}) {
  const includeIssueDates = opts.includeIssueDates !== false;
  const href = `${jiraBrowsePrefix()}${issue.key}`;
  const pctN = resolvedPercentNumeric(issue);
  const pct = pctN != null ? `${pctN}%` : '';
  const etcN = resolvedEtcNumeric(issue);
  const etc = etcN != null ? `${etcN} ETC` : '';
  const parts = [pct, etc].filter(Boolean);
  let suffix = parts.length ? ` (${parts.join(', ')})` : '';
  if (includeIssueDates) {
    let td = '';
    if (opts.referenceDateForTargets instanceof Date && !Number.isNaN(opts.referenceDateForTargets.getTime())) {
      td = issueTargetDisplayString(issue, opts.referenceDateForTargets);
    } else if (issue.targetDate != null && String(issue.targetDate).trim() !== '') {
      td = displayTargetLabel(String(issue.targetDate).trim());
    }
    if (td) suffix += ` — ${td}`;
  }
  return `<div class="jira-lines"><code><a href="${esc(href)}">${esc(issue.key)}</a></code>${esc(suffix)}</div>`;
}

/** Product Jira column: key, % and ETC only — dates moved to Target column. */
function issueTrackingCompact(issue) {
  return formatIssueTracking(issue, { includeIssueDates: false });
}

function formatEafHuman(n) {
  if (n == null || n === '') return null;
  const x = Number(n);
  if (Number.isNaN(x)) return null;
  return Number.isInteger(x) ? String(x) : String(Math.round(x * 100) / 100);
}

/** Linked issue key(s); used in Feature column when split layout (no EAF). */
function renderJiraIssueKeyLinks(issues = []) {
  return issues
    .map((issue) => {
      const href = `${jiraBrowsePrefix()}${issue.key}`;
      return `<div class="jira-lines feature-issue-links__line"><code><a href="${esc(href)}">${esc(issue.key)}</a></code></div>`;
    })
    .join('');
}

/** Project EAF (Cached) from Jira (stored as issue.eaf) — MCP + `npm run jira:eaf -- --patch`, or REST `npm run jira:eaf`. */
function renderEafColumn(issues = []) {
  if (!issues.length) return '—';
  return issues
    .map((issue) => {
      const v = formatEafHuman(issue.eaf);
      const display = v != null ? v : '—';
      return `<div class="jira-metric">${esc(display)}</div>`;
    })
    .join('');
}

/** Feature name (+ links); optional stacked Jira keys under title for In Dev split columns. */
function renderFeatureCell(row, appendIssueLinks = false) {
  const title = `${esc(row.name)} ${linksHtml(row.links || [])}`;
  if (!appendIssueLinks) {
    return `<td class="col-name">${title}</td>`;
  }
  const keysHtml = renderJiraIssueKeyLinks(row.jiraIssues || []);
  if (!keysHtml) {
    return `<td class="col-name">${title}</td>`;
  }
  return `<td class="col-name"><div class="feature-cell-title">${title}</div><div class="feature-issue-links">${keysHtml}</div></td>`;
}

/** In Development: fixed Project column order (see PLAYBOOK), then subgroup/name within band. */
function inDevProjectGroupRank(projectGroup) {
  const g = String(projectGroup ?? '').trim().toLowerCase();
  if (g === 'trackers') return 0;
  if (g === 'integration' || g === 'device integration') return 1;
  if (g === 'other') return 2;
  if (g === 'ops' || g === 'ops platform improvements') return 3;
  return 999;
}

function sortInDevRows(rows = []) {
  return [...rows].sort((a, b) => {
    const ga = String(a.projectGroup ?? '').trim();
    const gb = String(b.projectGroup ?? '').trim();
    const ra = inDevProjectGroupRank(ga);
    const rb = inDevProjectGroupRank(gb);
    if (ra !== rb) return ra - rb;
    const gal = ga.toLowerCase();
    const gbl = gb.toLowerCase();
    const cg = gal.localeCompare(gbl, undefined, { sensitivity: 'base' });
    if (cg !== 0) return cg;
    const na = String(a.name ?? '').trim();
    const nb = String(b.name ?? '').trim();
    const cn = na.localeCompare(nb, undefined, { sensitivity: 'base' });
    if (cn !== 0) return cn;
    return String(a.id ?? '').localeCompare(String(b.id ?? ''));
  });
}

function computeProjectGroupSpans(rows = []) {
  const spans = [];
  let i = 0;
  while (i < rows.length) {
    const g =
      rows[i].projectGroup != null
        ? String(rows[i].projectGroup).trim()
        : '';
    if (!g) {
      spans.push(1);
      i += 1;
      continue;
    }
    let j = i + 1;
    while (
      j < rows.length &&
      String(rows[j].projectGroup ?? '').trim() === g
    ) {
      j += 1;
    }
    const len = j - i;
    spans.push(len);
    for (let k = 1; k < len; k += 1) {
      spans.push(-1);
    }
    i = j;
  }
  return spans;
}

function renderInDevProductRows(rows, opts) {
  const { hideStatusColumn, statusUpdateOpts, referenceDateForTargets } = opts;
  const sorted = sortInDevRows(rows || []);
  const spans = computeProjectGroupSpans(sorted);
  return sorted
    .map((row, idx) => {
      const owners = esc((row.owners || []).join(' | ') || '');
      const issues = row.jiraIssues || [];
      const pctCell = `<td class="col-pct-complete">${renderPercentCompleteColumn(issues)}</td>`;
      const etcCell = `<td class="col-etc">${renderEtcColumn(issues)}</td>`;
      const eafCell = `<td class="col-eaf">${renderEafColumn(issues)}</td>`;
      const statusCell = `<td class="col-product-status">${renderProductStatusCell(row)}</td>`;
      const statusUpdatesCell = `<td class="col-status-updates">${renderStatusUpdatesNarrativeOnly(row, statusUpdateOpts)}</td>`;
      const projMark = spans[idx];
      let projectTd = '';
      if (projMark >= 1) {
        const pg = row.projectGroup != null ? String(row.projectGroup).trim() : '';
        projectTd = `<td class="col-project-group" rowspan="${projMark}">${esc(pg)}</td>`;
      }
      return `<tr class="product-row">
      ${projectTd}
      ${renderFeatureCell(row, true)}
      <td class="cell-owners">${owners}</td>
      ${hideStatusColumn ? '' : statusCell}
      ${statusUpdatesCell}
      ${etcCell}${pctCell}${eafCell}
      <td class="col-product-target">${renderProductTargetCell(row, referenceDateForTargets)}</td>
    </tr>`;
    })
    .join('');
}

function renderPercentCompleteColumn(issues = []) {
  if (!issues.length) return '—';
  return issues
    .map((issue) => {
      const pctN = resolvedPercentNumeric(issue);
      const pct = pctN != null ? `${pctN}%` : '—';
      return `<div class="jira-metric">${esc(pct)}</div>`;
    })
    .join('');
}

function renderEtcColumn(issues = []) {
  if (!issues.length) return '—';
  return issues
    .map((issue) => {
      const n = resolvedEtcNumeric(issue);
      const v = n != null ? formatEtcHumanLike(n) : null;
      return `<div class="jira-metric">${esc(v ?? '—')}</div>`;
    })
    .join('');
}

/** Roll-up label for Status when statusLabel omitted (derive from stages). */
function stageRollupText(row) {
  const stages = row.statusStages;
  if (!stages?.length) return '';
  const order = ['done', 'in_progress', 'next'];
  const labels = {
    done: 'Released',
    in_progress: 'In progress',
    next: 'Planned'
  };
  const unique = [...new Set(stages.map((s) => s.stage))].sort(
    (a, b) => order.indexOf(a) - order.indexOf(b)
  );
  return unique.map((k) => labels[k] || k).join(' · ');
}

/** Narrative HTML for the product Status updates column (`col-status-updates`). */
function renderStatusUpdatesNarrativeOnly(row, opts = {}) {
  if (opts.flatStages && row.statusStages && row.statusStages.length) {
    const all = row.statusStages.flatMap((s) => s.bullets || []).filter(Boolean);
    let html = all.length
      ? `<ul class="tight">${all.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`
      : '';
    if (row.meetingNotes) {
      html += `<div class="notes-addendum"><div>${esc(row.meetingNotes)}</div></div>`;
    }
    return html || '—';
  }

  let html = '';

  if (row.statusStages && row.statusStages.length) {
    for (const stage of row.statusStages) {
      const label =
        stage.stage === 'done'
          ? 'Done / released'
          : stage.stage === 'in_progress'
            ? 'In progress'
            : 'Not started / next';
      const bullets =
        stage.bullets && stage.bullets.length
          ? `<ul class="tight">${stage.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`
          : '';
      html += `<div class="stage-block"><span class="stage-tag">${esc(label)}</span>${bullets}</div>`;
    }
  } else if (row.bullets && row.bullets.length) {
    html = `<ul class="tight">${row.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`;
  }

  if (row.meetingNotes) {
    html += `<div class="notes-addendum"><div>${esc(row.meetingNotes)}</div></div>`;
  }

  return html || '—';
}

function renderProductStatusCell(row) {
  if (row.statusLabel && String(row.statusLabel).trim()) {
    const cls = String(row.statusLabel).toLowerCase().includes('live')
      ? 'chip-live'
      : 'chip-dev';
    return `<span class="chip ${cls}">${esc(row.statusLabel)}</span>`;
  }
  const rollup = stageRollupText(row);
  if (!rollup) {
    return '—';
  }
  return `<span class="chip chip-rollup">${esc(rollup)}</span>`;
}

function renderProductTargetCell(row, referenceDateForTargets) {
  const rowTarget =
    row.targetDate != null && String(row.targetDate).trim() !== ''
      ? displayTargetLabel(String(row.targetDate).trim())
      : '';

  const issues = row.jiraIssues || [];
  const parts = [];
  if (rowTarget) {
    parts.push(`<div class="target-feature">${esc(rowTarget)}</div>`);
  }
  if (issues.length) {
    parts.push(
      `<div class="target-issue-dates">${issues
        .map((issue) => {
          const lbl = issueTargetDisplayString(
            issue,
            referenceDateForTargets
          );
          const d = esc(lbl || '—');
          return `<div class="target-date-line">${d}</div>`;
        })
        .join('')}</div>`
    );
  }

  if (!parts.length) {
    return '—';
  }
  return `<div class="product-target">${parts.join('')}</div>`;
}

function renderProductRow(row, opts = {}) {
  const {
    hideStatusColumn = false,
    statusUpdateOpts = {},
    splitJiraMetrics = false,
    hideJiraColumn = false,
    hideTargetColumn = false,
    referenceDateForTargets
  } = opts;
  const owners = esc((row.owners || []).join(' | ') || '');
  const issues = row.jiraIssues || [];

  let jiras = '';
  let pctCell = '';
  let etcCell = '';
  let eafCell = '';
  let featureTd;
  if (splitJiraMetrics) {
    featureTd = renderFeatureCell(row, true);
    eafCell = `<td class="col-eaf">${renderEafColumn(issues)}</td>`;
    pctCell = `<td class="col-pct-complete">${renderPercentCompleteColumn(issues)}</td>`;
    etcCell = `<td class="col-etc">${renderEtcColumn(issues)}</td>`;
  } else {
    featureTd = renderFeatureCell(row, false);
    jiras =
      issues.length > 0
        ? issues.map((issue) => issueTrackingCompact(issue)).join('')
        : '—';
  }

  const statusCell = `<td class="col-product-status">${renderProductStatusCell(row)}</td>`;
  const statusUpdatesCell = `<td class="col-status-updates">${renderStatusUpdatesNarrativeOnly(row, statusUpdateOpts)}</td>`;

  return `<tr class="product-row">
      ${featureTd}
      <td class="cell-owners">${owners}</td>
      ${hideStatusColumn ? '' : statusCell}
      ${statusUpdatesCell}
      ${splitJiraMetrics ? '' : hideJiraColumn ? '' : `<td class="col-jira">${jiras}</td>`}
      ${splitJiraMetrics ? `${etcCell}${pctCell}${eafCell}` : ''}
      ${hideTargetColumn ? '' : `<td class="col-product-target">${renderProductTargetCell(row, referenceDateForTargets)}</td>`}
    </tr>`;
}

function renderClientRow(row, showServiceCol, referenceDateForTargets) {
  const owners = esc((row.owners || []).join(' | ') || '');
  let bullets =
    row.bullets && row.bullets.length
      ? `<ul class="tight">${row.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`
      : '';
  let jiras = '';
  if (row.jiraIssues && row.jiraIssues.length) {
    jiras = row.jiraIssues
      .map((i) =>
        formatIssueTracking(i, { referenceDateForTargets })
      )
      .join('');
  }
  if (row.meetingNotes) {
    bullets += `<div class="notes-addendum"><p>${esc(row.meetingNotes)}</p></div>`;
  }
  const avail =
    row.availabilityNotes != null && String(row.availabilityNotes).trim() !== ''
      ? String(row.availabilityNotes).trim()
      : '';
  const tgt = displayTargetLabel(row.targetDate || '').trim();
  const timelineRaw = avail || tgt || '—';
  const timeline = esc(timelineRaw);
  const svcRaw =
    row.serviceTier != null && String(row.serviceTier).trim() !== ''
      ? String(row.serviceTier).trim()
      : '—';
  const svc = esc(svcRaw);

  if (showServiceCol) {
    return `<tr><td class="col-client-name">${esc(row.name)} ${linksHtml(row.links || [])}</td><td class="col-service-cell">${svc}</td><td class="cell-owners col-client-owners">${owners}</td><td class="col-status-updates">${bullets}${jiras}</td><td class="col-client-timeline">${timeline}</td></tr>`;
  }
  return `<tr><td class="col-client-name">${esc(row.name)} ${linksHtml(row.links || [])}</td><td class="cell-owners col-client-owners">${owners}</td><td class="col-status-updates">${bullets}${jiras}</td><td class="col-client-timeline">${timeline}</td></tr>`;
}

function renderSection(section, kind, meta = {}) {
  const th = themeClass(section.theme);
  const referenceDateForTargets = resolveTargetReferenceDate(meta);
  if (kind === 'product') {
    const hideStatusColumn =
      section.id === 'live_ai_features' ||
      section.id === 'in_dev' ||
      section.id === 'in_design';
    const splitJiraMetrics = section.id === 'in_dev';
    const noJiraColumn =
      section.id === 'in_design' || section.id === 'live_ai_features';
    const tableMod = [
      hideStatusColumn ? 'status-table-product--no-status' : '',
      splitJiraMetrics ? 'status-table-product--in-dev-metrics' : '',
      hideStatusColumn && noJiraColumn ? 'status-table-product--no-jira' : ''
    ]
      .filter(Boolean)
      .join(' ');
    const tableClass = `status-table status-table-product${tableMod ? ` ${tableMod}` : ''}`;
    const statusHead = hideStatusColumn
      ? ''
      : '<th class="col-product-status">Status</th>';
    const pctEtcHead =
      splitJiraMetrics
        ? '<th class="col-etc">ETC</th><th class="col-pct-complete">% Cmp.</th><th class="col-eaf">EAF</th>'
        : '';
    const projectHead = splitJiraMetrics
      ? '<th class="col-project-group">Project</th>'
      : '';
    let productRowOpts;
    if (hideStatusColumn && section.id === 'live_ai_features') {
      productRowOpts = {
        hideStatusColumn: true,
        statusUpdateOpts: { flatStages: true },
        hideJiraColumn: true,
        referenceDateForTargets
      };
    } else if (hideStatusColumn && splitJiraMetrics) {
      productRowOpts = {
        hideStatusColumn: true,
        statusUpdateOpts: {},
        splitJiraMetrics: true,
        referenceDateForTargets
      };
    } else if (hideStatusColumn && section.id !== 'live_ai_features') {
      productRowOpts = {
        hideStatusColumn: true,
        statusUpdateOpts: {},
        hideJiraColumn: section.id === 'in_design',
        hideTargetColumn: section.id === 'in_design',
        referenceDateForTargets
      };
    } else {
      productRowOpts = { referenceDateForTargets };
    }

    const jiraOrEafHead = splitJiraMetrics
      ? ''
      : noJiraColumn
        ? ''
        : '<th class="col-jira">Jira</th>';

    const productTbodyHtml =
      section.id === 'in_dev'
        ? renderInDevProductRows(section.rows || [], {
            hideStatusColumn,
            statusUpdateOpts: {},
            referenceDateForTargets
          })
        : (section.rows || [])
            .map((r) => renderProductRow(r, productRowOpts))
            .join('');

    const targetHead =
      section.id === 'in_design'
        ? ''
        : '<th class="col-product-target">Target</th>';

    return `
    <section class="report-section band ${th}">
      <div class="section-banner ${th}">${esc(section.label)}</div>
      <table class="${tableClass}">
        <thead>
          <tr>
            ${splitJiraMetrics ? projectHead : ''}
            <th class="col-name">Feature</th>
            <th class="col-owner">Owner</th>
            ${statusHead}
            <th class="col-status-updates">Status updates</th>
            ${jiraOrEafHead}
            ${pctEtcHead}
            ${targetHead}
          </tr>
        </thead>
        <tbody>
        ${productTbodyHtml}
        </tbody>
      </table>
    </section>`;
  }

  const showServiceCol = true;
  const head = `<tr><th class="col-client-name">Name</th><th class="col-service">Service</th><th class="col-client-owners">Owner</th><th class="col-status-updates">Status updates</th><th class="col-client-timeline">Timeline / Availability</th></tr>`;

  const bodyRows = section.rows.map((r) =>
    renderClientRow(r, showServiceCol, referenceDateForTargets)
  );

  const clientTableMod = 'status-table-client';

  return `
  <section class="report-section band ${th}">
    <div class="section-banner ${th}">${esc(section.label)}</div>
    <table class="status-table ${clientTableMod}"><thead>${head}</thead><tbody>${bodyRows.join('')}</tbody></table>
  </section>`;
}

function formatReportDate(meta) {
  const raw = meta?.generatedAt;
  const cal = raw ? calendarDateFromIsoPrefix(raw) : null;
  const d = cal ?? (raw ? new Date(raw) : new Date());
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  return stripLocalDate(d).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function buildHtml(data) {
  const meta = data.meta || {};
  const prod = data.productReport;
  const cli = data.clientReport;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(prod?.title)} & ${esc(cli?.title)}</title>
  <link rel="stylesheet" href="../styles/report.css" />
</head>
<body>
  <article class="page">

    <header class="report-header">
      <h1>${esc(prod.title)}</h1>
      <span class="meta-line">Last Updated: ${esc(formatReportDate(meta))}</span>
    </header>

    ${(prod.sections || []).map((s) => renderSection(s, 'product', meta)).join('\n')}

    <div class="client-report">
    <hr style="margin: 2rem 0; border: none; border-top: 2px dashed #ddd" />

    <header class="report-header">
      <h1>${esc(cli.title)}</h1>
    </header>

    ${(cli.sections || []).map((s) => renderSection(s, 'client', meta)).join('\n')}
    </div>

    <footer class="confidential">\u00a9 NexJ Health Inc. Confidential and Proprietary. &mdash; Status export for internal distribution.</footer>
  </article>
</body>
</html>`;
}

const data = loadMerged(INPUT);
const inputRel = path.relative(ROOT, INPUT).replace(/\\/g, '/');
let inputMtime = '';
try {
  inputMtime = new Date(fs.statSync(INPUT).mtimeMs).toISOString();
} catch {
  /* ignore */
}
console.log(
  `Read ${inputRel}${inputMtime ? ` (modified ${inputMtime})` : ''} · ${inputPickReason}`
);
fs.mkdirSync(DIST, { recursive: true });
let html = buildHtml(data);
html = html.replace(
  '<body>',
  `<body>\n<!-- merged input: ${esc(inputRel)} · file mtime ${esc(inputMtime || 'unknown')} · pick: ${esc(inputPickReason)} · built ${esc(new Date().toISOString())} -->`
);
// Embed CSS for portable single-file copy (Teams email attach / SharePoint upload)
const cssPath = path.join(ROOT, 'styles', 'report.css');
if (fs.existsSync(cssPath)) {
  const css = fs.readFileSync(cssPath, 'utf8');
  html = html.replace(
    '<link rel="stylesheet" href="../styles/report.css" />',
    `<style>\n${css}\n</style>`
  );
}
fs.writeFileSync(OUT_FILE, html, 'utf8');
console.log(`Wrote ${OUT_FILE}`);
