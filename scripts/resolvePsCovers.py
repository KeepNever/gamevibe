"""PS Store 独占 / 非 Steam 游戏的封面本地化

为什么本地化：PS 的原始封面是 1–3MB 的 PNG，直接当卡片缩略图太重；
而且线上沙箱对部分图床有限制。下载 → 裁到 600px → JPEG 存进 public/covers/，
线上完全不依赖出网，加载也快。

用法：HTTPS_PROXY=... python scripts/resolvePsCovers.py
输出：public/covers/dc-<id>.jpg + .ps-covers.json 清单
"""

import json
import os
import re
import ssl
import sys
import urllib.parse
import urllib.request
from io import BytesIO

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "public", "covers")
MANIFEST = os.path.join(ROOT, ".ps-covers.json")

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) GameVibe/1.0"
SEARCH = "https://store.playstation.com/store/api/chihiro/00_09_000/search/US/en/999/{}"

# 需要走 PS Store 的条目：Steam 上没有或匹配不到本体的主机游戏
# 第三项是可选的「必须命中」正则，用来避开同名老作（实测搜 Modern Warfare III
# 会先返回 2019 年的《Modern Warfare®》，必须强制要求名字里带 III）
TARGETS = [
    ("dc_bloodborne", "Bloodborne", None),
    ("dc_demons-souls", "Demon's Souls", None),
    ("dc_gran-turismo-7", "Gran Turismo 7", None),
    ("dc_astro-bot-switch", "Astro Bot", None),
    ("dc_horizon-forbidden-west-burn", "Horizon Call of the Mountain", None),
    ("dc_alan-wake-2", "Alan Wake 2", None),
    ("dc_cod-modern-warfare", "Modern Warfare III", r"III"),
]

# 排除非本体（DLC / 升级包 / 合集 / 皮肤），保留正传。
# 注意 demo / dlc / pack 必须带词边界——否则 "Demon's Souls" 会被 demo 误伤
BAD = re.compile(
    r"deluxe|ultimate|upgrade|bundle|costume|\bpack\b|expansion|season pass|"
    r"soundtrack|\bdlc\b|\bdemo\b|\btrial\b|add-?on|avatar|theme",
    re.I,
)

# 平台优先级：同一个游戏在 PS3/PS4/PS5 都有页面时，取最新的那个版本的美术
PLATFORM_RANK = {"PS5": 0, "PS4": 1, "PS3": 2, "PSP": 3, "PS Vita": 4, "PS VR2": 0}


def norm(s: str) -> str:
    return re.sub(r"[™®:’'!.\-–—]", "", (s or "").lower()).strip()


def similar(query: str, cand: str) -> bool:
    q, c = norm(query), norm(cand)
    if not q or not c:
        return False
    if c == q or c.startswith(q) or q.startswith(c):
        return True
    qt = [t for t in q.split() if len(t) > 2]
    if not qt:
        return True
    return sum(1 for t in qt if t in c) / len(qt) >= 0.7


def fetch(url: str, timeout: int = 25) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        return r.read()


def search(keyword: str):
    raw = fetch(SEARCH.format(urllib.parse.quote(keyword)))
    return json.loads(raw)


def pick_base_game(links, name, require=None):
    """挑正传条目：名字相似、不含 DLC / 合集关键词、满足 require，且平台越新越优先"""
    cands = [
        g
        for g in links
        if similar(name, g.get("name", ""))
        and not BAD.search(g.get("name", ""))
        and (require is None or re.search(require, g.get("name", ""), re.I))
    ]
    if not cands:
        return None
    # 先按平台（PS5 优先）再按名字长度（"Bloodborne™" 优于其 Complete Edition）
    cands.sort(
        key=lambda g: (
            min(PLATFORM_RANK.get(p, 9) for p in (g.get("playable_platform") or ["?"])),
            len(norm(g.get("name", ""))),
        )
    )
    return cands[0]


def pick_image(game):
    """type=10 是盒装封面，12 是横版背景，13 多为 logo"""
    imgs = game.get("images") or []
    for pref in (10, 11, 13, 12):
        for im in imgs:
            if im.get("type") == pref and im.get("url"):
                return im["url"]
    return imgs[0]["url"] if imgs else None


def bake(game_id: str, url: str, target_w: int = 600, quality: int = 85):
    data = fetch(url, timeout=45)
    im = Image.open(BytesIO(data))
    im.load()
    if im.mode in ("RGBA", "LA", "P"):
        bg = Image.new("RGB", im.size, (12, 12, 18))
        rgba = im.convert("RGBA")
        bg.paste(rgba, mask=rgba.split()[-1])
        im = bg
    else:
        im = im.convert("RGB")
    if im.width > target_w:
        h = round(im.height * target_w / im.width)
        im = im.resize((target_w, h), Image.LANCZOS)
    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, f"{game_id}.jpg")
    im.save(out, "JPEG", quality=quality, optimize=True, progressive=True)
    return out, im.size, os.path.getsize(out)


def main():
    manifest = {}
    for gid, name, require in TARGETS:
        try:
            data = search(name)
        except Exception as e:  # noqa: BLE001
            print(f"{gid:34} 搜索失败: {e}")
            continue
        game = pick_base_game(data.get("links") or [], name, require)
        if not game:
            print(f"{gid:34} 无匹配本体（共 {len(data.get('links') or [])} 条结果）")
            continue
        url = pick_image(game)
        if not url:
            print(f"{gid:34} 该条目无图片")
            continue
        try:
            path, size, nbytes = bake(gid, url)
        except Exception as e:  # noqa: BLE001
            print(f"{gid:34} 下载/裁剪失败: {e}")
            continue
        manifest[gid] = f"/covers/{gid}.jpg"
        print(
            f"{gid:34} OK  {game['name'][:38]:40} {size[0]}x{size[1]}  {nbytes // 1024}KB"
        )

    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    print(f"\n已本地化 {len(manifest)}/{len(TARGETS)} 张，清单写入 {MANIFEST}")


if __name__ == "__main__":
    main()
