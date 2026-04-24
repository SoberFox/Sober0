// ============================================================
// 全局搜索 · Cmd+K / Ctrl+K
// Fuzzy-search across quotes, orders, customers, materials.
// ============================================================

(function () {
    'use strict';

    const OVERLAY_ID = 'global-search';
    const SOURCES = [
        { key: 'clothing_quote_history',    type: '报价', page: 'history',   icon: '&#128221;' },
        { key: 'clothing_orders',           type: '订单', page: 'orders',    icon: '&#128230;' },
        { key: 'clothing_quote_customers',  type: '客户', page: 'customers', icon: '&#128101;' },
        { key: 'clothing_materials',        type: '面辅料', page: 'materials', icon: '&#127808;' },
    ];

    function safeGet(key) {
        try { return JSON.parse(localStorage.getItem(key)) || []; }
        catch { return []; }
    }

    function escHtml(s) {
        const d = document.createElement('div');
        d.textContent = s == null ? '' : String(s);
        return d.innerHTML;
    }

    // 提取可搜索字段
    function extractItems() {
        const out = [];
        SOURCES.forEach(src => {
            const rows = safeGet(src.key);
            rows.forEach(row => {
                const title = row.style || row.name || row.customerName || row.orderNumber || '(未命名)';
                const sub = [row.orderNumber, row.quoteNumber, row.customerName, row.contact, row.phone, row.category, row.status]
                    .filter(Boolean).join(' · ');
                const hay = [
                    row.orderNumber, row.quoteNumber, row.style, row.name, row.customerName,
                    row.contact, row.phone, row.email, row.category, row.status, row.remark, row.destination
                ].filter(Boolean).join(' ').toLowerCase();
                out.push({
                    type: src.type,
                    icon: src.icon,
                    page: src.page,
                    title,
                    sub,
                    hay,
                });
            });
        });
        return out;
    }

    function score(item, qLower) {
        if (!qLower) return 0;
        const idx = item.hay.indexOf(qLower);
        if (idx < 0) return -1;
        // 完整字段开头出现 > 中间出现
        const titleHit = item.title.toLowerCase().indexOf(qLower);
        let s = 100 - idx;
        if (titleHit === 0) s += 50;
        else if (titleHit > 0) s += 20;
        return s;
    }

    function highlight(text, q) {
        if (!q) return escHtml(text);
        const lower = text.toLowerCase();
        const qLower = q.toLowerCase();
        const idx = lower.indexOf(qLower);
        if (idx < 0) return escHtml(text);
        return escHtml(text.slice(0, idx)) +
               '<mark>' + escHtml(text.slice(idx, idx + q.length)) + '</mark>' +
               escHtml(text.slice(idx + q.length));
    }

    let overlay, input, resultsEl, emptyEl;
    let cache = [];
    let cursor = 0;
    let current = [];

    function ensureOverlay() {
        if (overlay) return;
        overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.innerHTML = `
            <div class="gs-backdrop"></div>
            <div class="gs-panel" role="dialog" aria-label="全局搜索">
                <div class="gs-head">
                    <span class="gs-icon">&#128270;</span>
                    <input class="gs-input" type="text" placeholder="搜索款号 / 订单 / 客户 / 物料…" autocomplete="off" />
                    <kbd class="gs-kbd">ESC</kbd>
                </div>
                <div class="gs-body">
                    <div class="gs-results"></div>
                    <div class="gs-empty">没有匹配到任何条目。</div>
                </div>
                <div class="gs-foot">
                    <span><kbd>&uarr;</kbd><kbd>&darr;</kbd> 选择</span>
                    <span><kbd>&crarr;</kbd> 打开</span>
                    <span><kbd>esc</kbd> 关闭</span>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        input = overlay.querySelector('.gs-input');
        resultsEl = overlay.querySelector('.gs-results');
        emptyEl = overlay.querySelector('.gs-empty');

        input.addEventListener('input', onInput);
        input.addEventListener('keydown', onKey);
        overlay.querySelector('.gs-backdrop').addEventListener('click', close);
    }

    function open() {
        ensureOverlay();
        cache = extractItems();
        cursor = 0;
        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';
        input.value = '';
        render('');
        setTimeout(() => input.focus(), 20);
    }

    function close() {
        if (!overlay) return;
        overlay.classList.remove('open');
        document.body.style.overflow = '';
    }

    function onInput() { cursor = 0; render(input.value.trim()); }

    function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(); return; }
        if (e.key === 'Enter')  {
            e.preventDefault();
            if (current[cursor]) choose(current[cursor]);
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            cursor = Math.min(cursor + 1, current.length - 1);
            paintCursor();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            cursor = Math.max(cursor - 1, 0);
            paintCursor();
        }
    }

    function render(q) {
        const qLower = q.toLowerCase();
        if (!qLower) {
            current = cache.slice(0, 12);
        } else {
            current = cache
                .map(it => ({ it, s: score(it, qLower) }))
                .filter(x => x.s >= 0)
                .sort((a, b) => b.s - a.s)
                .slice(0, 20)
                .map(x => x.it);
        }
        if (current.length === 0) {
            resultsEl.innerHTML = '';
            emptyEl.style.display = 'block';
            return;
        }
        emptyEl.style.display = 'none';
        resultsEl.innerHTML = current.map((it, i) => `
            <div class="gs-row ${i === cursor ? 'active' : ''}" data-i="${i}">
                <span class="gs-row-type">${it.icon} ${escHtml(it.type)}</span>
                <span class="gs-row-title">${highlight(it.title, q)}</span>
                <span class="gs-row-sub">${highlight(it.sub, q)}</span>
            </div>
        `).join('');
        resultsEl.querySelectorAll('.gs-row').forEach(row => {
            row.addEventListener('mouseenter', () => {
                cursor = Number(row.dataset.i);
                paintCursor();
            });
            row.addEventListener('click', () => {
                cursor = Number(row.dataset.i);
                choose(current[cursor]);
            });
        });
    }

    function paintCursor() {
        resultsEl.querySelectorAll('.gs-row').forEach((r, i) => {
            r.classList.toggle('active', i === cursor);
            if (i === cursor) r.scrollIntoView({ block: 'nearest' });
        });
    }

    function choose(item) {
        close();
        if (item && item.page && typeof window.gotoPage === 'function') {
            window.gotoPage(item.page);
        }
    }

    // 快捷键：Cmd+K / Ctrl+K
    document.addEventListener('keydown', (e) => {
        // 当输入框聚焦时，仍允许 Cmd/Ctrl+K 触发（输入框内部是第二个分支）
        const inInput = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
        if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
            e.preventDefault();
            if (overlay && overlay.classList.contains('open')) close(); else open();
            return;
        }
        // "/" 聚焦打开 (仅当不在输入框时)
        if (e.key === '/' && !inInput && !(overlay && overlay.classList.contains('open'))) {
            e.preventDefault();
            open();
        }
    });

    // 暴露
    window.openGlobalSearch = open;
})();
