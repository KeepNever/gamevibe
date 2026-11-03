/**
 * 数据访问层的双后端驱动。
 *
 * 背景：全服务 129 处调用都是 node:sqlite 的同步 API（prepare().get/all/run）。
 * 远程数据库没有同步客户端，所以这里提供一个"形状一致但全异步"的门面：
 *
 *   const row = await db.prepare('SELECT ...').get(id)
 *
 * 调用点的改动只是前面多一个 await，SQL 原样不动。
 *
 * 后端选择：
 * - 配置了 TURSO_DATABASE_URL + TURSO_AUTH_TOKEN → Turso（libSQL over HTTPS 443）
 * - 否则 → 本地 server/db/data/gamevibe.db（离线开发、回归脚本照常可跑）
 *
 * 远程走 @libsql/client/web：纯 fetch 实现，无原生二进制依赖，
 * 沙箱这类受限环境不会因为缺 prebuild 起不来。
 */
import { createClient, type Client } from '@libsql/client/web'
import { DatabaseSync } from 'node:sqlite'

export type DbBackend = 'local' | 'turso'

export interface RunResult {
  changes: number
  lastInsertRowid: number | string | null
}

export interface GameVibeDb {
  backend: DbBackend
  prepare(sql: string): {
    get(...args: unknown[]): Promise<any>
    all(...args: unknown[]): Promise<any[]>
    run(...args: unknown[]): Promise<RunResult>
  }
  /** DDL / PRAGMA。远程后端不支持多语句之外的执行方式，只给迁移和初始化用 */
  exec(sql: string): Promise<void>
}

export const backend: DbBackend =
  process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN ? 'turso' : 'local'

// ── 本地：包一层 node:sqlite，把同步调用变成已完成的 Promise ──

function localDb(conn: DatabaseSync): GameVibeDb {
  return {
    backend: 'local',
    prepare(sql: string) {
      const stmt = conn.prepare(sql)
      return {
        async get(...args: unknown[]) {
          return stmt.get(...(args as never[]))
        },
        async all(...args: unknown[]) {
          return stmt.all(...(args as never[]))
        },
        async run(...args: unknown[]) {
          const r = stmt.run(...(args as never[]))
          return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid as number | null }
        },
      }
    },
    async exec(sql: string) {
      conn.exec(sql)
    },
  }
}

// ── 远程：libSQL HTTP 管道 ──
// 每次调用一条语句、一次往返，末尾 close，无状态。延迟见 /api/diag/db 实测。

function toPlainRows(result: Awaited<ReturnType<Client['execute']>>): any[] {
  const cols = result.columns
  return result.rows.map((row) => {
    const o: Record<string, unknown> = {}
    for (let i = 0; i < cols.length; i++) o[cols[i]] = row[i]
    return o
  })
}

function tursoDb(client: Client): GameVibeDb {
  return {
    backend: 'turso',
    prepare(sql: string) {
      return {
        async get(...args: unknown[]) {
          const r = await client.execute({ sql, args: args as never[] })
          return toPlainRows(r)[0]
        },
        async all(...args: unknown[]) {
          const r = await client.execute({ sql, args: args as never[] })
          return toPlainRows(r)
        },
        async run(...args: unknown[]) {
          const r = await client.execute({ sql, args: args as never[] })
          const id = r.lastInsertRowid
          const lastInsertRowid: number | string | null =
            typeof id === 'bigint'
              ? Number(id) <= Number.MAX_SAFE_INTEGER
                ? Number(id)
                : id.toString()
              : (id ?? null)
          return { changes: Number(r.rowsAffected), lastInsertRowid }
        },
      }
    },
    async exec(sql: string) {
      await client.executeMultiple(sql)
    },
  }
}

// ── 装配 ──

/** 本地连接：只有 backend === 'local' 时才有值 */
export let localConn: DatabaseSync | null = null

export function initLocalDb(conn: DatabaseSync): GameVibeDb {
  localConn = conn
  return localDb(conn)
}

export function initTursoDb(url: string, token: string): GameVibeDb {
  const httpsUrl = url.replace(/^libsql:\/\//, 'https://').replace(/\/+$/, '')
  const client = createClient({ url: httpsUrl, authToken: token })
  return tursoDb(client)
}
