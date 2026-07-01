// ================================================================
// WatchHistoryManager - 觀看紀錄管理模組
// 繼承 BaseModule，負責 API 同步、淡化效果、進度徽章
// ================================================================
const WatchHistoryManager = (function () {
    class WatchHistoryManager extends BaseModule {
        constructor() {
            super('WatchHistoryManager');
            this._rawArray = [];
            this._byAnimeSn = new Map();
            this._byVideoSn = new Map();
            this._requestManager = null;
            this._domUtils = null;
        }

        /**
         * 注入依賴模組
         * @param {Object} deps
         */
        setDependencies(deps) {
            this._requestManager = deps.requestManager;
            this._domUtils = deps.domUtils;
        }

        init() {
            console.log('[WatchHistoryManager] 初始化...');

            // 監聽設定變更：淡出功能啟用時同步
            this._listenEvent('config:changed:fadeWatched', (data) => {
                if (data.value && this._rawArray.length === 0) {
                    this.fetchHistory();
                }
            });

            // 監聽卡片檢查請求
            this._listenEvent('rating:checkFade', (data) => {
                this.checkAndApplyFade(data.cardLink);
            });

            console.log('[WatchHistoryManager] 初始化完成');
        }

        /**
         * 使用原生 fetch() 遞迴抓取所有分頁的觀看紀錄
         */
        async fetchHistory() {
            try {
                console.log('[WatchHistoryManager] 正在背景同步完整觀看紀錄...');
                const API_URL = 'https://api.gamer.com.tw/anime/v3/history.php';
                let page = 1;
                const allItems = [];

                this._eventBus.emit('history:fetchStart');

                while (true) {
                    this._eventBus.emit('history:pageProgress', { currentPage: page });

                    // 主要使用 GM_xmlhttpRequest 以攜帶 BAHAMUT Cookie
                    let res = await this._requestManager.gmFetch(`${API_URL}?page=${page}`);
                    // 若 GM 失敗則 fallback 到原生 fetch
                    if (!res || !res.ok) {
                        try { res = await fetch(`${API_URL}?page=${page}`); } catch { break; }
                    }
                    if (!res || !res.ok) break;

                    const json = await res.json();
                    const data = json?.data;
                    if (!data?.history?.length) break;

                    this._totalPages = data.totalPage || page;

                    // 合併每一頁的陣列
                    allItems.push(...data.history);

                    page++;
                    await new Promise(r => this._setTimeout(r, 300));
                }

                // 儲存原始完整陣列
                this._rawArray = allItems;

                // 建立索引 Map
                this._rebuildMaps();

                this._eventBus.emit('history:fetchComplete', { count: this._rawArray.length });

                console.log(`[WatchHistoryManager] API 同步完成！共 ${this._rawArray.length} 筆紀錄`);
                this.applyFadeToPage();
            } catch (e) {
                console.error('[WatchHistoryManager] API 同步觀看紀錄失敗', e);
                this._eventBus.emit('history:fetchError', { error: e });
            }
        }

        /** 從 _rawArray 重建索引 Map */
        _rebuildMaps() {
            this._byAnimeSn = new Map();
            this._byVideoSn = new Map();
            for (const item of this._rawArray) {
                if (item.animeSn) {
                    this._byAnimeSn.set(item.animeSn, item);
                }
                if (item.videoSn) {
                    this._byVideoSn.set(item.videoSn, item);
                }
                if (item.history && Array.isArray(item.history)) {
                    for (const hist of item.history) {
                        if (hist.videoSn) {
                            this._byVideoSn.set(hist.videoSn, item);
                        }
                    }
                }
            }
        }

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
                console.log(`[WatchHistoryManager] 已匯出 JSON 檔案：${a.download} (${this._rawArray.length} 筆紀錄)`);
            } catch (e) {
                console.warn('[WatchHistoryManager] 匯出 JSON 失敗', e);
            }
        }

        /**
         * 解析最新集數字串，支援特殊格式
         * @param {string} str 例如「第13B集」「電影 共1集」「特別篇 共1集」「中文配音 第25集」「已更新至 第12集」
         * @returns {{ text: string, label: string }}
         */
        _parseNewestEpisode(str) {
            if (!str) return { text: '', label: '話' };

            // 嘗試匹配「第XXX集」格式（支援 13B、12.5 等）
            let m = str.match(/第\s*([\d.]+[A-Z]?)\s*[集話]/);
            if (m) return { text: m[1], label: '話' };

            // 嘗試匹配「第XXX集」純數字格式（包含「中文配音 第25集」）
            m = str.match(/第\s*(\d+)\s*[集話]/);
            if (m) return { text: m[1], label: '話' };

            // 嘗試匹配「共1集」（電影/特別篇）
            m = str.match(/共\s*(\d+)\s*[集話]/);
            if (m) return { text: m[1], label: '集' };

            // 若包含「電影」「特別篇」等關鍵字，取數字部分
            if (/電影|特別篇/.test(str)) {
                m = str.match(/(\d+)/);
                if (m) return { text: m[1], label: '集' };
                return { text: '1', label: '部' };
            }

            // fallback：取第一個數字
            m = str.match(/(\d+)/);
            if (m) return { text: m[1], label: '話' };

            return { text: str, label: '' };
        }

        /**
         * 從卡片元素取得當前觀看進度
         * @param {Element} cardLink
         * @returns {{ episode: number, rawEpisode: string, rawEpisodeDisplay: string, fullyWatched: boolean, latestEpisode: string, latestLabel: string, totalEpisodes: number|null }|null}
         */
        _getWatchProgress(cardLink) {
            if (!cardLink) return null;

            // 1. DOM 直接讀取
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
                    return {
                        episode: numericEpisode,
                        rawEpisode: episodeText,
                        rawEpisodeDisplay: episodeText,
                        fullyWatched: false,
                        latestEpisode: episodeText,
                        latestLabel: '話',
                        totalEpisodes: null
                    };
                }
            }

            // 2. API 查詢
            const match = cardLink.href.match(/sn=(\d+)/);
            if (match) {
                const animeSn = parseInt(match[1], 10);
                let item = this._byAnimeSn.get(animeSn);
                if (!item) {
                    item = this._byVideoSn.get(animeSn);
                }
                if (item) {
                    const rawEp = item.episode || '';
                    const episode = parseFloat(rawEp) || 0;
                    const fullyWatched = item.breakPoint?.breakPoint === -1;
                    const { text: latestText, label: latestLabel } = this._parseNewestEpisode(item.newestEpisode);
                    const watchedSet = new Set(item.history?.map(h => h.videoSn) || []);
                    const totalWatched = watchedSet.size;
                    return {
                        episode,
                        rawEpisode: rawEp,
                        rawEpisodeDisplay: rawEp || latestText,
                        fullyWatched,
                        latestEpisode: latestText,
                        latestLabel,
                        totalEpisodes: totalWatched
                    };
                }
            }
            return null;
        }

        /**
         * 檢查並套用淡化效果
         * @param {Element} cardLink
         */
        checkAndApplyFade(cardLink) {
            if (!cardLink) return;
            const container = this._domUtils.getThumbnailContainer(cardLink);
            if (!container) return;

            const oldBadge = container.querySelector('.ani-watch-progress-badge');
            if (oldBadge) oldBadge.remove();

            // 如果歷史紀錄還沒載入完成
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

                let progressPercent = 100;
                if (progress.totalEpisodes && progress.totalEpisodes > 0 && /^\d+$/.test(progress.latestEpisode)) {
                    progressPercent = Math.min(100, Math.round((progress.totalEpisodes / parseInt(progress.latestEpisode, 10)) * 100));
                } else if (progress.fullyWatched) {
                    progressPercent = 100;
                }

                const ll = progress.latestLabel || '話';
                let label;
                if (progress.fullyWatched) {
                    if (ll === '部' || ll === '集') {
                        label = `已觀看（${progress.latestEpisode}${ll}）`;
                    } else {
                        label = `看到第 ${progress.rawEpisode} ${ll}（最新第 ${progress.latestEpisode} ${ll}）`;
                    }
                } else if (progress.episode > 0 || (progress.rawEpisode && !/^\d+$/.test(progress.rawEpisode))) {
                    const displayEp = progress.rawEpisode && progress.rawEpisode !== String(progress.episode)
                        ? progress.rawEpisode : progress.episode;
                    if (ll === '部' || ll === '集') {
                        label = `已觀看 ${displayEp}${ll}（共${progress.latestEpisode}${ll}）`;
                    } else {
                        label = `看到第 ${displayEp} ${ll}（最新第 ${progress.latestEpisode} ${ll}）`;
                    }
                } else {
                    label = '已觀看';
                }

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
        }

        /**
         * 對頁面上所有卡片套用淡化
         */
        applyFadeToPage() {
            const selector = 'a.theme-list-main, .newanime-block, .newanime-block__link';
            document.querySelectorAll(selector).forEach(link => this.checkAndApplyFade(link));
        }

        /**
         * 取得歷史紀錄陣列（供 UIComponents 匯出使用）
         * @returns {Array}
         */
        getRawHistory() {
            return this._rawArray;
        }

        destroy() {
            this._rawArray = [];
            this._byAnimeSn = new Map();
            this._byVideoSn = new Map();
            this._requestManager = null;
            this._domUtils = null;
            super.destroy();
            console.log('[WatchHistoryManager] 已銷毀');
        }
    }

    return WatchHistoryManager;
})();