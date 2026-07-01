# 🎬 [動漫瘋] StarMap - 評分星圖

**StarMap - 評分星圖** 是一款強化巴哈姆特動畫瘋的使用者腳本（UserScript），為動畫封面加上**評分徽章**、**防雷遮罩/屏蔽**、**觀看進度標記**以及**自訂排序**等便利功能。

---

## 🌟 核心特色

### 1. 🎨 智慧評分徽章與級別變色
- **級別色彩標記**：根據動畫評分自動套用不同色調與框線，一眼辨識作品評價：
  - 🔥 **神作必看** — ≥ 4.8 分（粉紅色調）
  - ⭐ **極力推薦** — ≥ 4.5 分（金黃色調）
  - 👍 **佳作推薦** — ≥ 4.0 分（翠綠色調）
  - ➖ **中規中矩** — ≥ 3.5 分（灰色調）
  - 💣 **雷作避難** — < 3.5 分（紅色調）

- **評價防失真機制**：當評分人數少於設定值（預設 800 人）時，會顯示「⚠️」警示並套用黃色警告外觀，避免因少數人評分而產生的分數失真。

### 2. 📊 懸浮五星佔比與分析詳情
- 將滑鼠懸停在評分徽章上，即可顯示懸浮視窗，查看**估算的五星至一星比例分佈**以及作品的評價分級，掌握更詳細的社群反饋。

### 3. 🛡️ 避雷模糊遮罩與完全屏蔽
- **防雷遮罩**：低於設定門檻（預設 3.5 分）的作品封面將自動套用模糊與去色效果。將滑鼠移到封面上即可暫時解除。
- **完全屏蔽**：低於屏蔽門檻（預設 3.0 分）的作品可直接從頁面中隱藏。
- **快捷切換**：右下角提供 🛡️ / 🔓 與 🚫 / 👁️ 快捷按鈕，一鍵開關。

### 4. 👁️‍🗨️ 已觀看作品淡化與進度徽章
- **視覺淡化**：自動降低已看過作品的封面透明度；未看過的作品則加上亮藍色外框突顯。
- **進度提示**：顯示「觀看進度：第 X / Y 話」或「尚未觀看」。
- **特殊集數支援**：正確辨識 `第13B集`、`電影 共1集`、`特別篇 共1集` 等非標準集數格式。
- **雙向同步**：背景安全同步動畫瘋歷史觀看紀錄 API，無需手動操作。

### 5. ⇅ 自訂評分高低排序
- 一鍵將當前動畫列表依評分由高到低重新排列。
- 遇尚未載入評分的卡片時，會於背景自動預載並顯示頂部進度條，完成後即時排序。

### 6. ⚙️ 個人化設定面板
- 點擊導覽列「⭐ 評分設定」按鈕（若導覽列重構，會自動回退至右下角 ⚙️ 懸浮按鈕）即可開啟設定視窗。
- **可調參數**：字體大小、徽章圓角、防雷門檻、屏蔽門檻、請求間隔、快取容量上限、快取有效時間等。
- **主題適配**：設定面板外觀主動跟隨官方的深色/淺色模式。

### 7. ⚡ 智慧快取與高效懶載入
- **懶載入**：採用 `IntersectionObserver`，卡片捲入畫面後才發起評分請求。
- **LRU 快取**：預設 24 小時內不重複請求，超出容量上限時自動淘汰最舊資料。
- **請求節流**：佇列化請求，確保請求間隔符合設定值，避免觸發伺服器限制。

---

## 🛠️ 快捷懸浮按鈕（右下角）

| 按鈕 | 功能 |
|------|------|
| **⇅ / ★↓** | 切換「官方預設順序」與「評分高低排序」 |
| **🛡️ / 🔓** | 開啟/解除「低分防雷遮罩」 |
| **🚫 / 👁️** | 啟用/關閉「超低分作品完全屏蔽」 |
| **⚙️**（備用） | 頂部按鈕注入失敗時，以此開啟設定面板 |

---

## 📦 安裝方式

1. 瀏覽器需安裝 [Tampermonkey](https://www.tampermonkey.net/) 擴充功能。
2. 直接複製 `dist/script.user.js` 的完整內容至 Tampermonkey 新建腳本中貼上。
3. 開啟 [巴哈姆特動畫瘋](https://ani.gamer.com.tw/)，即自動生效。

---

## 🏗️ 專案架構（開發者用）

本專案採用**開發時檔案拆分，發布時自動拼接整合**的策略，保持極簡開發環境。

```
AniGamerTool-GreasyFork/
├── build.py                 # Python 建置腳本（純原生，無第三方依賴）
├── build.js                 # Node.js 建置腳本（備用）
├── src/
│   ├── header.js            # UserScript 元數據區塊
│   ├── main.js              # 主程式入口（IIFE 包裝 + 初始化順序）
│   ├── core/
│   │   ├── EventBus.js      # 發布/訂閱事件匯流排（模組間解耦通訊）
│   │   ├── StateManager.js  # 中央狀態管理器（單一事實來源 + 響應式更新）
│   │   ├── BaseModule.js    # 模組基底類別（init/destroy 生命週期 + 自動資源清理）
│   │   └── ConfigManager.js # 設定管理模組（繼承 BaseModule）
│   └── modules/
│       ├── CacheManager.js      # LRU 快取管理（TTL + 容量限制 + localStorage）
│       ├── RequestManager.js    # 請求佇列管理（頻率控制 + GM_xmlhttpRequest fallback）
│       ├── DOMUtils.js          # DOM 工具函數（元素提取、卡片判斷、標題清理）
│       ├── RatingProcessor.js   # 評分處理（HTML 解析、星數分佈、渲染過濾）
│       ├── WatchHistoryManager.js # 觀看紀錄管理（API 同步、淡化效果、進度徽章）
│       ├── SortManager.js       # 排序管理（DOM 快照、評分排序、自動載入）
│       └── UIComponents.js      # UI 元件（CSS 注入、Modal 設定、功能導覽、浮動按鈕）
├── dist/
│   └── script.user.js       # 建置產出（可直接貼進 Tampermonkey）
└── test/                    # 測試用資料（HTML 快照、JSON 範例）
```

### 建置方式

```bash
# 方式一（建議）：使用 Node.js
node build.js

# 方式二：使用 Python（若環境支援）
python build.py
```

輸出為 `dist/script.user.js`，即為 Tampermonkey 可使用的單一腳本檔案。

### 模組依賴圖

```
header.js (元數據)
  → EventBus.js       (模組間事件通訊)
  → StateManager.js   (中央狀態儲存)
  → BaseModule.js     (基底類別，自動資源清理)
  → ConfigManager.js  (設定管理，繼承 BaseModule)

  → CacheManager.js   (LRU 快取)
  → RequestManager.js (請求佇列)
  → DOMUtils.js       (DOM 工具)

  → RatingProcessor.js       ← 依賴 CacheManager, RequestManager, DOMUtils
  → WatchHistoryManager.js    ← 依賴 RequestManager, DOMUtils
  → SortManager.js            ← 依賴 DOMUtils, RatingProcessor
  → UIComponents.js           ← 依賴 CacheManager, WatchHistoryManager, SortManager, RatingProcessor

  → main.js (啟動所有模組)
```

### 設計原則

- **EventBus**：模組間完全解耦，透過 `config:changed`、`rating:rendered`、`ui:showToast` 等事件通訊
- **StateManager**：單一事實來源，所有設定以 `config.xxx` 鍵名儲存，支援 `subscribe()` 響應式更新
- **BaseModule**：統一生命週期，提供 `_setTimeout()`、`_createMutationObserver()`、`_listenEvent()` 等安全包裝，自動在 `destroy()` 清理所有資源，防止記憶體洩漏
- **data 屬性過濾**：使用 `[data-rating-processed]` 屬性標記已處理卡片，防止 MutationObserver 無限遞迴

---

## 📌 注意事項
- **首次使用**：安裝後首次開啟動畫瘋，會自動播放簡易功能導覽。
- **觀看紀錄同步**：腳本會於背景自動同步歷史紀錄，無需手動操作。
- **伺服器友善**：預設請求間隔為 500ms，可於設定面板中調整，避免對官方伺服器造成負擔。
- **所有設定自動儲存**於瀏覽器 `localStorage`，關閉頁面後不會遺失。

---

## 📄 授權

MIT License © 2024 LeoHou & AI