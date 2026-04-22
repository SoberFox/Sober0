// ============================================================
// 悬挂面料画卷 · Verlet 物理布料
// A hanging silk scroll with mouse-draggable verlet cloth physics.
// ============================================================

(function () {
    'use strict';

    const canvas = document.getElementById('cloth-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // 网格分辨率 (高密度，肉眼看不出网格)
    const COLS = 26;
    const ROWS = 56;
    // 约束迭代次数（越多越"硬"）
    const ITER = 3;
    // 画卷相对布料容器的比例
    const WIDTH_RATIO = 0.72;   // 宽度占容器的 72%
    const HANG_TOP = 34;        // 顶部离容器顶
    const BOTTOM_PAD = 60;      // 底部留白给流苏
    const GRAVITY = 0.42;
    const DAMPING = 0.985;
    const MOUSE_RADIUS = 70;
    const MOUSE_STRENGTH = 0.9;

    const points = [];
    const sticks = [];

    let W = 0, H = 0, DPR = 1;
    let clothW = 0, clothH = 0;
    let startX = 0, cellW = 0, cellH = 0;
    let rodY = 0;

    const mouse = { x: -9999, y: -9999, px: -9999, py: -9999, down: false, grabbed: null, over: false };
    let idleTime = 0;

    function resize() {
        const rect = canvas.getBoundingClientRect();
        if (rect.width < 10 || rect.height < 10) return;
        DPR = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(rect.width * DPR);
        canvas.height = Math.round(rect.height * DPR);
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        W = rect.width;
        H = rect.height;

        clothW = Math.min(W * WIDTH_RATIO, 320);
        clothH = H - HANG_TOP - BOTTOM_PAD;
        cellW = clothW / (COLS - 1);
        cellH = clothH / (ROWS - 1);
        startX = W - clothW - 28;
        rodY = HANG_TOP;

        rebuild();
    }

    function rebuild() {
        points.length = 0;
        sticks.length = 0;
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const x = startX + c * cellW;
                const y = rodY + r * cellH;
                points.push({
                    x, y,
                    px: x, py: y,
                    pinned: r === 0,
                });
            }
        }
        // 约束
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const i = r * COLS + c;
                if (c < COLS - 1) sticks.push({ a: i, b: i + 1, len: cellW });
                if (r < ROWS - 1) sticks.push({ a: i, b: i + COLS, len: cellH });
            }
        }
    }

    function physics() {
        // verlet 积分
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            if (p.pinned) continue;
            const vx = (p.x - p.px) * DAMPING;
            const vy = (p.y - p.py) * DAMPING;
            p.px = p.x;
            p.py = p.y;
            p.x += vx;
            p.y += vy + GRAVITY;
        }

        // 鼠标吸引/抓取
        if (mouse.over) {
            if (mouse.down && mouse.grabbed) {
                const g = mouse.grabbed;
                g.x = mouse.x;
                g.y = mouse.y;
                g.px = mouse.x - (mouse.x - mouse.px) * 0.6;
                g.py = mouse.y - (mouse.y - mouse.py) * 0.6;
            } else {
                // 轻微拂动：鼠标附近施力
                const force = (mouse.x - mouse.px) * 0.6;
                const liftY = (mouse.y - mouse.py) * 0.3;
                for (let i = 0; i < points.length; i++) {
                    const p = points[i];
                    if (p.pinned) continue;
                    const dx = p.x - mouse.x;
                    const dy = p.y - mouse.y;
                    const d = Math.hypot(dx, dy);
                    if (d < MOUSE_RADIUS) {
                        const f = (1 - d / MOUSE_RADIUS) * 0.4;
                        p.x += force * f;
                        p.y += liftY * f;
                    }
                }
            }
        }

        // 约束迭代
        for (let iter = 0; iter < ITER; iter++) {
            for (let i = 0; i < sticks.length; i++) {
                const s = sticks[i];
                const a = points[s.a];
                const b = points[s.b];
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const d = Math.sqrt(dx * dx + dy * dy) || 0.0001;
                const diff = (s.len - d) / d * 0.5;
                const ox = dx * diff;
                const oy = dy * diff;
                if (!a.pinned) { a.x -= ox; a.y -= oy; }
                if (!b.pinned) { b.x += ox; b.y += oy; }
            }
        }

        // 记录上一帧鼠标
        mouse.px = mouse.x;
        mouse.py = mouse.y;
    }

    function drawRod() {
        const pL = points[0];
        const pR = points[COLS - 1];
        // 木杆阴影
        ctx.save();
        ctx.fillStyle = '#1a1412';
        ctx.fillRect(pL.x - 14, pL.y - 5, (pR.x - pL.x) + 28, 4);
        // 杆身 (深棕黑)
        const grad = ctx.createLinearGradient(0, pL.y - 8, 0, pL.y + 4);
        grad.addColorStop(0, '#3a2a24');
        grad.addColorStop(0.5, '#141010');
        grad.addColorStop(1, '#0a0606');
        ctx.fillStyle = grad;
        ctx.fillRect(pL.x - 16, pL.y - 8, (pR.x - pL.x) + 32, 5);
        // 两端球头
        ctx.fillStyle = '#c8102e';
        ctx.beginPath();
        ctx.arc(pL.x - 16, pL.y - 5.5, 4, 0, Math.PI * 2);
        ctx.arc(pR.x + 16, pR.y - 5.5, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function drawCloth() {
        // 先画整体阴影投射
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        const firstRow = points[(ROWS - 1) * COLS];
        ctx.moveTo(points[0].x + 8, points[0].y + 8);
        for (let c = 1; c < COLS; c++) ctx.lineTo(points[c].x + 8, points[c].y + 8);
        for (let r = 1; r < ROWS; r++) ctx.lineTo(points[r * COLS + COLS - 1].x + 8, points[r * COLS + COLS - 1].y + 8);
        for (let c = COLS - 2; c >= 0; c--) ctx.lineTo(points[(ROWS - 1) * COLS + c].x + 8, points[(ROWS - 1) * COLS + c].y + 8);
        for (let r = ROWS - 2; r > 0; r--) ctx.lineTo(points[r * COLS].x + 8, points[r * COLS].y + 8);
        ctx.closePath();
        ctx.filter = 'blur(6px)';
        ctx.fill();
        ctx.filter = 'none';
        ctx.restore();

        // 绘制面料网格 - 每个四边形独立着色 (模拟光照)
        // 先 fill 再 stroke 同色，用 lineWidth 消除四边形之间的接缝
        ctx.lineJoin = 'round';
        ctx.lineWidth = 1.2;
        const restArea = cellW * cellH;
        const baseR = 168, baseG = 22, baseB = 38;

        for (let r = 0; r < ROWS - 1; r++) {
            for (let c = 0; c < COLS - 1; c++) {
                const p1 = points[r * COLS + c];
                const p2 = points[r * COLS + c + 1];
                const p3 = points[(r + 1) * COLS + c + 1];
                const p4 = points[(r + 1) * COLS + c];

                // 面积 -> 拉伸/压缩 -> 明暗
                const area = Math.abs(
                    (p2.x - p1.x) * (p3.y - p1.y) - (p3.x - p1.x) * (p2.y - p1.y)
                ) / 2 + Math.abs(
                    (p3.x - p1.x) * (p4.y - p1.y) - (p4.x - p1.x) * (p3.y - p1.y)
                ) / 2;
                const stretch = area / restArea;

                // 法向估算 (模拟打褶时面向光源的角度)
                const nx = (p3.x - p1.x);
                const nLen = Math.hypot(nx, (p3.y - p1.y)) || 1;
                const tilt = Math.abs(nx / nLen);

                // 光源假设在左上方
                const lightX = (p1.x - startX) / clothW;
                const lightFactor = 0.55 + (1 - lightX) * 0.25;

                const bright = Math.max(0.35, Math.min(1.15, stretch)) * lightFactor;
                const finalBright = bright * (1 - tilt * 0.2);

                const rr = Math.min(255, Math.floor(baseR * finalBright + 10));
                const gg = Math.max(0, Math.floor(baseG * finalBright));
                const bb = Math.max(0, Math.floor(baseB * finalBright));

                const col = `rgb(${rr},${gg},${bb})`;
                ctx.fillStyle = col;
                ctx.strokeStyle = col;
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.lineTo(p3.x, p3.y);
                ctx.lineTo(p4.x, p4.y);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            }
        }

        // 顶部/底部暗边 (画卷天地边)
        ctx.save();
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.lineWidth = 2;
        // 顶部窄边
        ctx.beginPath();
        for (let c = 0; c < COLS; c++) {
            const p = points[c];
            if (c === 0) ctx.moveTo(p.x, p.y + 2);
            else ctx.lineTo(p.x, p.y + 2);
        }
        ctx.stroke();
        // 底部窄边
        ctx.beginPath();
        for (let c = 0; c < COLS; c++) {
            const p = points[(ROWS - 1) * COLS + c];
            if (c === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
        ctx.restore();

        // 中轴暗色直纹 (丝绸织纹) - 密度适配高分辨率
        ctx.save();
        ctx.globalAlpha = 0.11;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        const stripeStep = 4;
        for (let c = stripeStep; c < COLS - 1; c += stripeStep) {
            ctx.beginPath();
            for (let r = 0; r < ROWS; r++) {
                const p = points[r * COLS + c];
                if (r === 0) ctx.moveTo(p.x, p.y);
                else ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();
        }
        ctx.restore();

        // 流苏 - 每隔两列画一根，避免太密
        ctx.save();
        const tStep = 2;
        for (let c = 0; c < COLS; c += tStep) {
            const p = points[(ROWS - 1) * COLS + c];
            const prev = c > 0 ? points[(ROWS - 1) * COLS + c - 1] : p;
            const angle = Math.atan2(p.y - prev.y, p.x - prev.x);
            const len = 16 + ((c * 7) % 7);
            ctx.strokeStyle = '#c8102e';
            ctx.lineWidth = 1;
            ctx.globalAlpha = 0.85;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            const swing = (p.x - p.px) * 4;
            ctx.lineTo(p.x + swing * 0.3 - Math.sin(angle) * 2, p.y + len);
            ctx.stroke();
        }
        ctx.restore();

    }

    function draw() {
        ctx.clearRect(0, 0, W, H);
        drawCloth();
        drawRod();
    }

    function loop() {
        physics();
        draw();
        requestAnimationFrame(loop);
    }

    // 鼠标事件
    function getLocal(e) {
        const rect = canvas.getBoundingClientRect();
        const isTouch = e.touches && e.touches[0];
        const clientX = isTouch ? e.touches[0].clientX : e.clientX;
        const clientY = isTouch ? e.touches[0].clientY : e.clientY;
        return { x: clientX - rect.left, y: clientY - rect.top };
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
        // 找最近的非固定点
        let best = null, bestDist = 50;
        for (let i = 0; i < points.length; i++) {
            const pt = points[i];
            if (pt.pinned) continue;
            const d = Math.hypot(pt.x - p.x, pt.y - p.y);
            if (d < bestDist) { best = pt; bestDist = d; }
        }
        mouse.grabbed = best;
        e.preventDefault();
    }

    function endGrab() {
        mouse.down = false;
        mouse.grabbed = null;
    }

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

    window.addEventListener('resize', () => {
        // 节流
        clearTimeout(window.__clothResize);
        window.__clothResize = setTimeout(resize, 120);
    });

    // 启动：稍等容器布局稳定
    setTimeout(() => {
        resize();
        loop();
        // 开场轻推一下，让画卷有个落下/摆动
        setTimeout(() => {
            for (let i = 0; i < points.length; i++) {
                if (!points[i].pinned) points[i].x += (Math.random() - 0.5) * 2;
            }
        }, 200);
    }, 50);
})();
