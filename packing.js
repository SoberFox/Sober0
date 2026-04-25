// ============================================================
// 装箱计算器模块
// ============================================================

(function () {
    'use strict';

    function $(sel) { return document.querySelector(sel); }

    // 集装箱尺寸 (cm)
    // length/width/height = 名义内尺寸 (用于展示理论容积)
    // usableL/W/H = 实际可堆码尺寸：扣除门框钢梁、波纹板侧壁、底部地板加厚、
    //               叉车凹槽 (fork pocket)、堆码顶部留白 ~5cm
    // cbmPractical = 业内常用「实际装载量」(海运货代经验值)
    const CONTAINERS = {
        '20GP': {
            name: "20' 普柜",
            length: 590, width: 235, height: 239,
            usableL: 580, usableW: 230, usableH: 230,
            cbmTheoretical: 33.2, cbmPractical: 28.0,
            maxWeight: 21700,
        },
        '40GP': {
            name: "40' 普柜",
            length: 1203, width: 235, height: 239,
            usableL: 1190, usableW: 230, usableH: 230,
            cbmTheoretical: 67.7, cbmPractical: 58.0,
            maxWeight: 26500,
        },
        '40HQ': {
            name: "40' 高柜",
            length: 1203, width: 235, height: 269,
            usableL: 1190, usableW: 230, usableH: 260,
            cbmTheoretical: 76.3, cbmPractical: 68.0,
            maxWeight: 26500,
        },
        '45HQ': {
            name: "45' 高柜",
            length: 1360, width: 235, height: 269,
            usableL: 1346, usableW: 230, usableH: 260,
            cbmTheoretical: 86.0, cbmPractical: 78.0,
            maxWeight: 25600,
        },
    };

    // 6 种摆向，找出最优 nL × nW × nH 排列
    function computeBestFit(l, w, h, container) {
        if (!container || !l || !w || !h) return null;
        const orients = [
            [l, w, h], [l, h, w],
            [w, l, h], [w, h, l],
            [h, l, w], [h, w, l],
        ];
        let best = { count: 0, dims: null, nL: 0, nW: 0, nH: 0 };
        orients.forEach(([a, b, c]) => {
            if (a <= 0 || b <= 0 || c <= 0) return;
            const nL = Math.floor(container.usableL / a);
            const nW = Math.floor(container.usableW / b);
            const nH = Math.floor(container.usableH / c);
            const count = nL * nW * nH;
            if (count > best.count) best = { count, dims: [a, b, c], nL, nW, nH };
        });
        return best;
    }

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
            contSel.innerHTML = Object.keys(CONTAINERS).map(k => {
                const c = CONTAINERS[k];
                return `<option value="${k}" ${k === '40HQ' ? 'selected' : ''}>${c.name} · 实装 ${c.cbmPractical}m³ / 理论 ${c.cbmTheoretical}m³</option>`;
            }).join('');
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

        const boxCbm = (l * w * h) / 1000000;
        const totalBoxes = totalPieces > 0 ? Math.ceil(totalPieces / qtyPerBox) : 0;
        const totalCbm = boxCbm * totalBoxes;
        const totalGross = grossWeight * totalBoxes;

        let boxesPerContainer = 0;
        let fit = null;
        let byVolume = 0, byWeight = Infinity;
        if (container && boxCbm > 0) {
            // 真实摆放：6 种摆向取最佳
            fit = computeBestFit(l, w, h, container);
            byVolume = fit ? fit.count : 0;
            byWeight = grossWeight > 0 ? Math.floor(container.maxWeight / grossWeight) : Infinity;
            boxesPerContainer = Math.max(0, Math.min(byVolume, byWeight));
        }

        const containersNeeded = boxesPerContainer > 0 ? Math.ceil(totalBoxes / boxesPerContainer) : 0;
        // 装载率：实际装入 CBM / 业内"可装"CBM (cbmPractical) — 100% 即装满
        const fillPractical = boxesPerContainer > 0 && container
            ? ((boxesPerContainer * boxCbm / container.cbmPractical) * 100) : 0;
        // 理论装载率：按名义内尺寸容积 (上限通常打不满，因为有摆向间隙)
        const fillTheoretical = boxesPerContainer > 0 && container
            ? ((boxesPerContainer * boxCbm / container.cbmTheoretical) * 100) : 0;
        const limitedBy = (byVolume <= byWeight) ? '体积' : '重量';

        // 输出
        setText('#res-box-cbm', boxCbm.toFixed(4) + ' m³');
        setText('#res-total-boxes', totalBoxes.toLocaleString() + ' 箱');
        setText('#res-total-cbm', totalCbm.toFixed(2) + ' m³');
        setText('#res-total-weight', totalGross.toFixed(1) + ' kg');
        setText('#res-boxes-per-container', boxesPerContainer.toLocaleString() + ' 箱  · 受限于 ' + limitedBy);
        setText('#res-pieces-per-container', (boxesPerContainer * qtyPerBox).toLocaleString() + ' 件');
        setText('#res-containers-needed', containersNeeded > 0 ? containersNeeded + ' 个' : '-');
        setText('#res-fill-rate', fillPractical.toFixed(1) + '%  (理论 ' + fillTheoretical.toFixed(1) + '%)');

        // 摆放方案
        if (fit && fit.count > 0) {
            const [a, b, c] = fit.dims;
            const turned = (a !== l || b !== w || c !== h) ? '（旋转后）' : '（原方向）';
            setText('#res-orientation', `${a} × ${b} × ${c} cm ${turned}`);
            setText('#res-arrangement', `${fit.nL} 排 × ${fit.nW} 列 × ${fit.nH} 层 = ${fit.count} 箱`);
        } else {
            setText('#res-orientation', '-');
            setText('#res-arrangement', '-');
        }

        const fillEl = $('#res-fill-rate');
        if (fillEl) {
            fillEl.className = 'pack-result-val ' +
                (fillPractical >= 90 ? 'fill-good' : fillPractical >= 70 ? 'fill-ok' : 'fill-low');
        }

        renderContainerVisual(fit, container);
    }

    function setText(sel, text) {
        const el = $(sel);
        if (el) el.textContent = text;
    }

    // 顶视图：按 fit.nL × fit.nW 网格摆首层，右侧标注 nH 层
    function renderContainerVisual(fit, container) {
        const canvas = $('#container-visual');
        if (!canvas || !container) return;
        const ctx = canvas.getContext('2d');
        const W = canvas.width;
        const H = canvas.height;
        ctx.clearRect(0, 0, W, H);

        const pad = 24;
        const labelWidth = 80;
        const cW = W - pad * 2 - labelWidth;
        const cH = H - pad * 2 - 24;
        const x0 = pad, y0 = pad;

        // 集装箱外框 (顶视图) - 等比缩放 usableL × usableW
        const aspect = container.usableW / container.usableL;
        let drawW = cW, drawH = cW * aspect;
        if (drawH > cH) { drawH = cH; drawW = cH / aspect; }
        const cx = x0 + drawW;
        const cy = y0 + drawH;

        // 集装箱地板
        ctx.fillStyle = 'rgba(245,243,238,0.04)';
        ctx.fillRect(x0, y0, drawW, drawH);
        ctx.strokeStyle = 'rgba(245,243,238,0.3)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x0, y0, drawW, drawH);

        // 标注门的方向 (右侧)
        ctx.strokeStyle = 'rgba(245,243,238,0.18)';
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(cx, y0 + 4);
        ctx.lineTo(cx, cy - 4);
        ctx.stroke();
        ctx.setLineDash([]);

        if (!fit || fit.count === 0) {
            ctx.fillStyle = 'rgba(245,243,238,0.4)';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('请输入纸箱尺寸', x0 + drawW / 2, y0 + drawH / 2);
            return;
        }

        // 一层箱子: nL 排 (沿长度) × nW 列 (沿宽度)
        const nL = fit.nL, nW = fit.nW, nH = fit.nH;
        const cellW = drawW / nL;
        const cellH = drawH / nW;

        // 填色基于装载率 (>=90 绿, >=70 橙, 低于 70 红)
        const fillPct = (fit.count * (fit.dims[0] * fit.dims[1] * fit.dims[2] / 1000000)) / container.cbmPractical * 100;
        const baseColor = fillPct >= 90 ? '#d97757' : fillPct >= 70 ? '#c9a45a' : '#c8102e';
        ctx.fillStyle = baseColor;
        ctx.globalAlpha = 0.18;
        for (let r = 0; r < nW; r++) {
            for (let c = 0; c < nL; c++) {
                ctx.fillRect(x0 + c * cellW, y0 + r * cellH, cellW, cellH);
            }
        }
        ctx.globalAlpha = 1;

        ctx.strokeStyle = baseColor;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.55;
        for (let r = 0; r < nW; r++) {
            for (let c = 0; c < nL; c++) {
                ctx.strokeRect(x0 + c * cellW, y0 + r * cellH, cellW, cellH);
            }
        }
        ctx.globalAlpha = 1;

        // 角落标识 (集装箱角部柱)
        ctx.fillStyle = 'rgba(245,243,238,0.4)';
        const corner = 4;
        [[x0, y0], [cx - corner, y0], [x0, cy - corner], [cx - corner, cy - corner]].forEach(([px, py]) => {
            ctx.fillRect(px, py, corner, corner);
        });

        // 文字: 排列方式 + 层数
        ctx.fillStyle = '#f5f3ee';
        ctx.font = 'bold 13px "SF Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`${nL} × ${nW}`, cx + 16, y0 + 14);
        ctx.font = '11px sans-serif';
        ctx.fillStyle = 'rgba(245,243,238,0.6)';
        ctx.fillText('地面排列', cx + 16, y0 + 28);

        ctx.fillStyle = baseColor;
        ctx.font = 'bold 13px "SF Mono", monospace';
        ctx.fillText(`× ${nH} 层`, cx + 16, y0 + 54);
        ctx.fillStyle = 'rgba(245,243,238,0.6)';
        ctx.font = '11px sans-serif';
        ctx.fillText('堆码层数', cx + 16, y0 + 68);

        ctx.fillStyle = '#f5f3ee';
        ctx.font = 'bold 16px "SF Mono", monospace';
        ctx.fillText(`= ${fit.count}`, cx + 16, y0 + 96);
        ctx.fillStyle = 'rgba(245,243,238,0.6)';
        ctx.font = '11px sans-serif';
        ctx.fillText('总箱数', cx + 16, y0 + 110);

        // 底部小标
        ctx.fillStyle = 'rgba(245,243,238,0.5)';
        ctx.font = '10px "SF Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`${container.name} 顶视图 · 可装 ${container.usableL}×${container.usableW}×${container.usableH} cm`, x0, H - 8);
        ctx.textAlign = 'right';
        ctx.fillText('门 →', cx, H - 8);
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
        // 按业内"实际装载量"判断 (而不是名义内尺寸容积)
        if (totalCbm <= 28) suggest = "20' 普柜 (实装 28m³)";
        else if (totalCbm <= 58) suggest = "40' 普柜 (实装 58m³)";
        else if (totalCbm <= 68) suggest = "40' 高柜 (实装 68m³)";
        else if (totalCbm <= 78) suggest = "45' 高柜 (实装 78m³)";
        else suggest = Math.ceil(totalCbm / 68) + " x 40' 高柜";
        setText('#mix-suggest', suggest);
    }

    window.initPackingPage = function () {
        initPacking();
    };

    initPacking();
})();
