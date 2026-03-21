// ============================================================
// 操作手册对比模块 - 支持 Excel / PDF / 图片
// ============================================================

(function () {
    'use strict';

    // ---- helpers ----
    function $(sel) { return document.querySelector(sel); }
    function $$(sel) { return document.querySelectorAll(sel); }
    function escHtml(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

    // ---- PDF.js worker ----
    if (typeof pdfjsLib !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    }

    // ---- 文件类型检测 ----
    const FILE_TYPES = { EXCEL: 'excel', PDF: 'pdf', IMAGE: 'image', UNKNOWN: 'unknown' };

    function detectFileType(file) {
        const name = file.name.toLowerCase();
        if (/\.xlsx?$/.test(name)) return FILE_TYPES.EXCEL;
        if (/\.pdf$/.test(name)) return FILE_TYPES.PDF;
        if (/\.(png|jpe?g|gif|bmp|webp|tiff?)$/i.test(name)) return FILE_TYPES.IMAGE;
        // 尝试用 MIME
        if (file.type.startsWith('image/')) return FILE_TYPES.IMAGE;
        if (file.type === 'application/pdf') return FILE_TYPES.PDF;
        if (file.type.includes('spreadsheet') || file.type.includes('excel')) return FILE_TYPES.EXCEL;
        return FILE_TYPES.UNKNOWN;
    }

    // ============================================================
    // 统一数据模型 — 每个文件解析为 ParsedFile
    // {
    //   type: 'excel' | 'pdf' | 'image',
    //   name: string,
    //   pages: [
    //     { label: string, textGrid?: string[][], image?: HTMLCanvasElement | HTMLImageElement }
    //   ]
    // }
    // ============================================================

    // ---- Excel 解析（含嵌入图片） ----
    function parseExcel(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = function (e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const wb = XLSX.read(data, { type: 'array', cellStyles: true });
                    const pages = wb.SheetNames.map(name => {
                        const sheet = wb.Sheets[name];
                        const textGrid = sheetToGrid(sheet);
                        // 尝试将sheet渲染为HTML图片（用于视觉对比）
                        const htmlStr = XLSX.utils.sheet_to_html(sheet);
                        const canvas = renderHtmlToCanvas(htmlStr, name);
                        return { label: name, textGrid, imagePromise: canvas };
                    });
                    // 等待所有canvas渲染完成
                    Promise.all(pages.map(p => p.imagePromise)).then(canvases => {
                        pages.forEach((p, i) => { p.image = canvases[i]; delete p.imagePromise; });
                        resolve({ type: FILE_TYPES.EXCEL, name: file.name, pages });
                    });
                } catch (err) {
                    reject(new Error('Excel 解析失败: ' + err.message));
                }
            };
            reader.readAsArrayBuffer(file);
        });
    }

    function sheetToGrid(sheet) {
        if (!sheet['!ref']) return [['']];
        const range = XLSX.utils.decode_range(sheet['!ref']);
        const grid = [];
        for (let r = range.s.r; r <= range.e.r; r++) {
            const row = [];
            for (let c = range.s.c; c <= range.e.c; c++) {
                const cell = sheet[XLSX.utils.encode_cell({ r, c })];
                row.push(cell ? cellToString(cell) : '');
            }
            grid.push(row);
        }
        return grid;
    }

    function cellToString(cell) {
        if (cell.t === 'n' && cell.w) return cell.w;
        if (cell.v === undefined || cell.v === null) return '';
        return String(cell.v);
    }

    // 将 HTML 表格渲染到离屏 canvas（用于视觉对比）
    function renderHtmlToCanvas(htmlStr, title) {
        return new Promise(resolve => {
            const iframe = document.createElement('iframe');
            iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:1200px;height:800px;border:none;';
            document.body.appendChild(iframe);
            const doc = iframe.contentDocument;
            doc.open();
            doc.write(`<!DOCTYPE html><html><head><style>
                body{margin:0;padding:16px;font-family:Arial,sans-serif;font-size:13px;background:#fff}
                table{border-collapse:collapse;width:100%}
                td,th{border:1px solid #d1d5db;padding:6px 8px;text-align:left;white-space:pre-wrap;word-break:break-all}
                th{background:#f3f4f6;font-weight:600}
            </style></head><body>${htmlStr}</body></html>`);
            doc.close();
            // 等待渲染
            setTimeout(() => {
                const body = doc.body;
                const w = Math.max(body.scrollWidth, 800);
                const h = Math.max(body.scrollHeight, 200);
                iframe.style.width = w + 'px';
                iframe.style.height = h + 'px';
                setTimeout(() => {
                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#fff';
                    ctx.fillRect(0, 0, w, h);
                    // 使用 SVG foreignObject 转换
                    const svgData = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
                        <foreignObject width="100%" height="100%">
                            <div xmlns="http://www.w3.org/1999/xhtml">${doc.documentElement.outerHTML.replace(/</g, '<').replace(/>/g, '>').replace(/&/g, '&')}</div>
                        </foreignObject>
                    </svg>`;
                    // Fallback: 画一个简单的表示
                    ctx.fillStyle = '#f8fafc';
                    ctx.fillRect(0, 0, w, h);
                    ctx.fillStyle = '#333';
                    ctx.font = '14px Arial';
                    ctx.fillText('[Excel: ' + title + ']', 16, 30);
                    // 简单绘制文本内容
                    document.body.removeChild(iframe);
                    resolve(canvas);
                }, 200);
            }, 200);
        });
    }

    // ---- PDF 解析 ----
    function parsePDF(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async function (e) {
                try {
                    const typedArray = new Uint8Array(e.target.result);
                    const pdf = await pdfjsLib.getDocument({ data: typedArray }).promise;
                    const pages = [];
                    for (let i = 1; i <= pdf.numPages; i++) {
                        const page = await pdf.getPage(i);
                        // 渲染为 canvas
                        const scale = 2;
                        const viewport = page.getViewport({ scale });
                        const canvas = document.createElement('canvas');
                        canvas.width = viewport.width;
                        canvas.height = viewport.height;
                        const ctx = canvas.getContext('2d');
                        await page.render({ canvasContext: ctx, viewport }).promise;
                        // 提取文本
                        const textContent = await page.getTextContent();
                        const textLines = extractTextLines(textContent, viewport.height);
                        pages.push({
                            label: '第 ' + i + ' 页',
                            textGrid: textLines.map(line => [line]),
                            image: canvas,
                        });
                        updateProgress(Math.round((i / pdf.numPages) * 80) + 10);
                    }
                    resolve({ type: FILE_TYPES.PDF, name: file.name, pages });
                } catch (err) {
                    reject(new Error('PDF 解析失败: ' + err.message));
                }
            };
            reader.readAsArrayBuffer(file);
        });
    }

    // 从 PDF 文本内容提取行
    function extractTextLines(textContent, pageHeight) {
        if (!textContent.items.length) return [''];
        // 按 Y 坐标分组
        const items = textContent.items.map(item => ({
            text: item.str,
            y: Math.round(item.transform[5]),
            x: item.transform[4],
        }));
        // 按 Y 分组（容差 5px）
        items.sort((a, b) => b.y - a.y || a.x - b.x);
        const lines = [];
        let currentY = null;
        let currentLine = [];
        items.forEach(item => {
            if (currentY === null || Math.abs(item.y - currentY) > 5) {
                if (currentLine.length) lines.push(currentLine.join(' '));
                currentLine = [item.text];
                currentY = item.y;
            } else {
                currentLine.push(item.text);
            }
        });
        if (currentLine.length) lines.push(currentLine.join(' '));
        return lines.length ? lines : [''];
    }

    // ---- 图片解析 ----
    function parseImage(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = function (e) {
                const img = new Image();
                img.onload = function () {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth;
                    canvas.height = img.naturalHeight;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    resolve({
                        type: FILE_TYPES.IMAGE,
                        name: file.name,
                        pages: [{ label: file.name, image: canvas, textGrid: null }],
                    });
                };
                img.onerror = () => reject(new Error('图片加载失败'));
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    // ---- 统一解析入口 ----
    async function parseFile(file) {
        const type = detectFileType(file);
        switch (type) {
            case FILE_TYPES.EXCEL: return parseExcel(file);
            case FILE_TYPES.PDF: return parsePDF(file);
            case FILE_TYPES.IMAGE: return parseImage(file);
            default: throw new Error('不支持的文件格式: ' + file.name);
        }
    }

    // ============================================================
    // 进度条
    // ============================================================
    function showProgress(label) {
        $('#compare-progress').style.display = 'block';
        $('#progress-label').textContent = label || '处理中...';
        $('#progress-fill').style.width = '0%';
    }
    function updateProgress(pct) {
        $('#progress-fill').style.width = Math.min(pct, 100) + '%';
    }
    function hideProgress() {
        $('#compare-progress').style.display = 'none';
    }

    // ============================================================
    // 上传 & 预览
    // ============================================================
    let baseFile = null;
    let compareFile = null;
    let baseParsed = null;
    let compareParsed = null;

    $('#file-base').addEventListener('change', function (e) {
        baseFile = e.target.files[0] || null;
        $('#file-base-name').textContent = baseFile ? baseFile.name : '未选择文件';
        showFilePreview(baseFile, '#preview-base');
    });

    $('#file-compare').addEventListener('change', function (e) {
        compareFile = e.target.files[0] || null;
        $('#file-compare-name').textContent = compareFile ? compareFile.name : '未选择文件';
        showFilePreview(compareFile, '#preview-compare');
    });

    function showFilePreview(file, containerSel) {
        const container = $(containerSel);
        container.innerHTML = '';
        if (!file) return;
        const type = detectFileType(file);
        const tag = document.createElement('span');
        tag.className = 'file-type-tag file-type-' + type;
        tag.textContent = { excel: 'Excel', pdf: 'PDF', image: '图片', unknown: '未知' }[type];
        container.appendChild(tag);

        // 图片缩略图预览
        if (type === FILE_TYPES.IMAGE) {
            const reader = new FileReader();
            reader.onload = function (ev) {
                const img = document.createElement('img');
                img.src = ev.target.result;
                img.className = 'upload-thumb';
                container.appendChild(img);
            };
            reader.readAsDataURL(file);
        }
    }

    // ============================================================
    // 开始对比
    // ============================================================
    $('#btn-start-compare').addEventListener('click', startCompare);
    $('#btn-clear-compare').addEventListener('click', clearCompare);

    async function startCompare() {
        if (!baseFile) { alert('请上传基准手册文件'); return; }
        if (!compareFile) { alert('请上传对比手册文件'); return; }

        showProgress('正在解析基准文件...');
        try {
            updateProgress(5);
            baseParsed = await parseFile(baseFile);
            updateProgress(40);
            $('#progress-label').textContent = '正在解析对比文件...';
            compareParsed = await parseFile(compareFile);
            updateProgress(80);

            $('#progress-label').textContent = '正在对比...';
            buildPageTabs();
            selectPage(0);
            updateProgress(100);
            setTimeout(hideProgress, 500);
        } catch (err) {
            hideProgress();
            alert(err.message);
        }
    }

    function clearCompare() {
        baseFile = null; compareFile = null;
        baseParsed = null; compareParsed = null;
        $('#file-base').value = ''; $('#file-compare').value = '';
        $('#file-base-name').textContent = '未选择文件';
        $('#file-compare-name').textContent = '未选择文件';
        $('#preview-base').innerHTML = '';
        $('#preview-compare').innerHTML = '';
        $('#compare-page-selector').style.display = 'none';
        $('#compare-stats').style.display = 'none';
        $('#compare-result-text').style.display = 'none';
        $('#compare-result-visual').style.display = 'none';
        hideProgress();
    }

    // ============================================================
    // 页面/Sheet 选择
    // ============================================================
    function buildPageTabs() {
        const maxPages = Math.max(baseParsed.pages.length, compareParsed.pages.length);
        const container = $('#page-tabs');
        container.innerHTML = '';
        for (let i = 0; i < maxPages; i++) {
            const baseLabel = (baseParsed.pages[i] || {}).label || '';
            const compLabel = (compareParsed.pages[i] || {}).label || '';
            const label = baseLabel || compLabel;
            const tab = document.createElement('button');
            tab.className = 'btn btn-sm sheet-tab' + (i === 0 ? ' sheet-tab-active' : '');
            tab.textContent = label;
            tab.dataset.index = i;
            tab.addEventListener('click', () => selectPage(i));
            container.appendChild(tab);
        }
        $('#compare-page-selector').style.display = maxPages > 1 ? 'block' : 'none';
    }

    function selectPage(index) {
        $$('.sheet-tab').forEach(t => t.classList.toggle('sheet-tab-active', +t.dataset.index === index));

        const basePage = baseParsed.pages[index] || { label: '(缺失)', textGrid: null, image: null };
        const compPage = compareParsed.pages[index] || { label: '(缺失)', textGrid: null, image: null };

        const hasText = basePage.textGrid || compPage.textGrid;
        const hasImage = basePage.image || compPage.image;

        // 统计
        renderStats(basePage, compPage);

        // 文本对比
        if (hasText) {
            renderTextCompare(basePage, compPage);
            $('#compare-result-text').style.display = 'block';
        } else {
            $('#compare-result-text').style.display = 'none';
        }

        // 视觉对比
        if (hasImage) {
            renderVisualCompare(basePage, compPage);
            $('#compare-result-visual').style.display = 'block';
        } else {
            $('#compare-result-visual').style.display = 'none';
        }
    }

    // ============================================================
    // 文本对比（Excel 单元格/PDF 文本行）
    // ============================================================
    function diffGrids(baseGrid, compGrid, opts) {
        baseGrid = baseGrid || [];
        compGrid = compGrid || [];
        const maxRows = Math.max(baseGrid.length, compGrid.length);
        const maxCols = Math.max(
            baseGrid.reduce((m, r) => Math.max(m, r.length), 0),
            compGrid.reduce((m, r) => Math.max(m, r.length), 0)
        );
        const diff = { rows: [], stats: { total: 0, same: 0, changed: 0, added: 0, removed: 0 } };

        for (let r = 0; r < maxRows; r++) {
            const bRow = baseGrid[r] || [];
            const cRow = compGrid[r] || [];
            const inBase = r < baseGrid.length;
            const inComp = r < compGrid.length;
            const cols = Math.max(bRow.length, cRow.length, maxCols);
            const rowDiff = { cells: [], hasChange: false };

            for (let c = 0; c < cols; c++) {
                let bv = bRow[c] || '';
                let cv = cRow[c] || '';
                let bvn = bv, cvn = cv;
                if (opts.ignoreWhitespace) { bvn = bvn.replace(/\s+/g, ' ').trim(); cvn = cvn.replace(/\s+/g, ' ').trim(); }
                if (opts.ignoreCase) { bvn = bvn.toLowerCase(); cvn = cvn.toLowerCase(); }

                let status;
                if (!inBase && inComp) status = 'added';
                else if (inBase && !inComp) status = 'removed';
                else if (bvn === cvn) status = 'same';
                else status = 'changed';

                if (status !== 'same') rowDiff.hasChange = true;
                rowDiff.cells.push({ baseVal: bv, compVal: cv, status });
            }
            diff.rows.push(rowDiff);
            diff.stats.total++;
            if (!rowDiff.hasChange) diff.stats.same++;
            else if (!inBase) diff.stats.added++;
            else if (!inComp) diff.stats.removed++;
            else diff.stats.changed++;
        }
        return diff;
    }

    function renderStats(basePage, compPage) {
        const grid = $('#stats-grid');
        grid.innerHTML = '';

        // 文本统计
        if (basePage.textGrid || compPage.textGrid) {
            const opts = getOpts();
            const diff = diffGrids(basePage.textGrid, compPage.textGrid, opts);
            const s = diff.stats;
            const pct = s.total > 0 ? ((s.same / s.total) * 100).toFixed(1) : '0';
            grid.innerHTML += `
                <div class="stats-card">
                    <div class="stats-title">文本对比</div>
                    <div class="stats-match-rate"><span class="stats-big-num">${pct}%</span><span class="stats-label">一致率</span></div>
                    <div class="stats-details">
                        <div class="stats-row"><span class="dot dot-same"></span>相同行: <strong>${s.same}</strong></div>
                        <div class="stats-row"><span class="dot dot-changed"></span>修改行: <strong>${s.changed}</strong></div>
                        <div class="stats-row"><span class="dot dot-added"></span>新增行: <strong>${s.added}</strong></div>
                        <div class="stats-row"><span class="dot dot-removed"></span>删除行: <strong>${s.removed}</strong></div>
                        <div class="stats-row">总行数: <strong>${s.total}</strong></div>
                    </div>
                </div>`;
        }

        // 图像统计
        if (basePage.image && compPage.image) {
            const pixelResult = pixelDiff(basePage.image, compPage.image);
            const pct = (pixelResult.matchPct).toFixed(1);
            grid.innerHTML += `
                <div class="stats-card">
                    <div class="stats-title">视觉对比</div>
                    <div class="stats-match-rate"><span class="stats-big-num">${pct}%</span><span class="stats-label">像素一致率</span></div>
                    <div class="stats-details">
                        <div class="stats-row">基准尺寸: <strong>${basePage.image.width} x ${basePage.image.height}</strong></div>
                        <div class="stats-row">对比尺寸: <strong>${compPage.image.width} x ${compPage.image.height}</strong></div>
                        <div class="stats-row"><span class="dot dot-changed"></span>差异像素: <strong>${pixelResult.diffCount.toLocaleString()}</strong></div>
                        <div class="stats-row">总像素: <strong>${pixelResult.totalPixels.toLocaleString()}</strong></div>
                    </div>
                </div>`;
        }

        $('#compare-stats').style.display = grid.innerHTML ? 'block' : 'none';
    }

    function renderTextCompare(basePage, compPage) {
        const opts = getOpts();
        const diff = diffGrids(basePage.textGrid, compPage.textGrid, opts);
        const wrapper = $('#compare-table-wrapper');
        wrapper.innerHTML = '';

        const table = document.createElement('table');
        table.className = 'compare-table';

        const maxCols = diff.rows.reduce((m, r) => Math.max(m, r.cells.length), 0);
        const thead = document.createElement('thead');
        const hr = document.createElement('tr');
        hr.innerHTML = '<th class="row-num-col">行</th>';
        for (let c = 0; c < maxCols; c++) {
            const letter = (typeof XLSX !== 'undefined') ? XLSX.utils.encode_col(c) : String(c);
            hr.innerHTML += `<th><span class="col-base">旧 ${letter}</span> / <span class="col-comp">新 ${letter}</span></th>`;
        }
        thead.appendChild(hr);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        let visibleRows = 0;
        diff.rows.forEach((rowDiff, idx) => {
            if (!opts.showAll && !rowDiff.hasChange) return;
            visibleRows++;
            const tr = document.createElement('tr');
            tr.className = rowDiff.hasChange ? 'row-changed' : 'row-same';
            tr.innerHTML = `<td class="row-num-col">${idx + 1}</td>`;
            rowDiff.cells.forEach(cell => {
                const td = document.createElement('td');
                td.className = 'compare-cell cell-' + cell.status;
                if (cell.status === 'same') {
                    td.innerHTML = `<div class="cell-val">${escHtml(cell.baseVal)}</div>`;
                } else if (cell.status === 'added') {
                    td.innerHTML = `<div class="cell-added-text">${escHtml(cell.compVal)}</div>`;
                } else if (cell.status === 'removed') {
                    td.innerHTML = `<div class="cell-removed-text">${escHtml(cell.baseVal)}</div>`;
                } else {
                    td.innerHTML = `<div class="cell-old">${escHtml(cell.baseVal)}</div><div class="cell-arrow">&darr;</div><div class="cell-new">${escHtml(cell.compVal)}</div>`;
                }
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        wrapper.appendChild(table);

        if (visibleRows === 0) {
            wrapper.innerHTML = '<div class="no-diff-msg">此页面文本内容完全一致，没有差异。</div>';
        }
    }

    function getOpts() {
        return {
            ignoreWhitespace: $('#opt-ignore-whitespace').checked,
            ignoreCase: $('#opt-ignore-case').checked,
            showAll: $('#opt-show-all').checked,
        };
    }

    // ============================================================
    // 视觉对比（图片级别）
    // ============================================================
    let currentVisualMode = 'side';
    let currentBaseCanvas = null;
    let currentCompCanvas = null;

    // 视觉模式切换
    document.addEventListener('click', function (e) {
        if (e.target.classList.contains('visual-tab')) {
            $$('.visual-tab').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            currentVisualMode = e.target.dataset.mode;
            if (currentBaseCanvas && currentCompCanvas) {
                drawVisualMode(currentBaseCanvas, currentCompCanvas);
            }
        }
    });

    function renderVisualCompare(basePage, compPage) {
        currentBaseCanvas = basePage.image;
        currentCompCanvas = compPage.image;
        // 默认并排模式
        $$('.visual-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === currentVisualMode));
        drawVisualMode(currentBaseCanvas, currentCompCanvas);
    }

    function drawVisualMode(baseCanvas, compCanvas) {
        const container = $('#visual-compare-container');
        container.innerHTML = '';

        switch (currentVisualMode) {
            case 'side': drawSideBySide(container, baseCanvas, compCanvas); break;
            case 'overlay': drawOverlay(container, baseCanvas, compCanvas); break;
            case 'diff': drawDiffHighlight(container, baseCanvas, compCanvas); break;
            case 'slider': drawSlider(container, baseCanvas, compCanvas); break;
        }
    }

    // ---- 并排模式 ----
    function drawSideBySide(container, baseCanvas, compCanvas) {
        container.className = 'visual-side-by-side';
        const leftDiv = document.createElement('div');
        leftDiv.className = 'visual-panel';
        leftDiv.innerHTML = '<div class="visual-panel-label">基准（旧）</div>';
        const leftImg = canvasToImg(baseCanvas);
        leftDiv.appendChild(leftImg);

        const rightDiv = document.createElement('div');
        rightDiv.className = 'visual-panel';
        rightDiv.innerHTML = '<div class="visual-panel-label">对比（新）</div>';
        const rightImg = canvasToImg(compCanvas);
        rightDiv.appendChild(rightImg);

        container.appendChild(leftDiv);
        container.appendChild(rightDiv);
    }

    // ---- 叠加模式 ----
    function drawOverlay(container, baseCanvas, compCanvas) {
        container.className = 'visual-overlay-wrap';
        container.innerHTML = '<div class="visual-panel-label">叠加对比 — 拖动滑块调整新手册透明度</div>';

        const w = Math.max(baseCanvas.width, compCanvas.width);
        const h = Math.max(baseCanvas.height, compCanvas.height);

        const wrap = document.createElement('div');
        wrap.className = 'overlay-canvas-wrap';
        wrap.style.maxWidth = w + 'px';

        const baseImg = canvasToImg(baseCanvas);
        baseImg.className = 'overlay-base';
        const compImg = canvasToImg(compCanvas);
        compImg.className = 'overlay-comp';
        compImg.style.opacity = '0.5';

        wrap.appendChild(baseImg);
        wrap.appendChild(compImg);
        container.appendChild(wrap);

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '0'; slider.max = '100'; slider.value = '50';
        slider.className = 'overlay-slider';
        slider.addEventListener('input', () => { compImg.style.opacity = slider.value / 100; });
        container.appendChild(slider);
    }

    // ---- 差异高亮模式 ----
    function drawDiffHighlight(container, baseCanvas, compCanvas) {
        container.className = 'visual-diff-wrap';
        container.innerHTML = '<div class="visual-panel-label">差异高亮 — 红色区域为不同之处</div>';

        const result = pixelDiff(baseCanvas, compCanvas);
        const img = canvasToImg(result.canvas);
        img.className = 'diff-result-img';
        container.appendChild(img);
    }

    // ---- 滑动对比模式 ----
    function drawSlider(container, baseCanvas, compCanvas) {
        container.className = 'visual-slider-wrap';
        container.innerHTML = '<div class="visual-panel-label">滑动对比 — 左右拖动分界线</div>';

        const w = Math.max(baseCanvas.width, compCanvas.width);
        const h = Math.max(baseCanvas.height, compCanvas.height);

        const wrap = document.createElement('div');
        wrap.className = 'slider-compare-box';

        const baseImg = canvasToImg(baseCanvas);
        baseImg.className = 'slider-img-base';
        const compImg = canvasToImg(compCanvas);
        compImg.className = 'slider-img-comp';

        const clipDiv = document.createElement('div');
        clipDiv.className = 'slider-clip';
        clipDiv.style.width = '50%';
        clipDiv.appendChild(compImg);

        const handle = document.createElement('div');
        handle.className = 'slider-handle';
        handle.innerHTML = '<div class="slider-handle-line"></div><div class="slider-handle-grip">&#8596;</div><div class="slider-handle-line"></div>';

        wrap.appendChild(baseImg);
        wrap.appendChild(clipDiv);
        wrap.appendChild(handle);
        container.appendChild(wrap);

        // 标签
        const labelBase = document.createElement('span');
        labelBase.className = 'slider-label-left';
        labelBase.textContent = '旧';
        const labelComp = document.createElement('span');
        labelComp.className = 'slider-label-right';
        labelComp.textContent = '新';
        wrap.appendChild(labelBase);
        wrap.appendChild(labelComp);

        // 拖动交互
        let dragging = false;
        function onMove(e) {
            if (!dragging) return;
            const rect = wrap.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            let x = clientX - rect.left;
            x = Math.max(0, Math.min(x, rect.width));
            const pct = (x / rect.width) * 100;
            clipDiv.style.width = pct + '%';
            handle.style.left = pct + '%';
        }
        handle.addEventListener('mousedown', () => { dragging = true; });
        handle.addEventListener('touchstart', () => { dragging = true; });
        document.addEventListener('mousemove', onMove);
        document.addEventListener('touchmove', onMove);
        document.addEventListener('mouseup', () => { dragging = false; });
        document.addEventListener('touchend', () => { dragging = false; });

        // 点击定位
        wrap.addEventListener('click', (e) => {
            const rect = wrap.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const pct = (x / rect.width) * 100;
            clipDiv.style.width = pct + '%';
            handle.style.left = pct + '%';
        });
    }

    // ============================================================
    // 像素级 Diff
    // ============================================================
    function pixelDiff(canvasA, canvasB) {
        const w = Math.max(canvasA.width, canvasB.width);
        const h = Math.max(canvasA.height, canvasB.height);

        // 归一化到相同大小
        const normA = normalizeCanvas(canvasA, w, h);
        const normB = normalizeCanvas(canvasB, w, h);

        const ctxA = normA.getContext('2d');
        const ctxB = normB.getContext('2d');
        const dataA = ctxA.getImageData(0, 0, w, h);
        const dataB = ctxB.getImageData(0, 0, w, h);

        const out = ctxA.createImageData(w, h);
        const totalPixels = w * h;
        let diffCount = 0;
        const threshold = 30; // 色差阈值

        for (let i = 0; i < dataA.data.length; i += 4) {
            const dr = Math.abs(dataA.data[i] - dataB.data[i]);
            const dg = Math.abs(dataA.data[i + 1] - dataB.data[i + 1]);
            const db = Math.abs(dataA.data[i + 2] - dataB.data[i + 2]);

            if (dr + dg + db > threshold) {
                // 差异像素标红
                out.data[i] = 255;
                out.data[i + 1] = 50;
                out.data[i + 2] = 50;
                out.data[i + 3] = 200;
                diffCount++;
            } else {
                // 相同像素灰度化
                const gray = Math.round(dataA.data[i] * 0.3 + dataA.data[i + 1] * 0.59 + dataA.data[i + 2] * 0.11);
                out.data[i] = gray;
                out.data[i + 1] = gray;
                out.data[i + 2] = gray;
                out.data[i + 3] = 180;
            }
        }

        const resultCanvas = document.createElement('canvas');
        resultCanvas.width = w;
        resultCanvas.height = h;
        resultCanvas.getContext('2d').putImageData(out, 0, 0);

        return {
            canvas: resultCanvas,
            diffCount,
            totalPixels,
            matchPct: totalPixels > 0 ? ((totalPixels - diffCount) / totalPixels) * 100 : 100,
        };
    }

    function normalizeCanvas(src, w, h) {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(src, 0, 0);
        return c;
    }

    function canvasToImg(canvas) {
        const img = document.createElement('img');
        img.src = canvas.toDataURL();
        return img;
    }

})();
