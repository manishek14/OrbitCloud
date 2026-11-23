import { PrismaClient, Prisma } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Verbose query logging is DISABLED by default: it leaks record data into
// logs and slows every request. Enable it only through an explicit
// diagnostic environment flag (PRISMA_LOG_QUERY=1) in isolated debugging
// sessions — never in production.
const log: ('query' | 'warn' | 'error')[] =
  process.env.PRISMA_LOG_QUERY === '1'
    ? ['query', 'warn', 'error']
    : ['warn', 'error']

const databaseUrl =
  process.env.DATABASE_URL ?? process.env.DATABASE_URL_POSTGRES_PRISMA_URL

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : {}),
    log,
  })

/** Transaction-scoped Prisma client type (for services that run inside $transaction). */
export type PrismaTransactionClient = Prisma.TransactionClient

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
