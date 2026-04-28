// ============================================================
// 标对比 - PDF / 图像 像素级 + 文字对比
// 默认走图像模式（render to canvas → pixel diff），文字模式作为备选
// ============================================================

(function () {
    'use strict';

    function $(s) { return document.querySelector(s); }
    function $$(s) { return document.querySelectorAll(s); }
    function escHtml(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

    let oldFile = null, newFile = null;
    let mode = 'image';     // 'image' | 'text'
    let imgViewMode = 'side'; // 'side' | 'diff' | 'overlay' | 'slider'
    let lastPages = [];     // [{old, new, diff, stats}]

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

    // ---- PDF/图片 → canvas 数组 ----
    async function ensurePdfWorker() {
        if (typeof pdfjsLib === 'undefined') throw new Error('PDF 库未加载');
        if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
            pdfjsLib.GlobalWorkerOptions.workerSrc =
                'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
        }
    }

    async function fileToCanvases(file, scale) {
        if (/\.pdf$/i.test(file.name)) {
            await ensurePdfWorker();
            const ab = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(ab) }).promise;
            const out = [];
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const vp = page.getViewport({ scale });
                const cv = document.createElement('canvas');
                cv.width = Math.floor(vp.width);
                cv.height = Math.floor(vp.height);
                const ctx = cv.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, cv.width, cv.height);
                await page.render({ canvasContext: ctx, viewport: vp }).promise;
                out.push(cv);
            }
            return out;
        }
        // 普通图片
        const dataUrl = await new Promise((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(r.result);
            r.onerror = () => rej(new Error('读图失败'));
            r.readAsDataURL(file);
        });
        const img = await new Promise((res, rej) => {
            const i = new Image();
            i.onload = () => res(i);
            i.onerror = () => rej(new Error('图像加载失败'));
            i.src = dataUrl;
        });
        const cv = document.createElement('canvas');
        cv.width = img.naturalWidth;
        cv.height = img.naturalHeight;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.drawImage(img, 0, 0);
        return [cv];
    }

    // 把 b 缩放到 a 的尺寸 (用于尺寸不一致时对齐)
    function fitToSize(canvas, w, h) {
        if (canvas.width === w && canvas.height === h) return canvas;
        const out = document.createElement('canvas');
        out.width = w; out.height = h;
        const ctx = out.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        // 等比适配
        const sa = canvas.width / canvas.height;
        const ta = w / h;
        let dw, dh, dx, dy;
        if (sa > ta) { dw = w; dh = w / sa; dx = 0; dy = (h - dh) / 2; }
        else { dh = h; dw = h * sa; dx = (w - dw) / 2; dy = 0; }
        ctx.drawImage(canvas, dx, dy, dw, dh);
        return out;
    }

    // 像素 diff: 返回 { diff: canvas, count, total }
    function diffCanvases(a, b, threshold) {
        const w = a.width, h = a.height;
        const ctxA = a.getContext('2d');
        const ctxB = b.getContext('2d');
        const dA = ctxA.getImageData(0, 0, w, h).data;
        const dB = ctxB.getImageData(0, 0, w, h).data;
        const out = document.createElement('canvas');
        out.width = w; out.height = h;
        const ctxO = out.getContext('2d');
        // 底层放半透明的 NEW 灰度图作为参考
        ctxO.globalAlpha = 0.32;
        ctxO.filter = 'grayscale(100%)';
        ctxO.drawImage(b, 0, 0);
        ctxO.globalAlpha = 1;
        ctxO.filter = 'none';
        // 红色高亮 diff 像素
        const layer = ctxO.createImageData(w, h);
        const d = layer.data;
        let count = 0;
        const t3 = threshold * 3;
        for (let i = 0; i < dA.length; i += 4) {
            const dr = dA[i] - dB[i];
            const dg = dA[i + 1] - dB[i + 1];
            const db = dA[i + 2] - dB[i + 2];
            const sum = (dr < 0 ? -dr : dr) + (dg < 0 ? -dg : dg) + (db < 0 ? -db : db);
            if (sum > t3) {
                d[i] = 255; d[i + 1] = 30; d[i + 2] = 30; d[i + 3] = 220;
                count++;
            }
        }
        // 把 diff 像素叠到 ctxO 上 (用 putImageData 会覆盖底图，所以走临时 canvas)
        const tmp = document.createElement('canvas');
        tmp.width = w; tmp.height = h;
        tmp.getContext('2d').putImageData(layer, 0, 0);
        ctxO.drawImage(tmp, 0, 0);
        return { diff: out, count, total: w * h };
    }

    function copyCanvas(src) {
        const c = document.createElement('canvas');
        c.width = src.width; c.height = src.height;
        c.getContext('2d').drawImage(src, 0, 0);
        return c;
    }

    // ---- 主流程: 图像模式 ----
    async function runImageCompare() {
        if (!oldFile || !newFile) { alert('请先选择两份文件'); return; }
        const scale = Number($('#lbl-img-scale').value) || 2;
        const tolerance = Number($('#lbl-img-tolerance').value) || 25;
        const align = $('#lbl-img-align').checked;
        try {
            showProgress('解析原版本…', 5);
            const oldList = await fileToCanvases(oldFile, scale);
            showProgress('解析新版本…', 30);
            const newList = await fileToCanvases(newFile, scale);
            showProgress('计算差异…', 65);

            const pages = Math.max(oldList.length, newList.length);
            const out = [];
            for (let i = 0; i < pages; i++) {
                const oCv = oldList[i];
                const nCv = newList[i];
                if (oCv && nCv) {
                    let a = oCv, b = nCv;
                    if (align && (a.width !== b.width || a.height !== b.height)) {
                        // 选较大者作基准
                        const W = Math.max(a.width, b.width);
                        const H = Math.max(a.height, b.height);
                        a = fitToSize(a, W, H);
                        b = fitToSize(b, W, H);
                    }
                    const d = diffCanvases(a, b, tolerance);
                    out.push({ index: i, old: a, new: b, diff: d.diff, diffCount: d.count, total: d.total, missing: false });
                } else {
                    out.push({ index: i, old: oCv || null, new: nCv || null, missing: true });
                }
                showProgress(`计算差异 ${i + 1}/${pages}…`, 65 + (i + 1) / pages * 30);
            }

            lastPages = out;
            renderImageStats(out, oldList.length, newList.length);
            renderImagePages(out);
            $('#label-img-result').style.display = '';
            $('#label-result').style.display = 'none';
            hideProgress();
        } catch (e) {
            console.error(e);
            alert('对比失败：' + (e.message || e));
            hideProgress();
        }
    }

    function renderImageStats(pages, oldN, newN) {
        let totalDiff = 0, totalPx = 0, perfect = 0;
        pages.forEach(p => {
            if (p.missing) return;
            totalDiff += p.diffCount;
            totalPx += p.total;
            if (p.diffCount === 0) perfect++;
        });
        const pct = totalPx > 0 ? (totalDiff / totalPx * 100) : 0;
        const grid = $('#label-stats-grid');
        if (!grid) return;
        const matchPctClass = pct < 0.1 ? 'ok' : pct < 1 ? 'warn' : 'err';
        grid.innerHTML = `
            <div class="stat-card"><div class="stat-label">页数</div><div class="stat-value">${pages.length} <span style="font-size:11px;color:var(--text-faint)">(旧 ${oldN} / 新 ${newN})</span></div></div>
            <div class="stat-card"><div class="stat-label">完全相同的页</div><div class="stat-value" style="color:var(--success)">${perfect}</div></div>
            <div class="stat-card"><div class="stat-label">差异像素</div><div class="stat-value" style="color:var(--primary)">${totalDiff.toLocaleString()}</div></div>
            <div class="stat-card"><div class="stat-label">差异占比</div><div class="stat-value ${matchPctClass}" style="color:${pct < 0.1 ? 'var(--success)' : pct < 1 ? 'var(--warning)' : 'var(--primary)'}">${pct.toFixed(3)}%</div></div>
        `;
        $('#label-stats').style.display = '';
    }

    function renderImagePages(pages) {
        const host = $('#label-img-pages');
        host.innerHTML = '';
        pages.forEach((p, idx) => {
            const wrap = document.createElement('div');
            wrap.className = 'label-img-page';
            const head = document.createElement('div');
            head.className = 'label-img-page-head';
            if (p.missing) {
                head.innerHTML = `<span>第 ${idx + 1} 页</span><span class="label-img-page-stat err">页数不匹配 — 仅一方有此页</span>`;
                wrap.appendChild(head);
                const cell = document.createElement('div');
                cell.className = 'label-img-cell';
                cell.style.padding = '20px';
                if (p.old) {
                    cell.appendChild(p.old);
                    cell.insertAdjacentHTML('afterbegin', '<div class="label-img-cell-label cell-old">仅在 OLD 中</div>');
                } else if (p.new) {
                    cell.appendChild(p.new);
                    cell.insertAdjacentHTML('afterbegin', '<div class="label-img-cell-label cell-new">仅在 NEW 中</div>');
                }
                wrap.appendChild(cell);
                host.appendChild(wrap);
                return;
            }

            const pct = p.total > 0 ? (p.diffCount / p.total * 100) : 0;
            const cls = pct < 0.05 ? 'ok' : pct < 0.5 ? 'warn' : 'err';
            head.innerHTML = `
                <span>第 ${idx + 1} 页 · ${p.old.width}×${p.old.height}px</span>
                <span class="label-img-page-stat ${cls}">${p.diffCount.toLocaleString()} 差异像素 / ${pct.toFixed(3)}%</span>
            `;
            wrap.appendChild(head);

            const view = document.createElement('div');
            view.className = 'label-img-view mode-' + imgViewMode;
            view.dataset.pageIdx = idx;

            // 三个 cell: old / diff / new
            const cellOld = document.createElement('div');
            cellOld.className = 'label-img-cell';
            cellOld.innerHTML = '<div class="label-img-cell-label cell-old">OLD</div>';
            cellOld.appendChild(copyCanvas(p.old));

            const cellDiff = document.createElement('div');
            cellDiff.className = 'label-img-cell cell-diff';
            cellDiff.innerHTML = '<div class="label-img-cell-label cell-diff">DIFF</div>';
            cellDiff.appendChild(copyCanvas(p.diff));

            const cellNew = document.createElement('div');
            cellNew.className = 'label-img-cell';
            cellNew.innerHTML = '<div class="label-img-cell-label cell-new">NEW</div>';
            cellNew.appendChild(copyCanvas(p.new));

            // 叠加单元（差分混合，类似 difference 滤镜）
            const cellOver = document.createElement('div');
            cellOver.className = 'label-img-cell cell-overlay';
            cellOver.innerHTML = '<div class="label-img-cell-label cell-diff">OVERLAY · DIFFERENCE</div>';
            cellOver.appendChild(copyCanvas(p.old));
            cellOver.appendChild(copyCanvas(p.new));

            // 滑动单元
            const cellSlider = document.createElement('div');
            cellSlider.className = 'label-img-cell cell-slider';
            const slider = document.createElement('div');
            slider.className = 'label-img-slider';
            slider.style.width = p.old.width + 'px';
            slider.style.maxWidth = '100%';
            slider.style.aspectRatio = (p.old.width / p.old.height).toFixed(4);
            const baseImg = copyCanvas(p.old);
            slider.appendChild(baseImg);
            const layerNew = document.createElement('div');
            layerNew.className = 'layer-new';
            const newCv = copyCanvas(p.new);
            newCv.style.width = p.old.width + 'px';
            newCv.style.maxWidth = 'none';
            newCv.style.height = 'auto';
            layerNew.appendChild(newCv);
            slider.appendChild(layerNew);
            slider.insertAdjacentHTML('beforeend', '<span class="slider-label-old">OLD</span><span class="slider-label-new">NEW</span>');
            const range = document.createElement('input');
            range.type = 'range'; range.min = '0'; range.max = '100'; range.value = '50';
            range.addEventListener('input', () => { layerNew.style.width = range.value + '%'; });
            slider.appendChild(range);
            cellSlider.appendChild(slider);

            view.appendChild(cellOld);
            view.appendChild(cellDiff);
            view.appendChild(cellNew);
            view.appendChild(cellOver);
            view.appendChild(cellSlider);
            wrap.appendChild(view);
            host.appendChild(wrap);
        });
    }

    function setImgViewMode(mode) {
        imgViewMode = mode;
        document.querySelectorAll('.label-img-view').forEach(v => {
            v.classList.remove('mode-side', 'mode-diff', 'mode-overlay', 'mode-slider');
            v.classList.add('mode-' + mode);
        });
        document.querySelectorAll('[data-img-mode]').forEach(b => {
            b.classList.toggle('active', b.dataset.imgMode === mode);
        });
    }

    // ---- 文字模式 (备用) ----
    async function extractPdfLines(file) {
        await ensurePdfWorker();
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
                    cur = [it.str]; curY = it.y;
                } else cur.push(it.str);
            });
            if (cur.length) lines.push(cur.join(' ').trim());
        }
        return lines.filter(Boolean);
    }
    function dedupAll(arr) { const s = new Set(); const o = []; for (const x of arr) if (!s.has(x)) { o.push(x); s.add(x); } return o; }
    function diffLines(A, B) {
        const m = A.length, n = B.length;
        const dp = new Array(m + 1);
        for (let i = 0; i <= m; i++) dp[i] = new Uint32Array(n + 1);
        for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
            if (A[i - 1] === B[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
            else dp[i][j] = dp[i - 1][j] >= dp[i][j - 1] ? dp[i - 1][j] : dp[i][j - 1];
        }
        const ops = []; let i = m, j = n;
        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && A[i - 1] === B[j - 1]) { ops.unshift({ type: 'same', old: A[i - 1], new: B[j - 1] }); i--; j--; }
            else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) { ops.unshift({ type: 'added', new: B[j - 1] }); j--; }
            else { ops.unshift({ type: 'removed', old: A[i - 1] }); i--; }
        }
        const merged = [];
        for (let k = 0; k < ops.length; k++) {
            const o = ops[k], next = ops[k + 1];
            if (o && next && o.type === 'removed' && next.type === 'added') { merged.push({ type: 'changed', old: o.old, new: next.new }); k++; }
            else merged.push(o);
        }
        return merged;
    }
    async function runTextCompare() {
        if (!oldFile || !newFile) { alert('请先选择两份 PDF'); return; }
        if (!/\.pdf$/i.test(oldFile.name) || !/\.pdf$/i.test(newFile.name)) {
            alert('文字模式只支持 PDF 文件，请用图像模式对比图片。'); return;
        }
        try {
            showProgress('解析旧版本…', 10);
            const a = dedupAll(await extractPdfLines(oldFile));
            showProgress('解析新版本…', 50);
            const b = dedupAll(await extractPdfLines(newFile));
            showProgress('对比中…', 85);
            const ops = diffLines(a, b);
            renderTextResult(ops);
            $('#label-img-result').style.display = 'none';
            hideProgress();
        } catch (e) {
            console.error(e);
            alert('对比失败：' + e.message);
            hideProgress();
        }
    }
    function renderTextResult(ops) {
        const stats = { same: 0, added: 0, removed: 0, changed: 0 };
        ops.forEach(o => stats[o.type]++);
        const totalDiff = stats.added + stats.removed + stats.changed;
        $('#label-stats-grid').innerHTML = `
            <div class="stat-card"><div class="stat-label">相同行</div><div class="stat-value">${stats.same}</div></div>
            <div class="stat-card"><div class="stat-label">修改</div><div class="stat-value" style="color:var(--warning)">${stats.changed}</div></div>
            <div class="stat-card"><div class="stat-label">新增</div><div class="stat-value" style="color:var(--accent)">${stats.added}</div></div>
            <div class="stat-card"><div class="stat-label">删除</div><div class="stat-value" style="color:var(--primary)">${stats.removed}</div></div>
            <div class="stat-card"><div class="stat-label">差异合计</div><div class="stat-value" style="color:${totalDiff ? 'var(--primary)' : 'var(--success)'}">${totalDiff}</div></div>
        `;
        $('#label-stats').style.display = '';
        const filtered = ops.filter(o => o.type !== 'same');
        const head = `<div class="label-diff-row" style="background:var(--bg-soft);font-weight:600;color:var(--text-faint);font-size:11px;letter-spacing:0.1em;text-transform:uppercase">
            <div class="ld-tag">类型</div><div class="ld-old">原版本 (OLD)</div><div class="ld-new">新版本 (NEW)</div></div>`;
        const body = filtered.map(o => {
            const tag = o.type === 'changed' ? '改' : o.type === 'added' ? '+' : o.type === 'removed' ? '−' : '=';
            const oldH = o.type === 'added' ? '<span style="color:var(--text-faint)">— 新增 —</span>' : escHtml(o.old || '');
            const newH = o.type === 'removed' ? '<span style="color:var(--text-faint)">— 删除 —</span>' : escHtml(o.new || '');
            return `<div class="label-diff-row ld-${o.type}"><div class="ld-tag">${tag}</div><div class="ld-old">${oldH}</div><div class="ld-new">${newH}</div></div>`;
        }).join('');
        $('#label-diff-table').innerHTML = head + (body || '<div style="padding:24px;text-align:center;color:var(--text-faint)">两份内容完全一致 ✓</div>');
        $('#label-result').style.display = '';
    }

    // ---- 共用 ----
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
        lastPages = [];
        const oi = $('#file-label-old'); if (oi) oi.value = '';
        const ni = $('#file-label-new'); if (ni) ni.value = '';
        $('#file-label-old-name').textContent = '未选择文件';
        $('#file-label-new-name').textContent = '未选择文件';
        $('#label-stats').style.display = 'none';
        $('#label-result').style.display = 'none';
        $('#label-img-result').style.display = 'none';
    }
    function bindFile(inputId, labelId, target) {
        const inp = $(inputId);
        if (!inp || inp.__bound) return;
        inp.__bound = true;
        inp.addEventListener('change', e => {
            const f = e.target.files && e.target.files[0];
            if (!f) return;
            if (target === 'old') oldFile = f; else newFile = f;
            $(labelId).textContent = f.name + ' · ' + (f.size / 1024).toFixed(1) + ' KB';
        });
    }

    function init() {
        initTabs();
        bindFile('#file-label-old', '#file-label-old-name', 'old');
        bindFile('#file-label-new', '#file-label-new-name', 'new');

        const tolRange = $('#lbl-img-tolerance');
        const tolVal = $('#lbl-img-tolerance-val');
        if (tolRange && tolVal && !tolRange.__bound) {
            tolRange.__bound = true;
            tolRange.addEventListener('input', () => { tolVal.textContent = tolRange.value; });
        }

        const btn = $('#btn-label-compare');
        if (btn && !btn.__bound) {
            btn.__bound = true;
            btn.addEventListener('click', () => {
                if (mode === 'image') runImageCompare(); else runTextCompare();
            });
        }
        const clr = $('#btn-label-clear');
        if (clr && !clr.__bound) { clr.__bound = true; clr.addEventListener('click', clearAll); }

        const toggleBtn = $('#btn-label-text-toggle');
        if (toggleBtn && !toggleBtn.__bound) {
            toggleBtn.__bound = true;
            toggleBtn.addEventListener('click', () => {
                mode = mode === 'image' ? 'text' : 'image';
                toggleBtn.textContent = mode === 'image' ? '切换至文字对比' : '切换至图像对比';
                $('#label-stats').style.display = 'none';
                $('#label-result').style.display = 'none';
                $('#label-img-result').style.display = 'none';
            });
        }

        // 图像视图模式切换
        document.querySelectorAll('[data-img-mode]').forEach(b => {
            if (b.__bound) return;
            b.__bound = true;
            b.addEventListener('click', () => setImgViewMode(b.dataset.imgMode));
        });
    }

    window.initLabelDiff = init;
    init();
})();
