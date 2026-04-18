/**
 * Pushes a starter API performance dashboard to Grafana Cloud.
 * Uses Grafana HTTP API + datasource auto-detection.
 *
 * Usage:
 *   npm run grafana:sync-dashboard
 *
 * Required env:
 *   GRAFANA_URL=https://<your-stack>.grafana.net
 *   GRAFANA_API_TOKEN=<Grafana token with dashboards:write + datasources:read>
 *
 * Optional env:
 *   OTEL_SERVICE_NAME=tasky-server
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function loadEnv(path) {
  const full = resolve(root, path);
  if (!existsSync(full)) return;
  const content = readFileSync(full, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function ensureTrailingSlashRemoved(url) {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function replaceAll(template, token, value) {
  return template.split(token).join(value);
}

async function grafanaApi(url, token, path, options = {}) {
  const res = await fetch(`${url}${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const details = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`Grafana API ${options.method || 'GET'} ${path} failed (${res.status}): ${details}`);
  }

  return data;
}

async function run() {
  loadEnv('.env.local');
  loadEnv('.env');

  const grafanaUrl = ensureTrailingSlashRemoved(process.env.GRAFANA_URL || process.env.GRAFANA_CLOUD_URL || '');
  const grafanaToken = process.env.GRAFANA_API_TOKEN || '';
  const serviceName = process.env.OTEL_SERVICE_NAME || 'tasky-server';

  if (!grafanaUrl) {
    throw new Error('Missing GRAFANA_URL (example: https://<your-stack>.grafana.net)');
  }
  if (!grafanaToken) {
    throw new Error('Missing GRAFANA_API_TOKEN (needs dashboards:write and datasources:read)');
  }

  const dataSources = await grafanaApi(grafanaUrl, grafanaToken, '/api/datasources');
  const prom = dataSources.find((ds) => ds.type === 'prometheus');
  if (!prom) {
    throw new Error('No Prometheus datasource found in Grafana workspace.');
  }

  const templatePath = resolve(root, 'grafana', 'dashboards', 'tasky-api-performance.template.json');
  const templateRaw = readFileSync(templatePath, 'utf8');
  const rendered = replaceAll(
    replaceAll(templateRaw, '__PROM_UID__', prom.uid),
    '__SERVICE_NAME__',
    serviceName,
  );
  const dashboard = JSON.parse(rendered);

  const response = await grafanaApi(grafanaUrl, grafanaToken, '/api/dashboards/db', {
    method: 'POST',
    body: {
      dashboard,
      folderId: 0,
      overwrite: true,
      message: 'Sync Tasky API dashboard from backend repo',
    },
  });

  const dashboardUid = response?.uid || dashboard.uid;
  console.log('Dashboard synced successfully.');
  console.log(`Grafana URL: ${grafanaUrl}/d/${dashboardUid}`);
  console.log(`Prometheus datasource: ${prom.name} (${prom.uid})`);
  console.log(`Default service filter: ${serviceName}`);
}

run().catch((error) => {
  console.error('Dashboard sync failed:', error.message);
  process.exit(1);
});
