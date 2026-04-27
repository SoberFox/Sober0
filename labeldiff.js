// ============================================================
// 标对比 - 洗水唛 / 吊牌 PDF 文字差异
// ============================================================

(function () {
    'use strict';

    function $(s) { return document.querySelector(s); }
    function escHtml(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

    let oldFile = null, newFile = null;
    let oldLines = [], newLines = [];

    // ---- Tab 切换 ----
    function initTabs() {
        const tabs = document.querySelectorAll('.cmp-subtab');
        if (!tabs.length || tabs[0].__bound) return;
        tabs.forEach(t => {
            t.__bound = true;
            t.addEventListener('click', () => {
                tabs.forEach(x => x.classList.remove('active'));
                t.classList.add('active');
                const tag = t.dataset.cmpTab;
                document.querySelectorAll('.cmp-pane').forEach(p => {
                    p.style.display = p.dataset.cmpPane === tag ? '' : 'none';
                });
            });
        });
    }

    // ---- PDF 文本提取 (按行) ----
    async function extractPdfLines(file) {
        if (typeof pdfjsLib === 'undefined') throw new Error('PDF 库未加载');
        if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
            pdfjsLib.GlobalWorkerOptions.workerSrc =
                'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
        }
        const ab = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(ab) }).promise;
        const lines = [];
        const Y_TOL = 3;
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const tc = await page.getTextContent();
            const items = tc.items
                .filter(it => it && it.str && it.str.trim())
                .map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5] }));
            items.sort((a, b) => b.y - a.y || a.x - b.x);
            let curY = null, cur = [];
            items.forEach(it => {
                if (curY === null || Math.abs(it.y - curY) > Y_TOL) {
                    if (cur.length) lines.push(cur.join(' ').trim());
                    cur = [it.str];
                    curY = it.y;
                } else {
                    cur.push(it.str);
                }
            });
            if (cur.length) lines.push(cur.join(' ').trim());
        }
        return lines.filter(Boolean);
    }

    // ---- 行规范化 + 可选去重 ----
    function normalize(line, opts) {
        let s = line;
        if (opts.trim) s = s.replace(/\s+/g, ' ').trim();
        if (opts.case) s = s.toLowerCase();
        return s;
    }

    function dedupSequential(lines) {
        const out = [];
        let prev = null;
        for (const l of lines) {
            if (l !== prev) out.push(l);
            prev = l;
        }
        return out;
    }

    function dedupAll(lines) {
        const seen = new Set();
        const out = [];
        for (const l of lines) {
            if (!seen.has(l)) { out.push(l); seen.add(l); }
        }
        return out;
    }

    // ---- LCS 行 diff ----
    function diffLines(oldLs, newLs, opts) {
        const oldKey = oldLs.map(l => normalize(l, opts));
        const newKey = newLs.map(l => normalize(l, opts));
        const m = oldKey.length, n = newKey.length;
        // dp[i][j] = LCS length of oldKey[0..i-1] and newKey[0..j-1]
        const dp = new Array(m + 1);
        for (let i = 0; i <= m; i++) dp[i] = new Uint32Array(n + 1);
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (oldKey[i - 1] === newKey[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
                else dp[i][j] = dp[i - 1][j] >= dp[i][j - 1] ? dp[i - 1][j] : dp[i][j - 1];
            }
        }
        // backtrack to ops
        const ops = [];
        let i = m, j = n;
        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && oldKey[i - 1] === newKey[j - 1]) {
                ops.unshift({ type: 'same', old: oldLs[i - 1], new: newLs[j - 1] });
                i--; j--;
            } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
                ops.unshift({ type: 'added', new: newLs[j - 1] });
                j--;
            } else {
                ops.unshift({ type: 'removed', old: oldLs[i - 1] });
                i--;
            }
        }
        // 把相邻的 removed + added 合并为 changed
        const merged = [];
        for (let k = 0; k < ops.length; k++) {
            const o = ops[k], next = ops[k + 1];
            if (o && next && o.type === 'removed' && next.type === 'added') {
                merged.push({ type: 'changed', old: o.old, new: next.new });
                k++;
            } else {
                merged.push(o);
            }
        }
        return merged;
    }

    // ---- 词级 inline diff (用于 changed 行) ----
    function tokenize(s) {
        // 按空格 / 标点切，但保留分隔符以便重组
        return s ? s.split(/(\s+|[，。、,.;:!?\/\\\(\)\[\]\{\}'"])/).filter(Boolean) : [];
    }
    function inlineDiff(oldStr, newStr) {
        const A = tokenize(oldStr), B = tokenize(newStr);
        const m = A.length, n = B.length;
        const dp = new Array(m + 1);
        for (let i = 0; i <= m; i++) dp[i] = new Uint16Array(n + 1);
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (A[i - 1] === B[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
                else dp[i][j] = dp[i - 1][j] >= dp[i][j - 1] ? dp[i - 1][j] : dp[i][j - 1];
            }
        }
        let i = m, j = n;
        const oldOut = [], newOut = [];
        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && A[i - 1] === B[j - 1]) {
                oldOut.unshift(escHtml(A[i - 1]));
                newOut.unshift(escHtml(B[j - 1]));
                i--; j--;
            } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
                newOut.unshift('<ins>' + escHtml(B[j - 1]) + '</ins>');
                j--;
            } else {
                oldOut.unshift('<del>' + escHtml(A[i - 1]) + '</del>');
                i--;
            }
        }
        return { oldHtml: oldOut.join(''), newHtml: newOut.join('') };
    }

    // ---- 主流程 ----
    async function runCompare() {
        if (!oldFile || !newFile) { alert('请先选择两份 PDF'); return; }
        const opts = {
            trim:  $('#lbl-opt-trim').checked,
            case:  $('#lbl-opt-case').checked,
            dedup: $('#lbl-opt-dedup').checked,
            onlyDiff: $('#lbl-opt-only-diff').checked,
        };
        showProgress('解析旧版本…', 10);
        try {
            const a = await extractPdfLines(oldFile);
            showProgress('解析新版本…', 50);
            const b = await extractPdfLines(newFile);
            showProgress('对比中…', 85);
            // 去重 (常见在洗水唛：6 个面板内容一样，全留下来对比意义不大)
            oldLines = opts.dedup ? dedupAll(a) : dedupSequential(a);
            newLines = opts.dedup ? dedupAll(b) : dedupSequential(b);
            const ops = diffLines(oldLines, newLines, opts);
            renderResult(ops, opts);
            hideProgress();
        } catch (e) {
            console.error(e);
            alert('对比失败：' + e.message);
            hideProgress();
        }
    }

    function renderResult(ops, opts) {
        const stats = { same: 0, added: 0, removed: 0, changed: 0 };
        ops.forEach(o => stats[o.type]++);
        const totalDiff = stats.added + stats.removed + stats.changed;

        // 统计
        const grid = $('#label-stats-grid');
        grid.innerHTML = `
            <div class="stat-card"><div class="stat-label">相同行</div><div class="stat-value">${stats.same}</div></div>
            <div class="stat-card"><div class="stat-label">修改</div><div class="stat-value" style="color:var(--warning)">${stats.changed}</div></div>
            <div class="stat-card"><div class="stat-label">新增</div><div class="stat-value" style="color:var(--accent)">${stats.added}</div></div>
            <div class="stat-card"><div class="stat-label">删除</div><div class="stat-value" style="color:var(--primary)">${stats.removed}</div></div>
            <div class="stat-card"><div class="stat-label">差异合计</div><div class="stat-value" style="color:${totalDiff ? 'var(--primary)' : 'var(--success)'}">${totalDiff}</div></div>
        `;
        $('#label-stats').style.display = '';

        // 表格
        const filtered = opts.onlyDiff ? ops.filter(o => o.type !== 'same') : ops;
        const tbody = filtered.map((o, idx) => {
            let oldHtml, newHtml, tag;
            if (o.type === 'changed') {
                const inl = inlineDiff(o.old || '', o.new || '');
                oldHtml = inl.oldHtml;
                newHtml = inl.newHtml;
                tag = '改';
            } else if (o.type === 'added') {
                oldHtml = '<span style="color:var(--text-faint)">— 新增 —</span>';
                newHtml = escHtml(o.new || '');
                tag = '+';
            } else if (o.type === 'removed') {
                oldHtml = escHtml(o.old || '');
                newHtml = '<span style="color:var(--text-faint)">— 删除 —</span>';
                tag = '−';
            } else {
                oldHtml = escHtml(o.old || '');
                newHtml = escHtml(o.new || '');
                tag = '=';
            }
            return `<div class="label-diff-row ld-${o.type}">
                <div class="ld-tag">${tag}</div>
                <div class="ld-old">${oldHtml}</div>
                <div class="ld-new">${newHtml}</div>
            </div>`;
        }).join('');

        const headerRow = `<div class="label-diff-row" style="background:var(--bg-soft);font-weight:600;color:var(--text-faint);font-size:11px;letter-spacing:0.1em;text-transform:uppercase">
            <div class="ld-tag">类型</div>
            <div class="ld-old">原版本 (OLD)</div>
            <div class="ld-new">新版本 (NEW)</div>
        </div>`;
        $('#label-diff-table').innerHTML = headerRow + (tbody || '<div style="padding:24px;text-align:center;color:var(--text-faint)">两份内容完全一致 ✓</div>');
        $('#label-result').style.display = '';
    }

    function showProgress(msg, pct) {
        const wrap = $('#label-progress');
        if (!wrap) return;
        wrap.style.display = '';
        $('#label-progress-label').textContent = msg;
        $('#label-progress-fill').style.width = pct + '%';
    }
    function hideProgress() {
        const wrap = $('#label-progress');
        if (wrap) wrap.style.display = 'none';
    }

    function clearAll() {
        oldFile = null; newFile = null;
        oldLines = []; newLines = [];
        const oi = $('#file-label-old'); if (oi) oi.value = '';
        const ni = $('#file-label-new'); if (ni) ni.value = '';
        $('#file-label-old-name').textContent = '未选择文件';
        $('#file-label-new-name').textContent = '未选择文件';
        $('#label-stats').style.display = 'none';
        $('#label-result').style.display = 'none';
    }

    function bindFile(inputId, labelId, target) {
        const inp = $(inputId);
        if (!inp || inp.__bound) return;
        inp.__bound = true;
        inp.addEventListener('change', e => {
            const f = e.target.files && e.target.files[0];
            if (!f) return;
            if (!/\.pdf$/i.test(f.name)) { alert('只支持 PDF 文件'); inp.value = ''; return; }
            if (target === 'old') oldFile = f; else newFile = f;
            $(labelId).textContent = f.name + ' · ' + (f.size / 1024).toFixed(1) + ' KB';
        });
    }

    function init() {
        initTabs();
        bindFile('#file-label-old', '#file-label-old-name', 'old');
        bindFile('#file-label-new', '#file-label-new-name', 'new');
        const btn = $('#btn-label-compare');
        if (btn && !btn.__bound) { btn.__bound = true; btn.addEventListener('click', runCompare); }
        const clr = $('#btn-label-clear');
        if (clr && !clr.__bound) { clr.__bound = true; clr.addEventListener('click', clearAll); }
    }

    // 暴露给 gotoPage
    window.initLabelDiff = init;
    init();
})();
