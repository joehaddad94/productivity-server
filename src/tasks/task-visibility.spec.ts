import { buildTaskVisibilityWhere, buildTaskRelevanceWhere } from './task-visibility';

const USER = 'user-1';

describe('buildTaskVisibilityWhere', () => {
  describe('owner / admin', () => {
    for (const role of ['owner', 'admin'] as const) {
      it(`${role} can see tasks they created, assigned to others, OR are assigned to`, () => {
        const where = buildTaskVisibilityWhere(USER, role, false);

        expect(where.OR).toEqual(
          expect.arrayContaining([
            { creatorId: USER },
            { assignees: { some: { assignedById: USER } } },
            { assignees: { some: { userId: USER } } },
          ]),
        );
      });

      // Regression: an owner/admin assigned a task by someone else must still see it.
      // Previously the filter only matched creatorId / assignedById, so admin
      // assignees were filtered out of list(), findOne() (404), reorder, and bulk.
      it(`${role} assigned by someone else matches via the assignee branch`, () => {
        const where = buildTaskVisibilityWhere(USER, role, false);

        expect(where.OR).toContainEqual({
          assignees: { some: { userId: USER } },
        });
      });
    }
  });

  describe('member', () => {
    it('with canSeeAllTasks=true sees everything (empty filter)', () => {
      expect(buildTaskVisibilityWhere(USER, 'member', true)).toEqual({});
    });

    it('with canSeeAllTasks=false sees tasks they created OR are assigned to', () => {
      const where = buildTaskVisibilityWhere(USER, 'member', false);

      expect(where.OR).toEqual([
        { creatorId: USER },
        { assignees: { some: { userId: USER } } },
      ]);
    });
  });
});

describe('buildTaskRelevanceWhere', () => {
  it('matches creator, assignee, and assigner', () => {
    const where = buildTaskRelevanceWhere(USER);

    expect(where.OR).toEqual([
      { creatorId: USER },
      { assignees: { some: { userId: USER } } },
      { assignees: { some: { assignedById: USER } } },
    ]);
  });
});
