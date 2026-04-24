// ============================================================
// 订单跟踪模块
// ============================================================

(function () {
    'use strict';

    const STORAGE_KEY = 'clothing_orders';
    const STATUS_FLOW = [
        { key: 'confirmed', label: '已确认', icon: '&#9989;', color: '#3b82f6' },
        { key: 'cutting', label: '裁剪中', icon: '&#9986;', color: '#8b5cf6' },
        { key: 'sewing', label: '缝制中', icon: '&#129525;', color: '#f59e0b' },
        { key: 'qc', label: '质检中', icon: '&#128270;', color: '#06b6d4' },
        { key: 'packing', label: '包装中', icon: '&#128230;', color: '#10b981' },
        { key: 'shipped', label: '已出货', icon: '&#128674;', color: '#6366f1' },
        { key: 'delivered', label: '已签收', icon: '&#127968;', color: '#22c55e' },
    ];

    function $(sel) { return document.querySelector(sel); }
    function $$(sel) { return document.querySelectorAll(sel); }

    function loadOrders() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
        catch { return []; }
    }

    function saveOrders(orders) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
    }

    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    function generateOrderNumber() {
        const d = new Date();
        const dateStr = d.getFullYear().toString().slice(2) +
            String(d.getMonth() + 1).padStart(2, '0') +
            String(d.getDate()).padStart(2, '0');
        const seq = String(loadOrders().length + 1).padStart(3, '0');
        return 'PO' + dateStr + seq;
    }

    function todayStr() { return new Date().toISOString().slice(0, 10); }

    function escHtml(s) {
        const d = document.createElement('div');
        d.textContent = s || '';
        return d.innerHTML;
    }

    function getStatusIndex(status) {
        return STATUS_FLOW.findIndex(s => s.key === status);
    }

    function getStatusInfo(status) {
        return STATUS_FLOW.find(s => s.key === status) || STATUS_FLOW[0];
    }

    // ---- 渲染订单列表 ----
    function renderOrders(filter) {
        let orders = loadOrders();
        const statusFilter = $('#order-status-filter') ? $('#order-status-filter').value : '';

        if (filter) {
            const q = filter.toLowerCase();
            orders = orders.filter(o =>
                (o.orderNumber || '').toLowerCase().includes(q) ||
                (o.customerName || '').toLowerCase().includes(q) ||
                (o.style || '').toLowerCase().includes(q)
            );
        }

        if (statusFilter) {
            orders = orders.filter(o => o.status === statusFilter);
        }

        // 统计卡片
        renderStatusCards(loadOrders());

        const tbody = $('#order-body');
        tbody.innerHTML = '';

        if (orders.length === 0) {
            $('#order-table').style.display = 'none';
            $('#order-empty').style.display = 'block';
            return;
        }

        $('#order-table').style.display = 'table';
        $('#order-empty').style.display = 'none';

        orders.forEach(order => {
            const tr = document.createElement('tr');
            const info = getStatusInfo(order.status);
            const deadlineCls = isOverdue(order) ? ' overdue-text' : '';

            tr.innerHTML = `
                <td><strong>${escHtml(order.orderNumber)}</strong></td>
                <td>${escHtml(order.customerName) || '-'}</td>
                <td>${escHtml(order.style)}${(order.attachments && order.attachments.length) ? `<span class="ord-attach-dot" title="${order.attachments.length} 张图">&#128206;${order.attachments.length}</span>` : ''}</td>
                <td>${order.quantity || '-'}</td>
                <td><span class="order-status-badge" style="background:${info.color}">${info.icon} ${info.label}</span></td>
                <td class="${deadlineCls}">${escHtml(order.deadline) || '-'}</td>
                <td>${escHtml(order.orderDate)}</td>
                <td class="actions">
                    <button class="btn-icon" title="查看/编辑" data-action="edit" data-id="${order.id}">&#9998;</button>
                    <button class="btn-icon" title="推进状态" data-action="advance" data-id="${order.id}">&#9654;</button>
                    <button class="btn-icon danger" title="删除" data-action="delete" data-id="${order.id}">&#128465;</button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        tbody.querySelectorAll('.btn-icon').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                const id = btn.dataset.id;
                if (action === 'edit') editOrder(id);
                if (action === 'advance') advanceOrder(id);
                if (action === 'delete') deleteOrder(id);
            });
        });
    }

    function isOverdue(order) {
        if (!order.deadline || order.status === 'delivered') return false;
        return new Date(order.deadline) < new Date(todayStr());
    }

    function renderStatusCards(allOrders) {
        const grid = $('#order-status-cards');
        if (!grid) return;

        const counts = {};
        STATUS_FLOW.forEach(s => { counts[s.key] = 0; });
        allOrders.forEach(o => { if (counts[o.status] !== undefined) counts[o.status]++; });

        grid.innerHTML = STATUS_FLOW.map(s => `
            <div class="order-stat-card" style="border-left: 4px solid ${s.color}">
                <div class="order-stat-num">${counts[s.key]}</div>
                <div class="order-stat-label">${s.icon} ${s.label}</div>
            </div>
        `).join('');
    }

    // ---- 新建/编辑订单 ----
    let editingOrderId = null;
    let editingAttachments = []; // base64 dataURLs

    function openOrderModal(order) {
        editingOrderId = order ? order.id : null;
        editingAttachments = order && Array.isArray(order.attachments) ? order.attachments.slice() : [];
        $('#order-modal-title').textContent = order ? '编辑订单' : '新建订单';

        $('#ord-number').value = order ? order.orderNumber : generateOrderNumber();
        $('#ord-date').value = order ? order.orderDate : todayStr();
        $('#ord-customer').value = order ? (order.customerName || '') : '';
        $('#ord-style').value = order ? (order.style || '') : '';
        $('#ord-quantity').value = order ? (order.quantity || '') : '';
        $('#ord-unit-price').value = order ? (order.unitPrice || '') : '';
        $('#ord-deadline').value = order ? (order.deadline || '') : '';
        $('#ord-status').value = order ? order.status : 'confirmed';
        $('#ord-remark').value = order ? (order.remark || '') : '';
        $('#ord-buyer').value = order ? (order.buyer || '') : '';
        $('#ord-destination').value = order ? (order.destination || '') : '';
        $('#ord-payment').value = order ? (order.paymentTerms || '') : '';

        renderTimeline(order);
        renderAttachments();

        openModal('order-modal');
    }

    // ---- 附图 ----
    const MAX_IMG_DIM = 1600;  // 压缩到最长边 1600px
    const IMG_QUALITY = 0.82;

    function compressImage(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const reader = new FileReader();
            reader.onload = e => { img.src = e.target.result; };
            reader.onerror = reject;
            img.onload = () => {
                let { width: w, height: h } = img;
                if (w > MAX_IMG_DIM || h > MAX_IMG_DIM) {
                    const scale = MAX_IMG_DIM / Math.max(w, h);
                    w = Math.round(w * scale);
                    h = Math.round(h * scale);
                }
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', IMG_QUALITY));
            };
            img.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    async function addFiles(files) {
        for (const f of files) {
            if (!f.type || !f.type.startsWith('image/')) continue;
            try {
                const b64 = await compressImage(f);
                editingAttachments.push(b64);
            } catch (e) {
                console.warn('[attach] fail', e);
            }
        }
        renderAttachments();
    }

    function renderAttachments() {
        const grid = $('#ord-attach-grid');
        const drop = $('#ord-attach-drop');
        if (!grid || !drop) return;
        // 清理除 dropzone 和 input 之外的 item
        Array.from(grid.querySelectorAll('.attach-item')).forEach(el => el.remove());
        editingAttachments.forEach((src, i) => {
            const el = document.createElement('div');
            el.className = 'attach-item';
            el.innerHTML = `<img src="${src}" alt="attachment ${i + 1}">
                <button class="attach-item-rm" data-i="${i}" title="删除">&times;</button>`;
            el.addEventListener('click', (e) => {
                if (e.target.classList.contains('attach-item-rm')) return;
                showImagePreview(src);
            });
            el.querySelector('.attach-item-rm').addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = Number(e.currentTarget.dataset.i);
                editingAttachments.splice(idx, 1);
                renderAttachments();
            });
            grid.insertBefore(el, drop);
        });
    }

    function bindAttachInputs() {
        const drop = $('#ord-attach-drop');
        const file = $('#ord-attach-file');
        if (!drop || !file || drop.__bound) return;
        drop.__bound = true;
        drop.addEventListener('click', () => file.click());
        file.addEventListener('change', (e) => {
            addFiles(e.target.files);
            e.target.value = '';
        });
        ['dragover', 'dragenter'].forEach(ev =>
            drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag-over'); })
        );
        ['dragleave', 'drop'].forEach(ev =>
            drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag-over'); })
        );
        drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

        // 粘贴 (需要 modal 激活状态)
        document.addEventListener('paste', (e) => {
            const modal = document.getElementById('order-modal');
            if (!modal || !modal.classList.contains('active')) return;
            const items = (e.clipboardData || {}).items || [];
            const imgs = Array.from(items)
                .filter(it => it.type && it.type.startsWith('image/'))
                .map(it => it.getAsFile())
                .filter(Boolean);
            if (imgs.length) { e.preventDefault(); addFiles(imgs); }
        });
    }

    function showImagePreview(src) {
        let ov = document.getElementById('img-preview-overlay');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'img-preview-overlay';
            ov.className = 'img-preview-overlay';
            ov.innerHTML = '<img />';
            ov.addEventListener('click', () => ov.classList.remove('open'));
            document.body.appendChild(ov);
        }
        ov.querySelector('img').src = src;
        ov.classList.add('open');
    }

    function renderTimeline(order) {
        const container = $('#order-timeline');
        if (!container) return;
        const currentIdx = order ? getStatusIndex(order.status) : 0;
        const history = (order && order.statusHistory) || [];

        container.innerHTML = STATUS_FLOW.map((s, i) => {
            let cls = 'timeline-step';
            if (i < currentIdx) cls += ' done';
            else if (i === currentIdx) cls += ' current';

            const histItem = history.find(h => h.status === s.key);
            const dateStr = histItem ? histItem.date : '';

            return `<div class="${cls}">
                <div class="timeline-dot" style="background:${i <= currentIdx ? s.color : '#cbd5e1'}"></div>
                <div class="timeline-info">
                    <div class="timeline-label">${s.icon} ${s.label}</div>
                    <div class="timeline-date">${dateStr}</div>
                </div>
            </div>`;
        }).join('<div class="timeline-line"></div>');
    }

    function saveOrderFromModal() {
        const customerName = $('#ord-customer').value.trim();
        const style = $('#ord-style').value.trim();

        if (!style) { alert('请填写款式名称'); return; }

        const orders = loadOrders();

        const data = {
            orderNumber: $('#ord-number').value,
            orderDate: $('#ord-date').value,
            customerName,
            style,
            quantity: Number($('#ord-quantity').value) || 0,
            unitPrice: Number($('#ord-unit-price').value) || 0,
            deadline: $('#ord-deadline').value,
            status: $('#ord-status').value,
            remark: $('#ord-remark').value.trim(),
            buyer: $('#ord-buyer').value.trim(),
            destination: $('#ord-destination').value.trim(),
            paymentTerms: $('#ord-payment').value.trim(),
            attachments: editingAttachments.slice(),
        };

        if (editingOrderId) {
            const idx = orders.findIndex(o => o.id === editingOrderId);
            if (idx >= 0) {
                const old = orders[idx];
                data.id = editingOrderId;
                data.statusHistory = old.statusHistory || [];
                // 如果状态变了，记录
                if (old.status !== data.status) {
                    data.statusHistory.push({ status: data.status, date: todayStr() });
                }
                orders[idx] = data;
            }
        } else {
            data.id = generateId();
            data.statusHistory = [{ status: data.status, date: todayStr() }];
            orders.unshift(data);
        }

        saveOrders(orders);
        closeModal('order-modal');
        renderOrders();
    }

    function editOrder(id) {
        const orders = loadOrders();
        const order = orders.find(o => o.id === id);
        if (order) openOrderModal(order);
    }

    function advanceOrder(id) {
        const orders = loadOrders();
        const order = orders.find(o => o.id === id);
        if (!order) return;

        const idx = getStatusIndex(order.status);
        if (idx >= STATUS_FLOW.length - 1) {
            alert('订单已完成，无法继续推进');
            return;
        }

        const next = STATUS_FLOW[idx + 1];
        if (!confirm(`确认将订单 ${order.orderNumber} 推进到「${next.label}」？`)) return;

        order.status = next.key;
        if (!order.statusHistory) order.statusHistory = [];
        order.statusHistory.push({ status: next.key, date: todayStr() });

        saveOrders(orders);
        renderOrders();
    }

    function deleteOrder(id) {
        if (!confirm('确定删除此订单？')) return;
        let orders = loadOrders();
        orders = orders.filter(o => o.id !== id);
        saveOrders(orders);
        renderOrders();
    }

    // ---- 从报价转订单 ----
    window.createOrderFromQuote = function (quoteData) {
        const order = {
            id: generateId(),
            orderNumber: generateOrderNumber(),
            orderDate: todayStr(),
            customerName: quoteData.customerName || '',
            style: quoteData.style || '',
            quantity: quoteData.quantity || 0,
            unitPrice: quoteData.unitPrice || 0,
            deadline: '',
            status: 'confirmed',
            remark: '从报价 ' + (quoteData.quoteNumber || '') + ' 转入',
            buyer: '',
            destination: '',
            paymentTerms: '',
            statusHistory: [{ status: 'confirmed', date: todayStr() }],
        };
        const orders = loadOrders();
        orders.unshift(order);
        saveOrders(orders);
        alert('已创建订单 ' + order.orderNumber);
    };

    // ---- Modal helpers ----
    function openModal(id) { $(`#${id}`).classList.add('active'); }
    function closeModal(id) { $(`#${id}`).classList.remove('active'); }

    // ---- 事件绑定 ----
    function initOrders() {
        const addBtn = $('#btn-add-order');
        if (addBtn) addBtn.addEventListener('click', () => openOrderModal(null));
        bindAttachInputs();

        const saveBtn = $('#btn-save-order');
        if (saveBtn) saveBtn.addEventListener('click', saveOrderFromModal);

        const cancelBtn = $('#btn-cancel-order');
        if (cancelBtn) cancelBtn.addEventListener('click', () => closeModal('order-modal'));

        const closeBtn = $('#order-modal-close');
        if (closeBtn) closeBtn.addEventListener('click', () => closeModal('order-modal'));

        const searchInput = $('#order-search');
        if (searchInput) searchInput.addEventListener('input', (e) => renderOrders(e.target.value));

        const statusFilter = $('#order-status-filter');
        if (statusFilter) statusFilter.addEventListener('change', () => renderOrders($('#order-search') ? $('#order-search').value : ''));

        // 点击遮罩关闭
        const modal = $('#order-modal');
        if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeModal('order-modal'); });
    }

    // 暴露给导航系统
    window.initOrdersPage = function () {
        renderOrders();
    };

    initOrders();
})();
