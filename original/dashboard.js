// === Volunteer Forecast Dashboard v2 ===
let DATA = null;

// Palette
const C = {
    indigo:'#6366f1',cyan:'#06b6d4',emerald:'#10b981',amber:'#f59e0b',
    rose:'#f43f5e',violet:'#8b5cf6',sky:'#38bdf8',lime:'#84cc16',
    orange:'#fb923c',pink:'#ec4899',teal:'#14b8a6',fuchsia:'#d946ef',
    slate:'#64748b',blue:'#3b82f6',red:'#ef4444',
};
const AGE_COLORS = {'0-13':'#ec4899','14-17':'#f43f5e','18-24':'#6366f1','25-35':'#06b6d4','36-54':'#10b981','55-64':'#f59e0b','65+':'#8b5cf6'};
const PALETTE = [C.indigo,C.cyan,C.emerald,C.amber,C.rose,C.violet,C.sky,C.lime,C.orange,C.pink,C.teal,C.fuchsia,C.slate,C.blue,C.red];

// Chart.js config
Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = 'rgba(148,163,184,0.06)';
Chart.defaults.font.family = "'Inter',sans-serif";
Chart.defaults.font.size = 12;
Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(17,24,39,0.95)';
Chart.defaults.plugins.tooltip.padding = 12;
Chart.defaults.plugins.tooltip.cornerRadius = 8;
Chart.defaults.plugins.tooltip.borderColor = 'rgba(99,102,241,0.2)';
Chart.defaults.plugins.tooltip.borderWidth = 1;

const fmt = new Intl.NumberFormat('ru-RU');
const fmtK = n => n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(0)+'K':n.toString();

// Chart instances registry
const charts = {};
function destroyChart(id) { if(charts[id]){charts[id].destroy();delete charts[id];} }

// State
let selectedRegion = null;
let currentRegAgeMode = 'lines';

// === INIT ===
async function init() {
    try {
        if (typeof window.INJECTED_DATA !== 'undefined') {
            DATA = window.INJECTED_DATA;
        } else {
            const r = await fetch('forecast_data.json');
            DATA = await r.json();
        }
    } catch(e) { console.error('Load failed',e); return; }

    document.getElementById('headerDate').textContent = new Date().toLocaleDateString('ru-RU',{year:'numeric',month:'long',day:'numeric'});
    
    setupTabs();
    setupKPI();
    setupFilters();
    createParticles();
    
    // Tab 1
    renderMainChart();
    renderGrowthChart();
    renderActionsChart();
    renderNatAgeChart('lines');
    renderTopRegionsChart();
    renderTopActionsChart();
    renderRegistrationsChart();
    renderNationalTable();
    
    // Tab 2 - Methodology
    
    // Tab 3
    renderCIExplainer();
    
    setupChartControls();
}

// === FILTERS ENGINE ===
let activeFilters = { region: 'all', action: 'all', age: 'all' };

function setupFilters() {
    if (!DATA.raw_cube) return;
    const cube = DATA.raw_cube;

    // Populate Region dropdown
    const regSel = document.getElementById('filterRegion');
    cube.regions.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r; opt.textContent = r;
        regSel.appendChild(opt);
    });

    // Populate Action dropdown
    const actSel = document.getElementById('filterAction');
    cube.actions.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a;
        opt.textContent = a.replace(/^\d+\.\d+\.\s*/, '');
        actSel.appendChild(opt);
    });

    // Populate Age dropdown
    const ageSel = document.getElementById('filterAge');
    cube.ages.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g; opt.textContent = g;
        ageSel.appendChild(opt);
    });

    // Event listeners
    regSel.addEventListener('change', () => { activeFilters.region = regSel.value; applyFilters(); toggleFilterHighlight(regSel); });
    actSel.addEventListener('change', () => { activeFilters.action = actSel.value; applyFilters(); toggleFilterHighlight(actSel); });
    ageSel.addEventListener('change', () => { activeFilters.age = ageSel.value; applyFilters(); toggleFilterHighlight(ageSel); });

    document.getElementById('filterReset').addEventListener('click', () => {
        regSel.value = 'all'; actSel.value = 'all'; ageSel.value = 'all';
        activeFilters = { region: 'all', action: 'all', age: 'all' };
        [regSel, actSel, ageSel].forEach(s => s.classList.remove('filter-active'));
        applyFilters();
    });
}

function toggleFilterHighlight(sel) {
    sel.classList.toggle('filter-active', sel.value !== 'all');
}

// === CLIENT-SIDE POLYNOMIAL FORECAST ===
function polyFitJS(xs, ys, degree) {
    // Least-squares polynomial fit (Vandermonde method)
    const n = xs.length;
    const d = Math.min(degree, n - 1);
    // Build normal equations: (A^T A) c = A^T y
    const size = d + 1;
    const ATA = Array.from({length: size}, () => Array(size).fill(0));
    const ATy = Array(size).fill(0);
    for (let i = 0; i < n; i++) {
        const x = xs[i], y = ys[i];
        for (let j = 0; j < size; j++) {
            const xj = Math.pow(x, j);
            ATy[j] += xj * y;
            for (let k = 0; k < size; k++) {
                ATA[j][k] += xj * Math.pow(x, k);
            }
        }
    }
    // Solve via Gauss elimination
    const M = ATA.map((row, i) => [...row, ATy[i]]);
    for (let col = 0; col < size; col++) {
        let maxRow = col;
        for (let row = col + 1; row < size; row++) {
            if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
        }
        [M[col], M[maxRow]] = [M[maxRow], M[col]];
        if (Math.abs(M[col][col]) < 1e-12) continue;
        for (let row = col + 1; row < size; row++) {
            const f = M[row][col] / M[col][col];
            for (let j = col; j <= size; j++) M[row][j] -= f * M[col][j];
        }
    }
    const coeffs = Array(size).fill(0);
    for (let i = size - 1; i >= 0; i--) {
        coeffs[i] = M[i][size];
        for (let j = i + 1; j < size; j++) coeffs[i] -= M[i][j] * coeffs[j];
        coeffs[i] /= M[i][i];
    }
    return coeffs; // coeffs[0] + coeffs[1]*x + coeffs[2]*x^2 ...
}

function polyEval(coeffs, x) {
    let val = 0;
    for (let i = 0; i < coeffs.length; i++) val += coeffs[i] * Math.pow(x, i);
    return val;
}

function forecastFromYearly(yearlyData, forecastYears) {
    const xs = Object.keys(yearlyData).map(Number);
    const ys = xs.map(y => yearlyData[y]);
    if (xs.length < 2) return { values: forecastYears.map(() => 0), upper: forecastYears.map(() => 0), lower: forecastYears.map(() => 0) };
    
    const coeffs = polyFitJS(xs, ys, 2);
    
    // RMSE
    const fitted = xs.map(x => polyEval(coeffs, x));
    const residuals = ys.map((y, i) => y - fitted[i]);
    const rmse = Math.sqrt(residuals.reduce((s, r) => s + r*r, 0) / residuals.length);
    const lastYear = Math.max(...xs);
    
    const values = [], upper = [], lower = [];
    for (const y of forecastYears) {
        const val = Math.max(0, polyEval(coeffs, y));
        const ahead = Math.max(0, y - lastYear);
        const margin = rmse * (1 + 0.3 * ahead) * 1.96 + val * 0.04 * ahead;
        values.push(Math.round(val));
        upper.push(Math.round(val + margin));
        lower.push(Math.round(Math.max(0, val - margin)));
    }
    return { values, upper, lower };
}

function filterCube() {
    const cube = DATA.raw_cube;
    const rows = cube.rows;
    let regionSet = null, actionSet = null, ageSet = null;
    if (activeFilters.region !== 'all') {
        const ri = cube.regions.indexOf(activeFilters.region);
        regionSet = new Set([ri]);
    }
    if (activeFilters.action !== 'all') {
        const ai = cube.actions.indexOf(activeFilters.action);
        actionSet = new Set([ai]);
    }
    if (activeFilters.age !== 'all') {
        const gi = cube.ages.indexOf(activeFilters.age);
        ageSet = new Set([gi]);
    }
    const filtered = [];
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (regionSet && !regionSet.has(r[1])) continue;
        if (actionSet && !actionSet.has(r[2])) continue;
        if (ageSet && !ageSet.has(r[3])) continue;
        filtered.push(r);
    }
    return filtered;
}

function aggregateByYear(filteredRows) {
    const cube = DATA.raw_cube;
    const byYear = {};
    cube.years.forEach(y => { byYear[y] = { active: 0, actions: 0 }; });
    for (const r of filteredRows) {
        const year = cube.years[r[0]];
        byYear[year].active += r[4];
        byYear[year].actions += r[5];
    }
    return byYear;
}

function aggregateByRegion(filteredRows) {
    const cube = DATA.raw_cube;
    const byRegion = {};
    cube.regions.forEach(r => { byRegion[r] = { active: 0, actions: 0 }; });
    for (const r of filteredRows) {
        const reg = cube.regions[r[1]];
        byRegion[reg].active += r[4];
        byRegion[reg].actions += r[5];
    }
    return byRegion;
}

function aggregateByAction(filteredRows) {
    const cube = DATA.raw_cube;
    const byAction = {};
    cube.actions.forEach(a => { byAction[a] = { active: 0, actions: 0 }; });
    for (const r of filteredRows) {
        const act = cube.actions[r[2]];
        byAction[act].active += r[4];
        byAction[act].actions += r[5];
    }
    return byAction;
}

function applyFilters() {
    const isDefault = activeFilters.region === 'all' && activeFilters.action === 'all' && activeFilters.age === 'all';
    
    if (isDefault) {
        setupKPI();
        renderMainChart();
        renderGrowthChart();
        renderActionsChart();
        renderTopRegionsChart();
        renderTopActionsChart();
        renderNationalTable();
        return;
    }

    const filtered = filterCube();
    const byYear = aggregateByYear(filtered);
    const byRegion = aggregateByRegion(filtered);
    const byAction = aggregateByAction(filtered);
    const cube = DATA.raw_cube;
    const years = cube.years;
    const lastYear = years[years.length - 1];
    const totalActive = byYear[lastYear]?.active || 0;
    const totalActions = byYear[lastYear]?.actions || 0;
    const activeRegions = Object.values(byRegion).filter(r => r.active > 0).length;

    // Build forecast from filtered data
    const activeByYear = {};
    years.forEach(y => { activeByYear[y] = byYear[y].active; });
    const forecastYears = DATA.forecast_years;
    const fc = forecastFromYearly(activeByYear, forecastYears);
    const forecast2030 = fc.values[fc.values.length - 1];

    // Update KPI
    document.getElementById('kpiVol').textContent = fmt.format(totalActive);
    document.getElementById('kpiForecast').textContent = fmt.format(forecast2030);
    document.getElementById('kpiActions').textContent = fmt.format(totalActions);
    document.getElementById('kpiReg').textContent = activeRegions;
    document.getElementById('kpiGrowth').textContent = `${lastYear} г.`;
    document.getElementById('kpiActTypes').textContent = 'Полином. прогноз';

    // Main chart with forecast
    renderFilteredMainChart(byYear, years, fc, forecastYears);

    const activeVals = years.map(y => byYear[y].active);
    renderFilteredGrowthChart(years, activeVals);

    // Actions chart with forecast
    const actionsByYear = {};
    years.forEach(y => { actionsByYear[y] = byYear[y].actions; });
    const actFc = forecastFromYearly(actionsByYear, forecastYears);
    renderFilteredActionsChart(years, actionsByYear, actFc, forecastYears);

    const regionRanking = Object.entries(byRegion).sort((a,b) => b[1].active - a[1].active).slice(0, 15);
    renderFilteredTopRegions(regionRanking);

    const actionRanking = Object.entries(byAction).sort((a,b) => b[1].active - a[1].active).slice(0, 10);
    renderFilteredTopActions(actionRanking);

    // Use pre-computed regional data for table when a specific region is selected
    if (activeFilters.region !== 'all' && DATA.regions[activeFilters.region]) {
        renderRegionTable(activeFilters.region);
    } else {
        renderFilteredTable(byYear, years, fc, forecastYears);
    }
}

function renderFilteredMainChart(byYear, years, fc, forecastYears) {
    destroyChart('main');
    const ctx = document.getElementById('mainChart');
    if (!ctx) return;

    const fullLabels = [...new Set([...years, ...forecastYears])].sort((a,b)=>a-b);
    const actualData = fullLabels.map(y => years.includes(y) ? byYear[y]?.active || 0 : null);
    
    const projData = fullLabels.map(y => { const i = forecastYears.indexOf(y); return i !== -1 ? fc.values[i] : null; });
    const upperData = fullLabels.map(y => { const i = forecastYears.indexOf(y); return i !== -1 ? fc.upper[i] : null; });
    const lowerData = fullLabels.map(y => { const i = forecastYears.indexOf(y); return i !== -1 ? fc.lower[i] : null; });
    // Only show forecast AFTER last actual year (bridge at lastActual)
    const lastActual = Math.max(...years);
    for (let j = 0; j < fullLabels.length; j++) {
        if (fullLabels[j] < lastActual) { projData[j] = null; upperData[j] = null; lowerData[j] = null; }
    }
    const bi = fullLabels.indexOf(lastActual);
    if (bi !== -1 && actualData[bi] !== null) { projData[bi] = actualData[bi]; upperData[bi] = actualData[bi]; lowerData[bi] = actualData[bi]; }

    const datasets = [
        { label: 'CI верх', data: upperData, borderColor: 'transparent', backgroundColor: 'rgba(99,102,241,0.1)', fill: '+1', pointRadius: 0, tension: 0.3 },
        { label: 'CI низ', data: lowerData, borderColor: 'transparent', backgroundColor: 'transparent', fill: false, pointRadius: 0, tension: 0.3 },
        { label: 'Факт', data: actualData, borderColor: C.indigo, backgroundColor: C.indigo, borderWidth: 3, pointBackgroundColor: 'white', pointBorderColor: C.indigo, pointBorderWidth: 2, pointRadius: 4, tension: 0.3 },
        { label: 'Прогноз', data: projData, borderColor: C.indigo, borderWidth: 3, borderDash: [6,4], pointBackgroundColor: 'white', pointBorderColor: C.indigo, pointBorderWidth: 2, pointRadius: 4, tension: 0.3 }
    ];

    charts.main = new Chart(ctx, {
        type: 'line', data: { labels: fullLabels, datasets },
        options: { responsive:true, maintainAspectRatio:false,
            interaction:{mode:'index',intersect:false},
            plugins:{ legend:{display:true,position:'top',align:'end',labels:{usePointStyle:true,boxWidth:8,font:{size:11},filter:i=>!i.text.includes('CI')}}, tooltip:{callbacks:{label:tooltipCB},filter:tooltipFilter} },
            scales: standardScales(true)
        }
    });
}

function renderFilteredGrowthChart(years, vals) {
    destroyChart('growth');
    const ctx = document.getElementById('growthChart');
    if (!ctx) return;
    const growthRates = [];
    for (let i = 1; i < vals.length; i++) {
        growthRates.push(vals[i-1] > 0 ? Math.round((vals[i]-vals[i-1])/vals[i-1]*1000)/10 : 0);
    }
    const labels = years.slice(1);
    charts.growth = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{
            label: 'Рост, %',
            data: growthRates,
            backgroundColor: growthRates.map(v => v >= 0 ? C.emerald : C.rose),
            borderRadius: 6, barPercentage: 0.6
        }]},
        options: { responsive:true, maintainAspectRatio:false,
            plugins:{ legend:{display:false} },
            scales: standardScales(false)
        }
    });
}

function renderFilteredActionsChart(years, actionsByYear, fc, forecastYears) {
    destroyChart('actions');
    const ctx = document.getElementById('actionsChart');
    if (!ctx) return;

    const fullLabels = [...new Set([...years, ...forecastYears])].sort((a,b)=>a-b);
    const actualData = fullLabels.map(y => years.includes(y) ? (actionsByYear[y] || 0) : null);
    const projData = fullLabels.map(y => { const i = forecastYears.indexOf(y); return i !== -1 ? fc.values[i] : null; });
    // Only show forecast AFTER last actual year (bridge at lastActual)
    const lastActual = Math.max(...years);
    for (let j = 0; j < fullLabels.length; j++) {
        if (fullLabels[j] < lastActual) projData[j] = null;
    }
    const bi = fullLabels.indexOf(lastActual);
    if (bi !== -1 && actualData[bi] !== null) projData[bi] = actualData[bi];

    charts.actions = new Chart(ctx, {
        type: 'line',
        data: { labels: fullLabels, datasets: [
            { label: 'Факт', data: actualData, borderColor: C.emerald, backgroundColor: C.emerald, borderWidth: 3, pointBackgroundColor: 'white', pointBorderColor: C.emerald, pointBorderWidth: 2, pointRadius: 4, tension: 0.3 },
            { label: 'Прогноз', data: projData, borderColor: C.emerald, borderWidth: 3, borderDash: [6,4], pointBackgroundColor: 'white', pointBorderColor: C.emerald, pointBorderWidth: 2, pointRadius: 4, tension: 0.3 }
        ]},
        options: { responsive:true, maintainAspectRatio:false,
            interaction:{mode:'index',intersect:false},
            plugins:{ legend:{display:true,position:'top',align:'end',labels:{usePointStyle:true,boxWidth:8,font:{size:11}}} },
            scales: standardScales(true)
        }
    });
}

function renderFilteredTopRegions(ranking) {
    destroyChart('topRegions');
    const ctx = document.getElementById('topRegionsChart');
    if (!ctx) return;
    const labels = ranking.map(r => r[0].length > 25 ? r[0].substring(0,25)+'...' : r[0]);
    const vals = ranking.map(r => r[1].active);
    charts.topRegions = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{
            data: vals,
            backgroundColor: PALETTE.slice(0, labels.length).map(c => c + '44'),
            borderColor: PALETTE.slice(0, labels.length),
            borderWidth: 1.5, borderRadius: 6, barPercentage: 0.7
        }]},
        options: { indexAxis:'y', responsive:true, maintainAspectRatio:false,
            plugins:{ legend:{display:false} },
            scales:{ x:{beginAtZero:true, grid:{color:'rgba(15,23,42,0.05)'},
                ticks:{callback:v=>fmtK(v),font:{family:"'Fira Code',monospace",size:11}}},
                y:{grid:{display:false},ticks:{font:{size:11}}} }
        }
    });
}

function renderFilteredTopActions(ranking) {
    destroyChart('topActions');
    const ctx = document.getElementById('topActionsChart');
    if (!ctx) return;
    const labels = ranking.map(r => r[0].replace(/^\d+\.\d+\.\s*/, ''));
    const vals = ranking.map(r => r[1].active);
    charts.topActions = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{
            data: vals,
            backgroundColor: PALETTE.slice(0, labels.length).map(c => c + '44'),
            borderColor: PALETTE.slice(0, labels.length),
            borderWidth: 1.5, borderRadius: 6, barPercentage: 0.7
        }]},
        options: { indexAxis:'y', responsive:true, maintainAspectRatio:false,
            plugins:{ legend:{display:false} },
            scales:{ x:{beginAtZero:true, grid:{color:'rgba(15,23,42,0.05)'},
                ticks:{callback:v=>fmtK(v),font:{family:"'Fira Code',monospace",size:11}}},
                y:{grid:{display:false},ticks:{font:{size:10}}} }
        }
    });
}

function renderFilteredTable(byYear, years, fc, forecastYears) {
    const tbody = document.getElementById('nationalTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    let prevVal = null;
    // Actual years
    for (const y of years) {
        const val = byYear[y].active;
        const acts = byYear[y].actions;
        const delta = prevVal && prevVal > 0 ? ((val - prevVal) / prevVal * 100).toFixed(1) + '%' : '—';
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${y}</td><td><span class="badge-actual">Факт</span></td><td>${fmt.format(val)}</td><td>—</td><td>${delta}</td><td>—</td><td>—</td><td>${fmt.format(acts)}</td>`;
        tbody.appendChild(tr);
        prevVal = val;
    }
    // Forecast years (only future)
    const futureYears = forecastYears.filter(y => y > Math.max(...years));
    for (const y of futureYears) {
        const i = forecastYears.indexOf(y);
        const val = fc.values[i];
        const ci = `${fmt.format(fc.lower[i])} — ${fmt.format(fc.upper[i])}`;
        const delta = prevVal && prevVal > 0 ? ((val - prevVal) / prevVal * 100).toFixed(1) + '%' : '—';
        const tr = document.createElement('tr');
        tr.classList.add('row-forecast');
        tr.innerHTML = `<td>${y}</td><td><span class="badge-forecast">Прогноз</span></td><td>${fmt.format(val)}</td><td>${ci}</td><td>${delta}</td><td>—</td><td>—</td><td>—</td>`;
        tbody.appendChild(tr);
        prevVal = val;
    }
}

function renderRegionTable(regionName) {
    const tbody = document.getElementById('nationalTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const reg = DATA.regions[regionName];
    if (!reg) return;

    const years = DATA.forecast_years;
    const actualYears = DATA.actual_years;

    let prevVal = null;
    years.forEach((y, i) => {
        const isAct = actualYears.includes(y);
        const actIdx = actualYears.indexOf(y);
        const val = isAct ? reg.actual_active[actIdx] : reg.active_poly.values[i];
        const actionsVal = isAct ? reg.actual_actions[actIdx] : reg.actions_poly.values[i];
        const yoyPct = prevVal && prevVal > 0 ? ((val - prevVal) / prevVal * 100).toFixed(1) : '—';
        const yoyStr = yoyPct !== '—' ? (parseFloat(yoyPct) >= 0 ? '+' + yoyPct + '%' : yoyPct + '%') : '—';
        const pen = reg.penetration_rate ? (reg.penetration_rate.values[i] * 100).toFixed(2) + '%' : '—';
        const pop = reg.population ? fmt.format(reg.population[i]) + ' тыс.' : '—';
        const tr = document.createElement('tr');
        tr.className = isAct ? '' : 'row-forecast';
        tr.innerHTML = `
            <td>${y}</td>
            <td>${isAct ? '<span class="badge-actual">Факт</span>' : '<span class="badge-forecast">Прогноз</span>'}</td>
            <td>${fmt.format(val)}</td>
            <td>${isAct ? '—' : fmt.format(reg.active_poly.lower[i]) + ' – ' + fmt.format(reg.active_poly.upper[i])}</td>
            <td style="color:${parseFloat(yoyPct) >= 0 ? '#10b981' : '#f43f5e'}">${yoyStr}</td>
            <td style="color:#818cf8;font-weight:600">${pen}</td>
            <td>${pop}</td>
            <td>${fmt.format(actionsVal)}</td>
        `;
        tbody.appendChild(tr);
        prevVal = val;
    });
}

// === TABS ===
function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
            // Resize needed after showing hidden tab
            setTimeout(() => {
                Object.values(charts).forEach(c => c.resize && c.resize());
            }, 50);
        });
    });
}

// === KPI ===
function setupKPI() {
    const s = DATA.summary;
    animateNumber('kpiVol', s.total_volunteers_2025);
    animateNumber('kpiForecast', s.forecast_2030);
    animateNumber('kpiActions', s.total_actions_2025);
    animateNumber('kpiReg', s.num_regions);
    document.getElementById('kpiGrowth').textContent = `${s.penetration_2025_pct}% населения`;
    document.getElementById('kpiActTypes').textContent = `Прогноз: ${s.penetration_2030_pct}% к 2030`;
}

function animateNumber(id, target) {
    const el = document.getElementById(id);
    const dur = 2000;
    const start = performance.now();
    const anim = now => {
        const p = Math.min((now-start)/dur, 1);
        const e = 1 - Math.pow(1-p, 3);
        el.textContent = fmt.format(Math.round(target * e));
        if(p<1) requestAnimationFrame(anim);
    };
    requestAnimationFrame(anim);
}

// === PARTICLES ===
function createParticles() {
    const el = document.getElementById('bgParticles');
    const cols = [C.indigo,C.cyan,C.emerald,C.violet];
    for(let i=0;i<25;i++){
        const p=document.createElement('div'); p.className='particle';
        const sz = Math.random()*5+2;
        p.style.cssText=`width:${sz}px;height:${sz}px;background:${cols[i%4]};left:${Math.random()*100}%;animation-duration:${Math.random()*20+15}s;animation-delay:${Math.random()*10}s;`;
        el.appendChild(p);
    }
}

// === HELPERS ===
function makeCIDatasets(label, forecast, color, showPoints, years, actualYears, actualValues) {
    const ds = [];
    const lastActual = actualYears[actualYears.length - 1];
    const lastActualIdx = years.indexOf(lastActual);
    const actualVal = actualValues ? actualValues[actualValues.length - 1] : null;

    // For CI bands: only show from lastActual onward
    const upperData = forecast.upper.map((v, i) => years[i] >= lastActual ? v : null);
    const lowerData = forecast.lower.map((v, i) => years[i] >= lastActual ? v : null);
    // Override bridging year with actual value for CI too
    if (actualVal !== null && lastActualIdx >= 0) {
        upperData[lastActualIdx] = actualVal;
        lowerData[lastActualIdx] = actualVal;
    }

    // Upper band
    ds.push({
        label: label + ' верх. граница',
        data: upperData,
        borderColor: 'transparent',
        backgroundColor: color + '15',
        fill: '+1',
        pointRadius: 0,
        order: 10,
    });
    // Lower band
    ds.push({
        label: label + ' ниж. граница',
        data: lowerData,
        borderColor: 'transparent',
        backgroundColor: color + '15',
        fill: false,
        pointRadius: 0,
        order: 10,
    });
    // Main forecast line: starts at last actual year with actual value
    const lineData = forecast.values.map((v, i) => years[i] >= lastActual ? v : null);
    if (actualVal !== null && lastActualIdx >= 0) {
        lineData[lastActualIdx] = actualVal; // Bridge: use actual value at junction
    }
    ds.push({
        label: label,
        data: lineData,
        borderColor: color,
        borderWidth: 2.5,
        borderDash: [8, 4],
        pointRadius: showPoints ? years.map(y => y > lastActual ? 4 : 0) : 0,
        pointBackgroundColor: color,
        pointBorderColor: '#0a0e1a',
        pointBorderWidth: 2,
        tension: 0.3,
        order: 2,
    });
    return ds;
}

function makeActualDataset(label, values, color, years, actualYears) {
    return {
        label: label,
        data: years.map(y => {
            const idx = actualYears.indexOf(y);
            return idx >= 0 ? values[idx] : null;
        }),
        borderColor: color,
        backgroundColor: color,
        borderWidth: 3,
        pointRadius: 5,
        pointHoverRadius: 8,
        pointBackgroundColor: color,
        pointBorderColor: '#0a0e1a',
        pointBorderWidth: 2,
        tension: 0.3,
        order: 1,
        spanGaps: false,
    };
}

function makeDividerAnnotation(year) {
    return {
        annotations: {
            divider: {
                type: 'line', xMin: year, xMax: year,
                borderColor: 'rgba(148,163,184,0.25)', borderWidth: 2, borderDash: [6, 4],
                label: {
                    display: true, content: '← Факт | Прогноз →', position: 'start',
                    backgroundColor: 'rgba(17,24,39,0.9)', color: '#94a3b8',
                    font: {size:10,weight:'500'}, padding:{x:6,y:3}, borderRadius:5,
                }
            }
        }
    };
}

function standardScales(showGrid) {
    return {
        x: {grid:{display:false},ticks:{font:{weight:'600'}}},
        y: {
            grid:{color:showGrid?'rgba(148,163,184,0.06)':'transparent'},
            ticks:{callback:v=>fmtK(v),font:{size:11}},
            beginAtZero:true,
        }
    };
}

function tooltipFilter(item) { return item.raw !== null; }
function tooltipCB(ctx) {
    if (ctx.dataset.label?.includes('граница')) return null;
    return `${ctx.dataset.label}: ${fmt.format(Math.round(ctx.raw))}`;
}

// ================================================================
// TAB 1: OVERVIEW CHARTS
// ================================================================

// --- MAIN CHART ---
function renderMainChart() {
    destroyChart('main');
    const ctx = document.getElementById('mainChart').getContext('2d');
    const n = DATA.national;
    const years = DATA.forecast_years;
    const actualYears = DATA.actual_years;
    const datasets = [];

    // Actual
    datasets.push(makeActualDataset('Факт', n.actual_active, C.indigo, years, actualYears));

    // Poly + CI
    datasets.push(...makeCIDatasets('Прогноз', n.active_poly, C.amber, true, years, actualYears, n.actual_active));

    charts.main = new Chart(ctx, {
        type: 'line', data: {labels: years, datasets},
        options: {
            responsive:true, maintainAspectRatio:false,
            interaction:{mode:'index',intersect:false},
            plugins:{
                legend:{display:true,position:'bottom',labels:{usePointStyle:true,pointStyle:'circle',boxWidth:8,padding:16,font:{size:11},filter:i=>!i.text.includes('граница')}},
                tooltip:{callbacks:{label:tooltipCB},filter:tooltipFilter},
                annotation: makeDividerAnnotation(actualYears[actualYears.length-1]),
            },
            scales: standardScales(true),
        }
    });
}

// --- GROWTH ---
function renderGrowthChart() {
    destroyChart('growth');
    const ctx = document.getElementById('growthChart').getContext('2d');
    const g = DATA.national.growth_rates_pct;
    const yrs = DATA.actual_years.slice(1);
    charts.growth = new Chart(ctx, {
        type:'bar', data:{
            labels:yrs,
            datasets:[{data:g.map(v=>v||0),backgroundColor:g.map(v=>v>50?C.emerald+'B3':v>20?C.cyan+'B3':C.amber+'B3'),borderRadius:8,borderSkipped:false,barThickness:36}]
        },
        options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`Рост: ${c.raw.toFixed(1)}%`}}},scales:{x:{grid:{display:false},ticks:{font:{weight:'600'}}},y:{grid:{color:'rgba(148,163,184,0.06)'},ticks:{callback:v=>v+'%'},beginAtZero:true}}}
    });
}

// --- ACTIONS ---
function renderActionsChart() {
    destroyChart('actions');
    const ctx = document.getElementById('actionsChart').getContext('2d');
    const n = DATA.national;
    const years = DATA.forecast_years;
    const actualYears = DATA.actual_years;
    const datasets = [
        makeActualDataset('Факт', n.actual_actions, C.emerald, years, actualYears),
        ...makeCIDatasets('Прогноз', n.actions_poly, C.amber, true, years, actualYears, n.actual_actions),
    ];
    charts.actions = new Chart(ctx, {
        type:'line',data:{labels:years,datasets},
        options:{
            responsive:true,maintainAspectRatio:false,
            interaction:{mode:'index',intersect:false},
            plugins:{
                legend:{display:true,position:'top',align:'end',labels:{usePointStyle:true,pointStyle:'circle',boxWidth:8,padding:14,font:{size:11},filter:i=>!i.text.includes('граница')}},
                tooltip:{callbacks:{label:tooltipCB},filter:tooltipFilter},
            },
            scales:standardScales(true),
        }
    });
}

// === REGISTRATIONS CHART ===
function renderRegistrationsChart() {
    destroyChart('registrationsChart');
    if (!DATA.registrations) return;
    const ctx = document.getElementById('registrationsChart');
    if (!ctx) return;

    const histYears = DATA.registrations.historical_years;
    const histVals = DATA.registrations.historical_values;
    const fcYears = DATA.forecast_years;
    const fullLabels = [...new Set([...histYears, ...fcYears])].sort((a,b)=>a-b);
    
    const actualData = fullLabels.map(y => {
        const idx = histYears.indexOf(y);
        return idx !== -1 ? histVals[idx] : null;
    });

    const fcVals = DATA.registrations.forecast.values;
    const fcUpper = DATA.registrations.forecast.upper;
    const fcLower = DATA.registrations.forecast.lower;

    const projData = fullLabels.map(y => {
        const idx = fcYears.indexOf(y);
        return idx !== -1 ? fcVals[idx] : null;
    });

    const upperData = fullLabels.map(y => { const idx = fcYears.indexOf(y); return idx !== -1 ? fcUpper[idx] : null; });
    const lowerData = fullLabels.map(y => { const idx = fcYears.indexOf(y); return idx !== -1 ? fcLower[idx] : null; });

    // Only show forecast AFTER last actual year
    const lastHistYear = Math.max(...histYears);
    for (let j = 0; j < fullLabels.length; j++) {
        if (fullLabels[j] < lastHistYear) { projData[j] = null; upperData[j] = null; lowerData[j] = null; }
    }
    // Bridge at last actual year
    const bridgeIdx = fullLabels.indexOf(lastHistYear);
    if (bridgeIdx !== -1 && actualData[bridgeIdx] !== null) {
        projData[bridgeIdx] = actualData[bridgeIdx];
        upperData[bridgeIdx] = actualData[bridgeIdx];
        lowerData[bridgeIdx] = actualData[bridgeIdx];
    }

    const datasets = [
        {
            label: 'Верхняя граница CI (95%)',
            data: upperData,
            borderColor: 'transparent',
            backgroundColor: 'rgba(217, 70, 239, 0.1)', // fuchsia
            fill: '+1',
            pointRadius: 0,
            tension: 0.3
        },
        {
            label: 'Нижняя граница CI (95%)',
            data: lowerData,
            borderColor: 'transparent',
            backgroundColor: 'transparent',
            fill: false,
            pointRadius: 0,
            tension: 0.3
        },
        {
            label: 'Факт',
            data: actualData,
            borderColor: C.fuchsia,
            backgroundColor: C.fuchsia,
            borderWidth: 3,
            pointBackgroundColor: 'white',
            pointBorderColor: C.fuchsia,
            pointBorderWidth: 2,
            pointRadius: 4,
            tension: 0.3,
            zIndex: 2
        },
        {
            label: 'Прогноз',
            data: projData,
            borderColor: C.fuchsia,
            borderWidth: 3,
            borderDash: [6, 4],
            pointBackgroundColor: 'white',
            pointBorderColor: C.fuchsia,
            pointBorderWidth: 2,
            pointRadius: 4,
            tension: 0.3,
            zIndex: 2
        }
    ];

    charts.registrationsChart = new Chart(ctx, {
        type: 'line',
        data: { labels: fullLabels, datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: true, position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 8, font: { size: 11 }, filter: i => !i.text.includes('граница') } },
                tooltip: { callbacks: { label: tooltipCB }, filter: tooltipFilter },
            },
            scales: standardScales(true)
        }
    });
}

// --- NATIONAL AGE ---
function renderNatAgeChart(mode) {
    destroyChart('natAge');
    const ctx = document.getElementById('natAgeChart').getContext('2d');
    const ageData = DATA.national.by_age;
    const years = DATA.forecast_years;
    const ags = DATA.age_groups;
    const datasets = [];

    // Track which dataset indices belong to each age group for legend sync
    const ageGroupIndices = {}; // ag -> [idx, idx, idx]

    ags.forEach(ag => {
        const color = AGE_COLORS[ag] || C.slate;
        const fc = ageData[ag];
        if (mode === 'lines') {
            const startIdx = datasets.length;
            // CI band upper
            datasets.push({
                label: ag + ' CI', data: fc.upper, _ageGroup: ag,
                borderColor:'transparent',backgroundColor:color+'10',fill:'+1',pointRadius:0,order:10,
            });
            // CI band lower
            datasets.push({
                label: ag + ' CI', data: fc.lower, _ageGroup: ag,
                borderColor:'transparent',backgroundColor:color+'10',fill:false,pointRadius:0,order:10,
            });
            // Line
            datasets.push({
                label:ag, data:fc.values, _ageGroup: ag,
                borderColor:color,backgroundColor:'transparent',
                borderWidth:2.5, pointRadius:3, pointHoverRadius:6,
                pointBackgroundColor:color, tension:0.3, order:1,
            });
            ageGroupIndices[ag] = [startIdx, startIdx+1, startIdx+2];
        } else {
            const startIdx = datasets.length;
            datasets.push({
                label:ag, data:fc.values, _ageGroup: ag,
                borderColor:color, backgroundColor:color+'90',
                borderWidth:1, pointRadius:0, tension:0.3, fill:true,
            });
            ageGroupIndices[ag] = [startIdx];
        }
    });

    charts.natAge = new Chart(ctx, {
        type:'line',data:{labels:years,datasets},
        options:{
            responsive:true,maintainAspectRatio:false,
            interaction:{mode:'index',intersect:false},
            plugins:{
                legend:{
                    position:'top',
                    labels:{usePointStyle:true,pointStyle:'circle',boxWidth:8,padding:14,font:{size:11},filter:i=>!i.text.includes('CI')},
                    onClick: (evt, item, legend) => ageLegendClick(legend.chart, item, ageGroupIndices),
                },
                tooltip:{callbacks:{label:tooltipCB},filter:i=>i.raw!==null&&!i.dataset.label?.includes('CI')},
            },
            scales:{x:{grid:{display:false},ticks:{font:{weight:'600'}}},y:{stacked:mode==='stacked',grid:{color:'rgba(148,163,184,0.06)'},ticks:{callback:v=>fmtK(v)},beginAtZero:true}},
        }
    });
}

// --- TOP REGIONS ---
function renderTopRegionsChart() {
    destroyChart('topReg');
    const ctx = document.getElementById('topRegionsChart').getContext('2d');
    const names = DATA.top_region_names;
    const regions = DATA.regions;
    const idx2030 = DATA.forecast_years.indexOf(2030);

    const items = names.map((n,i) => ({
        name: n.replace(' область','').replace(' край','').replace('Республика ','Респ. '),
        fullName: n,
        val: regions[n].active_poly.values[idx2030],
    })).sort((a,b) => b.val - a.val);

    charts.topReg = new Chart(ctx, {
        type:'bar',
        data:{
            labels:items.map(i=>i.name),
            datasets:[{
                label:'Прогноз 2030', data:items.map(i=>i.val),
                backgroundColor:items.map((_,i)=>PALETTE[i%PALETTE.length]+'BB'),
                borderColor:items.map((_,i)=>PALETTE[i%PALETTE.length]),
                borderWidth:1,borderRadius:6,borderSkipped:false,
            }],
        },
        options:{
            responsive:true,maintainAspectRatio:false,indexAxis:'y',
            plugins:{
                legend:{display:false},
                tooltip:{callbacks:{
                    title:t=>items[t[0].dataIndex].fullName,
                    label:c=>`Прогноз: ${fmt.format(items[c.dataIndex].val)}`,
                }},
            },
            scales:{x:{grid:{color:'rgba(148,163,184,0.06)'},ticks:{callback:v=>fmtK(v)}},y:{grid:{display:false},ticks:{font:{size:10,weight:'500'}}}},
        }
    });
}

// --- TOP ACTIONS ---
function renderTopActionsChart() {
    destroyChart('topAct');
    const ctx = document.getElementById('topActionsChart').getContext('2d');
    const names = DATA.top_actions.names;
    const forecasts = DATA.top_actions.forecasts;
    const idx2030 = DATA.forecast_years.indexOf(2030);

    const items = names.map((n,i) => {
        const parts = n.split('. ');
        return {
            name: parts.length > 1 ? parts.slice(1).join('. ') : n,
            fullName: n,
            val: forecasts[n].values[idx2030],
        };
    }).sort((a,b) => b.val - a.val);

    charts.topAct = new Chart(ctx, {
        type:'bar',
        data:{
            labels:items.map(i=>i.name.length>35?i.name.slice(0,32)+'...':i.name),
            datasets:[{
                label:'Прогноз 2030',data:items.map(i=>i.val),
                backgroundColor:items.map((_,i)=>PALETTE[i%PALETTE.length]+'BB'),
                borderColor:items.map((_,i)=>PALETTE[i%PALETTE.length]),
                borderWidth:1,borderRadius:6,borderSkipped:false,
            }],
        },
        options:{
            responsive:true,maintainAspectRatio:false,indexAxis:'y',
            plugins:{
                legend:{display:false},
                tooltip:{callbacks:{
                    title:t=>items[t[0].dataIndex].fullName,
                    label:c=>`Прогноз: ${fmt.format(items[c.dataIndex].val)}`,
                }},
            },
            scales:{x:{grid:{color:'rgba(148,163,184,0.06)'},ticks:{callback:v=>fmtK(v)}},y:{grid:{display:false},ticks:{font:{size:10,weight:'500'}}}},
        }
    });
}

// --- NATIONAL TABLE ---
function renderNationalTable() {
    const tbody = document.getElementById('nationalTableBody');
    const years = DATA.forecast_years;
    const actualYears = DATA.actual_years;
    const n = DATA.national;

    years.forEach((y,i) => {
        const isAct = actualYears.includes(y);
        const actIdx = actualYears.indexOf(y);
        const val = isAct ? n.actual_active[actIdx] : n.active_poly.values[i];
        const actionsVal = isAct ? n.actual_actions[actIdx] : n.actions_poly.values[i];
        let prevVal = null;
        if (i > 0) {
            const prevY = years[i-1];
            const prevActIdx = actualYears.indexOf(prevY);
            prevVal = prevActIdx >= 0 ? n.actual_active[prevActIdx] : n.active_poly.values[i-1];
        }
        const yoyPct = prevVal && prevVal > 0 ? ((val - prevVal) / prevVal * 100).toFixed(1) : '—';
        const yoyStr = yoyPct !== '—' ? (parseFloat(yoyPct) >= 0 ? '+' + yoyPct + '%' : yoyPct + '%') : '—';
        // Penetration rate
        const pen = n.penetration_rate ? (n.penetration_rate.values[i] * 100).toFixed(2) + '%' : '—';
        // Population (thousands -> display as "XXX тыс.")
        const pop = n.population ? fmt.format(n.population[i]) + ' тыс.' : '—';
        const tr = document.createElement('tr');
        tr.className = isAct ? '' : 'row-forecast';
        tr.innerHTML = `
            <td>${y}</td>
            <td>${isAct?'<span class="badge-actual">Факт</span>':'<span class="badge-forecast">Прогноз</span>'}</td>
            <td>${fmt.format(val)}</td>
            <td>${isAct ? '—' : fmt.format(n.active_poly.lower[i]) + ' – ' + fmt.format(n.active_poly.upper[i])}</td>
            <td style="color:${parseFloat(yoyPct)>=0?'#10b981':'#f43f5e'}">${yoyStr}</td>
            <td style="color:#818cf8;font-weight:600">${pen}</td>
            <td>${pop}</td>
            <td>${fmt.format(actionsVal)}</td>
        `;
        tbody.appendChild(tr);
    });
}

// ================================================================
// TAB 2: REGIONS
// ================================================================

function buildRegionList() {
    const list = document.getElementById('regionList');
    const input = document.getElementById('regionSearch');
    const names = DATA.region_names;
    const idx2025 = DATA.actual_years.indexOf(2025);

    function render(filter) {
        list.innerHTML = '';
        const filtered = filter ? names.filter(n => n.toLowerCase().includes(filter.toLowerCase())) : names;
        filtered.forEach(name => {
            const div = document.createElement('div');
            div.className = 'region-item' + (selectedRegion === name ? ' active' : '');
            const actVal = DATA.regions[name].actual_active[idx2025 >= 0 ? idx2025 : DATA.actual_years.length - 1];
            div.innerHTML = `<span>${name}</span><span class="region-count">${fmtK(actVal)}</span>`;
            div.addEventListener('click', () => selectRegion(name));
            list.appendChild(div);
        });
    }

    render('');
    input.addEventListener('input', () => render(input.value));
}

function selectRegion(name) {
    selectedRegion = name;
    // Update list
    document.querySelectorAll('.region-item').forEach(el => {
        el.classList.toggle('active', el.querySelector('span').textContent === name);
    });

    // Show sections
    ['regionKpiSection','regionChartsSection','regionActionsSection','regionAgeSection','regionTableSection'].forEach(id => {
        document.getElementById(id).style.display = '';
    });

    const reg = DATA.regions[name];
    const years = DATA.forecast_years;
    const actualYears = DATA.actual_years;
    const lastIdx = actualYears.length - 1;
    const idx2030 = years.indexOf(2030);

    // KPI
    document.getElementById('regKpi1').textContent = fmt.format(reg.actual_active[lastIdx]);
    document.getElementById('regKpi2').textContent = fmt.format(reg.active_poly.values[idx2030]);
    const penStr = reg.penetration_rate ? (reg.penetration_rate.values[idx2030] * 100).toFixed(2) + '% нас.' : '';
    document.getElementById('regKpi2ci').textContent = penStr + ` | CI: ${fmt.format(reg.active_poly.lower[idx2030])} – ${fmt.format(reg.active_poly.upper[idx2030])}`;
    document.getElementById('regKpi3').textContent = fmt.format(reg.actions_poly.values[idx2030]);

    // Titles
    document.getElementById('regVolTitle').textContent = `Волонтёры: ${name}`;
    document.getElementById('regActTitle').textContent = `Полезные действия: ${name}`;
    document.getElementById('regAgeTitle').textContent = `Возрастные группы: ${name}`;
    document.getElementById('regTableTitle').textContent = `Прогнозная таблица: ${name}`;

    renderRegVolChart(reg, name);
    renderRegActChart(reg, name);
    renderRegAgeChart(reg, name, currentRegAgeMode);
    renderRegTable(reg);

    // Scroll to KPI
    document.getElementById('regionKpiSection').scrollIntoView({behavior:'smooth',block:'start'});
}

function renderRegVolChart(reg, name) {
    destroyChart('regVol');
    const ctx = document.getElementById('regVolChart').getContext('2d');
    const years = DATA.forecast_years;
    const actualYears = DATA.actual_years;
    const datasets = [
        makeActualDataset('Факт', reg.actual_active, C.indigo, years, actualYears),
        ...makeCIDatasets('Прогноз', reg.active_poly, C.amber, true, years, actualYears, reg.actual_active),
    ];
    charts.regVol = new Chart(ctx, {
        type:'line',data:{labels:years,datasets},
        options:{
            responsive:true,maintainAspectRatio:false,
            interaction:{mode:'index',intersect:false},
            plugins:{
                legend:{display:true,position:'bottom',labels:{usePointStyle:true,pointStyle:'circle',boxWidth:8,padding:14,font:{size:11},filter:i=>!i.text.includes('граница')}},
                tooltip:{callbacks:{label:tooltipCB},filter:tooltipFilter},
                annotation:makeDividerAnnotation(actualYears[actualYears.length-1]),
            },
            scales:standardScales(true),
        }
    });
}

function renderRegActChart(reg, name) {
    destroyChart('regAct');
    const ctx = document.getElementById('regActChart').getContext('2d');
    const years = DATA.forecast_years;
    const actualYears = DATA.actual_years;
    const datasets = [
        makeActualDataset('Факт', reg.actual_actions, C.emerald, years, actualYears),
        ...makeCIDatasets('Прогноз', reg.actions_poly, C.amber, true, years, actualYears, reg.actual_actions),
    ];
    charts.regAct = new Chart(ctx, {
        type:'line',data:{labels:years,datasets},
        options:{
            responsive:true,maintainAspectRatio:false,
            interaction:{mode:'index',intersect:false},
            plugins:{
                legend:{display:true,position:'bottom',labels:{usePointStyle:true,pointStyle:'circle',boxWidth:8,padding:14,font:{size:11},filter:i=>!i.text.includes('граница')}},
                tooltip:{callbacks:{label:tooltipCB},filter:tooltipFilter},
                annotation:makeDividerAnnotation(actualYears[actualYears.length-1]),
            },
            scales:standardScales(true),
        }
    });
}

function renderRegAgeChart(reg, name, mode) {
    destroyChart('regAge');
    currentRegAgeMode = mode;
    const ctx = document.getElementById('regAgeChart').getContext('2d');
    const years = DATA.forecast_years;
    const ags = DATA.age_groups;
    const datasets = [];
    const ageGroupIndices = {};

    ags.forEach(ag => {
        const color = AGE_COLORS[ag] || C.slate;
        const fc = reg.by_age[ag];
        if (!fc) return;
        
        if (mode === 'lines') {
            const startIdx = datasets.length;
            datasets.push({label:ag+' CI',data:fc.upper,_ageGroup:ag,borderColor:'transparent',backgroundColor:color+'12',fill:'+1',pointRadius:0,order:10});
            datasets.push({label:ag+' CI',data:fc.lower,_ageGroup:ag,borderColor:'transparent',backgroundColor:color+'12',fill:false,pointRadius:0,order:10});
            datasets.push({label:ag,data:fc.values,_ageGroup:ag,borderColor:color,backgroundColor:'transparent',borderWidth:2.5,pointRadius:3,pointHoverRadius:6,pointBackgroundColor:color,tension:0.3,order:1});
            ageGroupIndices[ag] = [startIdx, startIdx+1, startIdx+2];
        } else {
            const startIdx = datasets.length;
            datasets.push({label:ag,data:fc.values,_ageGroup:ag,borderColor:color,backgroundColor:color+'90',borderWidth:1,pointRadius:0,tension:0.3,fill:true});
            ageGroupIndices[ag] = [startIdx];
        }
    });

    charts.regAge = new Chart(ctx, {
        type:'line',data:{labels:years,datasets},
        options:{
            responsive:true,maintainAspectRatio:false,
            interaction:{mode:'index',intersect:false},
            plugins:{
                legend:{
                    position:'top',
                    labels:{usePointStyle:true,pointStyle:'circle',boxWidth:8,padding:14,font:{size:11},filter:i=>!i.text.includes('CI')},
                    onClick: (evt, item, legend) => ageLegendClick(legend.chart, item, ageGroupIndices),
                },
                tooltip:{callbacks:{label:tooltipCB},filter:i=>i.raw!==null&&!i.dataset.label?.includes('CI')},
            },
            scales:{x:{grid:{display:false},ticks:{font:{weight:'600'}}},y:{stacked:mode==='stacked',grid:{color:'rgba(148,163,184,0.06)'},ticks:{callback:v=>fmtK(v)},beginAtZero:true}},
        }
    });
}

function renderRegTable(reg) {
    const tbody = document.getElementById('regTableBody');
    tbody.innerHTML = '';
    const years = DATA.forecast_years;
    const actualYears = DATA.actual_years;

    years.forEach((y,i) => {
        const isAct = actualYears.includes(y);
        const actIdx = actualYears.indexOf(y);
        const val = isAct ? reg.actual_active[actIdx] : reg.active_poly.values[i];
        const actionsVal = isAct ? reg.actual_actions[actIdx] : reg.actions_poly.values[i];
        let prevVal = null;
        if (i > 0) {
            const prevY = years[i-1];
            const prevActIdx = actualYears.indexOf(prevY);
            prevVal = prevActIdx >= 0 ? reg.actual_active[prevActIdx] : reg.active_poly.values[i-1];
        }
        const yoyPct = prevVal && prevVal > 0 ? ((val - prevVal) / prevVal * 100).toFixed(1) : '—';
        const yoyStr = yoyPct !== '—' ? (parseFloat(yoyPct) >= 0 ? '+' + yoyPct + '%' : yoyPct + '%') : '—';
        // Penetration rate
        const pen = reg.penetration_rate ? (reg.penetration_rate.values[i] * 100).toFixed(2) + '%' : '—';
        // Population
        const pop = reg.population ? fmt.format(reg.population[i]) + ' тыс.' : '—';
        const tr = document.createElement('tr');
        tr.className = isAct ? '' : 'row-forecast';
        tr.innerHTML = `
            <td>${y}</td>
            <td>${isAct?'<span class="badge-actual">Факт</span>':'<span class="badge-forecast">Прогноз</span>'}</td>
            <td>${fmt.format(val)}</td>
            <td>${isAct ? '—' : fmt.format(reg.active_poly.lower[i]) + ' – ' + fmt.format(reg.active_poly.upper[i])}</td>
            <td style="color:${parseFloat(yoyPct)>=0?'#10b981':'#f43f5e'}">${yoyStr}</td>
            <td style="color:#818cf8;font-weight:600">${pen}</td>
            <td>${pop}</td>
            <td>${fmt.format(actionsVal)}</td>
        `;
        tbody.appendChild(tr);
    });
}

// ================================================================
// TAB 3: METHODOLOGY CI EXPLAINER
// ================================================================
function renderCIExplainer() {
    const ctx = document.getElementById('ciExplainerChart');
    if (!ctx) return;
    const years = [2020,2021,2022,2023,2024,2025,2026,2027,2028,2029,2030];
    const actual = [10,20,35,55,80,110,null,null,null,null,null];
    const forecast = [null,null,null,null,null,110,145,185,230,280,335];
    const upper = [null,null,null,null,null,115,165,220,290,370,460];
    const lower = [null,null,null,null,null,105,125,150,170,190,210];

    new Chart(ctx, {
        type:'line',
        data:{
            labels:years,
            datasets:[
                {label:'Верхняя',data:upper,borderColor:'transparent',backgroundColor:'rgba(245,158,11,0.12)',fill:'+1',pointRadius:0,order:5},
                {label:'Нижняя',data:lower,borderColor:'transparent',backgroundColor:'rgba(245,158,11,0.12)',fill:false,pointRadius:0,order:5},
                {label:'Факт',data:actual,borderColor:C.indigo,borderWidth:3,pointRadius:5,pointBackgroundColor:C.indigo,pointBorderColor:'#0a0e1a',pointBorderWidth:2,tension:0.3,order:1},
                {label:'Прогноз',data:forecast,borderColor:C.amber,borderWidth:2.5,borderDash:[8,4],pointRadius:4,pointBackgroundColor:C.amber,pointBorderColor:'#0a0e1a',pointBorderWidth:2,tension:0.3,order:2},
            ]
        },
        options:{
            responsive:true,maintainAspectRatio:false,
            plugins:{legend:{display:false},tooltip:{enabled:false}},
            scales:{x:{grid:{display:false},ticks:{font:{size:10}}},y:{display:false}},
        }
    });
}

// ================================================================
// AGE LEGEND CLICK HANDLER — syncs CI bands with line visibility
// ================================================================
function ageLegendClick(chart, legendItem, ageGroupIndices) {
    const ag = legendItem.text;
    const indices = ageGroupIndices[ag];
    if (!indices) return;
    // Toggle all datasets for this age group
    const isCurrentlyHidden = !chart.isDatasetVisible(indices[indices.length - 1]);
    indices.forEach(idx => {
        chart.setDatasetVisibility(idx, isCurrentlyHidden);
    });
    chart.update();
}

// ================================================================
// CHART CONTROLS
// ================================================================
function setupChartControls() {
    document.querySelectorAll('.chart-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const chart = btn.dataset.chart;
            const type = btn.dataset.type;
            document.querySelectorAll(`.chart-btn[data-chart="${chart}"]`).forEach(b=>b.classList.remove('active'));
            btn.classList.add('active');
            if(chart==='natAge') renderNatAgeChart(type);
            if(chart==='regAge' && selectedRegion) renderRegAgeChart(DATA.regions[selectedRegion], selectedRegion, type);
        });
    });
}

document.addEventListener('DOMContentLoaded', init);
