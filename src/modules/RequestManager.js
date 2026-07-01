// ================================================================
// RequestManager - 請求佇列管理模組
// 繼承 BaseModule，提供請求排程與 GM_xmlhttpRequest fallback
// ================================================================
const RequestManager = (function () {
    class RequestManager extends BaseModule {
        constructor() {
            super('RequestManager');
            this._queue = Promise.resolve();
            this._lastRequestTime = 0;
        }

        /**
         * 初始化請求管理
         */
        init() {
            console.log('[RequestManager] 初始化...');
            // 監聽 fetchInterval 變更（無需特殊處理，每次請求時讀取最新值）
            console.log('[RequestManager] 初始化完成');
        }

        /**
         * 取得目前設定的請求間隔
         * @returns {number} ms
         */
        _getInterval() {
            return this._stateManager.get('config.fetchInterval') || 500;
        }

        /**
         * 安全解析網址（處理相對路徑）
         * @param {string} url
         * @returns {string}
         */
        _resolveUrl(url) {
            if (url.startsWith('http')) return url;
            return window.location.origin + url;
        }

        /**
         * 排程非同步請求（自動控制請求頻率）
         * @param {string} url 請求網址
         * @returns {Promise<Object|null>} { ok, status, text(), json() }
         */
        async scheduleFetch(url) {
            const absoluteUrl = this._resolveUrl(url);

            const task = this._queue.then(async () => {
                // 等待請求間隔
                const now = Date.now();
                const elapsed = now - this._lastRequestTime;
                const interval = this._getInterval();
                if (elapsed < interval) {
                    await new Promise(r => this._setTimeout(r, interval - elapsed));
                }

                this._lastRequestTime = Date.now();

                try {
                    const res = await fetch(absoluteUrl);
                    if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : ' failed'}`);
                    return {
                        ok: true,
                        status: res.status,
                        text: async () => res.text(),
                        json: async () => {
                            try { return await res.json(); } catch { return { data: await res.text() }; }
                        }
                    };
                } catch (e) {
                    console.error(`[RequestManager] 佇列請求失敗: ${absoluteUrl}`, e);
                    return null;
                }
            });

            // 確保錯誤不會影響佇列
            this._queue = task.catch(() => {});
            return task;
        }

        /**
         * 使用 GM_xmlhttpRequest 發送請求（攜帶 BAHAMUT Cookie）
         * @param {string} url 請求網址
         * @returns {Promise<Object|null>} { ok, status, text(), json() }
         */
        async gmFetch(url) {
            return new Promise((resolve) => {
                if (typeof GM_xmlhttpRequest !== 'function') {
                    resolve(null);
                    return;
                }

                const absoluteUrl = this._resolveUrl(url);

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
                                json: async () => {
                                    try { return JSON.parse(textVal); } catch { return { data: textVal }; }
                                }
                            });
                        } else {
                            resolve(null);
                        }
                    },
                    onerror: () => resolve(null)
                });
            });
        }

        /**
         * 銷毀模組
         */
        destroy() {
            this._queue = Promise.resolve();
            super.destroy();
            console.log('[RequestManager] 已銷毀');
        }
    }

    return RequestManager;
})();