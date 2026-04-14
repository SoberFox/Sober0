// ============================================================
// 面料辅料跟进模块
// ============================================================

(function () {
    'use strict';

    const STORAGE_KEY = 'clothing_materials';

    const MATERIAL_CATEGORIES = ['面料', '里料', '拉链', '纽扣', '织带', '花边', '唛头', '吊牌', '包装材料', '缝纫线', '衬布', '松紧带', '其他'];

    const STATUS_FLOW = [
        { key: 'pending', label: '待下单', color: '#94a3b8', icon: '&#9675;' },
        { key: 'ordered', label: '已下单', color: '#3b82f6', icon: '&#128230;' },
        { key: 'in_transit', label: '运输中', color: '#8b5cf6', icon: '&#128666;' },
        { key: 'arrived', label: '已到货', color: '#f59e0b', icon: '&#128205;' },
        { key: 'qc_pass', label: '质检通过', color: '#10b981', icon: '&#9989;' },
        { key: 'qc_fail', label: '质检不合格', color: '#ef4444', icon: '&#10060;' },
        { key: 'in_use', label: '已投产', color: '#22c55e', icon: '&#9881;' },
    ];

    function $(sel) { return document.querySelector(sel); }
    function $$(sel) { return document.querySelectorAll(sel); }
    function escHtml(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
    function generateId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
    function todayStr() { return new Date().toISOString().slice(0, 10); }

    function loadMaterials() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
        catch { return []; }
    }
    function saveMaterials(data) { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }

    function getStatusInfo(key) { return STATUS_FLOW.find(s => s.key === key) || STATUS_FLOW[0]; }

    // ============================================================
    // 汇总看板
    // ============================================================
    function renderDashboard() {
        const materials = loadMaterials();

        // 按状态统计
        const statusCounts = {};
        STATUS_FLOW.forEach(s => { statusCounts[s.key] = 0; });
        materials.forEach(m => { if (statusCounts[m.status] !== undefined) statusCounts[m.status]++; });

        const dashGrid = $('#mat-dashboard');
        if (dashGrid) {
            dashGrid.innerHTML = STATUS_FLOW.map(s => `
                <div class="mat-dash-card" style="border-top:3px solid ${s.color}">
                    <div class="mat-dash-num">${statusCounts[s.key]}</div>
                    <div class="mat-dash-label">${s.icon} ${s.label}</div>
                </div>
            `).join('');
        }

        // 按订单分组进度
        renderOrderProgress(materials);

        // 预警：即将到期 & 已逾期
        renderAlerts(materials);
    }

    function renderOrderProgress(materials) {
        const container = $('#mat-order-progress');
        if (!container) return;

        // 按订单号分组
        const orderMap = {};
        materials.forEach(m => {
            const key = m.orderNumber || '未关联订单';
            if (!orderMap[key]) orderMap[key] = [];
            orderMap[key].push(m);
        });

        if (Object.keys(orderMap).length === 0) {
            container.innerHTML = '<div class="empty-state" style="padding:20px">暂无跟进记录</div>';
            return;
        }

        let html = '';
        Object.keys(orderMap).forEach(orderNum => {
            const items = orderMap[orderNum];
            const total = items.length;
            const done = items.filter(m => m.status === 'qc_pass' || m.status === 'in_use').length;
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            const hasFail = items.some(m => m.status === 'qc_fail');

            html += `<div class="mat-order-card">
                <div class="mat-order-header">
                    <strong>${escHtml(orderNum)}</strong>
                    <span class="mat-order-pct ${hasFail ? 'has-fail' : ''}" style="color:${pct === 100 ? '#10b981' : 'var(--text)'}">${pct}% 齐料</span>
                </div>
                <div class="mat-progress-bar">
                    <div class="mat-progress-fill" style="width:${pct}%;background:${pct === 100 ? '#10b981' : hasFail ? '#ef4444' : 'var(--primary)'}"></div>
                </div>
                <div class="mat-order-items">`;

            items.forEach(m => {
                const info = getStatusInfo(m.status);
                html += `<span class="mat-mini-badge" style="background:${info.color}" title="${m.name} - ${info.label}">${escHtml(m.name.slice(0, 4))}</span>`;
            });

            html += `</div></div>`;
        });

        container.innerHTML = html;
    }

    function renderAlerts(materials) {
        const container = $('#mat-alerts');
        if (!container) return;

        const today = new Date(todayStr());
        const alerts = [];

        materials.forEach(m => {
            if (!m.expectedDate || m.status === 'qc_pass' || m.status === 'in_use') return;
            const expected = new Date(m.expectedDate);
            const diffDays = Math.ceil((expected - today) / (1000 * 60 * 60 * 24));

            if (diffDays < 0) {
                alerts.push({ type: 'overdue', days: Math.abs(diffDays), material: m });
            } else if (diffDays <= 3) {
                alerts.push({ type: 'urgent', days: diffDays, material: m });
            }
        });

        if (alerts.length === 0) {
            container.innerHTML = '<div style="color:var(--success);font-size:13px;padding:8px">所有物料进度正常</div>';
            return;
        }

        alerts.sort((a, b) => (a.type === 'overdue' ? -1 : 1) - (b.type === 'overdue' ? -1 : 1) || a.days - b.days);

        container.innerHTML = alerts.map(a => {
            const m = a.material;
            if (a.type === 'overdue') {
                return `<div class="mat-alert alert-overdue">
                    <span class="alert-icon">&#9888;</span>
                    <span><strong>${escHtml(m.name)}</strong>（${escHtml(m.orderNumber || '-')}）已逾期 <strong>${a.days}</strong> 天，当前状态：${getStatusInfo(m.status).label}</span>
                </div>`;
            }
            return `<div class="mat-alert alert-urgent">
                <span class="alert-icon">&#9200;</span>
                <span><strong>${escHtml(m.name)}</strong>（${escHtml(m.orderNumber || '-')}）还有 <strong>${a.days}</strong> 天到期</span>
            </div>`;
        }).join('');
    }

    // ============================================================
    // 物料明细列表
    // ============================================================
    function renderMaterialList(filter) {
        let materials = loadMaterials();

        const catFilter = $('#mat-cat-filter') ? $('#mat-cat-filter').value : '';
        const statusFilter = $('#mat-status-filter') ? $('#mat-status-filter').value : '';

        if (filter) {
            const q = filter.toLowerCase();
            materials = materials.filter(m =>
                (m.name || '').toLowerCase().includes(q) ||
                (m.supplier || '').toLowerCase().includes(q) ||
                (m.orderNumber || '').toLowerCase().includes(q) ||
                (m.color || '').toLowerCase().includes(q)
            );
        }
        if (catFilter) materials = materials.filter(m => m.category === catFilter);
        if (statusFilter) materials = materials.filter(m => m.status === statusFilter);

        const tbody = $('#mat-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (materials.length === 0) {
            $('#mat-table').style.display = 'none';
            $('#mat-empty').style.display = 'block';
            return;
        }

        $('#mat-table').style.display = 'table';
        $('#mat-empty').style.display = 'none';

        materials.forEach(m => {
            const info = getStatusInfo(m.status);
            const overdue = isOverdue(m);
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escHtml(m.orderNumber) || '-'}</td>
                <td><span class="mat-cat-tag">${escHtml(m.category)}</span></td>
                <td><strong>${escHtml(m.name)}</strong>${m.color ? '<br><small style="color:var(--text-secondary)">' + escHtml(m.color) + '</small>' : ''}</td>
                <td>${escHtml(m.supplier) || '-'}</td>
                <td>${m.quantity ? m.quantity + ' ' + (m.unit || '') : '-'}</td>
                <td><span class="order-status-badge" style="background:${info.color}">${info.icon} ${info.label}</span></td>
                <td>${escHtml(m.orderDate) || '-'}</td>
                <td class="${overdue ? 'overdue-text' : ''}">${escHtml(m.expectedDate) || '-'}</td>
                <td>${escHtml(m.actualDate) || '-'}</td>
                <td class="actions">
                    <button class="btn-icon" title="编辑" data-action="edit" data-id="${m.id}">&#9998;</button>
                    <button class="btn-icon" title="推进" data-action="advance" data-id="${m.id}">&#9654;</button>
                    <button class="btn-icon danger" title="删除" data-action="delete" data-id="${m.id}">&#128465;</button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        tbody.querySelectorAll('.btn-icon').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                const id = btn.dataset.id;
                if (action === 'edit') editMaterial(id);
                if (action === 'advance') advanceMaterial(id);
                if (action === 'delete') deleteMaterial(id);
            });
        });
    }

    function isOverdue(m) {
        if (!m.expectedDate || m.status === 'qc_pass' || m.status === 'in_use') return false;
        return new Date(m.expectedDate) < new Date(todayStr());
    }

    // ============================================================
    // 新建/编辑物料
    // ============================================================
    let editingMaterialId = null;

    function openMaterialModal(material) {
        editingMaterialId = material ? material.id : null;
        $('#mat-modal-title').textContent = material ? '编辑物料' : '新增物料';

        // 填充类别下拉
        const catSel = $('#mat-category');
        catSel.innerHTML = MATERIAL_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('');

        $('#mat-order-num').value = material ? (material.orderNumber || '') : '';
        catSel.value = material ? (material.category || '面料') : '面料';
        $('#mat-name').value = material ? (material.name || '') : '';
        $('#mat-color').value = material ? (material.color || '') : '';
        $('#mat-supplier').value = material ? (material.supplier || '') : '';
        $('#mat-mat-quantity').value = material ? (material.quantity || '') : '';
        $('#mat-unit').value = material ? (material.unit || '') : '';
        $('#mat-mat-price').value = material ? (material.price || '') : '';
        $('#mat-order-date').value = material ? (material.orderDate || '') : todayStr();
        $('#mat-expected-date').value = material ? (material.expectedDate || '') : '';
        $('#mat-actual-date').value = material ? (material.actualDate || '') : '';
        $('#mat-mat-status').value = material ? (material.status || 'pending') : 'pending';
        $('#mat-remark').value = material ? (material.remark || '') : '';

        openModal('material-modal');
    }

    function saveMaterialFromModal() {
        const name = $('#mat-name').value.trim();
        if (!name) { alert('请填写物料名称'); return; }

        const materials = loadMaterials();
        const data = {
            orderNumber: $('#mat-order-num').value.trim(),
            category: $('#mat-category').value,
            name: name,
            color: $('#mat-color').value.trim(),
            supplier: $('#mat-supplier').value.trim(),
            quantity: Number($('#mat-mat-quantity').value) || 0,
            unit: $('#mat-unit').value.trim(),
            price: Number($('#mat-mat-price').value) || 0,
            orderDate: $('#mat-order-date').value,
            expectedDate: $('#mat-expected-date').value,
            actualDate: $('#mat-actual-date').value,
            status: $('#mat-mat-status').value,
            remark: $('#mat-remark').value.trim(),
        };

        if (editingMaterialId) {
            const idx = materials.findIndex(m => m.id === editingMaterialId);
            if (idx >= 0) {
                data.id = editingMaterialId;
                materials[idx] = data;
            }
        } else {
            data.id = generateId();
            materials.unshift(data);
        }

        saveMaterials(materials);
        closeModal('material-modal');
        renderDashboard();
        renderMaterialList();
    }

    function editMaterial(id) {
        const m = loadMaterials().find(m => m.id === id);
        if (m) openMaterialModal(m);
    }

    function advanceMaterial(id) {
        const materials = loadMaterials();
        const m = materials.find(m => m.id === id);
        if (!m) return;

        const idx = STATUS_FLOW.findIndex(s => s.key === m.status);
        // Skip qc_fail when advancing normally
        let nextIdx = idx + 1;
        if (nextIdx < STATUS_FLOW.length && STATUS_FLOW[nextIdx].key === 'qc_fail') nextIdx++;
        if (nextIdx >= STATUS_FLOW.length) { alert('已是最终状态'); return; }

        const next = STATUS_FLOW[nextIdx];
        if (!confirm(`将「${m.name}」推进到「${next.label}」？`)) return;

        m.status = next.key;
        if (next.key === 'arrived' && !m.actualDate) m.actualDate = todayStr();

        saveMaterials(materials);
        renderDashboard();
        renderMaterialList();
    }

    function deleteMaterial(id) {
        if (!confirm('确定删除此物料记录？')) return;
        const materials = loadMaterials().filter(m => m.id !== id);
        saveMaterials(materials);
        renderDashboard();
        renderMaterialList();
    }

    // ---- 批量添加常用辅料 ----
    function batchAddAccessories(orderNumber) {
        const common = [
            { category: '面料', name: '主面料', unit: '米' },
            { category: '里料', name: '里布', unit: '米' },
            { category: '衬布', name: '粘合衬', unit: '米' },
            { category: '拉链', name: '主拉链', unit: '条' },
            { category: '纽扣', name: '纽扣', unit: '颗' },
            { category: '缝纫线', name: '缝纫线', unit: '卷' },
            { category: '唛头', name: '主唛+洗水唛', unit: '套' },
            { category: '吊牌', name: '吊牌', unit: '套' },
            { category: '包装材料', name: '包装袋', unit: '个' },
        ];

        const materials = loadMaterials();
        common.forEach(item => {
            materials.unshift({
                id: generateId(),
                orderNumber: orderNumber,
                category: item.category,
                name: item.name,
                color: '',
                supplier: '',
                quantity: 0,
                unit: item.unit,
                price: 0,
                orderDate: '',
                expectedDate: '',
                actualDate: '',
                status: 'pending',
                remark: '',
            });
        });
        saveMaterials(materials);
        renderDashboard();
        renderMaterialList();
    }

    // ---- Modal helpers ----
    function openModal(id) { $(`#${id}`).classList.add('active'); }
    function closeModal(id) { $(`#${id}`).classList.remove('active'); }

    // ---- 事件绑定 ----
    function initMaterials() {
        const addBtn = $('#btn-add-material');
        if (addBtn) addBtn.addEventListener('click', () => openMaterialModal(null));

        const batchBtn = $('#btn-batch-add-mat');
        if (batchBtn) batchBtn.addEventListener('click', () => {
            const orderNum = prompt('输入关联的订单号（可留空）');
            if (orderNum !== null) batchAddAccessories(orderNum.trim());
        });

        const saveBtn = $('#btn-save-material');
        if (saveBtn) saveBtn.addEventListener('click', saveMaterialFromModal);

        const cancelBtn = $('#btn-cancel-material');
        if (cancelBtn) cancelBtn.addEventListener('click', () => closeModal('material-modal'));

        const closeBtn = $('#material-modal-close');
        if (closeBtn) closeBtn.addEventListener('click', () => closeModal('material-modal'));

        const searchInput = $('#mat-search');
        if (searchInput) searchInput.addEventListener('input', (e) => renderMaterialList(e.target.value));

        const catFilter = $('#mat-cat-filter');
        if (catFilter) {
            catFilter.innerHTML = '<option value="">全部类别</option>' +
                MATERIAL_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('');
            catFilter.addEventListener('change', () => renderMaterialList($('#mat-search') ? $('#mat-search').value : ''));
        }

        const statusFilter = $('#mat-status-filter');
        if (statusFilter) {
            statusFilter.innerHTML = '<option value="">全部状态</option>' +
                STATUS_FLOW.map(s => `<option value="${s.key}">${s.label}</option>`).join('');
            statusFilter.addEventListener('change', () => renderMaterialList($('#mat-search') ? $('#mat-search').value : ''));
        }

        const modal = $('#material-modal');
        if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeModal('material-modal'); });
    }

    window.initMaterialsPage = function () {
        renderDashboard();
        renderMaterialList();
    };

    initMaterials();
})();
