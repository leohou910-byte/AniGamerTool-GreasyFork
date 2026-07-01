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