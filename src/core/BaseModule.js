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