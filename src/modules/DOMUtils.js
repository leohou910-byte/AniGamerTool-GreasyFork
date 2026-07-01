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