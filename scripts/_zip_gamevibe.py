import os, zipfile

SRC = r"C:\Users\Administrator\WorkBuddy\myproject\gamevibe"
OUT = r"D:\GameVibe-源码-2026-07-17.zip"

EXCLUDE_DIRS = {"node_modules", "dist", ".git", ".workbuddy", "__pycache__"}
EXCLUDE_FILES = {"repro_errors.txt"}
DB_SUFFIXES = (".db", ".db-shm", ".db-wal")

def keep(path):
    rel = os.path.relpath(path, SRC)
    parts = rel.split(os.sep)
    for p in parts:
        if p in EXCLUDE_DIRS:
            return False
    base = parts[-1]
    if base in EXCLUDE_FILES:
        return False
    if base.lower().endswith(DB_SUFFIXES):
        return False
    if base.startswith(".") and base not in (".env", ".env.example", ".dockerignore", ".oxlintrc.json", ".gitignore"):
        return False
    return True

n = 0
size = 0
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    for dirpath, dirnames, filenames in os.walk(SRC):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS and not d.startswith(".")]
        for f in filenames:
            fp = os.path.join(dirpath, f)
            if not keep(fp):
                continue
            rel = os.path.relpath(fp, os.path.dirname(SRC))
            z.write(fp, rel)
            n += 1
            size += os.path.getsize(fp)

print(f"OK {n} files, ~{size/1024/1024:.1f} MB -> {OUT}")
