/**
 * Test connectivity to Grafana Cloud OTLP endpoint.
 * Loads .env.local and .env, then POSTs to the traces endpoint.
 *
 * Expected: 400 = endpoint reachable and auth OK (Grafana returns 400 for empty/invalid body).
 * 401 = bad credentials. Connection errors = firewall/proxy/DNS.
 *
 * Usage: node scripts/test-otlp-connection.mjs
 *        npm run otel:test-connection
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv('.env.local');
loadEnv('.env');

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const headersEnv = process.env.OTEL_EXPORTER_OTLP_HEADERS || '';

if (!endpoint) {
  console.error('OTEL_EXPORTER_OTLP_ENDPOINT is not set. Set it in .env.local (e.g. from Grafana Cloud Configure).');
  process.exit(1);
}

// OTLP HTTP traces path: base is e.g. https://otlp-gateway-prod-eu-central-0.grafana.net/otlp
const base = endpoint.replace(/\/$/, '');
const tracesUrl = base + (base.endsWith('/v1/traces') ? '' : '/v1/traces');

const headers = { 'Content-Type': 'application/json' };
if (headersEnv) {
  for (const part of headersEnv.split(',')) {
    const i = part.indexOf('=');
    if (i > 0) {
      const k = part.slice(0, i).trim();
      let v = part.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      headers[k] = decodeURIComponent(v);
    }
  }
}

console.log('Testing OTLP connectivity...');
console.log('Endpoint:', tracesUrl);

async function run() {
  try {
    const res = await fetch(tracesUrl, {
      method: 'POST',
      headers,
      body: '{}',
    });
    const status = res.status;
    const text = await res.text();
    if (status === 400) {
      console.log('Result: 400 Bad Request – endpoint is reachable and auth is OK (Grafana returns 400 for invalid/empty body).');
      return 0;
    }
    if (status === 200 || status === 202) {
      console.log('Result:', status, '– connection and auth OK.');
      return 0;
    }
    if (status === 401) {
      console.error('Result: 401 Unauthorized – check OTEL_EXPORTER_OTLP_HEADERS (token/Base64 credentials).');
      if (text) console.error('Body:', text.slice(0, 200));
      return 1;
    }
    if (status === 403) {
      console.error('Result: 403 Forbidden – token may lack metrics:write/traces:write or stack mismatch.');
      if (text) console.error('Body:', text.slice(0, 200));
      return 1;
    }
    console.error('Result:', status, text ? text.slice(0, 300) : '');
    return 1;
  } catch (err) {
    console.error('Connection failed:', err.message);
    console.error('');
    console.error('If on a corporate network, try:');
    console.error('  HTTPS_PROXY=http://your-proxy:port node scripts/test-otlp-connection.mjs');
    console.error('For local SSL issues (debug only):');
    console.error('  NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/test-otlp-connection.mjs');
    return 1;
  }
}

run().then((code) => process.exit(code));
