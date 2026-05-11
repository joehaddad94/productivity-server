import './instrumentation';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
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

  app.enableCors({
    origin: true, // or set to your frontend origin(s), e.g. ['http://localhost:5173']
    credentials: true,
  });

  if (process.env.SENTRY_DSN) {
    app.useGlobalFilters(new SentryGlobalFilter());
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Tasky API')
    .setDescription('API for Tasky (notes, tasks, workspaces)')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

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
