import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: { $queryRaw: jest.fn() } },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  describe('check', () => {
    it('returns status ok with deploy metadata', () => {
      const result = controller.check();

      expect(result).toMatchObject({ status: 'ok' });
      expect(result).toHaveProperty('commit');
      expect(result).toHaveProperty('branch');
      expect(result).toHaveProperty('environment');
    });

    it('falls back to local/unknown when Railway env vars are absent', () => {
      const prev = {
        sha: process.env.RAILWAY_GIT_COMMIT_SHA,
        branch: process.env.RAILWAY_GIT_BRANCH,
        env: process.env.RAILWAY_ENVIRONMENT_NAME,
      };
      delete process.env.RAILWAY_GIT_COMMIT_SHA;
      delete process.env.RAILWAY_GIT_BRANCH;
      delete process.env.RAILWAY_ENVIRONMENT_NAME;

      try {
        expect(controller.check()).toEqual({
          status: 'ok',
          commit: 'unknown',
          branch: 'unknown',
          environment: 'local',
        });
      } finally {
        if (prev.sha !== undefined) process.env.RAILWAY_GIT_COMMIT_SHA = prev.sha;
        if (prev.branch !== undefined) process.env.RAILWAY_GIT_BRANCH = prev.branch;
        if (prev.env !== undefined) process.env.RAILWAY_ENVIRONMENT_NAME = prev.env;
      }
    });

    it('returns the short commit SHA from RAILWAY_GIT_COMMIT_SHA', () => {
      const prev = process.env.RAILWAY_GIT_COMMIT_SHA;
      process.env.RAILWAY_GIT_COMMIT_SHA = 'a932aca1234567890abcdef';
      try {
        expect(controller.check()).toMatchObject({ commit: 'a932aca' });
      } finally {
        if (prev === undefined) delete process.env.RAILWAY_GIT_COMMIT_SHA;
        else process.env.RAILWAY_GIT_COMMIT_SHA = prev;
      }
    });
  });
});
