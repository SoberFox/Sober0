// ============================================================
// 汇率换算 & 贸易术语计算模块
// ============================================================

(function () {
    'use strict';

    function $(sel) { return document.querySelector(sel); }

    // ---- 离线汇率基准（美元为基准，定期可手动更新） ----
    const BASE_RATES = {
        USD: 1,
        CNY: 7.24,
        EUR: 0.92,
        GBP: 0.79,
        JPY: 150.5,
        KRW: 1345,
        HKD: 7.82,
        TWD: 32.1,
        THB: 35.8,
        VND: 25300,
        INR: 83.5,
        BDT: 110,
        IDR: 15800,
        MYR: 4.72,
        PHP: 56.2,
        AED: 3.67,
        CAD: 1.36,
        AUD: 1.55,
        NZD: 1.67,
        SGD: 1.35,
        CHF: 0.88,
        TRY: 32.5,
        BRL: 5.05,
        MXN: 17.2,
        ZAR: 18.9,
        RUB: 92,
    };

    const CURRENCY_NAMES = {
        USD: '美元 USD', CNY: '人民币 CNY', EUR: '欧元 EUR', GBP: '英镑 GBP',
        JPY: '日元 JPY', KRW: '韩元 KRW', HKD: '港币 HKD', TWD: '新台币 TWD',
        THB: '泰铢 THB', VND: '越南盾 VND', INR: '印度卢比 INR', BDT: '孟加拉塔卡 BDT',
        IDR: '印尼盾 IDR', MYR: '马来西亚林吉特 MYR', PHP: '菲律宾比索 PHP',
        AED: '阿联酋迪拉姆 AED', CAD: '加元 CAD', AUD: '澳元 AUD', NZD: '新西兰元 NZD',
        SGD: '新加坡元 SGD', CHF: '瑞士法郎 CHF', TRY: '土耳其里拉 TRY',
        BRL: '巴西雷亚尔 BRL', MXN: '墨西哥比索 MXN', ZAR: '南非兰特 ZAR', RUB: '俄罗斯卢布 RUB',
    };

    // 常用服装贸易国家放前面
    const COMMON_CURRENCIES = ['CNY', 'USD', 'EUR', 'GBP', 'JPY', 'KRW', 'HKD', 'THB', 'VND', 'BDT', 'INR'];

    // ---- 汇率换算 ----
    function convert(amount, from, to) {
        const inUsd = amount / BASE_RATES[from];
        return inUsd * BASE_RATES[to];
    }

    function initCurrency() {
        const fromSel = $('#cur-from');
        const toSel = $('#cur-to');
        if (!fromSel || !toSel) return;

        // 填充下拉框
        const allCodes = Object.keys(BASE_RATES);
        // 常用在前
        const sorted = [...COMMON_CURRENCIES, ...allCodes.filter(c => !COMMON_CURRENCIES.includes(c))];

        [fromSel, toSel].forEach(sel => {
            sel.innerHTML = sorted.map(code =>
                `<option value="${code}">${CURRENCY_NAMES[code] || code}</option>`
            ).join('');
        });

        fromSel.value = 'CNY';
        toSel.value = 'USD';

        // 换算
        function doConvert() {
            const amount = Number($('#cur-amount').value) || 0;
            const from = fromSel.value;
            const to = toSel.value;
            const result = convert(amount, from, to);
            $('#cur-result').textContent = result.toFixed(4);
            $('#cur-rate-display').textContent = `1 ${from} = ${convert(1, from, to).toFixed(6)} ${to}`;

            // 批量换算表
            renderBatchConvert(amount, from);
        }

        $('#cur-amount').addEventListener('input', doConvert);
        fromSel.addEventListener('change', doConvert);
        toSel.addEventListener('change', doConvert);

        // 交换按钮
        $('#btn-swap-currency').addEventListener('click', () => {
            const tmp = fromSel.value;
            fromSel.value = toSel.value;
            toSel.value = tmp;
            doConvert();
        });

        doConvert();

        // ---- 贸易术语计算 ----
        initTradeTerms();
    }

    function renderBatchConvert(amount, from) {
        const container = $('#batch-convert-grid');
        if (!container) return;

        const targets = COMMON_CURRENCIES.filter(c => c !== from);
        container.innerHTML = targets.map(code => {
            const val = convert(amount, from, code);
            return `<div class="batch-item">
                <span class="batch-code">${code}</span>
                <span class="batch-val">${formatNum(val)}</span>
                <span class="batch-name">${CURRENCY_NAMES[code] || ''}</span>
            </div>`;
        }).join('');
    }

    function formatNum(n) {
        if (Math.abs(n) >= 10000) return n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        if (Math.abs(n) >= 1) return n.toFixed(2);
        return n.toFixed(4);
    }

    // ============================================================
    // 贸易术语价格计算
    // ============================================================
    function initTradeTerms() {
        const inputs = ['#trade-fob', '#trade-freight', '#trade-insurance-rate',
            '#trade-customs', '#trade-inland', '#trade-commission-rate', '#trade-quantity'];

        inputs.forEach(sel => {
            const el = $(sel);
            if (el) el.addEventListener('input', calcTradeTerms);
        });

        calcTradeTerms();
    }

    function calcTradeTerms() {
        const fob = Number($('#trade-fob').value) || 0;           // FOB单价 (USD)
        const freight = Number($('#trade-freight').value) || 0;    // 海运费/件
        const insRate = Number($('#trade-insurance-rate').value) || 0.3; // 保险费率 %
        const customs = Number($('#trade-customs').value) || 0;    // 清关费/件
        const inland = Number($('#trade-inland').value) || 0;      // 内陆运输/件
        const commRate = Number($('#trade-commission-rate').value) || 0; // 佣金率 %
        const qty = Number($('#trade-quantity').value) || 1;

        // EXW = FOB - 出口费用（简化：约为FOB的95%）
        const exw = fob * 0.95;

        // CFR = FOB + Freight
        const cfr = fob + freight;

        // CIF = CFR / (1 - 保险费率)
        const cif = cfr / (1 - insRate / 100);
        const insurance = cif - cfr;

        // DDP = CIF + 关税 + 内陆运输
        const ddp = cif + customs + inland;

        // 含佣价
        const cifC = commRate > 0 ? cif / (1 - commRate / 100) : cif;
        const commission = cifC - cif;

        const results = [
            { term: 'EXW', full: '工厂交货价', price: exw, desc: '买方承担全部运输' },
            { term: 'FOB', full: '离岸价', price: fob, desc: '卖方负责到装运港' },
            { term: 'CFR', full: '成本加运费', price: cfr, desc: 'FOB + 海运费' },
            { term: 'CIF', full: '到岸价', price: cif, desc: 'CFR + 保险费' },
            { term: 'DDP', full: '完税交货价', price: ddp, desc: '含关税和内陆运输' },
        ];

        const tbody = $('#trade-results');
        if (!tbody) return;

        tbody.innerHTML = results.map(r => `
            <tr>
                <td><strong>${r.term}</strong></td>
                <td>${r.full}</td>
                <td class="text-right"><strong>$${r.price.toFixed(2)}</strong></td>
                <td class="text-right">$${(r.price * qty).toFixed(2)}</td>
                <td>${r.desc}</td>
            </tr>
        `).join('');

        // 费用明细
        const detail = $('#trade-detail');
        if (detail) {
            detail.innerHTML = `
                <div class="trade-detail-item"><span>海运费/件：</span><strong>$${freight.toFixed(2)}</strong></div>
                <div class="trade-detail-item"><span>保险费/件：</span><strong>$${insurance.toFixed(2)}</strong></div>
                <div class="trade-detail-item"><span>清关费/件：</span><strong>$${customs.toFixed(2)}</strong></div>
                <div class="trade-detail-item"><span>内陆运输/件：</span><strong>$${inland.toFixed(2)}</strong></div>
                ${commRate > 0 ? `<div class="trade-detail-item"><span>佣金/件 (CIFC)：</span><strong>$${commission.toFixed(2)}</strong></div>` : ''}
            `;
        }
    }

    window.initCurrencyPage = function () {
        initCurrency();
    };

    initCurrency();
})();
