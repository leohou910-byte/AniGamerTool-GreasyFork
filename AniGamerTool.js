// ==UserScript==
// @name         [動畫瘋] StarMap - 評分星圖
// @name:zh-TW   [動畫瘋] StarMap - 評分星圖
// @name:zh-CN   [动画疯] StarMap - 评分星图
// @namespace    http://tampermonkey.net/
// @version      1.2.7
// @description  Beautify AniGamer anime cover ratings. Auto color-coded scores, hoverable 5-star distribution tooltip, pulse skeleton loading, 24h LRU cache, anti-spoiler mask/block, lazy-load and rating auto-sort with global progress.
// @description:zh-TW 美化動畫瘋封面評分，支援自動分數變色、懸浮五星佔比詳情、脈衝骨架屏載入、24小時快取、最低分數防雷遮罩/完全屏蔽、懶載入與全局進度條顯示。
// @description:zh-CN 美化动画疯封面评分，支持自动分数变色、悬浮五星占比详情，脉搏骨架屏加载，24小时缓存，最低分数防雷遮罩/完全屏蔽，懒加载与全局进度条显示。
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

    // ================================================================
    // 1. 設定管理 (ConfigManager)
    // ================================================================
    const DEFAULT_CONFIG = {
        enabled: true,
        maskEnabled: true,
        fontSize: 14,
        radius: 6,
        threshold: 3.5,
        blockEnabled: true,
        blockThreshold: 3.0,
        fadeWatched: false,
        sortEnabled: true,
        sampleThreshold: 800,
        fetchInterval: 500,
        cacheLimit: 500,
        ttlHours: 24,
    };

    const ConfigManager = {
        data: { ...DEFAULT_CONFIG },

        _safeParse(key, fallback, parser = (v) => v) {
            try {
                const raw = localStorage.getItem(key);
                return raw === null ? fallback : parser(raw);
            } catch { return fallback; }
        },

        load() {
            try {
                this.data.enabled = localStorage.getItem('aniRating_enabled') !== 'false';
                const maskVal = localStorage.getItem('aniRating_maskEnabled');
                this.data.maskEnabled = maskVal !== null ? maskVal === 'true' : DEFAULT_CONFIG.maskEnabled;
                this.data.fontSize = this._safeParse('aniRating_fs', DEFAULT_CONFIG.fontSize, parseInt);
                this.data.radius = this._safeParse('aniRating_rad', DEFAULT_CONFIG.radius, parseInt);
                this.data.threshold = this._safeParse('aniRating_threshold', DEFAULT_CONFIG.threshold, parseFloat);
                const blockVal = localStorage.getItem('aniRating_blockEnabled');
                this.data.blockEnabled = blockVal !== null ? blockVal === 'true' : DEFAULT_CONFIG.blockEnabled;
                this.data.blockThreshold = this._safeParse('aniRating_blockThreshold', DEFAULT_CONFIG.blockThreshold, parseFloat);
                this.data.fadeWatched = localStorage.getItem('aniRating_fadeWatched') === 'true';
                const sortVal = localStorage.getItem('aniRating_sortEnabled');
                this.data.sortEnabled = sortVal !== null ? sortVal === 'true' : DEFAULT_CONFIG.sortEnabled;
                this.data.sampleThreshold = this._safeParse('aniRating_sampleThreshold', DEFAULT_CONFIG.sampleThreshold, parseInt);
                this.data.fetchInterval = this._safeParse('aniRating_fetchInterval', DEFAULT_CONFIG.fetchInterval, (v) => {
                    const n = parseInt(v);
                    return Number.isNaN(n) || n <= 0 ? DEFAULT_CONFIG.fetchInterval : n;
                });
                this.data.cacheLimit = this._safeParse('aniRating_cache_limit', DEFAULT_CONFIG.cacheLimit, parseInt);
                this.data.ttlHours = this._safeParse('aniRating_ttl_hours', DEFAULT_CONFIG.ttlHours, parseInt);
            } catch (e) {
                console.error('[評分美化] 載入設定失敗，將使用出廠預設值', e);
            }
        },

        save(key, value) {
            localStorage.setItem(key, value);
        },

        applyLive(newSettings) {
            Object.assign(this.data, newSettings);
            App.lastFetchTimestamp = 0;

            // 更新徽章樣式
            document.querySelectorAll('.ani-custom-rating').forEach(badge => {
                badge.style.fontSize = `${this.data.fontSize}px`;
                badge.style.borderRadius = `${this.data.radius}px`;
                const countEl = badge.querySelector('.acr-count');
                if (countEl) countEl.style.fontSize = `${this.data.fontSize - 3}px`;
            });

            // 重新套用過濾
            document.querySelectorAll('.ani-custom-rating').forEach(badge => {
                const container = badge.parentElement;
                if (!container) return;
                const cardLink = container.closest('a, .theme-list-main, .newanime-block__link');
                const score = parseFloat(cardLink?.getAttribute('data-rating-score')) || 0;
                if (score > 0) RatingProcessor.applyFilter(container, score);
            });

            // 淡化狀態
            document.body.classList.toggle('ani-watched-fade-enabled', this.data.fadeWatched);
            if (this.data.fadeWatched) {
                WatchHistoryManager.applyFadeToPage();
            } else {
                document.querySelectorAll('.ani-watched-fade').forEach(el => el.classList.remove('ani-watched-fade'));
            }

            // 浮動按鈕
            const maskBtn = document.getElementById('ani-mask-float-btn');
            if (maskBtn) {
                document.body.classList.toggle('ani-disable-masking', !this.data.maskEnabled);
                maskBtn.classList.toggle('active', this.data.maskEnabled);
                maskBtn.innerHTML = this.data.maskEnabled ? '🛡️' : '🔓';
            }
            const blockBtn = document.getElementById('ani-block-float-btn');
            if (blockBtn) {
                document.body.classList.toggle('ani-disable-blocking', !this.data.blockEnabled);
                blockBtn.classList.toggle('active', this.data.blockEnabled);
                blockBtn.innerHTML = this.data.blockEnabled ? '🚫' : '👁️';
            }
            const sortBtn = document.getElementById('ani-sort-float-btn');
            if (sortBtn) {
                if (this.data.sortEnabled) {
                    App.isSorted = true;
                    sortBtn.classList.add('active');
                    sortBtn.innerHTML = '★↓';
                    SortManager.forceLoadAllAndSort();
                } else {
                    App.isSorted = false;
                    sortBtn.classList.remove('active');
                    sortBtn.innerHTML = '⇅';
                    SortManager.apply(false);
                }
            }
        }
    };

    // ================================================================
    // 2. 快取管理 (CacheManager)
    // ================================================================
    const CacheManager = {
        _cache: {},
        _writeLock: false,

        load() {
            try {
                this._cache = JSON.parse(localStorage.getItem('aniRating_cache') || '{}');
            } catch { this._cache = {}; }
        },

        get(sn) {
            const item = this._cache[sn];
            if (!item) return null;
            const maxAge = ConfigManager.data.ttlHours * 60 * 60 * 1000;
            if (Date.now() - (item.timestamp || 0) > maxAge) {
                delete this._cache[sn];
                this._save();
                return null;
            }
            item.lastUsed = Date.now();
            this._save();
            return item;
        },

        set(sn, score, count, totalEpisodes) {
            if (this._writeLock) return;
            this._writeLock = true;
            try {
                const keys = Object.keys(this._cache);
                if (keys.length >= ConfigManager.data.cacheLimit) {
                    let oldestKey = '', oldestTime = Infinity;
                    for (const key of keys) {
                        const t = this._cache[key].lastUsed || this._cache[key].timestamp || 0;
                        if (t < oldestTime) { oldestTime = t; oldestKey = key; }
                    }
                    if (oldestKey) {
                        delete this._cache[oldestKey];
                        console.log(`[評分美化] 快取超出上限 (${ConfigManager.data.cacheLimit} 筆)，已自動淘汰最舊快取: SN ${oldestKey}`);
                    }
                }
                this._cache[sn] = {
                    score: parseFloat(score),
                    count: parseInt(count),
                    totalEpisodes: totalEpisodes || null,
                    timestamp: Date.now(),
                    lastUsed: Date.now()
                };
                this._save();
            } finally {
                this._writeLock = false;
            }
        },

        _save() {
            if (!this._safeSave('aniRating_cache', this._cache) && Object.keys(this._cache).length > 0 && !this._writeLock) {
                this._writeLock = true;
                try {
                    let oldestKey = null, oldestTime = Infinity;
                    for (const [key, item] of Object.entries(this._cache)) {
                        const t = item.lastUsed || item.timestamp || 0;
                        if (t < oldestTime) { oldestTime = t; oldestKey = key; }
                    }
                    if (oldestKey) {
                        delete this._cache[oldestKey];
                        this._safeSave('aniRating_cache', this._cache);
                    }
                } finally { this._writeLock = false; }
            }
        },

        _safeSave(key, data) {
            try {
                localStorage.setItem(key, JSON.stringify(data));
                return true;
            } catch (e) {
                if (e.name === 'QuotaExceededError' || e.code === 22) {
                    console.error(`[評分美化] 儲存 ${key} 失敗：localStorage 可能已滿`, e);
                } else {
                    console.error(`[評分美化] 儲存 ${key} 失敗:`, e);
                }
                return false;
            }
        },

        clear() {
            this._cache = {};
            localStorage.removeItem('aniRating_cache');
        },

        get size() { return Object.keys(this._cache).length; }
    };

    // ================================================================
    // 3. 請求管理 (RequestManager)
    // ================================================================
    const RequestManager = {
        _queue: Promise.resolve(),
        _lastRequestTime: 0,

        async scheduleFetch(url) {
            const absoluteUrl = url.startsWith('http') ? url : window.location.origin + url;
            const task = this._queue.then(async () => {
                const now = Date.now();
                const elapsed = now - this._lastRequestTime;
                if (elapsed < ConfigManager.data.fetchInterval) {
                    await new Promise(r => setTimeout(r, ConfigManager.data.fetchInterval - elapsed));
                }
                this._lastRequestTime = Date.now();
                try {
                    const res = await fetch(absoluteUrl);
                    if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : ' failed'}`);
                    return {
                        ok: true, status: res.status,
                        text: async () => res.text(),
                        json: async () => { try { return await res.json(); } catch { return { data: await res.text() }; } }
                    };
                } catch (e) {
                    console.error(`[評分美化] 佇列請求失敗: ${absoluteUrl}`, e);
                    return null;
                }
            });
            this._queue = task.catch(() => {});
            return task;
        },

        async gmFetch(url) {
            return new Promise((resolve) => {
                if (typeof GM_xmlhttpRequest !== 'function') {
                    resolve(null);
                    return;
                }
                const absoluteUrl = url.startsWith('http') ? url : window.location.origin + url;
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: absoluteUrl,
                    anonymous: false,
                    onload: (response) => {
                        if (response.status === 200) {
                            const textVal = response.responseText;
                            resolve({
                                ok: true,
                                status: response.status,
                                text: async () => textVal,
                                json: async () => { try { return JSON.parse(textVal); } catch { return { data: textVal }; } }
                            });
                        } else { resolve(null); }
                    },
                    onerror: () => resolve(null)
                });
            });
        }
    };

    // ================================================================
    // 4. DOM 工具 (DOMUtils)
    // ================================================================
    const DOMUtils = {
        extractSn(el) {
            if (!el) return null;
            const href = el.getAttribute('href') || el.querySelector('a')?.getAttribute('href') || '';
            const match = href.match(/sn=(\d+)/);
            return match ? match[1] : null;
        },

        getSnFromBlock(block) {
            if (!block) return null;
            const link = block.querySelector('a[href*="animeVideo.php?sn="]');
            if (!link) return null;
            const match = link.href.match(/sn=(\d+)/);
            return match ? match[1] : null;
        },

        getThumbnailContainer(cardLink) {
            if (!cardLink) return null;
            const container = cardLink.querySelector('.theme-img-block, .newanime-block__img, .newanime-img, .postimg, .anime-card-img');
            if (container) return container;
            const img = cardLink.querySelector('img');
            if (img) {
                const parent = img.parentElement;
                if (parent && parent !== cardLink) {
                    if (window.getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
                    return parent;
                }
            }
            return null;
        },

        isValidAnimeCard(link) {
            if (!link || link.tagName !== 'A') return false;
            if (!/anime(?:Video|Ref)\.php\?sn=\d+/.test(link.href)) return false;
            if (link.classList.contains('next-btn') || link.classList.contains('play-btn') ||
                link.classList.contains('click-area') || link.closest('.user-watchTime-list')) return false;
            return true;
        },

        cleanTitle(titleStr) {
            if (!titleStr) return '';
            return titleStr
                .replace(/play_arrow|skip_next|下一集/g, '')
                .replace(/[\n\r\t]/g, '').trim()
                .replace(/\s*\[\d+\]\s*$/, '')
                .replace(/\s*第\s*\d+\s*[集話]\s*$/, '')
                .replace(/\s*第\s*\d+\s*季\s*(\[\d+\])?\s*$/, '')
                .replace(/\s*\[雙語\]\s*$/, '').trim();
        },

        extractTotalEpisodes(titleStr) {
            if (!titleStr) return null;
            const s = titleStr.trim();
            let m = s.match(/\[\s*(\d+)\s*\]\s*$/);
            if (m) return parseInt(m[1]);
            m = s.match(/[全共]\s*(\d+)\s*[集話]/);
            return m ? parseInt(m[1]) : null;
        },

        getTotalEpisodesFromCard(cardLink) {
            if (!cardLink) return null;
            const el = cardLink.querySelector('.theme-number');
            return el ? DOMUtils.extractTotalEpisodes(el.textContent || '') : null;
        },

        isValidAnimeTitle(title) {
            if (!title || title.length <= 1 || title.length > 80) return false;
            const blocked = ['展開', '摺疊', '折疊', '確定', '取消', '下一集', '上一集', '播放', '暫停',
                '會員', '我的追番', '觀看紀錄', '設定', '訂閱', '分享', '刪除', '確定刪除',
                '隱私', '個人首頁', '登出', '登入', '註冊', '搜尋', '尋找', '熱門', '精選',
                '版權所有', '服務條款', '聯絡我們', '關於我們', '已看過', '看至', '觀看至',
                '已更新至', '更新至', '分', '秒', '小時', 'APP', 'VIP', 'AD', 'PR', 'close',
                'skip_next', 'play_arrow', 'expand_more', 'star_rate', 'keyboard_arrow_down'];
            if (blocked.some(w => title.toLowerCase().includes(w))) return false;
            if (/^\d+$/.test(title) || /\d+年\d+月/.test(title)) return false;
            return true;
        },

        getCardLink(el) {
            return el.closest('a, .theme-list-main, .newanime-block__link');
        }
    };

    // ================================================================
    // 5. 評分處理 (RatingProcessor)
    // ================================================================
    const RatingProcessor = {
        parseFromHtml(html) {
            const scoreMatch = html.match(/"ratingValue"\s*:\s*"?([0-9.]+)"?/);
            const countMatch = html.match(/"ratingCount"\s*:\s*"?([0-9]+)"?/);
            if (!scoreMatch || !countMatch) return null;
            const rawScore = parseFloat(scoreMatch[1]);
            const count = parseInt(countMatch[1]);
            // 從 JSON-LD 提取實際總集數 (numberOfEpisodes)，比卡片標示的「共X集」更準確
            let totalEpisodes = null;
            const episodeMatch = html.match(/"numberOfEpisodes"\s*:\s*(\d+)/);
            if (episodeMatch) totalEpisodes = parseInt(episodeMatch[1]);
            return { score: rawScore > 5 ? rawScore / 2 : rawScore, count, totalEpisodes };
        },

        generateStarDistribution(score) {
            let d5, d4, d3, d2, d1;
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
                d4 = 35; d3 = 25; d2 = 10;
                d1 = 100 - (d5 + d4 + d3 + d2);
            } else {
                d5 = Math.round(score * 3);
                d4 = Math.round(score * 5);
                d3 = Math.round(score * 8);
                d2 = Math.round((5 - score) * 12);
                d1 = 100 - (d5 + d4 + d3 + d2);
            }
            [d5, d4, d3, d2, d1] = [d5, d4, d3, d2, d1].map(v => Math.max(1, v));
            const total = d5 + d4 + d3 + d2 + d1;
            return {
                5: Math.round((d5 / total) * 100),
                4: Math.round((d4 / total) * 100),
                3: Math.round((d3 / total) * 100),
                2: Math.round((d2 / total) * 100),
                1: Math.round((d1 / total) * 100)
            };
        },

        _getTierInfo(score, isLowSample) {
            if (isLowSample) {
                return { class: 'acr-low-sample', text: '評估人數過少', color: '#a1a1aa', bg: 'rgba(161, 161, 170, 0.12)' };
            }
            if (score >= 4.8) return { class: 'acr-tier-mythical', text: '神作必看', color: '#ff2a6d', bg: 'rgba(255, 42, 109, 0.15)' };
            if (score >= 4.5) return { class: 'acr-tier-excellent', text: '極力推薦', color: '#FFD700', bg: 'rgba(255, 215, 0, 0.15)' };
            if (score >= 4.0) return { class: 'acr-tier-good', text: '佳作推薦', color: '#05ffc4', bg: 'rgba(5, 255, 196, 0.15)' };
            if (score >= 3.5) return { class: 'acr-tier-average', text: '中規中矩', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.15)' };
            return { class: 'acr-tier-poor', text: '雷作避難', color: '#ff5f5f', bg: 'rgba(255, 95, 95, 0.15)' };
        },

        render(container, data) {
            if (!container || container.querySelector('.ani-custom-rating')) return;

            const score = parseFloat(data.score);
            const count = parseInt(data.count);
            const countFormatted = count.toLocaleString('zh-TW');
            const cardLink = DOMUtils.getCardLink(container);
            if (cardLink) cardLink.setAttribute('data-rating-score', score);
            // 儲存從 JSON-LD 取得的實際總集數，比卡片標示更準確
            if (cardLink && data.totalEpisodes) {
                cardLink.setAttribute('data-rating-total-episodes', data.totalEpisodes);
            }

            const isLowSample = count < ConfigManager.data.sampleThreshold;
            const tier = this._getTierInfo(score, isLowSample);
            const distribution = this.generateStarDistribution(score);

            const badge = document.createElement('div');
            badge.className = `ani-custom-rating ${tier.class}`;
            badge.style.cssText = `font-size:${ConfigManager.data.fontSize}px;border-radius:${ConfigManager.data.radius}px`;

            badge.innerHTML = `
                ★${score.toFixed(1)}${isLowSample ? ' ⚠️' : ''}
                <span class="acr-sep"></span>
                <span class="acr-count">${countFormatted}人</span>
                <div class="acr-tooltip">
                    <div class="acr-tooltip-title">
                        <span>評分細節分佈</span>
                        <span class="acr-tooltip-recomm" style="color:${tier.color};background:${tier.bg}">${tier.text}</span>
                    </div>
                    ${isLowSample ? '<div style="font-size:11px;color:#f87171;margin-bottom:8px;text-align:center;">⚠️ 評價人數過少，分數信賴度低</div>' : ''}
                    <div class="acr-tooltip-dist">
                        ${[5, 4, 3, 2, 1].map(star => `
                        <div class="acr-dist-row">
                            <span class="acr-dist-label">${star} 星</span>
                            <div class="acr-dist-bar-bg">
                                <div class="acr-dist-bar-fill" style="width:${distribution[star]}%;background:${star === 5 ? tier.color : star === 4 ? '#94a3b8' : star === 3 ? '#4b4b50' : star === 2 ? '#ff5f5f' : '#991b1b'}"></div>
                            </div>
                            <span class="acr-dist-val">${distribution[star]}%</span>
                        </div>`).join('')}
                    </div>
                </div>
            `;

            badge.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
            container.appendChild(badge);

            UIComponents.updateActionButtonsVisibility();
            if (App.isSorted) SortManager.triggerDebounced();
        },

        applyFilter(container, score) {
            if (!container) return;
            const isListPage = App.isAnimeListPage();
            const cardLink = DOMUtils.getCardLink(container);
            if (cardLink && isListPage) {
                const img = cardLink.querySelector('img');
                if (img) {
                    if (score < ConfigManager.data.threshold) {
                        img.classList.add('ani-low-rating-masked');
                        img.style.pointerEvents = 'auto';
                    } else {
                        img.classList.remove('ani-low-rating-masked');
                    }
                }
            }
            if (isListPage) {
                const target = cardLink || container;
                target.classList.toggle('ani-rating-blocked', score < ConfigManager.data.blockThreshold);
            } else {
                const target = cardLink || container;
                target.classList.remove('ani-rating-blocked');
            }
        },

        async processItem(sn, container) {
            if (!ConfigManager.data.enabled || !container) return;

            const cardLink = DOMUtils.getCardLink(container);
            if (cardLink) SortManager.registerOrder(sn);

            WatchHistoryManager.checkAndApplyFade(cardLink);

            const cached = CacheManager.get(sn);
            if (cached) {
                this.render(container, cached);
                this.applyFilter(container, cached.score);
                App.progress.ratingLoaded++;
                App.progress.updateBar();
                return;
            }

            const skeleton = document.createElement('div');
            skeleton.className = 'ani-rating-skeleton';
            container.appendChild(skeleton);

            try {
                const res = await RequestManager.scheduleFetch(`/animeRef.php?sn=${sn}`);
                if (!res || !res.ok) { skeleton.remove(); return; }
                const html = await res.text();
                const parsed = this.parseFromHtml(html);
                skeleton.remove();
                if (parsed) {
                    CacheManager.set(sn, parsed.score, parsed.count, parsed.totalEpisodes);
                    this.render(container, parsed);
                    this.applyFilter(container, parsed.score);
                    App.progress.ratingLoaded++;
                    App.progress.updateBar();
                }
            } catch (e) {
                console.error('[評分美化] 抓取評分時出錯: SN ' + sn, e);
            } finally {
                if (skeleton && skeleton.parentNode) skeleton.remove();
            }
        }
    };

    // ================================================================
    // 6. 觀看紀錄管理 (WatchHistoryManager)
    // ================================================================
    const WatchHistoryManager = {
        /**
         * 資料結構：
         *   _rawArray: 歷遍所有分頁後的完整原始陣列（每一頁 history[] concat 而成）
         *   _byAnimeSn: animeSn → item（供卡片快速查詢，卡片 href 用的是 animeSn）
         *   _byVideoSn: videoSn → item（供其他用途）
         */
        _rawArray: [],
        _byAnimeSn: new Map(),
        _byVideoSn: new Map(),

        /**
         * 使用原生 fetch() 遞迴抓取所有分頁的觀看紀錄。
         * 瀏覽器會自動帶上 BAHAMUT Cookie，無需手動驗證。
         * 所有分頁的 history[] 會 concat 成一個大陣列，
         * 並建立 videoSn → item 的 Map 供快速查詢。
         */
        async fetchHistory() {
            try {
                console.log('[評分美化] 正在背景同步完整觀看紀錄...');
                const API_URL = 'https://api.gamer.com.tw/anime/v3/history.php';
                let page = 1;
                const allItems = [];

                App.progress.historyInProgress = true;
                App.progress.historyCurrentPage = 0;
                App.progress.historyTotalPages = 1;
                App.progress.updateHistoryBar();

                while (true) {
                    App.progress.historyCurrentPage = page;
                    App.progress.updateHistoryBar();

                    // 主要使用 GM_xmlhttpRequest 以攜帶 BAHAMUT Cookie
                    let res = await RequestManager.gmFetch(`${API_URL}?page=${page}`);
                    // 若 GM 失敗則 fallback 到原生 fetch
                    if (!res || !res.ok) {
                        try { res = await fetch(`${API_URL}?page=${page}`); } catch { break; }
                    }
                    if (!res || !res.ok) break;

                    const json = await res.json();
                    const data = json?.data;
                    if (!data?.history?.length) break;

                    App.progress.historyTotalPages = data.totalPage || page;

                    // 合併每一頁的陣列
                    allItems.push(...data.history);

                    page++;
                    await new Promise(r => setTimeout(r, 300));
                }

                // 儲存原始完整陣列
                this._rawArray = allItems;

                // 建立 animeSn 和 videoSn → item 的 Map
                this._rebuildMaps();

                App.progress.historyInProgress = false;
                App.progress.historyCurrentPage = App.progress.historyTotalPages;
                App.progress.updateHistoryBar();

                console.log(`[評分美化] API 同步完成！共 ${this._rawArray.length} 筆紀錄，${this._byVideoSn.size} 個 videoSn 索引`);
                this.applyFadeToPage();
            } catch (e) {
                console.error('[評分美化] API 同步觀看紀錄失敗', e);
            }
        },

        /** 從 _rawArray 重建 _byAnimeSn 和 _byVideoSn Map */
        _rebuildMaps() {
            this._byAnimeSn = new Map();
            this._byVideoSn = new Map();
            for (const item of this._rawArray) {
                // 建立 animeSn → item 的索引（卡片 href 用的是 animeSn）
                if (item.animeSn) {
                    this._byAnimeSn.set(item.animeSn, item);
                }
                // 建立 videoSn → item 的索引（每一集的 videoSn）
                if (item.videoSn) {
                    this._byVideoSn.set(item.videoSn, item);
                }
                // 同時建立 history 中每一集的 videoSn → item 的索引
                if (item.history && Array.isArray(item.history)) {
                    for (const hist of item.history) {
                        if (hist.videoSn) {
                            this._byVideoSn.set(hist.videoSn, item);
                        }
                    }
                }
            }
        },

        /** 將 _rawArray 匯出為 JSON 檔案並下載 */
        _exportJSON() {
            if (this._rawArray.length === 0) return;
            try {
                const blob = new Blob([JSON.stringify(this._rawArray, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `ani-history-${Date.now()}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                console.log(`[評分美化] 已匯出 JSON 檔案：${a.download} (${this._rawArray.length} 筆紀錄)`);
            } catch (e) {
                console.warn('[評分美化] 匯出 JSON 失敗', e);
            }
        },

        /**
         * 從卡片元素取得當前觀看進度。
         * 優先權：
         *   1. DOM 中的官方進度元素 (多重 selector fallback)
         *   2. API 查詢 (videoSn)
         * @param {Element} cardLink 卡片連結元素
         * @returns {{ episode: number, rawEpisode: string, fullyWatched: boolean, latestEpisode: string, totalEpisodes: number | null } | null}
         */
        _getWatchProgress(cardLink) {
            if (!cardLink) return null;

            // 1. DOM 直接讀取：嘗試多種可能的 selector
            const selectors = [
                '.history-lastwatch .user-lastwatch',
                '.anime-watchHistory-reply__lastwatch',
                '.watch-history-lastwatch',
                '[class*="lastwatch"]',
                '[class*="watchHistory"] span'
            ];
            let lastwatchEl = null;
            for (const sel of selectors) {
                lastwatchEl = cardLink.querySelector(sel);
                if (lastwatchEl) break;
            }

            if (lastwatchEl) {
                const episodeText = lastwatchEl.textContent.trim();
                const numericEpisode = parseFloat(episodeText);
                if (!isNaN(numericEpisode)) {
                    return { episode: numericEpisode, rawEpisode: episodeText, fullyWatched: false, latestEpisode: episodeText, totalEpisodes: null };
                }
            }

            // 2. API 查詢：從 href 提取 sn (animeSn，不是 videoSn)
            const match = cardLink.href.match(/sn=(\d+)/);
            if (match) {
                const animeSn = parseInt(match[1]);
                // 優先使用 animeSn 查詢（卡片 href 用的是 animeSn）
                let item = this._byAnimeSn.get(animeSn);
                // 如果 animeSn 查不到，嘗試用 videoSn 查詢（向後相容）
                if (!item) {
                    item = this._byVideoSn.get(animeSn);
                }
                if (item) {
                    const rawEp = item.episode || '';
                    const episode = parseFloat(rawEp) || 0;
                    const fullyWatched = item.breakPoint?.breakPoint === -1;
                    // 從 newestEpisode 提取最新集數（例如 "已更新至 第12集" → "12"）
                    const latestMatch = item.newestEpisode?.match(/第\s*(\d+)/);
                    const latestEpisode = latestMatch ? latestMatch[1] : rawEp;
                    // 從 history 計算總觀看集數（去重）
                    const watchedSet = new Set(item.history?.map(h => h.videoSn) || []);
                    const totalWatched = watchedSet.size;
                    return {
                        episode,
                        rawEpisode: rawEp,
                        fullyWatched,
                        latestEpisode,
                        totalEpisodes: totalWatched
                    };
                }
            }

            return null;
        },

        checkAndApplyFade(cardLink) {
            if (!cardLink) return;
            const container = DOMUtils.getThumbnailContainer(cardLink);
            if (!container) return;

            const oldBadge = container.querySelector('.ani-watch-progress-badge');
            if (oldBadge) oldBadge.remove();

            // 如果歷史紀錄還沒載入完成，先顯示「尚未觀看」
            if (!this._rawArray || this._rawArray.length === 0) {
                const badge = document.createElement('div');
                badge.className = 'ani-watch-progress-badge unwatched';
                badge.innerHTML = `<span class="watch-text">尚未觀看</span>`;
                container.appendChild(badge);
                cardLink.classList.remove('ani-watched-fade');
                cardLink.classList.add('ani-unwatched-card');
                return;
            }

            const progress = this._getWatchProgress(cardLink);
            const badge = document.createElement('div');
            badge.className = 'ani-watch-progress-badge';

            if (progress) {
                cardLink.classList.add('ani-watched-fade');
                cardLink.classList.remove('ani-unwatched-card');
                badge.classList.add('watched');

                // 計算進度百分比（用於進度條背景）
                // 如果有總集數資訊，計算觀看百分比；否則預設 100%
                let progressPercent = 100;
                if (progress.totalEpisodes && progress.totalEpisodes > 0) {
                    progressPercent = Math.min(100, Math.round((progress.totalEpisodes / (progress.latestEpisode || 1)) * 100));
                } else if (progress.fullyWatched) {
                    progressPercent = 100;
                }

                let label;
                if (progress.fullyWatched) {
                    label = `看到第 ${progress.rawEpisode} 話（最新第 ${progress.latestEpisode} 話）`;
                } else if (progress.episode > 0) {
                    const displayEp = progress.rawEpisode && progress.rawEpisode !== String(progress.episode)
                        ? progress.rawEpisode : progress.episode;
                    label = `看到第 ${displayEp} 話（最新第 ${progress.latestEpisode} 話）`;
                } else {
                    label = '已觀看';
                }

                // 建立帶進度條的徽章
                badge.innerHTML = `
                    <div class="watch-progress-bar" style="width:${progressPercent}%"></div>
                    <span class="watch-text">${label}</span>
                `;
            } else {
                cardLink.classList.remove('ani-watched-fade');
                cardLink.classList.add('ani-unwatched-card');
                badge.classList.add('unwatched');
                badge.innerHTML = `<span class="watch-text">尚未觀看</span>`;
            }
            container.appendChild(badge);
        },

        applyFadeToPage() {
            const selector = 'a.theme-list-main, .newanime-block, .newanime-block__link';
            document.querySelectorAll(selector).forEach(link => this.checkAndApplyFade(link));
        }
    };

    // ================================================================
    // 7. 排序管理 (SortManager)
    // ================================================================
    const SortManager = {
        _snapshots: [],
        _debounceTimeout: null,
        _lastToastTime: 0,

        SORTABLE_BLOCKS: [
            { parent: '.theme-list-block', child: 'a.theme-list-main' },
            { parent: '.newanime-wrap', child: '.newanime-block' },
            { parent: '.newanime-wrap-main', child: '.newanime-block' }
        ],

        captureSnapshot() {
            this._snapshots = [];
            this.SORTABLE_BLOCKS.forEach(({ parent, child }) => {
                document.querySelectorAll(parent).forEach(block => {
                    const sns = [];
                    block.querySelectorAll(child).forEach(item => {
                        const sn = (child === 'a.theme-list-main' || child === 'a')
                            ? DOMUtils.extractSn(item) : DOMUtils.getSnFromBlock(item);
                        if (sn) sns.push(sn);
                    });
                    if (sns.length > 0) this._snapshots.push({ parent, child, sns });
                });
            });
        },

        _restoreFromSnapshot() {
            this._snapshots.forEach(snapshot => {
                document.querySelectorAll(snapshot.parent).forEach(block => {
                    const items = Array.from(block.querySelectorAll(snapshot.child));
                    const itemMap = new Map();
                    items.forEach(item => {
                        const sn = (snapshot.child === 'a.theme-list-main' || snapshot.child === 'a')
                            ? DOMUtils.extractSn(item) : DOMUtils.getSnFromBlock(item);
                        if (sn) itemMap.set(sn, item);
                    });
                    snapshot.sns.forEach(sn => {
                        const item = itemMap.get(sn);
                        if (item) block.appendChild(item);
                    });
                });
            });
        },

        registerOrder(sn) {
            // 使用快照方式，無需額外註冊
        },

        apply(isSorted) {
            if (!isSorted && this._snapshots.length > 0) {
                this._restoreFromSnapshot();
                return;
            }

            this.SORTABLE_BLOCKS.forEach(cfg => {
                document.querySelectorAll(cfg.parent).forEach(block => {
                    const items = Array.from(block.querySelectorAll(cfg.child));
                    if (items.length === 0) return;

                    items.sort((a, b) => {
                        let scoreA = 0, scoreB = 0;
                        if (cfg.child === 'a.theme-list-main' || cfg.child === 'a') {
                            scoreA = parseFloat(a.getAttribute('data-rating-score')) || 0;
                            scoreB = parseFloat(b.getAttribute('data-rating-score')) || 0;
                        } else {
                            const linkA = a.querySelector('a[href*="animeVideo.php?sn="]');
                            const linkB = b.querySelector('a[href*="animeVideo.php?sn="]');
                            if (linkA) scoreA = parseFloat(linkA.getAttribute('data-rating-score')) || 0;
                            if (linkB) scoreB = parseFloat(linkB.getAttribute('data-rating-score')) || 0;
                        }
                        return isSorted ? scoreB - scoreA : 0;
                    });
                    items.forEach(item => block.appendChild(item));
                });
            });
        },

        async forceLoadAllAndSort() {
            const selector = 'a.theme-list-main:not([data-rating-processed])';
            const unprocessed = Array.from(document.querySelectorAll(selector)).filter(DOMUtils.isValidAnimeCard);
            const sortBtn = document.getElementById('ani-sort-float-btn');

            if (unprocessed.length === 0) {
                this.apply(true);
                if (sortBtn) { sortBtn.innerHTML = '★↓'; sortBtn.classList.remove('loading'); }
                return;
            }

            if (sortBtn) { sortBtn.innerHTML = '⏳'; sortBtn.classList.add('loading'); }

            let progressBar = document.getElementById('ani-sort-progress-bar');
            if (!progressBar) {
                progressBar = document.createElement('div');
                progressBar.id = 'ani-sort-progress-bar';
                document.body.appendChild(progressBar);
            }
            progressBar.style.width = '0%';
            progressBar.style.opacity = '1';

            App.progress.recalc();
            App.progress.ratingLoaded = 0;
            App.progress.updateBar();

            for (const link of unprocessed) {
                if (!App.isSorted) {
                    progressBar.style.opacity = '0';
                    if (sortBtn) { sortBtn.classList.remove('loading'); sortBtn.innerHTML = '⇅'; }
                    return;
                }
                const match = link.href.match(/sn=(\d+)/);
                if (match) {
                    const container = DOMUtils.getThumbnailContainer(link);
                    if (container) {
                        link.setAttribute('data-rating-processed', 'true');
                        await RatingProcessor.processItem(match[1], container);
                    }
                }
            }

            progressBar.style.width = '100%';
            setTimeout(() => { progressBar.style.opacity = '0'; }, 500);
            if (sortBtn) { sortBtn.classList.remove('loading'); sortBtn.innerHTML = '★↓'; }
            this.apply(true);
            UIComponents.showToast('✅ 已強制預先載入所有評等，排序完成！');
        },

        triggerDebounced() {
            clearTimeout(this._debounceTimeout);
            this._debounceTimeout = setTimeout(async () => {
                const selector = 'a.theme-list-main:not([data-rating-processed])';
                const unprocessed = Array.from(document.querySelectorAll(selector)).filter(DOMUtils.isValidAnimeCard);
                if (unprocessed.length > 0) {
                    for (const link of unprocessed) {
                        const match = link.href.match(/sn=(\d+)/);
                        if (match) {
                            const container = DOMUtils.getThumbnailContainer(link);
                            if (container) {
                                link.setAttribute('data-rating-processed', 'true');
                                await RatingProcessor.processItem(match[1], container);
                            }
                        }
                    }
                }
                this.apply(true);
                const now = Date.now();
                if (now - this._lastToastTime > 5000) {
                    UIComponents.showToast('ℹ️ 目前已自動套用「評分高低」自訂排序模式（非官方預設）');
                    this._lastToastTime = now;
                }
            }, 300);
        }
    };

    // ================================================================
    // 8. UI 元件 (UIComponents)
    // ================================================================
    const UIComponents = {
        injectStyles() {
            const cfg = ConfigManager.data;
            const style = document.createElement('style');
            style.innerHTML = `
                .ani-rating-skeleton {
                    position:absolute;top:6px;left:6px;width:78px;height:21px;
                    background:rgba(30,30,30,0.85);border-radius:${cfg.radius}px;
                    border:1px solid rgba(255,255,255,0.15);z-index:10;
                    pointer-events:none;animation:acr-pulse 1.4s ease-in-out infinite;
                }
                @keyframes acr-pulse {
                    0%,100%{background:rgba(30,30,30,0.65);border-color:rgba(255,255,255,0.18);}
                    50%{background:rgba(55,55,60,0.9);border-color:rgba(255,255,255,0.35);}
                }
                .ani-custom-rating {
                    position:absolute;top:6px;left:6px;background:rgba(255,255,255,0.95);
                    backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
                    border-radius:${cfg.radius}px;padding:4px 10px;display:inline-flex;
                    align-items:center;gap:6px;font-size:${cfg.fontSize}px;font-weight:700;
                    z-index:10;line-height:1;transition:all 0.2s cubic-bezier(0.4,0,0.2,1);
                    box-shadow:0 2px 8px rgba(0,0,0,0.12);cursor:help;pointer-events:auto !important;
                }
                .acr-tier-mythical{color:#c81e4a;border:1.5px solid rgba(200,30,74,0.6);background:rgba(255,240,242,0.95);box-shadow:0 0 10px rgba(200,30,74,0.25);}
                .acr-tier-excellent{color:#b45309;border:1px solid rgba(180,83,9,0.5);background:rgba(255,251,235,0.95);}
                .acr-tier-good{color:#047857;border:1px solid rgba(4,120,87,0.4);background:rgba(236,253,245,0.95);}
                .acr-tier-average{color:#475569;border:1px solid rgba(71,85,105,0.35);background:rgba(241,245,249,0.95);}
                .acr-tier-poor{color:#b91c1c;border:1px solid rgba(185,28,28,0.45);background:rgba(254,242,242,0.95);}
                .acr-low-sample{color:#b45309 !important;border:2px solid #f59e0b !important;background:#fef3c7 !important;box-shadow:0 0 0 1px rgba(245,158,11,0.3),0 2px 8px rgba(245,158,11,0.2) !important;animation:acr-pulse-warning 2s infinite !important;}
                @keyframes acr-pulse-warning{0%,100%{box-shadow:0 0 0 1px rgba(251,146,60,0.3),0 2px 8px rgba(251,146,60,0.2);}50%{box-shadow:0 0 0 2px rgba(251,146,60,0.5),0 4px 12px rgba(251,146,60,0.4);}}
                .ani-custom-rating .acr-sep{width:1px;height:11px;background:rgba(255,255,255,0.2);flex-shrink:0;}
                .ani-custom-rating .acr-count{color:rgba(0,0,0,0.78);font-size:${cfg.fontSize - 3}px;font-weight:400;}
                body.ani-user-dark-mode .ani-custom-rating .acr-count{color:#d4d4d8 !important;}
                .acr-tooltip{position:absolute;left:0;top:calc(100% + 8px);width:200px;background:#18181c;border:1.5px solid rgba(255,255,255,0.12);border-radius:10px;padding:12px;box-shadow:0 12px 28px rgba(0,0,0,0.85);z-index:99999;opacity:0;visibility:hidden;transform:translateY(-6px);transition:all 0.2s cubic-bezier(0.16,1,0.3,1);pointer-events:none;color:#f4f4f7;font-family:system-ui,sans-serif;font-weight:normal;line-height:1.4;}
                .ani-custom-rating:hover .acr-tooltip{opacity:1;visibility:visible;transform:translateY(0);}
                .acr-tooltip-title{font-weight:700;font-size:13px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;}
                .acr-tooltip-recomm{font-size:11px;padding:2px 6px;border-radius:4px;font-weight:600;}
                .acr-tooltip-dist{display:flex;flex-direction:column;gap:5.5px;border-top:1px solid rgba(255,255,255,0.06);padding-top:8px;font-size:11px;}
                .acr-dist-row{display:flex;align-items:center;gap:6px;}
                .acr-dist-label{color:#a1a1aa;width:26px;text-align:right;flex-shrink:0;}
                .acr-dist-bar-bg{flex:1;height:5px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;}
                .acr-dist-bar-fill{height:100%;border-radius:3px;}
                .acr-dist-val{color:#d4d4d8;width:28px;text-align:right;font-size:10px;font-weight:500;flex-shrink:0;}
.ani-watch-progress-badge{position:absolute;top:32px;left:6px;font-size:9px;padding:2px 10px;border-radius:50px;font-weight:500;z-index:10;pointer-events:none;letter-spacing:0.3px;line-height:1.3;transition:all 0.3s cubic-bezier(0.4,0,0.2,1);display:inline-flex;align-items:center;gap:3px;flex-wrap:nowrap;max-width:180px;overflow:hidden;}
.ani-watch-progress-badge .watch-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9px;font-weight:500;text-shadow:none;position:relative;z-index:2;}
.ani-watch-progress-badge .watch-progress-bar{position:absolute;top:0;left:0;height:100%;background:rgba(59,130,246,0.55);border-radius:50px;z-index:1;transition:width 0.3s ease;}
.ani-watch-progress-badge.watched{background:rgba(59,130,246,0.22);color:#fff;border:none;box-shadow:0 2px 6px rgba(0,0,0,0.2);backdrop-filter:blur(6px);transition:all 0.3s cubic-bezier(0.4,0,0.2,1);}
.ani-watch-progress-badge.watched::before{content:none;display:none;}
                @keyframes watch-glow{0%,100%{opacity:0.5;}50%{opacity:1;}}
.ani-watch-progress-badge.unwatched{background:rgba(80,80,85,0.45);color:#d4d4d8;border:none;box-shadow:0 1px 4px rgba(0,0,0,0.15);backdrop-filter:blur(4px);transition:all 0.3s cubic-bezier(0.4,0,0.2,1);}
.ani-watch-progress-badge.unwatched::after{content:none;display:none;}
@keyframes acr-unwatched-pulse{0%,100%{box-shadow:0 0 6px rgba(239,68,68,0.6),0 0 12px rgba(239,68,68,0.3);}50%{box-shadow:0 0 12px rgba(239,68,68,0.95),0 0 20px rgba(239,68,68,0.5);}}
                body:not(.ani-disable-masking) .ani-low-rating-masked{filter:grayscale(0.95) opacity(0.2) blur(2.5px) !important;transition:filter 0.3s ease,opacity 0.3s ease;}
                body:not(.ani-disable-masking) .ani-low-rating-masked .ani-custom-rating,body:not(.ani-disable-masking) .ani-low-rating-masked .ani-watch-progress-badge{opacity:1 !important;pointer-events:auto !important;filter:none !important;backdrop-filter:none !important;transition:opacity 0.3s ease;}
                body:not(.ani-disable-masking) a:hover .ani-low-rating-masked,body:not(.ani-disable-masking) .theme-list-main:hover .ani-low-rating-masked,body:not(.ani-disable-masking) .newanime-block__link:hover .ani-low-rating-masked,body:not(.ani-disable-masking) .newanime-block:hover .ani-low-rating-masked,body:not(.ani-disable-masking) .theme-img-block:hover .ani-low-rating-masked{filter:grayscale(0) opacity(1) blur(0px) !important;}
                body.ani-disable-masking .ani-low-rating-masked{filter:none !important;opacity:1 !important;}
                body.ani-disable-masking .ani-low-rating-masked .ani-custom-rating,body.ani-disable-masking .ani-low-rating-masked .ani-watch-progress-badge{opacity:1 !important;pointer-events:auto !important;}
                body:not(.ani-disable-blocking) .ani-rating-blocked{display:none !important;}
                .ani-unwatched-card{border:2px solid rgba(2,132,199,0.55) !important;background:rgba(2,132,199,0.03) !important;box-shadow:0 4px 14px rgba(2,132,199,0.15) !important;transition:all 0.3s ease !important;box-sizing:border-box !important;}
                .ani-unwatched-card:hover{border-color:rgba(2,132,199,0.95) !important;box-shadow:0 8px 28px rgba(2,132,199,0.3) !important;}
                body.ani-watched-fade-enabled .ani-watched-fade>img:not(.ani-low-rating-masked),body.ani-watched-fade-enabled .ani-watched-fade .theme-img-block>img:not(.ani-low-rating-masked),body.ani-watched-fade-enabled .ani-watched-fade .newanime-block__img>img:not(.ani-low-rating-masked),body.ani-watched-fade-enabled .ani-watched-fade .newanime-img>img:not(.ani-low-rating-masked){opacity:0.32 !important;filter:grayscale(0.12) contrast(0.95);transition:opacity 0.3s ease,filter 0.3s ease;}
                body.ani-watched-fade-enabled .ani-watched-fade:hover>img:not(.ani-low-rating-masked),body.ani-watched-fade-enabled .ani-watched-fade:hover .theme-img-block>img:not(.ani-low-rating-masked),body.ani-watched-fade-enabled .ani-watched-fade:hover .newanime-block__img>img:not(.ani-low-rating-masked),body.ani-watched-fade-enabled .ani-watched-fade:hover .newanime-img>img:not(.ani-low-rating-masked){opacity:1 !important;filter:none !important;}
                body.ani-watched-fade-enabled .ani-watched-fade{display:block !important;cursor:pointer;}
                                .ani-float-btn{position:fixed;right:20px;width:44px;height:44px;border-radius:50%;background:#18181c;border:1px solid rgba(255,255,255,0.12);color:#d4d4d8;box-shadow:0 4px 16px rgba(0,0,0,0.5);display:none;align-items:center !important;justify-content:center !important;text-align:center !important;cursor:pointer;font-size:16px;font-weight:bold;z-index:9999;transition:all 0.2s ease;user-select:none;padding:0 !important;line-height:1 !important;box-sizing:border-box !important;}
                .ani-float-btn:hover{transform:scale(1.08);background:#27272a;color:#3b82f6;border-color:rgba(59,130,246,0.4);}
                .ani-float-btn.active{background:#3b82f6 !important;color:#fff !important;border-color:#2563eb !important;box-shadow:0 4px 20px rgba(59,130,246,0.4) !important;}
                #ani-sort-float-btn{bottom:85px;font-size:15px;}#ani-mask-float-btn{bottom:135px;}#ani-block-float-btn{bottom:185px;}#ani-config-float-btn{bottom:235px;}
                #ani-sort-progress-bar{position:fixed;bottom:0;left:0;height:6px;background:linear-gradient(90deg,#3b82f6 0%,#8b5cf6 50%,#ec4899 100%);background-size:200% 100%;animation:ani-progress-shimmer 2s linear infinite;z-index:1000000;width:0%;transition:width 0.35s cubic-bezier(0.4,0,0.2,1),opacity 0.4s ease;box-shadow:0 0 20px rgba(59,130,246,0.7),0 0 40px rgba(139,92,246,0.5),0 0 60px rgba(236,72,153,0.3);opacity:0;border-radius:0 3px 3px 0;}
                @keyframes ani-progress-shimmer{0%{background-position:100% 0;}100%{background-position:-100% 0;}}
                #ani-sort-progress-bar::after{content:attr(data-percent);position:absolute;right:6px;top:-24px;font-size:11px;color:#fff;font-weight:700;font-family:system-ui,sans-serif;background:rgba(0,0,0,0.8);padding:2px 8px;border-radius:10px;border:1px solid rgba(255,255,255,0.15);text-shadow:0 1px 2px rgba(0,0,0,0.5);letter-spacing:0.3px;white-space:nowrap;pointer-events:none;}
                #ani-sort-progress-bar[data-percent*="100"]::after{opacity:0;transition:opacity 0.3s ease;}
                #ani-history-progress-bar{position:fixed;bottom:0;left:0;height:4px;background:linear-gradient(90deg,#10b981 0%,#14b8a6 50%,#06b6d4 100%);background-size:200% 100%;animation:ani-history-shimmer 2.5s linear infinite;z-index:999999;width:0%;transition:width 0.2s cubic-bezier(0.4,0,0.2,1),opacity 0.4s ease;box-shadow:0 0 20px rgba(16,185,129,0.8),0 0 40px rgba(20,184,166,0.6),0 0 60px rgba(6,182,212,0.4);opacity:0;border-radius:0 3px 3px 0;}
                @keyframes ani-history-shimmer{0%{background-position:100% 0;}100%{background-position:-100% 0;}}
                #ani-history-progress-bar::after{content:attr(data-percent);position:absolute;right:6px;top:-22px;font-size:10px;color:#fff;font-weight:700;font-family:system-ui,sans-serif;background:rgba(0,0,0,0.8);padding:2px 7px;border-radius:9px;border:1px solid rgba(255,255,255,0.12);text-shadow:0 1px 2px rgba(0,0,0,0.5);letter-spacing:0.3px;white-space:nowrap;pointer-events:none;}
                #ani-history-progress-bar[data-percent*="100"]::after{opacity:0;transition:opacity 0.3s ease;}
                #ani-sort-progress-bar.ani-progress-stacked{bottom:20px;}#ani-history-progress-bar.ani-progress-stacked{bottom:22px;}
                #ani-rating-toast{position:fixed;top:24px;left:50%;transform:translate(-50%,-40px);background:rgba(20,20,23,0.96);border:1.5px solid #3b82f6;color:#fff;padding:10px 22px;border-radius:24px;font-size:12.5px;font-weight:600;box-shadow:0 12px 32px rgba(0,0,0,0.6);z-index:1000000;pointer-events:none;opacity:0;transition:opacity 0.35s cubic-bezier(0.16,1,0.3,1),transform 0.35s cubic-bezier(0.16,1,0.3,1);text-align:center;white-space:nowrap;}
                #ani-rating-toast.show{opacity:1;transform:translate(-50%,0);}
                #ani-rating-tour-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.75);backdrop-filter:blur(5px);z-index:1000000;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;}
                #ani-rating-tour-card{background:#18181c;border:1px solid rgba(255,255,255,0.12);border-radius:16px;width:320px;padding:20px;color:#f4f4f7;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);display:flex;flex-direction:column;gap:16px;}
                .artc-header{display:flex;justify-content:space-between;align-items:center;}
                .artc-step-num{font-size:11px;color:#3b82f6;font-weight:700;}
                .artc-close-btn{background:none;border:none;color:#71717a;cursor:pointer;font-size:14px;}
                .artc-close-btn:hover{color:#f4f4f7;}
                .artc-body{display:flex;flex-direction:column;gap:10px;text-align:center;}
                .artc-title{font-size:16px;font-weight:700;color:#fff;}
                .artc-desc{font-size:13px;color:#a1a1aa;line-height:1.5;}
                .artc-indicators{display:flex;justify-content:center;gap:6px;margin-top:8px;}
                .artc-dot{width:6px;height:6px;border-radius:50%;background:#3f3f46;transition:background 0.2s;}
                .artc-dot.active{background:#3b82f6;width:12px;border-radius:3px;}
                .artc-footer{display:flex;gap:8px;margin-top:4px;}
                .artc-btn{flex:1;padding:8px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;border:none;transition:background 0.2s;}
                .artc-btn-skip{background:rgba(255,255,255,0.05);color:#a1a1aa;border:1px solid rgba(255,255,255,0.08);}
                .artc-btn-skip:hover{background:rgba(255,255,255,0.1);color:#fff;}
                .artc-btn-next{background:#3b82f6;color:white;}
                .artc-btn-next:hover{background:#2563eb;}
                #ani-rating-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);z-index:999998;display:flex;align-items:center;justify-content:center;}
                #ani-rating-modal{background:#fff;border:1px solid rgba(0,0,0,0.12);border-radius:16px;width:420px;max-width:90vw;overflow:visible;color:#202020;font-family:system-ui,-apple-system,sans-serif;box-shadow:0 20px 40px rgba(0,0,0,0.15);}
                .arm-header{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:2px solid rgba(59,130,246,0.3);background:linear-gradient(135deg,#eff6ff 0%,#dbeafe 50%,#eff6ff 100%);border-radius:16px 16px 0 0;box-shadow:0 2px 8px rgba(59,130,246,0.12);}
                .arm-header-left{display:flex;align-items:center;gap:10px;}
                .arm-icon{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#3b82f6 0%,#8b5cf6 100%);display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 4px 12px rgba(59,130,246,0.35);animation:arm-icon-glow 2s ease-in-out infinite;}
                @keyframes arm-icon-glow{0%,100%{box-shadow:0 4px 12px rgba(59,130,246,0.35);}50%{box-shadow:0 4px 20px rgba(139,92,246,0.55);}}
                .arm-title{font-size:16px;font-weight:800;color:#1e40af;text-shadow:0 1px 2px rgba(59,130,246,0.15);}
                .arm-subtitle{font-size:11px;color:#4b5563;margin-top:2px;font-weight:500;letter-spacing:0.3px;}
                .arm-close{width:30px;height:30px;border-radius:8px;border:1.5px solid rgba(59,130,246,0.25);background:#fff;color:#4b5563;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:13px;font-weight:700;transition:all 0.2s;box-shadow:0 2px 4px rgba(0,0,0,0.06);}
                .arm-close:hover{background:linear-gradient(135deg,#3b82f6 0%,#2563eb 100%);color:#fff;border-color:transparent;transform:rotate(90deg);box-shadow:0 4px 12px rgba(59,130,246,0.4);}
                .arm-body{padding:20px;display:flex;flex-direction:column;gap:18px;max-height:65vh;overflow-y:auto;}
                .arm-section{display:flex;flex-direction:column;gap:4px;border-bottom:2px solid rgba(59,130,246,0.15);padding-bottom:16px;background:rgba(255,255,255,0.6);border-radius:12px;padding:14px;box-shadow:0 2px 8px rgba(0,0,0,0.03);}
                .arm-section:last-of-type{border-bottom:none;padding-bottom:0;}
                .arm-section-header{font-size:11.5px;font-weight:700;color:#0284c7;letter-spacing:0.5px;margin-bottom:8px;}
                .arm-list-item{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px dashed rgba(59,130,246,0.12);transition:background 0.2s;}
                .arm-list-item:hover{background:rgba(59,130,246,0.03);border-radius:6px;}
                .arm-list-item:last-of-type{border-bottom:none;}
                .arm-list-left{display:flex;flex-direction:column;gap:2px;flex:1;justify-content:center;}
                .arm-list-title{font-size:13px;font-weight:700;color:#111827;letter-spacing:0.2px;}
                .arm-list-desc{font-size:11px;color:#4b5563;line-height:1.4;font-weight:500;}
                .arm-toggle-pill{width:42px;height:22px;border-radius:11px;background:linear-gradient(135deg,#e5e7eb 0%,#d1d5db 100%);position:relative;cursor:pointer;transition:all 0.3s cubic-bezier(0.4,0,0.2,1);flex-shrink:0;border:1.5px solid rgba(0,0,0,0.08);box-shadow:inset 0 1px 2px rgba(0,0,0,0.08);}
                .arm-toggle-pill.on{background:linear-gradient(135deg,#3b82f6 0%,#8b5cf6 100%);border-color:transparent;box-shadow:0 2px 8px rgba(59,130,246,0.45);}
                .arm-toggle-pill::after{content:'';position:absolute;width:16px;height:16px;border-radius:50%;background:linear-gradient(135deg,#fff 0%,#f9fafb 100%);top:2px;left:2px;transition:transform 0.3s cubic-bezier(0.4,0,0.2,1);box-shadow:0 2px 4px rgba(0,0,0,0.2),0 0 0 1px rgba(0,0,0,0.05);}
                .arm-toggle-pill.on::after{transform:translateX(20px);}
                .arm-field-row{display:flex;align-items:center;gap:5px;flex-shrink:0;}
                .arm-field-row input{width:72px;background:#fff;border:2px solid #cbd5e1;border-radius:8px;color:#0f172a;font-size:12px;font-weight:700;padding:6px 8px;outline:none;text-align:center;transition:all 0.2s;min-width:60px;box-shadow:0 1px 2px rgba(0,0,0,0.04);}
                .arm-field-row input:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,0.15),0 2px 4px rgba(0,0,0,0.08);}
                .arm-field-unit{font-size:11px;color:#666;font-weight:500;flex-shrink:0;}
                .arm-cache-row{display:flex;align-items:center;justify-content:space-between;padding-top:12px;margin-top:4px;border-top:1px dashed rgba(0,0,0,0.08);}
                .arm-cache-left{display:flex;align-items:center;gap:6px;font-size:12px;color:#444;font-weight:500;}
                .arm-cache-badge{font-size:10px;background:rgba(34,197,94,0.12);color:#166534;border-radius:4px;padding:2px 6px;font-weight:600;}
                .arm-cache-clear{font-size:11px;color:#dc2626;cursor:pointer;background:none;border:none;font-weight:600;}
                .arm-cache-clear:hover{text-decoration:underline;}
                .arm-footer{display:flex;gap:10px;padding:16px 20px 20px;border-top:2px solid rgba(59,130,246,0.2);background:linear-gradient(180deg,#fff 0%,#f8fafc 100%);border-radius:0 0 16px 16px;box-shadow:0 -2px 8px rgba(0,0,0,0.03);}
                .arm-btn{flex:1;padding:10px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;transition:all 0.2s cubic-bezier(0.4,0,0.2,1);border:none;letter-spacing:0.3px;}
                .arm-btn:active{transform:scale(0.96);}
                .arm-btn-cancel{background:#fff;color:#4b5563;border:2px solid #e5e7eb;box-shadow:0 1px 3px rgba(0,0,0,0.06);}
                .arm-btn-cancel:hover{background:#f9fafb;border-color:#d1d5db;box-shadow:0 2px 6px rgba(0,0,0,0.1);}
                .arm-btn-save{flex:2;background:linear-gradient(135deg,#3b82f6 0%,#6366f1 100%);color:white;box-shadow:0 4px 12px rgba(59,130,246,0.35);}
                .arm-btn-save:hover{background:linear-gradient(135deg,#2563eb 0%,#4f46e5 100%);box-shadow:0 6px 20px rgba(59,130,246,0.5);transform:translateY(-1px);}
                body.ani-user-dark-mode #ani-rating-modal{background:#18181c !important;color:#f4f4f5 !important;border-color:rgba(255,255,255,0.14) !important;box-shadow:0 25px 50px -12px rgba(0,0,0,0.9) !important;}
                body.ani-user-dark-mode .arm-header,body.ani-user-dark-mode .arm-footer{background:rgba(0,0,0,0.25) !important;border-color:rgba(255,255,255,0.1) !important;border-radius:16px 16px 0 0 !important;}
                body.ani-user-dark-mode .arm-footer{border-radius:0 0 16px 16px !important;}
                body.ani-user-dark-mode .arm-title{color:#fff !important;}
                body.ani-user-dark-mode .arm-subtitle{color:#d4d4d8 !important;}
                body.ani-user-dark-mode .arm-close{border-color:rgba(255,255,255,0.16) !important;background:rgba(255,255,255,0.08) !important;color:#e4e4e7 !important;}
                body.ani-user-dark-mode .arm-close:hover{background:rgba(255,255,255,0.16) !important;color:#fff !important;}
                body.ani-user-dark-mode .arm-section{border-color:rgba(255,255,255,0.1) !important;}
                body.ani-user-dark-mode .arm-section-header{color:#60a5fa !important;}
                body.ani-user-dark-mode .arm-list-item{border-color:rgba(255,255,255,0.08) !important;}
                body.ani-user-dark-mode .arm-list-title{color:#f4f4f5 !important;}
                body.ani-user-dark-mode .arm-list-desc{color:#d4d4d8 !important;}
                body.ani-user-dark-mode .arm-toggle-pill{background:#52525b !important;}
                body.ani-user-dark-mode .arm-toggle-pill.on{background:#3b82f6 !important;}
                body.ani-user-dark-mode .arm-field-row input{background:rgba(255,255,255,0.08) !important;border-color:rgba(255,255,255,0.18) !important;color:#f4f4f5 !important;}
                body.ani-user-dark-mode .arm-field-row input:focus{border-color:#3b82f6 !important;}
                body.ani-user-dark-mode .arm-field-unit{color:#d4d4d8 !important;}
                body.ani-user-dark-mode .arm-cache-row{border-color:rgba(255,255,255,0.1) !important;}
                body.ani-user-dark-mode .arm-cache-left{color:#d4d4d8 !important;}
                body.ani-user-dark-mode .arm-cache-badge{background:rgba(34,197,94,0.2) !important;color:#4ade80 !important;}
                body.ani-user-dark-mode .arm-cache-clear{color:#f87171 !important;}
                body.ani-user-dark-mode .arm-btn-cancel{background:rgba(255,255,255,0.1) !important;color:#e4e4e7 !important;border-color:rgba(255,255,255,0.08) !important;}
                body.ani-user-dark-mode .ani-custom-rating{background:rgba(10,10,12,0.85) !important;box-shadow:0 4px 12px rgba(0,0,0,0.5) !important;}
                body.ani-user-dark-mode .acr-tier-mythical{color:#ff2a6d !important;border-color:rgba(255,42,109,0.65) !important;background:rgba(18,10,14,0.9) !important;box-shadow:0 0 10px rgba(255,42,109,0.4) !important;}
                body.ani-user-dark-mode .acr-tier-excellent{color:#FFD700 !important;border-color:rgba(255,215,0,0.5) !important;background:rgba(16,14,10,0.85) !important;}
                body.ani-user-dark-mode .acr-tier-good{color:#05ffc4 !important;border-color:rgba(5,255,196,0.4) !important;}
                body.ani-user-dark-mode .acr-tier-average{color:#94a3b8 !important;border-color:rgba(148,163,184,0.35) !important;}
                body.ani-user-dark-mode .acr-tier-poor{color:#ff5f5f !important;border-color:rgba(255,95,95,0.45) !important;background:rgba(22,10,10,0.9) !important;}
                body.ani-user-dark-mode .acr-low-sample{color:#fb923c !important;border:2px solid rgba(251,146,60,0.65) !important;background:rgba(25,15,10,0.9) !important;box-shadow:0 0 0 1px rgba(251,146,60,0.35),0 2px 8px rgba(251,146,60,0.25) !important;animation:acr-pulse-warning 2s infinite !important;}
                body.ani-user-dark-mode .ani-watch-progress-badge.watched{background:rgba(59,130,246,0.28) !important;color:#fff !important;border:none !important;box-shadow:0 2px 6px rgba(0,0,0,0.25) !important;backdrop-filter:blur(6px) !important;}
                body.ani-user-dark-mode .ani-watch-progress-badge.watched::before{display:none !important;}
                body.ani-user-dark-mode .ani-watch-progress-badge.watched .watch-icon{background:#38bdf8 !important;box-shadow:0 0 6px #38bdf8 !important;}
                body.ani-user-dark-mode .ani-watch-progress-badge.unwatched{background:rgba(60,60,65,0.55) !important;color:#d4d4d8 !important;border:none !important;backdrop-filter:blur(4px) !important;box-shadow:0 1px 4px rgba(0,0,0,0.2) !important;}
                body.ani-user-dark-mode .ani-watch-progress-badge.unwatched .watch-icon{background:#6b7280 !important;box-shadow:0 0 1px rgba(107,114,128,0.3) !important;}
            `;
            document.head.appendChild(style);
        },

        showToast(message) {
            let toast = document.getElementById('ani-rating-toast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'ani-rating-toast';
                toast.setAttribute('role', 'status');
                toast.setAttribute('aria-live', 'polite');
                document.body.appendChild(toast);
            }
            toast.textContent = message;
            toast.className = 'show';
            clearTimeout(toast._timeoutId);
            toast._timeoutId = setTimeout(() => { toast.className = ''; }, 2800);
        },

        updateActionButtonsVisibility() {
            const isListPage = App.isAnimeListPage();
            const btns = ['ani-sort-float-btn', 'ani-mask-float-btn', 'ani-block-float-btn']
                .map(id => document.getElementById(id));
            const hasCards = document.querySelector('a.theme-list-main') !== null;
            btns.forEach(btn => { if (btn) btn.style.display = (isListPage && hasCards) ? 'inline-flex' : 'none'; });
            const configBtn = document.getElementById('ani-config-float-btn');
            if (configBtn) configBtn.style.display = isListPage ? 'inline-flex' : 'none';
        },

        injectActionButtons() {
            if (document.getElementById('ani-sort-float-btn')) return;

            const sortBtn = document.createElement('button');
            sortBtn.id = 'ani-sort-float-btn';
            sortBtn.className = 'ani-float-btn';
            sortBtn.title = '依評分排序當前作品';
            sortBtn.innerHTML = App.isSorted ? '★↓' : '⇅';
            if (App.isSorted) sortBtn.classList.add('active');
            sortBtn.addEventListener('click', () => {
                App.isSorted = !App.isSorted;
                ConfigManager.data.sortEnabled = App.isSorted;
                ConfigManager.save('aniRating_sortEnabled', App.isSorted);
                sortBtn.classList.toggle('active', App.isSorted);
                if (App.isSorted) {
                    sortBtn.innerHTML = '★↓';
                    SortManager.forceLoadAllAndSort();
                } else {
                    sortBtn.innerHTML = '⇅';
                    SortManager.apply(false);
                    this.showToast('已恢復官方預設順序。');
                }
            });

            const maskBtn = document.createElement('button');
            maskBtn.id = 'ani-mask-float-btn';
            maskBtn.className = 'ani-float-btn';
            maskBtn.title = '切換防雷遮罩顯示';
            maskBtn.innerHTML = ConfigManager.data.maskEnabled ? '🛡️' : '🔓';
            if (ConfigManager.data.maskEnabled) maskBtn.classList.add('active');
            document.body.classList.toggle('ani-disable-masking', !ConfigManager.data.maskEnabled);
            maskBtn.addEventListener('click', () => {
                ConfigManager.data.maskEnabled = !ConfigManager.data.maskEnabled;
                ConfigManager.save('aniRating_maskEnabled', ConfigManager.data.maskEnabled);
                maskBtn.classList.toggle('active', ConfigManager.data.maskEnabled);
                document.body.classList.toggle('ani-disable-masking', !ConfigManager.data.maskEnabled);
                maskBtn.innerHTML = ConfigManager.data.maskEnabled ? '🛡️' : '🔓';
                this.showToast(ConfigManager.data.maskEnabled ? '已啟用低評分「防雷遮罩」保護。' : '已暫時解除「防雷遮罩」，展示完整清單。');
            });

            const blockBtn = document.createElement('button');
            blockBtn.id = 'ani-block-float-btn';
            blockBtn.className = 'ani-float-btn';
            blockBtn.title = '切換低分作品屏蔽';
            blockBtn.innerHTML = ConfigManager.data.blockEnabled ? '🚫' : '👁️';
            if (ConfigManager.data.blockEnabled) blockBtn.classList.add('active');
            document.body.classList.toggle('ani-disable-blocking', !ConfigManager.data.blockEnabled);
            blockBtn.addEventListener('click', () => {
                ConfigManager.data.blockEnabled = !ConfigManager.data.blockEnabled;
                ConfigManager.save('aniRating_blockEnabled', ConfigManager.data.blockEnabled);
                blockBtn.classList.toggle('active', ConfigManager.data.blockEnabled);
                document.body.classList.toggle('ani-disable-blocking', !ConfigManager.data.blockEnabled);
                blockBtn.innerHTML = ConfigManager.data.blockEnabled ? '🚫' : '👁️';
                this.showToast(ConfigManager.data.blockEnabled ? '已啟用超低評作品「完全屏蔽」隱藏。' : '已顯示被屏蔽的超低評作品。');
            });

            document.body.appendChild(sortBtn);
            document.body.appendChild(maskBtn);
            document.body.appendChild(blockBtn);
            this.updateActionButtonsVisibility();
        },

        injectUI() {
            if (document.querySelector('.top_btn_rating_setting')) return;

            const memberList = document.querySelector('ul.member') || document.querySelector('.top-header ul') ||
                document.querySelector('ul.top-nav') || document.querySelector('header nav ul');
            if (memberList) {
                const li = document.createElement('li');
                li.className = 'top_btn_rating_setting';
                li.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;';
                li.innerHTML = '<a href="javascript:void(0)" style="display:flex;align-items:center;justify-content:center;"><i class="material-icons">star_rate</i></a><span class="tooltip">評分設定</span>';
                li.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); this.openModal(); }, true);
                const anchor = li.querySelector('a');
                if (anchor) anchor.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); this.openModal(); }, true);
                const searchBtn = memberList.querySelector('.searchbtn') || memberList.querySelector('li:last-child');
                if (searchBtn) memberList.insertBefore(li, searchBtn);
                else memberList.appendChild(li);
            } else {
                const floatConfigBtn = document.createElement('button');
                floatConfigBtn.id = 'ani-config-float-btn';
                floatConfigBtn.className = 'ani-float-btn';
                floatConfigBtn.style.bottom = '235px';
                floatConfigBtn.title = '開啟評分設定';
                floatConfigBtn.innerHTML = '⚙️';
                floatConfigBtn.addEventListener('click', () => this.openModal());
                document.body.appendChild(floatConfigBtn);
            }
        },

        startTour() {
            if (document.getElementById('ani-rating-tour-overlay')) return;
            const steps = [
                { title: '歡迎使用評分助手！', desc: '我們已為動畫封面加上了精緻的評分徽章。將滑鼠懸停在徽章上即可查看詳細的五星佔比分佈。' },
                { title: '右下角快捷面板', desc: '右下角提供三個垂直按鈕：⇅ 可切換自訂排序模式，🛡️ 快捷開關防雷遮罩，🚫 快捷開關完全屏蔽功能。' },
                { title: '自訂個人化設定', desc: '點擊頂部選單、頭像旁的「⭐ 評分設定」按鈕，即可自由調整徽章外觀、字體大小與避雷分數門檻！' }
            ];
            let currentStep = 0;
            const overlay = document.createElement('div');
            overlay.id = 'ani-rating-tour-overlay';

            const renderStep = () => {
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
                            <div class="artc-indicators">${steps.map((_, i) => `<span class="artc-dot ${i === currentStep ? 'active' : ''}"></span>`).join('')}</div>
                        </div>
                        <div class="artc-footer">
                            <button class="artc-btn artc-btn-skip" id="artc-skip">跳過</button>
                            <button class="artc-btn artc-btn-next" id="artc-next">${currentStep === steps.length - 1 ? '完成' : '下一步'}</button>
                        </div>
                    </div>`;
                overlay.querySelector('#artc-close').addEventListener('click', close);
                overlay.querySelector('#artc-skip').addEventListener('click', close);
                overlay.querySelector('#artc-next').addEventListener('click', () => {
                    if (currentStep < steps.length - 1) { currentStep++; renderStep(); }
                    else close();
                });
            };
            const close = () => { localStorage.setItem('aniRating_tourCompleted', 'true'); overlay.remove(); };
            document.body.appendChild(overlay);
            renderStep();
        },

        openModal() {
            if (document.getElementById('ani-rating-overlay')) return;

            const isDark = document.body.classList.contains('ani-user-dark-mode');
            const c = ConfigManager.data;
            const cacheCount = CacheManager.size;

            const D = (light, dark) => isDark ? dark : light;
            const modalBg = D('#ffffff', '#18181c');
            const modalColor = D('#202020', '#f4f4f5');
            const headerBg = D('linear-gradient(135deg,#eff6ff 0%,#dbeafe 50%,#eff6ff 100%)', 'linear-gradient(135deg,rgba(30,41,59,0.9) 0%,rgba(15,23,42,0.95) 100%)');
            const headerBorder = D('2px solid rgba(59,130,246,0.3)', '2px solid rgba(96,165,250,0.3)');
            const titleColor = D('#1e40af', '#60a5fa');
            const subtitleColor = D('#4b5563', '#94a3b8');
            const sectionBg = D('rgba(255,255,255,0.6)', 'rgba(30,41,59,0.5)');
            const sectionBorder = D('2px solid rgba(59,130,246,0.15)', '2px solid rgba(96,165,250,0.2)');
            const sectionHeaderColor = D('#0284c7', '#60a5fa');
            const listTitleColor = D('#111827', '#f4f4f5');
            const listDescColor = D('#4b5563', '#94a3b8');
            const itemBorder = D('1px dashed rgba(59,130,246,0.12)', '1px dashed rgba(96,165,250,0.15)');
            const inputBg = D('#ffffff', 'rgba(255,255,255,0.08)');
            const inputBorder = D('2px solid #cbd5e1', '2px solid rgba(96,165,250,0.3)');
            const inputColor = D('#0f172a', '#f4f4f5');
            const cancelBg = D('#ffffff', 'rgba(255,255,255,0.08)');
            const cancelBorder = D('2px solid #e5e7eb', '2px solid rgba(96,165,250,0.2)');
            const cancelColor = D('#4b5563', '#e4e4e7');
            const cacheBorder = D('1px dashed rgba(0,0,0,0.08)', '1px dashed rgba(96,165,250,0.15)');
            const cacheTextColor = D('#444444', '#94a3b8');
            const footerBg = D('linear-gradient(180deg,#ffffff 0%,#f8fafc 100%)', 'linear-gradient(180deg,rgba(15,23,42,0.95) 0%,rgba(30,41,59,0.9) 100%)');
            const footerBorder = D('2px solid rgba(59,130,246,0.2)', '2px solid rgba(96,165,250,0.2)');

            const overlay = document.createElement('div');
            overlay.id = 'ani-rating-overlay';
            overlay.style.cssText = 'position:fixed !important;inset:0 !important;background:rgba(0,0,0,0.65) !important;backdrop-filter:blur(6px) !important;z-index:999998 !important;display:flex !important;align-items:center !important;justify-content:center !important;';

            overlay.innerHTML = `
                <div id="ani-rating-modal" style="background:${modalBg} !important;color:${modalColor} !important;border:1px solid ${D('rgba(128,128,128,0.2)','rgba(96,165,250,0.2)')} !important;border-radius:16px !important;width:420px !important;max-width:90vw !important;overflow:visible !important;font-family:system-ui,-apple-system,sans-serif !important;box-shadow:0 25px 50px -12px ${D('rgba(0,0,0,0.3)','rgba(0,0,0,0.8)')} !important;display:block !important;visibility:visible !important;opacity:1 !important;position:relative !important;">
                    <div class="arm-header" style="background:${headerBg} !important;border-bottom:${headerBorder} !important;">
                        <div class="arm-header-left">
                            <div class="arm-icon">⭐</div>
                            <div>
                                <div class="arm-title" style="color:${titleColor} !important;text-shadow:none !important;">評分顯示設定</div>
                                <div class="arm-subtitle" style="color:${subtitleColor} !important;">動畫瘋 · 評分助手</div>
                            </div>
                        </div>
                        <button class="arm-close" id="arm-close-btn" aria-label="關閉">✕</button>
                    </div>
                    <div class="arm-body">
                        <div class="arm-section" style="background:${sectionBg} !important;border:${sectionBorder} !important;">
                            <div class="arm-section-header" style="color:${sectionHeaderColor} !important;">核心功能</div>
                            ${this._modalToggle('arm-toggle', '啟用評分顯示', '在動畫封面上疊加評分徽章', c.enabled, itemBorder, listTitleColor, listDescColor)}
                            ${this._modalToggle('arm-sort-toggle', '啟用評分自動排序', '依評分高低自動重新排列作品清單 (即時生效)', c.sortEnabled, itemBorder, listTitleColor, listDescColor)}
                            ${this._modalToggle('arm-mask-toggle', '啟用防雷遮罩', '遮蓋低於防雷門檻之作品封面 (滑鼠指上即還原)', c.maskEnabled, itemBorder, listTitleColor, listDescColor)}
                            ${this._modalInput('arm-threshold', '防雷遮罩門檻', '分數低於此值將套用半透明模糊遮罩', c.threshold, '分', '0.1', '0', '5', inputBg, inputBorder, inputColor, itemBorder, listTitleColor, listDescColor)}
                            ${this._modalToggle('arm-block-toggle', '啟用作品屏蔽', '直接隱藏低於屏蔽門檻的作品', c.blockEnabled, itemBorder, listTitleColor, listDescColor)}
                            ${this._modalInput('arm-block-threshold', '作品屏蔽門檻', '完全屏蔽啟用時，低於此分數直接隱藏', c.blockThreshold, '分', '0.1', '0', '5', inputBg, inputBorder, inputColor, itemBorder, listTitleColor, listDescColor)}
                            ${this._modalToggle('arm-fade-watched-toggle', '已看過作品視覺淡化', '降低已看過封面透明度 (背景自動定期更新)', c.fadeWatched, itemBorder, listTitleColor, listDescColor)}
                            <div style="font-size:11px;line-height:1.45;background:${D('rgba(59,130,246,0.08)','rgba(96,165,250,0.1)')};border:1px dashed ${D('rgba(59,130,246,0.22)','rgba(96,165,250,0.3)')};padding:9px 12px;border-radius:8px;margin-top:6px;color:${listDescColor} !important;">
                                💡 <strong>功能提示：</strong>在支援作品清單的頁面<strong>右下角</strong>，會出現三個垂直的快捷懸浮按鈕：<br>
                                <strong>⇅ / ★↓</strong> 一鍵切換自訂排序；<strong>🛡️</strong> 快捷啟閉防雷遮罩；<strong>🚫</strong> 快捷啟閉完全屏蔽。<br>
                                <strong>啟用評分自動排序</strong>設定開啟後將立即按評分高低重新排列清單，無需手動點擊按鈕。
                            </div>
                        </div>
                        <div class="arm-section" style="background:${sectionBg} !important;border:${sectionBorder} !important;">
                            <div class="arm-section-header" style="color:${sectionHeaderColor} !important;">🎨 徽章外觀樣式</div>
                            ${this._modalInput('arm-fs', '字體大小', '調整評分徽章上文字的大小', c.fontSize, 'px', '1', '8', '24', inputBg, inputBorder, inputColor, itemBorder, listTitleColor, listDescColor)}
                            ${this._modalInput('arm-rad', '徽章圓角', '調整徽章與骨架屏的四角半徑', c.radius, 'px', '1', '0', '24', inputBg, inputBorder, inputColor, 'none', listTitleColor, listDescColor)}
                        </div>
                        <div class="arm-section" style="background:${sectionBg} !important;border:${sectionBorder} !important;">
                            <div class="arm-section-header" style="color:${sectionHeaderColor} !important;">⚙️ 系統效能與快取</div>
                            ${this._modalInput('arm-sample-threshold', '防失真警告門檻', '當評價人數少於此值時，顯示防失真警告', c.sampleThreshold, '人', '10', '10', '2000', inputBg, inputBorder, inputColor, itemBorder, listTitleColor, listDescColor)}
                            ${this._modalInput('arm-fetch-interval', '評分請求間隔', '避免請求過快被伺服器阻擋/禁止的最小間隔時間', c.fetchInterval, 'ms', '100', '100', '5000', inputBg, inputBorder, inputColor, itemBorder, listTitleColor, listDescColor)}
                            ${this._modalInput('arm-cache-limit', '本地快取容量上限', '快取保留的最大作品評分筆數', c.cacheLimit, '筆', '1', '50', '2000', inputBg, inputBorder, inputColor, itemBorder, listTitleColor, listDescColor)}
                            ${this._modalInput('arm-ttl', '快取有效時間', '快取失效並自動更新的間隔時間', c.ttlHours, '小時', '1', '1', '720', inputBg, inputBorder, inputColor, 'none', listTitleColor, listDescColor)}
                            <div class="arm-cache-row" style="border-top:${cacheBorder} !important;">
                                <div class="arm-cache-left" style="color:${cacheTextColor} !important;">🗄️ 本地快取 <span class="arm-cache-badge">${cacheCount} 筆</span></div>
                                <button class="arm-cache-clear" id="arm-cache-clear" style="color:${D('#dc2626','#f87171')} !important;">清除快取</button>
                            </div>
                            <div style="margin-top:8px;display:flex;justify-content:center;">
                                <button class="arm-btn" id="arm-export-history" style="background:${D('#ffffff',D('#ffffff','rgba(255,255,255,0.08)'))};color:${D('#0284c7','#60a5fa')};border:1px solid ${D('rgba(59,130,246,0.35)','rgba(96,165,250,0.35)')};box-shadow:none !important;max-width:260px;">📥 匯出觀看紀錄 (JSON)</button>
                            </div>
                            <div class="arm-list-item" style="margin-top:4px;padding-top:10px;border-bottom:none;border-top:none !important;">
                                <div class="arm-list-left">
                                    <div class="arm-list-title" style="font-size:12px;color:${listTitleColor} !important;">重溫操作引導</div>
                                    <div class="arm-list-desc" style="color:${listDescColor} !important;">重新播放首次使用的功能導覽</div>
                                </div>
                                <button class="arm-btn arm-btn-cancel" id="arm-restart-tour" style="max-width:120px;padding:6px 12px;font-size:11px;background:${cancelBg} !important;border:${cancelBorder} !important;color:${cancelColor} !important;box-shadow:none !important;">開啟功能導覽</button>
                            </div>
                            <div style="margin-top:12px;padding-top:16px;border-top:${cacheBorder} !important;">
                                <button class="arm-btn" id="arm-reset" style="width:100%;background:${D('#ffffff','rgba(239,68,68,0.15)')};color:${D('#dc2626','#fca5a5')};border:1px solid ${D('rgba(220,38,38,0.4)','rgba(239,68,68,0.4)')};font-weight:600;box-shadow:none !important;">⚠️ 復原預設設定</button>
                                <p style="font-size:10px;color:${D('#999','#64748b')} !important;text-align:center;margin-top:6px;">此操作將清除所有自訂設定並恢復出廠預設值</p>
                            </div>
                        </div>
                    </div>
                    <div class="arm-footer" style="background:${footerBg} !important;border-top:${footerBorder} !important;">
                        <button class="arm-btn arm-btn-cancel" id="arm-cancel" style="background:${cancelBg} !important;color:${cancelColor} !important;border:${cancelBorder} !important;">取消</button>
                        <button class="arm-btn arm-btn-save" id="arm-save">↺ 儲存設定</button>
                    </div>
                </div>`;

            document.body.appendChild(overlay);

            // 綁定事件：將 camelCase key 轉換為 kebab-case id
            const toggleStates = {
                armToggle: c.enabled, armSortToggle: c.sortEnabled, armMaskToggle: c.maskEnabled,
                armBlockToggle: c.blockEnabled, armFadeWatchedToggle: c.fadeWatched
            };

            Object.keys(toggleStates).forEach(key => {
                // 將 camelCase 轉為 kebab-case（例: armToggle → arm-toggle）
                const id = key.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
                const el = document.getElementById(id);
                if (!el) return;
                el.addEventListener('click', () => {
                    toggleStates[key] = !toggleStates[key];
                    el.classList.toggle('on', toggleStates[key]);
                });
            });

            document.getElementById('arm-cache-clear').addEventListener('click', () => {
                CacheManager.clear();
                overlay.querySelector('.arm-cache-badge').textContent = '0 筆';
            });

            document.getElementById('arm-restart-tour').addEventListener('click', () => { overlay.remove(); this.startTour(); });

            document.getElementById('arm-export-history').addEventListener('click', () => {
                if (WatchHistoryManager._rawArray.length === 0) {
                    this.showToast('⚠️ 尚無觀看紀錄，請稍候背景同步完成');
                    return;
                }
                WatchHistoryManager._exportJSON();
                this.showToast('✅ 已匯出觀看紀錄 JSON');
            });

            const close = () => overlay.remove();
            document.getElementById('arm-close-btn').addEventListener('click', close);
            document.getElementById('arm-cancel').addEventListener('click', close);
            overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

            document.getElementById('arm-save').addEventListener('click', () => {
                const oldEnabled = c.enabled;
                const oldFadeWatched = c.fadeWatched;

                ConfigManager.save('aniRating_enabled', toggleStates.armToggle);
                ConfigManager.save('aniRating_maskEnabled', toggleStates.armMaskToggle);
                ConfigManager.save('aniRating_blockEnabled', toggleStates.armBlockToggle);
                ConfigManager.save('aniRating_fadeWatched', toggleStates.armFadeWatchedToggle);
                ConfigManager.save('aniRating_sortEnabled', toggleStates.armSortToggle);
                ['arm-fetch-interval', 'arm-fs', 'arm-rad', 'arm-threshold', 'arm-block-threshold',
                    'arm-sample-threshold', 'arm-cache-limit', 'arm-ttl'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) ConfigManager.save('aniRating_' + id.replace('arm-', ''), el.value);
                });

                ConfigManager.applyLive({
                    fontSize: parseInt(document.getElementById('arm-fs').value),
                    radius: parseInt(document.getElementById('arm-rad').value),
                    threshold: parseFloat(document.getElementById('arm-threshold').value),
                    blockThreshold: parseFloat(document.getElementById('arm-block-threshold').value),
                    sampleThreshold: parseInt(document.getElementById('arm-sample-threshold').value),
                    fetchInterval: parseInt(document.getElementById('arm-fetch-interval').value),
                    cacheLimit: parseInt(document.getElementById('arm-cache-limit').value),
                    ttlHours: parseInt(document.getElementById('arm-ttl').value),
                    sortEnabled: toggleStates.armSortToggle,
                });

                close();

                if (toggleStates.armFadeWatchedToggle && !oldFadeWatched && WatchHistoryManager._rawArray.length === 0) {
                    this.showToast('⏳ 正在背景同步觀看紀錄...');
                    WatchHistoryManager.fetchHistory().then(() => {
                        if (WatchHistoryManager._rawArray.length > 0) this.showToast('✅ 已同步 ' + WatchHistoryManager._rawArray.length + ' 筆觀看紀錄');
                    });
                }

                if (oldEnabled !== toggleStates.armToggle) {
                    if (confirm('以下設定需要重整頁面才能完整生效：\n啟用評分顯示\n\n是否立即重整？')) location.reload();
                    else this.showToast('⚠️ 設定已儲存，建議重整頁面以完整生效');
                } else {
                    this.showToast('✅ 設定已儲存');
                }
            });

            document.getElementById('arm-reset').addEventListener('click', () => {
                if (!confirm('確定要將所有設定復原為預設值嗎？')) return;
                Object.keys(localStorage).filter(k => k.startsWith('aniRating_')).forEach(k => localStorage.removeItem(k));
                location.reload();
            });
        },

        _modalToggle(id, title, desc, isOn, border, titleColor, descColor) {
            return `<div class="arm-list-item" style="border-bottom:${border} !important;">
                <div class="arm-list-left">
                    <div class="arm-list-title" style="color:${titleColor} !important;">${title}</div>
                    <div class="arm-list-desc" style="color:${descColor} !important;">${desc}</div>
                </div>
                <div class="arm-toggle-pill ${isOn ? 'on' : ''}" id="${id}"></div>
            </div>`;
        },

        _modalInput(id, title, desc, value, unit, step, min, max, inputBg, inputBorder, inputColor, border, titleColor, descColor) {
            return `<div class="arm-list-item" style="border-bottom:${border} !important;">
                <div class="arm-list-left">
                    <div class="arm-list-title" style="color:${titleColor} !important;">${title}</div>
                    <div class="arm-list-desc" style="color:${descColor} !important;">${desc}</div>
                </div>
                <div class="arm-field-row">
                    <input type="number" id="${id}" value="${value}" step="${step}" min="${min}" max="${max}" style="background:${inputBg} !important;border:${inputBorder} !important;color:${inputColor} !important;">
                    <span class="arm-field-unit" style="color:${descColor} !important;">${unit}</span>
                </div>
            </div>`;
        }
    };

    // ================================================================
    // 9. 應用程式生命週期 (App)
    // ================================================================
    const App = {
        isSorted: false,
        lastFetchTimestamp: 0,

        progress: {
            ratingTotal: 0,
            ratingLoaded: 0,
            historyTotalPages: 0,
            historyCurrentPage: 0,
            historyInProgress: false,

            recalc() {
                const cards = Array.from(document.querySelectorAll('a.theme-list-main')).filter(DOMUtils.isValidAnimeCard);
                this.ratingTotal = cards.length;
            },

            updateBar() {
                const bar = document.getElementById('ani-sort-progress-bar');
                if (!bar) return;
                if (this.ratingTotal <= 0) { bar.style.opacity = '0'; bar.classList.remove('ani-progress-stacked'); return; }
                const pct = Math.round((this.ratingLoaded / this.ratingTotal) * 100);
                bar.style.width = `${pct}%`;
                bar.setAttribute('data-percent', `評分載入 ${pct}% (${this.ratingLoaded}/${this.ratingTotal})`);
                const hBar = document.getElementById('ani-history-progress-bar');
                bar.classList.toggle('ani-progress-stacked', !!(hBar && this.historyInProgress));
                bar.style.opacity = pct >= 100 ? '0' : '1';
            },

            updateHistoryBar() {
                const bar = document.getElementById('ani-history-progress-bar');
                if (!bar) return;
                if (!this.historyInProgress) { bar.style.opacity = '0'; bar.classList.remove('ani-progress-stacked'); return; }
                const pct = this.historyTotalPages > 0 ? Math.round((this.historyCurrentPage / this.historyTotalPages) * 100) : 0;
                bar.style.width = `${pct}%`;
                bar.setAttribute('data-percent', `歷史同步 ${pct}% (第 ${this.historyCurrentPage}/${this.historyTotalPages} 頁)`);
                const sBar = document.getElementById('ani-sort-progress-bar');
                bar.classList.toggle('ani-progress-stacked', !!(sBar && this.ratingTotal > 0 && this.ratingLoaded < this.ratingTotal));
                bar.style.opacity = pct >= 100 ? '0' : '1';
            }
        },

        _lazyObserver: null,
        _bodyObserver: null,
        _bodyObserverDebounce: null,

        isAnimeListPage() {
            return /animeList\.php/.test(window.location.pathname);
        },

        _observeCards() {
            const selector = 'a.theme-list-main:not([data-rating-processed])';
            this.progress.ratingTotal = 0;
            let processedCount = 0;

            document.querySelectorAll(selector).forEach(link => {
                if (!DOMUtils.isValidAnimeCard(link)) return;
                this._lazyObserver.observe(link);
                if (link.hasAttribute('data-rating-processed')) processedCount++;
            });

            this.progress.recalc();
            const allCards = Array.from(document.querySelectorAll('a.theme-list-main')).filter(DOMUtils.isValidAnimeCard);
            this.progress.ratingTotal = allCards.length;
            const badges = document.querySelectorAll('.ani-custom-rating');
            this.progress.ratingLoaded = Math.max(badges.length, processedCount, this.progress.ratingLoaded);
            if (this.progress.ratingLoaded > this.progress.ratingTotal) this.progress.ratingLoaded = this.progress.ratingTotal;
            this.progress.updateBar();
        },

        _setupDarkModeObserver() {
            const sync = () => {
                const isDark = document.getElementById('darkmode-moon')?.checked || false;
                document.body.classList.toggle('ani-user-dark-mode', isDark);
            };
            sync();
            const waitForSetting = setInterval(() => {
                const container = document.querySelector('.dark-mode-setting');
                if (container) {
                    clearInterval(waitForSetting);
                    new MutationObserver(sync).observe(container, { attributes: true, subtree: true, attributeFilter: ['checked', 'class', 'style'] });
                    ['darkmode-moon', 'darkmode-sun'].forEach(id => {
                        const el = document.getElementById(id);
                        if (el) el.addEventListener('change', sync);
                    });
                    let checks = 0;
                    const poll = setInterval(() => { sync(); checks++; if (checks > 20) clearInterval(poll); }, 400);
                }
            }, 500);
        },

        init() {
            // 載入設定
            ConfigManager.load();
            this.isSorted = ConfigManager.data.sortEnabled;

            // 載入快取
            CacheManager.load();

            // 注入 CSS
            UIComponents.injectStyles();

            // 深色模式
            this._setupDarkModeObserver();

            // 注入 UI
            UIComponents.injectUI();
            UIComponents.injectActionButtons();

            // 進度條初始化
            ['ani-sort-progress-bar', 'ani-history-progress-bar'].forEach(id => {
                if (!document.getElementById(id)) {
                    const bar = document.createElement('div');
                    bar.id = id;
                    bar.setAttribute('data-percent', '0%');
                    document.body.appendChild(bar);
                }
            });

            // 事件委託：遮罩 hover
            document.body.addEventListener('mouseover', (e) => {
                const img = e.target.closest('img.ani-low-rating-masked');
                if (img) img.style.setProperty('filter', 'grayscale(0) opacity(1) blur(0px)', 'important');
            });
            document.body.addEventListener('mouseout', (e) => {
                const img = e.target.closest('img.ani-low-rating-masked');
                if (img) img.style.removeProperty('filter');
            });

            // 事件委託：設定按鈕
            document.body.addEventListener('click', (e) => {
                const btn = e.target.closest('.top_btn_rating_setting');
                if (btn) { e.preventDefault(); e.stopPropagation(); UIComponents.openModal(); }
            });

            // 定期確保按鈕事件
            setInterval(() => {
                const btn = document.querySelector('.top_btn_rating_setting');
                if (!btn) return;
                if (!btn._handler) {
                    btn._handler = (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); UIComponents.openModal(); };
                    btn.addEventListener('click', btn._handler, true);
                    const a = btn.querySelector('a');
                    if (a && !a._handler) {
                        a._handler = (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); UIComponents.openModal(); };
                        a.addEventListener('click', a._handler, true);
                    }
                }
            }, 500);

            // 懶載入 Observer
            this._lazyObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (!entry.isIntersecting) return;
                    const link = entry.target;
                    this._lazyObserver.unobserve(link);
                    link.setAttribute('data-rating-processed', 'true');
                    const match = link.href.match(/sn=(\d+)/);
                    if (match) {
                        const container = DOMUtils.getThumbnailContainer(link);
                        if (container) RatingProcessor.processItem(match[1], container);
                    }
                });
            }, { rootMargin: '100px 0px', threshold: 0.01 });

            // MutationObserver
            this._bodyObserver = new MutationObserver(() => {
                clearTimeout(this._bodyObserverDebounce);
                this._bodyObserverDebounce = setTimeout(() => this._observeCards(), 250);
            });
            this._bodyObserver.observe(document.documentElement, { childList: true, subtree: true });

            // 背景同步
            WatchHistoryManager.fetchHistory();

            // 快照
            SortManager.captureSnapshot();

            // 觀察卡片
            this._observeCards();

            // 淡化標記
            document.body.classList.toggle('ani-watched-fade-enabled', ConfigManager.data.fadeWatched);

            // 非 animeList.php 頁面直接隱藏浮動按鈕
            if (!this.isAnimeListPage()) {
                ['ani-sort-float-btn', 'ani-mask-float-btn', 'ani-block-float-btn', 'ani-config-float-btn'].forEach(id => {
                    const btn = document.getElementById(id);
                    if (btn) btn.style.display = 'none';
                });
            }

            // 自動排序
            if (ConfigManager.data.sortEnabled) {
                setTimeout(() => {
                    const btn = document.getElementById('ani-sort-float-btn');
                    if (btn) {
                        this.isSorted = true;
                        btn.classList.add('active');
                        btn.innerHTML = '★↓';
                        SortManager.forceLoadAllAndSort();
                    } else {
                        let retries = 0;
                        const wait = setInterval(() => {
                            const b = document.getElementById('ani-sort-float-btn');
                            if (b) {
                                clearInterval(wait);
                                this.isSorted = true;
                                b.classList.add('active');
                                b.innerHTML = '★↓';
                                SortManager.forceLoadAllAndSort();
                            }
                            if (++retries > 20) { clearInterval(wait); console.warn('[評分美化] 排序按鈕初始化逾時'); }
                        }, 300);
                    }
                }, 500);
            }

            // 首次導覽
            if (localStorage.getItem('aniRating_tourCompleted') !== 'true') {
                setTimeout(() => UIComponents.startTour(), 1500);
            }
        }
    };

    // 啟動
    App.init();
})();