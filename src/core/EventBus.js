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