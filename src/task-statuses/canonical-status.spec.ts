import { deriveBucket, resolveBucket } from './canonical-status';
import type { WorkspaceTaskStatus } from '@prisma/client';

type Row = Pick<WorkspaceTaskStatus, 'key' | 'isTerminal'>;

describe('deriveBucket', () => {
  it('maps the built-in pending status to open', () => {
    expect(deriveBucket({ key: 'pending', isTerminal: false })).toBe('open');
  });

  it('maps the built-in in_progress status to in_progress', () => {
    expect(deriveBucket({ key: 'in_progress', isTerminal: false })).toBe(
      'in_progress',
    );
  });

  it('maps the built-in completed status to done', () => {
    expect(deriveBucket({ key: 'completed', isTerminal: true })).toBe('done');
  });

  it('maps a custom non-terminal status (key = null) to open', () => {
    expect(deriveBucket({ key: null, isTerminal: false })).toBe('open');
  });

  it('maps a custom terminal status (key = null) to done', () => {
    expect(deriveBucket({ key: null, isTerminal: true })).toBe('done');
  });

  it('treats terminal as done even if some future key were in_progress', () => {
    // isTerminal wins over key.
    expect(deriveBucket({ key: 'in_progress', isTerminal: true })).toBe('done');
  });
});

describe('resolveBucket', () => {
  const statusId = '11111111-1111-1111-1111-111111111111';
  const byId = new Map<string, Row>([
    [statusId, { key: 'in_progress', isTerminal: false }],
  ]);

  it('derives from the status row when the value is a known id', () => {
    expect(resolveBucket(statusId, byId)).toBe('in_progress');
  });

  it('falls back to legacy key mapping for bare "pending"', () => {
    expect(resolveBucket('pending', byId)).toBe('open');
  });

  it('falls back to legacy key mapping for bare "in_progress"', () => {
    expect(resolveBucket('in_progress', byId)).toBe('in_progress');
  });

  it('falls back to legacy key mapping for bare "completed"', () => {
    expect(resolveBucket('completed', byId)).toBe('done');
  });

  it('defaults an unknown, non-legacy value to open', () => {
    expect(resolveBucket('22222222-unknown', byId)).toBe('open');
  });
});
