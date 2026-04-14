// ============================================================
// 文件格式转换模块
// ============================================================

(function () {
    'use strict';

    function $(sel) { return document.querySelector(sel); }
    function $$(sel) { return document.querySelectorAll(sel); }
    function escHtml(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

    let inputFiles = []; // [{ id, file, type }]

    // ---- 类型检测 ----
    function detectType(file) {
        const name = file.name.toLowerCase();
        if (/\.pdf$/.test(name)) return 'pdf';
        if (/\.xlsx?$/.test(name)) return 'excel';
        if (/\.(png|jpe?g|gif|bmp|webp)$/.test(name)) return 'image';
        if (/\.txt$/.test(name)) return 'text';
        if (/\.csv$/.test(name)) return 'csv';
        if (/\.zip$/.test(name)) return 'zip';
        return 'unknown';
    }

    const TYPE_LABELS = {
        pdf: 'PDF', excel: 'Excel', image: '图片', text: '文本',
        csv: 'CSV', zip: 'ZIP', unknown: '未知'
    };
    const TYPE_COLORS = {
        pdf: '#ef4444', excel: '#10b981', image: '#3b82f6',
        text: '#8b5cf6', csv: '#f59e0b', zip: '#06b6d4', unknown: '#94a3b8'
    };

    // ---- 转换矩阵 ----
    const CONVERSIONS = {
        pdf: [
            { key: 'pdf-to-png', label: 'PDF → PNG 图片（每页一张）', out: 'png' },
            { key: 'pdf-to-jpg', label: 'PDF → JPG 图片（每页一张）', out: 'jpg' },
            { key: 'pdf-to-txt', label: 'PDF → 文本 (.txt)', out: 'txt' },
            { key: 'pdf-to-excel', label: 'PDF → Excel（智能列对齐）', out: 'xlsx' },
        ],
        excel: [
            { key: 'excel-to-csv', label: 'Excel → CSV', out: 'csv' },
            { key: 'excel-to-json', label: 'Excel → JSON', out: 'json' },
            { key: 'excel-to-html', label: 'Excel → HTML', out: 'html' },
            { key: 'excel-to-pdf', label: 'Excel → PDF（渲染表格）', out: 'pdf' },
            { key: 'excel-to-word', label: 'Excel → Word (.doc)', out: 'doc' },
        ],
        image: [
            { key: 'image-to-png', label: '图片 → PNG', out: 'png' },
            { key: 'image-to-jpg', label: '图片 → JPG', out: 'jpg' },
            { key: 'image-to-webp', label: '图片 → WebP', out: 'webp' },
            { key: 'images-to-pdf', label: '多张图片 → 合并为 PDF', out: 'pdf', multi: true },
        ],
        text: [
            { key: 'text-to-pdf', label: '文本 → PDF', out: 'pdf' },
        ],
        csv: [
            { key: 'csv-to-excel', label: 'CSV → Excel', out: 'xlsx' },
            { key: 'csv-to-json', label: 'CSV → JSON', out: 'json' },
        ],
        zip: [
            { key: 'zip-extract', label: 'ZIP → 解压（提取内容清单）', out: 'txt' },
        ],
    };

    // 多文件通用转换
    const MULTI_CONVERSIONS = [
        { key: 'files-to-zip', label: '所有文件 → 打包为 ZIP', out: 'zip' },
    ];

    // ============================================================
    // 库可用性检测
    // ============================================================
    function hasJSZip() { return typeof JSZip !== 'undefined'; }
    function hasJsPDF() { return typeof window.jspdf !== 'undefined' && typeof window.jspdf.jsPDF === 'function'; }

    // ============================================================
    // 通用工具函数
    // ============================================================
    function canvasToBlob(canvas, format, quality) {
        return new Promise(resolve => {
            const mime = (format === 'jpg' || format === 'jpeg') ? 'image/jpeg' :
                format === 'webp' ? 'image/webp' : 'image/png';
            canvas.toBlob(resolve, mime, quality || 0.92);
        });
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    function readFileAsArrayBuffer(file) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = e => resolve(e.target.result);
            r.onerror = () => reject(new Error('读取文件失败'));
            r.readAsArrayBuffer(file);
        });
    }

    function readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = e => resolve(e.target.result);
            r.onerror = () => reject(new Error('读取文件失败'));
            r.readAsText(file);
        });
    }

    function readFileAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = e => resolve(e.target.result);
            r.onerror = () => reject(new Error('读取文件失败'));
            r.readAsDataURL(file);
        });
    }

    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('图片加载失败'));
            img.src = src;
        });
    }

    // 把二维数组表格渲染到 canvas（支持中文）
    function renderTableToCanvas(rows, options) {
        options = options || {};
        const fontSize = options.fontSize || 12;
        const cellPadding = 6;
        const rowHeight = fontSize + cellPadding * 2;
        const maxColWidth = 200;

        if (!rows || rows.length === 0) rows = [['(空)']];
        const colCount = rows.reduce((m, r) => Math.max(m, r.length), 1);

        // 测量列宽
        const tmpCanvas = document.createElement('canvas');
        const tmpCtx = tmpCanvas.getContext('2d');
        tmpCtx.font = `${fontSize}px sans-serif`;

        const colWidths = new Array(colCount).fill(40);
        rows.forEach(row => {
            for (let i = 0; i < colCount; i++) {
                const text = String(row[i] == null ? '' : row[i]).substring(0, 80);
                const w = tmpCtx.measureText(text).width + cellPadding * 2;
                if (w > colWidths[i]) colWidths[i] = w;
            }
        });
        colWidths.forEach((w, i) => { if (w > maxColWidth) colWidths[i] = maxColWidth; });

        const totalWidth = colWidths.reduce((a, b) => a + b, 0);
        const totalHeight = rows.length * rowHeight;

        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(totalWidth + 2);
        canvas.height = Math.ceil(totalHeight + 2);
        const ctx = canvas.getContext('2d');

        // 背景
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 绘制单元格
        let y = 1;
        rows.forEach((row, rowIdx) => {
            let x = 1;
            // 表头背景
            if (rowIdx === 0) {
                ctx.fillStyle = '#f3f4f6';
                ctx.fillRect(x, y, totalWidth, rowHeight);
            }

            for (let i = 0; i < colCount; i++) {
                const w = colWidths[i];
                // 边框
                ctx.strokeStyle = '#d1d5db';
                ctx.lineWidth = 1;
                ctx.strokeRect(x, y, w, rowHeight);

                // 文字
                const cell = row[i] == null ? '' : String(row[i]);
                const maxChars = Math.floor((w - cellPadding * 2) / (fontSize * 0.6));
                const display = cell.length > maxChars ? cell.substring(0, maxChars - 1) + '…' : cell;
                ctx.fillStyle = rowIdx === 0 ? '#1e293b' : '#374151';
                ctx.font = `${rowIdx === 0 ? 'bold ' : ''}${fontSize}px sans-serif`;
                ctx.textBaseline = 'middle';
                ctx.fillText(display, x + cellPadding, y + rowHeight / 2);
                x += w;
            }
            y += rowHeight;
        });

        return canvas;
    }

    // 把长文本渲染到 canvas
    function renderTextToCanvas(text, width) {
        width = width || 800;
        const fontSize = 14;
        const lineHeight = 22;
        const padding = 20;

        const lines = [];
        const rawLines = text.split(/\r?\n/);
        const tmpCanvas = document.createElement('canvas');
        const tmpCtx = tmpCanvas.getContext('2d');
        tmpCtx.font = `${fontSize}px sans-serif`;
        const maxLineWidth = width - padding * 2;

        rawLines.forEach(rawLine => {
            if (!rawLine) { lines.push(''); return; }
            let current = '';
            for (const ch of rawLine) {
                const test = current + ch;
                if (tmpCtx.measureText(test).width > maxLineWidth) {
                    lines.push(current);
                    current = ch;
                } else {
                    current = test;
                }
            }
            if (current) lines.push(current);
        });

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = Math.max(lines.length * lineHeight + padding * 2, 100);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#1e293b';
        ctx.font = `${fontSize}px sans-serif`;
        ctx.textBaseline = 'top';
        lines.forEach((line, i) => {
            ctx.fillText(line, padding, padding + i * lineHeight);
        });
        return canvas;
    }

    // 把 canvas（可能很长）分页添加到 jsPDF
    function addCanvasToPdf(pdf, canvas, firstPage) {
        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();
        const margin = 8;
        const targetW = pageW - margin * 2;
        const scale = targetW / canvas.width;
        const scaledH = canvas.height * scale;

        if (scaledH <= pageH - margin * 2) {
            // 单页
            if (!firstPage) pdf.addPage();
            const imgData = canvas.toDataURL('image/png');
            pdf.addImage(imgData, 'PNG', margin, margin, targetW, scaledH);
            return;
        }

        // 分页：按像素切分
        const pxPerPage = Math.floor((pageH - margin * 2) / scale);
        let yOffset = 0;
        let first = firstPage;
        while (yOffset < canvas.height) {
            const sliceH = Math.min(pxPerPage, canvas.height - yOffset);
            const slice = document.createElement('canvas');
            slice.width = canvas.width;
            slice.height = sliceH;
            slice.getContext('2d').drawImage(canvas, 0, yOffset, canvas.width, sliceH, 0, 0, canvas.width, sliceH);

            if (!first) pdf.addPage();
            first = false;
            const imgData = slice.toDataURL('image/png');
            pdf.addImage(imgData, 'PNG', margin, margin, targetW, sliceH * scale);
            yOffset += sliceH;
        }
    }

    // ============================================================
    // 转换函数
    // ============================================================

    // ---- PDF 系列 ----
    async function pdfToImages(file, format) {
        const ab = await readFileAsArrayBuffer(file);
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(ab) }).promise;
        const baseName = file.name.replace(/\.pdf$/i, '');

        if (pdf.numPages === 1) {
            const canvas = await renderPdfPage(pdf, 1);
            const blob = await canvasToBlob(canvas, format);
            return { blob, filename: `${baseName}.${format}` };
        }

        if (!hasJSZip()) throw new Error('需要 JSZip 库支持批量图片打包');

        const zip = new JSZip();
        for (let i = 1; i <= pdf.numPages; i++) {
            setProgress(Math.round((i / pdf.numPages) * 90));
            const canvas = await renderPdfPage(pdf, i);
            const blob = await canvasToBlob(canvas, format);
            zip.file(`${baseName}_p${String(i).padStart(3, '0')}.${format}`, blob);
        }
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        return { blob: zipBlob, filename: `${baseName}_pages_${format}.zip` };
    }

    async function renderPdfPage(pdf, pageNum, scale) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: scale || 2 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        return canvas;
    }

    async function pdfToText(file) {
        const ab = await readFileAsArrayBuffer(file);
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(ab) }).promise;
        let out = '';
        for (let i = 1; i <= pdf.numPages; i++) {
            setProgress(Math.round((i / pdf.numPages) * 90));
            const page = await pdf.getPage(i);
            const tc = await page.getTextContent();
            out += `\n===== 第 ${i} 页 =====\n`;
            // 按 Y 坐标分组成行
            const items = tc.items.map(it => ({ str: it.str, x: it.transform[4], y: Math.round(it.transform[5]) }));
            items.sort((a, b) => b.y - a.y || a.x - b.x);
            let curY = null, line = [];
            items.forEach(it => {
                if (curY == null || Math.abs(it.y - curY) > 5) {
                    if (line.length) out += line.join(' ') + '\n';
                    line = [it.str];
                    curY = it.y;
                } else {
                    line.push(it.str);
                }
            });
            if (line.length) out += line.join(' ') + '\n';
        }
        const blob = new Blob(['\uFEFF' + out], { type: 'text/plain;charset=utf-8' });
        return { blob, filename: file.name.replace(/\.pdf$/i, '.txt') };
    }

    async function pdfToExcel(file) {
        const ab = await readFileAsArrayBuffer(file);
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(ab) }).promise;

        const wb = XLSX.utils.book_new();
        for (let i = 1; i <= pdf.numPages; i++) {
            setProgress(Math.round((i / pdf.numPages) * 90));
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 1 });
            const tc = await page.getTextContent();

            // 过滤空白文本，保留位置信息
            const items = tc.items
                .filter(it => it.str && it.str.trim())
                .map(it => ({
                    str: it.str.trim(),
                    x: it.transform[4],
                    y: it.transform[5],
                    width: it.width || 0,
                    // 字体大小：transform[3] 是 y 方向缩放，通常等于字号
                    height: Math.abs(it.transform[3]) || it.height || 10,
                }));

            if (items.length === 0) {
                const emptySheet = XLSX.utils.aoa_to_sheet([['(本页无文本)']]);
                XLSX.utils.book_append_sheet(wb, emptySheet, `第${i}页`.substring(0, 31));
                continue;
            }

            // 估算字号和字符宽度
            const avgHeight = items.reduce((s, it) => s + it.height, 0) / items.length;
            const charWidthSamples = items
                .filter(it => it.str.length > 1 && it.width > 0)
                .map(it => it.width / it.str.length);
            const avgCharWidth = charWidthSamples.length > 0
                ? charWidthSamples.reduce((a, b) => a + b, 0) / charWidthSamples.length
                : avgHeight * 0.5;

            // 行容差：约半个字高。列容差：取字符宽度和页宽的综合
            const yTol = Math.max(avgHeight * 0.6, 3);
            const xTol = Math.max(avgCharWidth * 2.5, viewport.width * 0.012, 6);

            // ---- 按 Y 坐标分组成行（PDF 坐标系 Y 从下往上增大）----
            items.sort((a, b) => b.y - a.y);
            const rowGroups = [];
            let currentRow = null;
            items.forEach(it => {
                if (!currentRow || Math.abs(it.y - currentRow.baseY) > yTol) {
                    currentRow = { baseY: it.y, items: [it] };
                    rowGroups.push(currentRow);
                } else {
                    currentRow.items.push(it);
                }
            });

            // 每行按 X 升序
            rowGroups.forEach(row => row.items.sort((a, b) => a.x - b.x));

            // ---- 检测列位置：对所有 X 坐标聚类 ----
            // 锚定在簇首，避免连锁漂移
            const allX = [];
            rowGroups.forEach(row => row.items.forEach(it => allX.push(it.x)));
            allX.sort((a, b) => a - b);

            const columns = [];
            let clusterAnchor = null;
            allX.forEach(x => {
                if (clusterAnchor === null || x - clusterAnchor > xTol) {
                    columns.push(x);
                    clusterAnchor = x;
                }
            });

            // ---- 优化：用每个簇内所有点的中位数作为列代表 X（更稳健）----
            const colRepX = columns.map((startX, ci) => {
                const nextStartX = columns[ci + 1] != null ? columns[ci + 1] : Infinity;
                const xsInCol = allX.filter(x => x >= startX && x < nextStartX);
                if (xsInCol.length === 0) return startX;
                xsInCol.sort((a, b) => a - b);
                return xsInCol[Math.floor(xsInCol.length / 2)];
            });

            // ---- 查找 X 最接近的列 ----
            function findColumn(x) {
                let bestIdx = 0;
                let bestDist = Math.abs(x - colRepX[0]);
                for (let c = 1; c < colRepX.length; c++) {
                    const d = Math.abs(x - colRepX[c]);
                    if (d < bestDist) { bestDist = d; bestIdx = c; }
                }
                return bestIdx;
            }

            // ---- 构建网格 ----
            const grid = rowGroups.map(row => {
                const rowData = new Array(colRepX.length).fill('');
                row.items.forEach(it => {
                    const colIdx = findColumn(it.x);
                    // 同列多个文本段：用空格拼接
                    if (rowData[colIdx]) {
                        rowData[colIdx] += ' ' + it.str;
                    } else {
                        rowData[colIdx] = it.str;
                    }
                });
                return rowData;
            });

            // ---- 删除完全空的尾列（噪声）----
            while (grid.length > 0 && grid[0].length > 0) {
                const lastCol = grid[0].length - 1;
                const allEmpty = grid.every(row => !row[lastCol]);
                if (allEmpty) {
                    grid.forEach(row => row.pop());
                    colRepX.pop();
                } else break;
            }

            if (grid.length === 0 || grid[0].length === 0) {
                const emptySheet = XLSX.utils.aoa_to_sheet([['(本页无有效文本)']]);
                XLSX.utils.book_append_sheet(wb, emptySheet, `第${i}页`.substring(0, 31));
                continue;
            }

            const sheet = XLSX.utils.aoa_to_sheet(grid);

            // ---- 根据内容自动设置列宽 ----
            const colWidths = colRepX.map((_, ci) => {
                let maxLen = 6;
                grid.forEach(row => {
                    const v = row[ci] || '';
                    // 中文字符按 2 计算宽度
                    let w = 0;
                    for (const ch of v) w += /[\u4e00-\u9fa5\uff00-\uffef]/.test(ch) ? 2 : 1;
                    if (w > maxLen) maxLen = w;
                });
                return { wch: Math.min(maxLen + 2, 50) };
            });
            sheet['!cols'] = colWidths;

            XLSX.utils.book_append_sheet(wb, sheet, `第${i}页`.substring(0, 31));
        }
        const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        return { blob, filename: file.name.replace(/\.pdf$/i, '.xlsx') };
    }

    // ---- Excel 系列 ----
    async function excelToCsv(file) {
        const ab = await readFileAsArrayBuffer(file);
        const wb = XLSX.read(new Uint8Array(ab), { type: 'array' });

        if (wb.SheetNames.length === 1) {
            const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
            const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
            return { blob, filename: file.name.replace(/\.xlsx?$/i, '.csv') };
        }

        if (!hasJSZip()) throw new Error('多工作表导出需要 JSZip 库');
        const zip = new JSZip();
        wb.SheetNames.forEach(name => {
            const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
            zip.file(`${name}.csv`, '\uFEFF' + csv);
        });
        const blob = await zip.generateAsync({ type: 'blob' });
        return { blob, filename: file.name.replace(/\.xlsx?$/i, '_csv.zip') };
    }

    async function excelToJson(file) {
        const ab = await readFileAsArrayBuffer(file);
        const wb = XLSX.read(new Uint8Array(ab), { type: 'array' });
        const result = {};
        wb.SheetNames.forEach(name => {
            result[name] = XLSX.utils.sheet_to_json(wb.Sheets[name]);
        });
        const json = JSON.stringify(result, null, 2);
        const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
        return { blob, filename: file.name.replace(/\.xlsx?$/i, '.json') };
    }

    async function excelToHtml(file) {
        const ab = await readFileAsArrayBuffer(file);
        const wb = XLSX.read(new Uint8Array(ab), { type: 'array' });
        let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escHtml(file.name)}</title>
<style>body{font-family:sans-serif;padding:20px}h2{margin:20px 0 8px}table{border-collapse:collapse;margin-bottom:20px}td,th{border:1px solid #d1d5db;padding:6px 10px;font-size:13px}th{background:#f3f4f6}</style>
</head><body>`;
        wb.SheetNames.forEach(name => {
            html += `<h2>${escHtml(name)}</h2>`;
            html += XLSX.utils.sheet_to_html(wb.Sheets[name], { editable: false, header: '' });
        });
        html += '</body></html>';
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        return { blob, filename: file.name.replace(/\.xlsx?$/i, '.html') };
    }

    async function excelToPdf(file) {
        if (!hasJsPDF()) throw new Error('需要 jsPDF 库支持 PDF 生成');

        const ab = await readFileAsArrayBuffer(file);
        const wb = XLSX.read(new Uint8Array(ab), { type: 'array' });
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

        let first = true;
        wb.SheetNames.forEach((name, idx) => {
            setProgress(Math.round(((idx + 1) / wb.SheetNames.length) * 90));
            const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
            const canvas = renderTableToCanvas(rows);
            addCanvasToPdf(pdf, canvas, first);
            first = false;
        });

        const blob = pdf.output('blob');
        return { blob, filename: file.name.replace(/\.xlsx?$/i, '.pdf') };
    }

    async function excelToWord(file) {
        // Word 可以打开 HTML 文件，用 .doc 扩展名即可
        const ab = await readFileAsArrayBuffer(file);
        const wb = XLSX.read(new Uint8Array(ab), { type: 'array' });

        let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${escHtml(file.name)}</title>
<style>body{font-family:"Microsoft YaHei",sans-serif}h2{margin-top:20pt}table{border-collapse:collapse}td,th{border:1px solid #666;padding:4pt 8pt;font-size:10pt}th{background:#e5e7eb}</style>
</head><body>`;
        wb.SheetNames.forEach(name => {
            html += `<h2>${escHtml(name)}</h2>`;
            const htmlStr = XLSX.utils.sheet_to_html(wb.Sheets[name], { editable: false, header: '' });
            // XLSX sheet_to_html 返回完整的 html 文档，只取 table 部分
            const m = htmlStr.match(/<table[\s\S]*<\/table>/i);
            html += m ? m[0] : htmlStr;
        });
        html += '</body></html>';

        const blob = new Blob(['\uFEFF', html], { type: 'application/msword;charset=utf-8' });
        return { blob, filename: file.name.replace(/\.xlsx?$/i, '.doc') };
    }

    // ---- 图片系列 ----
    async function imageConvert(file, format) {
        const dataUrl = await readFileAsDataURL(file);
        const img = await loadImage(dataUrl);
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        // JPG 不支持透明，先填白
        if (format === 'jpg' || format === 'jpeg') {
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(img, 0, 0);
        const blob = await canvasToBlob(canvas, format);
        const baseName = file.name.replace(/\.[^.]+$/, '');
        return { blob, filename: `${baseName}.${format}` };
    }

    async function imagesToPdf(files) {
        if (!hasJsPDF()) throw new Error('需要 jsPDF 库支持 PDF 生成');
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();
        const margin = 10;

        for (let i = 0; i < files.length; i++) {
            setProgress(Math.round(((i + 1) / files.length) * 90));
            const dataUrl = await readFileAsDataURL(files[i]);
            const img = await loadImage(dataUrl);

            // 计算等比缩放
            const availW = pageW - margin * 2;
            const availH = pageH - margin * 2;
            const ratio = Math.min(availW / img.naturalWidth, availH / img.naturalHeight);
            const w = img.naturalWidth * ratio;
            const h = img.naturalHeight * ratio;
            const x = (pageW - w) / 2;
            const y = (pageH - h) / 2;

            if (i > 0) pdf.addPage();
            // 判断图片格式
            const name = files[i].name.toLowerCase();
            const isJpg = /\.jpe?g$/.test(name);
            pdf.addImage(dataUrl, isJpg ? 'JPEG' : 'PNG', x, y, w, h);
        }
        const blob = pdf.output('blob');
        return { blob, filename: files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '.pdf') : 'images_combined.pdf' };
    }

    // ---- 文本系列 ----
    async function textToPdf(file) {
        if (!hasJsPDF()) throw new Error('需要 jsPDF 库支持 PDF 生成');
        const text = await readFileAsText(file);
        const canvas = renderTextToCanvas(text, 800);

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
        addCanvasToPdf(pdf, canvas, true);
        const blob = pdf.output('blob');
        return { blob, filename: file.name.replace(/\.txt$/i, '.pdf') };
    }

    // ---- CSV 系列 ----
    async function csvToExcel(file) {
        const text = await readFileAsText(file);
        const wb = XLSX.read(text, { type: 'string' });
        const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        return { blob, filename: file.name.replace(/\.csv$/i, '.xlsx') };
    }

    async function csvToJson(file) {
        const text = await readFileAsText(file);
        const wb = XLSX.read(text, { type: 'string' });
        const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
        return { blob, filename: file.name.replace(/\.csv$/i, '.json') };
    }

    // ---- ZIP 系列 ----
    async function zipExtractList(file) {
        if (!hasJSZip()) throw new Error('需要 JSZip 库');
        const ab = await readFileAsArrayBuffer(file);
        const zip = await JSZip.loadAsync(ab);
        let list = `ZIP 文件内容清单：${file.name}\n生成时间：${new Date().toLocaleString()}\n${'='.repeat(60)}\n\n`;
        let totalSize = 0, fileCount = 0;
        zip.forEach((path, entry) => {
            if (!entry.dir) {
                fileCount++;
                const size = entry._data ? entry._data.uncompressedSize : 0;
                totalSize += size;
                list += `${path}  (${(size / 1024).toFixed(1)} KB)\n`;
            } else {
                list += `${path}  [目录]\n`;
            }
        });
        list += `\n${'='.repeat(60)}\n总计 ${fileCount} 个文件，约 ${(totalSize / 1024 / 1024).toFixed(2)} MB`;
        const blob = new Blob(['\uFEFF' + list], { type: 'text/plain;charset=utf-8' });
        return { blob, filename: file.name.replace(/\.zip$/i, '_contents.txt') };
    }

    // ---- 多文件打包 ----
    async function filesToZip(files) {
        if (!hasJSZip()) throw new Error('需要 JSZip 库');
        const zip = new JSZip();
        for (let i = 0; i < files.length; i++) {
            setProgress(Math.round(((i + 1) / files.length) * 90));
            zip.file(files[i].name, files[i]);
        }
        const blob = await zip.generateAsync({ type: 'blob' });
        return { blob, filename: `files_${new Date().toISOString().slice(0, 10)}.zip` };
    }

    // ============================================================
    // 转换调度
    // ============================================================
    async function runConversion(conversionKey) {
        const files = inputFiles.map(f => f.file);
        if (files.length === 0) throw new Error('请先上传文件');

        switch (conversionKey) {
            // PDF
            case 'pdf-to-png': return pdfToImages(files[0], 'png');
            case 'pdf-to-jpg': return pdfToImages(files[0], 'jpg');
            case 'pdf-to-txt': return pdfToText(files[0]);
            case 'pdf-to-excel': return pdfToExcel(files[0]);
            // Excel
            case 'excel-to-csv': return excelToCsv(files[0]);
            case 'excel-to-json': return excelToJson(files[0]);
            case 'excel-to-html': return excelToHtml(files[0]);
            case 'excel-to-pdf': return excelToPdf(files[0]);
            case 'excel-to-word': return excelToWord(files[0]);
            // Image
            case 'image-to-png': return imageConvert(files[0], 'png');
            case 'image-to-jpg': return imageConvert(files[0], 'jpg');
            case 'image-to-webp': return imageConvert(files[0], 'webp');
            case 'images-to-pdf': return imagesToPdf(files);
            // Text
            case 'text-to-pdf': return textToPdf(files[0]);
            // CSV
            case 'csv-to-excel': return csvToExcel(files[0]);
            case 'csv-to-json': return csvToJson(files[0]);
            // ZIP
            case 'zip-extract': return zipExtractList(files[0]);
            // Multi
            case 'files-to-zip': return filesToZip(files);
            default: throw new Error('未知的转换类型');
        }
    }

    // ============================================================
    // UI
    // ============================================================
    function handleFilesUpload(fileList) {
        const files = Array.from(fileList);
        files.forEach(file => {
            inputFiles.push({
                id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                file,
                type: detectType(file),
            });
        });
        renderFileList();
        updateConversions();
    }

    function renderFileList() {
        const container = $('#convert-file-list');
        if (!container) return;

        if (inputFiles.length === 0) {
            container.innerHTML = '<div class="empty-state" style="padding:20px">尚未上传文件</div>';
            return;
        }

        let html = '<div class="convert-file-grid">';
        inputFiles.forEach(item => {
            const color = TYPE_COLORS[item.type];
            const label = TYPE_LABELS[item.type];
            const size = (item.file.size / 1024).toFixed(1) + ' KB';
            html += `<div class="convert-file-item">
                <span class="convert-file-tag" style="background:${color}">${label}</span>
                <div class="convert-file-info">
                    <div class="convert-file-name" title="${escHtml(item.file.name)}">${escHtml(item.file.name)}</div>
                    <div class="convert-file-size">${size}</div>
                </div>
                <button class="chip-remove" data-id="${item.id}" title="移除">&times;</button>
            </div>`;
        });
        html += '</div>';
        container.innerHTML = html;

        container.querySelectorAll('.chip-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.target.dataset.id;
                inputFiles = inputFiles.filter(f => f.id !== id);
                renderFileList();
                updateConversions();
            });
        });
    }

    function updateConversions() {
        const container = $('#conversion-options');
        if (!container) return;

        if (inputFiles.length === 0) {
            container.innerHTML = '<div class="empty-state" style="padding:20px">上传文件后将显示可用的转换选项</div>';
            $('#btn-do-convert').disabled = true;
            return;
        }

        const types = [...new Set(inputFiles.map(f => f.type))];
        let options = [];

        if (types.length === 1 && types[0] !== 'unknown') {
            const typeOptions = CONVERSIONS[types[0]] || [];
            // 单文件场景下，过滤掉要求多文件的选项
            options.push(...typeOptions.filter(o => !o.multi || inputFiles.length > 1));
        }

        // 多文件场景下始终可以打包 ZIP
        if (inputFiles.length > 1) {
            options.push(...MULTI_CONVERSIONS);
        }

        if (options.length === 0) {
            container.innerHTML = '<div class="empty-state" style="padding:20px">此组合的文件暂无可用转换（混合类型文件只能打包 ZIP，请上传至少 2 个文件）</div>';
            $('#btn-do-convert').disabled = true;
            return;
        }

        let html = '';
        options.forEach((opt, i) => {
            html += `<label class="conversion-option">
                <input type="radio" name="conversion" value="${opt.key}" ${i === 0 ? 'checked' : ''}>
                <span class="conversion-option-label">${opt.label}</span>
                <span class="conversion-option-out">.${opt.out}</span>
            </label>`;
        });
        container.innerHTML = html;
        $('#btn-do-convert').disabled = false;
    }

    function setProgress(pct) {
        const bar = $('#convert-progress-fill');
        const wrap = $('#convert-progress');
        if (wrap) wrap.style.display = 'block';
        if (bar) bar.style.width = Math.min(pct, 100) + '%';
    }

    function hideProgress() {
        const wrap = $('#convert-progress');
        if (wrap) wrap.style.display = 'none';
    }

    async function doConvert() {
        const selected = $('input[name="conversion"]:checked');
        if (!selected) { alert('请选择转换类型'); return; }

        const convertBtn = $('#btn-do-convert');
        convertBtn.disabled = true;
        convertBtn.textContent = '转换中...';
        setProgress(5);

        try {
            const result = await runConversion(selected.value);
            setProgress(100);
            downloadBlob(result.blob, result.filename);
            showResult(`已生成：${result.filename}（${(result.blob.size / 1024).toFixed(1)} KB）`);
        } catch (err) {
            alert('转换失败：' + err.message);
            console.error(err);
        } finally {
            convertBtn.disabled = false;
            convertBtn.textContent = '开始转换';
            setTimeout(hideProgress, 500);
        }
    }

    function showResult(msg) {
        const el = $('#convert-result');
        if (el) {
            el.textContent = msg;
            el.style.display = 'block';
            setTimeout(() => { el.style.display = 'none'; }, 8000);
        }
    }

    // ---- 事件绑定 ----
    function initConverter() {
        const input = $('#convert-file-input');
        if (input) input.addEventListener('change', (e) => handleFilesUpload(e.target.files));

        const dropzone = $('#convert-dropzone');
        if (dropzone) {
            ['dragenter', 'dragover'].forEach(evt => {
                dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add('drop-hover'); });
            });
            ['dragleave', 'drop'].forEach(evt => {
                dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove('drop-hover'); });
            });
            dropzone.addEventListener('drop', (e) => handleFilesUpload(e.dataTransfer.files));
        }

        const convertBtn = $('#btn-do-convert');
        if (convertBtn) convertBtn.addEventListener('click', doConvert);

        const clearBtn = $('#btn-clear-convert');
        if (clearBtn) clearBtn.addEventListener('click', () => {
            inputFiles = [];
            if (input) input.value = '';
            renderFileList();
            updateConversions();
            hideProgress();
            $('#convert-result').style.display = 'none';
        });

        renderFileList();
        updateConversions();
    }

    window.initConverterPage = function () {
        renderFileList();
        updateConversions();
    };

    initConverter();
})();
