#!/usr/bin/env node
/**
 * Reads schema-conform JSON (see ../data/example-merged.json) and writes dist/status.html
 * Usage: node scripts/render.mjs [path/to/input.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const INPUT = process.argv[2] || path.join(ROOT, 'data', 'example-merged.json');
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

function issueLine(issue) {
  const prefix = process.env.JIRA_BASE_URL || 'https://your-domain.atlassian.net/browse/';
  const href = `${String(prefix).replace(/\/?$/, '/')}${issue.key}`;
  const pct = issue.percentComplete != null ? `${issue.percentComplete}%` : '';
  const etc = issue.etc != null ? `${issue.etc} ETC` : '';
  const parts = [pct, etc].filter(Boolean);
  const suffix = parts.length ? ` (${parts.join(', ')})` : '';
  return `<div class="jira-lines"><code><a href="${esc(href)}">${esc(issue.key)}</a></code>${esc(suffix)}</div>`;
}

function renderProductRow(row) {
  const owners = esc((row.owners || []).join(' | ') || '');
  let updates = '';

  if (row.statusStages && row.statusStages.length) {
    for (const stage of row.statusStages) {
      const tag =
        stage.stage === 'done'
          ? 'done'
          : stage.stage === 'in_progress'
            ? 'in-progress'
            : 'next';
      const label =
        tag === 'done'
          ? 'Done'
          : tag === 'in-progress'
            ? 'In progress'
            : 'Next';
      const bullets =
        stage.bullets && stage.bullets.length
          ? `<ul class="tight">${stage.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`
          : '';
      updates += `<div class="stage-block"><span class="stage-tag">${esc(label)}</span>${bullets}</div>`;
    }
  } else if (row.bullets && row.bullets.length) {
    updates = `<ul class="tight">${row.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`;
  }

  let jiras = '';
  if (row.jiraIssues && row.jiraIssues.length) {
    jiras = row.jiraIssues.map((i) => issueLine(i)).join('');
  }

  let meeting = '';
  if (row.meetingNotes) {
    meeting = `<div class="stage-block"><span class="stage-tag">Meeting</span><div>${esc(row.meetingNotes)}</div></div>`;
  }

  let statusCell = '';
  if (row.statusLabel) {
    const cls = String(row.statusLabel).toLowerCase().includes('live')
      ? 'chip-live'
      : 'chip-dev';
    statusCell = `<span class="chip ${cls}">${esc(row.statusLabel)}</span>`;
  }

  return `<tr class="product-row">
      <td>${esc(row.name)} ${linksHtml(row.links || [])}</td>
      <td class="cell-owners">${owners}</td>
      <td>${updates}${statusCell ? `<div>${statusCell}</div>` : ''}${jiras}${meeting}</td>
      <td>${esc(row.targetDate || '')}</td>
    </tr>`;
}
function renderClientRow(row, showServiceCol) {
  const owners = esc((row.owners || []).join(' | ') || '');
  let bullets =
    row.bullets && row.bullets.length
      ? `<ul class="tight">${row.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`
      : '';
  let jiras = '';
  if (row.jiraIssues && row.jiraIssues.length) {
    jiras = row.jiraIssues.map((i) => issueLine(i)).join('');
  }
  if (row.meetingNotes) {
    bullets += `<div class="stage-block"><span class="stage-tag">Meeting</span><p>${esc(row.meetingNotes)}</p></div>`;
  }
  let timeline =
    row.availabilityNotes != null ? esc(row.availabilityNotes) : esc(row.targetDate || '');
  const svc = esc(row.serviceTier || '');

  if (showServiceCol) {
    return `<tr><td>${esc(row.name)} ${linksHtml(row.links || [])}</td><td class="col-service-cell">${svc}</td><td class="cell-owners">${owners}</td><td>${bullets}${jiras}</td><td>${timeline}</td></tr>`;
  }
  return `<tr><td>${esc(row.name)} ${linksHtml(row.links || [])}</td><td class="cell-owners">${owners}</td><td>${bullets}${jiras}</td><td>${timeline}</td></tr>`;
}

function renderSection(section, kind) {
  const th = themeClass(section.theme);
  if (kind === 'product') {
    return `
    <section class="report-section band ${th}">
      <div class="section-banner ${th}">${esc(section.label)}</div>
      <table class="status-table">
        <thead>
          <tr>
            <th class="col-name">Feature</th>
            <th class="col-owner">Owner</th>
            <th class="col-updates">Status / detail</th>
            <th class="col-timeline">Target</th>
          </tr>
        </thead>
        <tbody>
        ${section.rows.map((r) => renderProductRow(r)).join('')}
        </tbody>
      </table>
    </section>`;
  }

  const showServiceCol = section.rows.some((r) => r.serviceTier);
  const head = showServiceCol
    ? `<tr><th>Name</th><th class="col-service">Service</th><th>Owner(s)</th><th class="col-updates">Status updates</th><th>Timeline / Availability</th></tr>`
    : `<tr><th>Name</th><th>Owner(s)</th><th class="col-updates">Status updates</th><th>Timeline / Availability</th></tr>`;

  const bodyRows = section.rows.map((r) =>
    renderClientRow(r, showServiceCol)
  );

  return `
  <section class="report-section band ${th}">
    <div class="section-banner ${th}">${esc(section.label)}</div>
    <table class="status-table"><thead>${head}</thead><tbody>${bodyRows.join('')}</tbody></table>
  </section>`;
}

function buildHtml(data) {
  const lg = data.legend || {};
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
      <span class="meta-line">Generated: ${esc(meta.generatedAt || new Date().toISOString())} — ${esc(meta.source || 'manual')}</span>
    </header>

    <div class="legend" role="note">
      <span class="item done">${esc(lg.doneLabel || 'Done / Released')}</span>
      <span class="item inprog">${esc(lg.inProgressLabel || 'In Progress')}</span>
      <span class="item next">${esc(lg.nextLabel || 'Next')}</span>
    </div>

    ${(prod.sections || []).map((s) => renderSection(s, 'product')).join('\n')}

    <hr style="margin: 2rem 0; border: none; border-top: 2px dashed #ddd" />

    <header class="report-header">
      <h1>${esc(cli.title)}</h1>
      <span class="meta-line">Jira base: ${esc(process.env.JIRA_BASE_URL || 'set JIRA_BASE_URL for clickable keys')}</span>
    </header>

    ${(cli.sections || []).map((s) => renderSection(s, 'client')).join('\n')}

    <footer class="confidential">\u00a9 Nexi Health Inc. Confidential and Proprietary. &mdash; Status export for internal distribution.</footer>
  </article>
</body>
</html>`;
}

const raw = fs.readFileSync(INPUT, 'utf8');
const data = JSON.parse(raw);
fs.mkdirSync(DIST, { recursive: true });
let html = buildHtml(data);
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
