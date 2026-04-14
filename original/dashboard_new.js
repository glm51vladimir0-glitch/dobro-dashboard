// === Volunteer Dashboard v6 — ALL CUMULATIVE ===
let DATA = null;

const C = {indigo:'#6366f1',cyan:'#06b6d4',emerald:'#10b981',amber:'#f59e0b',rose:'#f43f5e',violet:'#8b5cf6',sky:'#38bdf8',lime:'#84cc16',orange:'#fb923c',pink:'#ec4899',teal:'#14b8a6',fuchsia:'#d946ef',slate:'#64748b',blue:'#3b82f6',red:'#ef4444'};
const PALETTE = [C.indigo,C.cyan,C.emerald,C.amber,C.rose,C.violet,C.sky,C.lime,C.orange,C.pink,C.teal,C.fuchsia,C.slate,C.blue,C.red];
const AGE_COLORS = {'0-13':'#ec4899','14-17':'#f43f5e','18-24':'#6366f1','25-35':'#06b6d4','36-55':'#10b981','36-54':'#10b981','55+':'#8b5cf6','55-64':'#f59e0b','65+':'#8b5cf6'};

Chart.defaults.color='#94a3b8';Chart.defaults.borderColor='rgba(148,163,184,0.06)';Chart.defaults.font.family="'Inter',sans-serif";Chart.defaults.font.size=12;
Chart.defaults.plugins.tooltip.backgroundColor='rgba(17,24,39,0.95)';Chart.defaults.plugins.tooltip.padding=12;Chart.defaults.plugins.tooltip.cornerRadius=8;

const fmt=new Intl.NumberFormat('ru-RU');
const fmtK=n=>n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(0)+'K':n.toString();
const charts={};
function destroyChart(id){if(charts[id]){charts[id].destroy();delete charts[id];}}
let activeFilters={region:'all',action:'all',age:'all'};

async function init(){
    try{const r=await fetch('forecast_data_new.json');DATA=await r.json();}
    catch(e){console.error('Load failed',e);return;}
    document.getElementById('headerDate').textContent=new Date().toLocaleDateString('ru-RU',{year:'numeric',month:'long',day:'numeric'});
    setupFilters();setupKPI();createParticles();
    renderMainChart();
    renderGrowthChart();
    renderActionsChart();
    renderRegistrationsChart();
    renderRegAgeChart();
    renderNatAgeChart();
    renderTopRegionsChart();
    renderTopActionsChart();
    renderNationalTable();
}

function setupFilters(){
    if(!DATA.raw_cube)return;const cube=DATA.raw_cube;
    const regSel=document.getElementById('filterRegion');
    cube.regions.forEach(r=>{const o=document.createElement('option');o.value=r;o.textContent=r;regSel.appendChild(o);});
    const actSel=document.getElementById('filterAction');
    cube.actions.forEach(a=>{const o=document.createElement('option');o.value=a;o.textContent=a.replace(/^\d+\.\d+\.\s*/,'');actSel.appendChild(o);});
    const ageSel=document.getElementById('filterAge');
    cube.ages.forEach(g=>{const o=document.createElement('option');o.value=g;o.textContent=g;ageSel.appendChild(o);});
    regSel.onchange=()=>{activeFilters.region=regSel.value;applyFilters();};
    actSel.onchange=()=>{activeFilters.action=actSel.value;applyFilters();};
    ageSel.onchange=()=>{activeFilters.age=ageSel.value;applyFilters();};
    document.getElementById('filterReset').onclick=()=>{regSel.value='all';actSel.value='all';ageSel.value='all';activeFilters={region:'all',action:'all',age:'all'};applyFilters();};
}

function polyFitJS(xs,ys,deg){const n=xs.length,d=Math.min(deg,n-1),sz=d+1;const A=Array.from({length:sz},()=>Array(sz).fill(0));const b=Array(sz).fill(0);for(let i=0;i<n;i++){const x=xs[i],y=ys[i];for(let j=0;j<sz;j++){const xj=Math.pow(x,j);b[j]+=xj*y;for(let k=0;k<sz;k++)A[j][k]+=xj*Math.pow(x,k);}}const M=A.map((r,i)=>[...r,b[i]]);for(let c=0;c<sz;c++){let mr=c;for(let r=c+1;r<sz;r++)if(Math.abs(M[r][c])>Math.abs(M[mr][c]))mr=r;[M[c],M[mr]]=[M[mr],M[c]];if(Math.abs(M[c][c])<1e-12)continue;for(let r=c+1;r<sz;r++){const f=M[r][c]/M[c][c];for(let j=c;j<=sz;j++)M[r][j]-=f*M[c][j];}}const co=Array(sz).fill(0);for(let i=sz-1;i>=0;i--){co[i]=M[i][sz];for(let j=i+1;j<sz;j++)co[i]-=M[i][j]*co[j];co[i]/=M[i][i];}return co;}
function polyEval(c,x){let v=0;for(let i=0;i<c.length;i++)v+=c[i]*Math.pow(x,i);return v;}
function forecastJS(yd,fy,trainUpTo){const xs=Object.keys(yd).map(Number).filter(y=>y<=trainUpTo);const ys=xs.map(y=>yd[y]);if(xs.length<2)return{values:fy.map(()=>0),upper:fy.map(()=>0),lower:fy.map(()=>0)};const c=polyFitJS(xs,ys,2);const ft=xs.map(x=>polyEval(c,x));const rs=ys.map((y,i)=>y-ft[i]);const rmse=Math.sqrt(rs.reduce((s,r)=>s+r*r,0)/rs.length);const last=Math.max(...xs);const v=[],u=[],l=[];for(const y of fy){const val=Math.max(0,polyEval(c,y));const ah=Math.max(0,y-last);const m=rmse*(1+0.3*ah)*1.96+val*0.04*ah;v.push(Math.round(val));u.push(Math.round(val+m));l.push(Math.round(Math.max(0,val-m)));}return{values:v,upper:u,lower:l};}

function filterCube(){const cube=DATA.raw_cube,rows=cube.rows;let rs=null,as=null,gs=null;if(activeFilters.region!=='all')rs=new Set([cube.regions.indexOf(activeFilters.region)]);if(activeFilters.action!=='all')as=new Set([cube.actions.indexOf(activeFilters.action)]);if(activeFilters.age!=='all')gs=new Set([cube.ages.indexOf(activeFilters.age)]);const f=[];for(let i=0;i<rows.length;i++){const r=rows[i];if(rs&&!rs.has(r[1]))continue;if(as&&!as.has(r[2]))continue;if(gs&&!gs.has(r[3]))continue;f.push(r);}return f;}

function applyFilters(){
    const isDef=activeFilters.region==='all'&&activeFilters.action==='all'&&activeFilters.age==='all';
    if(isDef){setupKPI();renderMainChart();renderGrowthChart();renderActionsChart();renderTopRegionsChart();renderTopActionsChart();renderNationalTable();return;}
    const filtered=filterCube();const cube=DATA.raw_cube;const years=cube.years.filter(y=>y>=2016&&y<=2025);
    const byYear={};years.forEach(y=>{byYear[y]={active:0,actions:0};});
    for(const r of filtered){const year=cube.years[r[0]];if(year>2025||year<2016)continue;byYear[year].active+=r[4];byYear[year].actions+=r[5];}
    // Make cumulative
    const cumActive={};let c=0;for(const y of years){c+=byYear[y].active;cumActive[y]=c;}
    const fc=forecastJS(cumActive,DATA.forecast_years,2025);
    document.getElementById('kpiVol').textContent=fmt.format(cumActive[2025]||0);
    document.getElementById('kpiForecast').textContent=fmt.format(fc.values[fc.values.length-1]);
    document.getElementById('kpiActions').textContent=fmt.format(cumActive[2025]||0);
    renderFilteredMainChart(cumActive,years,fc);
    const regByY={};cube.regions.forEach(r=>{regByY[r]={};});for(const r of filtered){const reg=cube.regions[r[1]];const year=cube.years[r[0]];if(year>2025||year<2016)continue;regByY[reg][year]=(regByY[reg][year]||0)+r[4];}
    const regRank=Object.entries(regByY).map(([reg,yd])=>{let c=0;const cum={};for(const y of years){c+=yd[y]||0;cum[y]=c;}return[reg,cum[y]];}).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]).slice(0,15);
    renderFilteredTopRegions(regRank);
    const actByY={};cube.actions.forEach(a=>{actByY[a]={};});for(const r of filtered){const act=cube.actions[r[2]];const year=cube.years[r[0]];if(year>2025||year<2016)continue;actByY[act][year]=(actByY[act][year]||0)+r[4];}
    const actRank=Object.entries(actByY).map(([act,yd])=>{let c=0;for(const y of years)c+=yd[y]||0;return[act,c];}).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]).slice(0,10);
    renderFilteredTopActions(actRank);
    renderFilteredTable(cumActive,years,fc);
}

function stdScales(){return{x:{grid:{display:false},ticks:{font:{weight:'600'}}},y:{grid:{color:'rgba(148,163,184,0.06)'},ticks:{callback:v=>fmtK(v),font:{size:11}},beginAtZero:true}};}
function ttFilter(item){return item.raw!==null;}
function ttCB(ctx){if(ctx.dataset.label?.includes('CI'))return null;return`${ctx.dataset.label}: ${fmt.format(Math.round(ctx.raw))}`;}

function makeFC(years,actYears,actVals,fc,lineColor,fillColor){
    const ad=years.map(y=>{const i=actYears.indexOf(y);return i!==-1?actVals[i]:null;});
    const pd=years.map(y=>y>=2025?fc.values[years.indexOf(y)]:null);
    const ud=years.map(y=>y>=2025?fc.upper[years.indexOf(y)]:null);
    const ld=years.map(y=>y>=2025?fc.lower[years.indexOf(y)]:null);
    const bi=years.indexOf(2025);if(bi!==-1&&ad[bi]!==null){pd[bi]=ad[bi];ud[bi]=ad[bi];ld[bi]=ad[bi];}
    return[
        {label:'CI верх',data:ud,borderColor:'transparent',backgroundColor:fillColor,fill:'+1',pointRadius:0,tension:0.3},
        {label:'CI низ',data:ld,borderColor:'transparent',backgroundColor:'transparent',fill:false,pointRadius:0,tension:0.3},
        {label:'Факт',data:ad,borderColor:lineColor,borderWidth:3,pointBackgroundColor:'white',pointBorderColor:lineColor,pointBorderWidth:2,pointRadius:4,tension:0.3},
        {label:'Прогноз',data:pd,borderColor:C.amber,borderWidth:3,borderDash:[6,4],pointBackgroundColor:'white',pointBorderColor:C.amber,pointBorderWidth:2,pointRadius:4,tension:0.3},
    ];
}

function setupKPI(){
    const s=DATA.summary;
    animateNumber('kpiVol',s.volunteers_cumulative_2025);
    animateNumber('kpiForecast',s.forecast_2030);
    animateNumber('kpiActions',s.actions_cumulative_2025);
    animateNumber('kpiReg',s.registrations_cumulative_2025);
    document.getElementById('kpiGrowth').textContent='Накопительно за 2025';
    document.getElementById('kpiActTypes').textContent='Прогноз: '+fmt.format(s.forecast_2030)+' к 2030';
}

function animateNumber(id,target){const el=document.getElementById(id);if(!el)return;const dur=2000;const st=performance.now();const anim=now=>{const p=Math.min((now-st)/dur,1);const e=1-Math.pow(1-p,3);el.textContent=fmt.format(Math.round(target*e));if(p<1)requestAnimationFrame(anim);};requestAnimationFrame(anim);}

function createParticles(){const el=document.getElementById('bgParticles');const cols=[C.indigo,C.cyan,C.emerald,C.violet];for(let i=0;i<25;i++){const p=document.createElement('div');p.className='particle';const sz=Math.random()*5+2;p.style.cssText=`width:${sz}px;height:${sz}px;background:${cols[i%4]};left:${Math.random()*100}%;animation-duration:${Math.random()*20+15}s;animation-delay:${Math.random()*10}s;`;el.appendChild(p);}}

// 1. MAIN: cumulative volunteers
function renderMainChart(){
    destroyChart('main');const ctx=document.getElementById('mainChart');if(!ctx)return;
    const fy=DATA.forecast_years,ay=DATA.actual_years;
    charts.main=new Chart(ctx,{type:'line',data:{labels:fy,datasets:makeFC(fy,ay,DATA.national.volunteers_cumulative,DATA.national.volunteer_cum_fc,C.indigo,'rgba(99,102,241,0.1)')},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:true,position:'top',align:'end',labels:{usePointStyle:true,boxWidth:8,font:{size:11},filter:i=>!i.text.includes('CI')}},tooltip:{callbacks:{label:ttCB},filter:ttFilter}},scales:stdScales()}});
}

// 2. GROWTH (per year)
function renderGrowthChart(){
    destroyChart('growth');const ctx=document.getElementById('growthChart');if(!ctx)return;
    const g=DATA.national.growth_rates_pct;const yrs=DATA.actual_years.slice(1);
    charts.growth=new Chart(ctx,{type:'bar',data:{labels:yrs,datasets:[{data:g.map(v=>v||0),backgroundColor:g.map(v=>v>50?C.emerald+'B3':v>20?C.cyan+'B3':C.amber+'B3'),borderRadius:8,borderSkipped:false,barThickness:36}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`Рост: ${c.raw.toFixed(1)}%`}}},scales:{x:{grid:{display:false},ticks:{font:{weight:'600'}}},y:{grid:{color:'rgba(148,163,184,0.06)'},ticks:{callback:v=>v+'%'},beginAtZero:true}}}});
}

// 3. ACTIONS: cumulative
function renderActionsChart(){
    destroyChart('actions');const ctx=document.getElementById('actionsChart');if(!ctx)return;
    const fy=DATA.forecast_years,ay=DATA.actual_years;
    charts.actions=new Chart(ctx,{type:'line',data:{labels:fy,datasets:makeFC(fy,ay,DATA.actions.cumulative,DATA.actions.cum_fc,C.rose,'rgba(244,63,94,0.1)')},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:true,position:'top',align:'end',labels:{usePointStyle:true,boxWidth:8,font:{size:11},filter:i=>!i.text.includes('CI')}},tooltip:{callbacks:{label:ttCB},filter:ttFilter}},scales:stdScales()}});
}

// 4. REGISTRATIONS: cumulative
function renderRegistrationsChart(){
    destroyChart('registrations');const ctx=document.getElementById('registrationsChart');if(!ctx)return;
    const fy=DATA.forecast_years,ay=DATA.actual_years;
    charts.registrations=new Chart(ctx,{type:'line',data:{labels:fy,datasets:makeFC(fy,ay,DATA.registrations.cumulative,DATA.registrations.cum_fc,C.cyan,'rgba(6,182,212,0.1)')},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:true,position:'top',align:'end',labels:{usePointStyle:true,boxWidth:8,font:{size:11},filter:i=>!i.text.includes('CI')}},tooltip:{callbacks:{label:ttCB},filter:ttFilter}},scales:stdScales()}});
}

// 5. REG AGE: cumulative stacked
function renderRegAgeChart(){
    destroyChart('regAgeChart');if(!DATA.registrations)return;
    const ctx=document.getElementById('regAgeChart');if(!ctx)return;
    const ageGroups=DATA.age_groups;const years=DATA.actual_years;const d=DATA.registrations.by_age_cum;
    const datasets=ageGroups.map(ag=>{const color=AGE_COLORS[ag];return{label:ag,data:d[ag],backgroundColor:color+'CC',borderColor:color,borderWidth:1,borderRadius:3};});
    charts.regAgeChart=new Chart(ctx,{type:'bar',data:{labels:years,datasets},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:true,position:'top',labels:{usePointStyle:true,pointStyle:'rect',boxWidth:10,font:{size:11}}},tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${fmt.format(c.raw)}`}}},scales:{x:{stacked:true,grid:{display:false},ticks:{font:{weight:'600'}}},y:{stacked:true,grid:{color:'rgba(148,163,184,0.06)'},ticks:{callback:v=>fmtK(v)},beginAtZero:true}}}});
}

// 6. NAT AGE: volunteer age with forecast
function renderNatAgeChart(){
    destroyChart('natAge');const ctx=document.getElementById('natAgeChart');if(!ctx)return;
    const pda=DATA.pd_analytics.by_year_age;const ages=DATA.pd_ages;const fy=DATA.forecast_years;const ay=DATA.actual_years;
    const datasets=[];
    for(const ag of ages){
        const color=AGE_COLORS[ag]||PALETTE[ages.indexOf(ag)%PALETTE.length];
        // Cumulative per year for this age
        let c=0;const cumV=[];for(const y of ay){c+=pda[ag]?.[y]||0;cumV.push(c);}
        datasets.push({label:ag,data:fy.map((y,i)=>{const idx=ay.indexOf(y);return idx!==-1?cumV[idx]:null;}),borderColor:color,borderWidth:2,pointRadius:3,pointBackgroundColor:'white',pointBorderColor:color,pointBorderWidth:1.5,tension:0.3});
    }
    if(DATA.vol_age_forecasts){
        for(const ag of ages){
            if(!DATA.vol_age_forecasts[ag])continue;
            const color=AGE_COLORS[ag]||PALETTE[ages.indexOf(ag)%PALETTE.length];
            const fc=DATA.vol_age_forecasts[ag];
            datasets.push({label:ag+' (прогн.)',data:fy.map(y=>y>=2025?fc.values[fy.indexOf(y)]:null),borderColor:color,borderWidth:2,borderDash:[5,3],pointRadius:0,tension:0.3});
        }
    }
    charts.natAge=new Chart(ctx,{type:'line',data:{labels:fy,datasets},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:true,position:'top',labels:{usePointStyle:true,boxWidth:8,font:{size:10},filter:i=>!i.text.includes('прогн')}},tooltip:{callbacks:{label:ttCB},filter:ttFilter}},scales:stdScales()}});
}

// 7. TOP REGIONS
function renderTopRegionsChart(){
    destroyChart('topReg');const ctx=document.getElementById('topRegionsChart');if(!ctx)return;
    const names=DATA.top_region_names;const cube=DATA.raw_cube;
    const regionYearly={};cube.regions.forEach(r=>{regionYearly[r]={};});
    for(const row of cube.rows){const reg=cube.regions[row[1]];const year=cube.years[row[0]];regionYearly[reg][year]=(regionYearly[reg][year]||0)+row[4];}
    const items=names.map(n=>{
        let c=0;const cum={};for(const y of DATA.actual_years){c+=regionYearly[n]?.[y]||0;cum[y]=c;}
        const fc=forecastJS(cum,DATA.forecast_years,2025);
        return{name:n.replace(' область','').replace(' край','').replace('Республика ','Респ. '),fullName:n,val:fc.values[DATA.forecast_years.indexOf(2030)]};
    }).filter(i=>i.val>0).sort((a,b)=>b.val-a.val);
    charts.topReg=new Chart(ctx,{type:'bar',data:{labels:items.map(i=>i.name),datasets:[{label:'Прогноз 2030',data:items.map(i=>i.val),backgroundColor:items.map((_,i)=>PALETTE[i%PALETTE.length]+'BB'),borderColor:items.map((_,i)=>PALETTE[i%PALETTE.length]),borderWidth:1,borderRadius:6,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{title:t=>items[t[0].dataIndex].fullName,label:c=>`Прогноз: ${fmt.format(items[c.dataIndex].val)}`}}},scales:{x:{grid:{color:'rgba(148,163,184,0.06)'},ticks:{callback:v=>fmtK(v)}},y:{grid:{display:false},ticks:{font:{size:10,weight:'500'}}}}}});
}

// 8. TOP ACTIONS
function renderTopActionsChart(){
    destroyChart('topAct');const ctx=document.getElementById('topActionsChart');if(!ctx)return;
    const names=DATA.top_actions.names;const pda=DATA.pd_analytics.by_year_action;
    const items=names.map(n=>{
        let c=0;const cum={};for(const y of DATA.actual_years){c+=pda[n]?.[y]||0;cum[y]=c;}
        const fc=forecastJS(cum,DATA.forecast_years,2025);
        const parts=n.split('. ');return{name:parts.length>1?parts.slice(1).join('. '):n,fullName:n,val:fc.values[DATA.forecast_years.indexOf(2030)]};
    }).filter(i=>i.val>0).sort((a,b)=>b.val-a.val);
    charts.topAct=new Chart(ctx,{type:'bar',data:{labels:items.map(i=>i.name.length>35?i.name.slice(0,32)+'...':i.name),datasets:[{label:'Прогноз 2030',data:items.map(i=>i.val),backgroundColor:items.map((_,i)=>PALETTE[i%PALETTE.length]+'BB'),borderColor:items.map((_,i)=>PALETTE[i%PALETTE.length]),borderWidth:1,borderRadius:6,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{grid:{color:'rgba(148,163,184,0.06)'},ticks:{callback:v=>fmtK(v)}},y:{grid:{display:false},ticks:{font:{size:10}}}}}});
}

// TABLE
function renderNationalTable(){
    const tbody=document.getElementById('nationalTableBody');if(!tbody)return;tbody.innerHTML='';
    const fy=DATA.forecast_years,ay=DATA.actual_years;
    const vfc=DATA.national.volunteer_cum_fc;
    const afc=DATA.actions.cum_fc;
    const pop=DATA.population;
    let prevVal=null;
    for(const y of fy){
        const isAct=ay.includes(y);const idx=ay.indexOf(y);
        const vol=isAct?DATA.national.volunteers_cumulative[idx]:vfc.values[fy.indexOf(y)];
        const act=isAct?DATA.actions.cumulative[idx]:afc.values[fy.indexOf(y)];
        const delta=prevVal&&prevVal>0?((vol-prevVal)/prevVal*100).toFixed(1)+'%':'—';
        const tr=document.createElement('tr');if(!isAct)tr.classList.add('row-forecast');
        const ci=isAct?'—':`${fmt.format(vfc.lower[fy.indexOf(y)])} — ${fmt.format(vfc.upper[fy.indexOf(y)])}`;
        const popVal=pop[y]?`${pop[y]} млн`:'—';
        const pen=vol&&pop[y]?((vol/(pop[y]*1e6))*100).toFixed(2)+'%':'—';
        tr.innerHTML=`<td>${y}</td><td>${isAct?'<span class="badge-actual">Факт</span>':'<span class="badge-forecast">Прогноз</span>'}</td><td>${fmt.format(vol)}</td><td>${ci}</td><td>${delta}</td><td>${pen}</td><td>${popVal}</td><td>${act!==undefined?fmt.format(act):'—'}</td>`;
        tbody.appendChild(tr);prevVal=vol;
    }
}

// FILTERED
function renderFilteredMainChart(cumActive,years,fc){
    destroyChart('main');const ctx=document.getElementById('mainChart');if(!ctx)return;
    const fy=DATA.forecast_years;
    const ad=fy.map(y=>{const i=years.indexOf(y);return i!==-1?cumActive[y]:null;});
    const pd=fy.map(y=>y>=2025?fc.values[fy.indexOf(y)]:null);
    const ud=fy.map(y=>y>=2025?fc.upper[fy.indexOf(y)]:null);
    const ld=fy.map(y=>y>=2025?fc.lower[fy.indexOf(y)]:null);
    const bi=fy.indexOf(2025);if(bi!==-1&&ad[bi]!==null){pd[bi]=ad[bi];ud[bi]=ad[bi];ld[bi]=ad[bi];}
    charts.main=new Chart(ctx,{type:'line',data:{labels:fy,datasets:[
        {label:'CI верх',data:ud,borderColor:'transparent',backgroundColor:'rgba(99,102,241,0.1)',fill:'+1',pointRadius:0,tension:0.3},
        {label:'CI низ',data:ld,borderColor:'transparent',backgroundColor:'transparent',fill:false,pointRadius:0,tension:0.3},
        {label:'Факт',data:ad,borderColor:C.indigo,borderWidth:3,pointBackgroundColor:'white',pointBorderColor:C.indigo,pointBorderWidth:2,pointRadius:4,tension:0.3},
        {label:'Прогноз',data:pd,borderColor:C.amber,borderWidth:3,borderDash:[6,4],pointBackgroundColor:'white',pointBorderColor:C.amber,pointBorderWidth:2,pointRadius:4,tension:0.3},
    ]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:true,position:'top',align:'end',labels:{usePointStyle:true,boxWidth:8,font:{size:11},filter:i=>!i.text.includes('CI')}},tooltip:{callbacks:{label:ttCB},filter:ttFilter}},scales:stdScales()}});
}

function renderFilteredTopRegions(ranking){
    destroyChart('topReg');const ctx=document.getElementById('topRegionsChart');if(!ctx)return;
    charts.topReg=new Chart(ctx,{type:'bar',data:{labels:ranking.map(r=>r[0].length>25?r[0].substring(0,25)+'...':r[0]),datasets:[{data:ranking.map(r=>r[1]),backgroundColor:PALETTE.slice(0,ranking.length).map(c=>c+'44'),borderColor:PALETTE.slice(0,ranking.length),borderWidth:1.5,borderRadius:6}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{beginAtZero:true,ticks:{callback:v=>fmtK(v)}},y:{grid:{display:false}}}}});
}

function renderFilteredTopActions(ranking){
    destroyChart('topAct');const ctx=document.getElementById('topActionsChart');if(!ctx)return;
    charts.topAct=new Chart(ctx,{type:'bar',data:{labels:ranking.map(r=>r[0].replace(/^\d+\.\d+\.\s*/,'').substring(0,30)),datasets:[{data:ranking.map(r=>r[1]),backgroundColor:PALETTE.slice(0,ranking.length).map(c=>c+'44'),borderColor:PALETTE.slice(0,ranking.length),borderWidth:1.5,borderRadius:6}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{beginAtZero:true,ticks:{callback:v=>fmtK(v)}},y:{grid:{display:false},ticks:{font:{size:10}}}}}});
}

function renderFilteredTable(cumActive,years,fc){
    const tbody=document.getElementById('nationalTableBody');if(!tbody)return;tbody.innerHTML='';
    let prevVal=null;
    for(const y of DATA.forecast_years){
        const isAct=years.includes(y);
        const val=isAct?cumActive[y]:fc.values[DATA.forecast_years.indexOf(y)];
        const delta=prevVal&&prevVal>0?((val-prevVal)/prevVal*100).toFixed(1)+'%':'—';
        const tr=document.createElement('tr');if(!isAct)tr.classList.add('row-forecast');
        tr.innerHTML=`<td>${y}</td><td>${isAct?'<span class="badge-actual">Факт</span>':'<span class="badge-forecast">Прогноз</span>'}</td><td>${fmt.format(val)}</td><td>${isAct?'—':fmt.format(fc.lower[DATA.forecast_years.indexOf(y)])+' — '+fmt.format(fc.upper[DATA.forecast_years.indexOf(y)])}</td><td>${delta}</td><td>—</td><td>—</td><td>—</td>`;
        tbody.appendChild(tr);prevVal=val;
    }
}

document.addEventListener('DOMContentLoaded',init);
