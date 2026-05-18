/**
 * Benchmarks GET /tasks vs GET /projects to compare request times.
 * Also estimates the overhead of embedding project data in the tasks response.
 *
 * Usage: node scripts/benchmark-tasks-vs-projects.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function loadEnv(path) {
  const full = resolve(root, path);
  if (!existsSync(full)) return;
  for (const line of readFileSync(full, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnv('.env.local');
loadEnv('.env');

const BASE = 'http://localhost:8000';
const EMAIL = process.env.BENCHMARK_EMAIL || 'joehaddad94@gmail.com';
const RUNS = 8;
const WARMUP = 2;

// ── Auth ──────────────────────────────────────────────────────────────────────

async function getSessionCookie() {
  const res = await fetch(`${BASE}/auth/dev-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, name: 'Benchmark User' }),
  });
  if (!res.ok) throw new Error(`dev-session failed: ${res.status} ${await res.text()}`);
  const cookie = res.headers.get('set-cookie');
  if (!cookie) throw new Error('No cookie returned from dev-session');
  return cookie.split(';')[0];
}

async function getWorkspaceId(cookie) {
  const res = await fetch(`${BASE}/workspaces`, { headers: { Cookie: cookie } });
  if (!res.ok) throw new Error(`/workspaces failed: ${res.status}`);
  const { workspaces } = await res.json();
  if (!workspaces?.length) throw new Error('No workspaces found for this user');
  return workspaces[0].id;
}

// ── Timing helper ─────────────────────────────────────────────────────────────

async function time(fn) {
  const start = performance.now();
  const result = await fn();
  return { ms: Math.round(performance.now() - start), result };
}

async function bench(label, fn, runs = RUNS, warmup = WARMUP) {
  // warmup
  for (let i = 0; i < warmup; i++) await fn();

  const times = [];
  for (let i = 0; i < runs; i++) {
    const { ms } = await time(fn);
    times.push(ms);
  }

  times.sort((a, b) => a - b);
  const min = times[0];
  const max = times[times.length - 1];
  const p50 = times[Math.floor(times.length * 0.5)];
  const p95 = times[Math.floor(times.length * 0.95)] ?? max;
  const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);

  return { label, min, p50, avg, p95, max, times };
}

function pad(s, n) { return String(s).padStart(n); }
function row(r) {
  console.log(
    `  ${r.label.padEnd(38)} ${pad(r.min, 5)}ms  ${pad(r.p50, 5)}ms  ${pad(r.avg, 5)}ms  ${pad(r.p95, 5)}ms  ${pad(r.max, 5)}ms`
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('\nConnecting...');
const cookie = await getSessionCookie();
const workspaceId = await getWorkspaceId(cookie);
console.log(`Workspace: ${workspaceId}`);
console.log(`Warmup: ${WARMUP}  Runs: ${RUNS}\n`);

const get = (path) => fetch(`${BASE}${path}`, { headers: { Cookie: cookie } });

// Individual benchmarks
const tasksResult   = await bench('GET /tasks (current)',           () => get(`/workspaces/${workspaceId}/tasks?limit=200`));
const projectsResult = await bench('GET /projects',                 () => get(`/workspaces/${workspaceId}/projects?limit=200`));
const membersResult  = await bench('GET /members',                  () => get(`/workspaces/${workspaceId}/members`));

// Parallel baseline (what the page does today)
const parallelResult = await bench('tasks+projects+members (parallel)', async () => {
  await Promise.all([
    get(`/workspaces/${workspaceId}/tasks?limit=200`),
    get(`/workspaces/${workspaceId}/projects?limit=200`),
    get(`/workspaces/${workspaceId}/members`),
  ]);
});

// Inspect response sizes
const [tasksRes, projectsRes, membersRes] = await Promise.all([
  get(`/workspaces/${workspaceId}/tasks?limit=200`),
  get(`/workspaces/${workspaceId}/projects?limit=200`),
  get(`/workspaces/${workspaceId}/members`),
]);
const tasksBody    = await tasksRes.json();
const projectsBody = await projectsRes.json();
const membersBody  = await membersRes.json();
const taskCount    = tasksBody.tasks?.length ?? 0;
const projectCount = projectsBody.projects?.length ?? 0;
const memberCount  = membersBody.members?.length ?? 0;
const tasksWithProject  = (tasksBody.tasks ?? []).filter(t => t.projectId).length;
const tasksWithAssignee = (tasksBody.tasks ?? []).filter(t => t.assignees?.length > 0).length;

console.log(`  Tasks: ${taskCount}  (${tasksWithProject} with project, ${tasksWithAssignee} with assignees)`);
console.log(`  Projects: ${projectCount}   Members: ${memberCount}`);
console.log();
console.log(`  ${'Endpoint'.padEnd(42)} ${'Min'.padStart(5)}    ${'P50'.padStart(5)}    ${'Avg'.padStart(5)}    ${'P95'.padStart(5)}    ${'Max'.padStart(5)}`);
console.log(`  ${'-'.repeat(42)} ${'-'.repeat(5)}    ${'-'.repeat(5)}    ${'-'.repeat(5)}    ${'-'.repeat(5)}    ${'-'.repeat(5)}`);

const rowW = (r) => {
  console.log(`  ${r.label.padEnd(42)} ${pad(r.min, 5)}ms  ${pad(r.p50, 5)}ms  ${pad(r.avg, 5)}ms  ${pad(r.p95, 5)}ms  ${pad(r.max, 5)}ms`);
};
rowW(tasksResult);
rowW(projectsResult);
rowW(membersResult);
rowW(parallelResult);

console.log();
console.log('── Analysis ─────────────────────────────────────────────────────────');
console.log();

const bottleneck = Math.max(tasksResult.p50, projectsResult.p50, membersResult.p50);
console.log(`  Current page load bottleneck (parallel max P50):  ${bottleneck}ms`);
console.log(`  /tasks P50:    ${tasksResult.p50}ms`);
console.log(`  /projects P50: ${projectsResult.p50}ms  (finishes ${bottleneck - projectsResult.p50}ms before tasks)`);
console.log(`  /members P50:  ${membersResult.p50}ms  (finishes ${bottleneck - membersResult.p50}ms before tasks)`);
console.log();

// tasks already includes assignees[] with user data — members is redundant for rendering
console.log('  Key observation:');
console.log(`  /tasks response already includes assignees[].user for every task.`);
console.log(`  /members is only needed for: assignee picker dropdown + canAssign permission check.`);
console.log(`  Neither is needed to render the initial task list.`);
console.log();
console.log('  Options for /members:');
console.log(`  A) Keep parallel (current) — wastes ${bottleneck - membersResult.p50}ms idle wait`);
console.log(`  B) Defer until assignee picker opens — saves 1 request, no UX cost`);
console.log(`  C) Embed member list in /tasks response — same JOIN cost as /projects embed`);
console.log();
console.log('  Recommendation: defer /members (option B).');
console.log('  The assignee picker is interaction-driven, not needed at page paint.');
console.log('  Task rows show assignee avatars from task.assignees[] which is already in /tasks.');
