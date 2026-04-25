// ============================================================
// 文件筛查工具 - 在多个 Excel / PDF 中查找信息
// ============================================================

(function () {
    'use strict';

    function $(sel) { return document.querySelector(sel); }
    function $$(sel) { return document.querySelectorAll(sel); }
    function escHtml(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

    // 已解析的文件缓存 [{ name, kind, sheets: [{ name, rows: [[cells...]] }] }]
    // kind: 'xlsx' | 'pdf'
    let parsedFiles = [];
    let searchResults = [];

    // ---- 解析单个 Excel ----
    function parseExcel(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = function (e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const wb = XLSX.read(data, { type: 'array' });
                    const sheets = wb.SheetNames.map(name => {
                        const sheet = wb.Sheets[name];
                        const rows = sheetToRows(sheet);
                        return { name, rows };
                    });
                    resolve({ name: file.name, size: file.size, kind: 'xlsx', sheets });
                } catch (err) {
                    reject(new Error('解析 ' + file.name + ' 失败: ' + err.message));
                }
            };
            reader.onerror = () => reject(new Error('读取文件失败'));
            reader.readAsArrayBuffer(file);
        });
    }

    // ---- 解析单个 PDF ----
    async function parsePdf(file) {
        if (typeof pdfjsLib === 'undefined') {
            throw new Error('PDF 库未加载，请刷新页面');
        }
        // 设置 worker (若尚未设置)
        if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
            pdfjsLib.GlobalWorkerOptions.workerSrc =
                'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
        }
        const ab = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(ab) }).promise;
        const sheets = [];
        const Y_TOL = 3;  // px tolerance for grouping into a line
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const tc = await page.getTextContent();
            const items = tc.items
                .filter(it => it && it.str && it.str.trim())
                .map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5] }));
            // 按 Y 降序、X 升序
            items.sort((a, b) => b.y - a.y || a.x - b.x);
            const lines = [];
            let curY = null;
            let cur = [];
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
            const rows = lines.filter(Boolean).map(line => [line]);
            sheets.push({ name: '第 ' + i + ' 页', rows });
        }
        return { name: file.name, size: file.size, kind: 'pdf', sheets };
    }

    function getFileKind(name) {
        if (/\.pdf$/i.test(name)) return 'pdf';
        if (/\.xlsx?$/i.test(name)) return 'xlsx';
        return null;
    }

    function sheetToRows(sheet) {
        if (!sheet['!ref']) return [];
        const range = XLSX.utils.decode_range(sheet['!ref']);
        const rows = [];
        for (let r = range.s.r; r <= range.e.r; r++) {
            const row = [];
            for (let c = range.s.c; c <= range.e.c; c++) {
                const cell = sheet[XLSX.utils.encode_cell({ r, c })];
                if (!cell) { row.push(''); continue; }
                if (cell.w != null) row.push(cell.w);
                else if (cell.v == null) row.push('');
                else row.push(String(cell.v));
            }
            rows.push(row);
        }
        return rows;
    }

    // ---- 文件上传处理 ----
    async function handleFiles(files) {
        const fileList = Array.from(files).filter(f => getFileKind(f.name));
        if (fileList.length === 0) {
            alert('请选择 Excel (.xlsx / .xls) 或 PDF 文件');
            return;
        }

        showStatus('正在解析 ' + fileList.length + ' 个文件...');

        let successCount = 0, errorCount = 0;
        for (let i = 0; i < fileList.length; i++) {
            const file = fileList[i];
            const kind = getFileKind(file.name);
            updateStatus(`正在解析 ${i + 1}/${fileList.length}: ${file.name}`);
            try {
                // 避免重复添加
                const existing = parsedFiles.findIndex(f => f.name === file.name && f.size === file.size);
                if (existing >= 0) parsedFiles.splice(existing, 1);

                const parsed = kind === 'pdf' ? await parsePdf(file) : await parseExcel(file);
                parsedFiles.push(parsed);
                successCount++;
            } catch (err) {
                errorCount++;
                console.error(err);
            }
        }

        hideStatus();
        renderFileList();

        const statusMsg = `成功: ${successCount}${errorCount > 0 ? ', 失败: ' + errorCount : ''}`;
        $('#search-file-summary').textContent = statusMsg;

        // 自动触发搜索（若有关键字）
        if ($('#search-keyword').value.trim()) doSearch();
    }

    function renderFileList() {
        const container = $('#search-file-list');
        if (!container) return;

        if (parsedFiles.length === 0) {
            container.innerHTML = '<div class="empty-state" style="padding:20px">尚未上传任何文件</div>';
            return;
        }

        let xlsxCount = 0, pdfCount = 0;
        let totalUnits = 0, totalCells = 0;
        parsedFiles.forEach(f => {
            if (f.kind === 'pdf') pdfCount++; else xlsxCount++;
            totalUnits += f.sheets.length;
            f.sheets.forEach(s => {
                s.rows.forEach(r => totalCells += r.length);
            });
        });

        let html = `<div class="search-file-stat">
            已加载 <strong>${parsedFiles.length}</strong> 个文件 (${xlsxCount} Excel + ${pdfCount} PDF) |
            共 <strong>${totalUnits}</strong> 个工作表/页 |
            约 <strong>${totalCells.toLocaleString()}</strong> 个单元/行
        </div>`;

        html += '<div class="search-file-chips">';
        parsedFiles.forEach((f, i) => {
            const cellCount = f.sheets.reduce((s, sh) => s + sh.rows.reduce((a, r) => a + r.length, 0), 0);
            const isPdf = f.kind === 'pdf';
            const icon = isPdf ? '&#128196;' : '&#128202;';
            const unit = isPdf ? '页' : 'sh';
            html += `<span class="search-file-chip ${isPdf ? 'chip-pdf' : 'chip-xlsx'}" title="${escHtml(f.name)}\n${f.sheets.length} ${isPdf ? '页' : '工作表'} / ${cellCount} ${isPdf ? '行' : '单元格'}">
                <span class="chip-icon">${icon}</span>
                <span class="chip-name">${escHtml(f.name)}</span>
                <span class="chip-meta">${f.sheets.length}${unit}</span>
                <button class="chip-remove" data-idx="${i}" title="移除">&times;</button>
            </span>`;
        });
        html += '</div>';

        container.innerHTML = html;

        container.querySelectorAll('.chip-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                parsedFiles.splice(Number(e.target.dataset.idx), 1);
                renderFileList();
                if ($('#search-keyword').value.trim()) doSearch();
            });
        });
    }

    // ---- 搜索逻辑 ----
    function doSearch() {
        const keyword = $('#search-keyword').value.trim();
        if (!keyword) {
            searchResults = [];
            renderResults();
            return;
        }
        if (parsedFiles.length === 0) {
            alert('请先上传 Excel 文件');
            return;
        }

        const opts = {
            caseSensitive: $('#search-case-sensitive').checked,
            wholeWord: $('#search-whole-word').checked,
            useRegex: $('#search-use-regex').checked,
            showContext: $('#search-show-context').checked,
        };

        // 构建匹配函数
        let matcher;
        try {
            if (opts.useRegex) {
                const flags = opts.caseSensitive ? 'g' : 'gi';
                matcher = new RegExp(keyword, flags);
            } else {
                // 转义特殊字符
                const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const pattern = opts.wholeWord ? '\\b' + escaped + '\\b' : escaped;
                matcher = new RegExp(pattern, opts.caseSensitive ? 'g' : 'gi');
            }
        } catch (err) {
            alert('正则表达式错误: ' + err.message);
            return;
        }

        searchResults = [];
        parsedFiles.forEach(file => {
            const isPdf = file.kind === 'pdf';
            file.sheets.forEach(sheet => {
                sheet.rows.forEach((row, rowIdx) => {
                    row.forEach((cellVal, colIdx) => {
                        if (!cellVal) return;
                        const str = String(cellVal);
                        matcher.lastIndex = 0;
                        if (matcher.test(str)) {
                            searchResults.push({
                                fileName: file.name,
                                kind: file.kind,
                                sheetName: sheet.name,
                                rowIdx: rowIdx,
                                colIdx: colIdx,
                                cellRef: isPdf ? ('行 ' + (rowIdx + 1)) : XLSX.utils.encode_cell({ r: rowIdx, c: colIdx }),
                                value: str,
                                contextRow: opts.showContext && !isPdf ? row : null,
                                headerRow: opts.showContext && !isPdf && rowIdx > 0 ? sheet.rows[0] : null,
                            });
                        }
                    });
                });
            });
        });

        renderResults(matcher);
    }

    function renderResults(matcher) {
        const container = $('#search-results');
        const countEl = $('#search-result-count');
        if (!container) return;

        if (searchResults.length === 0) {
            const kw = $('#search-keyword').value.trim();
            if (kw && parsedFiles.length > 0) {
                container.innerHTML = '<div class="empty-state" style="padding:40px">未找到匹配「' + escHtml(kw) + '」的结果</div>';
            } else {
                container.innerHTML = '<div class="empty-state" style="padding:40px">输入关键字开始搜索</div>';
            }
            if (countEl) countEl.textContent = '';
            return;
        }

        if (countEl) countEl.textContent = `共找到 ${searchResults.length} 条匹配`;

        // 按文件分组
        const grouped = {};
        searchResults.forEach(r => {
            const key = r.fileName + ' | ' + r.sheetName;
            if (!grouped[key]) grouped[key] = { fileName: r.fileName, sheetName: r.sheetName, kind: r.kind, items: [] };
            grouped[key].items.push(r);
        });

        let html = '';
        Object.keys(grouped).forEach(key => {
            const g = grouped[key];
            const isPdf = g.kind === 'pdf';
            const groupIcon = isPdf ? '&#128196;' : '&#128202;';
            html += `<div class="search-group ${isPdf ? 'group-pdf' : ''}">
                <div class="search-group-header">
                    <span class="search-group-icon">${groupIcon}</span>
                    <strong>${escHtml(g.fileName)}</strong>
                    <span class="search-group-sep">&rsaquo;</span>
                    <span class="search-group-sheet">${escHtml(g.sheetName)}</span>
                    <span class="search-group-count">${g.items.length} 条</span>
                </div>`;

            const refHeader = isPdf ? '位置' : '单元格';
            html += '<table class="data-table search-result-table"><thead><tr><th>' + refHeader + '</th><th>内容</th>';
            if (!isPdf && $('#search-show-context').checked) html += '<th>所在行上下文</th>';
            html += '</tr></thead><tbody>';

            g.items.forEach(item => {
                const highlighted = highlightMatches(item.value, matcher);
                html += `<tr>
                    <td class="search-cell-ref"><strong>${item.cellRef}</strong></td>
                    <td class="search-cell-val">${highlighted}</td>`;

                if (!isPdf && $('#search-show-context').checked && item.contextRow) {
                    const headerRow = item.headerRow;
                    const contextCells = item.contextRow.map((cv, ci) => {
                        if (ci === item.colIdx) return '';
                        const hdr = headerRow && headerRow[ci] ? headerRow[ci] : XLSX.utils.encode_col(ci);
                        return cv ? `<span class="ctx-pair"><span class="ctx-key">${escHtml(hdr)}:</span> <span class="ctx-val">${escHtml(cv)}</span></span>` : '';
                    }).filter(x => x).join(' ');
                    html += `<td class="search-cell-ctx">${contextCells}</td>`;
                }

                html += '</tr>';
            });
            html += '</tbody></table></div>';
        });

        container.innerHTML = html;
    }

    function highlightMatches(text, matcher) {
        if (!matcher) return escHtml(text);
        const escaped = escHtml(text);
        // 在原始文本上找匹配位置
        const matches = [];
        matcher.lastIndex = 0;
        let m;
        while ((m = matcher.exec(text)) !== null) {
            matches.push({ start: m.index, end: m.index + m[0].length });
            if (m.index === matcher.lastIndex) matcher.lastIndex++;
        }
        if (matches.length === 0) return escaped;

        // 构建高亮字符串（基于原始文本位置再escape）
        let result = '';
        let pos = 0;
        matches.forEach(mm => {
            result += escHtml(text.slice(pos, mm.start));
            result += '<mark class="search-highlight">' + escHtml(text.slice(mm.start, mm.end)) + '</mark>';
            pos = mm.end;
        });
        result += escHtml(text.slice(pos));
        return result;
    }

    // ---- 导出结果 ----
    function exportResults() {
        if (searchResults.length === 0) {
            alert('暂无搜索结果可导出');
            return;
        }

        const keyword = $('#search-keyword').value.trim();
        const header = ['文件名', '类型', '工作表/页', '位置', '行号', '内容'];
        const rows = [header];
        searchResults.forEach(r => {
            rows.push([r.fileName, r.kind === 'pdf' ? 'PDF' : 'Excel', r.sheetName, r.cellRef, r.rowIdx + 1, r.value]);
        });

        // CSV 格式
        const csv = rows.map(row => row.map(cell => {
            const s = String(cell == null ? '' : cell);
            if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
            return s;
        }).join(',')).join('\n');

        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `search_${keyword || 'results'}_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ---- 状态提示 ----
    function showStatus(msg) {
        const el = $('#search-status');
        if (el) { el.style.display = 'block'; el.textContent = msg; }
    }
    function updateStatus(msg) {
        const el = $('#search-status');
        if (el) el.textContent = msg;
    }
    function hideStatus() {
        const el = $('#search-status');
        if (el) el.style.display = 'none';
    }

    // ---- 事件绑定 ----
    function initXlsSearch() {
        const fileInput = $('#xls-search-input');
        if (fileInput) {
            fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
        }

        // 拖放支持
        const dropZone = $('#xls-search-dropzone');
        if (dropZone) {
            ['dragenter', 'dragover'].forEach(evt => {
                dropZone.addEventListener(evt, (e) => {
                    e.preventDefault();
                    dropZone.classList.add('drop-hover');
                });
            });
            ['dragleave', 'drop'].forEach(evt => {
                dropZone.addEventListener(evt, (e) => {
                    e.preventDefault();
                    dropZone.classList.remove('drop-hover');
                });
            });
            dropZone.addEventListener('drop', (e) => {
                handleFiles(e.dataTransfer.files);
            });
        }

        const kwInput = $('#search-keyword');
        if (kwInput) {
            let timer;
            kwInput.addEventListener('input', () => {
                clearTimeout(timer);
                timer = setTimeout(doSearch, 300);
            });
            kwInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') doSearch();
            });
        }

        ['#search-case-sensitive', '#search-whole-word', '#search-use-regex', '#search-show-context'].forEach(sel => {
            const el = $(sel);
            if (el) el.addEventListener('change', doSearch);
        });

        const searchBtn = $('#btn-do-search');
        if (searchBtn) searchBtn.addEventListener('click', doSearch);

        const clearBtn = $('#btn-clear-search-files');
        if (clearBtn) clearBtn.addEventListener('click', () => {
            if (parsedFiles.length > 0 && !confirm('确定清空所有已加载的文件？')) return;
            parsedFiles = [];
            searchResults = [];
            $('#xls-search-input').value = '';
            $('#search-file-summary').textContent = '';
            renderFileList();
            renderResults();
        });

        const exportBtn = $('#btn-export-search');
        if (exportBtn) exportBtn.addEventListener('click', exportResults);

        renderFileList();
        renderResults();
    }

    window.initXlsSearchPage = function () {
        // 保留状态，只在首次初始化时渲染
        renderFileList();
        renderResults();
    };

    initXlsSearch();
})();
