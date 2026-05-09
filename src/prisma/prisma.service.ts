import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    // Prefer DIRECT_URL (session-mode / direct connection) for the runtime adapter.
    // DATABASE_URL may point to the PgBouncer transaction-mode pooler (?pgbouncer=true)
    // which is incompatible with @prisma/adapter-pg's own connection pooling.
    const connectionString =
      config.get<string>('DIRECT_URL') ??
      config.getOrThrow<string>('DATABASE_URL');
    const adapter = new PrismaPg({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connection healthy');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
