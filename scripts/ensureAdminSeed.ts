/**
 * 确保种子管理员就位（CI / 全新库用）。
 * 背景：启动顺序是 seedRbac（db 打开时）→ 自动灌演示数据（index.ts 里），
 * 全新库第一次启动时 seedRbac 面对的 users 表还是空的，"提升最早注册用户
 * 为管理员"会落空。跑一遍本脚本等于重放 seedRbac，此时用户已存在，
 * 最早注册的演示账号会被补上 admin 角色。幂等，可重复执行。
 */
import { DatabaseSync } from 'node:sqlite'
import { seedRbac } from '../server/db/seedRbac.ts'

const db = new DatabaseSync('server/db/data/gamevibe.db')
seedRbac(db)
const admin = db
  .prepare(
    `SELECT u.username FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.id = ur.role_id
     WHERE r.key = 'admin' ORDER BY u.created_at LIMIT 1`,
  )
  .get()
console.log('管理员就位:', admin?.username ?? '(无)')
