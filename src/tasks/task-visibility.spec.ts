import { buildTaskVisibilityWhere, buildTaskRelevanceWhere } from './task-visibility';

const USER = 'user-1';

describe('buildTaskVisibilityWhere', () => {
  describe('owner / admin', () => {
    for (const role of ['owner', 'admin'] as const) {
      it(`${role} sees every assigned task OR tasks they created`, () => {
        const where = buildTaskVisibilityWhere(USER, role);

        expect(where.OR).toEqual([
          { assignees: { some: {} } },
          { creatorId: USER },
        ]);
      });

      // Any task with at least one assignee is visible to the whole leadership
      // layer — including tasks they neither created nor were assigned/assigned-by.
      it(`${role} matches any assigned task via the "some assignee" branch`, () => {
        const where = buildTaskVisibilityWhere(USER, role);

        expect(where.OR).toContainEqual({ assignees: { some: {} } });
      });

      // Their own unassigned (private) tasks stay visible to them.
      it(`${role} still sees their own unassigned tasks`, () => {
        const where = buildTaskVisibilityWhere(USER, role);

        expect(where.OR).toContainEqual({ creatorId: USER });
      });
    }
  });

  describe('member', () => {
    it('sees tasks they created OR are assigned to — and nothing else', () => {
      const where = buildTaskVisibilityWhere(USER, 'member');

      expect(where.OR).toEqual([
        { creatorId: USER },
        { assignees: { some: { userId: USER } } },
      ]);
    });

    it('does NOT get an empty (see-everything) filter', () => {
      const where = buildTaskVisibilityWhere(USER, 'member');

      expect(where).not.toEqual({});
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
