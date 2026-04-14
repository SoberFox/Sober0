// ============================================================
// 装箱计算器模块
// ============================================================

(function () {
    'use strict';

    function $(sel) { return document.querySelector(sel); }

    // 集装箱内部尺寸 (cm)
    const CONTAINERS = {
        '20GP': { name: "20' 普柜", length: 590, width: 235, height: 239, maxWeight: 21700, cbm: 33.2 },
        '40GP': { name: "40' 普柜", length: 1203, width: 235, height: 239, maxWeight: 26500, cbm: 67.7 },
        '40HQ': { name: "40' 高柜", length: 1203, width: 235, height: 269, maxWeight: 26500, cbm: 76.3 },
        '45HQ': { name: "45' 高柜", length: 1360, width: 235, height: 269, maxWeight: 25600, cbm: 86.0 },
    };

    // ---- 纸箱CBM计算 ----
    function initPacking() {
        const fields = ['#box-length', '#box-width', '#box-height', '#box-qty-per',
            '#box-gross-weight', '#total-pieces', '#container-type'];

        fields.forEach(sel => {
            const el = $(sel);
            if (el) el.addEventListener('input', calcPacking);
            if (el) el.addEventListener('change', calcPacking);
        });

        // 填充集装箱选项
        const contSel = $('#container-type');
        if (contSel) {
            contSel.innerHTML = Object.keys(CONTAINERS).map(k =>
                `<option value="${k}" ${k === '40HQ' ? 'selected' : ''}>${CONTAINERS[k].name} (${CONTAINERS[k].cbm}m³)</option>`
            ).join('');
        }

        // 常用纸箱规格快速填充
        const presets = $('#box-presets');
        if (presets) {
            presets.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-preset]');
                if (!btn) return;
                const p = JSON.parse(btn.dataset.preset);
                if (p.l) $('#box-length').value = p.l;
                if (p.w) $('#box-width').value = p.w;
                if (p.h) $('#box-height').value = p.h;
                if (p.qty) $('#box-qty-per').value = p.qty;
                calcPacking();
            });
        }

        calcPacking();

        // ---- 混装计算 ----
        initMixedPacking();
    }

    function calcPacking() {
        const l = Number($('#box-length').value) || 0;  // cm
        const w = Number($('#box-width').value) || 0;
        const h = Number($('#box-height').value) || 0;
        const qtyPerBox = Number($('#box-qty-per').value) || 1;
        const grossWeight = Number($('#box-gross-weight').value) || 0; // kg
        const totalPieces = Number($('#total-pieces').value) || 0;
        const containerKey = $('#container-type').value;
        const container = CONTAINERS[containerKey];

        // 单箱CBM
        const boxCbm = (l * w * h) / 1000000; // cm³ → m³
        const boxVolumeWeight = boxCbm * 1000 / 6; // 体积重 (1cbm = 166.67kg)

        // 需要多少箱
        const totalBoxes = totalPieces > 0 ? Math.ceil(totalPieces / qtyPerBox) : 0;
        const totalCbm = boxCbm * totalBoxes;
        const totalGross = grossWeight * totalBoxes;

        // 集装箱装载
        let boxesPerContainer = 0;
        if (container && boxCbm > 0) {
            // 按体积
            const byVolume = Math.floor(container.cbm / boxCbm);
            // 按重量
            const byWeight = grossWeight > 0 ? Math.floor(container.maxWeight / grossWeight) : Infinity;
            boxesPerContainer = Math.min(byVolume, byWeight);
        }

        const containersNeeded = boxesPerContainer > 0 ? Math.ceil(totalBoxes / boxesPerContainer) : 0;
        const fillRate = boxesPerContainer > 0 && container ? ((boxesPerContainer * boxCbm / container.cbm) * 100) : 0;

        // 显示结果
        setText('#res-box-cbm', boxCbm.toFixed(4) + ' m³');
        setText('#res-total-boxes', totalBoxes.toLocaleString() + ' 箱');
        setText('#res-total-cbm', totalCbm.toFixed(2) + ' m³');
        setText('#res-total-weight', totalGross.toFixed(1) + ' kg');
        setText('#res-boxes-per-container', boxesPerContainer.toLocaleString() + ' 箱');
        setText('#res-pieces-per-container', (boxesPerContainer * qtyPerBox).toLocaleString() + ' 件');
        setText('#res-containers-needed', containersNeeded > 0 ? containersNeeded + ' 个' : '-');
        setText('#res-fill-rate', fillRate.toFixed(1) + '%');

        // 填充率颜色
        const fillEl = $('#res-fill-rate');
        if (fillEl) {
            fillEl.className = 'pack-result-val ' +
                (fillRate >= 80 ? 'fill-good' : fillRate >= 60 ? 'fill-ok' : 'fill-low');
        }

        // 可视化
        renderContainerVisual(boxesPerContainer, container, boxCbm);
    }

    function setText(sel, text) {
        const el = $(sel);
        if (el) el.textContent = text;
    }

    function renderContainerVisual(boxCount, container, boxCbm) {
        const canvas = $('#container-visual');
        if (!canvas || !container) return;

        const ctx = canvas.getContext('2d');
        const W = canvas.width;
        const H = canvas.height;
        ctx.clearRect(0, 0, W, H);

        // 画集装箱轮廓
        const pad = 20;
        const cW = W - pad * 2;
        const cH = H - pad * 2;

        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 2;
        ctx.strokeRect(pad, pad, cW, cH);

        // 填充箱子
        if (boxCount <= 0 || !boxCbm) return;
        const fillRatio = Math.min((boxCount * boxCbm) / container.cbm, 1);
        const fillWidth = cW * fillRatio;

        ctx.fillStyle = fillRatio >= 0.8 ? '#10b981' : fillRatio >= 0.6 ? '#f59e0b' : '#ef4444';
        ctx.globalAlpha = 0.3;
        ctx.fillRect(pad, pad, fillWidth, cH);
        ctx.globalAlpha = 1;

        // 网格线模拟箱子
        const cols = Math.ceil(Math.sqrt(boxCount * 2));
        const rows = Math.ceil(boxCount / cols);
        const bw = fillWidth / cols;
        const bh = cH / rows;

        ctx.strokeStyle = ctx.fillStyle;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1;
        let drawn = 0;
        for (let r = 0; r < rows && drawn < boxCount; r++) {
            for (let c = 0; c < cols && drawn < boxCount; c++) {
                ctx.strokeRect(pad + c * bw, pad + r * bh, bw, bh);
                drawn++;
            }
        }
        ctx.globalAlpha = 1;

        // 标注
        ctx.fillStyle = '#1e293b';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${boxCount} 箱 / ${container.name}`, W / 2, H - 4);
    }

    // ============================================================
    // 混装计算 - 多款式装一个柜
    // ============================================================
    let mixedItems = [];

    function initMixedPacking() {
        const addBtn = $('#btn-add-mix-item');
        if (addBtn) addBtn.addEventListener('click', () => {
            mixedItems.push({
                id: Date.now().toString(36),
                style: '',
                boxL: 60, boxW: 40, boxH: 30,
                qtyPerBox: 20,
                grossWeight: 12,
                totalPieces: 0,
            });
            renderMixedTable();
        });

        const clearBtn = $('#btn-clear-mix');
        if (clearBtn) clearBtn.addEventListener('click', () => {
            mixedItems = [];
            renderMixedTable();
        });
    }

    function renderMixedTable() {
        const tbody = $('#mix-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        mixedItems.forEach(item => {
            const boxCbm = (item.boxL * item.boxW * item.boxH) / 1000000;
            const totalBoxes = item.totalPieces > 0 ? Math.ceil(item.totalPieces / item.qtyPerBox) : 0;
            const totalCbm = boxCbm * totalBoxes;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><input type="text" value="${item.style}" data-id="${item.id}" data-field="style" placeholder="款号" style="width:80px"></td>
                <td><input type="number" value="${item.boxL}" data-id="${item.id}" data-field="boxL" style="width:50px"></td>
                <td><input type="number" value="${item.boxW}" data-id="${item.id}" data-field="boxW" style="width:50px"></td>
                <td><input type="number" value="${item.boxH}" data-id="${item.id}" data-field="boxH" style="width:50px"></td>
                <td><input type="number" value="${item.qtyPerBox}" data-id="${item.id}" data-field="qtyPerBox" style="width:50px"></td>
                <td><input type="number" value="${item.grossWeight}" data-id="${item.id}" data-field="grossWeight" style="width:60px" step="0.1"></td>
                <td><input type="number" value="${item.totalPieces}" data-id="${item.id}" data-field="totalPieces" style="width:70px"></td>
                <td>${totalBoxes}</td>
                <td>${totalCbm.toFixed(3)}</td>
                <td><button class="btn-remove" data-id="${item.id}">&times;</button></td>
            `;
            tbody.appendChild(tr);
        });

        // 绑定输入事件
        tbody.querySelectorAll('input').forEach(el => {
            el.addEventListener('input', (e) => {
                const id = e.target.dataset.id;
                const field = e.target.dataset.field;
                const item = mixedItems.find(i => i.id === id);
                if (item) {
                    item[field] = field === 'style' ? e.target.value : Number(e.target.value) || 0;
                    renderMixedTable();
                    calcMixedTotal();
                }
            });
        });

        tbody.querySelectorAll('.btn-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                mixedItems = mixedItems.filter(i => i.id !== e.target.dataset.id);
                renderMixedTable();
                calcMixedTotal();
            });
        });

        calcMixedTotal();
    }

    function calcMixedTotal() {
        let totalBoxes = 0, totalCbm = 0, totalWeight = 0, totalPcs = 0;

        mixedItems.forEach(item => {
            const boxCbm = (item.boxL * item.boxW * item.boxH) / 1000000;
            const boxes = item.totalPieces > 0 ? Math.ceil(item.totalPieces / item.qtyPerBox) : 0;
            totalBoxes += boxes;
            totalCbm += boxCbm * boxes;
            totalWeight += item.grossWeight * boxes;
            totalPcs += item.totalPieces;
        });

        setText('#mix-total-boxes', totalBoxes + ' 箱');
        setText('#mix-total-cbm', totalCbm.toFixed(2) + ' m³');
        setText('#mix-total-weight', totalWeight.toFixed(1) + ' kg');
        setText('#mix-total-pieces', totalPcs.toLocaleString() + ' 件');

        // 建议柜型
        let suggest = '-';
        if (totalCbm <= 33) suggest = "20' 普柜";
        else if (totalCbm <= 67) suggest = "40' 普柜";
        else if (totalCbm <= 76) suggest = "40' 高柜";
        else if (totalCbm <= 86) suggest = "45' 高柜";
        else suggest = Math.ceil(totalCbm / 76) + " x 40'高柜";
        setText('#mix-suggest', suggest);
    }

    window.initPackingPage = function () {
        initPacking();
    };

    initPacking();
})();
