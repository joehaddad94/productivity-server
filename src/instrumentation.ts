/**
 * OpenTelemetry instrumentation – must run before any other app code.
 * Only loads when OTEL_EXPORTER_OTLP_ENDPOINT is set (e.g. Grafana Cloud).
 * Uses OTLP HTTP (not gRPC). Sends traces/metrics to the configured endpoint.
 */
import { config } from 'dotenv';
import { resolve } from 'path';

// Load env from project root (cwd when you run npm run start:dev)
const root = process.cwd();
config({ path: resolve(root, '.env.local') });
config({ path: resolve(root, '.env') });

const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
if (otelEndpoint) {
  // Step 1: Use HTTP endpoint only (not gRPC, not Prometheus remote write)
  if (!process.env.OTEL_EXPORTER_OTLP_PROTOCOL) {
    process.env.OTEL_EXPORTER_OTLP_PROTOCOL = 'http/protobuf';
  }
  // Grafana shows "undefined" unless service.name is in resource attributes – set it explicitly
  const serviceName = process.env.OTEL_SERVICE_NAME || 'tasky-server';
  process.env.OTEL_SERVICE_NAME = serviceName;
  const namespace = process.env.OTEL_SERVICE_NAMESPACE || 'tasky';
  const envName =
    process.env.OTEL_DEPLOYMENT_ENVIRONMENT ||
    process.env.NODE_ENV ||
    'development';
  const existing = process.env.OTEL_RESOURCE_ATTRIBUTES || '';
  const resourceAttrs = [
    `service.name=${serviceName}`,
    `service.namespace=${namespace}`,
    `deployment.environment=${envName}`,
  ].join(',');
  process.env.OTEL_RESOURCE_ATTRIBUTES = existing
    ? `${existing},${resourceAttrs}`
    : resourceAttrs;
  // Avoid cloud metadata lookups (AWS/GCP) that cause "MetadataLookupWarning" locally
  if (!process.env.OTEL_NODE_RESOURCE_DETECTORS) {
    process.env.OTEL_NODE_RESOURCE_DETECTORS = 'env,host,os';
  }
  console.log('[OpenTelemetry] Starting (OTLP HTTP)', {
    serviceName,
    resourceAttributes: process.env.OTEL_RESOURCE_ATTRIBUTES,
  });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@opentelemetry/auto-instrumentations-node/register');
  console.log(
    '[OpenTelemetry] Instrumentation registered – traces will appear in Grafana as service:',
    serviceName,
  );
}
