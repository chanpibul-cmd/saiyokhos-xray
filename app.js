/**
 * ====================================================================================
 * X-Ray Department Analytics & Reporting System - Main Application (app.js)
 * โรงพยาบาลไทรโยค (Saiyok Hospital)
 * โหมด: เชื่อมต่อตรงกับ Google Sheets (Google Apps Script Web App) สำหรับ GitHub Pages
 * ====================================================================================
 */

// 1. Default Configuration
const DEFAULT_CONFIG = {
    webAppUrl: 'https://script.google.com/macros/s/AKfycbxu36APVgFWkGl4p0uUijHscMKWMnH__IcJEvwZcsNUxiN-xYTLHiLhxQCo19wsi7fS/exec',
    sheetName: 'XRAY_DATA',
    hospitalName: 'โรงพยาบาลไทรโยค',
    dataMode: 'cloud' // 'cloud' (Google Sheet), 'demo' (Offline Mock)
};

// 2. Global State Management
let appConfig = Object.assign({}, DEFAULT_CONFIG);
let currentActivePeriod = 'today';
let hasAutoFallenBack = false;
let currentStartDate = getTodayStr();
let currentEndDate = getTodayStr();
let latestDateAvailable = null;
let cachedMonthlyData = {};

// In-Memory Data Store (Zero-latency instant rendering)
let cachedOverviewData = null;
let cachedPatientsList = [];
let cachedDailyTrend = [];
let chartInstances = {};
let patientCurrentPage = 1;
let searchTimeout = null;
let fpStart = null;
let fpEnd = null;
let isFetching = false;

// 3. Date & Format Helpers
function getTodayStr() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function formatThaiDate(dateStr) {
    if (!dateStr) return '-';
    const parts = String(dateStr).split('-');
    if (parts.length !== 3) return dateStr;
    const y = parseInt(parts[0], 10) + 543;
    const months = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const m = months[parseInt(parts[1], 10)] || parts[1];
    const d = parseInt(parts[2], 10);
    return `${d} ${m} ${y}`;
}

function safeSetText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = (text !== undefined && text !== null) ? text : '-';
}

function getShiftBadgeClass(shiftCode) {
    switch (shiftCode) {
        case 'night':
            return 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300 border border-purple-200 dark:border-purple-800';
        case 'morning':
            return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800';
        case 'afternoon':
            return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800';
        default:
            return 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300';
    }
}

function getWaitBadge(waitMinutes) {
    if (waitMinutes === null || waitMinutes === undefined || isNaN(waitMinutes)) {
        return { text: '-', badge: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' };
    }
    const mins = Math.round(Number(waitMinutes));
    if (mins <= 30) {
        return { text: `${mins} นาที`, badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800' };
    } else if (mins <= 60) {
        return { text: `${mins} นาที`, badge: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800' };
    } else {
        return { text: `${mins} นาที`, badge: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-800 font-bold' };
    }
}

function getConfirmBadge(confirm) {
    if (confirm === 'Y' || confirm === 'ตรวจสำเร็จ' || confirm === 'ตรวจแล้ว') {
        return { label: 'ตรวจแล้ว (Y)', short: 'Y', badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' };
    } else {
        return { label: 'ไม่ได้ตรวจ (N)', short: 'N', badge: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300' };
    }
}

// Helper: ตรวจสอบสถานะการอ่านฟิล์ม ("รออ่านผล" = "รออ่าน" = ยังไม่ได้อ่าน)
function isFilmRead(status) {
    if (!status) return false;
    const s = String(status).trim();
    if (s === 'รออ่านผล' || s === 'รออ่าน' || s.indexOf('รอ') !== -1 || s === 'N' || s === 'n' || s === '0') {
        return false;
    }
    if (s === 'อ่านผลแล้ว' || s === 'อ่านแล้ว' || s === 'Y' || s === 'y' || s === '1') {
        return true;
    }
    return s.indexOf('อ่าน') !== -1 && s.indexOf('รอ') === -1;
}

function getFilmBadgeInfo(status) {
    const read = isFilmRead(status);
    return {
        isRead: read,
        label: read ? 'อ่านผลแล้ว' : 'รออ่านผล',
        short: read ? 'อ่านแล้ว' : 'รออ่าน',
        badge: read 
            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' 
            : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
    };
}

// 4. Initialization
document.addEventListener('DOMContentLoaded', () => {
    initUrlParams();
    loadStoredSettings();
    if (window.lucide) lucide.createIcons();
    initClock();
    initDatePickers();
    checkTheme();
    updatePeriodButtonStyles();
    updateNavLinks();

    // Auto-fetch data from Google Sheet
    loadDashboardData();

    // Debounced Search on Patients Tab
    const searchInput = document.getElementById('patientSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                loadPatients(1);
            }, 300);
        });
    }
});

// URL Parameter Handling & Navigation Switcher
function initUrlParams() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const pStart = urlParams.get('start_date');
        const pEnd = urlParams.get('end_date');
        const pPeriod = urlParams.get('period');

        if (pPeriod && ['today', 'yesterday', '7days', 'this_month', 'last_month', 'this_year'].includes(pPeriod)) {
            currentActivePeriod = pPeriod;
            computeDatesForPeriod(pPeriod);
        } else if (pStart && pEnd) {
            currentStartDate = pStart;
            currentEndDate = pEnd;
            currentActivePeriod = 'custom';
        }
    } catch (e) {
        console.warn('Could not parse URL params:', e);
    }
}

function updateNavLinks() {
    const btn = document.getElementById('btnNavPortable');
    if (!btn) return;
    const q = new URLSearchParams();
    if (currentStartDate) q.set('start_date', currentStartDate);
    if (currentEndDate) q.set('end_date', currentEndDate);
    if (currentActivePeriod) q.set('period', currentActivePeriod);
    btn.href = 'portable.html?' + q.toString();
}

function updatePeriodButtonStyles() {
    document.querySelectorAll('.period-btn').forEach(btn => {
        btn.classList.remove('bg-cyan-600', 'text-white', 'shadow-sm', 'active-period');
        btn.classList.add('bg-slate-100', 'dark:bg-slate-700', 'text-slate-700', 'dark:text-slate-300');
    });

    if (currentActivePeriod && currentActivePeriod !== 'custom' && currentActivePeriod !== 'latest') {
        const activeBtn = document.querySelector(`[data-period="${currentActivePeriod}"]`);
        if (activeBtn) {
            activeBtn.classList.remove('bg-slate-100', 'dark:bg-slate-700', 'text-slate-700', 'dark:text-slate-300');
            activeBtn.classList.add('bg-cyan-600', 'text-white', 'shadow-sm', 'active-period');
        }
    }
}

function computeDatesForPeriod(type) {
    const now = new Date();
    let start = new Date();
    let end = new Date();

    if (type === 'today') {
        // start and end are today
    } else if (type === 'yesterday') {
        start.setDate(now.getDate() - 1);
        end.setDate(now.getDate() - 1);
    } else if (type === '7days') {
        start.setDate(now.getDate() - 6);
    } else if (type === 'this_month') {
        start = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (type === 'last_month') {
        start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        end = new Date(now.getFullYear(), now.getMonth(), 0);
    } else if (type === 'this_year') {
        start = new Date(now.getFullYear(), 0, 1);
        end = new Date(now.getFullYear(), 11, 31);
    }

    const formatDate = d => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };

    currentStartDate = formatDate(start);
    currentEndDate = formatDate(end);
}

// 5. Clock
function initClock() {
    const updateClock = () => {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        safeSetText('liveClockText', `${hours}:${minutes}:${seconds}`);
    };
    updateClock();
    setInterval(updateClock, 1000);
}

// 6. Flatpickr Date Pickers
function initDatePickers() {
    if (typeof flatpickr === 'undefined') return;
    
    fpStart = flatpickr("#startDateInput", {
        dateFormat: "Y-m-d",
        locale: "th",
        defaultDate: currentStartDate,
        onChange: (selectedDates, dateStr) => {
            currentStartDate = dateStr;
        }
    });

    fpEnd = flatpickr("#endDateInput", {
        dateFormat: "Y-m-d",
        locale: "th",
        defaultDate: currentEndDate,
        onChange: (selectedDates, dateStr) => {
            currentEndDate = dateStr;
        }
    });
}

// 7. Theme Management
function checkTheme() {
    if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }
}

function toggleDarkMode() {
    if (document.documentElement.classList.contains('dark')) {
        document.documentElement.classList.remove('dark');
        localStorage.theme = 'light';
    } else {
        document.documentElement.classList.add('dark');
        localStorage.theme = 'dark';
    }
    if (cachedOverviewData) {
        renderOverviewCharts(cachedOverviewData);
    }
}

// 8. Period Selection Toolbar
function setPeriod(type, triggerLoad = true) {
    currentActivePeriod = type;
    computeDatesForPeriod(type);
    updatePeriodButtonStyles();

    if (fpStart) fpStart.setDate(currentStartDate);
    if (fpEnd) fpEnd.setDate(currentEndDate);

    updateNavLinks();
    const banner = document.getElementById('dateNoticeBanner');
    if (banner) banner.classList.add('hidden');

    if (triggerLoad) {
        cachedPatientsList = [];
        loadDashboardData();
    }
}

function applyCustomDate() {
    const s = document.getElementById('startDateInput');
    const e = document.getElementById('endDateInput');
    if (s && s.value) currentStartDate = s.value;
    if (e && e.value) currentEndDate = e.value;
    currentActivePeriod = 'custom';
    updatePeriodButtonStyles();
    updateNavLinks();
    cachedPatientsList = [];
    loadDashboardData();
}

function switchToLatestDate() {
    if (!latestDateAvailable) return;
    currentStartDate = latestDateAvailable;
    currentEndDate = latestDateAvailable;
    currentActivePeriod = 'latest';
    updatePeriodButtonStyles();
    if (fpStart) fpStart.setDate(currentStartDate);
    if (fpEnd) fpEnd.setDate(currentEndDate);
    updateNavLinks();
    const banner = document.getElementById('dateNoticeBanner');
    if (banner) banner.classList.add('hidden');
    cachedPatientsList = [];
    loadDashboardData();
}

// 9. Tab Switching
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.remove('border-cyan-600', 'text-cyan-600', 'dark:text-cyan-400');
        b.classList.add('border-transparent', 'text-slate-500', 'dark:text-slate-400');
    });

    const activeContent = document.getElementById(tabId);
    if (activeContent) activeContent.classList.remove('hidden');

    const activeBtn = document.getElementById('btn' + tabId.charAt(0).toUpperCase() + tabId.slice(1));
    if (activeBtn) {
        activeBtn.classList.remove('border-transparent', 'text-slate-500', 'dark:text-slate-400');
        activeBtn.classList.add('border-cyan-600', 'text-cyan-600', 'dark:text-cyan-400');
    }

    if (tabId === 'tabDaily') {
        loadDailyData();
    } else if (tabId === 'tabMonthly') {
        loadMonthlyData();
    } else if (tabId === 'tabPatients') {
        loadPatients(1);
    }
}

// 10. Universal Data Requester (Google Apps Script Web App / Demo)
async function requestApi(action, params = {}) {
    params.action = action;
    if (action === 'monthly') {
        delete params.start_date;
        delete params.end_date;
    } else {
        params.start_date = params.start_date || currentStartDate;
        params.end_date = params.end_date || currentEndDate;
    }

    if (appConfig.dataMode === 'demo') {
        return generateDemoData(action, params);
    }

    return await callGoogleAppsScript(params);
}

// Robust Google Apps Script Caller with Strict Timeout & Fallback
async function callGoogleAppsScript(params) {
    if (!appConfig.webAppUrl || appConfig.webAppUrl.trim() === '') {
        throw new Error('ยังไม่ได้ระบุ Google Apps Script Web App URL กรุณาตั้งค่าที่ไอคอนรูปเฟือง');
    }

    const url = new URL(appConfig.webAppUrl);
    Object.keys(params).forEach(k => {
        if (params[k] !== undefined && params[k] !== null && params[k] !== '') {
            url.searchParams.append(k, params[k]);
        }
    });
    if (appConfig.spreadsheetId) url.searchParams.append('spreadsheet_id', appConfig.spreadsheetId);
    if (appConfig.sheetName) url.searchParams.append('sheet_name', appConfig.sheetName);

    // Try standard fetch first (with 16-second AbortController timeout)
    try {
        const controller = new AbortController();
        const fetchTimeout = setTimeout(() => controller.abort(), 16000);

        const res = await fetch(url.toString(), {
            method: 'GET',
            redirect: 'follow',
            signal: controller.signal
        });
        clearTimeout(fetchTimeout);

        if (res.ok) {
            const data = await res.json();
            if (data && typeof data === 'object') {
                return data;
            }
        }
    } catch (fetchErr) {
        // Fetch failed (CORS redirect or browser policy), fall back to JSONP
        console.warn('Fetch GAS direct failed, attempting JSONP callback:', fetchErr.message);
    }

    // JSONP Fallback with strict 16-second timeout
    return new Promise((resolve, reject) => {
        const callbackName = 'gas_cb_' + Math.round(1000000 * Math.random());
        let timer = null;

        const cleanup = () => {
            if (timer) clearTimeout(timer);
            delete window[callbackName];
            const scriptEl = document.getElementById(callbackName);
            if (scriptEl && scriptEl.parentNode) scriptEl.parentNode.removeChild(scriptEl);
        };

        window[callbackName] = function(data) {
            cleanup();
            resolve(data);
        };

        timer = setTimeout(() => {
            cleanup();
            reject(new Error('การเชื่อมต่อ Google Apps Script เกินเวลา (Timeout 16 วินาที) กรุณาตรวจสอบ URL หรือการ Deploy'));
        }, 16000);

        const scriptTag = document.createElement('script');
        scriptTag.id = callbackName;
        url.searchParams.append('callback', callbackName);
        scriptTag.src = url.toString();
        scriptTag.onerror = () => {
            cleanup();
            reject(new Error('ไม่สามารถโหลดข้อมูลผ่าน Google Apps Script Web App ได้ กรุณาตรวจสอบสิทธิ์การเข้าถึง (Who has access: Anyone)'));
        };
        document.body.appendChild(scriptTag);
    });
}

// 11. Main Dashboard Overview Loader
async function loadDashboardData() {
    if (isFetching) return;
    isFetching = true;

    updateNavLinks();

    const icon = document.getElementById('iconRefresh');
    if (icon) icon.classList.add('animate-spin');

    const dateLabelEl = document.getElementById('selectedDateLabel');
    if (dateLabelEl) dateLabelEl.textContent = 'กำลังโหลดข้อมูลจาก Google Sheet...';

    try {
        const data = await requestApi('overview', {
            start_date: currentStartDate,
            end_date: currentEndDate
        });

        if (data && data.status === 'success') {
            const totalOrders = (data.kpi && data.kpi.total_orders) ? data.kpi.total_orders : 0;
            const totalRequests = (data.kpi && data.kpi.total_requests) ? data.kpi.total_requests : 0;

            // Auto-fallback: If today has 0 records and we haven't auto-fallen back yet, switch to latest date
            if (!hasAutoFallenBack && currentActivePeriod === 'today' && totalOrders === 0 && totalRequests === 0 && data.latest_date) {
                hasAutoFallenBack = true;
                latestDateAvailable = data.latest_date;
                currentStartDate = data.latest_date;
                currentEndDate = data.latest_date;
                currentActivePeriod = 'latest';
                updatePeriodButtonStyles();
                if (fpStart) fpStart.setDate(currentStartDate);
                if (fpEnd) fpEnd.setDate(currentEndDate);
                updateNavLinks();

                const banner = document.getElementById('dateNoticeBanner');
                if (banner) {
                    banner.classList.remove('hidden');
                    safeSetText('dateNoticeText', `วันที่ ${formatThaiDate(getTodayStr())} ยังไม่มีรายการตรวจใน Google Sheet — ระบบสลับมาแสดงข้อมูลล่าสุด (${formatThaiDate(latestDateAvailable)}) อัตโนมัติ`);
                    safeSetText('latestDateLabel', formatThaiDate(latestDateAvailable));
                }

                isFetching = false;
                return await loadDashboardData();
            }

            cachedOverviewData = data;

            // Track latest date
            if (data.latest_date) {
                latestDateAvailable = data.latest_date;
            }

            // Cache Daily Trend
            if (data.daily_trend && Array.isArray(data.daily_trend) && data.daily_trend.length > 0) {
                cachedDailyTrend = data.daily_trend;
                if (!latestDateAvailable) {
                    latestDateAvailable = cachedDailyTrend[cachedDailyTrend.length - 1].date;
                }
            } else {
                cachedDailyTrend = [];
            }

            // Cache Patients dataset
            if (data.data && Array.isArray(data.data) && data.data.length > 0) {
                cachedPatientsList = data.data;
            } else {
                cachedPatientsList = [];
            }

            // Render Executive Components
            renderKPIs(data.kpi);
            renderShiftKPIs(data.shift_breakdown, data.kpi);
            renderDateLabel(data.period);
            renderOverviewCharts(data);
            renderTopItems(data.top_items);

            // Update badge on Patient tab
            const patientCount = data.kpi ? (data.kpi.total_orders || data.kpi.total_requests || 0) : 0;
            safeSetText('tabPatientBadge', patientCount.toLocaleString());

            // Smart Date Fallback Banner: When today has 0 records but sheet has earlier records
            handleDateFallbackBanner(data);

        } else if (data && data.status === 'empty') {
            handleEmptyState();
        } else {
            throw new Error((data && data.message) ? data.message : 'ไม่สามารถดึงข้อมูลภาพรวมได้');
        }
    } catch (err) {
        console.error('Error loading dashboard overview:', err);
        showConnectionNotice(err.message);
    } finally {
        isFetching = false;
        if (icon) icon.classList.remove('animate-spin');
        if (window.lucide) lucide.createIcons();
    }
}

// Smart Fallback Banner Handler
function handleDateFallbackBanner(data) {
    const banner = document.getElementById('dateNoticeBanner');
    if (!banner) return;

    const totalOrders = (data.kpi && data.kpi.total_orders) ? data.kpi.total_orders : 0;
    const totalRequests = (data.kpi && data.kpi.total_requests) ? data.kpi.total_requests : 0;

    if (totalOrders === 0 && totalRequests === 0 && latestDateAvailable && latestDateAvailable !== currentStartDate) {
        banner.classList.remove('hidden');
        safeSetText('dateNoticeText', `ยังไม่มีรายการตรวจของวันที่ ${formatThaiDate(currentStartDate)} ใน Google Sheet`);
        safeSetText('latestDateLabel', formatThaiDate(latestDateAvailable));
    } else if (hasAutoFallenBack && currentActivePeriod === 'latest') {
        banner.classList.remove('hidden');
        safeSetText('dateNoticeText', `วันที่ ${formatThaiDate(getTodayStr())} ยังไม่มีรายการตรวจใน Google Sheet — กำลังแสดงข้อมูลล่าสุด (${formatThaiDate(currentStartDate)})`);
        safeSetText('latestDateLabel', formatThaiDate(latestDateAvailable));
    } else {
        banner.classList.add('hidden');
    }
}

function handleEmptyState() {
    renderKPIs({ total_orders: 0, total_requests: 0, unconfirmed_orders: 0, total_patients: 0, opd_patients: 0, ipd_patients: 0, total_revenue: 0, opd_orders: 0, ipd_orders: 0, read_films: 0, unread_films: 0, read_rate: 0, avg_wait_minutes: 0, wait_under_30_rate: 0 });
    renderDateLabel({ start_date: currentStartDate, end_date: currentEndDate, is_single_day: currentStartDate === currentEndDate });
}

function showConnectionNotice(errMsg) {
    const dateLabelEl = document.getElementById('selectedDateLabel');
    if (dateLabelEl) dateLabelEl.innerHTML = `<span class="text-rose-500 font-medium">เชื่อมต่อไม่สำเร็จ: ${errMsg}</span>`;
    
    // Auto-offer demo mode if user wants to view dashboard offline
    const banner = document.getElementById('dateNoticeBanner');
    if (banner) {
        banner.classList.remove('hidden');
        safeSetText('dateNoticeText', `ไม่สามารถเชื่อมต่อ Google Sheet ได้ (${errMsg})`);
        const btn = document.getElementById('btnSwitchToLatestDate');
        if (btn) {
            btn.innerHTML = '<i data-lucide="play" class="w-3.5 h-3.5"></i> <span>เปิดโหมดตัวอย่าง (Demo)</span>';
            btn.onclick = () => {
                appConfig.dataMode = 'demo';
                banner.classList.add('hidden');
                loadDashboardData();
            };
        }
    }
}

// 12. Render KPIs (5 Executive Cards)
function renderKPIs(kpi) {
    if (!kpi) return;

    // Card 1: Performed Orders (Confirm = Y) & Requests
    safeSetText('kpiTotalOrders', (kpi.total_orders || 0).toLocaleString());
    safeSetText('kpiTotalRequests', (kpi.total_requests || kpi.total_orders || 0).toLocaleString());
    safeSetText('kpiUnconfirmedOrders', (kpi.unconfirmed_orders || 0).toLocaleString());
    safeSetText('kpiOpdOrders', (kpi.opd_orders || 0).toLocaleString());
    safeSetText('kpiIpdOrders', (kpi.ipd_orders || 0).toLocaleString());

    // Card 2: Patients (Examined)
    safeSetText('kpiTotalPatients', (kpi.total_patients || 0).toLocaleString());
    safeSetText('kpiOpdPatients', (kpi.opd_patients || 0).toLocaleString());
    safeSetText('kpiIpdPatients', (kpi.ipd_patients || 0).toLocaleString());

    // Card 3: Waiting Time KPI
    const avgWait = kpi.avg_wait_minutes !== undefined && kpi.avg_wait_minutes !== null ? kpi.avg_wait_minutes : 0;
    safeSetText('kpiAvgWaitMinutes', avgWait.toLocaleString());
    safeSetText('kpiWaitUnder30Rate', (kpi.wait_under_30_rate || 0) + '%');
    safeSetText('kpiWaitUnder30Count', (kpi.wait_under_30_count || 0).toLocaleString());

    // Card 4: Total Revenue
    const rev = kpi.total_revenue || 0;
    safeSetText('kpiTotalRevenue', '฿' + rev.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 }));
    const avgPt = kpi.total_patients > 0 ? (rev / kpi.total_patients) : 0;
    const avgOrd = kpi.total_orders > 0 ? (rev / kpi.total_orders) : 0;
    safeSetText('kpiAvgPerPatient', '฿' + Math.round(avgPt).toLocaleString());
    safeSetText('kpiAvgPerOrder', '฿' + Math.round(avgOrd).toLocaleString());

    // Card 5: Film Reading Status
    const readRate = kpi.read_rate || 0;
    safeSetText('kpiReadRate', readRate + '%');
    const elProgressBar = document.getElementById('kpiProgressBar');
    if (elProgressBar) elProgressBar.style.width = readRate + '%';
    safeSetText('kpiReadFilms', (kpi.read_films || 0).toLocaleString());
    safeSetText('kpiUnreadFilms', (kpi.unread_films || 0).toLocaleString());
}

// 13. Render Shift Executive Summary (3 Cards)
function renderShiftKPIs(shifts, kpi) {
    if (!shifts || !Array.isArray(shifts)) return;
    const shiftMap = {};
    shifts.forEach(s => shiftMap[s.code] = s);

    const night = shiftMap.night || { order_count: 0, patient_count: 0, revenue: 0, percent: 0 };
    const morning = shiftMap.morning || { order_count: 0, patient_count: 0, revenue: 0, percent: 0 };
    const afternoon = shiftMap.afternoon || { order_count: 0, patient_count: 0, revenue: 0, percent: 0 };

    // Night Shift (00:00 - 08:00)
    safeSetText('shiftNightOrders', (night.order_count || 0).toLocaleString());
    safeSetText('shiftNightPatients', (night.patient_count || 0).toLocaleString());
    safeSetText('shiftNightPercent', (night.percent || 0) + '%');
    safeSetText('shiftNightRevenue', '฿' + Math.round(night.revenue || 0).toLocaleString());

    // Morning Shift (08:00 - 16:00)
    safeSetText('shiftMorningOrders', (morning.order_count || 0).toLocaleString());
    safeSetText('shiftMorningPatients', (morning.patient_count || 0).toLocaleString());
    safeSetText('shiftMorningPercent', (morning.percent || 0) + '%');
    safeSetText('shiftMorningRevenue', '฿' + Math.round(morning.revenue || 0).toLocaleString());

    // Afternoon Shift (16:00 - 24:00)
    safeSetText('shiftAfternoonOrders', (afternoon.order_count || 0).toLocaleString());
    safeSetText('shiftAfternoonPatients', (afternoon.patient_count || 0).toLocaleString());
    safeSetText('shiftAfternoonPercent', (afternoon.percent || 0) + '%');
    safeSetText('shiftAfternoonRevenue', '฿' + Math.round(afternoon.revenue || 0).toLocaleString());
}

function filterByShift(shiftCode) {
    const shiftSelect = document.getElementById('filterShift');
    if (shiftSelect) shiftSelect.value = shiftCode;
    switchTab('tabPatients');
}

function renderDateLabel(period) {
    const el = document.getElementById('selectedDateLabel');
    if (!el) return;
    if (!period) {
        el.textContent = currentStartDate === currentEndDate ? formatThaiDate(currentStartDate) : `${formatThaiDate(currentStartDate)} ถึง ${formatThaiDate(currentEndDate)}`;
        return;
    }
    if (period.is_single_day) {
        el.textContent = period.thai_start_date || formatThaiDate(period.start_date);
    } else {
        const s = period.thai_start_date || formatThaiDate(period.start_date);
        const e = period.thai_end_date || formatThaiDate(period.end_date);
        el.textContent = `${s} ถึง ${e}`;
    }
}

// 14. Render Overview Charts
function renderOverviewCharts(data) {
    const isDark = document.documentElement.classList.contains('dark');
    const textColor = isDark ? '#94a3b8' : '#64748b';
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

    // A. Daily Trend Chart
    const elDailyTrend = document.getElementById('chartDailyTrend');
    if (elDailyTrend && data.daily_trend && Array.isArray(data.daily_trend) && data.daily_trend.length > 0) {
        if (chartInstances.dailyTrend) chartInstances.dailyTrend.destroy();
        const ctxTrend = elDailyTrend.getContext('2d');
        chartInstances.dailyTrend = new Chart(ctxTrend, {
            type: 'line',
            data: {
                labels: data.daily_trend.map(d => d.short_label || d.date),
                datasets: [
                    {
                        label: 'ตรวจสำเร็จ (ครั้ง)',
                        data: data.daily_trend.map(d => d.orders),
                        borderColor: '#06b6d4',
                        backgroundColor: 'rgba(6, 182, 212, 0.1)',
                        fill: true,
                        tension: 0.35,
                        borderWidth: 2,
                        pointRadius: 3,
                        yAxisID: 'y'
                    },
                    {
                        label: 'สั่งตรวจทั้งหมด (ครั้ง)',
                        data: data.daily_trend.map(d => d.requests || d.orders),
                        borderColor: '#94a3b8',
                        borderDash: [4, 4],
                        fill: false,
                        tension: 0.35,
                        borderWidth: 1.5,
                        pointRadius: 2,
                        yAxisID: 'y'
                    },
                    {
                        label: 'ผู้ป่วย (คน)',
                        data: data.daily_trend.map(d => d.patients),
                        borderColor: '#3b82f6',
                        backgroundColor: 'transparent',
                        tension: 0.35,
                        borderWidth: 2,
                        pointRadius: 3,
                        yAxisID: 'y'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { labels: { color: textColor, font: { family: 'Prompt', size: 11 } } },
                    tooltip: { titleFont: { family: 'Prompt' }, bodyFont: { family: 'Prompt' } }
                },
                scales: {
                    x: { grid: { color: gridColor }, ticks: { color: textColor, font: { family: 'Prompt', size: 11 } } },
                    y: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: textColor, font: { family: 'Prompt', size: 11 } } }
                }
            }
        });
    }

    // B. Shift Doughnut Chart
    const elShiftDist = document.getElementById('chartShiftDistribution');
    if (elShiftDist && data.shift_breakdown && Array.isArray(data.shift_breakdown)) {
        if (chartInstances.shiftDist) chartInstances.shiftDist.destroy();
        const ctxShift = elShiftDist.getContext('2d');
        chartInstances.shiftDist = new Chart(ctxShift, {
            type: 'doughnut',
            data: {
                labels: data.shift_breakdown.map(s => s.short || s.name),
                datasets: [{
                    data: data.shift_breakdown.map(s => s.order_count || 0),
                    backgroundColor: ['#8B5CF6', '#F59E0B', '#3B82F6'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { color: textColor, font: { family: 'Prompt', size: 11 } } },
                    tooltip: { titleFont: { family: 'Prompt' }, bodyFont: { family: 'Prompt' } }
                },
                cutout: '68%'
            }
        });
    }

    // C. Hourly Workload Chart (Colored by 3 Shifts)
    const elHourly = document.getElementById('chartHourlyWorkload');
    if (elHourly && data.hourly_workload && Array.isArray(data.hourly_workload)) {
        if (chartInstances.hourly) chartInstances.hourly.destroy();
        const ctxHourly = elHourly.getContext('2d');
        const bgColors = data.hourly_workload.map(h => {
            const hour = h.hour;
            if (hour >= 0 && hour < 8) return '#8B5CF6'; // Night
            if (hour >= 8 && hour < 16) return '#F59E0B'; // Morning
            return '#3B82F6'; // Afternoon
        });

        chartInstances.hourly = new Chart(ctxHourly, {
            type: 'bar',
            data: {
                labels: data.hourly_workload.map(h => h.label || `${h.hour}:00`),
                datasets: [{
                    label: 'จำนวนตรวจ (ครั้ง)',
                    data: data.hourly_workload.map(h => h.count),
                    backgroundColor: bgColors,
                    borderRadius: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { titleFont: { family: 'Prompt' }, bodyFont: { family: 'Prompt' } }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { color: textColor, font: { family: 'Prompt', size: 9 }, maxRotation: 0 } },
                    y: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: textColor, font: { family: 'Prompt', size: 10 } } }
                }
            }
        });
    }

    // D. Department Distribution Doughnut Chart
    const elDept = document.getElementById('chartDepartment');
    if (elDept && data.department_distribution && Array.isArray(data.department_distribution)) {
        if (chartInstances.dept) chartInstances.dept.destroy();
        const ctxDept = elDept.getContext('2d');
        const colors = ['#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#64748b', '#cbd5e1'];
        chartInstances.dept = new Chart(ctxDept, {
            type: 'doughnut',
            data: {
                labels: data.department_distribution.map(d => d.name),
                datasets: [{
                    data: data.department_distribution.map(d => d.count),
                    backgroundColor: colors.slice(0, data.department_distribution.length),
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 10, color: textColor, font: { family: 'Prompt', size: 10 } } },
                    tooltip: { titleFont: { family: 'Prompt' }, bodyFont: { family: 'Prompt' } }
                },
                cutout: '65%'
            }
        });

        // Also populate Department Select Filter in Tab 4
        populateDepartmentFilter(data.department_distribution);
    }

    // E. Insurance Distribution Pie Chart
    const elIns = document.getElementById('chartInsurance');
    if (elIns && data.insurance_distribution && Array.isArray(data.insurance_distribution)) {
        if (chartInstances.insurance) chartInstances.insurance.destroy();
        const ctxIns = elIns.getContext('2d');
        chartInstances.insurance = new Chart(ctxIns, {
            type: 'pie',
            data: {
                labels: data.insurance_distribution.map(i => i.name),
                datasets: [{
                    data: data.insurance_distribution.map(i => i.count),
                    backgroundColor: data.insurance_distribution.map(i => i.color || '#3b82f6'),
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 10, color: textColor, font: { family: 'Prompt', size: 10 } } },
                    tooltip: { titleFont: { family: 'Prompt' }, bodyFont: { family: 'Prompt' } }
                }
            }
        });
    }
}

function populateDepartmentFilter(depts) {
    const sel = document.getElementById('filterDepartment');
    if (!sel || sel.options.length > 2) return;
    depts.forEach(d => {
        if (d.name && d.name !== 'อื่นๆ') {
            const opt = document.createElement('option');
            opt.value = d.name;
            opt.textContent = `${d.name} (${d.count})`;
            sel.appendChild(opt);
        }
    });
}

// 15. Render Top 10 Examined Items
function renderTopItems(items) {
    const container = document.getElementById('topItemsList');
    if (!container) return;
    if (!items || items.length === 0) {
        container.innerHTML = '<div class="text-center py-8 text-xs text-slate-400">ไม่มีข้อมูลท่าตรวจในช่วงเวลานี้</div>';
        return;
    }

    const maxCount = Math.max(...items.map(i => i.count || 1));
    container.innerHTML = items.map((item, idx) => {
        const percent = Math.round(((item.count || 0) / maxCount) * 100);
        const rankColor = idx === 0 ? 'bg-amber-500 text-white' : (idx === 1 ? 'bg-slate-400 text-white' : (idx === 2 ? 'bg-amber-700 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'));
        return `
            <div class="p-2 rounded-xl bg-slate-50 dark:bg-slate-750 dark:bg-slate-700/30 border border-slate-100 dark:border-slate-700/60">
                <div class="flex items-center justify-between text-xs mb-1">
                    <div class="flex items-center space-x-2 truncate">
                        <span class="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${rankColor}">${idx + 1}</span>
                        <span class="font-medium text-slate-800 dark:text-slate-200 truncate" title="${item.name}">${item.name}</span>
                    </div>
                    <div class="text-right shrink-0">
                        <span class="font-bold text-cyan-600 dark:text-cyan-400">${(item.count || 0).toLocaleString()}</span>
                        <span class="text-[10px] text-slate-400 ml-0.5">ครั้ง</span>
                    </div>
                </div>
                <div class="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-1.5 overflow-hidden">
                    <div class="bg-cyan-500 h-1.5 rounded-full transition-all duration-500" style="width: ${percent}%"></div>
                </div>
            </div>
        `;
    }).join('');
}

// 16. Load Daily Breakdown Table (Tab 2)
async function loadDailyData() {
    const tbody = document.getElementById('dailyTableBody');
    if (!tbody) return;

    // Instant In-Memory Render: If we already have daily_trend cached
    if (cachedDailyTrend.length > 0) {
        renderDailyTable(cachedDailyTrend);
        return;
    }

    tbody.innerHTML = '<tr><td colspan="12" class="px-4 py-8 text-center text-slate-400">กำลังโหลดข้อมูลสรุปรายวันจาก Google Sheet...</td></tr>';

    try {
        const data = await requestApi('daily', {
            start_date: currentStartDate,
            end_date: currentEndDate
        });

        if (data && data.status === 'success' && Array.isArray(data.data) && data.data.length > 0) {
            cachedDailyTrend = data.data;
            renderDailyTable(data.data);
        } else {
            // If remote returned empty or not implemented, synthesize from overview
            if (cachedOverviewData && cachedOverviewData.daily_trend && cachedOverviewData.daily_trend.length > 0) {
                renderDailyTable(cachedOverviewData.daily_trend);
            } else {
                tbody.innerHTML = '<tr><td colspan="12" class="px-4 py-8 text-center text-slate-400">ไม่พบข้อมูลรายวันในช่วงเวลาที่เลือก</td></tr>';
            }
        }
    } catch (err) {
        console.error('Error in loadDailyData:', err);
        if (cachedOverviewData && cachedOverviewData.daily_trend) {
            renderDailyTable(cachedOverviewData.daily_trend);
        } else {
            tbody.innerHTML = `<tr><td colspan="12" class="px-4 py-8 text-center text-rose-500">เกิดข้อผิดพลาด: ${err.message}</td></tr>`;
        }
    }
}

function renderDailyTable(rows) {
    const tbody = document.getElementById('dailyTableBody');
    if (!tbody) return;

    if (!rows || rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="12" class="px-4 py-8 text-center text-slate-400">ไม่พบข้อมูลในช่วงเวลาที่เลือก</td></tr>';
        return;
    }

    // Sort descending by date
    const sorted = rows.slice().sort((a, b) => b.date.localeCompare(a.date));

    let sumOrders = 0, sumRequests = 0, sumUnconfirmed = 0, sumPatients = 0, sumRev = 0;
    let sumNight = 0, sumMorning = 0, sumAfternoon = 0, sumOpd = 0, sumIpd = 0;
    let sumRead = 0, sumUnread = 0;
    let totalWaitMins = 0, totalWaitCount = 0;

    tbody.innerHTML = sorted.map(r => {
        const orders = r.orders !== undefined ? r.orders : (r.total_orders || 0);
        const requests = r.requests !== undefined ? r.requests : (r.total_requests || orders);
        const unconfirmed = r.unconfirmed !== undefined ? r.unconfirmed : Math.max(0, requests - orders);
        const patients = r.patients !== undefined ? r.patients : (r.total_patients || 0);
        const revenue = r.revenue !== undefined ? r.revenue : (r.total_revenue || 0);
        const night = r.night !== undefined ? r.night : (r.night_orders || 0);
        const morning = r.morning !== undefined ? r.morning : (r.morning_orders || 0);
        const afternoon = r.afternoon !== undefined ? r.afternoon : (r.afternoon_orders || 0);
        const opd = r.opd !== undefined ? r.opd : (r.opd_orders || 0);
        const ipd = r.ipd !== undefined ? r.ipd : (r.ipd_orders || 0);
        const read = r.read_films !== undefined ? r.read_films : 0;
        const unread = r.unread_films !== undefined ? r.unread_films : Math.max(0, orders - read);
        const waitAvg = r.avg_wait_minutes !== undefined && r.avg_wait_minutes !== null ? r.avg_wait_minutes : '-';

        sumOrders += orders;
        sumRequests += requests;
        sumUnconfirmed += unconfirmed;
        sumPatients += patients;
        sumRev += revenue;
        sumNight += night;
        sumMorning += morning;
        sumAfternoon += afternoon;
        sumOpd += opd;
        sumIpd += ipd;
        sumRead += read;
        sumUnread += unread;

        if (typeof r.avg_wait_minutes === 'number') {
            totalWaitMins += (r.avg_wait_minutes * orders);
            totalWaitCount += orders;
        }

        const waitBadge = getWaitBadge(waitAvg);

        return `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-750/50 transition">
                <td class="px-3 py-2.5 text-center font-medium text-slate-800 dark:text-slate-200">${formatThaiDate(r.date)}</td>
                <td class="px-3 py-2.5 text-right font-bold text-cyan-700 dark:text-cyan-400">${orders.toLocaleString()}</td>
                <td class="px-3 py-2.5 text-right font-semibold text-slate-700 dark:text-slate-300">${patients.toLocaleString()}</td>
                <td class="px-3 py-2.5 text-center"><span class="px-2 py-0.5 rounded-full text-[11px] font-bold ${waitBadge.badge}">${waitBadge.text}</span></td>
                <td class="px-3 py-2.5 text-center font-semibold text-purple-700 dark:text-purple-300 bg-purple-50/20">${night.toLocaleString()}</td>
                <td class="px-3 py-2.5 text-center font-semibold text-amber-700 dark:text-amber-300 bg-amber-50/20">${morning.toLocaleString()}</td>
                <td class="px-3 py-2.5 text-center font-semibold text-blue-700 dark:text-blue-300 bg-blue-50/20">${afternoon.toLocaleString()}</td>
                <td class="px-3 py-2.5 text-right text-slate-600 dark:text-slate-400">${opd}/${ipd}</td>
                <td class="px-3 py-2.5 text-right font-mono font-semibold text-slate-800 dark:text-slate-200">฿${revenue.toLocaleString()}</td>
                <td class="px-3 py-2.5 text-center text-emerald-600 dark:text-emerald-400 font-bold">${read.toLocaleString()}</td>
                <td class="px-3 py-2.5 text-center text-amber-600 dark:text-amber-400 font-bold">${unread.toLocaleString()}</td>
                <td class="px-3 py-2.5 text-center">
                    <button onclick="viewDateInPatients('${r.date}')" class="px-2.5 py-1 text-xs rounded-lg bg-cyan-50 dark:bg-cyan-950/50 hover:bg-cyan-100 dark:hover:bg-cyan-900/60 text-cyan-700 dark:text-cyan-300 font-medium transition shadow-xs">
                        ดูคนไข้
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    const grandAvgWait = totalWaitCount > 0 ? (totalWaitMins / totalWaitCount).toFixed(1) : '-';
    const tfoot = document.getElementById('dailyTableFoot');
    if (tfoot) {
        tfoot.innerHTML = `
            <tr class="bg-slate-100 dark:bg-slate-750 text-slate-900 dark:text-white font-bold">
                <td class="px-3 py-3 text-center">รวมทั้งหมด (${sorted.length} วัน)</td>
                <td class="px-3 py-3 text-right text-cyan-700 dark:text-cyan-300">${sumOrders.toLocaleString()}</td>
                <td class="px-3 py-3 text-right">${sumPatients.toLocaleString()}</td>
                <td class="px-3 py-3 text-center text-teal-700 dark:text-teal-300">${grandAvgWait} นาที</td>
                <td class="px-3 py-3 text-center text-purple-700 dark:text-purple-300">${sumNight.toLocaleString()}</td>
                <td class="px-3 py-3 text-center text-amber-700 dark:text-amber-300">${sumMorning.toLocaleString()}</td>
                <td class="px-3 py-3 text-center text-blue-700 dark:text-blue-300">${sumAfternoon.toLocaleString()}</td>
                <td class="px-3 py-3 text-right">${sumOpd}/${sumIpd}</td>
                <td class="px-3 py-3 text-right font-mono">฿${sumRev.toLocaleString()}</td>
                <td class="px-3 py-3 text-center text-emerald-600">${sumRead.toLocaleString()}</td>
                <td class="px-3 py-3 text-center text-amber-600">${sumUnread.toLocaleString()}</td>
                <td class="px-3 py-3 text-center">-</td>
            </tr>
        `;
    }
}

function viewDateInPatients(dateStr) {
    currentStartDate = dateStr;
    currentEndDate = dateStr;
    currentActivePeriod = 'custom';
    updatePeriodButtonStyles();
    if (fpStart) fpStart.setDate(dateStr);
    if (fpEnd) fpEnd.setDate(dateStr);
    updateNavLinks();
    cachedPatientsList = [];
    switchTab('tabPatients');
}

// 17. Load Monthly Breakdown Table (Tab 3)
async function loadMonthlyData() {
    const tbody = document.getElementById('monthlyTableBody');
    if (!tbody) return;

    const yearSelect = document.getElementById('monthlyYearSelect');
    const selectedYear = yearSelect ? yearSelect.value : String(new Date().getFullYear());

    // If cached in memory, render immediately
    if (cachedMonthlyData[selectedYear]) {
        renderMonthlyTable(cachedMonthlyData[selectedYear], selectedYear);
        return;
    }

    tbody.innerHTML = '<tr><td colspan="9" class="px-4 py-8 text-center text-slate-400">กำลังโหลดข้อมูลสรุปรายเดือนจาก Google Sheet...</td></tr>';

    try {
        const data = await requestApi('monthly', { year: selectedYear });
        if (data && data.status === 'success' && Array.isArray(data.data)) {
            cachedMonthlyData[selectedYear] = data.data;
            renderMonthlyTable(data.data, selectedYear);
        } else {
            const synthesized = synthesizeMonthlyFromDaily(cachedDailyTrend, selectedYear);
            renderMonthlyTable(synthesized, selectedYear);
        }
    } catch (err) {
        console.error('Error in loadMonthlyData:', err);
        const synthesized = synthesizeMonthlyFromDaily(cachedDailyTrend, selectedYear);
        renderMonthlyTable(synthesized, selectedYear);
    }
}

function synthesizeMonthlyFromDaily(dailyRows, yearStr) {
    const monthNames = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const thYear = parseInt(yearStr, 10) + 543;
    const months = [];

    for (let m = 1; m <= 12; m++) {
        const mKey = `${yearStr}-${String(m).padStart(2, '0')}`;
        let mOrders = 0, mPatients = 0, mOpd = 0, mIpd = 0, mRev = 0, mRead = 0, mUnread = 0;

        dailyRows.forEach(d => {
            if (d.date && d.date.indexOf(mKey) === 0) {
                const ord = d.orders !== undefined ? d.orders : (d.total_orders || 0);
                const dRead = d.read_films !== undefined ? d.read_films : 0;
                const dUnread = d.unread_films !== undefined ? d.unread_films : Math.max(0, ord - dRead);
                mOrders += ord;
                mPatients += (d.patients !== undefined ? d.patients : (d.total_patients || 0));
                mOpd += (d.opd !== undefined ? d.opd : (d.opd_orders || 0));
                mIpd += (d.ipd !== undefined ? d.ipd : (d.ipd_orders || 0));
                mRev += (d.revenue !== undefined ? d.revenue : (d.total_revenue || 0));
                mRead += dRead;
                mUnread += dUnread;
            }
        });

        months.push({
            month_no: m,
            month_key: mKey,
            month_name: `${monthNames[m - 1]} ${thYear}`,
            total_orders: mOrders,
            total_patients: mPatients,
            opd_orders: mOpd,
            ipd_orders: mIpd,
            read_films: mRead,
            unread_films: mUnread,
            total_revenue: mRev
        });
    }
    return months;
}

function renderMonthlyTable(months, selectedYear) {
    const tbody = document.getElementById('monthlyTableBody');
    if (!tbody || !months) return;

    let sumOrders = 0, sumPatients = 0, sumOpd = 0, sumIpd = 0, sumRev = 0, sumRead = 0, sumUnread = 0;

    tbody.innerHTML = months.map(m => {
        const orders = m.total_orders || 0;
        const patients = m.total_patients || 0;
        const opd = m.opd_orders || 0;
        const ipd = m.ipd_orders || 0;
        const revenue = m.total_revenue || 0;
        const read = m.read_films || 0;
        const unread = m.unread_films || Math.max(0, orders - read);
        const rate = orders > 0 ? Math.round((read / orders) * 100) : 0;

        sumOrders += orders;
        sumPatients += patients;
        sumOpd += opd;
        sumIpd += ipd;
        sumRev += revenue;
        sumRead += read;
        sumUnread += unread;

        return `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-750/50 transition">
                <td class="px-4 py-3 text-center font-medium text-slate-800 dark:text-slate-200">${m.month_name}</td>
                <td class="px-4 py-3 text-right font-bold text-cyan-700 dark:text-cyan-400">${orders.toLocaleString()}</td>
                <td class="px-4 py-3 text-right font-semibold text-slate-700 dark:text-slate-300">${patients.toLocaleString()}</td>
                <td class="px-4 py-3 text-right text-slate-600 dark:text-slate-400">${opd.toLocaleString()}</td>
                <td class="px-4 py-3 text-right text-slate-600 dark:text-slate-400">${ipd.toLocaleString()}</td>
                <td class="px-4 py-3 text-right font-mono font-semibold text-slate-800 dark:text-slate-200">฿${revenue.toLocaleString()}</td>
                <td class="px-4 py-3 text-center text-emerald-600 font-bold">${read.toLocaleString()}</td>
                <td class="px-4 py-3 text-center text-amber-600 font-bold">${unread.toLocaleString()}</td>
                <td class="px-4 py-3 text-center font-semibold">${rate}%</td>
            </tr>
        `;
    }).join('');

    const grandRate = sumOrders > 0 ? Math.round((sumRead / sumOrders) * 100) : 0;
    const tfoot = document.getElementById('monthlyTableFoot');
    if (tfoot) {
        tfoot.innerHTML = `
            <tr class="bg-slate-100 dark:bg-slate-750 text-slate-900 dark:text-white font-bold">
                <td class="px-4 py-3 text-center">รวมทั้งปี (${selectedYear})</td>
                <td class="px-4 py-3 text-right text-cyan-700 dark:text-cyan-300">${sumOrders.toLocaleString()}</td>
                <td class="px-4 py-3 text-right">${sumPatients.toLocaleString()}</td>
                <td class="px-4 py-3 text-right">${sumOpd.toLocaleString()}</td>
                <td class="px-4 py-3 text-right">${sumIpd.toLocaleString()}</td>
                <td class="px-4 py-3 text-right font-mono">฿${sumRev.toLocaleString()}</td>
                <td class="px-4 py-3 text-center text-emerald-600">${sumRead.toLocaleString()}</td>
                <td class="px-4 py-3 text-center text-amber-600">${sumUnread.toLocaleString()}</td>
                <td class="px-4 py-3 text-center">${grandRate}%</td>
            </tr>
        `;
    }

    renderMonthlyChart(months);
}

function renderMonthlyChart(months) {
    const el = document.getElementById('chartMonthlyTrend');
    if (!el || !months) return;
    if (chartInstances.monthly) chartInstances.monthly.destroy();

    const isDark = document.documentElement.classList.contains('dark');
    const textColor = isDark ? '#94a3b8' : '#64748b';
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

    chartInstances.monthly = new Chart(el.getContext('2d'), {
        type: 'bar',
        data: {
            labels: months.map(m => m.month_name.split(' ')[0]),
            datasets: [
                {
                    label: 'OPD (ครั้ง)',
                    data: months.map(m => m.opd_orders || 0),
                    backgroundColor: '#06b6d4',
                    borderRadius: 4
                },
                {
                    label: 'IPD (ครั้ง)',
                    data: months.map(m => m.ipd_orders || 0),
                    backgroundColor: '#3b82f6',
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: textColor, font: { family: 'Prompt', size: 11 } } },
                tooltip: { titleFont: { family: 'Prompt' }, bodyFont: { family: 'Prompt' } }
            },
            scales: {
                x: { stacked: true, grid: { display: false }, ticks: { color: textColor, font: { family: 'Prompt', size: 11 } } },
                y: { stacked: true, beginAtZero: true, grid: { color: gridColor }, ticks: { color: textColor, font: { family: 'Prompt', size: 11 } } }
            }
        }
    });
}

// 18. Load Patients Master Table (Tab 4, 17 Columns with Client-Side Instant Filtering)
async function loadPatients(page = 1) {
    patientCurrentPage = page;
    const tbody = document.getElementById('patientTableBody');
    if (!tbody) return;

    const search = (document.getElementById('patientSearchInput')?.value || '').trim().toLowerCase();
    const examStatus = document.getElementById('filterExamStatus')?.value || 'all';
    const department = document.getElementById('filterDepartment')?.value || 'all';
    const filmStatus = document.getElementById('filterFilmStatus')?.value || 'all';
    const shift = document.getElementById('filterShift')?.value || 'all';
    const limit = parseInt(document.getElementById('filterLimit')?.value || '25', 10);

    // If cached in memory, perform instant client-side filter and pagination (0 ms)
    if (cachedPatientsList.length > 0) {
        renderFilteredPatients(cachedPatientsList, page, limit, { search, examStatus, department, filmStatus, shift });
        return;
    }

    tbody.innerHTML = '<tr><td colspan="17" class="px-4 py-8 text-center text-slate-400">กำลังโหลดรายชื่อผู้ป่วยจาก Google Sheet...</td></tr>';

    try {
        const data = await requestApi('patients', {
            start_date: currentStartDate,
            end_date: currentEndDate,
            search: search,
            exam_status: examStatus,
            shift: shift,
            department: department,
            film_status: filmStatus,
            page: page,
            limit: limit
        });

        if (data && data.status === 'success' && Array.isArray(data.data) && data.data.length > 0) {
            renderPatientRows(data.data);
            renderPagination(data);
        } else {
            tbody.innerHTML = '<tr><td colspan="17" class="px-4 py-8 text-center text-slate-400">ไม่พบข้อมูลผู้ป่วยตามเงื่อนไขที่ระบุ</td></tr>';
            safeSetText('patientPaginationInfo', 'แสดง 0 รายการ');
            const controls = document.getElementById('patientPaginationControls');
            if (controls) controls.innerHTML = '';
        }
    } catch (err) {
        console.error('Error in loadPatients:', err);
        tbody.innerHTML = `<tr><td colspan="17" class="px-4 py-8 text-center text-rose-500">เกิดข้อผิดพลาด: ${err.message}</td></tr>`;
    }
}

function renderFilteredPatients(list, page, limit, filters) {
    const tbody = document.getElementById('patientTableBody');
    if (!tbody) return;

    let filtered = list.filter(p => {
        // Date range filter
        if (currentStartDate && p.request_date && p.request_date < currentStartDate) return false;
        if (currentEndDate && p.request_date && p.request_date > currentEndDate) return false;

        // Exam status filter
        if (filters.examStatus === 'confirmed' && p.confirm !== 'Y') return false;
        if ((filters.examStatus === 'not_confirmed' || filters.examStatus === 'unconfirmed') && p.confirm === 'Y') return false;

        // Shift filter
        if (filters.shift !== 'all' && p.shift_code !== filters.shift) return false;

        // Department filter
        if (filters.department !== 'all' && p.department_name !== filters.department) return false;

        // Film status filter ("รออ่านผล" = "รออ่าน")
        if (filters.filmStatus === 'read' && !isFilmRead(p.confirm_read_film || p.film_status_text)) return false;
        if (filters.filmStatus === 'unread' && isFilmRead(p.confirm_read_film || p.film_status_text)) return false;

        // Search filter
        if (filters.search) {
            const s = filters.search;
            const fullStr = `${p.hn} ${p.vn || ''} ${p.pt_name} ${p.xray_name} ${p.doctor_name || ''} ${p.department_name || ''}`.toLowerCase();
            if (fullStr.indexOf(s) === -1) return false;
        }

        return true;
    });

    const totalRows = filtered.length;
    if (totalRows === 0) {
        tbody.innerHTML = '<tr><td colspan="17" class="px-4 py-8 text-center text-slate-400">ไม่พบข้อมูลผู้ป่วยตามเงื่อนไขที่ระบุ</td></tr>';
        safeSetText('patientPaginationInfo', 'แสดง 0 รายการ');
        const controls = document.getElementById('patientPaginationControls');
        if (controls) controls.innerHTML = '';
        return;
    }

    const totalPages = Math.ceil(totalRows / limit) || 1;
    const currPage = Math.min(page, totalPages);
    const startIdx = (currPage - 1) * limit;
    const pageRows = filtered.slice(startIdx, startIdx + limit);

    renderPatientRows(pageRows);
    renderPagination({ page: currPage, limit: limit, total_rows: totalRows, total_pages: totalPages });
}

function renderPatientRows(rows) {
    const tbody = document.getElementById('patientTableBody');
    if (!tbody) return;

    tbody.innerHTML = rows.map((p, idx) => {
        const ptTypeBadge = p.pt_type === 'IPD'
            ? '<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300">IPD</span>'
            : '<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300">OPD</span>';

        const filmInfo = getFilmBadgeInfo(p.confirm_read_film || p.film_status_text);
        const filmBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${filmInfo.badge}">${filmInfo.label}</span>`;

        const shiftCode = p.shift_code || 'morning';
        const shiftIcon = shiftCode === 'night' ? '🌙' : (shiftCode === 'morning' ? '☀️' : '🌇');
        const shiftBadge = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium ${getShiftBadgeClass(shiftCode)}">${shiftIcon} ${p.shift_short || p.shift_name || 'เวร'}</span>`;

        const confirmInfo = getConfirmBadge(p.confirm);
        const confirmBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${confirmInfo.badge}">${confirmInfo.label}</span>`;

        const waitInfo = getWaitBadge(p.wait_minutes);
        const waitBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${waitInfo.badge}">${waitInfo.text}</span>`;

        const isConfirmed = p.confirm === 'Y';
        const priceClass = isConfirmed ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 line-through';

        return `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/40 transition">
                <td class="px-3 py-2.5 text-center text-slate-400">${p.no || (idx + 1)}</td>
                <td class="px-3 py-2.5 whitespace-nowrap">
                    <div class="font-medium text-slate-800 dark:text-slate-200">${p.thai_request_date || formatThaiDate(p.request_date)}</div>
                    <div class="text-[10px] text-slate-400 flex items-center gap-1">
                        <i data-lucide="clock" class="w-3 h-3"></i> ${p.request_time || '-'} น.
                    </div>
                </td>
                <td class="px-3 py-2.5 whitespace-nowrap">
                    ${p.examined_date ? `
                        <div class="font-medium text-slate-800 dark:text-slate-200">${p.thai_examined_date || formatThaiDate(p.examined_date)}</div>
                        <div class="text-[10px] text-teal-600 dark:text-teal-400 flex items-center gap-1">
                            <i data-lucide="check" class="w-3 h-3"></i> ${p.examined_time || '-'} น.
                        </div>
                    ` : `
                        <span class="text-slate-400 text-xs italic">-</span>
                    `}
                </td>
                <td class="px-3 py-2.5 text-center whitespace-nowrap">${waitBadge}</td>
                <td class="px-3 py-2.5 text-center whitespace-nowrap">${confirmBadge}</td>
                <td class="px-3 py-2.5 text-center whitespace-nowrap">${shiftBadge}</td>
                <td class="px-3 py-2.5 font-mono font-bold text-slate-700 dark:text-slate-300">${p.hn || '-'}</td>
                <td class="px-3 py-2.5 font-semibold text-slate-900 dark:text-white whitespace-nowrap">${p.pt_name || '-'}</td>
                <td class="px-3 py-2.5 text-center text-slate-600 dark:text-slate-400 whitespace-nowrap">
                    ${p.age_y !== null && p.age_y !== undefined ? p.age_y + ' ปี' : '-'} / ${p.sex_label || (p.sex == '1' ? 'ชาย' : (p.sex == '2' ? 'หญิง' : '-'))}
                </td>
                <td class="px-3 py-2.5 text-center">${ptTypeBadge}</td>
                <td class="px-3 py-2.5 text-slate-600 dark:text-slate-400 whitespace-nowrap">${p.department_name || '-'}</td>
                <td class="px-3 py-2.5 font-medium text-cyan-700 dark:text-cyan-300 whitespace-nowrap" title="${p.xray_name}">${p.xray_name || '-'}</td>
                <td class="px-3 py-2.5 whitespace-nowrap">
                    <span class="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                        ${p.pttype_category || p.pttype_name || 'สิทธิทั่วไป'}
                    </span>
                </td>
                <td class="px-3 py-2.5 text-slate-600 dark:text-slate-400 whitespace-nowrap">${p.doctor_name || '-'}</td>
                <td class="px-3 py-2.5 text-right font-mono font-semibold whitespace-nowrap ${priceClass}">฿${Number(p.price || 0).toLocaleString()}</td>
                <td class="px-3 py-2.5 text-center whitespace-nowrap">${filmBadge}</td>
                <td class="px-3 py-2.5 text-center whitespace-nowrap">
                    <button onclick="openPatientDetailModal('${p.xn || p.no || idx}')" class="px-2.5 py-1 text-xs rounded-lg bg-cyan-50 dark:bg-cyan-950/50 hover:bg-cyan-100 dark:hover:bg-cyan-900 text-cyan-700 dark:text-cyan-300 font-medium transition shadow-xs">
                        ดูข้อมูล
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    if (window.lucide) lucide.createIcons();
}

function renderPagination(data) {
    const page = data.page || 1;
    const limit = data.limit || 25;
    const total = data.total_rows || 0;
    const totalPages = data.total_pages || Math.ceil(total / limit) || 1;

    const startIdx = ((page - 1) * limit) + 1;
    const endIdx = Math.min(page * limit, total);
    safeSetText('patientPaginationInfo', `แสดง ${startIdx.toLocaleString()} ถึง ${endIdx.toLocaleString()} จากทั้งหมด ${total.toLocaleString()} รายการ`);

    const container = document.getElementById('patientPaginationControls');
    if (!container) return;
    let btns = '';

    if (page > 1) {
        btns += `<button onclick="loadPatients(${page - 1})" class="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs">ก่อนหน้า</button>`;
    }

    let startP = Math.max(1, page - 2);
    let endP = Math.min(totalPages, startP + 4);
    if (endP - startP < 4) startP = Math.max(1, endP - 4);

    for (let i = startP; i <= endP; i++) {
        const active = i === page ? 'bg-cyan-600 text-white font-bold' : 'border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700';
        btns += `<button onclick="loadPatients(${i})" class="w-8 h-8 rounded-lg text-xs flex items-center justify-center ${active}">${i}</button>`;
    }

    if (page < totalPages) {
        btns += `<button onclick="loadPatients(${page + 1})" class="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs">ถัดไป</button>`;
    }

    container.innerHTML = btns;
}

// 19. Patient Detail Modal
function openPatientDetailModal(idKey) {
    let p = cachedPatientsList.find(item => String(item.xn) === String(idKey) || String(item.no) === String(idKey));
    if (!p && cachedPatientsList.length > 0) {
        p = cachedPatientsList[0];
    }
    if (!p) return;

    openModal('modalPatientDetail');

    safeSetText('modalPtName', p.pt_name || '-');
    safeSetText('modalPtHn', p.hn || '-');
    safeSetText('modalPtVn', p.vn || p.an || '-');
    safeSetText('modalPtAge', `${p.age_y || '-'} ปี / ${p.sex_label || (p.sex == '1' ? 'ชาย' : 'หญิง')}`);
    safeSetText('modalPttypeName', p.pttype_name || '-');
    safeSetText('modalPttypeCategory', p.pttype_category || '-');
    safeSetText('modalDepartment', p.department_name || '-');
    safeSetText('modalDoctorName', p.doctor_name || '-');
    safeSetText('modalDiagnosis', p.pdx_name || p.clinical_diagnosis || p.pdx || '-');
    safeSetText('modalXrayName', p.xray_name || '-');
    safeSetText('modalPrice', '฿' + Number(p.price || 0).toLocaleString());

    const reqDt = `${p.thai_request_date || formatThaiDate(p.request_date)} เวลา ${p.request_time || '-'} น.`;
    safeSetText('modalRequestDateTime', reqDt);

    const examDt = p.examined_date ? `${p.thai_examined_date || formatThaiDate(p.examined_date)} เวลา ${p.examined_time || '-'} น.` : 'ยังไม่ได้รับการตรวจ';
    safeSetText('modalExaminedDateTime', examDt);

    const elWait = document.getElementById('modalWaitTimeBadge');
    if (elWait) {
        const wb = getWaitBadge(p.wait_minutes);
        elWait.innerHTML = `<span class="px-2.5 py-1 rounded-full text-xs font-bold ${wb.badge}">${wb.text}</span>`;
    }

    const elConfirm = document.getElementById('modalConfirmBadge');
    if (elConfirm) {
        const cb = getConfirmBadge(p.confirm);
        elConfirm.innerHTML = `<span class="px-2.5 py-1 rounded-full text-xs font-semibold ${cb.badge}">${cb.label}</span>`;
    }

    const elShift = document.getElementById('modalShiftBadge');
    if (elShift) {
        const sc = p.shift_code || 'morning';
        elShift.innerHTML = `<span class="px-2.5 py-1 rounded-full text-xs font-medium ${getShiftBadgeClass(sc)}">${p.shift_name || p.shift_short || 'เวร'}</span>`;
    }

    const elPtType = document.getElementById('modalPtTypeBadge');
    if (elPtType) {
        elPtType.innerHTML = p.pt_type === 'IPD'
            ? '<span class="px-2 py-0.5 rounded text-xs font-bold bg-purple-100 text-purple-800">IPD (ผู้ป่วยใน)</span>'
            : '<span class="px-2 py-0.5 rounded text-xs font-bold bg-cyan-100 text-cyan-800">OPD (ผู้ป่วยนอก)</span>';
    }

    const elFilm = document.getElementById('modalFilmStatusBadge');
    if (elFilm) {
        const filmInfo = getFilmBadgeInfo(p.confirm_read_film || p.film_status_text);
        elFilm.innerHTML = `<span class="px-2.5 py-1 rounded-full text-xs font-semibold ${filmInfo.badge}">${filmInfo.label}</span>`;
    }

    safeSetText('modalReportDoctor', p.report_doctor_name || '-');
    safeSetText('modalReportText', p.report_text || 'ยังไม่มีการบันทึกผลการอ่านฟิล์ม');

    if (window.lucide) lucide.createIcons();
}

// 20. Client-Side Excel Export
function exportExcelClientSide() {
    const table = document.querySelector('.tab-content:not(.hidden) table') || document.querySelector('table');
    if (!table) {
        alert('ไม่พบตารางข้อมูลที่จะดาวน์โหลด');
        return;
    }

    const activeTab = document.querySelector('.tab-content:not(.hidden)');
    const tabName = activeTab ? activeTab.id.replace('tab', '') : 'Report';

    let html = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
        <head>
            <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
            <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>XRAY_${tabName}</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
        </head>
        <body>
            <h3>รายงานข้อมูลห้อง X-Ray (${tabName}) - ${appConfig.hospitalName}</h3>
            <p>วันที่: ${currentStartDate} ถึง ${currentEndDate}</p>
            ${table.outerHTML}
        </body>
        </html>
    `;

    const blob = new Blob(['\ufeff' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `XRay_${tabName}_${currentStartDate}_to_${currentEndDate}.xls`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// 21. Settings Modal
function loadStoredSettings() {
    const saved = localStorage.getItem('xray_dashboard_config');
    if (saved) {
        try {
            appConfig = Object.assign({}, DEFAULT_CONFIG, JSON.parse(saved));
        } catch (e) {
            console.warn('Error reading saved config:', e);
        }
    }

    const brandNameEl = document.getElementById('hospitalBrandName');
    if (brandNameEl && appConfig.hospitalName) {
        brandNameEl.textContent = appConfig.hospitalName;
    }
    const directSheetBtn = document.getElementById('btnOpenSheet');
    if (directSheetBtn && appConfig.spreadsheetId) {
        directSheetBtn.href = `https://docs.google.com/spreadsheets/d/${appConfig.spreadsheetId}/edit`;
    }
    const toolbarSheetBtn = document.getElementById('btnToolbarSheet');
    if (toolbarSheetBtn && appConfig.spreadsheetId) {
        toolbarSheetBtn.href = `https://docs.google.com/spreadsheets/d/${appConfig.spreadsheetId}/edit`;
    }
}

function openSettingsModal() {
    openModal('modalSettings');
    const inputUrl = document.getElementById('settingAppsScriptUrl');
    const inputSheetId = document.getElementById('settingSpreadsheetId');
    const inputSheetName = document.getElementById('settingSheetName');
    const selectMode = document.getElementById('settingDataMode');

    if (inputUrl) inputUrl.value = appConfig.webAppUrl || '';
    if (inputSheetId) inputSheetId.value = appConfig.spreadsheetId || '';
    if (inputSheetName) inputSheetName.value = appConfig.sheetName || 'XRAY_DATA';
    if (selectMode) selectMode.value = appConfig.dataMode || 'cloud';
}

function saveSettings(e) {
    e.preventDefault();
    const feedback = document.getElementById('settingsFeedback');
    if (feedback) {
        feedback.classList.remove('hidden', 'bg-rose-100', 'text-rose-800', 'bg-emerald-100', 'text-emerald-800');
        feedback.innerHTML = 'กำลังบันทึกการตั้งค่า...';
    }

    const inputUrl = document.getElementById('settingAppsScriptUrl');
    const inputSheetId = document.getElementById('settingSpreadsheetId');
    const inputSheetName = document.getElementById('settingSheetName');
    const selectMode = document.getElementById('settingDataMode');

    appConfig.webAppUrl = inputUrl ? inputUrl.value.trim() : appConfig.webAppUrl;
    appConfig.spreadsheetId = inputSheetId ? inputSheetId.value.trim() : appConfig.spreadsheetId;
    appConfig.sheetName = inputSheetName ? inputSheetName.value.trim() : appConfig.sheetName;
    appConfig.dataMode = selectMode ? selectMode.value : appConfig.dataMode;

    localStorage.setItem('xray_dashboard_config', JSON.stringify(appConfig));

    if (feedback) {
        feedback.classList.add('bg-emerald-100', 'text-emerald-800');
        feedback.textContent = 'บันทึกการตั้งค่าเรียบร้อยแล้ว';
    }

    loadStoredSettings();
    setTimeout(() => {
        closeModal('modalSettings');
        if (feedback) feedback.classList.add('hidden');
        loadDashboardData();
    }, 800);
}

// 22. Modal Helpers
function openModal(id) {
    const el = document.getElementById(id);
    if (el) {
        el.classList.remove('hidden');
        if (window.lucide) lucide.createIcons();
    }
}

function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
}

// 23. Demo / Offline Mock Generator (Fallback when offline)
function generateDemoData(action, params) {
    const isSingleDay = currentStartDate === currentEndDate;
    const mockProcedures = ['Chest (PA Upright)', 'Abdomen (KUB)', 'Skull (AP & Lat)', 'Pelvis (AP)', 'Spine L-S (AP & Lat)', 'Extremity (Hand/Foot)', 'Chest (Portable)', 'C-Spine'];
    const mockDepts = ['อายุรกรรม', 'ศัลยกรรม', 'อุบัติเหตุและฉุกเฉิน (ER)', 'กุมารเวชกรรม', 'สูติ-นรีเวชกรรม', 'หอผู้ป่วยใน (IPD)'];
    const mockDoctors = ['นพ.สมชาย ใจดี', 'พญ.นภา วรรณศิลป์', 'นพ.เกรียงไกร สิทธิโชค', 'พญ.กานดา สุขสว่าง'];

    if (action === 'daily') {
        const list = [];
        const d = new Date(currentStartDate);
        const endD = new Date(currentEndDate);
        while (d <= endD) {
            const dateStr = d.toISOString().split('T')[0];
            const orders = Math.floor(Math.random() * 25) + 12;
            const requests = orders + Math.floor(Math.random() * 4);
            const patients = Math.floor(orders * 0.85);
            const night = Math.floor(orders * 0.15);
            const morning = Math.floor(orders * 0.55);
            const afternoon = orders - night - morning;
            const opd = Math.floor(orders * 0.8);
            const ipd = orders - opd;
            const rev = orders * 300;
            const read = Math.floor(orders * 0.8);

            list.push({
                date: dateStr,
                total_orders: orders,
                total_requests: requests,
                unconfirmed_orders: requests - orders,
                total_patients: patients,
                night_orders: night,
                morning_orders: morning,
                afternoon_orders: afternoon,
                opd_orders: opd,
                ipd_orders: ipd,
                total_revenue: rev,
                read_films: read,
                unread_films: orders - read,
                avg_wait_minutes: +(14 + Math.random() * 15).toFixed(1)
            });
            d.setDate(d.getDate() + 1);
        }
        return { status: 'success', data: list };
    }

    if (action === 'monthly') {
        const monthNames = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
        const year = params.year || new Date().getFullYear();
        const thYear = parseInt(year, 10) + 543;
        const list = monthNames.map((m, i) => {
            const orders = Math.floor(Math.random() * 300) + 200;
            const opd = Math.floor(orders * 0.82);
            const ipd = orders - opd;
            const read = Math.floor(orders * 0.82);
            return {
                month_no: i + 1,
                month_name: `${m} ${thYear}`,
                total_orders: orders,
                total_patients: Math.floor(orders * 0.85),
                opd_orders: opd,
                ipd_orders: ipd,
                total_revenue: orders * 300,
                read_films: read,
                unread_films: orders - read
            };
        });
        return { status: 'success', year: year, data: list };
    }

    if (action === 'patients') {
        const total = 40;
        const page = params.page || 1;
        const limit = params.limit || 25;
        const patients = [];

        for (let i = 1; i <= total; i++) {
            const isConfirmed = i % 10 !== 0;
            const waitMins = Math.floor(Math.random() * 35) + 8;
            const shiftCodes = ['night', 'morning', 'afternoon'];
            const shiftCode = shiftCodes[i % 3];
            const shiftNames = { night: 'เวรดึก (00:00 - 08:00)', morning: 'เวรเช้า (08:00 - 16:00)', afternoon: 'เวรบ่าย (16:00 - 24:00)' };
            const reqTime = `${String((i * 2) % 24).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}`;
            const examHour = parseInt(reqTime.split(':')[0], 10);
            const examMin = (parseInt(reqTime.split(':')[1], 10) + waitMins) % 60;
            const examTime = `${String(examHour).padStart(2, '0')}:${String(examMin).padStart(2, '0')}`;

            patients.push({
                no: i,
                xn: 10000 + i,
                hn: '00' + (54000 + i),
                vn: '690' + (12000 + i),
                request_date: currentStartDate,
                thai_request_date: formatThaiDate(currentStartDate),
                request_time: reqTime,
                examined_date: isConfirmed ? currentStartDate : '',
                thai_examined_date: isConfirmed ? formatThaiDate(currentStartDate) : '',
                examined_time: isConfirmed ? examTime : '',
                wait_minutes: isConfirmed ? waitMins : null,
                confirm: isConfirmed ? 'Y' : 'N',
                shift_code: shiftCode,
                shift_name: shiftNames[shiftCode],
                shift_short: shiftCode === 'night' ? 'เวรดึก' : (shiftCode === 'morning' ? 'เวรเช้า' : 'เวรบ่าย'),
                pt_type: i % 4 === 0 ? 'IPD' : 'OPD',
                pt_name: `ผู้ป่วยตัวอย่างที่ ${i}`,
                sex: i % 2 === 0 ? '1' : '2',
                sex_label: i % 2 === 0 ? 'ชาย' : 'หญิง',
                age_y: 20 + (i % 60),
                pttype_name: 'บัตรทอง (UC)',
                pttype_category: 'บัตรทอง (UC)',
                department_name: mockDepts[i % mockDepts.length],
                xray_name: mockProcedures[i % mockProcedures.length],
                doctor_name: mockDoctors[i % mockDoctors.length],
                price: 250 + (i % 3) * 100,
                confirm_read_film: i % 3 === 0 ? 'N' : 'Y',
                clinical_diagnosis: 'ตรวจเช็กร่างกายตามนัด',
                report_doctor_name: 'นพ.รังสี เชี่ยวชาญ',
                report_text: i % 3 === 0 ? '' : 'No active pulmonary infiltration. Normal chest study.'
            });
        }

        const startIdx = (page - 1) * limit;
        return {
            status: 'success',
            total_rows: total,
            page: page,
            limit: limit,
            total_pages: Math.ceil(total / limit),
            data: patients.slice(startIdx, startIdx + limit)
        };
    }

    // Default Overview
    const totalOrders = 36;
    const totalRequests = 40;
    const unconfirmed = totalRequests - totalOrders;
    return {
        status: 'success',
        latest_date: currentStartDate,
        period: {
            start_date: currentStartDate,
            end_date: currentEndDate,
            thai_start_date: formatThaiDate(currentStartDate),
            thai_end_date: formatThaiDate(currentEndDate),
            is_single_day: isSingleDay
        },
        kpi: {
            total_orders: totalOrders,
            total_requests: totalRequests,
            unconfirmed_orders: unconfirmed,
            total_patients: 32,
            opd_patients: 26,
            ipd_patients: 6,
            opd_orders: 29,
            ipd_orders: 7,
            avg_wait_minutes: 18.5,
            wait_under_30_count: 31,
            wait_under_30_rate: 86.1,
            total_revenue: totalOrders * 320,
            read_films: 29,
            unread_films: 7,
            read_rate: 80.5
        },
        shift_breakdown: [
            { code: 'night', name: 'เวรดึก (00:00 - 08:00 น.)', short: 'เวรดึก', order_count: 5, patient_count: 5, revenue: 1600, percent: 13.9, color: '#8B5CF6' },
            { code: 'morning', name: 'เวรเช้า (08:00 - 16:00 น.)', short: 'เวรเช้า', order_count: 22, patient_count: 20, revenue: 7040, percent: 61.1, color: '#F59E0B' },
            { code: 'afternoon', name: 'เวรบ่าย (16:00 - 24:00 น.)', short: 'เวรบ่าย', order_count: 9, patient_count: 7, revenue: 2880, percent: 25.0, color: '#3B82F6' }
        ],
        daily_trend: [
            { date: currentStartDate, short_label: currentStartDate.slice(5), orders: totalOrders, requests: totalRequests, patients: 32 }
        ],
        top_items: [
            { name: 'Chest (PA Upright)', count: 18, percent: 50.0 },
            { name: 'Abdomen (KUB)', count: 8, percent: 22.2 },
            { name: 'Extremity (Hand/Foot)', count: 5, percent: 13.9 },
            { name: 'Skull AP & Lat', count: 3, percent: 8.3 },
            { name: 'Pelvis (AP)', count: 2, percent: 5.6 }
        ],
        department_distribution: [
            { name: 'อายุรกรรม', count: 15 },
            { name: 'ศัลยกรรม', count: 9 },
            { name: 'อุบัติเหตุและฉุกเฉิน (ER)', count: 8 },
            { name: 'กุมารเวชกรรม', count: 4 }
        ],
        insurance_distribution: [
            { name: 'บัตรทอง (UC)', count: 22, color: '#F59E0B' },
            { name: 'ข้าราชการ/เบิกตรง', count: 7, color: '#3B82F6' },
            { name: 'ประกันสังคม', count: 4, color: '#EC4899' },
            { name: 'ชำระเงินเอง', count: 3, color: '#10B981' }
        ],
        hourly_workload: Array.from({ length: 24 }, (_, h) => ({
            hour: h,
            label: `${h}:00`,
            count: (h >= 8 && h <= 16) ? Math.floor(Math.random() * 6) + 2 : (h >= 17 && h <= 23 ? Math.floor(Math.random() * 3) : Math.floor(Math.random() * 2))
        }))
    };
}
