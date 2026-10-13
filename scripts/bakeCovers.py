"""非 Steam 游戏封面本地化（构建期烘焙）

为什么本地化：这些平台的原始封面要么是 1–3MB 的 PNG（PS 截图级 artwork），
要么是内容寻址的第三方图床 URL（Google Play），直接当卡片缩略图太重/太脆；
线上沙箱对部分图床还有限制。下载 → 裁到 600px → JPEG 存进 public/covers/，
线上完全不依赖出网，加载也快。

数据源（全部免密钥）：
  ① PS Store chihiro search —— 按名搜，取盒装封面（type=10）
  ② 直接 URL —— Google Play 应用页 og:image 等已核实过的固定地址

用法：HTTPS_PROXY=http://127.0.0.1:7890 python scripts/bakeCovers.py
输出：public/covers/dc-<id>.jpg + .ps-covers.json 清单（清单名沿用，供 fixCoversAll.mjs 读取）
"""

import json
import os
import re
import ssl
import urllib.parse
import urllib.request
from io import BytesIO

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "public", "covers")
MANIFEST = os.path.join(ROOT, ".ps-covers.json")

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) GameVibe/1.0"
SEARCH = "https://store.playstation.com/store/api/chihiro/00_09_000/search/US/en/999/{}"

# ── 源 ①：PS Store 搜索 ────────────────────────────────────────────
# 需要走 PS Store 的条目：Steam 上没有或匹配不到本体的主机游戏。
# 第三项是可选的「必须命中」正则，用来避开同名老作（实测搜 Modern Warfare III
# 会先返回 2019 年的《Modern Warfare®》，必须强制要求名字里带 III）
PS_TARGETS = [
    ("dc_bloodborne", "Bloodborne", None),
    ("dc_demons-souls", "Demon's Souls", None),
    ("dc_gran-turismo-7", "Gran Turismo 7", None),
    ("dc_astro-bot-switch", "Astro Bot", None),
    ("dc_horizon-forbidden-west-burn", "Horizon Call of the Mountain", None),
    ("dc_alan-wake-2", "Alan Wake 2", None),
    ("dc_cod-modern-warfare", "Modern Warfare III", r"III"),
]

# ── 源 ②：直接 URL（已逐张核实过状态码与体积）──────────────────────
# Google Play 应用页的 og:image。play-lh.googleusercontent.com 是内容寻址地址，
# 稳定但很长；烘焙下来既省流量也免掉热链风险。
DIRECT_TARGETS = [
    (
        "dc_agar",
        "Agar.io (Google Play)",
        "https://play-lh.googleusercontent.com/"
        "3bTpJObZrCS-xzdXY7DcfmxK4nrF-FW5h4h7BAcmp0m0WZUG9488VfcNXwOevDf4cougRV9eFS4FCQ4QCoAQ=s0-br30",
    ),
    (
        "dc_geoguessr",
        "GeoGuessr (Google Play)",
        "https://play-lh.googleusercontent.com/"
        "RfyvTv9Cg27F_b3eb2FcL-anYiM0A0rwfjY2inIcbHBINEiEMMOzrj08NYxRRjwDB4GM95Uj8SfKccwD36owOQ=s0-br30",
    ),
]

# 排除非本体（DLC / 升级包 / 合集 / 皮肤），保留正传。
# 注意 demo / dlc / pack 必须带词边界——否则 "Demon's Souls" 会被 demo 误伤
BAD = re.compile(
    r"deluxe|ultimate|upgrade|bundle|costume|\bpack\b|expansion|season pass|"
    r"soundtrack|\bdlc\b|\bdemo\b|\btrial\b|add-?on|avatar|theme",
    re.I,
)

# 平台优先级：同一个游戏在 PS3/PS4/PS5 都有页面时，取最新版本的美术
PLATFORM_RANK = {"PS5": 0, "PS4": 1, "PS3": 2, "PSP": 3, "PS Vita": 4, "PS VR2": 0}

RESAMPLE = getattr(Image, "Resampling", Image).LANCZOS


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


def fetch(url: str, timeout: int = 30) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        return r.read()


def ps_search(keyword: str):
    return json.loads(fetch(SEARCH.format(urllib.parse.quote(keyword))))


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
    # 优先用 scripts/dlPlayCovers.mjs 预下的本地文件：
    # 实测 Python urllib 走代理访问 play-lh.googleusercontent.com 会 502，Node fetch 正常
    local = os.path.join(ROOT, ".cover-tmp", f"{game_id}.png")
    data = open(local, "rb").read() if os.path.exists(local) else fetch(url, timeout=60)
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
        im = im.resize((target_w, h), RESAMPLE)
    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, f"{game_id}.jpg")
    im.save(out, "JPEG", quality=quality, optimize=True, progressive=True)
    return out, im.size, os.path.getsize(out)


# ── 源 ③：旧精选库 PNG 瘦身 ────────────────────────────────────────
# 初始版本的 16 张封面是 1–2MB 的 PNG（全站 25MB），卡片缩略图根本不需要这个分辨率。
# 统一转成 700px 宽的渐进式 JPEG，并把 src/data/games.ts 里的引用从 .png 改成 .jpg。
LEGACY_DIR = os.path.join(ROOT, "public", "covers")
LEGACY_REF_FILE = os.path.join(ROOT, "src", "data", "games.ts")
LEGACY_MAX_W = 700
LEGACY_QUALITY = 82


def slim_legacy_pngs():
    """把 public/covers/*.png 转成同名 .jpg 并删除原 PNG，返回 {旧名: 新名} 映射"""
    if not os.path.isdir(LEGACY_DIR):
        print("  public/covers 不存在，跳过")
        return {}
    renamed = {}
    for fn in sorted(os.listdir(LEGACY_DIR)):
        if not fn.lower().endswith(".png"):
            continue
        src = os.path.join(LEGACY_DIR, fn)
        old_kb = os.path.getsize(src) // 1024
        try:
            im = Image.open(src)
            im.load()
            if im.mode in ("RGBA", "LA", "P"):
                bg = Image.new("RGB", im.size, (12, 12, 18))
                rgba = im.convert("RGBA")
                bg.paste(rgba, mask=rgba.split()[-1])
                im = bg
            else:
                im = im.convert("RGB")
            w, h = im.size
            if w > LEGACY_MAX_W:
                im = im.resize((LEGACY_MAX_W, round(h * LEGACY_MAX_W / w)), RESAMPLE)
            out = os.path.join(LEGACY_DIR, fn[:-4] + ".jpg")
            im.save(out, "JPEG", quality=LEGACY_QUALITY, optimize=True, progressive=True)
            new_kb = os.path.getsize(out) // 1024
            os.remove(src)
            renamed[f"/covers/{fn}"] = f"/covers/{fn[:-4]}.jpg"
            print(f"  {fn:34} {old_kb:5}KB -> {new_kb:4}KB  ({w}x{h} -> {im.size[0]}x{im.size[1]})")
        except Exception as e:  # noqa: BLE001
            print(f"  {fn:34} 失败: {e}")
    return renamed


def rewrite_refs(renamed):
    """把 games.ts 与 fixCoversAll.mjs 里的 .png 引用换成 .jpg"""
    if not renamed:
        return
    for path in (LEGACY_REF_FILE, os.path.join(ROOT, "scripts", "fixCoversAll.mjs")):
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as f:
            text = f.read()
        hits = 0
        for old, new in renamed.items():
            if old in text:
                hits += text.count(old)
                text = text.replace(old, new)
        if hits:
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)
            print(f"  已更新引用 {hits} 处：{os.path.relpath(path, ROOT)}")


def main():
    manifest = {}
    total = 0

    print("── 源① PS Store ──")
    for gid, name, require in PS_TARGETS:
        total += 1
        try:
            data = ps_search(name)
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
            _, size, nbytes = bake(gid, url)
        except Exception as e:  # noqa: BLE001
            print(f"{gid:34} 下载/裁剪失败: {e}")
            continue
        manifest[gid] = f"/covers/{gid}.jpg"
        print(f"{gid:34} OK  {game['name'][:36]:38} {size[0]}x{size[1]}  {nbytes // 1024}KB")

    print("\n── 源② 直接 URL ──")
    for gid, label, url in DIRECT_TARGETS:
        total += 1
        try:
            _, size, nbytes = bake(gid, url)
        except Exception as e:  # noqa: BLE001
            print(f"{gid:34} 失败: {e}")
            continue
        manifest[gid] = f"/covers/{gid}.jpg"
        print(f"{gid:34} OK  {label[:36]:38} {size[0]}x{size[1]}  {nbytes // 1024}KB")

    print("\n── 源③ 旧精选库 PNG 瘦身 ──")
    # 已烘焙过的条目文件也在这里，但它们是 .jpg，不会被扫到
    if os.environ.get("SKIP_LEGACY") != "1":
        renamed = slim_legacy_pngs()
        rewrite_refs(renamed)
    else:
        print("  （SKIP_LEGACY=1，跳过）")

    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    print(f"\n已本地化 {len(manifest)}/{total} 张，清单写入 {MANIFEST}")


if __name__ == "__main__":
    main()
