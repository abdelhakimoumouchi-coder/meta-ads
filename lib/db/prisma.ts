/**
 * lib/db/prisma.ts
 *
 * Prisma client singleton.
 *
 * Next.js hot-reload creates new module instances in development, which would
 * exhaust the SQLite connection pool if we instantiated PrismaClient on every
 * module load. The standard workaround is to store the instance on `globalThis`
 * so it survives HMR.
 *
 * Reference:
 *   https://www.prisma.io/docs/guides/performance-and-optimization/connection-management#prevent-hot-reloading-from-creating-new-instances-of-prismaclient
 */

import { PrismaClient } from '@prisma/client';

// ─── Singleton factory ────────────────────────────────────────────────────────

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
