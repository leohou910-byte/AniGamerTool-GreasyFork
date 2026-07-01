#!/usr/bin/env node
/**
 * AniGamerTool Build Script (Node.js)
 * Usage: node build.js
 * Output: dist/script.user.js
 * Dependencies: None (pure Node.js)
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = 'src';
const DIST_DIR = 'dist';
const OUTPUT_FILE = path.join(DIST_DIR, 'script.user.js');

/**
 * 依照依賴順序收集所有待拼接的 JS 檔案路徑
 */
function collectFiles() {
    const paths = [];

    // 1. header.js 必須在最前面
    const headerPath = path.join(SRC_DIR, 'header.js');
    if (fs.existsSync(headerPath)) {
        paths.push(headerPath);
    }

    // 2. core 層：嚴格依賴順序
    //    EventBus → StateManager → BaseModule → 其他 Core 模組
    const CORE_ORDER = [
        'EventBus.js',
        'StateManager.js',
        'BaseModule.js',
    ];
    const coreDir = path.join(SRC_DIR, 'core');
    if (fs.existsSync(coreDir)) {
        const coreFiles = new Set(fs.readdirSync(coreDir).filter(f => f.endsWith('.js')));
        // 先依指定順序加入
        for (const name of CORE_ORDER) {
            if (coreFiles.has(name)) {
                paths.push(path.join(coreDir, name));
                coreFiles.delete(name);
            }
        }
        // 其餘 core 檔案依字母排序加入
        const remaining = Array.from(coreFiles).sort();
        for (const name of remaining) {
            paths.push(path.join(coreDir, name));
        }
    }

    // 3. modules 層：依字母排序
    const modulesDir = path.join(SRC_DIR, 'modules');
    if (fs.existsSync(modulesDir)) {
        const moduleFiles = fs.readdirSync(modulesDir)
            .filter(f => f.endsWith('.js'))
            .sort()
            .map(f => path.join(modulesDir, f));
        paths.push(...moduleFiles);
    }

    // 4. main.js 最後
    const mainPath = path.join(SRC_DIR, 'main.js');
    if (fs.existsSync(mainPath)) {
        paths.push(mainPath);
    }

    return paths;
}

/**
 * 安全讀取檔案
 */
function readFileSafe(filepath) {
    try {
        return fs.readFileSync(filepath, 'utf-8');
    } catch (e) {
        console.warn(`[警告] 找不到檔案: ${filepath}，已跳過`);
        return '';
    }
}

function build() {
    const separator = '='.repeat(50);
    console.log(separator);
    console.log('AniGamerTool Build Script');
    console.log(separator);

    // 確保 dist 目錄存在
    fs.mkdirSync(DIST_DIR, { recursive: true });

    const files = collectFiles();
    console.log(`\n拼接順序 (${files.length} 個檔案):`);
    files.forEach((f, i) => {
        console.log(`  ${String(i + 1).padStart(2, ' ')}. ${path.relative('.', f)}`);
    });

    // 拼接內容
    const parts = [];
    let totalLines = 0;

    for (const filepath of files) {
        const content = readFileSafe(filepath);
        if (!content) continue;

        const lines = (content.match(/\n/g) || []).length + 1;
        totalLines += lines;

        const relativePath = path.relative('.', filepath);

        // header.js 不加 source 註解，保持 UserScript 元數據在第一行
        if (relativePath === 'src\\header.js' || relativePath === 'src/header.js') {
            parts.push(content);
            parts.push('\n');
        } else {
            parts.push(`\n// ============================================================\n// Source: ${relativePath}\n// ============================================================\n`);
            parts.push(content);
            parts.push('\n');
        }

        console.log(`  ✓ ${relativePath} (${lines} 行)`);
    }

    // 寫入輸出檔案
    const outputContent = parts.join('');
    fs.writeFileSync(OUTPUT_FILE, outputContent, 'utf-8');

    const stats = fs.statSync(OUTPUT_FILE);

    console.log(`\n${separator}`);
    console.log('✓ 建置完成!');
    console.log(`  輸出檔案: ${OUTPUT_FILE}`);
    console.log(`  總行數:   ${totalLines} 行`);
    console.log(`  檔案大小: ${stats.size.toLocaleString()} bytes`);
    console.log(separator);
}

build();