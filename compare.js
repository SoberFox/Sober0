// ============================================================
// 操作手册对比模块
// ============================================================

(function () {
    'use strict';

    // ---- DOM helpers ----
    function $(sel) { return document.querySelector(sel); }
    function $$(sel) { return document.querySelectorAll(sel); }

    // ---- State ----
    let baseWorkbook = null;   // 基准文件 workbook
    let compareWorkbooks = []; // 对比文件 workbook 数组
    let currentSheet = null;   // 当前选中的工作表名

    // ---- File Upload ----
    $('#file-base').addEventListener('change', function (e) {
        const file = e.target.files[0];
        $('#file-base-name').textContent = file ? file.name : '未选择文件';
        if (file) {
            readExcel(file).then(wb => { baseWorkbook = wb; });
        }
    });

    $('#file-compare').addEventListener('change', function (e) {
        const files = Array.from(e.target.files);
        if (files.length === 0) {
            $('#file-compare-name').textContent = '未选择文件';
            return;
        }
        $('#file-compare-name').textContent = files.map(f => f.name).join(', ');
        compareWorkbooks = [];
        Promise.all(files.map(f => readExcel(f))).then(wbs => {
            compareWorkbooks = wbs;
        });
    });

    function readExcel(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = function (e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const wb = XLSX.read(data, { type: 'array' });
                    resolve(wb);
                } catch (err) {
                    alert('文件解析失败: ' + err.message);
                    reject(err);
                }
            };
            reader.readAsArrayBuffer(file);
        });
    }

    // ---- Compare ----
    $('#btn-start-compare').addEventListener('click', startCompare);
    $('#btn-clear-compare').addEventListener('click', clearCompare);

    function startCompare() {
        if (!baseWorkbook) {
            alert('请先上传基准手册文件');
            return;
        }
        if (compareWorkbooks.length === 0) {
            alert('请上传至少一个对比手册文件');
            return;
        }

        // 构建 sheet 选择器
        buildSheetTabs();

        // 默认对比第一个sheet
        const firstSheet = baseWorkbook.SheetNames[0];
        selectSheet(firstSheet);
    }

    function clearCompare() {
        baseWorkbook = null;
        compareWorkbooks = [];
        currentSheet = null;
        $('#file-base').value = '';
        $('#file-compare').value = '';
        $('#file-base-name').textContent = '未选择文件';
        $('#file-compare-name').textContent = '未选择文件';
        $('#compare-sheet-selector').style.display = 'none';
        $('#compare-stats').style.display = 'none';
        $('#compare-result').style.display = 'none';
    }

    function buildSheetTabs() {
        // 收集所有工作表名（合并基准和对比文件的sheet）
        const allSheets = new Set(baseWorkbook.SheetNames);
        compareWorkbooks.forEach(wb => {
            wb.SheetNames.forEach(s => allSheets.add(s));
        });

        const container = $('#sheet-tabs');
        container.innerHTML = '';

        allSheets.forEach(name => {
            const tab = document.createElement('button');
            tab.className = 'btn btn-sm sheet-tab';
            tab.textContent = name;
            tab.dataset.sheet = name;
            tab.addEventListener('click', () => selectSheet(name));
            container.appendChild(tab);
        });

        $('#compare-sheet-selector').style.display = 'block';
    }

    function selectSheet(sheetName) {
        currentSheet = sheetName;

        // 高亮选中的tab
        $$('.sheet-tab').forEach(t => {
            t.classList.toggle('sheet-tab-active', t.dataset.sheet === sheetName);
        });

        const opts = {
            ignoreWhitespace: $('#opt-ignore-whitespace').checked,
            ignoreCase: $('#opt-ignore-case').checked,
            showAll: $('#opt-show-all').checked,
        };

        // 获取基准sheet数据
        const baseData = getSheetData(baseWorkbook, sheetName);

        // 对每个对比文件执行对比
        const results = compareWorkbooks.map((wb, idx) => {
            const compData = getSheetData(wb, sheetName);
            return diffSheets(baseData, compData, opts);
        });

        renderStats(results);
        renderCompareTable(baseData, results, opts);
    }

    // ---- Sheet数据提取 ----
    function getSheetData(workbook, sheetName) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) return [];
        // 转为二维数组，保留空单元格
        const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
        const data = [];
        for (let r = range.s.r; r <= range.e.r; r++) {
            const row = [];
            for (let c = range.s.c; c <= range.e.c; c++) {
                const addr = XLSX.utils.encode_cell({ r, c });
                const cell = sheet[addr];
                row.push(cell ? formatCellValue(cell) : '');
            }
            data.push(row);
        }
        return data;
    }

    function formatCellValue(cell) {
        if (cell.t === 'n' && cell.w) return cell.w; // 保留格式化数字
        if (cell.v === undefined || cell.v === null) return '';
        return String(cell.v);
    }

    // ---- Diff逻辑 ----
    function diffSheets(baseData, compData, opts) {
        const maxRows = Math.max(baseData.length, compData.length);
        const maxCols = Math.max(
            baseData.reduce((m, r) => Math.max(m, r.length), 0),
            compData.reduce((m, r) => Math.max(m, r.length), 0)
        );

        const diff = {
            rows: [],
            stats: { total: 0, same: 0, changed: 0, added: 0, removed: 0 }
        };

        for (let r = 0; r < maxRows; r++) {
            const baseRow = baseData[r] || [];
            const compRow = compData[r] || [];
            const rowCols = Math.max(baseRow.length, compRow.length, maxCols);
            const rowDiff = { cells: [], hasChange: false };

            let rowInBase = r < baseData.length;
            let rowInComp = r < compData.length;

            for (let c = 0; c < rowCols; c++) {
                const baseVal = (baseRow[c] || '');
                const compVal = (compRow[c] || '');

                let bv = baseVal;
                let cv = compVal;
                if (opts.ignoreWhitespace) {
                    bv = bv.replace(/\s+/g, ' ').trim();
                    cv = cv.replace(/\s+/g, ' ').trim();
                }
                if (opts.ignoreCase) {
                    bv = bv.toLowerCase();
                    cv = cv.toLowerCase();
                }

                let status;
                if (!rowInBase && rowInComp) {
                    status = 'added';
                } else if (rowInBase && !rowInComp) {
                    status = 'removed';
                } else if (bv === cv) {
                    status = 'same';
                } else {
                    status = 'changed';
                }

                if (status !== 'same') rowDiff.hasChange = true;

                rowDiff.cells.push({
                    baseVal: baseVal,
                    compVal: compVal,
                    status: status,
                });
            }

            diff.rows.push(rowDiff);
            diff.stats.total++;
            if (!rowDiff.hasChange) {
                diff.stats.same++;
            } else {
                // 统计行级状态
                if (!rowInBase) diff.stats.added++;
                else if (!rowInComp) diff.stats.removed++;
                else diff.stats.changed++;
            }
        }

        return diff;
    }

    // ---- 渲染统计 ----
    function renderStats(results) {
        const grid = $('#stats-grid');
        grid.innerHTML = '';

        results.forEach((res, idx) => {
            const s = res.stats;
            const pct = s.total > 0 ? ((s.same / s.total) * 100).toFixed(1) : '0';
            const card = document.createElement('div');
            card.className = 'stats-card';
            card.innerHTML = `
                <div class="stats-title">对比文件 ${idx + 1}</div>
                <div class="stats-match-rate">
                    <span class="stats-big-num">${pct}%</span>
                    <span class="stats-label">一致率</span>
                </div>
                <div class="stats-details">
                    <div class="stats-row"><span class="dot dot-same"></span>相同行: <strong>${s.same}</strong></div>
                    <div class="stats-row"><span class="dot dot-changed"></span>修改行: <strong>${s.changed}</strong></div>
                    <div class="stats-row"><span class="dot dot-added"></span>新增行: <strong>${s.added}</strong></div>
                    <div class="stats-row"><span class="dot dot-removed"></span>删除行: <strong>${s.removed}</strong></div>
                    <div class="stats-row">总行数: <strong>${s.total}</strong></div>
                </div>
            `;
            grid.appendChild(card);
        });

        $('#compare-stats').style.display = 'block';
    }

    // ---- 渲染对比表格 ----
    function renderCompareTable(baseData, results, opts) {
        const wrapper = $('#compare-table-wrapper');
        wrapper.innerHTML = '';

        // 对每个对比文件生成一个表格
        results.forEach((res, idx) => {
            const title = document.createElement('h4');
            title.className = 'compare-file-title';
            title.textContent = '对比文件 ' + (idx + 1);
            wrapper.appendChild(title);

            const table = document.createElement('table');
            table.className = 'compare-table';

            // 表头 - 行号 + 列号
            const maxCols = res.rows.reduce((m, r) => Math.max(m, r.cells.length), 0);
            const thead = document.createElement('thead');
            const headRow = document.createElement('tr');
            headRow.innerHTML = '<th class="row-num-col">行</th>';
            for (let c = 0; c < maxCols; c++) {
                const colLetter = XLSX.utils.encode_col(c);
                headRow.innerHTML += `<th><span class="col-base">基准 ${colLetter}</span><span class="col-sep">/</span><span class="col-comp">对比 ${colLetter}</span></th>`;
            }
            thead.appendChild(headRow);
            table.appendChild(thead);

            const tbody = document.createElement('tbody');

            res.rows.forEach((rowDiff, rowIdx) => {
                // 是否过滤掉无差异行
                if (!opts.showAll && !rowDiff.hasChange) return;

                const tr = document.createElement('tr');
                tr.className = rowDiff.hasChange ? 'row-changed' : 'row-same';
                tr.innerHTML = `<td class="row-num-col">${rowIdx + 1}</td>`;

                rowDiff.cells.forEach(cell => {
                    const td = document.createElement('td');
                    td.className = 'compare-cell cell-' + cell.status;

                    if (cell.status === 'same') {
                        td.innerHTML = `<div class="cell-val">${escHtml(cell.baseVal)}</div>`;
                    } else if (cell.status === 'added') {
                        td.innerHTML = `<div class="cell-added">${escHtml(cell.compVal)}</div>`;
                    } else if (cell.status === 'removed') {
                        td.innerHTML = `<div class="cell-removed">${escHtml(cell.baseVal)}</div>`;
                    } else {
                        // changed
                        td.innerHTML = `
                            <div class="cell-old">${escHtml(cell.baseVal)}</div>
                            <div class="cell-arrow">&#8595;</div>
                            <div class="cell-new">${escHtml(cell.compVal)}</div>
                        `;
                    }

                    tr.appendChild(td);
                });

                tbody.appendChild(tr);
            });

            table.appendChild(tbody);
            wrapper.appendChild(table);

            // 如果没有差异
            if (!res.rows.some(r => r.hasChange)) {
                const msg = document.createElement('div');
                msg.className = 'no-diff-msg';
                msg.textContent = '此工作表没有差异，内容完全一致。';
                wrapper.appendChild(msg);
            }
        });

        $('#compare-result').style.display = 'block';

        // 滚动到结果区
        $('#compare-stats').scrollIntoView({ behavior: 'smooth' });
    }

    function escHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

})();
