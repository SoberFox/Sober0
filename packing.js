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
            '#box-gross-weight', '#total-pieces', '#total-boxes-direct', '#container-type'];

        // 防抖：用户快速点击数字微调按钮时避免每帧重建场景
        let rafToken = null;
        const debounced = () => {
            if (rafToken != null) cancelAnimationFrame(rafToken);
            rafToken = requestAnimationFrame(() => { rafToken = null; calcPacking(); });
        };
        fields.forEach(sel => {
            const el = $(sel);
            if (el) el.addEventListener('input', debounced);
            if (el) el.addEventListener('change', debounced);
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
        const directBoxes = Number($('#total-boxes-direct').value) || 0;
        const containerKey = $('#container-type').value;
        const container = CONTAINERS[containerKey];

        const boxCbm = (l * w * h) / 1000000;
        // 直接填总箱数优先；否则用件数估算
        const totalBoxes = directBoxes > 0
            ? directBoxes
            : (totalPieces > 0 ? Math.ceil(totalPieces / qtyPerBox) : 0);
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

        renderContainerVisual(fit, container, boxesPerContainer);
    }

    function setText(sel, text) {
        const el = $(sel);
        if (el) el.textContent = text;
    }

    // ============================================================
    // 3D 货柜预览 (Three.js + OrbitControls)
    // ============================================================
    let scene3d = null, camera3d = null, renderer3d = null, controls3d = null;
    let containerGroup = null, cargoGroup = null;
    let animFrameId = null;
    let resizeHandler3d = null;

    function ensureThree() { return typeof THREE !== 'undefined'; }

    function init3D() {
        if (!ensureThree()) return false;
        const host = document.getElementById('container-3d');
        if (!host) return false;
        if (renderer3d) return true; // 已初始化

        const w = host.clientWidth || 600;
        const h = host.clientHeight || 360;

        scene3d = new THREE.Scene();
        scene3d.background = null; // 透明，露出 CSS 渐变背景

        camera3d = new THREE.PerspectiveCamera(40, w / h, 1, 8000);
        camera3d.position.set(1500, 1100, 1700);
        camera3d.lookAt(0, 0, 0);

        renderer3d = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer3d.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer3d.setSize(w, h);
        renderer3d.setClearColor(0x000000, 0);
        host.appendChild(renderer3d.domElement);

        // 灯光
        const amb = new THREE.AmbientLight(0xffffff, 0.55);
        scene3d.add(amb);
        const key = new THREE.DirectionalLight(0xffffff, 0.85);
        key.position.set(800, 1200, 600);
        scene3d.add(key);
        const fill = new THREE.DirectionalLight(0xc8102e, 0.18);
        fill.position.set(-1000, 500, -800);
        scene3d.add(fill);

        // 地面
        const floor = new THREE.Mesh(
            new THREE.PlaneGeometry(4000, 4000),
            new THREE.MeshBasicMaterial({ color: 0x0a0808, transparent: true, opacity: 0.7 })
        );
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -1;
        scene3d.add(floor);
        // 地面网格
        const grid = new THREE.GridHelper(4000, 40, 0x2a1f1f, 0x1a1212);
        grid.position.y = 0;
        scene3d.add(grid);

        // OrbitControls
        if (typeof THREE.OrbitControls === 'function') {
            controls3d = new THREE.OrbitControls(camera3d, renderer3d.domElement);
            controls3d.enableDamping = true;
            controls3d.dampingFactor = 0.08;
            controls3d.maxPolarAngle = Math.PI / 2 - 0.05; // 不让相机翻到地面下
            controls3d.minDistance = 400;
            controls3d.maxDistance = 5000;
            controls3d.target.set(0, 0, 0);
        }

        containerGroup = new THREE.Group();
        cargoGroup = new THREE.Group();
        scene3d.add(containerGroup);
        scene3d.add(cargoGroup);

        // 自适应大小
        resizeHandler3d = () => {
            const rect = host.getBoundingClientRect();
            if (rect.width < 10) return;
            renderer3d.setSize(rect.width, rect.height);
            camera3d.aspect = rect.width / rect.height;
            camera3d.updateProjectionMatrix();
        };
        window.addEventListener('resize', resizeHandler3d);

        animate3D();

        // 视角切换
        const toggle = document.querySelector('.pack-3d-toggle');
        if (toggle && !toggle.__bound) {
            toggle.__bound = true;
            toggle.addEventListener('click', (e) => {
                const btn = e.target.closest('.pack-3d-btn');
                if (!btn) return;
                toggle.querySelectorAll('.pack-3d-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                setView(btn.dataset.view);
            });
        }
        return true;
    }

    function animate3D() {
        animFrameId = requestAnimationFrame(animate3D);
        if (controls3d) controls3d.update();
        if (renderer3d && scene3d && camera3d) renderer3d.render(scene3d, camera3d);
    }

    function clearGroup(g) {
        if (!g) return;
        while (g.children.length) {
            const c = g.children[0];
            g.remove(c);
            if (c.geometry) c.geometry.dispose();
            if (c.material) {
                if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
                else c.material.dispose();
            }
        }
    }

    function buildContainerWire(container) {
        const L = container.usableL;
        const H = container.usableH;
        const W = container.usableW;
        const grp = new THREE.Group();

        // 集装箱内壁线框
        const boxGeo = new THREE.BoxGeometry(L, H, W);
        const edges = new THREE.EdgesGeometry(boxGeo);
        const wire = new THREE.LineSegments(
            edges,
            new THREE.LineBasicMaterial({ color: 0xf5f3ee, transparent: true, opacity: 0.35 })
        );
        wire.position.y = H / 2;
        grp.add(wire);
        boxGeo.dispose();

        // 角部加固柱 (4 根细立柱)
        const postMat = new THREE.MeshLambertMaterial({ color: 0x2a1f1f });
        const postSize = 8;
        const postGeo = new THREE.BoxGeometry(postSize, H, postSize);
        const corners = [
            [-L / 2 + postSize / 2, -W / 2 + postSize / 2],
            [L / 2 - postSize / 2, -W / 2 + postSize / 2],
            [-L / 2 + postSize / 2, W / 2 - postSize / 2],
            [L / 2 - postSize / 2, W / 2 - postSize / 2],
        ];
        corners.forEach(([cx, cz]) => {
            const post = new THREE.Mesh(postGeo, postMat);
            post.position.set(cx, H / 2, cz);
            grp.add(post);
        });

        // 门 (右端用红线高亮)
        const doorMat = new THREE.LineBasicMaterial({ color: 0xc8102e, transparent: true, opacity: 0.85 });
        const doorPts = [
            new THREE.Vector3(L / 2, 0, -W / 2),
            new THREE.Vector3(L / 2, H, -W / 2),
            new THREE.Vector3(L / 2, H, W / 2),
            new THREE.Vector3(L / 2, 0, W / 2),
            new THREE.Vector3(L / 2, 0, -W / 2),
        ];
        const doorGeo = new THREE.BufferGeometry().setFromPoints(doorPts);
        grp.add(new THREE.Line(doorGeo, doorMat));

        // 地板纹理 (集装箱内的地板)
        const floorGeo = new THREE.PlaneGeometry(L, W);
        const floorMat = new THREE.MeshLambertMaterial({
            color: 0x1a1414, transparent: true, opacity: 0.95
        });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = 0.5;
        grp.add(floor);

        // 门口标签 (用 CanvasTexture)
        const labelTex = makeTextSprite('门 / DOOR', '#c8102e');
        if (labelTex) {
            labelTex.position.set(L / 2 + 12, H / 2, 0);
            labelTex.scale.set(120, 60, 1);
            grp.add(labelTex);
        }
        return grp;
    }

    function makeTextSprite(text, color) {
        const c = document.createElement('canvas');
        c.width = 256; c.height = 128;
        const ctx = c.getContext('2d');
        ctx.fillStyle = 'rgba(11,9,9,0.7)';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.font = 'bold 36px sans-serif';
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, c.width / 2, c.height / 2);
        const tex = new THREE.CanvasTexture(c);
        tex.minFilter = THREE.LinearFilter;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
        return sprite;
    }

    // displayCount = 实际要画的箱数 (受体积 + 重量同时约束)
    // 优先填满最下层 → 顺时针 → 一层完了再上去，符合实际装柜动作
    function buildCargo(fit, container, displayCount) {
        const grp = new THREE.Group();
        if (!fit || fit.count === 0) return grp;

        const [a, b, c] = fit.dims; // 实际摆放尺寸 (cm) — X=a, Y=c, Z=b
        const nL = fit.nL, nW = fit.nW, nH = fit.nH;
        const max = nL * nW * nH;
        const N = Math.max(0, Math.min(displayCount == null ? max : displayCount, max));
        if (N === 0) return grp;

        const usableL = container.usableL, usableW = container.usableW;

        // 1) 实例化箱体: 一次 draw call
        const geo = new THREE.BoxGeometry(a, c, b);
        const mat = new THREE.MeshLambertMaterial({ color: 0xc8102e });
        const inst = new THREE.InstancedMesh(geo, mat, N);
        inst.frustumCulled = false;
        const dummy = new THREE.Object3D();
        const tmpColor = new THREE.Color();
        const baseR = 200 / 255, baseG = 16 / 255, baseB = 46 / 255;

        // 2) 边线: 用单一 BufferGeometry 把所有箱子的 12 条边合并
        // 单位盒角点 (相对箱中心)
        const ha = a / 2, hb = b / 2, hc = c / 2;
        const corners = [
            [-ha, -hc, -hb], [ ha, -hc, -hb], [ ha,  hc, -hb], [-ha,  hc, -hb],
            [-ha, -hc,  hb], [ ha, -hc,  hb], [ ha,  hc,  hb], [-ha,  hc,  hb],
        ];
        const edgeIdx = [
            [0,1],[1,2],[2,3],[3,0], [4,5],[5,6],[6,7],[7,4],
            [0,4],[1,5],[2,6],[3,7],
        ];
        const positions = new Float32Array(N * 12 * 2 * 3);

        let idx = 0;
        let posPtr = 0;
        let placed = 0;
        outer:
        for (let k = 0; k < nH; k++) {
            for (let j = 0; j < nW; j++) {
                for (let i = 0; i < nL; i++) {
                    if (placed >= N) break outer;
                    const cx = -usableL / 2 + i * a + ha;
                    const cy = k * c + hc;
                    const cz = -usableW / 2 + j * b + hb;
                    dummy.position.set(cx, cy, cz);
                    dummy.updateMatrix();
                    inst.setMatrixAt(idx, dummy.matrix);
                    const v = 1 - ((i + j + k) % 3) * 0.06;
                    tmpColor.setRGB(baseR * v, baseG * v, baseB * v);
                    inst.setColorAt(idx, tmpColor);
                    idx++;
                    // 写入此箱 12 条边
                    for (let e = 0; e < edgeIdx.length; e++) {
                        const [e1, e2] = edgeIdx[e];
                        positions[posPtr++] = corners[e1][0] + cx;
                        positions[posPtr++] = corners[e1][1] + cy;
                        positions[posPtr++] = corners[e1][2] + cz;
                        positions[posPtr++] = corners[e2][0] + cx;
                        positions[posPtr++] = corners[e2][1] + cy;
                        positions[posPtr++] = corners[e2][2] + cz;
                    }
                    placed++;
                }
            }
        }
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
        inst.instanceMatrix.needsUpdate = true;
        grp.add(inst);

        const wireGeo = new THREE.BufferGeometry();
        wireGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const wireMat = new THREE.LineBasicMaterial({
            color: 0x000000, transparent: true, opacity: 0.4,
        });
        grp.add(new THREE.LineSegments(wireGeo, wireMat));

        return grp;
    }

    function setView(name) {
        if (!camera3d || !controls3d) return;
        const tgt = controls3d.target;
        const dist = camera3d.position.distanceTo(tgt) || 2000;
        let pos;
        switch (name) {
            case 'top':   pos = [tgt.x, tgt.y + dist, tgt.z + 0.001]; break;
            case 'side':  pos = [tgt.x, tgt.y + 200, tgt.z + dist]; break;
            case 'front': pos = [tgt.x + dist, tgt.y + 200, tgt.z]; break;
            case 'iso':
            default:      pos = [tgt.x + dist * 0.6, tgt.y + dist * 0.55, tgt.z + dist * 0.7]; break;
        }
        camera3d.position.set(pos[0], pos[1], pos[2]);
        camera3d.lookAt(tgt);
        controls3d.update();
    }

    function fitCameraTo(container) {
        if (!camera3d || !controls3d) return;
        const L = container.usableL, H = container.usableH, W = container.usableW;
        const center = new THREE.Vector3(0, H / 2, 0);
        controls3d.target.copy(center);
        const radius = Math.sqrt(L * L + H * H + W * W) * 0.7;
        const dir = new THREE.Vector3(0.6, 0.55, 0.7).normalize();
        camera3d.position.copy(center).add(dir.multiplyScalar(radius * 1.6));
        camera3d.near = 1;
        camera3d.far = radius * 12;
        camera3d.updateProjectionMatrix();
        controls3d.update();
    }

    function renderContainer3D(fit, container, displayCount) {
        if (!ensureThree()) return; // three.js 没加载就跳过
        if (!init3D()) return;
        clearGroup(containerGroup);
        clearGroup(cargoGroup);
        if (!container) return;

        containerGroup.add(buildContainerWire(container));
        if (fit && fit.count > 0) cargoGroup.add(buildCargo(fit, container, displayCount));

        // 第一次或集装箱换型时重置相机
        if (!renderContainer3D.lastKey || renderContainer3D.lastKey !== container.name) {
            fitCameraTo(container);
            renderContainer3D.lastKey = container.name;
        } else if (resizeHandler3d) {
            resizeHandler3d();
        }
    }

    // 旧函数名保留为别名
    function renderContainerVisual(fit, container, displayCount) {
        renderContainer3D(fit, container, displayCount);
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
