import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

require('dotenv').config();
require('dotenv').config({ path: '.env.local' });

const connectionString =
  process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL or DIRECT_URL must be set');

const adapter = new PrismaPg({ connectionString, ssl: { rejectUnauthorized: false } });
const prisma = new PrismaClient({ adapter });

async function main() {
  // 1. Backfill creatorId: set to the workspace owner for all tasks without one
  const workspaces = await prisma.workspace.findMany({
    where: { deletedAt: null },
    include: {
      members: { where: { role: 'owner' } },
    },
  });

  let tasksUpdated = 0;
  for (const ws of workspaces) {
    const owner = ws.members[0];
    if (!owner) {
      console.warn(`  WARNING: workspace ${ws.id} (${ws.name}) has no owner — skipping task backfill`);
      continue;
    }
    const result = await prisma.task.updateMany({
      where: { workspaceId: ws.id, creatorId: null },
      data: { creatorId: owner.userId },
    });
    tasksUpdated += result.count;
    console.log(`  ${ws.name}: backfilled ${result.count} tasks → owner ${owner.userId}`);
  }
  console.log(`creatorId backfill complete: ${tasksUpdated} tasks updated\n`);

  // 2. Backfill canSeeAllTasks: set true for all existing members
  const membersResult = await prisma.workspaceMember.updateMany({
    where: { canSeeAllTasks: false },
    data: { canSeeAllTasks: true },
  });
  console.log(`canSeeAllTasks backfill complete: ${membersResult.count} members set to true\n`);

  // 3. Validate role values
  const invalidRoles = await prisma.workspaceMember.findMany({
    where: { role: { notIn: ['owner', 'admin', 'member'] } },
    select: { id: true, userId: true, workspaceId: true, role: true },
  });
  if (invalidRoles.length > 0) {
    console.warn(`WARNING: ${invalidRoles.length} members with invalid roles:`);
    invalidRoles.forEach(m => console.warn(`  member ${m.id}: role="${m.role}"`));
  } else {
    console.log('Role validation passed: all members have valid roles (owner/admin/member)');
  }

  // 4. Check for workspaces missing an owner
  const ownersPerWorkspace = await prisma.workspaceMember.groupBy({
    by: ['workspaceId'],
    where: { role: 'owner' },
    _count: { _all: true },
  });
  const wsWithOwner = new Set(ownersPerWorkspace.map(o => o.workspaceId));
  const missing = workspaces.map(w => w.id).filter(id => !wsWithOwner.has(id));
  if (missing.length > 0) {
    console.warn(`WARNING: workspaces with no owner member: ${missing.join(', ')}`);
  } else {
    console.log('Owner check passed: all workspaces have an owner member');
  }
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
