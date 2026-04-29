// ============================================================
// 服装报价工具 - 主应用逻辑
// ============================================================

(function () {
    'use strict';

    // ---- 数据存储 ----
    const STORAGE_KEYS = {
        customers: 'clothing_quote_customers',
        quotes: 'clothing_quote_history',
    };

    // 带容错的 localStorage 封装 (#8)
    const safeStorage = {
        get(key, fallback) {
            try {
                const raw = localStorage.getItem(key);
                if (raw == null) return fallback;
                return JSON.parse(raw);
            } catch (e) {
                console.warn('[storage] read failed', key, e);
                return fallback;
            }
        },
        set(key, value) {
            try {
                localStorage.setItem(key, JSON.stringify(value));
                return true;
            } catch (e) {
                if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
                    alert('浏览器本地存储空间已满。\n\n建议：点侧边栏「关于」里的"导出备份"保存当前数据，再清理旧数据后重试。');
                } else {
                    alert('保存失败：' + (e && e.message ? e.message : '未知原因') + '\n\n浏览器可能禁用了本地存储（隐私模式？）。');
                }
                console.error('[storage] write failed', key, e);
                return false;
            }
        },
        remove(key) {
            try { localStorage.removeItem(key); return true; } catch { return false; }
        }
    };
    window.safeStorage = safeStorage;

    function loadData(key) {
        return safeStorage.get(key, []);
    }

    function saveData(key, data) {
        safeStorage.set(key, data);
    }

    // 备份 / 恢复 (#1)
    const BACKUP_PREFIXES = ['clothing_', 'custom_size_'];
    function isBackupKey(k) {
        return BACKUP_PREFIXES.some(p => k && k.indexOf(p) === 0);
    }

    function exportBackup() {
        const payload = {
            app: 'sober-workbench',
            version: (document.getElementById('app-version') || {}).textContent || 'dev',
            exportedAt: new Date().toISOString(),
            data: {},
        };
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!isBackupKey(k)) continue;
            const raw = localStorage.getItem(k);
            try { payload.data[k] = JSON.parse(raw); }
            catch { payload.data[k] = raw; }
        }
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const stamp = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `sober-backup-${stamp}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function importBackup(file) {
        const reader = new FileReader();
        reader.onload = () => {
            let j;
            try { j = JSON.parse(reader.result); }
            catch { alert('这不是一个合法的 JSON 文件。'); return; }
            if (!j || !j.data || typeof j.data !== 'object') {
                alert('文件格式不对：缺少 data 字段。');
                return;
            }
            // 只接受白名单前缀的 key；过滤危险的原型 key
            const PROTO_KEYS = ['__proto__', 'constructor', 'prototype'];
            const allKeys = Object.keys(j.data);
            const keys = allKeys.filter(k => isBackupKey(k) && !PROTO_KEYS.includes(k));
            const skipped = allKeys.filter(k => !keys.includes(k));
            if (keys.length === 0) {
                alert(skipped.length ? `这个备份里没有可识别的数据键。\n忽略的键：${skipped.join(', ')}` : '备份里没有数据。');
                return;
            }
            const stamp = j.exportedAt ? j.exportedAt.slice(0, 10) : '未知日期';
            let msg = `即将用备份 (${stamp}) 覆盖当前数据，共 ${keys.length} 项：\n\n${keys.join('\n')}`;
            if (skipped.length) msg += `\n\n忽略 ${skipped.length} 个不识别的键：\n${skipped.join('\n')}`;
            msg += '\n\n确认？';
            if (!confirm(msg)) return;
            let ok = 0, fail = 0;
            keys.forEach(k => {
                const v = j.data[k];
                if (safeStorage.set(k, v)) ok++; else fail++;
            });
            alert(`已恢复 ${ok} 项${fail ? `，失败 ${fail} 项` : ''}。页面将刷新。`);
            setTimeout(() => location.reload(), 200);
        };
        reader.onerror = () => alert('读取文件失败。');
        reader.readAsText(file);
    }

    window.exportBackup = exportBackup;
    window.importBackup = importBackup;

    // ---- 成本项模板 ----
    const COST_TEMPLATES = {
        fabric: { category: '面料', name: '主面料', spec: '', unit: '米', usage: 1.5, unitPrice: 0 },
        lining: { category: '面料', name: '里料', spec: '', unit: '米', usage: 1.2, unitPrice: 0 },
        zipper: { category: '辅料', name: '拉链', spec: '', unit: '条', usage: 1, unitPrice: 0 },
        button: { category: '辅料', name: '纽扣', spec: '', unit: '颗', usage: 4, unitPrice: 0 },
        thread: { category: '辅料', name: '缝纫线', spec: '', unit: '卷', usage: 0.2, unitPrice: 0 },
        label: { category: '辅料', name: '唛头', spec: '主唛+洗水唛', unit: '套', usage: 1, unitPrice: 0 },
        labor: { category: '加工', name: '加工费', spec: '', unit: '件', usage: 1, unitPrice: 0 },
        packing: { category: '包装', name: '包装费', spec: '吊牌+包装袋', unit: '件', usage: 1, unitPrice: 0 },
        shipping: { category: '运输', name: '运输费', spec: '', unit: '件', usage: 1, unitPrice: 0 },
    };

    const CATEGORIES = ['面料', '辅料', '加工', '包装', '运输', '其他'];

    // ---- 工具函数 ----
    function $(selector) {
        return document.querySelector(selector);
    }

    function $$(selector) {
        return document.querySelectorAll(selector);
    }

    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    function generateQuoteNumber() {
        const d = new Date();
        const prefix = 'QT';
        const dateStr = d.getFullYear().toString().slice(2) +
            String(d.getMonth() + 1).padStart(2, '0') +
            String(d.getDate()).padStart(2, '0');
        const seq = String(loadData(STORAGE_KEYS.quotes).length + 1).padStart(3, '0');
        return prefix + dateStr + seq;
    }

    function formatCurrency(val) {
        return '¥' + Number(val).toFixed(2);
    }

    function todayStr() {
        return new Date().toISOString().slice(0, 10);
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

    // ---- 按需加载模块脚本 (#9) ----
    // 每个 page → 需要加载的脚本文件
    const PAGE_SCRIPTS = {
        orders:    ['orders.js'],
        materials: ['materials.js'],
        timeline:  ['timeline.js'],
        packing: [
            'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js',
            'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js',
            'packing.js',
        ],
        sizechart: ['sizechart.js'],
        fabric:    ['fabric.js'],
        compare:   ['compare.js', 'labeldiff.js'],
        xlssearch: ['xlssearch.js'],
        convert:   ['convert.js'],
        ocrlabel:  [
            'https://cdn.jsdelivr.net/npm/tesseract.js@5.0.5/dist/tesseract.min.js',
            'ocrlabel.js',
        ],
    };
    const PAGE_INIT = {
        orders:    'initOrdersPage',
        materials: 'initMaterialsPage',
        timeline:  'initTimelinePage',
        packing:   'initPackingPage',
        sizechart: 'initSizeChartPage',
        fabric:    'initFabricPage',
        xlssearch: 'initXlsSearchPage',
        convert:   'initConverterPage',
        ocrlabel:  'initOcrLabelPage',
    };
    const loadedScripts = {};
    function loadScript(src) {
        if (loadedScripts[src]) return loadedScripts[src];
        loadedScripts[src] = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src;
            s.async = false;
            s.onload = () => resolve();
            s.onerror = () => reject(new Error('load failed: ' + src));
            document.head.appendChild(s);
        });
        return loadedScripts[src];
    }
    async function ensurePageScripts(page) {
        const scripts = PAGE_SCRIPTS[page];
        if (!scripts) return;
        await Promise.all(scripts.map(loadScript));
    }

    // ---- 页面导航 ----
    async function gotoPage(page) {
        const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
        $$('.nav-item').forEach(n => n.classList.remove('active'));
        if (navItem) navItem.classList.add('active');
        $$('.page').forEach(p => p.classList.remove('active'));
        const pageEl = $(`#page-${page}`);
        if (pageEl) pageEl.classList.add('active');
        document.body.classList.toggle('on-home', page === 'home');
        document.body.classList.toggle('on-about', page === 'about');
        window.scrollTo(0, 0);

        try { await ensurePageScripts(page); }
        catch (e) { console.error(e); alert('模块加载失败：' + e.message); return; }

        if (page === 'history') renderHistory();
        if (page === 'customers') renderCustomers();
        if (page === 'about' && window.initAboutPage) window.initAboutPage();
        if (page === 'compare' && window.initLabelDiff) window.initLabelDiff();

        const initName = PAGE_INIT[page];
        if (initName && typeof window[initName] === 'function') window[initName]();
    }
    window.gotoPage = gotoPage;

    function initNav() {
        $$('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                const page = item.dataset.page;
                if (page) gotoPage(page);
            });
        });

        // 首页卡片 / CTA 按钮跳转
        document.addEventListener('click', (e) => {
            const trigger = e.target.closest('[data-goto-page]');
            if (!trigger) return;
            e.preventDefault();
            gotoPage(trigger.dataset.gotoPage);
        });
    }

    // ============================================================
    // 报价模块
    // ============================================================
    let costRows = [];

    function initQuotation() {
        $('#quote-number').value = generateQuoteNumber();
        $('#quote-date').value = todayStr();

        refreshCustomerSelect();

        // 快速添加模板按钮
        $$('.quick-add .btn-sm').forEach(btn => {
            btn.addEventListener('click', () => {
                const tpl = COST_TEMPLATES[btn.dataset.template];
                if (tpl) addCostRow({ ...tpl });
            });
        });

        // 添加空行
        $('#btn-add-cost').addEventListener('click', () => {
            addCostRow({ category: '其他', name: '', spec: '', unit: '件', usage: 1, unitPrice: 0 });
        });

        // 利润率 / 税率变化
        $('#profit-rate').addEventListener('input', updateSummary);
        $('#tax-rate').addEventListener('input', updateSummary);
        $('#quote-quantity').addEventListener('input', updateSummary);

        // 保存
        $('#btn-save-quote').addEventListener('click', saveQuote);
        // 导出
        $('#btn-export-quote').addEventListener('click', exportQuote);
        // 清空
        $('#btn-clear-quote').addEventListener('click', clearQuotation);
    }

    function addCostRow(data) {
        const id = generateId();
        costRows.push({ id, ...data });
        renderCostTable();
    }

    function removeCostRow(id) {
        costRows = costRows.filter(r => r.id !== id);
        renderCostTable();
    }

    function renderCostTable() {
        const tbody = $('#cost-body');
        tbody.innerHTML = '';

        costRows.forEach(row => {
            const tr = document.createElement('tr');
            const subtotal = (Number(row.usage) || 0) * (Number(row.unitPrice) || 0);

            tr.innerHTML = `
                <td>
                    <select data-id="${row.id}" data-field="category">
                        ${CATEGORIES.map(c => `<option value="${c}" ${c === row.category ? 'selected' : ''}>${c}</option>`).join('')}
                    </select>
                </td>
                <td><input type="text" data-id="${row.id}" data-field="name" value="${escapeHtml(row.name)}" placeholder="项目名称"></td>
                <td><input type="text" data-id="${row.id}" data-field="spec" value="${escapeHtml(row.spec)}" placeholder="规格说明"></td>
                <td><input type="text" data-id="${row.id}" data-field="unit" value="${escapeHtml(row.unit)}" style="width:60px"></td>
                <td><input type="number" data-id="${row.id}" data-field="usage" value="${row.usage}" min="0" step="0.01" style="width:80px"></td>
                <td><input type="number" data-id="${row.id}" data-field="unitPrice" value="${row.unitPrice}" min="0" step="0.01" style="width:90px"></td>
                <td class="subtotal">${formatCurrency(subtotal)}</td>
                <td><button class="btn-remove" data-id="${row.id}" title="删除">&times;</button></td>
            `;
            tbody.appendChild(tr);
        });

        // 绑定事件
        tbody.querySelectorAll('input, select').forEach(el => {
            el.addEventListener('input', (e) => {
                const id = e.target.dataset.id;
                const field = e.target.dataset.field;
                const row = costRows.find(r => r.id === id);
                if (row) {
                    row[field] = e.target.value;
                    // 更新小计
                    const subtotal = (Number(row.usage) || 0) * (Number(row.unitPrice) || 0);
                    e.target.closest('tr').querySelector('.subtotal').textContent = formatCurrency(subtotal);
                    updateSummary();
                }
            });
        });

        tbody.querySelectorAll('.btn-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                removeCostRow(e.target.dataset.id);
            });
        });

        updateSummary();
    }

    function updateSummary() {
        const totalCost = costRows.reduce((sum, r) => {
            return sum + (Number(r.usage) || 0) * (Number(r.unitPrice) || 0);
        }, 0);

        const profitRate = Number($('#profit-rate').value) || 0;
        const taxRate = Number($('#tax-rate').value) || 0;
        const quantity = Number($('#quote-quantity').value) || 1;

        const profitAmount = totalCost * profitRate / 100;
        const subtotalBeforeTax = totalCost + profitAmount;
        const taxAmount = subtotalBeforeTax * taxRate / 100;
        const unitPrice = subtotalBeforeTax + taxAmount;
        const totalPrice = unitPrice * quantity;

        $('#total-cost').textContent = formatCurrency(totalCost);
        $('#profit-amount').textContent = formatCurrency(profitAmount);
        $('#tax-amount').textContent = formatCurrency(taxAmount);
        $('#unit-price').textContent = formatCurrency(unitPrice);
        $('#total-price').textContent = formatCurrency(totalPrice);
    }

    function getQuoteData() {
        const customerId = $('#quote-customer').value;
        const customers = loadData(STORAGE_KEYS.customers);
        const customer = customers.find(c => c.id === customerId);

        const totalCost = costRows.reduce((sum, r) => {
            return sum + (Number(r.usage) || 0) * (Number(r.unitPrice) || 0);
        }, 0);
        const profitRate = Number($('#profit-rate').value) || 0;
        const taxRate = Number($('#tax-rate').value) || 0;
        const quantity = Number($('#quote-quantity').value) || 1;
        const profitAmount = totalCost * profitRate / 100;
        const subtotalBeforeTax = totalCost + profitAmount;
        const taxAmount = subtotalBeforeTax * taxRate / 100;
        const unitPrice = subtotalBeforeTax + taxAmount;

        return {
            id: generateId(),
            quoteNumber: $('#quote-number').value,
            date: $('#quote-date').value,
            customerId: customerId,
            customerName: customer ? customer.name : '',
            style: $('#quote-style').value,
            quantity: quantity,
            remark: $('#quote-remark').value,
            costItems: costRows.map(r => ({ ...r })),
            profitRate,
            taxRate,
            totalCost,
            profitAmount,
            taxAmount,
            unitPrice,
            totalPrice: unitPrice * quantity,
        };
    }

    function saveQuote() {
        const data = getQuoteData();

        if (!data.style) {
            alert('请填写款式名称');
            return;
        }
        if (costRows.length === 0) {
            alert('请至少添加一项成本');
            return;
        }

        const quotes = loadData(STORAGE_KEYS.quotes);
        quotes.unshift(data);
        saveData(STORAGE_KEYS.quotes, quotes);

        // 更新客户报价次数
        if (data.customerId) {
            const customers = loadData(STORAGE_KEYS.customers);
            const cust = customers.find(c => c.id === data.customerId);
            if (cust) {
                cust.quoteCount = (cust.quoteCount || 0) + 1;
                saveData(STORAGE_KEYS.customers, customers);
            }
        }

        alert('报价已保存！');
        clearQuotation();
    }

    function clearQuotation() {
        costRows = [];
        renderCostTable();
        $('#quote-number').value = generateQuoteNumber();
        $('#quote-date').value = todayStr();
        $('#quote-customer').value = '';
        $('#quote-style').value = '';
        $('#quote-quantity').value = 100;
        $('#quote-remark').value = '';
        $('#profit-rate').value = 15;
        $('#tax-rate').value = 13;
        updateSummary();
    }

    // ---- 导出报价单 ----
    function exportQuote() {
        const data = getQuoteData();
        if (costRows.length === 0) {
            alert('请至少添加一项成本');
            return;
        }

        const costRowsHtml = data.costItems.map((item, i) => {
            const sub = (Number(item.usage) || 0) * (Number(item.unitPrice) || 0);
            return `<tr>
                <td>${i + 1}</td>
                <td>${escapeHtml(item.category)}</td>
                <td>${escapeHtml(item.name)}</td>
                <td>${escapeHtml(item.spec)}</td>
                <td>${escapeHtml(item.unit)}</td>
                <td class="text-right">${Number(item.usage).toFixed(2)}</td>
                <td class="text-right">${formatCurrency(item.unitPrice)}</td>
                <td class="text-right">${formatCurrency(sub)}</td>
            </tr>`;
        }).join('');

        const html = `
        <div class="quote-sheet">
            <div class="sheet-header">
                <h2>服装报价单</h2>
                <p>CLOTHING QUOTATION</p>
            </div>
            <div class="sheet-info">
                <div><strong>报价单号：</strong><span>${escapeHtml(data.quoteNumber)}</span></div>
                <div><strong>日期：</strong><span>${escapeHtml(data.date)}</span></div>
                <div><strong>客户：</strong><span>${escapeHtml(data.customerName) || '-'}</span></div>
                <div><strong>款式：</strong><span>${escapeHtml(data.style) || '-'}</span></div>
                <div><strong>数量：</strong><span>${data.quantity} 件</span></div>
                <div><strong>备注：</strong><span>${escapeHtml(data.remark) || '-'}</span></div>
            </div>
            <table class="sheet-table">
                <thead>
                    <tr>
                        <th>序号</th>
                        <th>类别</th>
                        <th>项目</th>
                        <th>规格/说明</th>
                        <th>单位</th>
                        <th class="text-right">用量</th>
                        <th class="text-right">单价</th>
                        <th class="text-right">小计</th>
                    </tr>
                </thead>
                <tbody>
                    ${costRowsHtml}
                </tbody>
            </table>
            <div class="sheet-summary">
                <table>
                    <tr><td>成本合计：</td><td class="text-right">${formatCurrency(data.totalCost)}</td></tr>
                    <tr><td>利润 (${data.profitRate}%)：</td><td class="text-right">${formatCurrency(data.profitAmount)}</td></tr>
                    <tr><td>税费 (${data.taxRate}%)：</td><td class="text-right">${formatCurrency(data.taxAmount)}</td></tr>
                    <tr><td>单件报价：</td><td class="text-right">${formatCurrency(data.unitPrice)}</td></tr>
                    <tr class="total-row"><td>总报价（${data.quantity}件）：</td><td class="text-right">${formatCurrency(data.totalPrice)}</td></tr>
                </table>
            </div>
            <div class="sheet-footer">
                <div>报价有效期：30天</div>
                <div>制单人：_____________</div>
                <div>客户确认：_____________</div>
            </div>
        </div>`;

        $('#quote-preview').innerHTML = html;
        openModal('export-modal');
    }

    $('#btn-print-quote').addEventListener('click', () => {
        window.print();
    });

    // ---- 下载 PDF (#7) ----
    async function downloadQuotePDF() {
        const node = document.getElementById('quote-preview');
        if (!node) return;
        if (!window.html2canvas) { alert('PDF 库未加载，请检查网络。'); return; }
        if (!window.jspdf || !window.jspdf.jsPDF) { alert('PDF 库未加载，请检查网络。'); return; }

        const btn = document.getElementById('btn-download-pdf');
        const origText = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = '生成中…'; }

        // 在 body 上临时加 pdf-export-mode，强制所有后代使用白底黑字
        // （避免 html2canvas 捕获深色主题）
        document.body.classList.add('pdf-export-mode');

        try {
            const canvas = await html2canvas(node, {
                scale: 2,
                useCORS: true,
                backgroundColor: '#ffffff',
                logging: false,
            });

            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
            const pageW = pdf.internal.pageSize.getWidth();
            const pageH = pdf.internal.pageSize.getHeight();
            const margin = 10;
            const imgW = pageW - margin * 2;
            const imgH = canvas.height * imgW / canvas.width;

            const imgData = canvas.toDataURL('image/jpeg', 0.92);

            if (imgH <= pageH - margin * 2) {
                pdf.addImage(imgData, 'JPEG', margin, margin, imgW, imgH);
            } else {
                // 多页分割：按比例切 canvas
                const pageImgH = pageH - margin * 2;
                const pageSrcH = canvas.width * pageImgH / imgW; // 对应原 canvas 像素高
                const totalPages = Math.ceil(canvas.height / pageSrcH);
                const tmp = document.createElement('canvas');
                tmp.width = canvas.width;
                tmp.height = pageSrcH;
                const tctx = tmp.getContext('2d');
                for (let p = 0; p < totalPages; p++) {
                    tctx.fillStyle = '#ffffff';
                    tctx.fillRect(0, 0, tmp.width, tmp.height);
                    tctx.drawImage(canvas, 0, -p * pageSrcH);
                    const slice = tmp.toDataURL('image/jpeg', 0.92);
                    if (p > 0) pdf.addPage();
                    pdf.addImage(slice, 'JPEG', margin, margin, imgW, pageImgH);
                }
            }

            const num = ($('#quote-number') && $('#quote-number').value) || 'quote';
            pdf.save(`${num}.pdf`);
        } catch (e) {
            console.error('[pdf] ', e);
            alert('导出 PDF 失败：' + (e && e.message ? e.message : '未知'));
        } finally {
            document.body.classList.remove('pdf-export-mode');
            if (btn) { btn.disabled = false; btn.textContent = origText; }
        }
    }

    const btnPdf = document.getElementById('btn-download-pdf');
    if (btnPdf) btnPdf.addEventListener('click', downloadQuotePDF);

    // ============================================================
    // 报价记录模块
    // ============================================================
    function renderHistory(filter) {
        let quotes = loadData(STORAGE_KEYS.quotes);
        if (filter) {
            const q = filter.toLowerCase();
            quotes = quotes.filter(qt =>
                (qt.quoteNumber || '').toLowerCase().includes(q) ||
                (qt.customerName || '').toLowerCase().includes(q) ||
                (qt.style || '').toLowerCase().includes(q)
            );
        }

        const tbody = $('#history-body');
        tbody.innerHTML = '';

        if (quotes.length === 0) {
            $('#history-table').style.display = 'none';
            $('#history-empty').style.display = 'block';
            return;
        }

        $('#history-table').style.display = 'table';
        $('#history-empty').style.display = 'none';

        quotes.forEach(qt => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHtml(qt.quoteNumber)}</td>
                <td>${escapeHtml(qt.date)}</td>
                <td>${escapeHtml(qt.customerName) || '-'}</td>
                <td>${escapeHtml(qt.style)}</td>
                <td>${qt.quantity}</td>
                <td>${formatCurrency(qt.unitPrice)}</td>
                <td>${formatCurrency(qt.totalPrice)}</td>
                <td class="actions">
                    <button class="btn-icon" title="查看" data-action="view" data-id="${qt.id}">&#128065;</button>
                    <button class="btn-icon" title="复制报价" data-action="copy" data-id="${qt.id}">&#128203;</button>
                    <button class="btn-icon danger" title="删除" data-action="delete" data-id="${qt.id}">&#128465;</button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        // 绑定操作按钮
        tbody.querySelectorAll('.btn-icon').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                const id = btn.dataset.id;
                if (action === 'view') viewQuote(id);
                if (action === 'copy') copyQuote(id);
                if (action === 'delete') deleteQuote(id);
            });
        });
    }

    function viewQuote(id) {
        const quotes = loadData(STORAGE_KEYS.quotes);
        const qt = quotes.find(q => q.id === id);
        if (!qt) return;

        // 重用导出预览
        const costRowsHtml = (qt.costItems || []).map((item, i) => {
            const sub = (Number(item.usage) || 0) * (Number(item.unitPrice) || 0);
            return `<tr>
                <td>${i + 1}</td>
                <td>${escapeHtml(item.category)}</td>
                <td>${escapeHtml(item.name)}</td>
                <td>${escapeHtml(item.spec)}</td>
                <td>${escapeHtml(item.unit)}</td>
                <td class="text-right">${Number(item.usage).toFixed(2)}</td>
                <td class="text-right">${formatCurrency(item.unitPrice)}</td>
                <td class="text-right">${formatCurrency(sub)}</td>
            </tr>`;
        }).join('');

        const html = `
        <div class="quote-sheet">
            <div class="sheet-header">
                <h2>服装报价单</h2>
                <p>CLOTHING QUOTATION</p>
            </div>
            <div class="sheet-info">
                <div><strong>报价单号：</strong><span>${escapeHtml(qt.quoteNumber)}</span></div>
                <div><strong>日期：</strong><span>${escapeHtml(qt.date)}</span></div>
                <div><strong>客户：</strong><span>${escapeHtml(qt.customerName) || '-'}</span></div>
                <div><strong>款式：</strong><span>${escapeHtml(qt.style) || '-'}</span></div>
                <div><strong>数量：</strong><span>${qt.quantity} 件</span></div>
                <div><strong>备注：</strong><span>${escapeHtml(qt.remark) || '-'}</span></div>
            </div>
            <table class="sheet-table">
                <thead>
                    <tr><th>序号</th><th>类别</th><th>项目</th><th>规格/说明</th><th>单位</th><th class="text-right">用量</th><th class="text-right">单价</th><th class="text-right">小计</th></tr>
                </thead>
                <tbody>${costRowsHtml}</tbody>
            </table>
            <div class="sheet-summary">
                <table>
                    <tr><td>成本合计：</td><td class="text-right">${formatCurrency(qt.totalCost)}</td></tr>
                    <tr><td>利润 (${qt.profitRate}%)：</td><td class="text-right">${formatCurrency(qt.profitAmount)}</td></tr>
                    <tr><td>税费 (${qt.taxRate}%)：</td><td class="text-right">${formatCurrency(qt.taxAmount)}</td></tr>
                    <tr><td>单件报价：</td><td class="text-right">${formatCurrency(qt.unitPrice)}</td></tr>
                    <tr class="total-row"><td>总报价（${qt.quantity}件）：</td><td class="text-right">${formatCurrency(qt.totalPrice)}</td></tr>
                </table>
            </div>
        </div>`;

        $('#quote-preview').innerHTML = html;
        openModal('export-modal');
    }

    function copyQuote(id) {
        const quotes = loadData(STORAGE_KEYS.quotes);
        const qt = quotes.find(q => q.id === id);
        if (!qt) return;

        // 切换到报价页面并填充数据
        $$('.nav-item').forEach(n => n.classList.remove('active'));
        $$('.nav-item')[0].classList.add('active');
        $$('.page').forEach(p => p.classList.remove('active'));
        $('#page-quotation').classList.add('active');

        $('#quote-number').value = generateQuoteNumber();
        $('#quote-date').value = todayStr();
        $('#quote-customer').value = qt.customerId || '';
        $('#quote-style').value = qt.style || '';
        $('#quote-quantity').value = qt.quantity || 100;
        $('#quote-remark').value = qt.remark || '';
        $('#profit-rate').value = qt.profitRate || 15;
        $('#tax-rate').value = qt.taxRate || 13;

        costRows = (qt.costItems || []).map(item => ({ ...item, id: generateId() }));
        renderCostTable();
    }

    function deleteQuote(id) {
        if (!confirm('确定删除此报价记录？')) return;
        let quotes = loadData(STORAGE_KEYS.quotes);
        quotes = quotes.filter(q => q.id !== id);
        saveData(STORAGE_KEYS.quotes, quotes);
        renderHistory();
    }

    // 搜索
    $('#history-search').addEventListener('input', (e) => {
        renderHistory(e.target.value);
    });

    // ============================================================
    // 客户管理模块
    // ============================================================
    let editingCustomerId = null;

    function renderCustomers() {
        const customers = loadData(STORAGE_KEYS.customers);
        const tbody = $('#customer-body');
        tbody.innerHTML = '';

        if (customers.length === 0) {
            $('#customer-table').style.display = 'none';
            $('#customer-empty').style.display = 'block';
            return;
        }

        $('#customer-table').style.display = 'table';
        $('#customer-empty').style.display = 'none';

        customers.forEach(c => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHtml(c.name)}</td>
                <td>${escapeHtml(c.contact)}</td>
                <td>${escapeHtml(c.phone)}</td>
                <td>${escapeHtml(c.email)}</td>
                <td>${escapeHtml(c.address)}</td>
                <td>${c.quoteCount || 0}</td>
                <td class="actions">
                    <button class="btn-icon" title="编辑" data-action="edit" data-id="${c.id}">&#9998;</button>
                    <button class="btn-icon danger" title="删除" data-action="delete" data-id="${c.id}">&#128465;</button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        tbody.querySelectorAll('.btn-icon').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                const id = btn.dataset.id;
                if (action === 'edit') editCustomer(id);
                if (action === 'delete') deleteCustomer(id);
            });
        });
    }

    function refreshCustomerSelect() {
        const customers = loadData(STORAGE_KEYS.customers);
        const select = $('#quote-customer');
        const currentVal = select.value;
        select.innerHTML = '<option value="">-- 选择客户 --</option>';
        customers.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.name;
            select.appendChild(opt);
        });
        select.value = currentVal;
    }

    $('#btn-add-customer').addEventListener('click', () => {
        editingCustomerId = null;
        $('#customer-modal-title').textContent = '新增客户';
        $('#cust-name').value = '';
        $('#cust-contact').value = '';
        $('#cust-phone').value = '';
        $('#cust-email').value = '';
        $('#cust-address').value = '';
        openModal('customer-modal');
    });

    $('#btn-save-customer').addEventListener('click', () => {
        const name = $('#cust-name').value.trim();
        if (!name) {
            alert('请填写客户名称');
            return;
        }

        const customers = loadData(STORAGE_KEYS.customers);

        if (editingCustomerId) {
            const cust = customers.find(c => c.id === editingCustomerId);
            if (cust) {
                cust.name = name;
                cust.contact = $('#cust-contact').value.trim();
                cust.phone = $('#cust-phone').value.trim();
                cust.email = $('#cust-email').value.trim();
                cust.address = $('#cust-address').value.trim();
            }
        } else {
            customers.push({
                id: generateId(),
                name: name,
                contact: $('#cust-contact').value.trim(),
                phone: $('#cust-phone').value.trim(),
                email: $('#cust-email').value.trim(),
                address: $('#cust-address').value.trim(),
                quoteCount: 0,
            });
        }

        saveData(STORAGE_KEYS.customers, customers);
        closeModal('customer-modal');
        renderCustomers();
        refreshCustomerSelect();
    });

    function editCustomer(id) {
        const customers = loadData(STORAGE_KEYS.customers);
        const cust = customers.find(c => c.id === id);
        if (!cust) return;

        editingCustomerId = id;
        $('#customer-modal-title').textContent = '编辑客户';
        $('#cust-name').value = cust.name;
        $('#cust-contact').value = cust.contact || '';
        $('#cust-phone').value = cust.phone || '';
        $('#cust-email').value = cust.email || '';
        $('#cust-address').value = cust.address || '';
        openModal('customer-modal');
    }

    function deleteCustomer(id) {
        if (!confirm('确定删除此客户？')) return;
        let customers = loadData(STORAGE_KEYS.customers);
        customers = customers.filter(c => c.id !== id);
        saveData(STORAGE_KEYS.customers, customers);
        renderCustomers();
        refreshCustomerSelect();
    }

    // 弹窗关闭按钮
    $('#btn-cancel-customer').addEventListener('click', () => closeModal('customer-modal'));
    $('#customer-modal-close').addEventListener('click', () => closeModal('customer-modal'));
    $('#btn-cancel-export').addEventListener('click', () => closeModal('export-modal'));
    $('#export-modal-close').addEventListener('click', () => closeModal('export-modal'));

    // ---- 弹窗通用 ----
    function openModal(id) {
        $(`#${id}`).classList.add('active');
    }

    function closeModal(id) {
        $(`#${id}`).classList.remove('active');
    }

    // 点击遮罩关闭
    $$('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
            }
        });
    });

    // ---- 数据管理按钮 ----
    function initAboutPage() {
        const btnExport = document.getElementById('btn-export-backup');
        const btnImportTrigger = document.getElementById('btn-import-backup-trigger');
        const fileInput = document.getElementById('import-backup-file');
        if (btnExport && !btnExport.__bound) {
            btnExport.__bound = true;
            btnExport.addEventListener('click', exportBackup);
        }
        if (btnImportTrigger && fileInput && !btnImportTrigger.__bound) {
            btnImportTrigger.__bound = true;
            btnImportTrigger.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', (e) => {
                const f = e.target.files && e.target.files[0];
                if (f) importBackup(f);
                e.target.value = '';
            });
        }
    }
    window.initAboutPage = initAboutPage;

    // 侧边栏搜索按钮
    const sbSearch = document.getElementById('sidebar-search-btn');
    if (sbSearch) sbSearch.addEventListener('click', () => {
        if (typeof window.openGlobalSearch === 'function') window.openGlobalSearch();
    });

    // 注册 Service Worker (PWA)
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js').catch(err =>
                console.warn('[sw] register failed', err)
            );
        });
    }

    // ---- 初始化 ----
    initNav();
    initQuotation();
    initAboutPage();
    // 默认首页激活：同步 body 类
    if (document.querySelector('#page-home.active')) {
        document.body.classList.add('on-home');
    }

})();
