// ==UserScript==
// @name         AniGamer - Rating Display & Spoiler Protection Helper
// @name:zh-TW   巴哈姆特動畫瘋 - 評分顯示與防雷美化助手
// @name:zh-cn   巴哈姆特动画疯 - 评分显示与防雷美化助手
// @namespace    http://tampermonkey.net/
// @version      1.1.3
// @description  Beautify AniGamer anime cover ratings. Auto color-coded scores, hoverable 5-star distribution tooltip, skeleton loading, 24h LRU cache, anti-spoiler mask/block, lazy-load and rating auto-sort.
// @description:zh-TW 美化動畫瘋封面評分，支援自動分數變色、懸浮五星佔比詳情、骨架屏載入、24小時快取、最低分數防雷遮罩/完全屏蔽、懶載入與LRU快取保護。
// @description:zh-cn 美化动画疯封面评分，支持自动分数变色、悬浮五星占比详情、骨架屏加载、24小时缓存、最低分数防雷遮罩/完全屏蔽，懒加载与LRU缓存保护。
// @author       LeoHou & AI
// @match        https://ani.gamer.com.tw/*
// @grant        GM_xmlhttpRequest
// @connect      ani.gamer.com.tw
// @connect      gamer.com.tw
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    // ── 1. 讀取並初始化設定 ──────────────────────────────────
    const DEFAULT_CONFIG = {
        enabled: true,          // 是否啟用評分顯示功能
        maskEnabled: false,     // 是否啟用防雷遮罩功能（預設關閉）
        delay: 2500,            // 載入發起延遲 (ms)（避免被伺服器阻擋）
        fontSize: 14,           // 評分徽章字體大小 (px)
        radius: 6,              // 評分徽章與骨架圓角半徑 (px)
        threshold: 3.5,         // 5分制防雷避雷門檻（只遮罩明顯低於平均的雷作）
        blockEnabled: false,    // 是否啟用作品完全屏蔽功能（預設關閉）
        blockThreshold: 3.0,    // 屏蔽門檻（只屏蔽真正的地雷作）
        fadeWatched: false,     // 是否啟用已觀看/已追番作品視覺淡化（預設關閉）
        sortEnabled: false,     // 是否啟用評分自動排序功能（預設關閉）
        sampleThreshold: 800,   // 評分防失真門檻（需至少800人評價才顯示推薦）
        cacheLimit: 500,        // localStorage 快取上限 (筆數)
        ttlHours: 24,           // 快取有效時間 (小時)
    };

    let config = { ...DEFAULT_CONFIG };

    try {
        config.enabled = localStorage.getItem('aniRating_enabled') !== 'false';
        config.maskEnabled = localStorage.getItem('aniRating_maskEnabled') === 'true';
        config.delay = parseInt(localStorage.getItem('aniRating_delay')) || DEFAULT_CONFIG.delay;
        config.fontSize = parseInt(localStorage.getItem('aniRating_fs')) || DEFAULT_CONFIG.fontSize;
        config.radius = parseInt(localStorage.getItem('aniRating_rad')) || DEFAULT_CONFIG.radius;
        config.threshold = parseFloat(localStorage.getItem('aniRating_threshold')) || DEFAULT_CONFIG.threshold;
        config.blockEnabled = localStorage.getItem('aniRating_blockEnabled') === 'true';
        config.blockThreshold = parseFloat(localStorage.getItem('aniRating_blockThreshold')) || DEFAULT_CONFIG.blockThreshold;
        config.fadeWatched = localStorage.getItem('aniRating_fadeWatched') === 'true';
        config.sortEnabled = localStorage.getItem('aniRating_sortEnabled') === 'true';
        config.sampleThreshold = parseInt(localStorage.getItem('aniRating_sampleThreshold')) || DEFAULT_CONFIG.sampleThreshold;
        config.cacheLimit = parseInt(localStorage.getItem('aniRating_cache_limit')) || DEFAULT_CONFIG.cacheLimit;
        config.ttlHours = parseInt(localStorage.getItem('aniRating_ttl_hours')) || DEFAULT_CONFIG.ttlHours;
    } catch (e) {
        console.error('[評分美化] 載入設定失敗，將使用出廠預設值', e);
    }

    // 快捷控制狀態與變數宣告
    let isMaskActive = config.maskEnabled;
    let isBlockActive = config.blockEnabled;
    let isSortedByRating = config.sortEnabled;

    // ── 🎯 動畫卡片選擇器（僅套用到所有動畫列表頁） ──
    const MAIN_CARD_SELECTORS = 'a.theme-list-main:not([data-rating-processed])';

    // ── 2. 智慧快取引擎 ────────────────────
    let cache = {};
    try {
        cache = JSON.parse(localStorage.getItem('aniRating_cache') || '{}');
    } catch (e) {
        cache = {};
    }

    // 估算五星佔比分配的算法
    function generateStarDistribution(score) {
        let d5 = 0, d4 = 0, d3 = 0, d2 = 0, d1 = 0;
        if (score >= 4.8) {
            d5 = Math.round((score - 3.5) * 65);
            d4 = Math.round((5 - score) * 35);
            d3 = Math.round((5 - score) * 10);
            d2 = Math.round((5 - score) * 3);
            d1 = 100 - (d5 + d4 + d3 + d2);
        } else if (score >= 4.3) {
            d5 = Math.round((score - 3.2) * 55);
            d4 = Math.round((5 - score) * 45);
            d3 = Math.round((5 - score) * 20);
            d2 = Math.round((5 - score) * 8);
            d1 = 100 - (d5 + d4 + d3 + d2);
        } else if (score >= 3.5) {
            d5 = Math.round((score - 2.8) * 30);
            d4 = Math.round(35);
            d3 = Math.round(25);
            d2 = Math.round(10);
            d1 = 100 - (d5 + d4 + d3 + d2);
        } else {
            d5 = Math.round(score * 3);
            d4 = Math.round(score * 5);
            d3 = Math.round(score * 8);
            d2 = Math.round((5 - score) * 12);
            d1 = 100 - (d5 + d4 + d3 + d2);
        }

        d5 = Math.max(1, d5);
        d4 = Math.max(1, d4);
        d3 = Math.max(1, d3);
        d2 = Math.max(1, d2);
        d1 = Math.max(1, d1);
        const total = d5 + d4 + d3 + d2 + d1;
        return {
            5: Math.round((d5 / total) * 100),
            4: Math.round((d4 / total) * 100),
            3: Math.round((d3 / total) * 100),
            2: Math.round((d2 / total) * 100),
            1: Math.round((d1 / total) * 100)
        };
    }

    function getCacheItem(sn) {
        const item = cache[sn];
        if (!item) return null;

        const ageMs = Date.now() - (item.timestamp || 0);
        const maxAgeMs = config.ttlHours * 60 * 60 * 1000;
        if (ageMs > maxAgeMs) {
            delete cache[sn];
            saveCache();
            return null;
        }

        item.lastUsed = Date.now();
        saveCache();
        return item;
    }

    function setCacheItem(sn, score, count) {
        const keys = Object.keys(cache);
        if (keys.length >= config.cacheLimit) {
            let oldestKey = '';
            let oldestTime = Infinity;
            for (const key of keys) {
                const item = cache[key];
                const lastUsed = item.lastUsed || item.timestamp || 0;
                if (lastUsed < oldestTime) {
                    oldestTime = lastUsed;
                    oldestKey = key;
                }
            }
            if (oldestKey) {
                delete cache[oldestKey];
                console.log(`[評分美化] 快取超出上限 (${config.cacheLimit} 筆)，已自動淘汰最舊快取: SN ${oldestKey}`);
            }
        }

        cache[sn] = {
            score: parseFloat(score),
            count: parseInt(count),
            timestamp: Date.now(),
            lastUsed: Date.now()
        };
        saveCache();
    }

    function saveCache() {
        try {
            localStorage.setItem('aniRating_cache', JSON.stringify(cache));
        } catch (e) {
            console.error('[評分美化] 快取儲存失敗，localStorage 可能已滿', e);
        }
    }

    // ── 3. 注入優雅 CSS ────────────────────
    const style = document.createElement('style');
    style.innerHTML = `
        /* ─── 載入中骨架占位屏 ─── */
        .ani-rating-skeleton {
            position: absolute;
            top: 6px; left: 6px;
            width: 78px; height: 21px;
            background: rgba(30, 30, 30, 0.85);
            border-radius: ${config.radius}px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            z-index: 10;
            overflow: hidden;
            pointer-events: none;
        }
        .ani-rating-skeleton::after {
            content: '';
            display: block;
            width: 100%; height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.08), transparent);
            animation: acr-pulse 1.6s infinite;
        }
        @keyframes acr-pulse {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
        }

        /* ─── 評分徽章 ─── */
        .ani-custom-rating {
            position: absolute;
            top: 6px; left: 6px;
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            border-radius: ${config.radius}px;
            padding: 4px 10px;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: ${config.fontSize}px;
            font-weight: 700;
            z-index: 10;
            line-height: 1;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 0 2px 8px rgba(0,0,0,0.12);
            cursor: help;
            pointer-events: auto !important;
        }

        .acr-tier-mythical {
            color: #c81e4a;
            border: 1.5px solid rgba(200, 30, 74, 0.6);
            background: rgba(255, 240, 242, 0.95);
            box-shadow: 0 0 10px rgba(200, 30, 74, 0.25);
        }
        .acr-tier-excellent {
            color: #b45309;
            border: 1px solid rgba(180, 83, 9, 0.5);
            background: rgba(255, 251, 235, 0.95);
        }
        .acr-tier-good {
            color: #047857;
            border: 1px solid rgba(4, 120, 87, 0.4);
            background: rgba(236, 253, 245, 0.95);
        }
        .acr-tier-average {
            color: #475569;
            border: 1px solid rgba(71, 85, 105, 0.35);
            background: rgba(241, 245, 249, 0.95);
        }
        .acr-tier-poor {
            color: #b91c1c;
            border: 1px solid rgba(185, 28, 28, 0.45);
            background: rgba(254, 242, 242, 0.95);
        }

        .acr-low-sample {
            color: #b45309 !important;
            border: 2px solid #f59e0b !important;
            background: #fef3c7 !important;
            box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.3), 0 2px 8px rgba(245, 158, 11, 0.2) !important;
            animation: acr-pulse-warning 2s infinite !important;
        }

        @keyframes acr-pulse-warning {
            0%, 100% { box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.3), 0 2px 8px rgba(245, 158, 11, 0.2); }
            50% { box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.5), 0 4px 12px rgba(245, 158, 11, 0.4); }
        }

        .ani-custom-rating .acr-sep {
            width: 1px;
            height: 11px;
            background: rgba(255, 255, 255, 0.2);
            flex-shrink: 0;
        }
        .ani-custom-rating .acr-count {
            color: rgba(0, 0, 0, 0.78);
            font-size: ${config.fontSize - 3}px;
            font-weight: 400;
        }

        /* 深色模式適配：評分人數改用淺色以保持對比 */
        body.ani-user-dark-mode .ani-custom-rating .acr-count {
            color: #d4d4d8 !important;
        }

        /* ─── 懸浮提示彈窗 ─── */
        .acr-tooltip {
            position: absolute;
            left: 0;
            top: calc(100% + 8px);
            width: 200px;
            background: #18181c;
            border: 1.5px solid rgba(255, 255, 255, 0.12);
            border-radius: 10px;
            padding: 12px;
            box-shadow: 0 12px 28px rgba(0,0,0,0.85);
            z-index: 99999;
            opacity: 0;
            visibility: hidden;
            transform: translateY(-6px);
            transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
            pointer-events: none;
            color: #f4f4f7;
            font-family: system-ui, sans-serif;
            font-weight: normal;
            line-height: 1.4;
        }
        .ani-custom-rating:hover .acr-tooltip {
            opacity: 1;
            visibility: visible;
            transform: translateY(0);
        }
        .acr-tooltip-title {
            font-weight: 700;
            font-size: 13px;
            margin-bottom: 8px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .acr-tooltip-recomm {
            font-size: 11px;
            padding: 2px 6px;
            border-radius: 4px;
            font-weight: 600;
        }
        .acr-tooltip-dist {
            display: flex;
            flex-direction: column;
            gap: 5.5px;
            border-top: 1px solid rgba(255,255,255,0.06);
            padding-top: 8px;
            font-size: 11px;
        }
        .acr-dist-row {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .acr-dist-label {
            color: #a1a1aa;
            width: 26px;
            text-align: right;
            flex-shrink: 0;
        }
        .acr-dist-bar-bg {
            flex: 1;
            height: 5px;
            background: rgba(255,255,255,0.08);
            border-radius: 3px;
            overflow: hidden;
        }
        .acr-dist-bar-fill {
            height: 100%;
            border-radius: 3px;
        }
        .acr-dist-val {
            color: #d4d4d8;
            width: 28px;
            text-align: right;
            font-size: 10px;
            font-weight: 500;
            flex-shrink: 0;
        }

        /* ─── 觀看進度/沒看過徽章 (評分下方) ─── */
        .ani-watch-progress-badge {
            position: absolute;
            top: 32px; left: 6px;
            background: rgba(255, 255, 255, 0.95);
            color: #0ea5e9;
            font-size: 10px;
            padding: 3.5px 7px;
            border-radius: 4px;
            font-weight: 700;
            z-index: 10;
            pointer-events: none;
            border: 1px solid rgba(14, 165, 233, 0.35);
            box-shadow: 0 2px 8px rgba(0,0,0,0.08);
            letter-spacing: 0.5px;
            line-height: 1;
            transition: opacity 0.3s ease, filter 0.3s ease;
        }
        .ani-watch-progress-badge.unwatched {
            background: rgba(241, 245, 249, 0.95);
            color: #0ea5e9;
            border: 1px solid rgba(14, 165, 233, 0.4);
            font-weight: 700;
            box-shadow: 0 2px 6px rgba(14, 165, 233, 0.15);
        }

        /* ─── 🛡️ 修正：防雷與完全屏蔽樣式（支援開關完全連動） ─── */
        /* 避雷遮罩作用中 (未停用)：封面模糊去色，但保留評分徽章可見 */
        body:not(.ani-disable-masking) .ani-low-rating-masked {
            filter: grayscale(0.95) opacity(0.2) blur(2.5px) !important;
            transition: filter 0.3s ease, opacity 0.3s ease;
        }
        /* 遮罩狀態下仍顯示評分與觀看進度徽章，方便快速辨識 */
        body:not(.ani-disable-masking) .ani-low-rating-masked .ani-custom-rating,
        body:not(.ani-disable-masking) .ani-low-rating-masked .ani-watch-progress-badge {
            opacity: 1 !important;
            pointer-events: auto !important;
            filter: none !important;
            backdrop-filter: none !important;
            transition: opacity 0.3s ease;
        }

        /* 懸停解鎖還原：在卡片連結 hover 時解除遮罩 */
        /* 使用 descendant 選擇器（空格）而非 child 選擇器（>）*/
        body:not(.ani-disable-masking) a:hover .ani-low-rating-masked,
        body:not(.ani-disable-masking) .theme-list-main:hover .ani-low-rating-masked,
        body:not(.ani-disable-masking) .newanime-block__link:hover .ani-low-rating-masked,
        body:not(.ani-disable-masking) .newanime-block:hover .ani-low-rating-masked,
        body:not(.ani-disable-masking) .theme-img-block:hover .ani-low-rating-masked {
            filter: grayscale(0) opacity(1) blur(0px) !important;
        }

        /* 避雷遮罩關閉 (停用) */
        body.ani-disable-masking .ani-low-rating-masked {
            filter: none !important;
            opacity: 1 !important;
        }
        body.ani-disable-masking .ani-low-rating-masked .ani-custom-rating,
        body.ani-disable-masking .ani-low-rating-masked .ani-watch-progress-badge {
            opacity: 1 !important;
            pointer-events: auto !important;
        }

        /* 完全屏蔽作用中 (未停用) */
        body:not(.ani-disable-blocking) .ani-rating-blocked {
            display: none !important;
        }

        .ani-unwatched-card {
            border: 2px solid rgba(2, 132, 199, 0.55) !important;
            background: rgba(2, 132, 199, 0.03) !important;
            box-shadow: 0 4px 14px rgba(2, 132, 199, 0.15) !important;
            transition: all 0.3s ease !important;
            box-sizing: border-box !important;
        }
        .ani-unwatched-card:hover {
            border-color: rgba(2, 132, 199, 0.95) !important;
            box-shadow: 0 8px 28px rgba(2, 132, 199, 0.3) !important;
        }

        /* 🎯 已觀看封面淡化選擇器：支援首頁新番與各類卡片（防雷遮罩優先） */
        /* 淡化直接作用於帶有 ani-watched-fade 的卡片容器內的 img，涵蓋各種卡片結構 */
        body.ani-watched-fade-enabled .ani-watched-fade > img:not(.ani-low-rating-masked),
        body.ani-watched-fade-enabled .ani-watched-fade .theme-img-block > img:not(.ani-low-rating-masked),
        body.ani-watched-fade-enabled .ani-watched-fade .newanime-block__img > img:not(.ani-low-rating-masked),
        body.ani-watched-fade-enabled .ani-watched-fade .newanime-img > img:not(.ani-low-rating-masked) {
            opacity: 0.32 !important;
            filter: grayscale(0.12) contrast(0.95);
            transition: opacity 0.3s ease, filter 0.3s ease;
        }

        /* 滑鼠 hover 整張卡片時解除淡化 */
        body.ani-watched-fade-enabled .ani-watched-fade:hover > img:not(.ani-low-rating-masked),
        body.ani-watched-fade-enabled .ani-watched-fade:hover .theme-img-block > img:not(.ani-low-rating-masked),
        body.ani-watched-fade-enabled .ani-watched-fade:hover .newanime-block__img > img:not(.ani-low-rating-masked),
        body.ani-watched-fade-enabled .ani-watched-fade:hover .newanime-img > img:not(.ani-low-rating-masked) {
            opacity: 1 !important;
            filter: none !important;
        }

        /* 確保淡化卡片連結/容器能正確觸發 hover */
        body.ani-watched-fade-enabled .ani-watched-fade {
            display: block !important;
            cursor: pointer;
        }

        /* ─── 4. 懸浮按鈕外觀 ─── */
        .ani-float-btn {
            position: fixed;
            right: 20px;
            width: 44px; height: 44px;
            border-radius: 50%;
            background: #18181c;
            border: 1px solid rgba(255,255,255,0.12);
            color: #d4d4d8;
            box-shadow: 0 4px 16px rgba(0,0,0,0.5);
            display: none;
            align-items: center !important;
            justify-content: center !important;
            text-align: center !important;
            cursor: pointer;
            font-size: 16px;
            font-weight: bold;
            z-index: 9999;
            transition: all 0.2s ease;
            user-select: none;
            padding: 0 !important;
            line-height: 1 !important;
            box-sizing: border-box !important;
        }
        .ani-float-btn:hover {
            transform: scale(1.08);
            background: #27272a;
            color: #3b82f6;
            border-color: rgba(59, 130, 246, 0.4);
        }
        .ani-float-btn.active {
            background: #3b82f6 !important;
            color: #ffffff !important;
            border-color: #2563eb !important;
            box-shadow: 0 4px 20px rgba(59, 130, 246, 0.4) !important;
        }

        #ani-sort-float-btn  { bottom: 85px; font-size: 15px; }
        #ani-mask-float-btn  { bottom: 135px; }
        #ani-block-float-btn { bottom: 185px; }
        #ani-config-float-btn { bottom: 235px; }

        /* ─── 頂部自動加載進度條樣式 ─── */
        #ani-sort-progress-bar {
            position: fixed;
            top: 0; left: 0;
            height: 3px;
            background: #3b82f6;
            z-index: 1000000;
            width: 0%;
            transition: width 0.15s ease, opacity 0.3s ease;
            box-shadow: 0 0 10px rgba(59, 130, 246, 0.5);
            opacity: 0;
        }

        /* ─── 頂部下滑彈出式 Toast 提示窗 ─── */
        #ani-rating-toast {
            position: fixed;
            top: 24px; left: 50%;
            transform: translate(-50%, -40px);
            background: rgba(20, 20, 23, 0.96);
            border: 1.5px solid #3b82f6;
            color: #ffffff;
            padding: 10px 22px;
            border-radius: 24px;
            font-size: 12.5px;
            font-weight: 600;
            box-shadow: 0 12px 32px rgba(0,0,0,0.6);
            z-index: 1000000;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.35s cubic-bezier(0.16, 1, 0.3, 1), transform 0.35s cubic-bezier(0.16, 1, 0.3, 1);
            text-align: center;
            white-space: nowrap;
        }
        #ani-rating-toast.show {
            opacity: 1;
            transform: translate(-50%, 0);
        }

        /* ─── 功能導覽樣式 ─── */
        #ani-rating-tour-overlay {
            position: fixed; inset: 0;
            background: rgba(0, 0, 0, 0.75);
            backdrop-filter: blur(5px);
            z-index: 1000000;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: system-ui, -apple-system, sans-serif;
        }
        #ani-rating-tour-card {
            background: #18181c;
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 16px;
            width: 320px;
            padding: 20px;
            color: #f4f4f7;
            box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
            display: flex;
            flex-direction: column;
            gap: 16px;
        }
        .artc-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .artc-step-num {
            font-size: 11px;
            color: #3b82f6;
            font-weight: 700;
        }
        .artc-close-btn {
            background: none; border: none; color: #71717a; cursor: pointer; font-size: 14px;
        }
        .artc-close-btn:hover { color: #f4f4f7; }
        .artc-body {
            display: flex;
            flex-direction: column;
            gap: 10px;
            text-align: center;
        }
        .artc-title {
            font-size: 16px;
            font-weight: 700;
            color: #ffffff;
        }
        .artc-desc {
            font-size: 13px;
            color: #a1a1aa;
            line-height: 1.5;
        }
        .artc-indicators {
            display: flex;
            justify-content: center;
            gap: 6px;
            margin-top: 8px;
        }
        .artc-dot {
            width: 6px; height: 6px;
            border-radius: 50%;
            background: #3f3f46;
            transition: background 0.2s;
        }
        .artc-dot.active {
            background: #3b82f6;
            width: 12px;
            border-radius: 3px;
        }
        .artc-footer {
            display: flex;
            gap: 8px;
            margin-top: 4px;
        }
        .artc-btn {
            flex: 1;
            padding: 8px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            border: none;
            transition: background 0.2s;
        }
        .artc-btn-skip {
            background: rgba(255,255,255,0.05);
            color: #a1a1aa;
            border: 1px solid rgba(255,255,255,0.08);
        }
        .artc-btn-skip:hover { background: rgba(255,255,255,0.1); color: #ffffff; }
        .artc-btn-next {
            background: #3b82f6;
            color: white;
        }
        .artc-btn-next:hover { background: #2563eb; }

        /* ─── 設定面板跟隨網站主題 ─── */
        #ani-rating-overlay {
            position: fixed; inset: 0;
            background: rgba(0, 0, 0, 0.55);
            backdrop-filter: blur(4px);
            z-index: 999998;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        #ani-rating-modal {
            background: #ffffff;
            border: 1px solid rgba(0,0,0,0.12);
            border-radius: 16px;
            width: 420px;
            max-width: 90vw;
            overflow: visible;
            color: #202020;
            font-family: system-ui, -apple-system, sans-serif;
            box-shadow: 0 20px 40px rgba(0,0,0,0.15);
        }
        .arm-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 20px;
            border-bottom: 1px solid rgba(0,0,0,0.06);
            background: #f8f9fa;
            border-radius: 16px 16px 0 0;
        }
        .arm-header-left { display: flex; align-items: center; gap: 10px; }
        .arm-icon {
            width: 32px; height: 32px;
            border-radius: 8px;
            background: rgba(59, 130, 246, 0.12);
            display: flex; align-items: center; justify-content: center;
            font-size: 16px;
        }
        .arm-title { font-size: 15px; font-weight: 700; color: #111111; }
        .arm-subtitle { font-size: 11px; color: #666666; margin-top: 1px; }
        .arm-close {
            width: 28px; height: 28px;
            border-radius: 8px;
            border: 1px solid rgba(0,0,0,0.08);
            background: #ffffff;
            color: #666666;
            display: flex; align-items: center; justify-content: center;
            cursor: pointer;
            font-size: 12px;
            transition: all 0.2s;
        }
        .arm-close:hover { background: #f1f3f5; color: #111111; }

        .arm-body {
            padding: 20px;
            display: flex;
            flex-direction: column;
            gap: 18px;
            max-height: 65vh;
            overflow-y: auto;
        }
        .arm-section {
            display: flex;
            flex-direction: column;
            gap: 4px;
            border-bottom: 1px solid rgba(0,0,0,0.06);
            padding-bottom: 16px;
        }
        .arm-section:last-of-type {
            border-bottom: none;
            padding-bottom: 0;
        }
        .arm-section-header {
            font-size: 11.5px;
            font-weight: 700;
            color: #0284c7;
            letter-spacing: 0.5px;
            margin-bottom: 8px;
        }

        .arm-list-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 8px 0;
            border-bottom: 1px solid rgba(0,0,0,0.04);
        }
        .arm-list-item:last-of-type {
            border-bottom: none;
        }
        .arm-list-left {
            display: flex;
            flex-direction: column;
            gap: 2px;
            flex: 1;
        }
        .arm-list-title { font-size: 13px; font-weight: 600; color: #111111; }
        .arm-list-desc  { font-size: 11px; color: #666666; line-height: 1.3; }

        .arm-toggle-pill {
            width: 38px; height: 20px;
            border-radius: 10px;
            background: #e4e4e7;
            position: relative;
            cursor: pointer;
            transition: background 0.2s;
            flex-shrink: 0;
        }
        .arm-toggle-pill.on { background: #0284c7; }
        .arm-toggle-pill::after {
            content: '';
            position: absolute;
            width: 16px; height: 16px;
            border-radius: 50%;
            background: white;
            top: 2px; left: 2px;
            transition: transform 0.2s;
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        }
        .arm-toggle-pill.on::after { transform: translateX(18px); }

        .arm-field-row {
            display: flex;
            align-items: center;
            gap: 5px;
            flex-shrink: 0;
        }
        .arm-field-row input {
            width: 72px;
            background: #ffffff;
            border: 1px solid #cccccc;
            border-radius: 6px;
            color: #111111;
            font-size: 12px;
            font-weight: 600;
            padding: 5px 8px;
            outline: none;
            text-align: center;
            transition: border-color 0.2s;
            min-width: 60px;
        }
        .arm-field-row input:focus { border-color: #3b82f6; }
        .arm-field-unit { font-size: 11px; color: #666666; font-weight: 500; flex-shrink: 0; }

        .arm-cache-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding-top: 12px;
            margin-top: 4px;
            border-top: 1px dashed rgba(0,0,0,0.08);
        }
        .arm-cache-left { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #444444; font-weight: 500; }
        .arm-cache-badge {
            font-size: 10px;
            background: rgba(34, 197, 94, 0.12);
            color: #166534;
            border-radius: 4px;
            padding: 2px 6px;
            font-weight: 600;
        }
        .arm-cache-clear {
            font-size: 11px;
            color: #dc2626;
            cursor: pointer;
            background: none;
            border: none;
            font-weight: 600;
        }
        .arm-cache-clear:hover { text-decoration: underline; }

        .arm-footer {
            display: flex;
            gap: 8px;
            padding: 14px 20px 18px;
            border-top: 1px solid rgba(0,0,0,0.06);
            background: #f8f9fa;
            border-radius: 0 0 16px 16px;
        }
        .arm-btn {
            flex: 1;
            padding: 9px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            transition: opacity 0.15s;
            border: none;
        }
        .arm-btn:active { opacity: 0.8; }
        .arm-btn-cancel {
            background: #ffffff;
            color: #555555;
            border: 1px solid #dcdcdc;
        }
        .arm-btn-save {
            flex: 2;
            background: #3b82f6;
            color: white;
        }
        .arm-btn-save:hover { background: #2563eb; }

        /* ─── 3. 深色模式自適應跟隨（優先跟隨網站真人開關，關聯強化對比） ─── */
        body.ani-user-dark-mode #ani-rating-modal {
            background: #18181c !important;
            color: #f4f4f5 !important;
            border-color: rgba(255,255,255,0.14) !important;
            box-shadow: 0 25px 50px -12px rgba(0,0,0,0.9) !important;
        }
        body.ani-user-dark-mode .arm-header,
        body.ani-user-dark-mode .arm-footer {
            background: rgba(0,0,0,0.25) !important;
            border-color: rgba(255,255,255,0.1) !important;
            border-radius: 16px 16px 0 0 !important;
        }
        body.ani-user-dark-mode .arm-footer {
            border-radius: 0 0 16px 16px !important;
        }
        body.ani-user-dark-mode .arm-title { color: #ffffff !important; }
        body.ani-user-dark-mode .arm-subtitle { color: #d4d4d8 !important; }

        body.ani-user-dark-mode .arm-close {
            border-color: rgba(255,255,255,0.16) !important;
            background: rgba(255,255,255,0.08) !important;
            color: #e4e4e7 !important;
        }
        body.ani-user-dark-mode .arm-close:hover {
            background: rgba(255,255,255,0.16) !important;
            color: #ffffff !important;
        }
        body.ani-user-dark-mode .arm-section { border-color: rgba(255,255,255,0.1) !important; }
        body.ani-user-dark-mode .arm-section-header { color: #60a5fa !important; }
        body.ani-user-dark-mode .arm-list-item { border-color: rgba(255,255,255,0.08) !important; }
        body.ani-user-dark-mode .arm-list-title { color: #f4f4f5 !important; }
        body.ani-user-dark-mode .arm-list-desc { color: #d4d4d8 !important; }
        body.ani-user-dark-mode .arm-toggle-pill { background: #52525b !important; }
        body.ani-user-dark-mode .arm-toggle-pill.on { background: #3b82f6 !important; }

        body.ani-user-dark-mode .arm-field-row input {
            background: rgba(255,255,255,0.08) !important;
            border-color: rgba(255,255,255,0.18) !important;
            color: #f4f4f5 !important;
        }
        body.ani-user-dark-mode .arm-field-row input:focus { border-color: #3b82f6 !important; }
        body.ani-user-dark-mode .arm-field-unit { color: #d4d4d8 !important; }
        body.ani-user-dark-mode .arm-cache-row { border-color: rgba(255,255,255,0.1) !important; }
        body.ani-user-dark-mode .arm-cache-left { color: #d4d4d8 !important; }
        body.ani-user-dark-mode .arm-cache-badge {
            background: rgba(34, 197, 94, 0.2) !important;
            color: #4ade80 !important;
        }
        body.ani-user-dark-mode .arm-cache-clear { color: #f87171 !important; }
        body.ani-user-dark-mode .arm-btn-cancel {
            background: rgba(255,255,255,0.1) !important;
            color: #e4e4e7 !important;
            border-color: rgba(255,255,255,0.08) !important;
        }

        /* 深色模式下恢復評分與觀看徽章為深色背景，避免淺色樣式殘留 */
        body.ani-user-dark-mode .ani-custom-rating {
            background: rgba(10, 10, 12, 0.85) !important;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5) !important;
        }
        body.ani-user-dark-mode .acr-tier-mythical {
            color: #ff2a6d !important;
            border-color: rgba(255, 42, 109, 0.65) !important;
            background: rgba(18, 10, 14, 0.9) !important;
            box-shadow: 0 0 10px rgba(255, 42, 109, 0.4) !important;
        }
        body.ani-user-dark-mode .acr-tier-excellent {
            color: #FFD700 !important;
            border-color: rgba(255, 215, 0, 0.5) !important;
            background: rgba(16, 14, 10, 0.85) !important;
        }
        body.ani-user-dark-mode .acr-tier-good {
            color: #05ffc4 !important;
            border-color: rgba(5, 255, 196, 0.4) !important;
        }
        body.ani-user-dark-mode .acr-tier-average {
            color: #94a3b8 !important;
            border-color: rgba(148, 163, 184, 0.35) !important;
        }
        body.ani-user-dark-mode .acr-tier-poor {
            color: #ff5f5f !important;
            border-color: rgba(255, 95, 95, 0.45) !important;
            background: rgba(22, 10, 10, 0.9) !important;
        }
        body.ani-user-dark-mode .acr-low-sample {
            color: #fbbf24 !important;
            border: 2px solid #f59e0b !important;
            background: rgba(120, 80, 20, 0.25) !important;
            box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.4), 0 2px 8px rgba(245, 158, 11, 0.3) !important;
            animation: acr-pulse-warning 2s infinite !important;
        }

        body.ani-user-dark-mode .ani-watch-progress-badge {
            background: rgba(15, 23, 42, 0.9) !important;
            color: #38bdf8 !important;
            border-color: rgba(56, 189, 248, 0.35) !important;
            box-shadow: 0 2px 8px rgba(0,0,0,0.6) !important;
        }
        body.ani-user-dark-mode .ani-watch-progress-badge.unwatched {
            background: rgba(24, 24, 27, 0.85) !important;
            color: #a1a1aa !important;
            border-color: rgba(255, 255, 255, 0.08) !important;
        }
    `;
    document.head.appendChild(style);

    // ── 偵測網站深色模式並同步 UI ──────────────────────────────────
    function syncDarkMode() {
        const isDark = document.getElementById('darkmode-moon')?.checked || false;
        document.body.classList.toggle('ani-user-dark-mode', isDark);
    }

    function setupDarkModeObserver() {
        syncDarkMode();
        let found = false;
        const waitForSetting = setInterval(() => {
            const settingContainer = document.querySelector('.dark-mode-setting');
            if (settingContainer && !found) {
                found = true;
                clearInterval(waitForSetting);
                const observer = new MutationObserver(() => {
                    syncDarkMode();
                });
                observer.observe(settingContainer, {
                    attributes: true,
                    subtree: true,
                    attributeFilter: ['checked', 'class', 'style']
                });
                // 額外監聽 radio change，確保即時切換
                const moonBtn = document.getElementById('darkmode-moon');
                const sunBtn = document.getElementById('darkmode-sun');
                if (moonBtn) moonBtn.addEventListener('change', syncDarkMode);
                if (sunBtn) sunBtn.addEventListener('change', syncDarkMode);
                // 啟動後定期檢查，處理動態重新載入的主題設定
                let checks = 0;
                const poll = setInterval(() => {
                    syncDarkMode();
                    checks++;
                    if (checks > 20) clearInterval(poll);
                }, 400);
            }
        }, 500);
    }
    setupDarkModeObserver();

    // ── 4. 核心：處理單一動畫封面 ───────────────────────────────────
    let originalOrderCounter = 0; // 用於一鍵排序回復預設狀態
    let watchedAnimeMap = new Map(); // 鍵：乾淨標題, 值：觀看進度/集數字串

    // 從本地快取載入觀看紀錄 MAP 名單
    try {
        const savedList = localStorage.getItem('aniRating_watchedList');
        if (savedList) {
            const parsedList = JSON.parse(savedList);
            if (Array.isArray(parsedList)) {
                if (parsedList.length > 0 && typeof parsedList[0] === 'string') {
                    console.log('[評分美化] 偵測到舊版觀看紀錄格式，正在自動安全轉換...');
                    const converted = parsedList.map(title => [title, "已看過"]);
                    watchedAnimeMap = new Map(converted);
                } else {
                    watchedAnimeMap = new Map(parsedList);
                }
                console.log('[評分美化] 成功自本地快取載入已觀看動畫與進度列表，筆數：', watchedAnimeMap.size);
            }
        }
    } catch (cacheErr) {
        console.warn('[評分美化] 載入本地歷史紀錄快取失敗，重設為空：', cacheErr);
        watchedAnimeMap = new Map();
    }

    // 將觀看歷史快取到本地的防禦寫入函式
    function saveWatchedListToLocal() {
        try {
            localStorage.setItem('aniRating_watchedList', JSON.stringify(Array.from(watchedAnimeMap.entries())));
        } catch (e) {
            console.error('[評分美化] 本地快取寫入失敗：', e);
        }
    }

    // 洗滌標題，統一清除多餘元件與集數標記
    function cleanAnimeTitle(titleStr) {
        if (!titleStr) return '';
        let cleanTitle = titleStr;

        cleanTitle = cleanTitle.replace(/play_arrow/g, '')
                               .replace(/skip_next/g, '')
                               .replace(/下一集/g, '')
                               .replace(/[\n\r\t]/g, '')
                               .trim();

        // 移除常見的集數格式 (保留數字以便後續判斷)
        cleanTitle = cleanTitle
            .replace(/\s*\[\d+\]\s*$/, '')
            .replace(/\s*第\s*\d+\s*[集話]\s*$/, '')
            .replace(/\s*第\s*\d+\s*季\s*(\[\d+\])?\s*$/, '')
            .replace(/\s*\[雙語\]\s*$/, '')
            .trim();

        return cleanTitle;
    }

    // 提取標題中的總集數或集數資訊 (輔助函式)
    function extractEpisodeInfo(titleStr) {
        const match = titleStr.match(/第\s*(\d+)\s*[集話]/);
        return match ? parseInt(match[1]) : null;
    }

    // 驗證解析到的名稱是否為真正的動畫標題
    function isValidAnimeTitle(title) {
        if (!title || title.length <= 1 || title.length > 80) return false;

        const blockedWords = [
            '展開', '摺疊', '折疊', '確定', '取消', '下一集', '上一集', '播放', '暫停',
            '會員', '我的追番', '觀看紀錄', '設定', '訂閱', '分享', '刪除', '確定刪除',
            '隱私', '個人首頁', '登出', '登入', '註冊', '搜尋', '尋找', '熱門', '精選',
            '版權所有', '服務條款', '聯絡我們', '關於我們', '已看過', '看至', '觀看至',
            '已更新至', '更新至', '分', '秒', '小時', 'APP', 'VIP', 'AD', 'PR', 'close',
            'skip_next', 'play_arrow', 'expand_more', 'star_rate', 'keyboard_arrow_down'
        ];

        if (blockedWords.some(word => title.toLowerCase().includes(word))) return false;
        if (/^\d+$/.test(title)) return false;
        if (/\d+年\d+月/.test(title)) return false;

        return true;
    }

    // ── 4.2 歷史紀錄網頁 DOM 深度剖析 ──
    function parseDocumentTitles(doc, isAjax = false, isHomepage = false) {
        if (!doc) return;

        let target = doc;
        let updated = false;

        if (isHomepage) {
            const historyBlock = doc.querySelector('.member-history, .history-block, .history-list');
            if (historyBlock) {
                target = historyBlock;
            } else {
                return;
            }
        }

        // 🎯 1. 優先精準解析卡片結構 (.anime-card 結構，用於 /viewList.php 歷史頁面)
        const cards = target.querySelectorAll('.anime-card');
        if (cards.length > 0) {
            cards.forEach(card => {
                const titleEl = card.querySelector('.history-anime-title');
                const lastwatchEl = card.querySelector('.history-lastwatch'); // 包含 "觀看至 X 集" 或 "觀看結束" 的容器

                if (titleEl) {
                    const rawTitle = titleEl.textContent || '';
                    const clean = cleanAnimeTitle(rawTitle);
                    if (isValidAnimeTitle(clean)) {
                        let progress = "已看過";

                        if (lastwatchEl) {
                            const text = lastwatchEl.textContent || '';
                            if (text.includes('觀看結束')) {
                                progress = "已看完";
                            } else {
                                // 提取 "觀看至 9 集" 或是 "觀看至 13B 集"
                                const match = text.match(/觀看至\s*(\S+)\s*集/);
                                if (match && match[1]) {
                                    progress = `看至 ${match[1]} 集`;
                                } else if (text.includes('觀看至')) {
                                    progress = "看至部分";
                                }
                            }
                        }

                        if (watchedAnimeMap.get(clean) !== progress) {
                            watchedAnimeMap.set(clean, progress);
                            updated = true;
                        }
                    }
                }
            });
        }

        // 🎯 2. 備用與首頁搜救機制：解析所有單純的 history-anime-title 標籤與 data-title 屬性
        const titleElements = target.querySelectorAll('.history-anime-title, .delete-btn[data-title]');
        titleElements.forEach(el => {
            let rawTitle = '';
            if (el.hasAttribute('data-title')) {
                rawTitle = el.getAttribute('data-title') || '';
            } else {
                rawTitle = el.textContent || '';
            }
            let clean = cleanAnimeTitle(rawTitle);
            if (isValidAnimeTitle(clean)) {
                let progressText = "已看過";
                const parentCard = el.closest('.user-watch-list, .anime-card, li, div');
                if (parentCard) {
                    const userLastwatch = parentCard.querySelector('.user-lastwatch');
                    const isFinished = parentCard.textContent.includes('觀看結束');
                    if (userLastwatch) {
                        progressText = `看至 ${userLastwatch.textContent.trim()} 集`;
                        if (isFinished) progressText += " (已看完)";
                    } else if (isFinished) {
                        progressText = "已看完";
                    }
                }
                if (watchedAnimeMap.get(clean) !== progressText) {
                    watchedAnimeMap.set(clean, progressText);
                    updated = true;
                }
            }
        });

        // 🎯 3. 終極搜救防禦：直接撈取容器內所有帶有 sn 且具有文字標題的動畫 A 連結 (首頁小組件專用)
        const historyLinks = target.querySelectorAll('a[href*="animeVideo.php?sn="]');
        historyLinks.forEach(link => {
            if (link.classList.contains('next-btn') || link.classList.contains('play-btn')) return;

            const titleEl = link.querySelector('.history-anime-title') || link.querySelector('p, span, h3');
            if (titleEl) {
                let clean = cleanAnimeTitle(titleEl.textContent);
                if (isValidAnimeTitle(clean) && !watchedAnimeMap.has(clean)) {
                    watchedAnimeMap.set(clean, "已看過");
                    updated = true;
                }
            }
        });

        if (updated) {
            saveWatchedListToLocal();
        }
    }

    // ── 4.3 智慧 DOM 同步引擎 ──
    function syncWatchedHistoryFromDOM() {
        const beforeCount = watchedAnimeMap.size;

        // 💡 1. 偵測當前是否在觀看紀錄頁面
        if (window.location.pathname.includes('viewList.php')) {
            parseDocumentTitles(document, false, false);
        }

        // 💡 2. 偵測首頁或導覽列的「最近看過」組件 (免開啟紀錄頁也能在瀏覽時自動更新)
        const homeHistoryBlock = document.querySelector('.member-history, .history-block, .history-list');
        if (homeHistoryBlock) {
            parseDocumentTitles(homeHistoryBlock, false, true);
        }

        if (watchedAnimeMap.size > beforeCount) {
            console.log(`[評分美化] 觀看紀錄同步成功！新增 ${watchedAnimeMap.size - beforeCount} 筆作品，總計：${watchedAnimeMap.size} 筆`);
            applyWatchedFadeToPage();
        }
    }

    // ── 4.4 背景完整歷史紀錄拉取（使用官方 API，支援分頁） ──
    async function fetchHistoryInBackground() {
        try {
            console.log('[評分美化] 正在背景同步完整觀看紀錄...');
            const API_URL = 'https://api.gamer.com.tw/anime/v3/history.php';
            let updated = false;
            let page = 1;
            let totalPage = 1;

            while (page <= totalPage) {
                const res = await smartFetch(`${API_URL}?page=${page}`);
                if (!res) break;

                const json = await res.json();
                const data = json?.data;
                if (!data?.history?.length) break;

                totalPage = data.totalPage || 1;

                for (const item of data.history) {
                    const cleanTitle = cleanAnimeTitle(item.title);
                    if (!isValidAnimeTitle(cleanTitle)) continue;

                    let progress = '已看過';
                    if (item.breakPoint?.breakPoint === -1) {
                        progress = '已看完';
                    } else if (item.episode > 0) {
                        progress = `看至 ${item.episode} 集`;
                    }

                    if (watchedAnimeMap.get(cleanTitle) !== progress) {
                        watchedAnimeMap.set(cleanTitle, progress);
                        updated = true;
                    }
                }

                page++;
                // API 分頁請求間隔
                await new Promise(r => setTimeout(r, 300));
            }

            if (updated) {
                saveWatchedListToLocal();
                console.log(`[評分美化] API 同步完成！共 ${watchedAnimeMap.size} 筆觀看紀錄`);
                applyWatchedFadeToPage();
            } else if (watchedAnimeMap.size > 0) {
                console.log(`[評分美化] API 同步完成，無新增紀錄（目前 ${watchedAnimeMap.size} 筆）`);
                applyWatchedFadeToPage();
            } else {
                console.log('[評分美化] API 同步完成，但未取得任何觀看紀錄（可能尚未登入或無紀錄）');
            }
        } catch (e) {
            console.error('[評分美化] API 同步觀看紀錄失敗', e);
        }
    }

    // ── 🎯 智慧型封面縮圖容器定位器 ──
    function getThumbnailContainer(cardLink) {
        if (!cardLink) return null;
        const container = cardLink.querySelector('.theme-img-block, .newanime-block__img, .newanime-img, .postimg, .anime-card-img');
        if (container) return container;

        const img = cardLink.querySelector('img');
        if (img) {
            const parent = img.parentElement;
            if (parent && parent !== cardLink) {
                if (window.getComputedStyle(parent).position === 'static') {
                    parent.style.position = 'relative';
                }
                return parent;
            }
        }
        return null;
    }

    // ── 5. 評分相關功能與視覺處理 ───────────────────────────────
    // 偵測與套用觀看歷史進度與淡化
    function checkAndApplyWatchedFade(cardLink) {
        if (!cardLink) return;

        const container = getThumbnailContainer(cardLink);
        if (!container) return;

        // 移除現有的觀看進度/沒看過標籤
        const oldBadge = container.querySelector('.ani-watch-progress-badge');
        if (oldBadge) oldBadge.remove();

        // A. 偵測既有官網 DOM 結構 (例如：首頁與部分列表的原生看過標記)
        const hasWatchedIndicator = cardLink.querySelector('.theme-barrier, .theme-watch, .theme-progress') !== null;
        let officialWatchText = "";

        const textContainers = cardLink.querySelectorAll('span, p, div');
        for (let el of textContainers) {
            const text = el.textContent || '';
            if (text.includes('已看過') || text.includes('看至第') || text.includes('觀看進度')) {
                officialWatchText = text.trim();
                break;
            }
        }

        // B. 透過歷史紀錄比對
        let historyProgress = "";

        const cardTitleEl = cardLink.querySelector('.theme-name, .theme-title, .newanime-title, h1, h2, h3');
        let cardTitle = '';
        if (cardTitleEl) {
            cardTitle = cardTitleEl.textContent.trim();
        } else {
            const fallbackEl = cardLink.querySelector('p, span');
            if (fallbackEl) {
                cardTitle = fallbackEl.textContent.trim();
            }
        }

        if (cardTitle && watchedAnimeMap.size > 0) {
            const cleanCardTitle = cleanAnimeTitle(cardTitle);
            for (let [historyTitle, progress] of watchedAnimeMap.entries()) {
                if (historyTitle === cleanCardTitle) {
                    historyProgress = progress;
                    break;
                }
                if (cleanCardTitle.length >= 3 && historyTitle.length >= 3) {
                    if (historyTitle.includes(cleanCardTitle) || cleanCardTitle.includes(historyTitle)) {
                        historyProgress = progress;
                        break;
                    }
                }
            }
        }

        const isWatched = hasWatchedIndicator || officialWatchText !== "" || historyProgress !== "";

        const progressBadge = document.createElement('div');
        progressBadge.className = 'ani-watch-progress-badge';

        if (isWatched) {
            cardLink.classList.add('ani-watched-fade');
            cardLink.classList.remove('ani-unwatched-card');

            let displayLabel = "已觀看";
            if (historyProgress) {
                // 將 "看至 X 集" 改為更專業的 "觀看進度：第 X 集"
                const epMatch = historyProgress.match(/看至\s*(\d+)\s*集/);
                if (epMatch) {
                    displayLabel = `觀看進度：第 ${epMatch[1]} 話`;
                } else {
                    displayLabel = historyProgress.replace('看至', '觀看進度：');
                }
            } else if (officialWatchText) {
                const matchEp = officialWatchText.match(/看至第\s*(\d+)\s*集/);
                if (matchEp) {
                    displayLabel = `觀看進度：第 ${matchEp[1]} 話`;
                }
            }
            progressBadge.textContent = displayLabel;
        } else {
            cardLink.classList.remove('ani-watched-fade');
            cardLink.classList.add('ani-unwatched-card');
            progressBadge.classList.add('unwatched');
            progressBadge.textContent = "尚未觀看";
        }

        container.appendChild(progressBadge);
    }

    // 全域刷新已觀看視覺淡化
    function applyWatchedFadeToPage() {
        document.querySelectorAll(MAIN_CARD_SELECTORS).forEach(link => {
            checkAndApplyWatchedFade(link);
        });
    }

    async function processItem(item) {
        if (!config.enabled || !item.container) return;

        const cardLink = item.container.closest('a') || item.container.closest('.theme-list-main, .newanime-block__link');
        if (cardLink && !cardLink.hasAttribute('data-orig-index')) {
            cardLink.setAttribute('data-orig-index', originalOrderCounter++);
        }

        checkAndApplyWatchedFade(cardLink);

        const cached = getCacheItem(item.sn);
        if (cached) {
            renderRating(item.container, cached);
            applyFilterIfNeeded(item.container, cached.score);
            return;
        }

        const skeleton = document.createElement('div');
        skeleton.className = 'ani-rating-skeleton';
        item.container.appendChild(skeleton);

        try {
            if (config.delay > 0) {
                await new Promise(r => setTimeout(r, config.delay));
            }

            const res = await smartFetch(`/animeRef.php?sn=${item.sn}`);
            const html = await res.text();

            const scoreMatch = html.match(/"ratingValue"\s*:\s*"?([0-9.]+)"?/);
            const countMatch = html.match(/"ratingCount"\s*:\s*"?([0-9]+)"?/);

            skeleton.remove();

            if (scoreMatch && countMatch) {
                const rawScore = parseFloat(scoreMatch[1]);
                const count = parseInt(countMatch[1]);

                const score = rawScore > 5 ? rawScore / 2 : rawScore;

                setCacheItem(item.sn, score, count);

                const data = { score, count };
                renderRating(item.container, data);
                applyFilterIfNeeded(item.container, score);
            }
        } catch (e) {
            if (skeleton) skeleton.remove();
            console.error('[評分美化] 抓取評分時出錯: SN ' + item.sn, e);
        }
    }

    function renderRating(container, data) {
        if (!container || container.querySelector('.ani-custom-rating')) return;

        const score = parseFloat(data.score);
        const count = parseInt(data.count);
        const countFormatted = count.toLocaleString('zh-TW');

        const cardLink = container.closest('a') || container.closest('.theme-list-main, .newanime-block__link');
        if (cardLink) {
            cardLink.setAttribute('data-rating-score', score);
            checkAndApplyWatchedFade(cardLink);
        }

        const isLowSample = count < config.sampleThreshold;

        let tierClass = 'acr-tier-average';
        let recommText = '普通評價';
        let recommColor = '#94a3b8';
        let recommBg = 'rgba(148, 163, 184, 0.15)';

        if (isLowSample) {
            tierClass = 'acr-low-sample';
            recommText = '評估人數過少';
            recommColor = '#a1a1aa';
            recommBg = 'rgba(161, 161, 170, 0.12)';
        } else if (score >= 4.8) {
            tierClass = 'acr-tier-mythical';
            recommText = '神作必看';
            recommColor = '#ff2a6d';
            recommBg = 'rgba(255, 42, 109, 0.15)';
        } else if (score >= 4.5) {
            tierClass = 'acr-tier-excellent';
            recommText = '極力推薦';
            recommColor = '#FFD700';
            recommBg = 'rgba(255, 215, 0, 0.15)';
        } else if (score >= 4.0) {
            tierClass = 'acr-tier-good';
            recommText = '佳作推薦';
            recommColor = '#05ffc4';
            recommBg = 'rgba(5, 255, 196, 0.15)';
        } else if (score >= 3.5) {
            tierClass = 'acr-tier-average';
            recommText = '中規中矩';
            recommColor = '#94a3b8';
            recommBg = 'rgba(148, 163, 184, 0.15)';
        } else {
            tierClass = 'acr-tier-poor';
            recommText = '雷作避難';
            recommColor = '#ff5f5f';
            recommBg = 'rgba(255, 95, 95, 0.15)';
        }

        const distribution = generateStarDistribution(score);

        const badge = document.createElement('div');
        badge.className = `ani-custom-rating ${tierClass}`;
        badge.style.fontSize = `${config.fontSize}px`;
        badge.style.borderRadius = `${config.radius}px`;

        badge.innerHTML = `
            ★${score.toFixed(1)}${isLowSample ? ' ⚠️' : ''}
            <span class="acr-sep"></span>
            <span class="acr-count">${countFormatted}人</span>

            <div class="acr-tooltip">
                <div class="acr-tooltip-title">
                    <span>評分細節分佈</span>
                    <span class="acr-tooltip-recomm" style="color: ${recommColor}; background: ${recommBg}">${recommText}</span>
                </div>
                ${isLowSample ? `<div style="font-size: 11px; color: #f87171; margin-bottom: 8px; text-align: center;">⚠️ 評價人數過少，分數信賴度低</div>` : ''}
                <div class="acr-tooltip-dist">
                    <div class="acr-dist-row">
                        <span class="acr-dist-label">5 星</span>
                        <div class="acr-dist-bar-bg">
                            <div class="acr-dist-bar-fill" style="width: ${distribution[5]}%; background: ${recommColor}"></div>
                        </div>
                        <span class="acr-dist-val">${distribution[5]}%</span>
                    </div>
                    <div class="acr-dist-row">
                        <span class="acr-dist-label">4 星</span>
                        <div class="acr-dist-bar-bg">
                            <div class="acr-dist-bar-fill" style="width: ${distribution[4]}%; background: #94a3b8"></div>
                        </div>
                        <span class="acr-dist-val">${distribution[4]}%</span>
                    </div>
                    <div class="acr-dist-row">
                        <span class="acr-dist-label">3 星</span>
                        <div class="acr-dist-bar-bg">
                            <div class="acr-dist-bar-fill" style="width: ${distribution[3]}%; background: #4b4b50"></div>
                        </div>
                        <span class="acr-dist-val">${distribution[3]}%</span>
                    </div>
                    <div class="acr-dist-row">
                        <span class="acr-dist-label">2 星</span>
                        <div class="acr-dist-bar-bg">
                            <div class="acr-dist-bar-fill" style="width: ${distribution[2]}%; background: #ff5f5f"></div>
                        </div>
                        <span class="acr-dist-val">${distribution[2]}%</span>
                    </div>
                    <div class="acr-dist-row">
                        <span class="acr-dist-label">1 星</span>
                        <div class="acr-dist-bar-bg">
                            <div class="acr-dist-bar-fill" style="width: ${distribution[1]}%; background: #991b1b"></div>
                        </div>
                        <span class="acr-dist-val">${distribution[1]}%</span>
                    </div>
                </div>
            </div>
        `;

        badge.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });

        container.appendChild(badge);

        // 將觀看進度徽章移到評分徽章正下方
        const progressBadge = container.querySelector('.ani-watch-progress-badge');
        if (progressBadge) {
            const topOffset = 6;
            const ratingHeight = badge.offsetHeight || 22;
            const gap = 4;
            progressBadge.style.top = `${topOffset + ratingHeight + gap}px`;
            progressBadge.style.bottom = 'auto';
        }

        updateActionButtonsVisibility();

        if (isSortedByRating) {
            triggerSortDebounced();
        }
    }

    function applyFilterIfNeeded(container, score) {
        if (!container) return;

        const cardLink = container.closest('a') || container.closest('.theme-list-main, .newanime-block__link');
        // 直接套用在圖片元素上，避免 filter 波及評分與進度 badge
        if (cardLink) {
            const img = cardLink.querySelector('img');
            if (img) {
                if (score < config.threshold) {
                    img.classList.add('ani-low-rating-masked');
                    // 直接在 img 上綁定 mouseenter/mouseleave，確保可靠觸發
                    if (!img.hasAttribute('data-mask-hover-bound')) {
                        img.setAttribute('data-mask-hover-bound', 'true');
                        img.style.pointerEvents = 'auto'; // 確保 img 能接收滑鼠事件
                        img.addEventListener('mouseenter', function() {
                            this.style.setProperty('filter', 'grayscale(0) opacity(1) blur(0px)', 'important');
                        });
                        img.addEventListener('mouseleave', function() {
                            if (this.classList.contains('ani-low-rating-masked')) {
                                this.style.removeProperty('filter');
                            }
                        });
                    }
                } else {
                    img.classList.remove('ani-low-rating-masked');
                }
            }
        }

        // 完全屏蔽：優先直接作用在卡片連結本身，確保單卡能被正確隱藏
        const blockTarget = cardLink || container;
        if (score < config.blockThreshold) {
            blockTarget.classList.add('ani-rating-blocked');
        } else {
            blockTarget.classList.remove('ani-rating-blocked');
        }
    }

    /* ── 即時套用設定（無需重整頁面） ── */
    function applySettingsLive(newSettings) {
        let needsRefresh = false;

        // 更新 config
        Object.assign(config, newSettings);

        // 更新所有已存在的評分徽章樣式（字體大小、圓角）
        document.querySelectorAll('.ani-custom-rating').forEach(badge => {
            badge.style.fontSize = `${config.fontSize}px`;
            badge.style.borderRadius = `${config.radius}px`;
            // 更新人數字體大小
            const countEl = badge.querySelector('.acr-count');
            if (countEl) {
                countEl.style.fontSize = `${config.fontSize - 3}px`;
            }
        });

        // 重新套用防雷遮罩和完全屏蔽
        document.querySelectorAll('.ani-custom-rating').forEach(badge => {
            const container = badge.parentElement;
            if (!container) return;

            const cardLink = container.closest('a') || container.closest('.theme-list-main, .newanime-block__link');
            const score = parseFloat(cardLink?.getAttribute('data-rating-score')) || 0;

            if (score > 0) {
                applyFilterIfNeeded(container, score);
            }
        });

        // 更新淡化狀態
        document.body.classList.toggle('ani-watched-fade-enabled', config.fadeWatched);
        if (config.fadeWatched) {
            applyWatchedFadeToPage();
        } else {
            document.querySelectorAll('.ani-watched-fade').forEach(el => {
                el.classList.remove('ani-watched-fade');
            });
        }

        // 更新浮動按鈕狀態
        const maskBtn = document.getElementById('ani-mask-float-btn');
        if (maskBtn) {
            document.body.classList.toggle('ani-disable-masking', !config.maskEnabled);
            maskBtn.classList.toggle('active', config.maskEnabled);
            maskBtn.innerHTML = config.maskEnabled ? '🛡️' : '🔓';
        }

        const blockBtn = document.getElementById('ani-block-float-btn');
        if (blockBtn) {
            document.body.classList.toggle('ani-disable-blocking', !config.blockEnabled);
            blockBtn.classList.toggle('active', config.blockEnabled);
            blockBtn.innerHTML = config.blockEnabled ? '🚫' : '👁️';
        }

        // 更新排序狀態
        const sortBtn = document.getElementById('ani-sort-float-btn');
        if (sortBtn) {
            if (config.sortEnabled) {
                isSortedByRating = true;
                sortBtn.classList.add('active');
                sortBtn.innerHTML = '★↓';
                sessionStorage.setItem('aniRating_isSorted', 'true');
                // 觸發排序
                forceLoadAllAndSort();
            } else {
                isSortedByRating = false;
                sortBtn.classList.remove('active');
                sortBtn.innerHTML = '⇅';
                sessionStorage.setItem('aniRating_isSorted', 'false');
                applySortAction(false);
            }
        }

        needsRefresh = false; // 所有設定已即時套用
        return needsRefresh;
    }

    // ── 6. IntersectionObserver 高效懶載入監聽 ─────────────────────────
    const lazyObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const link = entry.target;
                lazyObserver.unobserve(link);

                link.setAttribute('data-rating-processed', 'true');
                const match = link.href.match(/sn=(\d+)/);
                if (match) {
                    const container = getThumbnailContainer(link);
                    if (container) {
                        processItem({ sn: match[1], container });
                    }
                }
            }
        });
    }, {
        rootMargin: '100px 0px',
        threshold: 0.01
    });

    // 🎯 智慧型多版面卡片監聽派發
    function observeCards() {
        document.querySelectorAll(MAIN_CARD_SELECTORS).forEach(link => {
            if (link.classList.contains('next-btn') ||
                link.classList.contains('play-btn') ||
                link.classList.contains('click-area') ||
                link.closest('.user-watchTime-list')) {
                return;
            }
            lazyObserver.observe(link);
        });
    }

    const bodyObserver = new MutationObserver(() => {
        observeCards();
    });

    // ── 7. 懸浮控制按鈕群與雙向排序、快捷防雷遮罩/完全屏蔽切換 ─────────────────────────────────────
    let sortDebounceTimeout = null;
    let lastToastShownTime = 0;

    const SORTABLE_BLOCKS = [
        { parent: '.theme-list-block', child: 'a.theme-list-main' },
        { parent: '.newanime-wrap', child: '.newanime-block' }, // 首頁新番排布支援
        { parent: '.newanime-wrap-main', child: '.newanime-block' }
    ];

    function showToast(message) {
        let toast = document.getElementById('ani-rating-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'ani-rating-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.className = 'show';
        clearTimeout(toast.timeoutId);
        toast.timeoutId = setTimeout(() => {
            toast.className = '';
        }, 2800);
    }

    function applySortAction(isSorted) {
        SORTABLE_BLOCKS.forEach(config => {
            const blocks = document.querySelectorAll(config.parent);
            blocks.forEach(block => {
                const items = Array.from(block.querySelectorAll(config.child));
                if (items.length === 0) return;

                items.sort((a, b) => {
                    let scoreA = 0, scoreB = 0;
                    let origA = parseInt(a.getAttribute('data-orig-index')) || 0;
                    let origB = parseInt(b.getAttribute('data-orig-index')) || 0;

                    if (config.child === 'a.theme-list-main' || config.child === 'a') {
                        scoreA = parseFloat(a.getAttribute('data-rating-score')) || 0;
                        scoreB = parseFloat(b.getAttribute('data-rating-score')) || 0;
                    } else {
                        // 針對包覆結構向下解析 a 連結
                        const linkA = a.querySelector('a[href*="animeVideo.php?sn="]');
                        const linkB = b.querySelector('a[href*="animeVideo.php?sn="]');
                        if (linkA) {
                            scoreA = parseFloat(linkA.getAttribute('data-rating-score')) || 0;
                            if (!a.hasAttribute('data-orig-index')) {
                                a.setAttribute('data-orig-index', linkA.getAttribute('data-orig-index') || originalOrderCounter++);
                            }
                            origA = parseInt(a.getAttribute('data-orig-index')) || 0;
                        }
                        if (linkB) {
                            scoreB = parseFloat(linkB.getAttribute('data-rating-score')) || 0;
                            if (!b.hasAttribute('data-orig-index')) {
                                b.setAttribute('data-orig-index', linkB.getAttribute('data-orig-index') || originalOrderCounter++);
                            }
                            origB = parseInt(b.getAttribute('data-orig-index')) || 0;
                        }
                    }

                    if (isSorted) {
                        return scoreB - scoreA;
                    } else {
                        return origA - origB;
                    }
                });

                items.forEach(item => block.appendChild(item));
            });
        });
    }

    // 排序開啟時：靜默預載未呈現的作品，並顯示頂部載入進度條
    async function forceLoadAllAndSort() {
        const unprocessed = Array.from(document.querySelectorAll(MAIN_CARD_SELECTORS));
        const sortBtn = document.getElementById('ani-sort-float-btn');

        if (unprocessed.length === 0) {
            applySortAction(true);
            if (sortBtn) {
                sortBtn.innerHTML = '★↓';
                sortBtn.classList.remove('loading');
            }
            return;
        }

        if (sortBtn) {
            sortBtn.innerHTML = '⏳';
            sortBtn.classList.add('loading');
        }

        let progressBar = document.getElementById('ani-sort-progress-bar');
        if (!progressBar) {
            progressBar = document.createElement('div');
            progressBar.id = 'ani-sort-progress-bar';
            document.body.appendChild(progressBar);
        }
        progressBar.style.width = '0%';
        progressBar.style.opacity = '1';

        const total = unprocessed.length;
        let loaded = 0;

        for (let link of unprocessed) {
            if (!isSortedByRating) {
                progressBar.style.opacity = '0';
                if (sortBtn) {
                    sortBtn.classList.remove('loading');
                    sortBtn.innerHTML = '⇅';
                }
                return;
            }

            lazyObserver.unobserve(link);
            link.setAttribute('data-rating-processed', 'true');

            const match = link.href.match(/sn=(\d+)/);
            if (match) {
                const container = getThumbnailContainer(link);
                if (container) {
                    await fetchAndRenderSingleItem(match[1], container);
                }
            }

            loaded++;
            const percent = Math.round((loaded / total) * 100);
            progressBar.style.width = `${percent}%`;
        }

        progressBar.style.width = '100%';
        setTimeout(() => {
            progressBar.style.opacity = '0';
        }, 500);

        if (sortBtn) {
            sortBtn.classList.remove('loading');
            sortBtn.innerHTML = '★↓';
        }
        applySortAction(true);
        showToast('✅ 已強制預先載入所有評等，排序完成！');
    }

    async function fetchAndRenderSingleItem(sn, container) {
        const cached = getCacheItem(sn);
        if (cached) {
            renderRating(container, cached);
            applyFilterIfNeeded(container, cached.score);
            return;
        }

        try {
            await new Promise(r => setTimeout(r, Math.round(config.delay / 3)));
            const res = await fetch(`/animeRef.php?sn=${sn}`);
            const html = await res.text();

            const scoreMatch = html.match(/"ratingValue"\s*:\s*"?([0-9.]+)"?/);
            const countMatch = html.match(/"ratingCount"\s*:\s*"?([0-9]+)"?/);

            if (scoreMatch && countMatch) {
                const rawScore = parseFloat(scoreMatch[1]);
                const count = parseInt(countMatch[1]);
                const score = rawScore > 5 ? rawScore / 2 : rawScore;

                setCacheItem(sn, score, count);
                const data = { score, count };
                renderRating(container, data);
                applyFilterIfNeeded(container, score);
            }
        } catch (e) {
            console.error('[評分美化] 預加載載入失敗 SN: ' + sn, e);
        }
    }

    function triggerSortDebounced() {
        clearTimeout(sortDebounceTimeout);
        sortDebounceTimeout = setTimeout(async () => {
            const unprocessed = Array.from(document.querySelectorAll(MAIN_CARD_SELECTORS));
            if (unprocessed.length > 0) {
                for (let link of unprocessed) {
                    lazyObserver.unobserve(link);
                    link.setAttribute('data-rating-processed', 'true');
                    const match = link.href.match(/sn=(\d+)/);
                    if (match) {
                        const container = getThumbnailContainer(link);
                        if (container) {
                            await fetchAndRenderSingleItem(match[1], container);
                        }
                    }
                }
                applySortAction(true);
            } else {
                applySortAction(true);
            }

            const now = Date.now();
            if (now - lastToastShownTime > 5000) {
                showToast('ℹ️ 目前已自動套用「評分高低」自訂排序模式（非官方預設）');
                lastToastShownTime = now;
            }
        }, 300);
    }

    // ── 7.1 CSP 免疫特權網路請求 (100% 繞過 connect-src 阻擋) ──
    function GM_fetch(url, options = {}) {
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== 'function') {
                reject(new Error('GM_xmlhttpRequest is not available'));
                return;
            }

            const absoluteUrl = url.startsWith('http') ? url : window.location.origin + url;

            GM_xmlhttpRequest({
                method: options.method || 'GET',
                url: absoluteUrl,
                headers: options.headers || {},
                data: options.body || null,
                anonymous: false, // 攜帶 Cookies
                onload: (response) => {
                    if (response.status === 200) {
                        const textVal = response.responseText;
                        resolve({
                            status: response.status,
                            text: async () => textVal,
                            json: async () => {
                                try { return JSON.parse(textVal); } catch (e) { return { data: textVal }; }
                            }
                        });
                    } else {
                        resolve(null);
                    }
                },
                onerror: (err) => {
                    console.error('[評分美化] 特權背景連線失敗', err);
                    resolve(null);
                }
            });
        });
    }

    async function smartFetch(url, options = {}) {
        return await GM_fetch(url, options);
    }

    function injectActionButtons() {
        if (document.getElementById('ani-sort-float-btn')) return;

        const sortBtn = document.createElement('button');
        sortBtn.id = 'ani-sort-float-btn';
        sortBtn.className = 'ani-float-btn';
        sortBtn.title = '依評分排序當前作品';
        if (isSortedByRating) {
            sortBtn.innerHTML = '★↓';
            sortBtn.classList.add('active');
        } else {
            sortBtn.innerHTML = '⇅';
        }

        sortBtn.addEventListener('click', () => {
            isSortedByRating = !isSortedByRating;
            config.sortEnabled = isSortedByRating;
            sessionStorage.setItem('aniRating_isSorted', isSortedByRating);
            localStorage.setItem('aniRating_sortEnabled', isSortedByRating);
            sortBtn.classList.toggle('active', isSortedByRating);

            if (isSortedByRating) {
                sortBtn.innerHTML = '★↓';
                forceLoadAllAndSort();
            } else {
                sortBtn.innerHTML = '⇅';
                applySortAction(false);
                showToast('已恢復官方預設順序。');
            }
        });

        const maskBtn = document.createElement('button');
        maskBtn.id = 'ani-mask-float-btn';
        maskBtn.className = 'ani-float-btn';
        maskBtn.title = '切換防雷遮罩顯示';

        if (isMaskActive) {
            maskBtn.innerHTML = '🛡️';
            maskBtn.classList.add('active');
        } else {
            maskBtn.innerHTML = '🔓';
        }
        document.body.classList.toggle('ani-disable-masking', !isMaskActive);

        maskBtn.addEventListener('click', () => {
            isMaskActive = !isMaskActive;
            config.maskEnabled = isMaskActive;
            localStorage.setItem('aniRating_maskEnabled', isMaskActive);
            maskBtn.classList.toggle('active', isMaskActive);
            document.body.classList.toggle('ani-disable-masking', !isMaskActive);
            maskBtn.innerHTML = isMaskActive ? '🛡️' : '🔓';

            if (isMaskActive) {
                showToast('已啟用低評分「防雷遮罩」保護。');
            } else {
                showToast('已暫時解除「防雷遮罩」，展示完整清單。');
            }
        });

        const blockBtn = document.createElement('button');
        blockBtn.id = 'ani-block-float-btn';
        blockBtn.className = 'ani-float-btn';
        blockBtn.title = '切換低分作品屏蔽';

        if (isBlockActive) {
            blockBtn.innerHTML = '🚫';
            blockBtn.classList.add('active');
        } else {
            blockBtn.innerHTML = '👁️';
        }
        document.body.classList.toggle('ani-disable-blocking', !isBlockActive);

        blockBtn.addEventListener('click', () => {
            isBlockActive = !isBlockActive;
            config.blockEnabled = isBlockActive;
            localStorage.setItem('aniRating_blockEnabled', isBlockActive);
            blockBtn.classList.toggle('active', isBlockActive);
            document.body.classList.toggle('ani-disable-blocking', !isBlockActive);
            blockBtn.innerHTML = isBlockActive ? '🚫' : '👁️';

            if (isBlockActive) {
                showToast('已啟用超低評作品「完全屏蔽」隱藏。');
            } else {
                showToast('已顯示被屏蔽的超低評作品。');
            }
        });

        document.body.appendChild(sortBtn);
        document.body.appendChild(maskBtn);
        document.body.appendChild(blockBtn);
        updateActionButtonsVisibility();
    }

    function updateActionButtonsVisibility() {
        const btns = [
            document.getElementById('ani-sort-float-btn'),
            document.getElementById('ani-mask-float-btn'),
            document.getElementById('ani-block-float-btn'),
            document.getElementById('ani-config-float-btn')
        ];
        const hasCards = document.querySelector(MAIN_CARD_SELECTORS.split(':not')[0]) !== null;

        btns.forEach(btn => {
            if (btn) btn.style.display = hasCards ? 'inline-flex' : 'none';
        });
    }

    // ── 8. 首次使用引導功能 (功能導覽) ──────────────────────────────────
    function startTour() {
        if (document.getElementById('ani-rating-tour-overlay')) return;

        const steps = [
            {
                title: "歡迎使用評分助手！",
                desc: "我們已為動畫封面加上了精緻的評分徽章。將滑鼠懸停在徽章上即可查看詳細的五星佔比分佈。"
            },
            {
                title: "右下角快捷面板",
                desc: "右下角提供三個垂直按鈕：⇅ 可切換自訂排序模式，🛡️ 快捷開關防雷遮罩，🚫 快捷開關完全屏蔽功能。"
            },
            {
                title: "自訂個人化設定",
                desc: "點擊頂部選單、頭像旁的「⭐ 評分設定」按鈕，即可自由調整徽章外觀、字體大小與避雷分數門檻！"
            }
        ];

        let currentStep = 0;
        const overlay = document.createElement('div');
        overlay.id = 'ani-rating-tour-overlay';

        function renderStep() {
            const step = steps[currentStep];
            overlay.innerHTML = `
                <div id="ani-rating-tour-card">
                    <div class="artc-header">
                        <span class="artc-step-num">功能導覽 ${currentStep + 1} / ${steps.length}</span>
                        <button class="artc-close-btn" id="artc-close">✕</button>
                    </div>
                    <div class="artc-body">
                        <div class="artc-title">${step.title}</div>
                        <div class="artc-desc">${step.desc}</div>
                        <div class="artc-indicators">
                            ${steps.map((_, i) => `<span class="artc-dot ${i === currentStep ? 'active' : ''}"></span>`).join('')}
                        </div>
                    </div>
                    <div class="artc-footer">
                        <button class="artc-btn artc-btn-skip" id="artc-skip">跳過</button>
                        <button class="artc-btn artc-btn-next" id="artc-next">${currentStep === steps.length - 1 ? '完成' : '下一步'}</button>
                    </div>
                </div>
            `;

            overlay.querySelector('#artc-close').addEventListener('click', closeTour);
            overlay.querySelector('#artc-skip').addEventListener('click', closeTour);
            overlay.querySelector('#artc-next').addEventListener('click', () => {
                if (currentStep < steps.length - 1) {
                    currentStep++;
                    renderStep();
                } else {
                    closeTour();
                }
            });
        }

        function closeTour() {
            localStorage.setItem('aniRating_tourCompleted', 'true');
            overlay.remove();
        }

        document.body.appendChild(overlay);
        renderStep();
    }

    // ── 9. 自訂美化參數 UI 面板 ───────────────────────────────────────
    function openModal() {
        if (document.getElementById('ani-rating-overlay')) return;

        const overlay = document.createElement('div');
        overlay.id = 'ani-rating-overlay';

        const cacheCount = Object.keys(cache).length;
        const isOn = config.enabled;
        const isMaskOn = config.maskEnabled;
        const isBlockOn = config.blockEnabled;
        const isFadeWatchedOn = config.fadeWatched;
        const isSortOn = config.sortEnabled;

        overlay.innerHTML = `
            <div id="ani-rating-modal" role="dialog" aria-modal="true" aria-label="評分顯示設定">
                <div class="arm-header">
                    <div class="arm-header-left">
                        <div class="arm-icon">⭐</div>
                        <div>
                            <div class="arm-title">評分顯示設定</div>
                            <div class="arm-subtitle">動畫瘋 · 評分助手</div>
                        </div>
                    </div>
                    <button class="arm-close" id="arm-close-btn" aria-label="關閉">✕</button>
                </div>

                <div class="arm-body">
                    <!-- 核心功能 -->
                    <div class="arm-section">
                        <div class="arm-section-header">核心功能</div>

                        <div class="arm-list-item">
                            <div class="arm-list-left">
                                <div class="arm-list-title">啟用評分顯示</div>
                                <div class="arm-list-desc">在動畫封面上疊加評分徽章</div>
                            </div>
                            <div class="arm-toggle-pill ${isOn ? 'on' : ''}" id="arm-toggle"></div>
                        </div>

                        <div class="arm-list-item">
                            <div class="arm-list-left">
                                <div class="arm-list-title">啟用防雷遮罩</div>
                                <div class="arm-list-desc">遮蓋低於防雷門檻之作品封面 (滑鼠指上即還原)</div>
                            </div>
                            <div class="arm-toggle-pill ${isMaskOn ? 'on' : ''}" id="arm-mask-toggle"></div>
                        </div>

                        <div class="arm-list-item">
                            <div class="arm-list-left">
                                <div class="arm-list-title">啟用作品完全屏蔽</div>
                                <div class="arm-list-desc">直接隱藏低於屏蔽門檻的作品</div>
                            </div>
                            <div class="arm-toggle-pill ${isBlockOn ? 'on' : ''}" id="arm-block-toggle"></div>
                        </div>

                        <div class="arm-list-item">
                            <div class="arm-list-left">
                                <div class="arm-list-title">已看過作品視覺淡化</div>
                                <div class="arm-list-desc">降低已看過封面透明度 (背景自動定期更新，亦可於觀看紀錄手動同步)</div>
                            </div>
                            <div class="arm-toggle-pill ${isFadeWatchedOn ? 'on' : ''}" id="arm-fade-watched-toggle"></div>
                        </div>

                        <div class="arm-list-item">
                            <div class="arm-list-left">
                                <div class="arm-list-title">啟用評分自動排序</div>
                                <div class="arm-list-desc">依評分高低自動重新排列作品清單 (即時生效)</div>
                            </div>
                            <div class="arm-toggle-pill ${isSortOn ? 'on' : ''}" id="arm-sort-toggle"></div>
                        </div>

                        <div class="arm-list-item">
                            <div class="arm-list-left">
                                <div class="arm-list-title">避雷遮罩門檻</div>
                                <div class="arm-list-desc">分數低於此值將套用半透明模糊遮罩</div>
                            </div>
                            <div class="arm-field-row">
                                <input type="number" id="arm-threshold" value="${config.threshold}" step="0.1" min="0" max="5">
                                <span class="arm-field-unit">分</span>
                            </div>
                        </div>

                        <div class="arm-list-item">
                            <div class="arm-list-left">
                                <div class="arm-list-title">作品屏蔽門檻</div>
                                <div class="arm-list-desc">完全屏蔽啟用時，低於此分數直接隱藏</div>
                            </div>
                            <div class="arm-field-row">
                                <input type="number" id="arm-block-threshold" value="${config.blockThreshold}" step="0.1" min="0" max="5">
                                <span class="arm-field-unit">分</span>
                            </div>
                        </div>

                        <div style="font-size: 11px; line-height: 1.45; background: rgba(59, 130, 246, 0.08); border: 1px dashed rgba(59, 130, 246, 0.22); padding: 9px 12px; border-radius: 8px; margin-top: 6px;">
                            💡 <strong>功能提示：</strong>在支援作品清單的頁面<strong>右下角</strong>，會出現三個垂直的快捷懸浮按鈕：<br>
                            <strong>⇅ / ★↓</strong> 一鍵切換自訂排序；<strong>🛡️</strong> 快捷啟閉防雷遮罩；<strong>🚫</strong> 快捷啟閉完全屏蔽。<br>
                            <strong>啟用評分自動排序</strong>設定開啟後將立即按評分高低重新排列清單，無需手動點擊按鈕。
                        </div>
                    </div>

                    <!-- 區塊二：徽章外觀樣式 -->
                    <div class="arm-section">
                        <div class="arm-section-header">🎨 徽章外觀樣式</div>

                        <div class="arm-list-item">
                            <div class="arm-list-left">
                                <div class="arm-list-title">字體大小</div>
                                <div class="arm-list-desc">調整評分徽章上文字的大小</div>
                            </div>
                            <div class="arm-field-row">
                                <input type="number" id="arm-fs" value="${config.fontSize}" min="8" max="24">
                                <span class="arm-field-unit">px</span>
                            </div>
                        </div>

                        <div class="arm-list-item">
                            <div class="arm-list-left">
                                <div class="arm-list-title">徽章圓角</div>
                                <div class="arm-list-desc">調整徽章與骨架屏的四角半徑</div>
                            </div>
                            <div class="arm-field-row">
                                <input type="number" id="arm-rad" value="${config.radius}" min="0" max="24">
                                <span class="arm-field-unit">px</span>
                            </div>
                        </div>
                    </div>

                    <!-- 區塊三：系統效能與快取 -->
                    <div class="arm-section">
                        <div class="arm-section-header">⚙️ 系統效能與快取</div>

                        <div class="arm-list-item">
                            <div class="arm-list-left">
                                <div class="arm-list-title">防失真警告門檻</div>
                                <div class="arm-list-desc">當評價人數少於此值時，顯示防失真警告</div>
                            </div>
                            <div class="arm-field-row">
                                <input type="number" id="arm-sample-threshold" value="${config.sampleThreshold}" min="10" max="2000">
                                <span class="arm-field-unit">人</span>
                            </div>
                        </div>

                        <div class="arm-list-item">
                            <div class="arm-list-left">
                                <div class="arm-list-title">載入延遲時間</div>
                                <div class="arm-list-desc">防止請求過快被阻擋之延遲發起時間</div>
                            </div>
                            <div class="arm-field-row">
                                <input type="number" id="arm-delay" value="${config.delay}" min="0" max="9999">
                                <span class="arm-field-unit">ms</span>
                            </div>
                        </div>

                        <div class="arm-list-item">
                            <div class="arm-list-left">
                                <div class="arm-list-title">本地快取容量上限</div>
                                <div class="arm-list-desc">快取保留的最大作品評分筆數</div>
                            </div>
                            <div class="arm-field-row">
                                <input type="number" id="arm-cache-limit" value="${config.cacheLimit}" min="50" max="2000">
                                <span class="arm-field-unit">筆</span>
                            </div>
                        </div>

                        <div class="arm-list-item">
                            <div class="arm-list-left">
                                <div class="arm-list-title">快取有效時間</div>
                                <div class="arm-list-desc">快取失效並自動更新的間隔時間</div>
                            </div>
                            <div class="arm-field-row">
                                <input type="number" id="arm-ttl" value="${config.ttlHours}" min="1" max="720">
                                <span class="arm-field-unit">小時</span>
                            </div>
                        </div>

                        <div class="arm-cache-row">
                            <div class="arm-cache-left">
                                🗄️ 本地快取
                                <span class="arm-cache-badge">${cacheCount} 筆</span>
                            </div>
                            <button class="arm-cache-clear" id="arm-cache-clear">清除快取</button>
                        </div>

                        <!-- 首次使用引導重啟按鈕 -->
                        <div class="arm-list-item" style="margin-top: 4px; padding-top: 10px; border-bottom: none;">
                            <div class="arm-list-left">
                                <div class="arm-list-title" style="font-size:12px;">重溫操作引導</div>
                                <div class="arm-list-desc">重新播放首次使用的功能導覽</div>
                            </div>
                            <button class="arm-btn arm-btn-cancel" id="arm-restart-tour" style="max-width:120px; padding: 6px 12px; font-size:11px;">開啟功能導覽</button>
                        </div>
                    </div>
                </div>

                <div class="arm-footer">
                    <button class="arm-btn arm-btn-cancel" id="arm-cancel">取消</button>
                    <button class="arm-btn arm-btn-cancel" id="arm-reset" style="color:#b91c1c; border-color:rgba(185,28,28,0.35);">復原預設</button>
                    <button class="arm-btn arm-btn-save" id="arm-save">↺ 儲存設定</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        let toggleState = isOn;
        const pill = document.getElementById('arm-toggle');
        pill.addEventListener('click', () => {
            toggleState = !toggleState;
            pill.classList.toggle('on', toggleState);
        });

        let maskToggleState = isMaskOn;
        const maskPill = document.getElementById('arm-mask-toggle');
        maskPill.addEventListener('click', () => {
            maskToggleState = !maskToggleState;
            maskPill.classList.toggle('on', maskToggleState);
        });

        let blockToggleState = isBlockOn;
        const blockPill = document.getElementById('arm-block-toggle');
        blockPill.addEventListener('click', () => {
            blockToggleState = !blockToggleState;
            blockPill.classList.toggle('on', blockToggleState);
        });

        let fadeWatchedToggleState = isFadeWatchedOn;
        const fadeWatchedPill = document.getElementById('arm-fade-watched-toggle');
        fadeWatchedPill.addEventListener('click', () => {
            fadeWatchedToggleState = !fadeWatchedToggleState;
            fadeWatchedPill.classList.toggle('on', fadeWatchedToggleState);
        });

        let sortToggleState = isSortOn;
        const sortPill = document.getElementById('arm-sort-toggle');
        sortPill.addEventListener('click', () => {
            sortToggleState = !sortToggleState;
            sortPill.classList.toggle('on', sortToggleState);
        });

        document.getElementById('arm-cache-clear').addEventListener('click', () => {
            cache = {};
            localStorage.removeItem('aniRating_cache');
            overlay.querySelector('.arm-cache-badge').textContent = '0 筆';
            console.log('[評分美化] 本地快取已成功清除！');
        });

        // 重啟導覽
        document.getElementById('arm-restart-tour').addEventListener('click', () => {
            overlay.remove(); // 關閉設定面板
            startTour();
        });

        const close = () => overlay.remove();
        document.getElementById('arm-close-btn').addEventListener('click', close);
        document.getElementById('arm-cancel').addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

        document.getElementById('arm-save').addEventListener('click', () => {
            const needsReloadKeys = [];

            // 儲存所有設定
            const oldEnabled = config.enabled;
            const oldFadeWatched = config.fadeWatched;

            localStorage.setItem('aniRating_enabled', toggleState);
            localStorage.setItem('aniRating_maskEnabled', maskToggleState);
            localStorage.setItem('aniRating_blockEnabled', blockToggleState);
            localStorage.setItem('aniRating_fadeWatched', fadeWatchedToggleState);
            localStorage.setItem('aniRating_sortEnabled', sortToggleState);
            localStorage.setItem('aniRating_delay',   document.getElementById('arm-delay').value);
            localStorage.setItem('aniRating_fs',      document.getElementById('arm-fs').value);
            localStorage.setItem('aniRating_rad',     document.getElementById('arm-rad').value);
            localStorage.setItem('aniRating_threshold', document.getElementById('arm-threshold').value);
            localStorage.setItem('aniRating_blockThreshold', document.getElementById('arm-block-threshold').value);
            localStorage.setItem('aniRating_sampleThreshold', document.getElementById('arm-sample-threshold').value);
            localStorage.setItem('aniRating_cache_limit', document.getElementById('arm-cache-limit').value);
            localStorage.setItem('aniRating_ttl_hours', document.getElementById('arm-ttl').value);

            // 即時套用不需要重整的設定
            applySettingsLive({
                fontSize: parseInt(document.getElementById('arm-fs').value),
                radius: parseInt(document.getElementById('arm-rad').value),
                threshold: parseFloat(document.getElementById('arm-threshold').value),
                blockThreshold: parseFloat(document.getElementById('arm-block-threshold').value),
                sampleThreshold: parseInt(document.getElementById('arm-sample-threshold').value),
                delay: parseInt(document.getElementById('arm-delay').value),
                cacheLimit: parseInt(document.getElementById('arm-cache-limit').value),
                ttlHours: parseInt(document.getElementById('arm-ttl').value),
                sortEnabled: sortToggleState,
            });

            // 判斷哪些設定需要重整
            if (oldEnabled !== toggleState) needsReloadKeys.push('啟用評分顯示');

            close();

            // 若剛剛啟用了淡化功能且觀看列表為空，立即背景同步
            if (fadeWatchedToggleState && !oldFadeWatched && watchedAnimeMap.size === 0) {
                showToast('⏳ 正在背景同步觀看紀錄...');
                fetchHistoryInBackground().then(() => {
                    if (watchedAnimeMap.size > 0) {
                        showToast(`✅ 已同步 ${watchedAnimeMap.size} 筆觀看紀錄`);
                    }
                });
            }

            if (needsReloadKeys.length > 0) {
                const msg = `以下設定需要重整頁面才能完整生效：\n${needsReloadKeys.join('、')}\n\n是否立即重整？`;
                if (confirm(msg)) {
                    location.reload();
                } else {
                    showToast('⚠️ 設定已儲存，建議重整頁面以完整生效');
                }
            } else {
                showToast('✅ 設定已儲存');
            }
        });

        document.getElementById('arm-reset').addEventListener('click', () => {
            if (!confirm('確定要將所有設定復原為預設值嗎？')) return;
            Object.keys(localStorage)
                .filter(k => k.startsWith('aniRating_'))
                .forEach(k => localStorage.removeItem(k));
            location.reload();
        });
    }

    // ── 9.1 注入會員選單內的評分按鈕 (防禦性回退至浮動齒輪) ──
    function injectUI() {
        if (document.querySelector('.top_btn_rating_setting')) return;

        const memberList = document.querySelector('ul.member') || document.querySelector('.top-header ul') || document.querySelector('ul.top-nav');
        if (memberList) {
            const li = document.createElement('li');
            li.className = 'top_btn_rating_setting';
            li.innerHTML = `<a href="javascript:void(0)" style="display:flex; align-items:center; justify-content:center;"><i class="material-icons">star_rate</i></a><span class="tooltip">評分設定</span>`;
            li.addEventListener('click', openModal);

            const searchBtn = memberList.querySelector('.searchbtn') || memberList.querySelector('li:last-child');
            if (searchBtn) memberList.insertBefore(li, searchBtn);
            else memberList.appendChild(li);
        } else {
            // 💡 若選單類別被大幅重構，生成一個浮動齒輪按鈕，保障設定控制不遺失
            const floatConfigBtn = document.createElement('button');
            floatConfigBtn.id = 'ani-config-float-btn';
            floatConfigBtn.className = 'ani-float-btn';
            floatConfigBtn.style.bottom = '235px';
            floatConfigBtn.title = '開啟評分設定';
            floatConfigBtn.innerHTML = '⚙️';
            floatConfigBtn.addEventListener('click', openModal);
            document.body.appendChild(floatConfigBtn);
        }
    }

    // 初始化與執行 DOM 紀錄同步
    injectUI();
    injectActionButtons();

    // 初始化同步目前頁面內含有的所有觀看歷史與首頁最近觀看組件
    syncWatchedHistoryFromDOM();

    // 啟動背景靜默同步，抓取全部的歷史紀錄
    fetchHistoryInBackground();

    // 監聽 viewList.php 的動態摺疊展開
    if (window.location.pathname.includes('viewList.php')) {
        const viewListObserver = new MutationObserver(() => {
            syncWatchedHistoryFromDOM();
        });
        viewListObserver.observe(document.body, { childList: true, subtree: true });
    }

    // 動態卡片派發監聽
    observeCards();
    bodyObserver.observe(document.body, { childList: true, subtree: true });

    // 初始化已觀看視覺淡化之 Body 標記
    document.body.classList.toggle('ani-watched-fade-enabled', config.fadeWatched);

    // 若啟用排序，在頁面載入後自動套用
    if (config.sortEnabled) {
        setTimeout(() => {
            const sortBtn = document.getElementById('ani-sort-float-btn');
            if (sortBtn) {
                isSortedByRating = true;
                sortBtn.classList.add('active');
                sortBtn.innerHTML = '★↓';
                forceLoadAllAndSort();
            } else {
                // 按鈕尚未注入，稍後重試
                let retries = 0;
                const waitBtn = setInterval(() => {
                    const btn = document.getElementById('ani-sort-float-btn');
                    if (btn) {
                        clearInterval(waitBtn);
                        isSortedByRating = true;
                        btn.classList.add('active');
                        btn.innerHTML = '★↓';
                        forceLoadAllAndSort();
                    }
                    retries++;
                    if (retries > 20) clearInterval(waitBtn);
                }, 300);
            }
        }, 500);
    }

    // 判斷是否首次載入，啟動導覽
    const tourCompleted = localStorage.getItem('aniRating_tourCompleted') === 'true';
    if (!tourCompleted) {
        setTimeout(startTour, 1500);
    }
})();
