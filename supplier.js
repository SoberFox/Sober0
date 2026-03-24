// ============================================================
// 供应商比价模块
// ============================================================

(function () {
    'use strict';

    // ---- 颜色板 ----
    const COLORS = [
        '#4a6cf7', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
        '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1'
    ];

    // ---- 状态 ----
    let suppliers = [];   // [{ id, name, color }]
    let items = [];       // [{ id, name, unit }]
    let prices = {};      // { `${itemId}_${supplierId}`: number }
    let customAlloc = {}; // { itemId: [{ supplierId, qty }] }

    function $(sel) { return document.querySelector(sel); }
    function $$(sel) { return document.querySelectorAll(sel); }
    function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
    function fmt(v) { return '¥' + Number(v || 0).toFixed(2); }
    function escHtml(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

    // ---- 供应商管理 ----
    function addSupplier(name) {
        name = (name || '').trim();
        if (!name) return;
        if (suppliers.find(s => s.name === name)) { alert('供应商已存在'); return; }
        suppliers.push({ id: genId(), name, color: COLORS[suppliers.length % COLORS.length] });
        renderSupplierChips();
        renderMatrix();
    }

    function removeSupplier(id) {
        suppliers = suppliers.filter(s => s.id !== id);
        // clean prices
        Object.keys(prices).forEach(k => { if (k.endsWith('_' + id)) delete prices[k]; });
        renderSupplierChips();
        renderMatrix();
    }

    function renderSupplierChips() {
        const wrap = $('#sp-supplier-chips');
        wrap.innerHTML = suppliers.map(s => `
            <span class="sp-chip">
                <span class="sp-chip-color" style="background:${s.color}"></span>
                ${escHtml(s.name)}
                <button class="sp-chip-remove" data-id="${s.id}">&times;</button>
            </span>
        `).join('');
        wrap.querySelectorAll('.sp-chip-remove').forEach(btn => {
            btn.addEventListener('click', () => removeSupplier(btn.dataset.id));
        });
    }

    // ---- 工序管理 ----
    function addItem(name, unit) {
        name = (name || '').trim();
        unit = (unit || '件').trim();
        if (!name) return;
        if (items.find(i => i.name === name)) { alert('工序已存在'); return; }
        items.push({ id: genId(), name, unit });
        renderItemsList();
        renderMatrix();
    }

    function removeItem(id) {
        items = items.filter(i => i.id !== id);
        Object.keys(prices).forEach(k => { if (k.startsWith(id + '_')) delete prices[k]; });
        renderItemsList();
        renderMatrix();
    }

    function renderItemsList() {
        const wrap = $('#sp-items-list');
        wrap.innerHTML = items.map(it => `
            <div class="sp-item-row">
                <span class="sp-item-name">${escHtml(it.name)}</span>
                <span class="sp-item-unit">${escHtml(it.unit)}</span>
                <button class="sp-item-remove" data-id="${it.id}">&times;</button>
            </div>
        `).join('');
        wrap.querySelectorAll('.sp-item-remove').forEach(btn => {
            btn.addEventListener('click', () => removeItem(btn.dataset.id));
        });
    }

    // ---- 价格矩阵 ----
    function renderMatrix() {
        const section = $('#sp-matrix-section');
        if (suppliers.length === 0 || items.length === 0) {
            section.style.display = 'none';
            $('#sp-allocation-section').style.display = 'none';
            $('#sp-custom-section').style.display = 'none';
            return;
        }
        section.style.display = '';

        // thead
        const thead = $('#sp-matrix-head');
        thead.innerHTML = `<tr>
            <th>工序</th>
            <th>单位</th>
            ${suppliers.map(s => `<th class="sp-th-supplier"><span class="sp-th-color" style="background:${s.color}"></span>${escHtml(s.name)}</th>`).join('')}
        </tr>`;

        // tbody
        const tbody = $('#sp-matrix-body');
        tbody.innerHTML = items.map(it => `<tr data-item="${it.id}">
            <td>${escHtml(it.name)}</td>
            <td class="sp-unit-col">${escHtml(it.unit)}</td>
            ${suppliers.map(s => {
                const key = it.id + '_' + s.id;
                const val = prices[key] !== undefined ? prices[key] : '';
                return `<td><input type="number" min="0" step="0.01" data-key="${key}" value="${val}" placeholder="0.00"></td>`;
            }).join('')}
        </tr>`).join('');

        // tfoot
        const tfoot = $('#sp-matrix-foot');
        tfoot.innerHTML = `<tr>
            <td colspan="2">合计（单件）</td>
            ${suppliers.map(s => {
                const total = items.reduce((sum, it) => sum + (Number(prices[it.id + '_' + s.id]) || 0), 0);
                return `<td>${fmt(total)}</td>`;
            }).join('')}
        </tr>`;

        // bind input events
        tbody.querySelectorAll('input[type="number"]').forEach(inp => {
            inp.addEventListener('input', (e) => {
                const key = e.target.dataset.key;
                prices[key] = e.target.value === '' ? undefined : Number(e.target.value);
                updateMatrixFooter();
            });
        });
    }

    function updateMatrixFooter() {
        const tfoot = $('#sp-matrix-foot');
        tfoot.innerHTML = `<tr>
            <td colspan="2">合计（单件）</td>
            ${suppliers.map(s => {
                const total = items.reduce((sum, it) => sum + (Number(prices[it.id + '_' + s.id]) || 0), 0);
                return `<td>${fmt(total)}</td>`;
            }).join('')}
        </tr>`;
    }

    // ---- 比价分析 ----
    function runAnalysis() {
        if (suppliers.length === 0 || items.length === 0) {
            alert('请至少添加一个供应商和一个工序');
            return;
        }

        const totalQty = Number($('#sp-total-qty').value) || 1;

        // highlight cheapest/expensive in matrix
        highlightMatrix();

        // --- 方案计算 ---
        const schemes = [];

        // 1) 每家供应商全包方案
        suppliers.forEach(s => {
            const unitTotal = items.reduce((sum, it) => sum + (Number(prices[it.id + '_' + s.id]) || 0), 0);
            const total = unitTotal * totalQty;
            const details = items.map(it => ({
                name: it.name,
                unit: it.unit,
                price: Number(prices[it.id + '_' + s.id]) || 0,
                subtotal: (Number(prices[it.id + '_' + s.id]) || 0) * totalQty
            }));
            schemes.push({
                type: 'single',
                title: `全给 ${s.name}`,
                desc: `所有工序由 ${s.name} 完成`,
                supplierName: s.name,
                color: s.color,
                unitPrice: unitTotal,
                total: total,
                details: details
            });
        });

        // 2) 最优拆分方案 - 每个工序选最便宜的供应商
        const bestDetails = items.map(it => {
            let bestPrice = Infinity;
            let bestSupplier = null;
            suppliers.forEach(s => {
                const p = Number(prices[it.id + '_' + s.id]) || 0;
                if (p > 0 && p < bestPrice) {
                    bestPrice = p;
                    bestSupplier = s;
                }
            });
            if (!bestSupplier && suppliers.length > 0) {
                bestSupplier = suppliers[0];
                bestPrice = Number(prices[it.id + '_' + suppliers[0].id]) || 0;
            }
            return {
                name: it.name,
                unit: it.unit,
                price: bestPrice === Infinity ? 0 : bestPrice,
                subtotal: (bestPrice === Infinity ? 0 : bestPrice) * totalQty,
                supplierName: bestSupplier ? bestSupplier.name : '-',
                color: bestSupplier ? bestSupplier.color : '#ccc'
            };
        });
        const bestUnitPrice = bestDetails.reduce((s, d) => s + d.price, 0);
        const bestTotal = bestUnitPrice * totalQty;

        schemes.unshift({
            type: 'best',
            title: '最优拆分方案',
            desc: '每个工序选最低价供应商',
            unitPrice: bestUnitPrice,
            total: bestTotal,
            details: bestDetails,
            isBest: true
        });

        // find overall cheapest
        const allTotals = schemes.map(s => s.total);
        const minTotal = Math.min(...allTotals);

        renderSchemes(schemes, minTotal, totalQty);
        renderCustomAllocation(totalQty);

        $('#sp-allocation-section').style.display = '';
        $('#sp-custom-section').style.display = '';
    }

    function highlightMatrix() {
        const tbody = $('#sp-matrix-body');
        items.forEach(it => {
            let minP = Infinity, maxP = -Infinity;
            const vals = [];
            suppliers.forEach(s => {
                const p = Number(prices[it.id + '_' + s.id]) || 0;
                if (p > 0) {
                    if (p < minP) minP = p;
                    if (p > maxP) maxP = p;
                }
                vals.push({ sid: s.id, price: p });
            });

            const row = tbody.querySelector(`tr[data-item="${it.id}"]`);
            if (!row) return;
            const cells = row.querySelectorAll('td');
            // skip first 2 cells (name, unit)
            vals.forEach((v, i) => {
                const cell = cells[i + 2];
                if (!cell) return;
                cell.classList.remove('sp-cell-cheapest', 'sp-cell-expensive');
                if (v.price > 0 && v.price === minP && minP !== maxP) cell.classList.add('sp-cell-cheapest');
                if (v.price > 0 && v.price === maxP && minP !== maxP) cell.classList.add('sp-cell-expensive');
            });
        });
    }

    function renderSchemes(schemes, minTotal, totalQty) {
        const wrap = $('#sp-schemes');
        wrap.innerHTML = schemes.map(sc => {
            const isCheapest = sc.total === minTotal;
            const savingsVsMax = Math.max(...schemes.map(s => s.total)) - sc.total;

            let badgeHtml = '';
            if (sc.type === 'best') badgeHtml = '<span class="sp-scheme-badge sp-badge-best">推荐</span>';
            else if (sc.type === 'single') badgeHtml = `<span class="sp-scheme-badge sp-badge-single">全包</span>`;

            let detailHtml = sc.details.map(d => {
                const supplierTag = d.supplierName ? `<span style="color:${d.color || 'inherit'};font-weight:500">${escHtml(d.supplierName)}</span>` : '';
                return `<div class="sp-scheme-detail-row">
                    <span>${escHtml(d.name)} ${supplierTag}</span>
                    <span>${fmt(d.price)}/${d.unit}</span>
                </div>`;
            }).join('');

            let savingsHtml = '';
            if (savingsVsMax > 0) {
                savingsHtml = `<div class="sp-scheme-savings sp-savings-positive">比最贵方案节省 ${fmt(savingsVsMax)}</div>`;
            }

            return `<div class="sp-scheme-card ${isCheapest ? 'sp-scheme-best' : ''}">
                ${badgeHtml}
                <div class="sp-scheme-title">${escHtml(sc.title)}</div>
                <div class="sp-scheme-desc">${escHtml(sc.desc)}</div>
                <div class="sp-scheme-price">${fmt(sc.total)}</div>
                <div class="sp-scheme-unit-price">单件 ${fmt(sc.unitPrice)} × ${totalQty} 件</div>
                <div class="sp-scheme-detail">${detailHtml}</div>
                ${savingsHtml}
            </div>`;
        }).join('');
    }

    // ---- 自定义分配 ----
    function renderCustomAllocation(totalQty) {
        // initialize customAlloc if empty
        items.forEach(it => {
            if (!customAlloc[it.id] || customAlloc[it.id].length === 0) {
                customAlloc[it.id] = [{ supplierId: suppliers[0] ? suppliers[0].id : '', qty: totalQty }];
            }
            // clean up invalid suppliers
            customAlloc[it.id] = customAlloc[it.id].filter(a =>
                suppliers.find(s => s.id === a.supplierId) || a.supplierId === ''
            );
            if (customAlloc[it.id].length === 0) {
                customAlloc[it.id] = [{ supplierId: suppliers[0] ? suppliers[0].id : '', qty: totalQty }];
            }
        });

        const wrap = $('#sp-custom-alloc');
        wrap.innerHTML = items.map(it => {
            const allocs = customAlloc[it.id];
            const allocRows = allocs.map((a, idx) => {
                const price = a.supplierId ? (Number(prices[it.id + '_' + a.supplierId]) || 0) : 0;
                const subtotal = price * (Number(a.qty) || 0);
                const supplierOpts = suppliers.map(s =>
                    `<option value="${s.id}" ${s.id === a.supplierId ? 'selected' : ''}>${escHtml(s.name)}</option>`
                ).join('');

                return `<div class="sp-custom-supplier-row">
                    <select data-item="${it.id}" data-idx="${idx}" data-field="supplier">${supplierOpts}</select>
                    <span>×</span>
                    <input type="number" min="0" value="${a.qty}" data-item="${it.id}" data-idx="${idx}" data-field="qty"> 件
                    <span>@ ${fmt(price)}</span>
                    <span class="sp-custom-subtotal">= ${fmt(subtotal)}</span>
                    ${allocs.length > 1 ? `<button class="sp-item-remove" data-item="${it.id}" data-idx="${idx}" data-action="remove-split">&times;</button>` : ''}
                </div>`;
            }).join('');

            return `<div class="sp-custom-row">
                <div class="sp-custom-item-label">${escHtml(it.name)}</div>
                <div class="sp-custom-suppliers">
                    ${allocRows}
                    <button class="sp-custom-add-split" data-item="${it.id}">+ 拆分给多家</button>
                </div>
            </div>`;
        }).join('');

        // bind events
        wrap.querySelectorAll('select[data-field="supplier"]').forEach(sel => {
            sel.addEventListener('change', e => {
                const itemId = e.target.dataset.item;
                const idx = Number(e.target.dataset.idx);
                customAlloc[itemId][idx].supplierId = e.target.value;
                renderCustomAllocation(totalQty);
            });
        });

        wrap.querySelectorAll('input[data-field="qty"]').forEach(inp => {
            inp.addEventListener('input', e => {
                const itemId = e.target.dataset.item;
                const idx = Number(e.target.dataset.idx);
                customAlloc[itemId][idx].qty = Number(e.target.value) || 0;
                updateCustomSummary(totalQty);
                // update subtotal inline
                const supplierId = customAlloc[itemId][idx].supplierId;
                const price = supplierId ? (Number(prices[itemId + '_' + supplierId]) || 0) : 0;
                const subtotal = price * (Number(e.target.value) || 0);
                const row = e.target.closest('.sp-custom-supplier-row');
                if (row) row.querySelector('.sp-custom-subtotal').textContent = '= ' + fmt(subtotal);
            });
        });

        wrap.querySelectorAll('.sp-custom-add-split').forEach(btn => {
            btn.addEventListener('click', () => {
                const itemId = btn.dataset.item;
                customAlloc[itemId].push({ supplierId: suppliers[0] ? suppliers[0].id : '', qty: 0 });
                renderCustomAllocation(totalQty);
            });
        });

        wrap.querySelectorAll('[data-action="remove-split"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const itemId = btn.dataset.item;
                const idx = Number(btn.dataset.idx);
                customAlloc[itemId].splice(idx, 1);
                renderCustomAllocation(totalQty);
            });
        });

        updateCustomSummary(totalQty);
    }

    function updateCustomSummary(totalQty) {
        let grandTotal = 0;
        items.forEach(it => {
            (customAlloc[it.id] || []).forEach(a => {
                const price = a.supplierId ? (Number(prices[it.id + '_' + a.supplierId]) || 0) : 0;
                grandTotal += price * (Number(a.qty) || 0);
            });
        });
        const unitPrice = totalQty > 0 ? grandTotal / totalQty : 0;
        const summaryWrap = $('#sp-custom-summary');
        summaryWrap.innerHTML = `<div class="sp-custom-total">
            <span>自定义方案总成本</span>
            <span class="sp-custom-total-amount">${fmt(grandTotal)}<span style="font-size:13px;color:var(--text-secondary);margin-left:8px">（单件 ${fmt(unitPrice)}）</span></span>
        </div>`;
    }

    // ---- 载入示例 ----
    function loadDemo() {
        suppliers = [
            { id: 'demo_s1', name: '宏达制衣', color: COLORS[0] },
            { id: 'demo_s2', name: '金利服装', color: COLORS[1] },
            { id: 'demo_s3', name: '恒丰工厂', color: COLORS[2] },
        ];
        items = [
            { id: 'demo_i1', name: '裁剪', unit: '件' },
            { id: 'demo_i2', name: '车缝', unit: '件' },
            { id: 'demo_i3', name: '绣花', unit: '件' },
            { id: 'demo_i4', name: '后整', unit: '件' },
            { id: 'demo_i5', name: '包装', unit: '件' },
        ];
        prices = {
            'demo_i1_demo_s1': 2.5, 'demo_i1_demo_s2': 3.0, 'demo_i1_demo_s3': 2.8,
            'demo_i2_demo_s1': 8.0, 'demo_i2_demo_s2': 7.5, 'demo_i2_demo_s3': 7.8,
            'demo_i3_demo_s1': 3.5, 'demo_i3_demo_s2': 4.0, 'demo_i3_demo_s3': 3.0,
            'demo_i4_demo_s1': 2.0, 'demo_i4_demo_s2': 1.8, 'demo_i4_demo_s3': 2.2,
            'demo_i5_demo_s1': 1.5, 'demo_i5_demo_s2': 1.2, 'demo_i5_demo_s3': 1.5,
        };
        customAlloc = {};
        $('#sp-project-name').value = '2024秋季女装外套';
        $('#sp-total-qty').value = 1000;

        renderSupplierChips();
        renderItemsList();
        renderMatrix();
    }

    // ---- 清空 ----
    function clearAll() {
        suppliers = [];
        items = [];
        prices = {};
        customAlloc = {};
        $('#sp-project-name').value = '';
        $('#sp-total-qty').value = 1000;
        renderSupplierChips();
        renderItemsList();
        renderMatrix();
        $('#sp-allocation-section').style.display = 'none';
        $('#sp-custom-section').style.display = 'none';
    }

    // ---- 事件绑定 ----
    function init() {
        $('#btn-add-supplier').addEventListener('click', () => {
            addSupplier($('#sp-new-supplier-name').value);
            $('#sp-new-supplier-name').value = '';
        });
        $('#sp-new-supplier-name').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                addSupplier($('#sp-new-supplier-name').value);
                $('#sp-new-supplier-name').value = '';
            }
        });

        $('#btn-add-sp-item').addEventListener('click', () => {
            addItem($('#sp-new-item-name').value, $('#sp-new-item-unit').value);
            $('#sp-new-item-name').value = '';
        });
        $('#sp-new-item-name').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                addItem($('#sp-new-item-name').value, $('#sp-new-item-unit').value);
                $('#sp-new-item-name').value = '';
            }
        });

        $$('.sp-quick-item').forEach(btn => {
            btn.addEventListener('click', () => {
                addItem(btn.dataset.name, btn.dataset.unit);
            });
        });

        $('#btn-sp-calculate').addEventListener('click', runAnalysis);
        $('#btn-sp-clear').addEventListener('click', clearAll);
        $('#btn-load-sp-demo').addEventListener('click', loadDemo);
    }

    init();
})();
