/**
 * Benchmark all API endpoints.
 * Usage: node scripts/benchmark.mjs
 * Requires server running on localhost:8000
 */
import http from 'node:http';

const BASE = 'http://localhost:8000';
const EMAIL = 'joehaddad94@gmail.com';
const RUNS = 5;

function req(method, path, body, cookie) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const options = {
      hostname: 'localhost', port: 8000,
      path, method,
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const start = Date.now();
    const r = http.request(options, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        resolve({ ms: Date.now() - start, status: res.statusCode, body: raw });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function bench(label, path, cookie) {
  // warmup
  await req('GET', path, undefined, cookie);
  const times = [];
  for (let i = 0; i < RUNS; i++) {
    const { ms } = await req('GET', path, undefined, cookie);
    times.push(ms);
  }
  times.sort((a, b) => a - b);
  const min = times[0];
  const max = times[times.length - 1];
  const avg = Math.round(times.reduce((s, v) => s + v, 0) / times.length);
  const p50 = times[Math.floor(RUNS / 2)];
  return { label, min, p50, avg, max };
}

// ─── main ────────────────────────────────────────────────────────────────────
const session = await req('POST', '/auth/dev-session', { email: EMAIL });
const cookieHeader = session.status === 200
  ? (session.body, (() => {
      // We need to get the Set-Cookie from response headers — redo with headers capture
      return null;
    })())
  : null;

// Re-do the session request capturing headers
function reqWithHeaders(method, path, body, cookie) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const options = {
      hostname: 'localhost', port: 8000,
      path, method,
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const start = Date.now();
    const r = http.request(options, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        resolve({ ms: Date.now() - start, status: res.statusCode, body: raw, headers: res.headers });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const sessionRes = await reqWithHeaders('POST', '/auth/dev-session', { email: EMAIL });
const setCookies = sessionRes.headers['set-cookie'] ?? [];
const cookie = setCookies.map(c => c.split(';')[0]).join('; ');
if (!cookie) { console.error('No session cookie returned'); process.exit(1); }
console.log('Session cookie obtained.\n');

// Get workspace ID
const wsRes = await reqWithHeaders('GET', '/workspaces', undefined, cookie);
const wsJson = JSON.parse(wsRes.body);
const wsId = wsJson.workspaces?.[0]?.id ?? wsJson[0]?.id;
if (!wsId) { console.error('No workspace found:', wsRes.body); process.exit(1); }
console.log(`Workspace ID: ${wsId}\n`);

// Get a task, project, note ID
const [tasksRes, projRes, notesRes] = await Promise.all([
  reqWithHeaders('GET', `/workspaces/${wsId}/tasks?limit=1`, undefined, cookie),
  reqWithHeaders('GET', `/workspaces/${wsId}/projects?limit=1`, undefined, cookie),
  reqWithHeaders('GET', `/workspaces/${wsId}/notes?limit=1`, undefined, cookie),
]);
const taskId = JSON.parse(tasksRes.body).tasks?.[0]?.id;
const projId = JSON.parse(projRes.body).projects?.[0]?.id;
const noteId = JSON.parse(notesRes.body).notes?.[0]?.id;

// ─── Run benchmarks ───────────────────────────────────────────────────────────
const endpoints = [
  ['/health', null],
  ['/auth/me', cookie],
  ['/notifications/vapid-public-key', cookie],
  [`/workspaces/${wsId}/notifications/unread-count`, cookie],
  ['/workspaces', cookie],
  [`/workspaces/${wsId}`, cookie],
  ['/calendar-connections', cookie],
  [`/workspaces/${wsId}/members`, cookie],
  [`/workspaces/${wsId}/task-statuses`, cookie],
  [`/workspaces/${wsId}/tags`, cookie],
  [`/workspaces/${wsId}/analytics`, cookie],
  [`/workspaces/${wsId}/notifications`, cookie],
  [`/workspaces/${wsId}/notes`, cookie],
  [`/workspaces/${wsId}/projects`, cookie],
  ['/notifications/settings', cookie],
  [`/workspaces/${wsId}/tasks`, cookie],
  ...(taskId ? [[`/workspaces/${wsId}/tasks/${taskId}`, cookie]] : []),
  ...(projId ? [[`/workspaces/${wsId}/projects/${projId}`, cookie]] : []),
  ...(noteId ? [[`/workspaces/${wsId}/notes/${noteId}`, cookie]] : []),
];

const results = [];
for (const [path, c] of endpoints) {
  process.stdout.write(`Benchmarking ${path}...`);
  const r = await bench(path, path, c);
  results.push(r);
  console.log(` min=${r.min}ms p50=${r.p50}ms avg=${r.avg}ms max=${r.max}ms`);
}

// ─── Print markdown table ─────────────────────────────────────────────────────
console.log('\n\n## Results\n');
console.log('| Endpoint | Min | P50 | Avg | Max |');
console.log('|---|---:|---:|---:|---:|');
for (const r of results) {
  console.log(`| \`${r.label}\` | ${r.min}ms | ${r.p50}ms | ${r.avg}ms | ${r.max}ms |`);
}
