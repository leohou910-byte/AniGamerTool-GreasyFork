// ================================================================
// ConfigManager - 設定管理模組
// 繼承 BaseModule，使用 StateManager 儲存設定
// 設定變更時透過 EventBus 發送事件，解除模組間直接耦合
// ================================================================
const ConfigManager = (function () {
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

    // localStorage key prefix
    const LS_PREFIX = 'aniRating_';

    class ConfigManager extends BaseModule {
        constructor() {
            super('ConfigManager');
        }

        /**
         * 初始化設定管理
         * 1. 將預設設定註冊到 StateManager
         * 2. 從 localStorage 載入已儲存的設定
         * 3. 訂閱 StateManager 的設定變更，自動儲存到 localStorage
         */
        init() {
            console.log('[ConfigManager] 初始化...');

            // 1. 將預設設定寫入 StateManager
            const defaults = {};
            for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
                defaults[`config.${key}`] = value;
            }
            // 額外狀態
            defaults['app.isSorted'] = DEFAULT_CONFIG.sortEnabled;
            defaults['app.lastFetchTimestamp'] = 0;
            this._stateManager.init(defaults);

            // 2. 從 localStorage 載入已儲存的設定，蓋掉預設值
            this._loadFromStorage();

            // 3. 訂閱設定變更：自動儲存到 localStorage
            for (const key of Object.keys(DEFAULT_CONFIG)) {
                this._watchState(`config.${key}`, (newValue, oldValue) => {
                    this._saveToStorage(key, newValue);
                    // 廣播設定變更事件，供其他模組響應
                    this._eventBus.emit('config:changed', { key, value: newValue, oldValue });
                    // 同時發送特定事件，方便模組只監聽自己關心的變更
                    this._eventBus.emit(`config:changed:${key}`, { value: newValue, oldValue });
                });
            }

            console.log('[ConfigManager] 初始化完成，設定值:', this.getAll());
        }

        /**
         * 從 localStorage 載入所有設定
         */
        _loadFromStorage() {
            for (const [key, defaultValue] of Object.entries(DEFAULT_CONFIG)) {
                const lsKey = LS_PREFIX + this._toStorageKey(key);
                try {
                    const raw = localStorage.getItem(lsKey);
                    if (raw === null) continue;

                    let parsed;
                    if (typeof defaultValue === 'boolean') {
                        parsed = raw === 'true';
                    } else if (typeof defaultValue === 'number') {
                        if (Number.isInteger(defaultValue)) {
                            parsed = parseInt(raw, 10);
                        } else {
                            parsed = parseFloat(raw);
                        }
                        if (isNaN(parsed)) parsed = defaultValue;
                    } else {
                        parsed = raw;
                    }

                    // 使用 silent 寫入 StateManager，避免觸發事件（因為還在初始化階段）
                    this._stateManager.set(`config.${key}`, parsed, true);
                } catch (e) {
                    console.warn(`[ConfigManager] 載入設定 ${key} 失敗:`, e);
                }
            }
        }

        /**
         * 儲存單一設定到 localStorage
         * @param {string} key 設定鍵名（不含 config. 前綴）
         * @param {*} value
         */
        _saveToStorage(key, value) {
            const lsKey = LS_PREFIX + this._toStorageKey(key);
            try {
                // 如果是預設值，刪除 localStorage 項目（節省空間）
                if (value === DEFAULT_CONFIG[key]) {
                    if (localStorage.getItem(lsKey) !== null) {
                        localStorage.removeItem(lsKey);
                    }
                } else {
                    localStorage.setItem(lsKey, String(value));
                }
            } catch (e) {
                console.error(`[ConfigManager] 儲存設定 ${key} 失敗:`, e);
            }
        }

        /**
         * 將內部鍵名轉換為 localStorage 鍵名
         * camelCase → kebab-case (部分相容原版，部分使用簡寫)
         */
        _toStorageKey(key) {
            const map = {
                'enabled': 'enabled',
                'maskEnabled': 'maskEnabled',
                'fontSize': 'fs',
                'radius': 'rad',
                'threshold': 'threshold',
                'blockEnabled': 'blockEnabled',
                'blockThreshold': 'blockThreshold',
                'fadeWatched': 'fadeWatched',
                'sortEnabled': 'sortEnabled',
                'sampleThreshold': 'sampleThreshold',
                'fetchInterval': 'fetchInterval',
                'cacheLimit': 'cache_limit',
                'ttlHours': 'ttl_hours',
            };
            return map[key] || key;
        }

        /**
         * 取得單一設定值
         * @param {string} key
         * @returns {*}
         */
        get(key) {
            return this._stateManager.get(`config.${key}`);
        }

        /**
         * 取得所有設定值的快照
         * @returns {Object}
         */
        getAll() {
            const result = {};
            for (const key of Object.keys(DEFAULT_CONFIG)) {
                result[key] = this._stateManager.get(`config.${key}`);
            }
            return result;
        }

        /**
         * 更新單一設定（觸發事件通知）
         * @param {string} key
         * @param {*} value
         */
        set(key, value) {
            this._stateManager.set(`config.${key}`, value);
        }

        /**
         * 批次更新多個設定（一次性觸發多個事件）
         * @param {Object} settings key-value 物件
         */
        setBatch(settings) {
            const updates = {};
            for (const [key, value] of Object.entries(settings)) {
                if (key in DEFAULT_CONFIG) {
                    updates[`config.${key}`] = value;
                }
            }
            if (Object.keys(updates).length > 0) {
                this._stateManager.setBatch(updates);
            }
        }

        /**
         * 復原為預設設定
         * 清除所有 localStorage 項目，並重新初始化 StateManager
         */
        reset() {
            // 清除所有 aniRating_ 開頭的 localStorage 項目
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(LS_PREFIX)) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(k => localStorage.removeItem(k));

            // 重置 StateManager 為預設值
            for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
                this._stateManager.set(`config.${key}`, value);
            }

            console.log('[ConfigManager] 已復原所有設定為預設值');
        }

        /**
         * 銷毀模組
         */
        destroy() {
            super.destroy();
            console.log('[ConfigManager] 已銷毀');
        }
    }

    return ConfigManager;
})();