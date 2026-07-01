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