// ============================================================
// 标牌识别 / UPC 提取
// 上传贴标 sheet 图 / PDF → Tesseract OCR → 结构化提取 → Excel
// ============================================================

(function () {
    'use strict';

    function $(s) { return document.querySelector(s); }
    function escHtml(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

    // 已知颜色词（中英法常见）
    const KNOWN_COLORS = [
        'NATURAL', 'NATUREL',
        'MULTI', 'MULTI-COLOUR', 'MULTICOLOR', 'MULTICOLORE', 'MULTI-COLOR',
        'BLUE', 'BLEU', 'BLACK', 'NOIR', 'WHITE', 'BLANC',
        'RED', 'ROUGE', 'GREEN', 'VERT', 'GREY', 'GRAY', 'GRIS',
        'NAVY', 'MARINE', 'BEIGE', 'PINK', 'ROSE',
        'YELLOW', 'JAUNE', 'BROWN', 'BRUN', 'ORANGE',
        'PURPLE', 'POURPRE', 'VIOLET', 'CHARCOAL', 'ANTHRACITE',
        'TAN', 'KHAKI', 'OLIVE', 'CREAM', 'IVORY', 'SILVER', 'GOLD',
        'BURGUNDY', 'TEAL', 'AQUA', 'CORAL', 'MAGENTA', 'CYAN',
        'HEATHER', 'STONE', 'STORM', 'MIDNIGHT',
    ];

    const SIZE_RE = [
        /^(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL)\/[A-Z]{1,4}$/,    // S/P, XL/TG
        /^(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL)$/,
        /^\d{1,2}T?$/,           // 4, 6, 12, 2T, 3T
        /^\d{1,2}-\d{1,2}$/,     // 4-6
    ];

    let currentCanvas = null;     // 已加载的预览 canvas
    let allLabels = [];           // 全部识别到的标牌

    // ---- 文件 → canvas ----
    async function ensurePdfWorker() {
        if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js 未加载');
        if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
            pdfjsLib.GlobalWorkerOptions.workerSrc =
                'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
        }
    }

    async function fileToCanvases(file, dpi) {
        if (/\.pdf$/i.test(file.name)) {
            await ensurePdfWorker();
            const ab = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(ab) }).promise;
            const out = [];
            const scale = dpi / 72;
            for (let i = 1; i <= pdf.numPages; i++) {
                const p = await pdf.getPage(i);
                const vp = p.getViewport({ scale });
                const cv = document.createElement('canvas');
                cv.width = Math.floor(vp.width);
                cv.height = Math.floor(vp.height);
                const ctx = cv.getContext('2d');
                ctx.fillStyle = '#fff';
                ctx.fillRect(0, 0, cv.width, cv.height);
                await p.render({ canvasContext: ctx, viewport: vp }).promise;
                out.push(cv);
            }
            return out;
        }
        // 图片
        const url = URL.createObjectURL(file);
        try {
            const img = await new Promise((res, rej) => {
                const i = new Image();
                i.onload = () => res(i);
                i.onerror = () => rej(new Error('图像加载失败'));
                i.src = url;
            });
            const cv = document.createElement('canvas');
            cv.width = img.naturalWidth;
            cv.height = img.naturalHeight;
            const ctx = cv.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, cv.width, cv.height);
            ctx.drawImage(img, 0, 0);
            return [cv];
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    // 增强对比 + 灰度，OCR 友好
    function preprocess(src) {
        const cv = document.createElement('canvas');
        cv.width = src.width;
        cv.height = src.height;
        const ctx = cv.getContext('2d');
        ctx.drawImage(src, 0, 0);
        const img = ctx.getImageData(0, 0, cv.width, cv.height);
        const d = img.data;
        const factor = 1.45;
        const inter = 128 * (1 - factor);
        for (let i = 0; i < d.length; i += 4) {
            const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            const v = Math.max(0, Math.min(255, g * factor + inter));
            d[i] = d[i + 1] = d[i + 2] = v;
        }
        ctx.putImageData(img, 0, 0);
        return cv;
    }

    // ---- OCR ----
    async function runTesseract(canvas) {
        if (typeof Tesseract === 'undefined') throw new Error('Tesseract.js 未加载');
        const result = await Tesseract.recognize(canvas, 'eng', {
            logger: m => {
                if (m.status === 'recognizing text') {
                    setProgress(`OCR ${(m.progress * 100).toFixed(0)}%`, 30 + m.progress * 60);
                } else if (m.status === 'loading language') {
                    setProgress('加载英文语言模型…', 12);
                } else if (m.status === 'initializing api') {
                    setProgress('初始化 OCR 引擎…', 18);
                }
            },
        });
        // 用 words；如果没有，再退到 lines/paragraphs
        const words = (result && result.data && result.data.words) || [];
        return words;
    }

    // ---- 字段判别 ----
    function classify(text) {
        const t = String(text || '').trim();
        const noWs = t.replace(/\s+/g, '');
        if (!noWs) return null;

        // UPC: 12 位数字
        if (/^\d{12}$/.test(noWs)) return { kind: 'upc', value: noWs };
        // PLU: 5–8 位 (排除 12)
        if (/^\d{5,8}$/.test(noWs)) return { kind: 'plu', value: noWs };
        // 价格: x.xx
        if (/^\$?\d{1,4}\.\d{2}$/.test(noWs)) return { kind: 'price', value: noWs.replace(/^\$/, '') };
        // 尺码
        for (const r of SIZE_RE) if (r.test(t.toUpperCase())) return { kind: 'size', value: t.toUpperCase() };
        // 颜色
        const tu = t.toUpperCase();
        for (const c of KNOWN_COLORS) {
            if (tu === c || tu.startsWith(c + '/') || tu.startsWith(c + '-')) return { kind: 'color', value: c };
        }
        return null;
    }

    function extractFields(words, pageOffsetY) {
        const f = { upcs: [], plus: [], sizes: [], colors: [], prices: [] };
        words.forEach(w => {
            const c = classify(w.text);
            if (!c) return;
            const bb = w.bbox || {};
            const cx = ((bb.x0 || 0) + (bb.x1 || 0)) / 2;
            const cy = ((bb.y0 || 0) + (bb.y1 || 0)) / 2 + (pageOffsetY || 0);
            const item = { text: c.value, x: cx, y: cy, bbox: bb };
            if (c.kind === 'upc')   f.upcs.push(item);
            else if (c.kind === 'plu')   f.plus.push(item);
            else if (c.kind === 'size')  f.sizes.push(item);
            else if (c.kind === 'color') f.colors.push(item);
            else if (c.kind === 'price') f.prices.push(item);
        });
        return f;
    }

    // ---- 标牌组合 ----
    // 算法：每张 UPC 是一张标牌的锚点；按 Y 聚簇成"行"；
    // 每行的颜色取该行 Y 范围内最近的颜色词；尺码 / PLU / 价格按相同列 (X) 找最近
    function buildLabels(fields, imgW, imgH) {
        if (!fields.upcs.length) return [];
        // 估算行高：UPC 宽度 / 列数 决定，但更稳的是相邻 Y 间距中位数
        const sortedY = fields.upcs.map(u => u.y).sort((a, b) => a - b);
        const gaps = [];
        for (let i = 1; i < sortedY.length; i++) gaps.push(sortedY[i] - sortedY[i - 1]);
        const meaningfulGap = gaps.filter(g => g > 5).sort((a, b) => a - b);
        const rowGap = meaningfulGap.length
            ? Math.max(60, meaningfulGap[Math.floor(meaningfulGap.length * 0.7)] * 0.5)
            : Math.max(60, imgH * 0.04);
        const colGap = Math.max(60, imgW * 0.04);

        // 聚簇成行
        const sorted = fields.upcs.slice().sort((a, b) => a.y - b.y);
        const rows = [];
        sorted.forEach(u => {
            const last = rows[rows.length - 1];
            if (last && Math.abs(u.y - last.y) < rowGap) {
                last.upcs.push(u);
                last.y = (last.y * (last.upcs.length - 1) + u.y) / last.upcs.length;
            } else {
                rows.push({ y: u.y, upcs: [u] });
            }
        });
        rows.forEach(r => r.upcs.sort((a, b) => a.x - b.x));

        // 每行的颜色：最靠近此行的颜色词
        const rowColors = rows.map(r => {
            let best = null, bestD = Infinity;
            fields.colors.forEach(c => {
                const d = Math.abs(c.y - r.y);
                if (d < bestD) { best = c; bestD = d; }
            });
            return (best && bestD < rowGap * 2) ? best.text : '';
        });

        const labels = [];
        rows.forEach((row, ri) => {
            row.upcs.forEach(upc => {
                const label = {
                    plu: '', upc: upc.text,
                    color: rowColors[ri] || '',
                    size: '', price: '', remark: '',
                    _row: ri,
                    _x: upc.x, _y: upc.y,
                };
                // PLU: 同列 (相近 X) 上方最近
                const pluCands = fields.plus
                    .filter(p => Math.abs(p.x - upc.x) < colGap && p.y < upc.y)
                    .sort((a, b) => (upc.y - a.y) - (upc.y - b.y));
                if (pluCands.length) label.plu = pluCands[0].text;

                // 尺码：同列下方最近
                const szCands = fields.sizes
                    .filter(s => Math.abs(s.x - upc.x) < colGap && s.y > upc.y)
                    .sort((a, b) => (a.y - upc.y) - (b.y - upc.y));
                if (szCands.length) label.size = szCands[0].text;

                // 价格：同列下方最近
                const pcCands = fields.prices
                    .filter(p => Math.abs(p.x - upc.x) < colGap && p.y > upc.y)
                    .sort((a, b) => (a.y - upc.y) - (b.y - upc.y));
                if (pcCands.length) label.price = pcCands[0].text;

                labels.push(label);
            });
        });
        return labels;
    }

    // ---- 预览：把识别到的字段框在原图上 ----
    function renderPreview(srcCanvas, fields) {
        const cv = $('#ocr-preview-canvas');
        if (!cv) return;
        const maxW = 1200;
        const ratio = Math.min(1, maxW / srcCanvas.width);
        cv.width = Math.floor(srcCanvas.width * ratio);
        cv.height = Math.floor(srcCanvas.height * ratio);
        const ctx = cv.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(srcCanvas, 0, 0, cv.width, cv.height);
        const drawBoxes = (list, color) => {
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            list.forEach(it => {
                const bb = it.bbox || {};
                if (bb.x0 == null) return;
                ctx.strokeRect(bb.x0 * ratio, bb.y0 * ratio,
                    (bb.x1 - bb.x0) * ratio, (bb.y1 - bb.y0) * ratio);
            });
        };
        drawBoxes(fields.upcs, 'rgba(200,16,46,0.9)');
        drawBoxes(fields.plus, 'rgba(217,119,87,0.9)');
        drawBoxes(fields.sizes, 'rgba(16,185,129,0.9)');
        drawBoxes(fields.colors, 'rgba(245,158,11,0.9)');
        drawBoxes(fields.prices, 'rgba(96,165,250,0.9)');
        $('#ocr-preview-section').style.display = '';
    }

    // ---- 表格 ----
    function renderTable() {
        const tb = $('#ocr-result-body');
        if (!tb) return;
        tb.innerHTML = '';
        if (allLabels.length === 0) {
            tb.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-faint);padding:24px">没识别到标牌。试试更高 DPI 或更清晰的图。</td></tr>';
            $('#ocr-result-count').textContent = '';
            return;
        }
        allLabels.forEach((l, i) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-family:monospace;color:var(--text-faint)">${i + 1}</td>
                <td><input type="text" data-i="${i}" data-f="plu"   value="${escHtml(l.plu)}"></td>
                <td><input type="text" data-i="${i}" data-f="upc"   value="${escHtml(l.upc)}"></td>
                <td><input type="text" data-i="${i}" data-f="color" value="${escHtml(l.color)}"></td>
                <td><input type="text" data-i="${i}" data-f="size"  value="${escHtml(l.size)}"></td>
                <td><input type="text" data-i="${i}" data-f="price" value="${escHtml(l.price)}" style="width:80px"></td>
                <td><input type="text" data-i="${i}" data-f="remark" value="${escHtml(l.remark)}"></td>
                <td style="text-align:center"><button class="btn-icon danger" data-rm="${i}" title="删除">&times;</button></td>
            `;
            tb.appendChild(tr);
        });
        tb.querySelectorAll('input').forEach(inp => {
            inp.addEventListener('input', e => {
                const i = Number(e.target.dataset.i);
                const f = e.target.dataset.f;
                if (allLabels[i]) allLabels[i][f] = e.target.value;
            });
        });
        tb.querySelectorAll('[data-rm]').forEach(btn => {
            btn.addEventListener('click', e => {
                const i = Number(e.currentTarget.dataset.rm);
                allLabels.splice(i, 1);
                renderTable();
            });
        });
        $('#ocr-result-count').textContent = `· 共 ${allLabels.length} 张`;
        $('#ocr-result-section').style.display = '';
        $('#btn-ocr-export-xlsx').style.display = '';
        $('#btn-ocr-add-row').style.display = '';
    }

    function addBlankRow() {
        allLabels.push({ plu: '', upc: '', color: '', size: '', price: '', remark: '' });
        renderTable();
    }

    function exportXLSX() {
        if (!allLabels.length) { alert('暂无数据可导出'); return; }
        if (typeof XLSX === 'undefined') { alert('XLSX 库未加载'); return; }
        const head = ['#', 'PLU/货号', 'UPC', '颜色 Color', '尺码 Size', '价格', '备注'];
        const rows = [head];
        allLabels.forEach((l, i) =>
            rows.push([i + 1, l.plu, l.upc, l.color, l.size, l.price, l.remark]));
        const ws = XLSX.utils.aoa_to_sheet(rows);
        // 设列宽
        ws['!cols'] = [{ wch: 4 }, { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 10 }, { wch: 10 }, { wch: 24 }];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '标牌');
        const stamp = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, `labels-${stamp}.xlsx`);
    }

    function setProgress(msg, pct) {
        const wrap = $('#ocr-progress');
        if (!wrap) return;
        wrap.style.display = '';
        $('#ocr-progress-label').textContent = msg;
        $('#ocr-progress-fill').style.width = (pct || 0) + '%';
    }
    function hideProgress() {
        const wrap = $('#ocr-progress');
        if (wrap) wrap.style.display = 'none';
    }

    let pendingFile = null;

    // ---- 主流程 ----
    async function run() {
        if (!pendingFile) { alert('请先上传一张图或 PDF'); return; }
        const dpi = Number($('#ocr-opt-dpi').value) || 220;
        const enhance = $('#ocr-opt-enhance').checked;
        try {
            setProgress('准备图像…', 5);
            const canvases = await fileToCanvases(pendingFile, dpi);
            allLabels = [];

            // 多页：拼成一张大图便于预览（垂直堆叠）；OCR 仍逐页跑
            const totalH = canvases.reduce((s, c) => s + c.height, 0);
            const maxW = canvases.reduce((m, c) => Math.max(m, c.width), 0);
            const composite = document.createElement('canvas');
            composite.width = maxW;
            composite.height = totalH;
            const cctx = composite.getContext('2d');
            cctx.fillStyle = '#fff';
            cctx.fillRect(0, 0, composite.width, composite.height);
            let yOff = 0;
            for (const c of canvases) {
                cctx.drawImage(c, 0, yOff);
                yOff += c.height;
            }
            currentCanvas = composite;

            const allFields = { upcs: [], plus: [], sizes: [], colors: [], prices: [] };
            yOff = 0;
            for (let i = 0; i < canvases.length; i++) {
                const target = enhance ? preprocess(canvases[i]) : canvases[i];
                setProgress(`识别第 ${i + 1}/${canvases.length} 页…`, 20);
                const words = await runTesseract(target);
                const f = extractFields(words, yOff);
                Object.keys(f).forEach(k => allFields[k].push(...f[k]));
                yOff += canvases[i].height;
            }

            renderPreview(composite, allFields);
            allLabels = buildLabels(allFields, composite.width, composite.height);
            // 排序：先按行 (Y)，再按列 (X)
            allLabels.sort((a, b) => (a._y - b._y) || (a._x - b._x));
            renderTable();
            hideProgress();
        } catch (e) {
            console.error(e);
            alert('识别失败：' + (e.message || e));
            hideProgress();
        }
    }

    function clearAll() {
        pendingFile = null;
        allLabels = [];
        currentCanvas = null;
        const inp = $('#ocr-file-input');
        if (inp) inp.value = '';
        $('#ocr-preview-section').style.display = 'none';
        $('#ocr-result-section').style.display = 'none';
        $('#btn-ocr-export-xlsx').style.display = 'none';
        $('#btn-ocr-add-row').style.display = 'none';
        const ddh = $('#ocr-dropzone .dropzone-text');
        if (ddh) ddh.textContent = '拖拽图片 / PDF 到这里，或';
    }

    function bindFile(file) {
        if (!file) return;
        pendingFile = file;
        const ddh = $('#ocr-dropzone .dropzone-text');
        if (ddh) ddh.textContent = `已选: ${file.name} · ${(file.size / 1024).toFixed(1)} KB`;
    }

    function init() {
        const inp = $('#ocr-file-input');
        if (inp && !inp.__bound) {
            inp.__bound = true;
            inp.addEventListener('change', e => bindFile(e.target.files && e.target.files[0]));
        }
        const dz = $('#ocr-dropzone');
        if (dz && !dz.__bound) {
            dz.__bound = true;
            ['dragenter', 'dragover'].forEach(evt =>
                dz.addEventListener(evt, e => { e.preventDefault(); dz.classList.add('drop-hover'); }));
            ['dragleave', 'drop'].forEach(evt =>
                dz.addEventListener(evt, e => { e.preventDefault(); dz.classList.remove('drop-hover'); }));
            dz.addEventListener('drop', e => bindFile(e.dataTransfer.files && e.dataTransfer.files[0]));
        }
        const runBtn = $('#btn-ocr-run');
        if (runBtn && !runBtn.__bound) { runBtn.__bound = true; runBtn.addEventListener('click', run); }
        const clrBtn = $('#btn-ocr-clear');
        if (clrBtn && !clrBtn.__bound) { clrBtn.__bound = true; clrBtn.addEventListener('click', clearAll); }
        const expBtn = $('#btn-ocr-export-xlsx');
        if (expBtn && !expBtn.__bound) { expBtn.__bound = true; expBtn.addEventListener('click', exportXLSX); }
        const addBtn = $('#btn-ocr-add-row');
        if (addBtn && !addBtn.__bound) { addBtn.__bound = true; addBtn.addEventListener('click', addBlankRow); }
    }

    window.initOcrLabelPage = init;
    init();
})();
