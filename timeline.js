// ============================================================
// 订单时间计划表（甘特图）模块
// ============================================================

(function () {
    'use strict';

    const ORDER_STORAGE = 'clothing_orders';

    function $(sel) { return document.querySelector(sel); }
    function $$(sel) { return document.querySelectorAll(sel); }
    function escHtml(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
    function generateId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
    function todayStr() { return new Date().toISOString().slice(0, 10); }

    const PLAN_STORAGE = 'clothing_order_plans';

    // 生产阶段模板
    const PHASE_TEMPLATES = [
        { key: 'material', label: '面辅料采购', color: '#8b5cf6', defaultDays: 14 },
        { key: 'sample', label: '样品确认', color: '#06b6d4', defaultDays: 7 },
        { key: 'cutting', label: '裁剪', color: '#f59e0b', defaultDays: 3 },
        { key: 'sewing', label: '缝制', color: '#3b82f6', defaultDays: 14 },
        { key: 'washing', label: '洗水/后整', color: '#a855f7', defaultDays: 3 },
        { key: 'qc', label: '质检', color: '#10b981', defaultDays: 2 },
        { key: 'packing', label: '包装', color: '#22c55e', defaultDays: 2 },
        { key: 'shipping', label: '出货', color: '#6366f1', defaultDays: 1 },
    ];

    function loadPlans() {
        try { return JSON.parse(localStorage.getItem(PLAN_STORAGE)) || []; }
        catch { return []; }
    }
    function savePlans(data) { localStorage.setItem(PLAN_STORAGE, JSON.stringify(data)); }

    function loadOrders() {
        try { return JSON.parse(localStorage.getItem(ORDER_STORAGE)) || []; }
        catch { return []; }
    }

    // ============================================================
    // 计划管理
    // ============================================================
    let editingPlanId = null;

    function createPlanFromTemplate(orderNumber, startDate) {
        const phases = [];
        let currentDate = new Date(startDate);

        PHASE_TEMPLATES.forEach(tpl => {
            const start = new Date(currentDate);
            const end = new Date(currentDate);
            end.setDate(end.getDate() + tpl.defaultDays);

            phases.push({
                key: tpl.key,
                label: tpl.label,
                color: tpl.color,
                startDate: formatDate(start),
                endDate: formatDate(end),
                progress: 0,
                remark: '',
            });

            currentDate = new Date(end);
            currentDate.setDate(currentDate.getDate() + 1);
        });

        return {
            id: generateId(),
            orderNumber: orderNumber,
            phases: phases,
            createdAt: todayStr(),
        };
    }

    function formatDate(d) {
        return d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
    }

    function daysBetween(d1, d2) {
        return Math.ceil((new Date(d2) - new Date(d1)) / (1000 * 60 * 60 * 24));
    }

    // ============================================================
    // 甘特图渲染
    // ============================================================
    function renderGantt() {
        const plans = loadPlans();
        const container = $('#gantt-container');
        if (!container) return;

        if (plans.length === 0) {
            container.innerHTML = '<div class="empty-state" style="padding:40px">暂无时间计划，点击上方按钮创建</div>';
            return;
        }

        // 找出全局日期范围
        let globalStart = null, globalEnd = null;
        plans.forEach(plan => {
            plan.phases.forEach(p => {
                if (!globalStart || p.startDate < globalStart) globalStart = p.startDate;
                if (!globalEnd || p.endDate > globalEnd) globalEnd = p.endDate;
            });
        });

        if (!globalStart || !globalEnd) return;

        // 往前后各扩展几天
        const gStart = new Date(globalStart);
        gStart.setDate(gStart.getDate() - 2);
        const gEnd = new Date(globalEnd);
        gEnd.setDate(gEnd.getDate() + 2);

        const totalDays = daysBetween(formatDate(gStart), formatDate(gEnd));
        if (totalDays <= 0) return;

        const today = todayStr();
        const todayOffset = daysBetween(formatDate(gStart), today);

        // 生成月份/日期头
        let headerHtml = '<div class="gantt-header">';
        headerHtml += '<div class="gantt-label-col">订单 / 阶段</div>';
        headerHtml += '<div class="gantt-timeline-col">';

        // 月份行
        headerHtml += '<div class="gantt-months">';
        let currentMonth = '';
        let monthStart = 0;
        for (let i = 0; i <= totalDays; i++) {
            const d = new Date(gStart);
            d.setDate(d.getDate() + i);
            const monthKey = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
            if (monthKey !== currentMonth) {
                if (currentMonth) {
                    const width = ((i - monthStart) / totalDays) * 100;
                    headerHtml += `<div class="gantt-month" style="width:${width}%">${currentMonth}</div>`;
                }
                currentMonth = monthKey;
                monthStart = i;
            }
        }
        // Last month
        const lastWidth = ((totalDays - monthStart + 1) / totalDays) * 100;
        headerHtml += `<div class="gantt-month" style="width:${lastWidth}%">${currentMonth}</div>`;
        headerHtml += '</div>';

        // 日期行（每5天一个标记）
        headerHtml += '<div class="gantt-days">';
        for (let i = 0; i <= totalDays; i++) {
            const d = new Date(gStart);
            d.setDate(d.getDate() + i);
            if (d.getDate() === 1 || d.getDate() % 5 === 0) {
                const left = (i / totalDays) * 100;
                headerHtml += `<div class="gantt-day-mark" style="left:${left}%">${d.getDate()}</div>`;
            }
        }
        headerHtml += '</div>';
        headerHtml += '</div></div>';

        // 渲染行
        let bodyHtml = '<div class="gantt-body">';

        plans.forEach(plan => {
            // 订单标题行
            const order = loadOrders().find(o => o.orderNumber === plan.orderNumber);
            const orderLabel = plan.orderNumber + (order ? ' - ' + (order.style || '') : '');
            const overallPct = calcOverallProgress(plan);

            bodyHtml += `<div class="gantt-order-group">`;
            bodyHtml += `<div class="gantt-order-title">
                <div class="gantt-label-col">
                    <strong>${escHtml(orderLabel)}</strong>
                    <span class="gantt-overall-pct">${overallPct}%</span>
                    <div class="gantt-order-actions">
                        <button class="btn-icon" title="编辑计划" data-action="edit-plan" data-id="${plan.id}">&#9998;</button>
                        <button class="btn-icon danger" title="删除计划" data-action="delete-plan" data-id="${plan.id}">&#128465;</button>
                    </div>
                </div>
                <div class="gantt-timeline-col"><div class="gantt-row-bg"></div></div>
            </div>`;

            plan.phases.forEach(phase => {
                const startOffset = daysBetween(formatDate(gStart), phase.startDate);
                const duration = daysBetween(phase.startDate, phase.endDate);
                const left = (startOffset / totalDays) * 100;
                const width = Math.max((duration / totalDays) * 100, 0.5);

                const isOverdue = phase.endDate < today && phase.progress < 100;

                bodyHtml += `<div class="gantt-row">
                    <div class="gantt-label-col gantt-phase-label">
                        <span class="gantt-phase-dot" style="background:${phase.color}"></span>
                        ${escHtml(phase.label)}
                        <small class="gantt-phase-dates">${phase.startDate.slice(5)} ~ ${phase.endDate.slice(5)}</small>
                    </div>
                    <div class="gantt-timeline-col">
                        <div class="gantt-row-bg"></div>
                        <div class="gantt-bar ${isOverdue ? 'gantt-bar-overdue' : ''}" style="left:${left}%;width:${width}%;background:${phase.color}">
                            <div class="gantt-bar-fill" style="width:${phase.progress}%;background:rgba(255,255,255,0.3)"></div>
                            <span class="gantt-bar-text">${phase.progress}%</span>
                        </div>
                    </div>
                </div>`;
            });

            bodyHtml += '</div>';
        });

        // 今日线
        if (todayOffset >= 0 && todayOffset <= totalDays) {
            const todayLeft = (todayOffset / totalDays) * 100;
            bodyHtml += `<div class="gantt-today-line" style="left:calc(200px + ${todayLeft}% * (100% - 200px) / 100%)"></div>`;
        }

        bodyHtml += '</div>';

        container.innerHTML = headerHtml + bodyHtml;

        // 今日线（用更简单的方式）
        const todayLeft = (todayOffset / totalDays) * 100;
        const timelineCols = container.querySelectorAll('.gantt-timeline-col');
        timelineCols.forEach(col => {
            const line = document.createElement('div');
            line.className = 'gantt-today-marker';
            line.style.left = todayLeft + '%';
            col.appendChild(line);
        });

        // 绑定事件
        container.querySelectorAll('[data-action="edit-plan"]').forEach(btn => {
            btn.addEventListener('click', () => openPlanEditor(btn.dataset.id));
        });
        container.querySelectorAll('[data-action="delete-plan"]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (!confirm('确定删除此时间计划？')) return;
                const plans = loadPlans().filter(p => p.id !== btn.dataset.id);
                savePlans(plans);
                renderGantt();
            });
        });
    }

    function calcOverallProgress(plan) {
        if (plan.phases.length === 0) return 0;
        const total = plan.phases.reduce((s, p) => s + (p.progress || 0), 0);
        return Math.round(total / plan.phases.length);
    }

    // ============================================================
    // 计划编辑器
    // ============================================================
    function openPlanEditor(planId) {
        const plans = loadPlans();
        const plan = plans.find(p => p.id === planId);
        if (!plan) return;

        editingPlanId = planId;
        $('#plan-modal-title').textContent = '编辑计划 - ' + plan.orderNumber;

        const tbody = $('#plan-phases-body');
        tbody.innerHTML = '';

        plan.phases.forEach((phase, i) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><span class="gantt-phase-dot" style="background:${phase.color}"></span> ${escHtml(phase.label)}</td>
                <td><input type="date" value="${phase.startDate}" data-idx="${i}" data-field="startDate"></td>
                <td><input type="date" value="${phase.endDate}" data-idx="${i}" data-field="endDate"></td>
                <td><input type="range" value="${phase.progress}" min="0" max="100" step="5" data-idx="${i}" data-field="progress" style="width:80px"> <span class="plan-pct-label">${phase.progress}%</span></td>
                <td><input type="text" value="${phase.remark || ''}" data-idx="${i}" data-field="remark" placeholder="备注" style="width:100px"></td>
            `;
            tbody.appendChild(tr);
        });

        // 绑定输入事件
        tbody.querySelectorAll('input').forEach(el => {
            el.addEventListener('input', (e) => {
                const idx = Number(e.target.dataset.idx);
                const field = e.target.dataset.field;
                if (field === 'progress') {
                    plan.phases[idx].progress = Number(e.target.value);
                    e.target.nextElementSibling.textContent = e.target.value + '%';
                } else {
                    plan.phases[idx][field] = e.target.value;
                }
            });
        });

        openModal('plan-modal');
    }

    function savePlanFromModal() {
        const plans = loadPlans();
        // plan was modified in-place via references
        savePlans(plans);
        closeModal('plan-modal');
        renderGantt();
    }

    // ============================================================
    // 新建计划
    // ============================================================
    function openNewPlanDialog() {
        const orders = loadOrders();
        const plans = loadPlans();
        const existingOrderNums = plans.map(p => p.orderNumber);

        // 未创建计划的订单
        const availableOrders = orders.filter(o => !existingOrderNums.includes(o.orderNumber));

        let orderNumber = '';
        if (availableOrders.length > 0) {
            const options = availableOrders.map(o => `${o.orderNumber} - ${o.style || ''} (${o.customerName || ''})`);
            const choice = prompt(
                '选择订单号（输入序号）或直接输入订单号：\n' +
                options.map((o, i) => `${i + 1}. ${o}`).join('\n') +
                '\n\n或直接输入新的订单号：'
            );
            if (choice === null) return;
            const idx = Number(choice) - 1;
            if (idx >= 0 && idx < availableOrders.length) {
                orderNumber = availableOrders[idx].orderNumber;
            } else {
                orderNumber = choice.trim();
            }
        } else {
            orderNumber = prompt('输入订单号：');
            if (!orderNumber) return;
            orderNumber = orderNumber.trim();
        }

        if (!orderNumber) return;

        const startDate = prompt('计划开始日期（YYYY-MM-DD）：', todayStr());
        if (!startDate) return;

        const plan = createPlanFromTemplate(orderNumber, startDate);
        const allPlans = loadPlans();
        allPlans.push(plan);
        savePlans(allPlans);
        renderGantt();
    }

    // ---- Modal helpers ----
    function openModal(id) { $(`#${id}`).classList.add('active'); }
    function closeModal(id) { $(`#${id}`).classList.remove('active'); }

    // ---- 初始化 ----
    function initTimeline() {
        const newBtn = $('#btn-new-plan');
        if (newBtn) newBtn.addEventListener('click', openNewPlanDialog);

        const saveBtn = $('#btn-save-plan');
        if (saveBtn) saveBtn.addEventListener('click', savePlanFromModal);

        const cancelBtn = $('#btn-cancel-plan');
        if (cancelBtn) cancelBtn.addEventListener('click', () => closeModal('plan-modal'));

        const closeBtn = $('#plan-modal-close');
        if (closeBtn) closeBtn.addEventListener('click', () => closeModal('plan-modal'));

        const modal = $('#plan-modal');
        if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeModal('plan-modal'); });
    }

    window.initTimelinePage = function () {
        renderGantt();
    };

    initTimeline();
})();
