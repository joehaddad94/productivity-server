import { defineConfig } from 'prisma/config';

// Load .env, then .env.local so local overrides (Supabase suggests .env.local)
require('dotenv').config();
require('dotenv').config({ path: '.env.local' });

// Migrations use DIRECT_URL (direct connection); fallback to DATABASE_URL if not set
const migrateUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!migrateUrl) throw new Error('DATABASE_URL or DIRECT_URL must be set');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: migrateUrl,
  },
});
