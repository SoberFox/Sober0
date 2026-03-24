// ============================================================
// 面料用量计算模块
// ============================================================

(function () {
    'use strict';

    function $(sel) { return document.querySelector(sel); }
    function $$(sel) { return document.querySelectorAll(sel); }

    // ---- 常见面料幅宽 ----
    const FABRIC_WIDTHS = [
        { label: '90cm（窄幅）', value: 90 },
        { label: '110cm', value: 110 },
        { label: '115cm', value: 115 },
        { label: '140cm', value: 140 },
        { label: '148cm（常用）', value: 148 },
        { label: '150cm（常用）', value: 150 },
        { label: '160cm', value: 160 },
        { label: '180cm', value: 180 },
    ];

    // ---- 款式类型参考用量 (单件用量，基于150cm幅宽) ----
    const GARMENT_PRESETS = {
        tshirt: { label: 'T恤', usage: 0.8, lossRate: 5 },
        polo: { label: 'Polo衫', usage: 0.9, lossRate: 5 },
        shirt: { label: '衬衫', usage: 1.2, lossRate: 8 },
        blouse: { label: '女衫', usage: 1.1, lossRate: 8 },
        dress_short: { label: '连衣裙（短）', usage: 1.5, lossRate: 10 },
        dress_long: { label: '连衣裙（长）', usage: 2.2, lossRate: 10 },
        jacket: { label: '夹克/外套', usage: 1.8, lossRate: 10 },
        coat: { label: '大衣', usage: 2.8, lossRate: 12 },
        hoodie: { label: '卫衣/帽衫', usage: 1.5, lossRate: 8 },
        pants: { label: '长裤', usage: 1.4, lossRate: 8 },
        shorts: { label: '短裤', usage: 0.8, lossRate: 5 },
        skirt_short: { label: '短裙', usage: 0.8, lossRate: 8 },
        skirt_long: { label: '长裙', usage: 1.5, lossRate: 10 },
        vest: { label: '背心/马甲', usage: 0.7, lossRate: 5 },
        underwear: { label: '内衣', usage: 0.4, lossRate: 3 },
        sportswear: { label: '运动服（套装）', usage: 2.5, lossRate: 8 },
    };

    // ---- 初始化 ----
    function initFabric() {
        // 幅宽下拉
        const widthSel = $('#fab-width');
        if (widthSel) {
            widthSel.innerHTML = FABRIC_WIDTHS.map(fw =>
                `<option value="${fw.value}" ${fw.value === 150 ? 'selected' : ''}>${fw.label}</option>`
            ).join('') + '<option value="custom">自定义...</option>';
            widthSel.addEventListener('change', () => {
                const customInput = $('#fab-width-custom');
                if (widthSel.value === 'custom') {
                    customInput.style.display = 'inline-block';
                    customInput.focus();
                } else {
                    customInput.style.display = 'none';
                }
                calcFabric();
            });
        }

        // 款式预设按钮
        const presetGrid = $('#garment-presets');
        if (presetGrid) {
            presetGrid.innerHTML = Object.keys(GARMENT_PRESETS).map(k => {
                const p = GARMENT_PRESETS[k];
                return `<button class="btn btn-sm garment-preset-btn" data-key="${k}">${p.label}</button>`;
            }).join('');
            presetGrid.addEventListener('click', (e) => {
                const btn = e.target.closest('.garment-preset-btn');
                if (!btn) return;
                const p = GARMENT_PRESETS[btn.dataset.key];
                if (p) {
                    $('#fab-usage-per').value = p.usage;
                    $('#fab-loss-rate').value = p.lossRate;
                    $$('.garment-preset-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    calcFabric();
                }
            });
        }

        // 绑定计算
        const inputs = ['#fab-usage-per', '#fab-loss-rate', '#fab-width-custom', '#fab-price'];
        inputs.forEach(sel => {
            const el = $(sel);
            if (el) el.addEventListener('input', calcFabric);
        });

        // 尺码配比
        initSizeRatio();
        calcFabric();
    }

    // ---- 尺码配比表 ----
    let sizeRatios = [
        { size: 'S', ratio: 15, quantity: 0 },
        { size: 'M', ratio: 30, quantity: 0 },
        { size: 'L', ratio: 30, quantity: 0 },
        { size: 'XL', ratio: 20, quantity: 0 },
        { size: 'XXL', ratio: 5, quantity: 0 },
    ];

    function initSizeRatio() {
        const totalInput = $('#fab-total-qty');
        if (totalInput) totalInput.addEventListener('input', updateSizeQuantities);

        const addSizeBtn = $('#btn-add-fab-size');
        if (addSizeBtn) addSizeBtn.addEventListener('click', () => {
            const name = prompt('输入尺码名称');
            if (name) {
                sizeRatios.push({ size: name.trim(), ratio: 0, quantity: 0 });
                renderSizeRatios();
            }
        });

        renderSizeRatios();
    }

    function renderSizeRatios() {
        const tbody = $('#size-ratio-body');
        if (!tbody) return;

        tbody.innerHTML = '';
        sizeRatios.forEach((sr, i) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><input type="text" value="${sr.size}" data-idx="${i}" data-field="size" style="width:60px;text-align:center;font-weight:600"></td>
                <td><input type="number" value="${sr.ratio}" data-idx="${i}" data-field="ratio" min="0" max="100" style="width:60px;text-align:center">%</td>
                <td class="size-qty-cell" data-idx="${i}">${sr.quantity}</td>
                <td><button class="btn-remove" data-idx="${i}">&times;</button></td>
            `;
            tbody.appendChild(tr);
        });

        tbody.querySelectorAll('input').forEach(el => {
            el.addEventListener('input', (e) => {
                const idx = Number(e.target.dataset.idx);
                const field = e.target.dataset.field;
                sizeRatios[idx][field] = field === 'size' ? e.target.value : Number(e.target.value) || 0;
                updateSizeQuantities();
            });
        });

        tbody.querySelectorAll('.btn-remove').forEach(el => {
            el.addEventListener('click', (e) => {
                sizeRatios.splice(Number(e.target.dataset.idx), 1);
                renderSizeRatios();
                calcFabric();
            });
        });

        updateSizeQuantities();
    }

    function updateSizeQuantities() {
        const totalQty = Number($('#fab-total-qty').value) || 0;
        const totalRatio = sizeRatios.reduce((s, r) => s + r.ratio, 0);

        sizeRatios.forEach((sr, i) => {
            sr.quantity = totalRatio > 0 ? Math.round(totalQty * sr.ratio / totalRatio) : 0;
            const cell = document.querySelector(`.size-qty-cell[data-idx="${i}"]`);
            if (cell) cell.textContent = sr.quantity;
        });

        // 显示配比总计
        const ratioTotal = $('#ratio-total');
        if (ratioTotal) {
            ratioTotal.textContent = totalRatio + '%';
            ratioTotal.style.color = totalRatio === 100 ? '#10b981' : '#ef4444';
        }

        calcFabric();
    }

    // ---- 面料计算 ----
    function calcFabric() {
        const usagePer = Number($('#fab-usage-per').value) || 0;  // 单件用量（米）
        const lossRate = Number($('#fab-loss-rate').value) || 0;  // 损耗率 %
        const totalQty = Number($('#fab-total-qty').value) || 0;
        const fabricPrice = Number($('#fab-price').value) || 0;   // 面料单价（元/米）
        const widthSel = $('#fab-width');
        const fabricWidth = widthSel.value === 'custom'
            ? (Number($('#fab-width-custom').value) || 150)
            : (Number(widthSel.value) || 150);

        // 幅宽修正系数（基于150cm）
        const widthFactor = 150 / fabricWidth;
        const adjustedUsage = usagePer * widthFactor;

        // 含损耗用量
        const usageWithLoss = adjustedUsage * (1 + lossRate / 100);

        // 总用量
        const totalUsage = usageWithLoss * totalQty;

        // 总成本
        const totalCost = totalUsage * fabricPrice;

        // 码数换算 (1米 = 1.0936码)
        const totalYards = totalUsage * 1.0936;

        // 公斤数估算（按常见面料 200g/m² 估算，用户可以自行判断）
        const estimatedKg = totalUsage * (fabricWidth / 100) * 0.2;

        setText('#res-adjusted-usage', adjustedUsage.toFixed(3) + ' 米/件');
        setText('#res-usage-with-loss', usageWithLoss.toFixed(3) + ' 米/件');
        setText('#res-total-usage', totalUsage.toFixed(1) + ' 米');
        setText('#res-total-yards', totalYards.toFixed(1) + ' 码');
        setText('#res-total-fabric-cost', '¥' + totalCost.toFixed(2));
        setText('#res-cost-per-piece', '¥' + (totalQty > 0 ? (totalCost / totalQty).toFixed(2) : '0.00'));
        setText('#res-width-factor', widthFactor.toFixed(3));

        // 各尺码用量明细
        renderSizeBreakdown(usageWithLoss, fabricPrice);
    }

    function renderSizeBreakdown(usagePerPiece, pricePerMeter) {
        const container = $('#size-breakdown');
        if (!container) return;

        if (sizeRatios.length === 0 || sizeRatios.every(r => r.quantity === 0)) {
            container.innerHTML = '';
            return;
        }

        let html = `<table class="data-table">
            <thead><tr><th>尺码</th><th>数量</th><th>用量(米)</th><th>成本(¥)</th></tr></thead><tbody>`;

        let totalM = 0, totalC = 0;
        sizeRatios.forEach(sr => {
            const m = sr.quantity * usagePerPiece;
            const c = m * pricePerMeter;
            totalM += m;
            totalC += c;
            html += `<tr><td>${sr.size}</td><td>${sr.quantity}</td><td>${m.toFixed(1)}</td><td>${c.toFixed(2)}</td></tr>`;
        });

        html += `<tr style="font-weight:700;border-top:2px solid #333">
            <td>合计</td><td>${sizeRatios.reduce((s, r) => s + r.quantity, 0)}</td>
            <td>${totalM.toFixed(1)}</td><td>${totalC.toFixed(2)}</td></tr>`;
        html += '</tbody></table>';
        container.innerHTML = html;
    }

    function setText(sel, text) {
        const el = $(sel);
        if (el) el.textContent = text;
    }

    window.initFabricPage = function () {
        initFabric();
    };

    initFabric();
})();
