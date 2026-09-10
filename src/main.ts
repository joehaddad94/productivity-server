import './instrumentation';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestFactory, HttpAdapterHost } from '@nestjs/core';
import { SentryGlobalFilter } from '@sentry/nestjs/setup';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as cookieParser from 'cookie-parser';
import { trace } from '@opentelemetry/api';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';

function normalizeRoute(url: string): string {
  const [pathOnly] = url.split('?');
  return pathOnly
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      ':uuid',
    )
    .replace(/\/\d+(?=\/|$)/g, '/:id');
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const httpLogger = new Logger('HTTP');
  const logger = new Logger('Bootstrap');

  app.use((req: Request, res: Response, next: NextFunction) => {
    const { method, url } = req;
    const start = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - start;
      const { statusCode } = res;
      const normalized = normalizeRoute(url);
      const isPreflight = method === 'OPTIONS';
      const isSlow = ms >= 1000;

      // Keep preflight logs compact since browsers produce many of them.
      if (isPreflight) {
        if (ms >= 200)
          httpLogger.warn(`PREFLIGHT ${normalized} ${statusCode} +${ms}ms`);
        return;
      }

      const slowTag = isSlow ? ' SLOW' : '';
      const log = `${method} ${normalized} ${statusCode} +${ms}ms${slowTag}`;
      if (statusCode >= 500) httpLogger.error(log);
      else if (statusCode >= 400 || isSlow) httpLogger.warn(log);
      else httpLogger.log(log);
    });
    next();
  });

  app.use(cookieParser());

  // Allowlist, not reflection.
  //
  // `origin: true` reflects whatever Origin the request carries. Combined with
  // `credentials: true` and an auth cookie that is SameSite=None in production,
  // that let ANY site a signed-in user visited call this API with their cookie
  // attached and read the response.
  //
  // Requests with no Origin header (server-to-server, curl, health checks, and
  // the Next.js /api proxy) are still allowed — the header is only present on
  // cross-origin browser requests, which are exactly the ones being gated.
  // Falls back to APP_URL, which production already sets to the frontend
  // origin for magic links, so a deployment that never sets CORS_ORIGINS still
  // allows its own frontend instead of locking it out.
  const allowedOrigins = (
    process.env.CORS_ORIGINS ??
    process.env.APP_URL ??
    'http://localhost:3000,http://localhost:5173'
  )
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  logger.log(`CORS allowlist: ${allowedOrigins.join(', ')}`);

  app.enableCors({
    origin(origin, callback) {
      // Deny by omitting the header rather than throwing: the browser blocks
      // the response either way, and throwing turns every probe into a 500
      // that shows up as a server error in the logs and in Sentry.
      callback(null, !origin || allowedOrigins.includes(origin));
    },
    credentials: true,
  });

  if (process.env.SENTRY_DSN) {
    const { httpAdapter } = app.get(HttpAdapterHost);
    app.useGlobalFilters(new SentryGlobalFilter(httpAdapter));
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // The full API schema is an internal document: it enumerates every route,
  // parameter and shape, which is a map for anyone probing the service. Serve
  // it outside production only, or when explicitly switched on.
  const swaggerEnabled =
    process.env.ENABLE_SWAGGER === 'true' ||
    process.env.NODE_ENV !== 'production';

  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('Tasky API')
      .setDescription('API for Tasky (notes, tasks, workspaces)')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api', app, document);
  }

  await app.listen(process.env.PORT ?? 8000);

  // One-time test span so you can verify traces in Grafana (Explore → Traces → tasky-server)
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    const tracer = trace.getTracer('tasky-server', '1.0.0');
    const span = tracer.startSpan('server-started');
    span.addEvent('hello-grafana');
    span.end();
  }
}
void bootstrap();
