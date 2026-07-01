// ==UserScript==
// @name         [動漫瘋] StarMap - 評分星圖
// @name:zh-TW   [動漫瘋] StarMap - 評分星圖
// @name:zh-CN   [動漫瘋] StarMap - 评分星图
// @namespace    http://tampermonkey.net/
// @version      1.3.0
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

// ============================================================
// Source: src\core\EventBus.js
// ============================================================
// ================================================================
// EventBus - 發布/訂閱事件匯流排
// 用於模組間非同步通訊，徹底解耦
// ================================================================
const EventBus = (function () {
    const _listeners = new Map();
    const _onceListeners = new Map();

    /**
     * 註冊事件監聽
     * @param {string} event 事件名稱
     * @param {Function} callback 回呼函數
     * @returns {Function} 取消監聽的函數 (unsubscribe)
     */
    function on(event, callback) {
        if (typeof callback !== 'function') return () => {};
        if (!_listeners.has(event)) {
            _listeners.set(event, new Set());
        }
        _listeners.get(event).add(callback);
        return () => off(event, callback);
    }

    /**
     * 註冊一次性事件監聽
     * @param {string} event 事件名稱
     * @param {Function} callback 回呼函數
     * @returns {Function} 取消監聽的函數
     */
    function once(event, callback) {
        if (typeof callback !== 'function') return () => {};
        const wrapper = (...args) => {
            off(event, wrapper);
            callback(...args);
        };
        if (!_onceListeners.has(event)) {
            _onceListeners.set(event, new Set());
        }
        _onceListeners.get(event).add(wrapper);
        return () => off(event, wrapper);
    }

    /**
     * 移除事件監聽
     * @param {string} event 事件名稱
     * @param {Function} callback 回呼函數
     */
    function off(event, callback) {
        const set = _listeners.get(event);
        if (set) {
            set.delete(callback);
            if (set.size === 0) _listeners.delete(event);
        }
        const onceSet = _onceListeners.get(event);
        if (onceSet) {
            onceSet.delete(callback);
            if (onceSet.size === 0) _onceListeners.delete(event);
        }
    }

    /**
     * 觸發事件
     * @param {string} event 事件名稱
     * @param {*} data 傳遞的資料
     */
    function emit(event, data) {
        const set = _listeners.get(event);
        if (set) {
            set.forEach(cb => {
                try { cb(data); } catch (e) {
                    console.error(`[EventBus] 事件 "${event}" 的監聽器發生錯誤:`, e);
                }
            });
        }
        const onceSet = _onceListeners.get(event);
        if (onceSet) {
            const wrappers = Array.from(onceSet);
            _onceListeners.delete(event);
            wrappers.forEach(cb => {
                try { cb(data); } catch (e) {
                    console.error(`[EventBus] 一次性事件 "${event}" 的監聽器發生錯誤:`, e);
                }
            });
        }
    }

    /**
     * 清除所有監聽器 (通常用於 destroy)
     */
    function clear() {
        _listeners.clear();
        _onceListeners.clear();
    }

    /**
     * 取得當前所有已註冊的事件名稱
     * @returns {string[]}
     */
    function getEvents() {
        const events = new Set();
        _listeners.forEach((_, key) => events.add(key));
        _onceListeners.forEach((_, key) => events.add(key));
        return Array.from(events);
    }

    return { on, once, off, emit, clear, getEvents };
})();

// ============================================================
// Source: src\core\StateManager.js
// ============================================================
// ================================================================
// StateManager - 中央狀態管理器
// 實現單一事實來源 (Single Source of Truth) 與響應式更新
// ================================================================
const StateManager = (function () {
    const _state = {};
    const _subscriptions = new Map(); // key → Set<callback>
    const _globalSubscriptions = new Set(); // 全域訂閱 (任何 key 改變都通知)

    /**
     * 取得指定 key 的狀態值
     * @param {string} key
     * @returns {*} 儲存的值（若不存在則回傳 undefined）
     */
    function get(key) {
        return _state[key];
    }

    /**
     * 設定指定 key 的狀態值，若值有變化則觸發通知
     * @param {string} key
     * @param {*} value 新值
     * @param {boolean} [silent=false] 若為 true 則不觸發通知
     * @returns {boolean} 是否有改變
     */
    function set(key, value, silent = false) {
        const oldValue = _state[key];
        if (oldValue === value) return false;

        _state[key] = value;

        if (silent) return true;

        // 通知特定 key 的訂閱者
        const subs = _subscriptions.get(key);
        if (subs) {
            subs.forEach(cb => {
                try { cb(value, oldValue, key); } catch (e) {
                    console.error(`[StateManager] key "${key}" 的訂閱者發生錯誤:`, e);
                }
            });
        }

        // 通知全域訂閱者
        _globalSubscriptions.forEach(cb => {
            try { cb(value, oldValue, key); } catch (e) {
                console.error(`[StateManager] 全域訂閱者發生錯誤:`, e);
            }
        });

        return true;
    }

    /**
     * 批次設定多個狀態（一次性觸發通知）
     * @param {Object} updates key-value 物件
     * @param {boolean} [silent=false] 若為 true 則不觸發通知
     */
    function setBatch(updates, silent = false) {
        const changedKeys = [];
        for (const [key, value] of Object.entries(updates)) {
            const oldValue = _state[key];
            if (oldValue !== value) {
                _state[key] = value;
                changedKeys.push({ key, value, oldValue });
            }
        }

        if (silent || changedKeys.length === 0) return;

        // 逐 key 通知
        changedKeys.forEach(({ key, value, oldValue }) => {
            const subs = _subscriptions.get(key);
            if (subs) {
                subs.forEach(cb => {
                    try { cb(value, oldValue, key); } catch (e) {
                        console.error(`[StateManager] key "${key}" 的訂閱者發生錯誤:`, e);
                    }
                });
            }
        });

        // 全域訂閱者（僅通知一次，但傳入修改清單）
        if (_globalSubscriptions.size > 0) {
            _globalSubscriptions.forEach(cb => {
                try { cb(changedKeys); } catch (e) {
                    console.error(`[StateManager] 全域訂閱者發生錯誤:`, e);
                }
            });
        }
    }

    /**
     * 訂閱指定 key 的狀態變化
     * @param {string} key
     * @param {Function} callback (newValue, oldValue, key) => void
     * @returns {Function} 取消訂閱的函數
     */
    function subscribe(key, callback) {
        if (typeof callback !== 'function') return () => {};
        if (!_subscriptions.has(key)) {
            _subscriptions.set(key, new Set());
        }
        _subscriptions.get(key).add(callback);
        return () => unsubscribe(key, callback);
    }

    /**
     * 取消訂閱
     * @param {string} key
     * @param {Function} callback
     */
    function unsubscribe(key, callback) {
        const subs = _subscriptions.get(key);
        if (subs) {
            subs.delete(callback);
            if (subs.size === 0) _subscriptions.delete(key);
        }
    }

    /**
     * 訂閱所有狀態變化
     * @param {Function} callback (changes) => void，changes 為 [{key, value, oldValue}]
     * @returns {Function} 取消訂閱的函數
     */
    function subscribeGlobal(callback) {
        if (typeof callback !== 'function') return () => {};
        _globalSubscriptions.add(callback);
        return () => _globalSubscriptions.delete(callback);
    }

    /**
     * 初始化預設狀態
     * @param {Object} defaults key-value 預設值
     */
    function init(defaults = {}) {
        Object.assign(_state, defaults);
    }

    /**
     * 清除所有狀態與訂閱（用於 destroy）
     */
    function clear() {
        for (const key of Object.keys(_state)) {
            delete _state[key];
        }
        _subscriptions.clear();
        _globalSubscriptions.clear();
    }

    /**
     * 取得所有狀態的快照
     * @returns {Object}
     */
    function snapshot() {
        return { ..._state };
    }

    return { get, set, setBatch, subscribe, unsubscribe, subscribeGlobal, init, clear, snapshot };
})();

// ============================================================
// Source: src\core\BaseModule.js
// ============================================================
// ================================================================
// BaseModule - 模組基底類別
// 定義統一的 init() 與 destroy() 生命週期
// 負責清理監聽器防止記憶體洩漏
// ================================================================
const BaseModule = (function () {
    // 模組執行個體追蹤，用於開發除錯
    const _instances = new Map();

    class BaseModule {
        /**
         * @param {string} name 模組名稱（用於日誌）
         */
        constructor(name) {
            if (!name) throw new Error('[BaseModule] 必須提供模組名稱');
            this._name = name;
            this._eventBus = null;
            this._stateManager = null;
            this._destroyed = false;

            // 記錄需要清理的資源
            this._cleanupFns = [];         // 清理函數陣列
            this._timeouts = [];            // setTimeout IDs
            this._intervals = [];           // setInterval IDs
            this._observers = [];           // MutationObserver / IntersectionObserver 執行個體
            this._eventUnsubscribes = [];   // EventBus unsubscribe 函數

            // 註冊執行個體（用於除錯）
            if (!_instances.has(this.constructor.name)) {
                _instances.set(this.constructor.name, []);
            }
            _instances.get(this.constructor.name).push(this);
        }

        /**
         * 注入核心依賴
         * @param {Object} eventBus EventBus 實例
         * @param {Object} stateManager StateManager 實例
         */
        inject(eventBus, stateManager) {
            this._eventBus = eventBus;
            this._stateManager = stateManager;
        }

        /**
         * 初始化模組（子類別覆寫）
         * 返回 Promise 以支援非同步初始化
         * @returns {Promise<void>|void}
         */
        init() {
            // 子類別應覆寫此方法
        }

        /**
         * 銷毀模組，清理所有資源（子類別可擴充）
         */
        destroy() {
            if (this._destroyed) return;
            this._destroyed = true;

            // 1. 清理自訂 cleanup 函數
            this._cleanupFns.forEach(fn => {
                try { fn(); } catch (e) {
                    console.error(`[BaseModule:${this._name}] cleanup 函數執行失敗:`, e);
                }
            });
            this._cleanupFns = [];

            // 2. 清除所有 setTimeout
            this._timeouts.forEach(id => clearTimeout(id));
            this._timeouts = [];

            // 3. 清除所有 setInterval
            this._intervals.forEach(id => clearInterval(id));
            this._intervals = [];

            // 4. 中斷所有 Observer
            this._observers.forEach(obs => {
                try { obs.disconnect(); } catch (e) {
                    console.error(`[BaseModule:${this._name}] Observer 中斷失敗:`, e);
                }
            });
            this._observers = [];

            // 5. 取消所有 EventBus 訂閱
            this._eventUnsubscribes.forEach(fn => {
                try { fn(); } catch (e) {
                    console.error(`[BaseModule:${this._name}] EventBus 取消訂閱失敗:`, e);
                }
            });
            this._eventUnsubscribes = [];

            // 6. 從執行個體追蹤中移除
            const instances = _instances.get(this.constructor.name);
            if (instances) {
                const idx = instances.indexOf(this);
                if (idx !== -1) instances.splice(idx, 1);
                if (instances.length === 0) _instances.delete(this.constructor.name);
            }

            console.log(`[BaseModule] ${this._name} 已銷毀`);
        }

        // ========== 工具方法：安全註冊資源 ==========

        /**
         * 安全註冊 cleanup 函數
         * @param {Function} fn
         */
        _addCleanup(fn) {
            if (typeof fn === 'function') this._cleanupFns.push(fn);
        }

        /**
         * 安全註冊 setTimeout（自動清理）
         * @param {Function} fn
         * @param {number} delay
         * @returns {number} timeoutId
         */
        _setTimeout(fn, delay) {
            const id = setTimeout(() => {
                const idx = this._timeouts.indexOf(id);
                if (idx !== -1) this._timeouts.splice(idx, 1);
                try { fn(); } catch (e) {
                    console.error(`[BaseModule:${this._name}] setTimeout 回呼失敗:`, e);
                }
            }, delay);
            this._timeouts.push(id);
            return id;
        }

        /**
         * 安全註冊 setInterval（自動清理）
         * @param {Function} fn
         * @param {number} interval
         * @returns {number} intervalId
         */
        _setInterval(fn, interval) {
            const id = setInterval(() => {
                if (this._destroyed) { clearInterval(id); return; }
                try { fn(); } catch (e) {
                    console.error(`[BaseModule:${this._name}] setInterval 回呼失敗:`, e);
                }
            }, interval);
            this._intervals.push(id);
            return id;
        }

        /**
         * 安全註冊 MutationObserver（自動 disconnect）
         * @param {Element} target
         * @param {MutationObserverInit} config
         * @param {Function} callback
         * @returns {MutationObserver}
         */
        _createMutationObserver(target, config, callback) {
            const observer = new MutationObserver((mutations) => {
                if (this._destroyed) { observer.disconnect(); return; }
                try { callback(mutations); } catch (e) {
                    console.error(`[BaseModule:${this._name}] MutationObserver 回呼失敗:`, e);
                }
            });
            observer.observe(target, config);
            this._observers.push(observer);
            return observer;
        }

        /**
         * 安全註冊 IntersectionObserver（自動 disconnect）
         * @param {Function} callback
         * @param {IntersectionObserverInit} options
         * @returns {IntersectionObserver}
         */
        _createIntersectionObserver(callback, options) {
            const observer = new IntersectionObserver((entries) => {
                if (this._destroyed) { observer.disconnect(); return; }
                try { callback(entries); } catch (e) {
                    console.error(`[BaseModule:${this._name}] IntersectionObserver 回呼失敗:`, e);
                }
            }, options);
            this._observers.push(observer);
            return observer;
        }

        /**
         * 安全訂閱 EventBus（自動取消）
         * @param {string} event
         * @param {Function} callback
         */
        _listenEvent(event, callback) {
            if (!this._eventBus) return;
            const unsub = this._eventBus.on(event, (data) => {
                if (this._destroyed) { unsub(); return; }
                try { callback(data); } catch (e) {
                    console.error(`[BaseModule:${this._name}] EventBus "${event}" 回呼失敗:`, e);
                }
            });
            this._eventUnsubscribes.push(unsub);
        }

        /**
         * 安全訂閱 StateManager（自動取消）
         * @param {string} key
         * @param {Function} callback
         */
        _watchState(key, callback) {
            if (!this._stateManager) return;
            const unsub = this._stateManager.subscribe(key, (newValue, oldValue) => {
                if (this._destroyed) { unsub(); return; }
                try { callback(newValue, oldValue); } catch (e) {
                    console.error(`[BaseModule:${this._name}] StateManager "${key}" 回呼失敗:`, e);
                }
            });
            this._eventUnsubscribes.push(unsub);
        }

        /**
         * 取得當前是否已銷毀
         * @returns {boolean}
         */
        get isDestroyed() { return this._destroyed; }

        /**
         * 取得模組名稱
         * @returns {string}
         */
        get name() { return this._name; }

        /**
         * 靜態方法：取得所有已註冊的執行個體
         * @returns {Map<string, Array>}
         */
        static getInstances() { return _instances; }
    }

    return BaseModule;
})();

// ============================================================
// Source: src\core\ConfigManager.js
// ============================================================
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

// ============================================================
// Source: src\modules\CacheManager.js
// ============================================================
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

// ============================================================
// Source: src\modules\DOMUtils.js
// ============================================================
// ================================================================
// DOMUtils - DOM 工具函數模組
// 繼承 BaseModule，封裝所有 DOM 操作與元素提取邏輯
// ================================================================
const DOMUtils = (function () {
    class DOMUtils extends BaseModule {
        constructor() {
            super('DOMUtils');
        }

        init() {
            console.log('[DOMUtils] 初始化...');
            console.log('[DOMUtils] 初始化完成');
        }

        /**
         * 從元素中提取作品序號 (sn)
         * @param {Element} el
         * @returns {string|null}
         */
        extractSn(el) {
            if (!el) return null;
            const href = el.getAttribute('href') || el.querySelector('a')?.getAttribute('href') || '';
            const match = href.match(/sn=(\d+)/);
            return match ? match[1] : null;
        }

        /**
         * 從區塊元素中提取作品序號
         * @param {Element} block
         * @returns {string|null}
         */
        getSnFromBlock(block) {
            if (!block) return null;
            const link = block.querySelector('a[href*="animeVideo.php?sn="]');
            if (!link) return null;
            const match = link.href.match(/sn=(\d+)/);
            return match ? match[1] : null;
        }

        /**
         * 取得縮圖容器元素
         * @param {Element} cardLink
         * @returns {Element|null}
         */
        getThumbnailContainer(cardLink) {
            if (!cardLink) return null;
            const container = cardLink.querySelector(
                '.theme-img-block, .newanime-block__img, .newanime-img, .postimg, .anime-card-img'
            );
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

        /**
         * 判斷是否為有效的動畫卡片元素
         * @param {Element} link
         * @returns {boolean}
         */
        isValidAnimeCard(link) {
            if (!link || link.tagName !== 'A') return false;
            if (!/anime(?:Video|Ref)\.php\?sn=\d+/.test(link.href)) return false;
            if (link.classList.contains('next-btn') || link.classList.contains('play-btn') ||
                link.classList.contains('click-area') || link.closest('.user-watchTime-list')) return false;
            return true;
        }

        /**
         * 清理標題文字（移除播放圖示、集數標記等）
         * @param {string} titleStr
         * @returns {string}
         */
        cleanTitle(titleStr) {
            if (!titleStr) return '';
            return titleStr
                .replace(/play_arrow|skip_next|下一集/g, '')
                .replace(/[\n\r\t]/g, '').trim()
                .replace(/\s*\[\d+\]\s*$/, '')
                .replace(/\s*第\s*\d+\s*[集話]\s*$/, '')
                .replace(/\s*第\s*\d+\s*季\s*(\[\d+\])?\s*$/, '')
                .replace(/\s*\[雙語\]\s*$/, '').trim();
        }

        /**
         * 從標題字串中提取總集數
         * @param {string} titleStr
         * @returns {number|null}
         */
        extractTotalEpisodes(titleStr) {
            if (!titleStr) return null;
            const s = titleStr.trim();
            let m = s.match(/\[\s*(\d+)\s*\]\s*$/);
            if (m) return parseInt(m[1], 10);
            m = s.match(/[全共]\s*(\d+)\s*[集話]/);
            return m ? parseInt(m[1], 10) : null;
        }

        /**
         * 從卡片元素取得總集數
         * @param {Element} cardLink
         * @returns {number|null}
         */
        getTotalEpisodesFromCard(cardLink) {
            if (!cardLink) return null;
            const el = cardLink.querySelector('.theme-number');
            return el ? this.extractTotalEpisodes(el.textContent || '') : null;
        }

        /**
         * 判斷是否為有效的動畫標題（過濾非動畫文字）
         * @param {string} title
         * @returns {boolean}
         */
        isValidAnimeTitle(title) {
            if (!title || title.length <= 1 || title.length > 80) return false;
            const blocked = [
                '展開', '摺疊', '折疊', '確定', '取消', '下一集', '上一集', '播放', '暫停',
                '會員', '我的追番', '觀看紀錄', '設定', '訂閱', '分享', '刪除', '確定刪除',
                '隱私', '個人首頁', '登出', '登入', '註冊', '搜尋', '尋找', '熱門', '精選',
                '版權所有', '服務條款', '聯絡我們', '關於我們', '已看過', '看至', '觀看至',
                '已更新至', '更新至', '分', '秒', '小時', 'APP', 'VIP', 'AD', 'PR', 'close',
                'skip_next', 'play_arrow', 'expand_more', 'star_rate', 'keyboard_arrow_down'
            ];
            if (blocked.some(w => title.toLowerCase().includes(w))) return false;
            if (/^\d+$/.test(title) || /\d+年\d+月/.test(title)) return false;
            return true;
        }

        /**
         * 取得元素所屬的卡片連結
         * @param {Element} el
         * @returns {Element|null}
         */
        getCardLink(el) {
            return el.closest('a, .theme-list-main, .newanime-block__link');
        }

        /**
         * 銷毀模組
         */
        destroy() {
            super.destroy();
            console.log('[DOMUtils] 已銷毀');
        }
    }

    return DOMUtils;
})();

// ============================================================
// Source: src\modules\RatingProcessor.js
// ============================================================
// ================================================================
// RatingProcessor - 評分處理模組
// 繼承 BaseModule，負責評分解析、渲染、過濾
// ================================================================
const RatingProcessor = (function () {
    class RatingProcessor extends BaseModule {
        constructor() {
            super('RatingProcessor');
            this._cacheManager = null;
            this._requestManager = null;
            this._domUtils = null;
        }

        /**
         * 注入依賴模組
         * @param {Object} deps
         */
        setDependencies(deps) {
            this._cacheManager = deps.cacheManager;
            this._requestManager = deps.requestManager;
            this._domUtils = deps.domUtils;
        }

        init() {
            console.log('[RatingProcessor] 初始化...');
            console.log('[RatingProcessor] 初始化完成');
        }

        /**
         * 從 HTML 解析評分資料
         * @param {string} html
         * @returns {{ score: number, count: number, totalEpisodes: number|null }|null}
         */
        parseFromHtml(html) {
            const scoreMatch = html.match(/"ratingValue"\s*:\s*"?([0-9.]+)"?/);
            const countMatch = html.match(/"ratingCount"\s*:\s*"?([0-9]+)"?/);
            if (!scoreMatch || !countMatch) return null;

            const rawScore = parseFloat(scoreMatch[1]);
            const count = parseInt(countMatch[1], 10);

            // 從 JSON-LD 提取實際總集數
            let totalEpisodes = null;
            const episodeMatch = html.match(/"numberOfEpisodes"\s*:\s*(\d+)/);
            if (episodeMatch) totalEpisodes = parseInt(episodeMatch[1], 10);

            return {
                score: rawScore > 5 ? rawScore / 2 : rawScore,
                count,
                totalEpisodes
            };
        }

        /**
         * 生成五星分佈百分比
         * @param {number} score
         * @returns {Object} { 1: %, 2: %, 3: %, 4: %, 5: % }
         */
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
        }

        /**
         * 取得評分等級資訊
         * @param {number} score
         * @param {boolean} isLowSample
         * @returns {{ class: string, text: string, color: string, bg: string }}
         */
        _getTierInfo(score, isLowSample) {
            if (isLowSample) {
                return { class: 'acr-low-sample', text: '評估人數過少', color: '#a1a1aa', bg: 'rgba(161, 161, 170, 0.12)' };
            }
            if (score >= 4.8) return { class: 'acr-tier-mythical', text: '神作必看', color: '#ff2a6d', bg: 'rgba(255, 42, 109, 0.15)' };
            if (score >= 4.5) return { class: 'acr-tier-excellent', text: '極力推薦', color: '#FFD700', bg: 'rgba(255, 215, 0, 0.15)' };
            if (score >= 4.0) return { class: 'acr-tier-good', text: '佳作推薦', color: '#05ffc4', bg: 'rgba(5, 255, 196, 0.15)' };
            if (score >= 3.5) return { class: 'acr-tier-average', text: '中規中矩', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.15)' };
            return { class: 'acr-tier-poor', text: '雷作避難', color: '#ff5f5f', bg: 'rgba(255, 95, 95, 0.15)' };
        }

        /**
         * 渲染評分徽章到容器
         * @param {Element} container
         * @param {Object} data { score, count, totalEpisodes }
         */
        render(container, data) {
            if (!container || container.querySelector('.ani-custom-rating')) return;

            const score = parseFloat(data.score);
            const count = parseInt(data.count, 10);
            const countFormatted = count.toLocaleString('zh-TW');
            const cardLink = this._domUtils.getCardLink(container);
            if (cardLink) cardLink.setAttribute('data-rating-score', score);
            if (cardLink && data.totalEpisodes) {
                cardLink.setAttribute('data-rating-total-episodes', data.totalEpisodes);
            }

            const sampleThreshold = this._stateManager.get('config.sampleThreshold') || 800;
            const isLowSample = count < sampleThreshold;
            const tier = this._getTierInfo(score, isLowSample);
            const distribution = this.generateStarDistribution(score);
            const fontSize = this._stateManager.get('config.fontSize') || 14;
            const radius = this._stateManager.get('config.radius') || 6;

            const badge = document.createElement('div');
            badge.className = `ani-custom-rating ${tier.class}`;
            badge.style.cssText = `font-size:${fontSize}px;border-radius:${radius}px`;

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

            // hover 時放開容器 overflow 限制
            badge.addEventListener('mouseenter', () => {
                const origOverflow = container.style.overflow;
                container.dataset.origOverflow = origOverflow || '';
                container.style.overflow = 'visible';
            });
            badge.addEventListener('mouseleave', () => {
                container.style.overflow = container.dataset.origOverflow || '';
                delete container.dataset.origOverflow;
            });

            // 發送事件通知其他模組
            this._eventBus.emit('rating:rendered', { container, score, count });
        }

        /**
         * 套用過濾（遮罩/屏蔽）
         * @param {Element} container
         * @param {number} score
         */
        applyFilter(container, score) {
            if (!container) return;

            const threshold = this._stateManager.get('config.threshold') || 3.5;
            const blockThreshold = this._stateManager.get('config.blockThreshold') || 3.0;
            const cardLink = this._domUtils.getCardLink(container);

            if (cardLink) {
                const img = cardLink.querySelector('img');
                if (img) {
                    if (score < threshold) {
                        img.classList.add('ani-low-rating-masked');
                        img.style.pointerEvents = 'auto';
                    } else {
                        img.classList.remove('ani-low-rating-masked');
                    }
                }
            }

            const target = cardLink || container;
            target.classList.toggle('ani-rating-blocked', score < blockThreshold);
        }

        /**
         * 處理單一項目（檢查快取 → 骨架屏 → 請求 → 渲染）
         * @param {string} sn
         * @param {Element} container
         */
        async processItem(sn, container) {
            const enabled = this._stateManager.get('config.enabled');
            if (!enabled || !container) return;

            const cardLink = this._domUtils.getCardLink(container);
            if (cardLink) {
                this._eventBus.emit('rating:registerOrder', { sn });
            }

            this._eventBus.emit('rating:checkFade', { cardLink });

            // 檢查快取
            const cached = this._cacheManager.get(sn);
            if (cached) {
                this.render(container, cached);
                this.applyFilter(container, cached.score);
                this._eventBus.emit('rating:progressUpdate');
                return;
            }

            // 顯示骨架屏
            const skeleton = document.createElement('div');
            skeleton.className = 'ani-rating-skeleton';
            container.appendChild(skeleton);

            try {
                const res = await this._requestManager.scheduleFetch(`/animeRef.php?sn=${sn}`);
                if (!res || !res.ok) { skeleton.remove(); return; }

                const html = await res.text();
                const parsed = this.parseFromHtml(html);
                skeleton.remove();

                if (parsed) {
                    this._cacheManager.set(sn, parsed.score, parsed.count, parsed.totalEpisodes);
                    this.render(container, parsed);
                    this.applyFilter(container, parsed.score);
                    this._eventBus.emit('rating:progressUpdate');
                }
            } catch (e) {
                console.error('[RatingProcessor] 抓取評分時出錯: SN ' + sn, e);
            } finally {
                if (skeleton && skeleton.parentNode) skeleton.remove();
            }
        }

        destroy() {
            this._cacheManager = null;
            this._requestManager = null;
            this._domUtils = null;
            super.destroy();
            console.log('[RatingProcessor] 已銷毀');
        }
    }

    return RatingProcessor;
})();

// ============================================================
// Source: src\modules\RequestManager.js
// ============================================================
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

// ============================================================
// Source: src\modules\SortManager.js
// ============================================================
// ================================================================
// SortManager - 排序管理模組
// 繼承 BaseModule，負責排序快照與 DOM 重排
// ================================================================
const SortManager = (function () {
    class SortManager extends BaseModule {
        constructor() {
            super('SortManager');
            this._snapshots = [];
            this._debounceTimeout = null;
            this._lastToastTime = 0;
            this._domUtils = null;
            this._ratingProcessor = null;

            this.SORTABLE_BLOCKS = [
                { parent: '.theme-list-block', child: 'a.theme-list-main' },
                { parent: '.newanime-wrap', child: '.newanime-block' },
                { parent: '.newanime-wrap-main', child: '.newanime-block' }
            ];
        }

        /**
         * 注入依賴模組
         * @param {Object} deps
         */
        setDependencies(deps) {
            this._domUtils = deps.domUtils;
            this._ratingProcessor = deps.ratingProcessor;
        }

        init() {
            console.log('[SortManager] 初始化...');

            // 監聽排序開關變更
            this._listenEvent('config:changed:sortEnabled', (data) => {
                if (data.value) {
                    this._setSorted(true);
                } else {
                    this._setSorted(false);
                }
            });

            // 監聽評分註冊順序
            this._listenEvent('rating:registerOrder', (data) => {
                // 快照模式不需要額外註冊
            });

            console.log('[SortManager] 初始化完成');
        }

        /**
         * 捕捉當前 DOM 順序快照
         */
        captureSnapshot() {
            this._snapshots = [];
            this.SORTABLE_BLOCKS.forEach(({ parent, child }) => {
                document.querySelectorAll(parent).forEach(block => {
                    const sns = [];
                    block.querySelectorAll(child).forEach(item => {
                        const sn = (child === 'a.theme-list-main' || child === 'a')
                            ? this._domUtils.extractSn(item) : this._domUtils.getSnFromBlock(item);
                        if (sn) sns.push(sn);
                    });
                    if (sns.length > 0) this._snapshots.push({ parent, child, sns });
                });
            });
        }

        /**
         * 從快照還原 DOM 順序
         */
        _restoreFromSnapshot() {
            this._snapshots.forEach(snapshot => {
                document.querySelectorAll(snapshot.parent).forEach(block => {
                    const items = Array.from(block.querySelectorAll(snapshot.child));
                    const itemMap = new Map();
                    items.forEach(item => {
                        const sn = (snapshot.child === 'a.theme-list-main' || snapshot.child === 'a')
                            ? this._domUtils.extractSn(item) : this._domUtils.getSnFromBlock(item);
                        if (sn) itemMap.set(sn, item);
                    });
                    snapshot.sns.forEach(sn => {
                        const item = itemMap.get(sn);
                        if (item) block.appendChild(item);
                    });
                });
            });
        }

        /**
         * 套用排序
         * @param {boolean} isSorted 是否為排序模式
         */
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
        }

        /**
         * 設定排序狀態
         */
        _setSorted(sorted) {
            this._stateManager.set('app.isSorted', sorted);
            const sortBtn = document.getElementById('ani-sort-float-btn');
            if (sortBtn) {
                sortBtn.classList.toggle('active', sorted);
                sortBtn.innerHTML = sorted ? '★↓' : '⇅';
            }
            if (sorted) {
                this.forceLoadAllAndSort();
            } else {
                this.apply(false);
            }
        }

        /**
         * 強制載入所有未處理卡片並排序
         */
        async forceLoadAllAndSort() {
            const selector = 'a.theme-list-main:not([data-rating-processed])';
            const unprocessed = Array.from(document.querySelectorAll(selector)).filter(
                link => this._domUtils.isValidAnimeCard(link)
            );
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

            this._eventBus.emit('sort:start', { total: unprocessed.length });

            for (const link of unprocessed) {
                const isSorted = this._stateManager.get('app.isSorted');
                if (!isSorted) {
                    progressBar.style.opacity = '0';
                    if (sortBtn) { sortBtn.classList.remove('loading'); sortBtn.innerHTML = '⇅'; }
                    return;
                }
                const match = link.href.match(/sn=(\d+)/);
                if (match) {
                    const container = this._domUtils.getThumbnailContainer(link);
                    if (container) {
                        link.setAttribute('data-rating-processed', 'true');
                        await this._ratingProcessor.processItem(match[1], container);
                    }
                }
            }

            progressBar.style.width = '100%';
            this._setTimeout(() => { progressBar.style.opacity = '0'; }, 500);
            if (sortBtn) { sortBtn.classList.remove('loading'); sortBtn.innerHTML = '★↓'; }
            this.apply(true);

            this._eventBus.emit('sort:complete');
            this._showToastSafely('✅ 已強制預先載入所有評等，排序完成！');
        }

        /**
         * 觸發防抖排序
         */
        triggerDebounced() {
            clearTimeout(this._debounceTimeout);
            this._debounceTimeout = this._setTimeout(async () => {
                const selector = 'a.theme-list-main:not([data-rating-processed])';
                const unprocessed = Array.from(document.querySelectorAll(selector)).filter(
                    link => this._domUtils.isValidAnimeCard(link)
                );
                if (unprocessed.length > 0) {
                    for (const link of unprocessed) {
                        const match = link.href.match(/sn=(\d+)/);
                        if (match) {
                            const container = this._domUtils.getThumbnailContainer(link);
                            if (container) {
                                link.setAttribute('data-rating-processed', 'true');
                                await this._ratingProcessor.processItem(match[1], container);
                            }
                        }
                    }
                }
                this.apply(true);
                const now = Date.now();
                if (now - this._lastToastTime > 5000) {
                    this._showToastSafely('ℹ️ 目前已自動套用「評分高低」自訂排序模式（非官方預設）');
                    this._lastToastTime = now;
                }
            }, 300);
        }

        /**
         * 安全顯示 Toast（透過 EventBus）
         */
        _showToastSafely(message) {
            this._eventBus.emit('ui:showToast', { message });
        }

        destroy() {
            clearTimeout(this._debounceTimeout);
            this._snapshots = [];
            this._domUtils = null;
            this._ratingProcessor = null;
            super.destroy();
            console.log('[SortManager] 已銷毀');
        }
    }

    return SortManager;
})();

// ============================================================
// Source: src\modules\UIComponents.js
// ============================================================
// ================================================================
// UIComponents - UI 元件模組
// 繼承 BaseModule，負責 CSS 注入、Modal、導覽、浮動按鈕
// ================================================================
const UIComponents = (function () {
    class UIComponents extends BaseModule {
        constructor() {
            super('UIComponents');
            this._cacheManager = null;
            this._watchHistoryManager = null;
            this._sortManager = null;
            this._ratingProcessor = null;
        }

        /**
         * 注入依賴模組
         * @param {Object} deps
         */
        setDependencies(deps) {
            this._cacheManager = deps.cacheManager;
            this._watchHistoryManager = deps.watchHistoryManager;
            this._sortManager = deps.sortManager;
            this._ratingProcessor = deps.ratingProcessor;
        }

        init() {
            console.log('[UIComponents] 初始化...');

            // 監聽 Toast 請求
            this._listenEvent('ui:showToast', (data) => {
                this.showToast(data.message);
            });

            // 監聽進度更新
            this._listenEvent('rating:progressUpdate', () => {
                this._updateProgressBar();
            });

            // 監聽排序進度
            this._listenEvent('sort:start', (data) => {
                this._initProgressBar(data.total);
            });

            // 監聽歷史紀錄進度
            this._listenEvent('history:fetchStart', () => {
                this._initHistoryBar();
            });
            this._listenEvent('history:pageProgress', (data) => {
                this._updateHistoryBar(data.currentPage);
            });
            this._listenEvent('history:fetchComplete', () => {
                this._completeHistoryBar();
            });

            console.log('[UIComponents] 初始化完成');
        }

        // ========== CSS 注入 ==========

        /**
         * 注入所有樣式
         */
        injectStyles() {
            const style = document.createElement('style');
            style.innerHTML = this._getStyles();
            document.head.appendChild(style);
        }

        /**
         * 取得完整 CSS 字串
         */
        _getStyles() {
            return `
                .ani-rating-skeleton {
                    position:absolute;top:6px;left:6px;width:78px;height:21px;
                    background:rgba(30,30,30,0.85);border-radius:6px;
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
                    border-radius:6px;padding:4px 10px;display:inline-flex;
                    align-items:center;gap:6px;font-size:14px;font-weight:700;
                    z-index:15;line-height:1;transition:all 0.2s cubic-bezier(0.4,0,0.2,1);
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
                .ani-custom-rating .acr-count{color:rgba(0,0,0,0.78);font-size:11px;font-weight:400;}
                body.ani-user-dark-mode .ani-custom-rating .acr-count{color:#d4d4d8 !important;}
                .acr-tooltip{position:absolute;left:0;top:calc(100% + 8px);width:max-content;max-width:220px;min-width:160px;background:#18181c;border:1.5px solid rgba(255,255,255,0.12);border-radius:10px;padding:10px;box-shadow:0 12px 28px rgba(0,0,0,0.85);z-index:99999;opacity:0;visibility:hidden;transform:translateY(-6px);transition:all 0.2s cubic-bezier(0.16,1,0.3,1);pointer-events:none;color:#f4f4f7;font-family:system-ui,sans-serif;font-weight:normal;line-height:1.4;}
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
                #ani-history-progress-bar{position:fixed;bottom:0;left:0;height:4px;background:linear-gradient(90deg,#10b981 0%,#14b8a6 50%,#06b6d4 100%);background-size:200% 100%;animation:ani-history-shimmer 2.5s linear infinite;z-index:100000;width:0%;transition:width 0.2s cubic-bezier(0.4,0,0.2,1),opacity 0.4s ease;box-shadow:0 0 20px rgba(16,185,129,0.8),0 0 40px rgba(20,184,166,0.6),0 0 60px rgba(6,182,212,0.4);opacity:0;border-radius:0 3px 3px 0;}
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
        }

        // ========== Toast ==========

        /**
         * 顯示 Toast 訊息
         * @param {string} message
         */
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
            toast._timeoutId = this._setTimeout(() => { toast.className = ''; }, 2800);
        }

        // ========== 浮動按鈕 ==========

        /**
         * 更新浮動按鈕的可見性
         */
        updateActionButtonsVisibility() {
            const isListPage = this._isAnimeListPage();
            const btns = ['ani-sort-float-btn', 'ani-mask-float-btn', 'ani-block-float-btn']
                .map(id => document.getElementById(id));
            const hasCards = document.querySelector('a.theme-list-main') !== null;
            btns.forEach(btn => { if (btn) btn.style.display = (isListPage && hasCards) ? 'inline-flex' : 'none'; });
            const configBtn = document.getElementById('ani-config-float-btn');
            if (configBtn) configBtn.style.display = isListPage ? 'inline-flex' : 'none';
        }

        /**
         * 注入浮動按鈕
         */
        injectActionButtons() {
            if (document.getElementById('ani-sort-float-btn')) return;

            const isSorted = this._stateManager.get('app.isSorted') || false;

            const sortBtn = document.createElement('button');
            sortBtn.id = 'ani-sort-float-btn';
            sortBtn.className = 'ani-float-btn';
            sortBtn.title = '依評分排序當前作品';
            sortBtn.innerHTML = isSorted ? '★↓' : '⇅';
            if (isSorted) sortBtn.classList.add('active');
            sortBtn.addEventListener('click', () => {
                const newSorted = !this._stateManager.get('app.isSorted');
                this._stateManager.set('app.isSorted', newSorted);
                this._stateManager.set('config.sortEnabled', newSorted);
                sortBtn.classList.toggle('active', newSorted);
                if (newSorted) {
                    sortBtn.innerHTML = '★↓';
                    this._sortManager.forceLoadAllAndSort();
                } else {
                    sortBtn.innerHTML = '⇅';
                    this._sortManager.apply(false);
                    this.showToast('已恢復官方預設順序。');
                }
            });

            const maskEnabled = this._stateManager.get('config.maskEnabled');
            const maskBtn = document.createElement('button');
            maskBtn.id = 'ani-mask-float-btn';
            maskBtn.className = 'ani-float-btn';
            maskBtn.title = '切換防雷遮罩顯示';
            maskBtn.innerHTML = maskEnabled ? '🛡️' : '🔓';
            if (maskEnabled) maskBtn.classList.add('active');
            document.body.classList.toggle('ani-disable-masking', !maskEnabled);
            maskBtn.addEventListener('click', () => {
                const newVal = !this._stateManager.get('config.maskEnabled');
                this._stateManager.set('config.maskEnabled', newVal);
                maskBtn.classList.toggle('active', newVal);
                document.body.classList.toggle('ani-disable-masking', !newVal);
                maskBtn.innerHTML = newVal ? '🛡️' : '🔓';
                this.showToast(newVal ? '已啟用低評分「防雷遮罩」保護。' : '已暫時解除「防雷遮罩」，展示完整清單。');
            });

            const blockEnabled = this._stateManager.get('config.blockEnabled');
            const blockBtn = document.createElement('button');
            blockBtn.id = 'ani-block-float-btn';
            blockBtn.className = 'ani-float-btn';
            blockBtn.title = '切換低分作品屏蔽';
            blockBtn.innerHTML = blockEnabled ? '🚫' : '👁️';
            if (blockEnabled) blockBtn.classList.add('active');
            document.body.classList.toggle('ani-disable-blocking', !blockEnabled);
            blockBtn.addEventListener('click', () => {
                const newVal = !this._stateManager.get('config.blockEnabled');
                this._stateManager.set('config.blockEnabled', newVal);
                blockBtn.classList.toggle('active', newVal);
                document.body.classList.toggle('ani-disable-blocking', !newVal);
                blockBtn.innerHTML = newVal ? '🚫' : '👁️';
                this.showToast(newVal ? '已啟用超低評作品「完全屏蔽」隱藏。' : '已顯示被屏蔽的超低評作品。');
            });

            document.body.appendChild(sortBtn);
            document.body.appendChild(maskBtn);
            document.body.appendChild(blockBtn);
            this.updateActionButtonsVisibility();
        }

        /**
         * 注入 UI（頂部選單按鈕）
         */
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
        }

        // ========== 功能導覽 ==========

        /**
         * 啟動功能導覽
         */
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
        }

        // ========== 設定 Modal ==========

        /**
         * 開啟設定 Modal
         */
        openModal() {
            if (document.getElementById('ani-rating-overlay')) return;

            const isDark = document.body.classList.contains('ani-user-dark-mode');
            const c = this._stateManager.snapshot();
            const cacheCount = this._cacheManager.size;

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
                            ${this._modalToggle('arm-toggle', '啟用評分顯示', '在動畫封面上疊加評分徽章', c['config.enabled'], itemBorder, listTitleColor, listDescColor)}
                            ${this._modalToggle('arm-sort-toggle', '啟用評分自動排序', '依評分高低自動重新排列作品清單 (即時生效)', c['config.sortEnabled'], itemBorder, listTitleColor, listDescColor)}
                            ${this._modalToggle('arm-mask-toggle', '啟用防雷遮罩', '遮蓋低於防雷門檻之作品封面 (滑鼠指上即還原)', c['config.maskEnabled'], itemBorder, listTitleColor, listDescColor)}
                            ${this._modalInput('arm-threshold', '防雷遮罩門檻', '分數低於此值將套用半透明模糊遮罩', c['config.threshold'], '分', '0.1', '0', '5', inputBg, inputBorder, inputColor, itemBorder, listTitleColor, listDescColor)}
                            ${this._modalToggle('arm-block-toggle', '啟用作品屏蔽', '直接隱藏低於屏蔽門檻的作品', c['config.blockEnabled'], itemBorder, listTitleColor, listDescColor)}
                            ${this._modalInput('arm-block-threshold', '作品屏蔽門檻', '完全屏蔽啟用時，低於此分數直接隱藏', c['config.blockThreshold'], '分', '0.1', '0', '5', inputBg, inputBorder, inputColor, itemBorder, listTitleColor, listDescColor)}
                            ${this._modalToggle('arm-fade-watched-toggle', '已看過作品視覺淡化', '降低已看過封面透明度 (背景自動定期更新)', c['config.fadeWatched'], itemBorder, listTitleColor, listDescColor)}
                            <div style="font-size:11px;line-height:1.45;background:${D('rgba(59,130,246,0.08)','rgba(96,165,250,0.1)')};border:1px dashed ${D('rgba(59,130,246,0.22)','rgba(96,165,250,0.3)')};padding:9px 12px;border-radius:8px;margin-top:6px;color:${listDescColor} !important;">
                                💡 <strong>功能提示：</strong>在支援作品清單的頁面<strong>右下角</strong>，會出現三個垂直的快捷懸浮按鈕：<br>
                                <strong>⇅ / ★↓</strong> 一鍵切換自訂排序；<strong>🛡️</strong> 快捷啟閉防雷遮罩；<strong>🚫</strong> 快捷啟閉完全屏蔽。<br>
                                <strong>啟用評分自動排序</strong>設定開啟後將立即按評分高低重新排列清單，無需手動點擊按鈕。
                            </div>
                        </div>
                        <div class="arm-section" style="background:${sectionBg} !important;border:${sectionBorder} !important;">
                            <div class="arm-section-header" style="color:${sectionHeaderColor} !important;">🎨 徽章外觀樣式</div>
                            ${this._modalInput('arm-fs', '字體大小', '調整評分徽章上文字的大小', c['config.fontSize'], 'px', '1', '8', '24', inputBg, inputBorder, inputColor, itemBorder, listTitleColor, listDescColor)}
                            ${this._modalInput('arm-rad', '徽章圓角', '調整徽章與骨架屏的四角半徑', c['config.radius'], 'px', '1', '0', '24', inputBg, inputBorder, inputColor, 'none', listTitleColor, listDescColor)}
                        </div>
                        <div class="arm-section" style="background:${sectionBg} !important;border:${sectionBorder} !important;">
                            <div class="arm-section-header" style="color:${sectionHeaderColor} !important;">⚙️ 系統效能與快取</div>
                            ${this._modalInput('arm-sample-threshold', '防失真警告門檻', '當評價人數少於此值時，顯示防失真警告', c['config.sampleThreshold'], '人', '10', '10', '2000', inputBg, inputBorder, inputColor, itemBorder, listTitleColor, listDescColor)}
                            ${this._modalInput('arm-fetch-interval', '評分請求間隔', '避免請求過快被伺服器阻擋/禁止的最小間隔時間', c['config.fetchInterval'], 'ms', '100', '100', '5000', inputBg, inputBorder, inputColor, itemBorder, listTitleColor, listDescColor)}
                            ${this._modalInput('arm-cache-limit', '本地快取容量上限', '快取保留的最大作品評分筆數', c['config.cacheLimit'], '筆', '1', '50', '2000', inputBg, inputBorder, inputColor, itemBorder, listTitleColor, listDescColor)}
                            ${this._modalInput('arm-ttl', '快取有效時間', '快取失效並自動更新的間隔時間', c['config.ttlHours'], '小時', '1', '1', '720', inputBg, inputBorder, inputColor, 'none', listTitleColor, listDescColor)}
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

            // 綁定 toggle 事件
            const toggleStates = {
                armToggle: c['config.enabled'],
                armSortToggle: c['config.sortEnabled'],
                armMaskToggle: c['config.maskEnabled'],
                armBlockToggle: c['config.blockEnabled'],
                armFadeWatchedToggle: c['config.fadeWatched']
            };

            Object.keys(toggleStates).forEach(key => {
                const id = key.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
                const el = document.getElementById(id);
                if (!el) return;
                el.addEventListener('click', () => {
                    toggleStates[key] = !toggleStates[key];
                    el.classList.toggle('on', toggleStates[key]);
                });
            });

            document.getElementById('arm-cache-clear').addEventListener('click', () => {
                this._cacheManager.clear();
                overlay.querySelector('.arm-cache-badge').textContent = '0 筆';
            });

            document.getElementById('arm-restart-tour').addEventListener('click', () => { overlay.remove(); this.startTour(); });

            document.getElementById('arm-export-history').addEventListener('click', () => {
                const raw = this._watchHistoryManager.getRawHistory();
                if (raw.length === 0) {
                    this.showToast('⚠️ 尚無觀看紀錄，請稍候背景同步完成');
                    return;
                }
                // 觸發匯出（透過公開方法）
                const blob = new Blob([JSON.stringify(raw, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `ani-history-${Date.now()}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                this.showToast('✅ 已匯出觀看紀錄 JSON');
            });

            const close = () => overlay.remove();
            document.getElementById('arm-close-btn').addEventListener('click', close);
            document.getElementById('arm-cancel').addEventListener('click', close);
            overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

            document.getElementById('arm-save').addEventListener('click', () => {
                const oldEnabled = c['config.enabled'];
                const oldFadeWatched = c['config.fadeWatched'];

                // 透過 StateManager 批次更新設定（會自動觸發 config:changed 事件）
                const updates = {
                    'config.enabled': toggleStates.armToggle,
                    'config.maskEnabled': toggleStates.armMaskToggle,
                    'config.blockEnabled': toggleStates.armBlockToggle,
                    'config.fadeWatched': toggleStates.armFadeWatchedToggle,
                    'config.sortEnabled': toggleStates.armSortToggle,
                };

                ['arm-fetch-interval', 'arm-fs', 'arm-rad', 'arm-threshold', 'arm-block-threshold',
                    'arm-sample-threshold', 'arm-cache-limit', 'arm-ttl'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) {
                        const configKey = id.replace('arm-', '');
                        const value = isNaN(parseFloat(el.value)) ? el.value : parseFloat(el.value);
                        updates[`config.${configKey}`] = value;
                    }
                });

                this._stateManager.setBatch(updates);

                close();

                if (toggleStates.armFadeWatchedToggle && !oldFadeWatched && this._watchHistoryManager.getRawHistory().length === 0) {
                    this.showToast('⏳ 正在背景同步觀看紀錄...');
                    this._watchHistoryManager.fetchHistory().then(() => {
                        if (this._watchHistoryManager.getRawHistory().length > 0) {
                            this.showToast('✅ 已同步 ' + this._watchHistoryManager.getRawHistory().length + ' 筆觀看紀錄');
                        }
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
        }

        // ========== Modal 輔助方法 ==========

        _modalToggle(id, title, desc, isOn, border, titleColor, descColor) {
            return `<div class="arm-list-item" style="border-bottom:${border} !important;">
                <div class="arm-list-left">
                    <div class="arm-list-title" style="color:${titleColor} !important;">${title}</div>
                    <div class="arm-list-desc" style="color:${descColor} !important;">${desc}</div>
                </div>
                <div class="arm-toggle-pill ${isOn ? 'on' : ''}" id="${id}"></div>
            </div>`;
        }

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

        // ========== 進度條 ==========

        _isAnimeListPage() {
            return /animeList\.php/.test(window.location.pathname);
        }

        _initProgressBar(total) {
            let bar = document.getElementById('ani-sort-progress-bar');
            if (!bar) {
                bar = document.createElement('div');
                bar.id = 'ani-sort-progress-bar';
                document.body.appendChild(bar);
            }
            bar.style.width = '0%';
            bar.style.opacity = '1';
        }

        _updateProgressBar() {
            const bar = document.getElementById('ani-sort-progress-bar');
            if (!bar) return;
            const totalCards = document.querySelectorAll('a.theme-list-main').length;
            if (totalCards <= 0) { bar.style.opacity = '0'; return; }
            const loadedBadges = document.querySelectorAll('.ani-custom-rating').length;
            const pct = Math.min(100, Math.round((loadedBadges / totalCards) * 100));
            bar.style.width = `${pct}%`;
            bar.setAttribute('data-percent', `評分載入 ${pct}% (${loadedBadges}/${totalCards})`);
            bar.style.opacity = pct >= 100 ? '0' : '1';
        }

        _initHistoryBar() {
            let bar = document.getElementById('ani-history-progress-bar');
            if (!bar) {
                bar = document.createElement('div');
                bar.id = 'ani-history-progress-bar';
                document.body.appendChild(bar);
            }
            bar.style.width = '0%';
            bar.style.opacity = '1';
        }

        _updateHistoryBar(currentPage) {
            const bar = document.getElementById('ani-history-progress-bar');
            if (!bar) return;
            const totalPages = this._watchHistoryManager._totalPages || 1;
            const pct = Math.round((currentPage / totalPages) * 100);
            bar.style.width = `${pct}%`;
            bar.setAttribute('data-percent', `歷史同步 ${pct}% (第 ${currentPage}/${totalPages} 頁)`);
            bar.style.opacity = pct >= 100 ? '0' : '1';
        }

        _completeHistoryBar() {
            const bar = document.getElementById('ani-history-progress-bar');
            if (bar) {
                bar.style.width = '100%';
                this._setTimeout(() => { bar.style.opacity = '0'; }, 500);
            }
        }

        destroy() {
            this._cacheManager = null;
            this._watchHistoryManager = null;
            this._sortManager = null;
            this._ratingProcessor = null;
            super.destroy();
            console.log('[UIComponents] 已銷毀');
        }
    }

    return UIComponents;
})();

// ============================================================
// Source: src\modules\WatchHistoryManager.js
// ============================================================
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

// ============================================================
// Source: src\main.js
// ============================================================
// ================================================================
// main.js - 主程式入口
// 負責初始化核心基礎設施並啟動各模組
// ================================================================

(function () {
    'use strict';

// ---------- 全域除錯工具 (開發用) ----------
if (typeof window !== 'undefined') {
    window.__aniDebug = {
        EventBus,
        StateManager,
        BaseModule,
        getModules: () => BaseModule.getInstances(),
    };
}

// ---------- 核心初始化 ----------
const _initApp = (function () {
    function init() {
        console.log('[AniGamerTool] 初始化開始...');

        // ===== 步驟 1: 建立並初始化核心基礎設施 =====
        const configManager = new ConfigManager();
        configManager.inject(EventBus, StateManager);
        configManager.init();

        const cacheManager = new CacheManager();
        cacheManager.inject(EventBus, StateManager);
        cacheManager.init();

        const requestManager = new RequestManager();
        requestManager.inject(EventBus, StateManager);
        requestManager.init();

        const domUtils = new DOMUtils();
        domUtils.inject(EventBus, StateManager);
        domUtils.init();

        // ===== 步驟 2: 建立業務邏輯模組（需依賴其他模組） =====
        const ratingProcessor = new RatingProcessor();
        ratingProcessor.inject(EventBus, StateManager);
        ratingProcessor.setDependencies({ cacheManager, requestManager, domUtils });
        ratingProcessor.init();

        const watchHistoryManager = new WatchHistoryManager();
        watchHistoryManager.inject(EventBus, StateManager);
        watchHistoryManager.setDependencies({ requestManager, domUtils });
        watchHistoryManager.init();

        const sortManager = new SortManager();
        sortManager.inject(EventBus, StateManager);
        sortManager.setDependencies({ domUtils, ratingProcessor });
        sortManager.init();

        const uiComponents = new UIComponents();
        uiComponents.inject(EventBus, StateManager);
        uiComponents.setDependencies({
            cacheManager,
            watchHistoryManager,
            sortManager,
            ratingProcessor
        });
        uiComponents.init();

        // ===== 步驟 3: 啟動應用程式 =====
        // 3a. 注入 CSS
        uiComponents.injectStyles();

        // 3b. 深色模式觀察
        _setupDarkModeObserver();

        // 3c. 注入 UI
        uiComponents.injectUI();
        uiComponents.injectActionButtons();

        // 3d. 進度條初始化
        ['ani-sort-progress-bar', 'ani-history-progress-bar'].forEach(id => {
            if (!document.getElementById(id)) {
                const bar = document.createElement('div');
                bar.id = id;
                bar.setAttribute('data-percent', '0%');
                document.body.appendChild(bar);
            }
        });

        // 3e. 事件委託：遮罩 hover
        document.body.addEventListener('mouseover', (e) => {
            const img = e.target.closest('img.ani-low-rating-masked');
            if (img) img.style.setProperty('filter', 'grayscale(0) opacity(1) blur(0px)', 'important');
        });
        document.body.addEventListener('mouseout', (e) => {
            const img = e.target.closest('img.ani-low-rating-masked');
            if (img) img.style.removeProperty('filter');
        });

        // 3f. 事件委託：設定按鈕
        document.body.addEventListener('click', (e) => {
            const btn = e.target.closest('.top_btn_rating_setting');
            if (btn) { e.preventDefault(); e.stopPropagation(); uiComponents.openModal(); }
        });

        // 3g. 定期確保按鈕事件（相容動態載入的 DOM）
        setInterval(() => {
            const btn = document.querySelector('.top_btn_rating_setting');
            if (!btn) return;
            if (!btn._handler) {
                btn._handler = (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); uiComponents.openModal(); };
                btn.addEventListener('click', btn._handler, true);
                const a = btn.querySelector('a');
                if (a && !a._handler) {
                    a._handler = (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); uiComponents.openModal(); };
                    a.addEventListener('click', a._handler, true);
                }
            }
        }, 500);

        // 3h. 懶載入 Observer
        let lazyObserver;
        {
            const observeCards = () => {
                const selector = 'a.theme-list-main:not([data-rating-processed])';
                document.querySelectorAll(selector).forEach(link => {
                    if (!domUtils.isValidAnimeCard(link)) return;
                    lazyObserver.observe(link);
                });
            };

            lazyObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (!entry.isIntersecting) return;
                    const link = entry.target;
                    lazyObserver.unobserve(link);
                    link.setAttribute('data-rating-processed', 'true');
                    const match = link.href.match(/sn=(\d+)/);
                    if (match) {
                        const container = domUtils.getThumbnailContainer(link);
                        if (container) ratingProcessor.processItem(match[1], container);
                    }
                });
            }, { rootMargin: '100px 0px', threshold: 0.01 });

            observeCards();
        }

        // 3i. MutationObserver 監聽 DOM 變更（自動過濾自身修改 + 翻頁時重新計算進度）
        let bodyObserverDebounce;
        const bodyObserver = new MutationObserver(() => {
            clearTimeout(bodyObserverDebounce);
            bodyObserverDebounce = setTimeout(() => {
                const selector = 'a.theme-list-main:not([data-rating-processed])';
                const newCards = document.querySelectorAll(selector);
                if (newCards.length > 0) {
                    // 翻頁時重新計算進度條並快照排序
                    EventBus.emit('rating:progressUpdate');
                    sortManager.captureSnapshot();
                }
                newCards.forEach(link => {
                    if (!domUtils.isValidAnimeCard(link)) return;
                    lazyObserver.observe(link);
                });
            }, 250);
        });
        bodyObserver.observe(document.documentElement, { childList: true, subtree: true });

        // 3j. 背景同步觀看紀錄
        watchHistoryManager.fetchHistory();

        // 3k. 快照原始排序
        sortManager.captureSnapshot();

        // 3l. 淡化標記
        document.body.classList.toggle('ani-watched-fade-enabled', configManager.get('fadeWatched'));

        // 3m. 非 animeList.php 頁面隱藏浮動按鈕
        if (!/animeList\.php/.test(window.location.pathname)) {
            ['ani-sort-float-btn', 'ani-mask-float-btn', 'ani-block-float-btn', 'ani-config-float-btn'].forEach(id => {
                const btn = document.getElementById(id);
                if (btn) btn.style.display = 'none';
            });
        }

        // 3n. 自動排序
        if (configManager.get('sortEnabled')) {
            setTimeout(() => {
                const btn = document.getElementById('ani-sort-float-btn');
                if (btn) {
                    StateManager.set('app.isSorted', true);
                    btn.classList.add('active');
                    btn.innerHTML = '★↓';
                    sortManager.forceLoadAllAndSort();
                } else {
                    let retries = 0;
                    const wait = setInterval(() => {
                        const b = document.getElementById('ani-sort-float-btn');
                        if (b) {
                            clearInterval(wait);
                            StateManager.set('app.isSorted', true);
                            b.classList.add('active');
                            b.innerHTML = '★↓';
                            sortManager.forceLoadAllAndSort();
                        }
                        if (++retries > 20) { clearInterval(wait); console.warn('[AniGamerTool] 排序按鈕初始化逾時'); }
                    }, 300);
                }
            }, 500);
        }

        // 3o. 首次導覽
        if (localStorage.getItem('aniRating_tourCompleted') !== 'true') {
            setTimeout(() => uiComponents.startTour(), 1500);
        }

        // ===== 步驟 4: 將模組公開至全域（除錯用） =====
        window.__aniConfig = configManager;
        window.__aniCache = cacheManager;
        window.__aniRequest = requestManager;
        window.__aniDOM = domUtils;
        window.__aniRating = ratingProcessor;
        window.__aniHistory = watchHistoryManager;
        window.__aniSort = sortManager;
        window.__aniUI = uiComponents;

        // 註冊全域錯誤處理
        window.addEventListener('error', (e) => {
            console.error('[AniGamerTool] 全域錯誤:', e.error || e.message);
        });
        window.addEventListener('unhandledrejection', (e) => {
            console.error('[AniGamerTool] 未處理的 Promise 拒絕:', e.reason);
        });

        console.log('[AniGamerTool] 初始化完成!');
        console.log('[AniGamerTool] 當前設定:', configManager.getAll());

        return configManager;
    }

    /**
     * 深色模式觀察器
     */
    function _setupDarkModeObserver() {
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
    }

    return { init };
})();

// ---------- 啟動應用程式 ----------
const app = _initApp.init();

// ================================================================
// 關閉 IIFE
// ================================================================
})();

