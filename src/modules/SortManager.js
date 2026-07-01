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