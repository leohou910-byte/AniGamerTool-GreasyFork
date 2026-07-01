#!/usr/bin/env python3
"""AniGamerTool Build Script
Usage: python build.py
Output: dist/script.user.js
Dependencies: None (pure Python 3)
"""

import os
import glob

SRC_DIR = "src"
DIST_DIR = "dist"
OUTPUT_FILE = os.path.join(DIST_DIR, "script.user.js")

# 依賴順序：header → core/* → modules/* → main.js
# 必須與 build.js 的 CORE_ORDER 和 modules 順序一致
FILE_ORDER = [
    "src/header.js",
    # core layer (依依賴順序排列)
    "src/core/EventBus.js",
    "src/core/StateManager.js",
    "src/core/BaseModule.js",
    "src/core/ConfigManager.js",
    # modules layer (依賴注入順序排列)
    "src/modules/CacheManager.js",
    "src/modules/DOMUtils.js",
    "src/modules/RatingProcessor.js",
    "src/modules/RequestManager.js",
    "src/modules/SortManager.js",
    "src/modules/UIComponents.js",
    "src/modules/WatchHistoryManager.js",
    # main.js 最後
    "src/main.js",
]


def collect_files():
    """依照依賴順序收集所有待拼接的 JS 檔案路徑"""
    paths = []
    for filepath in FILE_ORDER:
        if os.path.isfile(filepath) and filepath not in paths:
            paths.append(filepath)
    return paths


def read_file_safe(filepath):
    """安全讀取檔案，若不存在則回傳空字串與警告"""
    if not os.path.isfile(filepath):
        print(f"[警告] 找不到檔案: {filepath}，已跳過")
        return ""
    with open(filepath, "r", encoding="utf-8") as f:
        return f.read()


def build():
    print("=" * 50)
    print("AniGamerTool Build Script")
    print("=" * 50)

    # 確保 dist 目錄存在
    os.makedirs(DIST_DIR, exist_ok=True)

    files = collect_files()
    print(f"\n拼接順序 ({len(files)} 個檔案):")
    for i, f in enumerate(files, 1):
        print(f"  {i:2d}. {f}")

    # 拼接內容
    parts = []
    total_lines = 0
    for filepath in files:
        content = read_file_safe(filepath)
        if not content:
            continue
        lines = content.count("\n") + 1
        total_lines += lines
        # header.js 不加 source 註解，保持 UserScript 元數據在第一行
        if filepath == "src/header.js":
            parts.append(content)
            parts.append("\n")
        else:
            header_comment = f"\n// ============================================================\n// Source: {filepath}\n// ============================================================\n"
            parts.append(header_comment)
            parts.append(content)
            parts.append("\n")
        print(f"  [OK] {filepath} ({lines} lines)")

    # 寫入輸出檔案
    output_content = "".join(parts)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(output_content)

    print(f"\n{'=' * 50}")
    print(f"[DONE] Build complete!")
    print(f"  Output: {OUTPUT_FILE}")
    print(f"  Lines:  {total_lines}")
    print(f"  Size:   {os.path.getsize(OUTPUT_FILE):,} bytes")
    print(f"{'=' * 50}")


if __name__ == "__main__":
    build()