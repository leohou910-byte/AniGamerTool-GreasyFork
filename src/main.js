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
