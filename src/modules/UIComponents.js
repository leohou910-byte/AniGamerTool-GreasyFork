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