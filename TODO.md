# AniGamerTool.js 開發 TODO

## ✅ 已完成

1. **WatchHistoryManager 完整重構**
   - 資料結構：`Map<cleanTitle, string>` → `_rawArray[]` + `_byVideoSn Map<videoSn, item>`
   - 支援小數集數（`parseFloat`，如 0.5、1.5）
   - 移除 localStorage 儲存、標題比對、totalEpisodes 計算
   - 以 DOM 查詢 `.history-lastwatch .user-lastwatch` 為優先，API 查詢為輔

2. **API 請求修復**
   - `RequestManager.gmFetch()` 補上 `ok: true` 屬性
   - `fetchHistory()` 改為 GM_xmlhttpRequest 為主要請求（攜帶 BAHAMUT Cookie）
   - 移除自動下載 JSON 檔案（`_exportJSON()` 保留供手動使用）

3. **設定 Modal Toggle 修復**
   - camelCase → kebab-case id 轉換（`armToggle` → `arm-toggle`），讓 toggle 開關可正常點擊

4. **CSS 清理**
   - 移除不再使用的 `.mini-progress`、`.mini-progress-fill` 樣式

## ❌ 待處理

5. **DOM 查詢 `.history-lastwatch` 確認**
   - 目前 `_getWatchProgress()` 第一步查詢 `.history-lastwatch .user-lastwatch`
   - 需確認這個 class 在實際頁面中是否存在
   - 若不存在，需改用其他 selector 或完全依賴 API 查詢

6. **特殊集數格式處理**
   - API 回傳的 `episode` 可能是 `"13B"`、`"7.5"`、`"12.5"` 等
   - `parseFloat("13B")` → `13`，會遺失 `B` 標記
   - 需決定如何顯示這類特殊集數

7. **`_exportJSON()` 手動匯出按鈕**
   - 方法已保留但未在 UI 中提供觸發入口
   - 可在設定 Modal 中加一個「匯出觀看紀錄」按鈕

8. **觀看紀錄進度徽章位置**
   - `RatingProcessor.render()` 中有調整徽章位置的邏輯
   - 需確認與評分徽章不重疊

9. **確認 `fadeWatched` 淡化功能**
   - 確認已觀看卡片的視覺淡化效果正常運作