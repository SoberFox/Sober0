// ============================================================
// 悬挂面料画卷 · Verlet 物理布料 (性能优化版)
// Rendering: vertical strips (~22 draw calls per frame, no filter blur)
// Physics:   verlet + 2 iterations, grid 22×46
// ============================================================

(function () {
    'use strict';

    const canvas = document.getElementById('cloth-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });

    // 网格
    const COLS = 22;
    const ROWS = 46;
    const ITER = 2;

    const WIDTH_RATIO = 0.72;
    const HANG_TOP = 30;
    const BOTTOM_PAD = 48;
    const GRAVITY = 0.42;
    const DAMPING = 0.985;
    const MOUSE_RADIUS = 70;

    // 预计算的 32 级调色板 (深酒红 → 血红高光)
    const PAL_SIZE = 32;
    const PALETTE = new Array(PAL_SIZE);
    (function buildPalette() {
        const baseR = 168, baseG = 22, baseB = 38;
        for (let i = 0; i < PAL_SIZE; i++) {
            const t = i / (PAL_SIZE - 1);
            // 0.4 (深褶) → 1.2 (高光)
            const bright = 0.4 + t * 0.8;
            const rr = Math.min(255, (baseR * bright + 8) | 0);
            const gg = Math.max(0, (baseG * bright) | 0);
            const bb = Math.max(0, (baseB * bright) | 0);
            PALETTE[i] = `rgb(${rr},${gg},${bb})`;
        }
    })();

    // 质点结构: 扁平 TypedArray 比对象数组快
    let px, py, ppx, ppy, pinned;
    let NUM = 0;
    // 约束：用 Int32Array + Float32Array 替代 {a,b,len}
    let stickA, stickB, stickLen;
    let NUM_STICKS = 0;

    let W = 0, H = 0, DPR = 1;
    let clothW = 0, clothH = 0;
    let startX = 0, cellW = 0, cellH = 0;
    let rodY = 0;

    const mouse = { x: -9999, y: -9999, px: -9999, py: -9999, down: false, grabbed: -1, over: false };

    function resize() {
        const rect = canvas.getBoundingClientRect();
        if (rect.width < 10 || rect.height < 10) return;
        // DPR 只取 1，性能优先
        DPR = 1;
        canvas.width = Math.round(rect.width * DPR);
        canvas.height = Math.round(rect.height * DPR);
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        W = rect.width;
        H = rect.height;

        clothW = Math.min(W * WIDTH_RATIO, 300);
        clothH = H - HANG_TOP - BOTTOM_PAD;
        cellW = clothW / (COLS - 1);
        cellH = clothH / (ROWS - 1);
        startX = W - clothW - 24;
        rodY = HANG_TOP;

        rebuild();
    }

    function rebuild() {
        NUM = COLS * ROWS;
        px = new Float32Array(NUM);
        py = new Float32Array(NUM);
        ppx = new Float32Array(NUM);
        ppy = new Float32Array(NUM);
        pinned = new Uint8Array(NUM);
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const i = r * COLS + c;
                const x = startX + c * cellW;
                const y = rodY + r * cellH;
                px[i] = x; py[i] = y;
                ppx[i] = x; ppy[i] = y;
                pinned[i] = r === 0 ? 1 : 0;
            }
        }
        const sHoriz = (COLS - 1) * ROWS;
        const sVert  = COLS * (ROWS - 1);
        NUM_STICKS = sHoriz + sVert;
        stickA = new Int32Array(NUM_STICKS);
        stickB = new Int32Array(NUM_STICKS);
        stickLen = new Float32Array(NUM_STICKS);
        let k = 0;
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const i = r * COLS + c;
                if (c < COLS - 1) { stickA[k] = i; stickB[k] = i + 1; stickLen[k++] = cellW; }
                if (r < ROWS - 1) { stickA[k] = i; stickB[k] = i + COLS; stickLen[k++] = cellH; }
            }
        }
    }

    function physics() {
        // Verlet
        for (let i = 0; i < NUM; i++) {
            if (pinned[i]) continue;
            const ox = px[i], oy = py[i];
            const vx = (ox - ppx[i]) * DAMPING;
            const vy = (oy - ppy[i]) * DAMPING;
            ppx[i] = ox; ppy[i] = oy;
            px[i] = ox + vx;
            py[i] = oy + vy + GRAVITY;
        }

        // 鼠标
        if (mouse.over) {
            if (mouse.down && mouse.grabbed >= 0) {
                const g = mouse.grabbed;
                px[g] = mouse.x;
                py[g] = mouse.y;
                ppx[g] = mouse.x - (mouse.x - mouse.px) * 0.6;
                ppy[g] = mouse.y - (mouse.y - mouse.py) * 0.6;
            } else {
                const mx = mouse.x, my = mouse.y;
                const fx = (mx - mouse.px) * 0.55;
                const fy = (my - mouse.py) * 0.28;
                const r2 = MOUSE_RADIUS * MOUSE_RADIUS;
                for (let i = 0; i < NUM; i++) {
                    if (pinned[i]) continue;
                    const dx = px[i] - mx;
                    const dy = py[i] - my;
                    const d2 = dx * dx + dy * dy;
                    if (d2 < r2) {
                        const f = (1 - Math.sqrt(d2) / MOUSE_RADIUS) * 0.4;
                        px[i] += fx * f;
                        py[i] += fy * f;
                    }
                }
            }
        }

        // 约束
        for (let it = 0; it < ITER; it++) {
            for (let k = 0; k < NUM_STICKS; k++) {
                const a = stickA[k], b = stickB[k];
                const dx = px[b] - px[a];
                const dy = py[b] - py[a];
                const d = Math.sqrt(dx * dx + dy * dy) || 0.0001;
                const diff = (stickLen[k] - d) / d * 0.5;
                const ox = dx * diff, oy = dy * diff;
                if (!pinned[a]) { px[a] -= ox; py[a] -= oy; }
                if (!pinned[b]) { px[b] += ox; py[b] += oy; }
            }
        }

        mouse.px = mouse.x;
        mouse.py = mouse.y;
    }

    function drawRod() {
        const iL = 0, iR = COLS - 1;
        const lx = px[iL], ly = py[iL];
        const rx = px[iR], ry = py[iR];

        // 木杆
        const grad = ctx.createLinearGradient(0, ly - 8, 0, ly + 4);
        grad.addColorStop(0, '#3a2a24');
        grad.addColorStop(0.5, '#141010');
        grad.addColorStop(1, '#0a0606');
        ctx.fillStyle = grad;
        ctx.fillRect(lx - 16, ly - 8, (rx - lx) + 32, 5);
        // 两端红球头
        ctx.fillStyle = '#c8102e';
        ctx.beginPath();
        ctx.arc(lx - 16, ly - 5.5, 4, 0, Math.PI * 2);
        ctx.arc(rx + 16, ly - 5.5, 4, 0, Math.PI * 2);
        ctx.fill();
    }

    function drawCloth() {
        // 一次性绘制 COLS-1 个垂直条带
        // 每条带的明暗来自：局部水平宽度（折叠=暗，拉伸=亮）+ 左上光源
        for (let c = 0; c < COLS - 1; c++) {
            // 采样中间几行估算宽度（避免循环全部行）
            let sumW = 0;
            const sampleN = 5;
            for (let s = 0; s < sampleN; s++) {
                const r = ((ROWS - 1) * (s + 1) / (sampleN + 1)) | 0;
                const i1 = r * COLS + c;
                const i2 = i1 + 1;
                const dx = px[i2] - px[i1];
                const dy = py[i2] - py[i1];
                sumW += Math.sqrt(dx * dx + dy * dy);
            }
            const avgW = sumW / sampleN;
            const ratio = avgW / cellW;
            // 左上光源: 左边 (c 小) 亮，右边暗
            const lightT = 1 - (c / (COLS - 2));
            const light = 0.6 + lightT * 0.35;
            let bright = Math.max(0.3, Math.min(1.3, ratio)) * light;
            // 映射到 palette 索引
            let idx = ((bright - 0.4) / 0.8 * (PAL_SIZE - 1)) | 0;
            if (idx < 0) idx = 0;
            else if (idx >= PAL_SIZE) idx = PAL_SIZE - 1;

            ctx.fillStyle = PALETTE[idx];
            ctx.beginPath();
            // 左列 top → bottom
            let i = c;
            ctx.moveTo(px[i], py[i]);
            for (let r = 1; r < ROWS; r++) {
                i += COLS;
                ctx.lineTo(px[i], py[i]);
            }
            // 右列 bottom → top
            i = (ROWS - 1) * COLS + c + 1;
            ctx.lineTo(px[i], py[i]);
            for (let r = ROWS - 2; r >= 0; r--) {
                i -= COLS;
                ctx.lineTo(px[i], py[i]);
            }
            ctx.closePath();
            ctx.fill();
        }
    }

    function drawTexture() {
        // 丝绸织纹：稀疏竖直暗线，合并为一条 path
        ctx.globalAlpha = 0.13;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.beginPath();
        const step = 3;
        for (let c = step; c < COLS - 1; c += step) {
            let i = c;
            ctx.moveTo(px[i], py[i]);
            for (let r = 1; r < ROWS; r++) {
                i += COLS;
                ctx.lineTo(px[i], py[i]);
            }
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
    }

    function drawEdges() {
        // 顶部/底部窄暗边
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        // 顶
        ctx.moveTo(px[0], py[0] + 2);
        for (let c = 1; c < COLS; c++) ctx.lineTo(px[c], py[c] + 2);
        // 底
        const base = (ROWS - 1) * COLS;
        ctx.moveTo(px[base], py[base]);
        for (let c = 1; c < COLS; c++) ctx.lineTo(px[base + c], py[base + c]);
        ctx.stroke();
    }

    function drawTassels() {
        // 一条 path 画所有流苏
        ctx.strokeStyle = '#c8102e';
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        const base = (ROWS - 1) * COLS;
        for (let c = 0; c < COLS; c++) {
            const i = base + c;
            const xi = px[i], yi = py[i];
            const swing = (xi - ppx[i]) * 3;
            const len = 14 + ((c * 7) % 7);
            ctx.moveTo(xi, yi);
            ctx.lineTo(xi + swing * 0.25, yi + len);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
    }

    function draw() {
        ctx.clearRect(0, 0, W, H);
        drawCloth();
        drawTexture();
        drawEdges();
        drawTassels();
        drawRod();
    }

    // 主循环：30fps 节流 (requestAnimationFrame 跳帧)
    let lastT = 0;
    const FRAME_MS = 1000 / 45;  // 45fps，绸缎运动对人眼够平滑
    function loop(t) {
        requestAnimationFrame(loop);
        if (t - lastT < FRAME_MS) return;
        lastT = t;
        physics();
        draw();
    }

    // ------------------ 交互 ------------------
    function getLocal(e) {
        const rect = canvas.getBoundingClientRect();
        const isTouch = e.touches && e.touches[0];
        const cx = isTouch ? e.touches[0].clientX : e.clientX;
        const cy = isTouch ? e.touches[0].clientY : e.clientY;
        return { x: cx - rect.left, y: cy - rect.top };
    }

    canvas.addEventListener('mouseenter', () => { mouse.over = true; });
    canvas.addEventListener('mouseleave', () => {
        mouse.over = false;
        mouse.x = mouse.px = -9999;
        mouse.y = mouse.py = -9999;
    });
    canvas.addEventListener('mousemove', (e) => {
        const p = getLocal(e);
        if (mouse.x === -9999) { mouse.px = p.x; mouse.py = p.y; }
        mouse.x = p.x;
        mouse.y = p.y;
    });
    function startGrab(e) {
        const p = getLocal(e);
        mouse.x = p.x; mouse.y = p.y;
        mouse.px = p.x; mouse.py = p.y;
        mouse.down = true;
        let bestIdx = -1, bestD = 55 * 55;
        for (let i = 0; i < NUM; i++) {
            if (pinned[i]) continue;
            const dx = px[i] - p.x, dy = py[i] - p.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD) { bestD = d2; bestIdx = i; }
        }
        mouse.grabbed = bestIdx;
        e.preventDefault();
    }
    function endGrab() { mouse.down = false; mouse.grabbed = -1; }
    canvas.addEventListener('mousedown', startGrab);
    window.addEventListener('mouseup', endGrab);
    canvas.addEventListener('touchstart', (e) => { mouse.over = true; startGrab(e); }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
        const p = getLocal(e);
        mouse.x = p.x;
        mouse.y = p.y;
        e.preventDefault();
    }, { passive: false });
    window.addEventListener('touchend', endGrab);

    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(resize, 150);
    });

    // 启动：等布局稳定
    setTimeout(() => {
        resize();
        requestAnimationFrame(loop);
        // 开场轻推
        setTimeout(() => {
            for (let i = 0; i < NUM; i++) {
                if (!pinned[i]) px[i] += (Math.random() - 0.5) * 1.8;
            }
        }, 250);
    }, 50);
})();
