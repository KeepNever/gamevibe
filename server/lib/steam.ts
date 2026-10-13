import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

export interface ScannedGame {
  external_id: string
  name: string
  install_path: string
  size_bytes: number
  last_played: number | null
  cover_url: string
  source: 'steam_scan'
}

// 开发演示用占位（当本机未安装 Steam 时，仍能让前端走通导入流程）
const DEMO_SCAN: ScannedGame[] = [
  {
    external_id: '730',
    name: 'Counter-Strike 2',
    install_path: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Counter-Strike Global Offensive',
    size_bytes: 38_000_000_000,
    last_played: Date.now() - 86_400_000,
    cover_url: 'https://cdn.cloudflare.steamstatic.com/steam/apps/730/capsule_184x69.jpg',
    source: 'steam_scan',
  },
  {
    external_id: '1086940',
    name: 'Baldur\'s Gate 3',
    install_path: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Baldurs Gate 3',
    size_bytes: 122_000_000_000,
    last_played: Date.now() - 3 * 86_400_000,
    cover_url: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1086940/capsule_184x69.jpg',
    source: 'steam_scan',
  },
  {
    external_id: '570',
    name: 'Dota 2',
    install_path: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\dota 2 beta',
    size_bytes: 44_000_000_000,
    last_played: null,
    cover_url: 'https://cdn.cloudflare.steamstatic.com/steam/apps/570/capsule_184x69.jpg',
    source: 'steam_scan',
  },
]

function detectSteamPath(): string | null {
  const candidates = ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam', 'D:\\Steam', 'D:\\SteamLibrary']
  for (const c of candidates) if (existsSync(c)) return c
  try {
    const out = execSync('reg query "HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam" /v InstallPath', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const m = out.match(/InstallPath\s+REG_SZ\s+(.+)/)
    if (m) return m[1].trim()
  } catch {
    /* 忽略，走候选列表 */
  }
  return null
}

function parseVdfKeys(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  const re = /"([^"]+)"\s+"([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content))) result[m[1]] = m[2]
  return result
}

/** 扫描本机 Steam 游戏库；未安装 Steam 时返回开发演示数据 */
export function scanSteamLibrary(): ScannedGame[] {
  const steamPath = detectSteamPath()
  if (!steamPath) {
    console.warn('[steam] 未检测到 Steam 安装，返回开发演示扫描数据')
    return DEMO_SCAN
  }

  const libfoldersPath = join(steamPath, 'steamapps', 'libraryfolders.vdf')
  const libraries: string[] = [steamPath]
  if (existsSync(libfoldersPath)) {
    const keys = parseVdfKeys(readFileSync(libfoldersPath, 'utf8'))
    for (const v of Object.values(keys)) {
      if (v && (v.includes(':') || v.includes('\\')) && existsSync(v)) libraries.push(v)
    }
  }

  const games: ScannedGame[] = []
  for (const lib of libraries) {
    const steamapps = join(lib, 'steamapps')
    if (!existsSync(steamapps)) continue
    let files: string[] = []
    try {
      files = readdirSync(steamapps)
    } catch {
      continue
    }
    for (const f of files) {
      const m = f.match(/^appmanifest_(\d+)\.acf$/)
      if (!m) continue
      try {
        const kv = parseVdfKeys(readFileSync(join(steamapps, f), 'utf8'))
        const appid = kv['appid']
        if (!appid) continue
        games.push({
          external_id: appid,
          name: kv['name'] || `App ${appid}`,
          install_path: join(steamapps, 'common', kv['installdir'] || ''),
          size_bytes: Number(kv['SizeOnDisk'] || 0),
          last_played: kv['LastUpdated'] ? Number(kv['LastUpdated']) * 1000 : null,
          cover_url: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/capsule_184x69.jpg`,
          source: 'steam_scan',
        })
      } catch {
        /* 跳过损坏的 manifest */
      }
    }
  }

  const seen = new Set<string>()
  return games.filter((g) => {
    if (seen.has(g.external_id)) return false
    seen.add(g.external_id)
    return true
  })
}
