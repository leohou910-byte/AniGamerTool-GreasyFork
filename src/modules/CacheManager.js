// ================================================================
// CacheManager - LRU 快取管理模組
// 繼承 BaseModule，使用 StateManager 管理快取狀態
// 支援 TTL 過期、容量限制、LRU 淘汰、localStorage 持久化
// ================================================================
const CacheManager = (function () {
    const LS_KEY = 'aniRating_cache';

    class CacheManager extends BaseModule {
        constructor() {
            super('CacheManager');
            this._cache = {};
            this._writeLock = false;
        }

        /**
         * 初始化快取管理
         */
        init() {
            console.log('[CacheManager] 初始化...');
            this._loadFromStorage();

            // 監聽設定變更：快取容量或 TTL 變更時自動清理
            this._listenEvent('config:changed:cacheLimit', () => this._enforceLimit());
            this._listenEvent('config:changed:ttlHours', () => this._purgeExpired());

            console.log(`[CacheManager] 初始化完成，目前 ${this.size} 筆快取`);
        }

        /**
         * 從 localStorage 載入快取
         */
        _loadFromStorage() {
            try {
                this._cache = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
            } catch {
                this._cache = {};
            }
        }

        /**
         * 儲存快取到 localStorage
         */
        _save() {
            if (this._writeLock) return;
            this._writeLock = true;
            try {
                if (!this._safeSave(LS_KEY, this._cache) && Object.keys(this._cache).length > 0) {
                    // 儲存失敗（可能 QuotaExceeded），淘汰最舊一筆再重試
                    this._evictOldest();
                    this._safeSave(LS_KEY, this._cache);
                }
            } finally {
                this._writeLock = false;
            }
        }

        /**
         * 安全儲存（含錯誤處理）
         */
        _safeSave(key, data) {
            try {
                localStorage.setItem(key, JSON.stringify(data));
                return true;
            } catch (e) {
                if (e.name === 'QuotaExceededError' || e.code === 22) {
                    console.error(`[CacheManager] 儲存 ${key} 失敗：localStorage 可能已滿`, e);
                } else {
                    console.error(`[CacheManager] 儲存 ${key} 失敗:`, e);
                }
                return false;
            }
        }

        /**
         * 取得快取項目
         * @param {string} sn 作品序號
         * @returns {Object|null} { score, count, totalEpisodes, timestamp, lastUsed }
         */
        get(sn) {
            const item = this._cache[sn];
            if (!item) return null;

            const ttlHours = this._stateManager.get('config.ttlHours') || 24;
            const maxAge = ttlHours * 60 * 60 * 1000;

            // TTL 過期檢查
            if (Date.now() - (item.timestamp || 0) > maxAge) {
                delete this._cache[sn];
                this._save();
                return null;
            }

            // 更新最近使用時間
            item.lastUsed = Date.now();
            this._save();
            return item;
        }

        /**
         * 設定快取項目
         * @param {string} sn 作品序號
         * @param {number} score 評分
         * @param {number} count 評價人數
         * @param {number|null} totalEpisodes 總集數
         */
        set(sn, score, count, totalEpisodes) {
            if (this._writeLock) return;
            this._writeLock = true;
            try {
                // 容量限制檢查
                this._enforceLimit();

                this._cache[sn] = {
                    score: parseFloat(score),
                    count: parseInt(count, 10),
                    totalEpisodes: totalEpisodes || null,
                    timestamp: Date.now(),
                    lastUsed: Date.now()
                };
                this._save();

                // 發送快取更新事件
                this._eventBus.emit('cache:updated', { sn, score, count, totalEpisodes });
            } finally {
                this._writeLock = false;
            }
        }

        /**
         * 強制執行容量上限
         */
        _enforceLimit() {
            const cacheLimit = this._stateManager.get('config.cacheLimit') || 500;
            const keys = Object.keys(this._cache);
            if (keys.length < cacheLimit) return;

            // LRU 淘汰：找出最久未使用的項目
            let oldestKey = '';
            let oldestTime = Infinity;
            for (const key of keys) {
                const t = this._cache[key].lastUsed || this._cache[key].timestamp || 0;
                if (t < oldestTime) {
                    oldestTime = t;
                    oldestKey = key;
                }
            }
            if (oldestKey) {
                delete this._cache[oldestKey];
                console.log(`[CacheManager] 快取超出上限 (${cacheLimit} 筆)，已自動淘汰: SN ${oldestKey}`);
            }
        }

        /**
         * 淘汰最舊的一筆快取
         */
        _evictOldest() {
            let oldestKey = null;
            let oldestTime = Infinity;
            for (const [key, item] of Object.entries(this._cache)) {
                const t = item.lastUsed || item.timestamp || 0;
                if (t < oldestTime) {
                    oldestTime = t;
                    oldestKey = key;
                }
            }
            if (oldestKey) {
                delete this._cache[oldestKey];
            }
        }

        /**
         * 清除過期快取
         */
        _purgeExpired() {
            const ttlHours = this._stateManager.get('config.ttlHours') || 24;
            const maxAge = ttlHours * 60 * 60 * 1000;
            const now = Date.now();
            let purged = 0;

            for (const [key, item] of Object.entries(this._cache)) {
                if (now - (item.timestamp || 0) > maxAge) {
                    delete this._cache[key];
                    purged++;
                }
            }

            if (purged > 0) {
                this._save();
                console.log(`[CacheManager] 已清除 ${purged} 筆過期快取`);
            }
        }

        /**
         * 清除所有快取
         */
        clear() {
            this._cache = {};
            localStorage.removeItem(LS_KEY);
            this._eventBus.emit('cache:cleared');
            console.log('[CacheManager] 已清除所有快取');
        }

        /**
         * 取得快取筆數
         * @returns {number}
         */
        get size() {
            return Object.keys(this._cache).length;
        }

        /**
         * 銷毀模組
         */
        destroy() {
            this._cache = {};
            super.destroy();
            console.log('[CacheManager] 已銷毀');
        }
    }

    return CacheManager;
})();