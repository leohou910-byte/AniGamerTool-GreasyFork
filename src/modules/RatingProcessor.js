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