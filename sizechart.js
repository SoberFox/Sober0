// ============================================================
// 尺码对照表模块
// ============================================================

(function () {
    'use strict';

    function $(sel) { return document.querySelector(sel); }

    // ---- 国际尺码对照数据 ----
    const SIZE_DATA = {
        women_tops: {
            label: '女装上衣',
            headers: ['中国', '国际', '美国', '欧洲', '英国', '日本', '韩国', '胸围(cm)', '腰围(cm)'],
            rows: [
                ['155/80A', 'XS', '0-2', '32', '4', '5', '44', '76-80', '58-62'],
                ['160/84A', 'S', '4', '34', '6', '7', '55', '80-84', '62-66'],
                ['165/88A', 'M', '6-8', '36-38', '8-10', '9-11', '66', '84-88', '66-70'],
                ['170/92A', 'L', '10', '40', '12', '13', '77', '88-92', '70-74'],
                ['175/96A', 'XL', '12', '42', '14', '15', '88', '92-96', '74-78'],
                ['180/100A', 'XXL', '14', '44', '16', '17', '99', '96-100', '78-82'],
                ['185/104A', 'XXXL', '16', '46', '18', '19', '100', '100-104', '82-86'],
            ]
        },
        women_bottoms: {
            label: '女装下装',
            headers: ['中国', '国际', '美国', '欧洲', '英国', '日本', '腰围(cm)', '臀围(cm)'],
            rows: [
                ['155/62A', 'XS', '24', '32', '4', '5', '60-64', '84-88'],
                ['160/66A', 'S', '25-26', '34', '6', '7', '64-68', '88-92'],
                ['165/70A', 'M', '27-28', '36-38', '8-10', '9', '68-72', '92-96'],
                ['170/74A', 'L', '29-30', '40', '12', '11', '72-76', '96-100'],
                ['175/78A', 'XL', '31-32', '42', '14', '13', '76-80', '100-104'],
                ['180/82A', 'XXL', '33-34', '44', '16', '15', '80-84', '104-108'],
            ]
        },
        men_tops: {
            label: '男装上衣',
            headers: ['中国', '国际', '美国', '欧洲', '英国', '日本', '韩国', '胸围(cm)', '肩宽(cm)'],
            rows: [
                ['165/84A', 'S', 'S (34-36)', '44', '34', 'S', '90', '82-86', '42-43'],
                ['170/88A', 'M', 'M (38-40)', '46-48', '36-38', 'M', '95', '86-90', '43-44.5'],
                ['175/92A', 'L', 'L (42-44)', '50', '40', 'L', '100', '90-94', '44.5-46'],
                ['180/96A', 'XL', 'XL (46)', '52', '42', 'XL', '105', '94-98', '46-47.5'],
                ['185/100A', 'XXL', 'XXL (48)', '54', '44', 'XXL', '110', '98-102', '47.5-49'],
                ['190/104A', 'XXXL', 'XXXL (50)', '56', '46', '3XL', '115', '102-106', '49-50.5'],
            ]
        },
        men_bottoms: {
            label: '男装下装',
            headers: ['中国', '国际', '美国', '欧洲', '日本', '腰围(cm)', '臀围(cm)'],
            rows: [
                ['165/68A', 'S', '28', '44', 'S', '68-72', '88-92'],
                ['170/72A', 'M', '29-30', '46', 'M', '72-76', '92-96'],
                ['175/76A', 'L', '31-32', '48-50', 'L', '76-80', '96-100'],
                ['180/80A', 'XL', '33-34', '52', 'XL', '80-84', '100-104'],
                ['185/84A', 'XXL', '35-36', '54', 'XXL', '84-88', '104-108'],
                ['190/88A', 'XXXL', '37-38', '56', '3XL', '88-92', '108-112'],
            ]
        },
        kids: {
            label: '童装',
            headers: ['年龄', '身高(cm)', '中国', '美国', '欧洲', '英国', '日本', '胸围(cm)', '腰围(cm)'],
            rows: [
                ['2-3岁', '90-100', '90/100', '2T-3T', '92-98', '2-3', '90-95', '50-54', '48-50'],
                ['3-4岁', '100-110', '100/110', '4T', '104', '3-4', '100-105', '54-56', '50-52'],
                ['4-5岁', '110-120', '110/120', '5-6', '110-116', '4-5', '110-115', '56-60', '52-54'],
                ['6-7岁', '120-130', '120/130', '6-7', '122-128', '6-7', '120-125', '60-64', '54-56'],
                ['8-9岁', '130-140', '130/140', '8-10', '134-140', '8-9', '130-135', '64-68', '56-58'],
                ['10-11岁', '140-150', '140/150', '10-12', '146-152', '10-11', '140-145', '68-72', '58-62'],
                ['12-14岁', '150-165', '150/160', '14-16', '158-164', '12-14', '150-160', '72-80', '62-66'],
            ]
        },
        shoes_women: {
            label: '女鞋',
            headers: ['中国', '脚长(cm)', '美国', '欧洲', '英国', '日本'],
            rows: [
                ['35', '22.5', '5', '36', '2.5', '22.5'],
                ['36', '23', '5.5-6', '37', '3-3.5', '23'],
                ['37', '23.5', '6.5', '37.5', '4', '23.5'],
                ['38', '24', '7-7.5', '38-39', '4.5-5', '24'],
                ['39', '24.5', '8', '39-40', '5.5', '24.5'],
                ['40', '25', '8.5-9', '40-41', '6-6.5', '25'],
                ['41', '25.5', '9.5', '41', '7', '25.5'],
            ]
        },
        shoes_men: {
            label: '男鞋',
            headers: ['中国', '脚长(cm)', '美国', '欧洲', '英国', '日本'],
            rows: [
                ['39', '24.5', '6.5', '39', '6', '24.5'],
                ['40', '25', '7-7.5', '40', '6.5', '25'],
                ['41', '25.5', '8', '41', '7', '25.5'],
                ['42', '26', '8.5-9', '42', '7.5-8', '26'],
                ['43', '26.5', '9.5', '42.5', '8.5', '26.5'],
                ['44', '27', '10-10.5', '43-44', '9-9.5', '27'],
                ['45', '27.5', '11', '44-45', '10', '27.5'],
                ['46', '28', '11.5-12', '45-46', '10.5-11', '28'],
            ]
        },
    };

    const STORAGE_KEY = 'custom_size_specs';

    // ---- 标准对照表 ----
    function initSizeChart() {
        const catSel = $('#size-category');
        if (!catSel) return;

        catSel.innerHTML = Object.keys(SIZE_DATA).map(k =>
            `<option value="${k}">${SIZE_DATA[k].label}</option>`
        ).join('');

        catSel.addEventListener('change', () => renderSizeTable(catSel.value));

        const searchInput = $('#size-search');
        if (searchInput) {
            searchInput.addEventListener('input', () => renderSizeTable(catSel.value, searchInput.value));
        }

        renderSizeTable(catSel.value);

        // ---- 自定义尺码规格 ----
        initCustomSpec();
    }

    function renderSizeTable(category, search) {
        const data = SIZE_DATA[category];
        if (!data) return;

        const container = $('#size-table-container');
        if (!container) return;

        let rows = data.rows;
        if (search) {
            const q = search.toLowerCase();
            rows = rows.filter(row => row.some(cell => cell.toLowerCase().includes(q)));
        }

        let html = `<table class="data-table size-ref-table">
            <thead><tr>${data.headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
            <tbody>`;

        rows.forEach(row => {
            html += '<tr>' + row.map(cell => `<td>${cell}</td>`).join('') + '</tr>';
        });

        html += '</tbody></table>';

        if (rows.length === 0) {
            html = '<div class="empty-state">未找到匹配的尺码</div>';
        }

        container.innerHTML = html;
    }

    // ============================================================
    // 自定义尺码规格表 - 用于给工厂下单
    // ============================================================
    let specColumns = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
    let specRows = [
        { part: '胸围', values: {} },
        { part: '衣长', values: {} },
        { part: '肩宽', values: {} },
        { part: '袖长', values: {} },
        { part: '腰围', values: {} },
        { part: '臀围', values: {} },
    ];

    function loadCustomSpec() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
            if (saved) {
                specColumns = saved.columns || specColumns;
                specRows = saved.rows || specRows;
            }
        } catch { /* ignore */ }
    }

    function saveCustomSpec() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ columns: specColumns, rows: specRows }));
    }

    function initCustomSpec() {
        loadCustomSpec();

        const addColBtn = $('#btn-add-size-col');
        if (addColBtn) addColBtn.addEventListener('click', () => {
            const name = prompt('输入新尺码名称（如 3XL）');
            if (name && !specColumns.includes(name.trim())) {
                specColumns.push(name.trim());
                renderSpecTable();
            }
        });

        const addRowBtn = $('#btn-add-measure-row');
        if (addRowBtn) addRowBtn.addEventListener('click', () => {
            const name = prompt('输入测量部位名称（如 下摆宽）');
            if (name) {
                specRows.push({ part: name.trim(), values: {} });
                renderSpecTable();
            }
        });

        const saveBtn = $('#btn-save-spec');
        if (saveBtn) saveBtn.addEventListener('click', () => {
            saveCustomSpec();
            alert('尺码规格表已保存');
        });

        const exportBtn = $('#btn-export-spec');
        if (exportBtn) exportBtn.addEventListener('click', exportSpecToCSV);

        // 模板预设
        const presetBtns = $$('.spec-preset-btn');
        presetBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const type = btn.dataset.type;
                applySpecPreset(type);
            });
        });

        renderSpecTable();
    }

    function $$(sel) { return document.querySelectorAll(sel); }

    function applySpecPreset(type) {
        const presets = {
            tshirt: {
                columns: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
                rows: ['胸围', '衣长', '肩宽', '袖长', '下摆宽']
            },
            pants: {
                columns: ['26', '27', '28', '29', '30', '31', '32', '34'],
                rows: ['腰围', '臀围', '裤长', '前裆', '后裆', '大腿围', '脚口']
            },
            dress: {
                columns: ['XS', 'S', 'M', 'L', 'XL'],
                rows: ['胸围', '腰围', '臀围', '衣长', '肩宽', '袖长', '裙摆宽']
            },
            jacket: {
                columns: ['S', 'M', 'L', 'XL', 'XXL', '3XL'],
                rows: ['胸围', '衣长', '肩宽', '袖长', '下摆宽', '领宽', '前身宽', '后身宽']
            },
        };

        const p = presets[type];
        if (!p) return;

        specColumns = [...p.columns];
        specRows = p.rows.map(r => ({ part: r, values: {} }));
        renderSpecTable();
    }

    function renderSpecTable() {
        const container = $('#spec-table-container');
        if (!container) return;

        let html = `<table class="data-table spec-edit-table">
            <thead><tr>
                <th>部位 (cm)</th>
                ${specColumns.map((c, i) => `<th>${c} <button class="btn-remove-col" data-idx="${i}" title="删除此列">&times;</button></th>`).join('')}
            </tr></thead><tbody>`;

        specRows.forEach((row, ri) => {
            html += `<tr>
                <td>
                    <input type="text" value="${row.part}" class="spec-part-input" data-ri="${ri}" style="width:80px;font-weight:600">
                    <button class="btn-remove-row" data-ri="${ri}" title="删除">&times;</button>
                </td>`;
            specColumns.forEach((col, ci) => {
                const val = row.values[col] || '';
                html += `<td><input type="text" value="${val}" class="spec-val-input" data-ri="${ri}" data-col="${col}" style="width:60px;text-align:center"></td>`;
            });
            html += '</tr>';
        });

        html += '</tbody></table>';
        container.innerHTML = html;

        // 绑定事件
        container.querySelectorAll('.spec-val-input').forEach(el => {
            el.addEventListener('input', (e) => {
                const ri = Number(e.target.dataset.ri);
                const col = e.target.dataset.col;
                specRows[ri].values[col] = e.target.value;
            });
        });

        container.querySelectorAll('.spec-part-input').forEach(el => {
            el.addEventListener('input', (e) => {
                specRows[Number(e.target.dataset.ri)].part = e.target.value;
            });
        });

        container.querySelectorAll('.btn-remove-col').forEach(el => {
            el.addEventListener('click', (e) => {
                const idx = Number(e.target.dataset.idx);
                specColumns.splice(idx, 1);
                renderSpecTable();
            });
        });

        container.querySelectorAll('.btn-remove-row').forEach(el => {
            el.addEventListener('click', (e) => {
                specRows.splice(Number(e.target.dataset.ri), 1);
                renderSpecTable();
            });
        });
    }

    function exportSpecToCSV() {
        let csv = '部位,' + specColumns.join(',') + '\n';
        specRows.forEach(row => {
            csv += row.part + ',' + specColumns.map(c => row.values[c] || '').join(',') + '\n';
        });
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'size_spec_' + new Date().toISOString().slice(0, 10) + '.csv';
        a.click();
        URL.revokeObjectURL(url);
    }

    window.initSizeChartPage = function () {
        initSizeChart();
    };

    initSizeChart();
})();
