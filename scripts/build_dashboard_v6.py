#!/usr/bin/env python3
"""
Dashboard data builder v6 — ALL CUMULATIVE.
Volunteers: cumulative unique (max-per-region-age)
Registrations: cumulative
Actions: cumulative actions_count
"""
import csv
import json
import math
from collections import defaultdict

def parse_pd(path):
    rows = []
    with open(path, encoding='utf-8') as f:
        for r in csv.DictReader(f):
            y = int(r['year'])
            if y < 2016: continue
            rows.append({
                'year': y, 'action': r['fa.action_name'].strip(),
                'region': r['region_name'].strip(), 'age': r['age_group'].strip(),
                'active': int(r['active_count']), 'actions': int(r['actions_count']),
            })
    return rows

def parse_regi(path):
    rows = []
    with open(path, encoding='utf-8') as f:
        for r in csv.DictReader(f):
            y = int(r['Год'])
            if y < 2016: continue
            rows.append({
                'year': y, 'region': r['Регион'].strip(),
                'total': int(r['Всего регистраций']),
                '0-13': int(r['0-13']), '14-17': int(r['14-17']),
                '18-24': int(r['18-24']), '25-35': int(r['25-35']),
                '36-55': int(r['36-55']), '55+': int(r['55+']),
            })
    return rows

POPULATION = {
    2016:146.5,2017:146.8,2018:146.9,2019:146.7,2020:146.2,
    2021:145.5,2022:144.8,2023:144.1,2024:143.3,2025:142.8,
    2026:142.2,2027:141.5,2028:140.8,2029:140.0,2030:139.3,
}

def poly_fit(xs, ys, degree=2):
    n=len(xs);d=min(degree,n-1);size=d+1
    ATA=[[0.0]*size for _ in range(size)];ATy=[0.0]*size
    for i in range(n):
        x,y=xs[i],ys[i]
        for j in range(size):
            xj=x**j;ATy[j]+=xj*y
            for k in range(size):ATA[j][k]+=xj*x**k
    M=[row[:]+[ATy[i]] for i,row in enumerate(ATA)]
    for col in range(size):
        mr=col
        for row in range(col+1,size):
            if abs(M[row][col])>abs(M[mr][col]):mr=row
        M[col],M[mr]=M[mr],M[col]
        if abs(M[col][col])<1e-12:continue
        for row in range(col+1,size):
            f=M[row][col]/M[col][col]
            for j in range(col,size+1):M[row][j]-=f*M[col][j]
    c=[0.0]*size
    for i in range(size-1,-1,-1):
        c[i]=M[i][size]
        for j in range(i+1,size):c[i]-=M[i][j]*c[j]
        c[i]/=M[i][i]
    return c

def poly_eval(c,x):return sum(ci*x**i for i,ci in enumerate(c))

def forecast(yearly_data, forecast_years, train_up_to=2025):
    xs=sorted(y for y in yearly_data if y<=train_up_to)
    ys=[yearly_data[y] for y in xs]
    if len(xs)<2:return{'values':[0]*len(forecast_years),'upper':[0]*len(forecast_years),'lower':[0]*len(forecast_years)}
    c=poly_fit(xs,ys,2)
    fitted=[poly_eval(c,x) for x in xs]
    res=[y-f for y,f in zip(ys,fitted)]
    rmse=math.sqrt(sum(r**2 for r in res)/len(res))
    last=max(xs)
    values,upper,lower=[],[],[]
    for y in forecast_years:
        v=max(0,poly_eval(c,y));ahead=max(0,y-last)
        m=rmse*(1+0.3*ahead)*1.96+v*0.04*ahead
        values.append(round(v));upper.append(round(v+m));lower.append(round(max(0,v-m)))
    return{'values':values,'upper':upper,'lower':lower}

def main():
    pd_rows=parse_pd('/tmp/жмурко_ПД_utf8.csv')
    regi_rows=parse_regi('/tmp/жмурко_реги_utf8.csv')
    forecast_years=list(range(2016,2031))
    actual_years=list(range(2016,2026))

    # === VOLUNTEERS: cumulative max-per-(region,age) ===
    vol_per_year={}
    by_combo=defaultdict(lambda:defaultdict(int))
    for r in pd_rows:
        if r['year']>2025:continue
        key=(r['region'],r['age'])
        if r['active']>by_combo[r['year']][key]:by_combo[r['year']][key]=r['active']
    for y in actual_years:
        vol_per_year[y]=sum(by_combo[y].values())
    
    vol_cum={};c=0
    for y in actual_years:
        c+=vol_per_year[y];vol_cum[y]=c
    
    # === REGISTRATIONS: cumulative ===
    reg_per_year={}
    reg_by_age=defaultdict(lambda:defaultdict(int))
    reg_by_region=defaultdict(lambda:defaultdict(int))
    for r in regi_rows:
        reg_per_year[r['year']]=reg_per_year.get(r['year'],0)+r['total']
        for ag in ['0-13','14-17','18-24','25-35','36-55','55+']:
            reg_by_age[ag][r['year']]=reg_by_age[ag].get(r['year'],0)+r[ag]
        if r['region']:
            reg_by_region[r['region']][r['year']]=reg_by_region[r['region']].get(r['year'],0)+r['total']
    
    reg_cum={};c=0
    for y in actual_years:
        c+=reg_per_year.get(y,0);reg_cum[y]=c
    
    # === ACTIONS: cumulative ===
    act_per_year={}
    for r in pd_rows:
        if r['year']<=2025:
            act_per_year[r['year']]=act_per_year.get(r['year'],0)+r['actions']
    act_cum={};c=0
    for y in actual_years:
        c+=act_per_year.get(y,0);act_cum[y]=c
    
    # === FORECASTS (on cumulative data) ===
    vol_fc=forecast(vol_cum,forecast_years,2025)
    reg_fc=forecast(reg_cum,forecast_years,2025)
    act_fc=forecast(act_cum,forecast_years,2025)
    
    # Growth rates (per-year)
    growth=[]
    for i in range(1,len(actual_years)):
        prev=vol_per_year[actual_years[i-1]];curr=vol_per_year[actual_years[i]]
        growth.append(round((curr-prev)/prev*100,1) if prev>0 else 0)
    
    # Registration by age cumulative
    age_groups=['0-13','14-17','18-24','25-35','36-55','55+']
    reg_age_cum={}
    for ag in age_groups:
        cum_dict={};c=0
        for y in actual_years:
            c+=reg_by_age[ag].get(y,0);cum_dict[y]=c
        reg_age_cum[ag]=cum_dict
    
    # PD analytics per year (not cumulative, for action breakdowns)
    pd_by_year_action=defaultdict(lambda:defaultdict(int))
    pd_by_year_age=defaultdict(lambda:defaultdict(int))
    all_actions=sorted(set(r['action'] for r in pd_rows if r['action']))
    for r in pd_rows:
        if r['action']:pd_by_year_action[r['action']][r['year']]+=r['active']
        if r['age']:pd_by_year_age[r['age']][r['year']]+=r['active']
    
    # Volunteer age forecasts (cumulative)
    pd_ages=sorted(set(r['age'] for r in pd_rows if r['age']))
    vol_age_fc={}
    for ag in pd_ages:
        combo={}
        for y in actual_years:
            by_reg=defaultdict(int)
            for r in pd_rows:
                if r['year']==y and r['age']==ag and r['year']<=2025:
                    key=r['region']
                    if r['active']>by_reg[key]:by_reg[key]=r['active']
            combo[y]=sum(by_reg.values())
        # make cumulative
        cum_d={};c=0
        for y in actual_years:
            c+=combo[y];cum_d[y]=c
        if len([v for v in cum_d.values() if v>0])>=3:
            vol_age_fc[ag]=forecast(cum_d,forecast_years,2025)
    
    # Top regions (cumulative forecast)
    region_forecasts={}
    for reg,yd in reg_by_region.items():
        cum_d={};c=0
        for y in actual_years:
            c+=yd.get(y,0);cum_d[y]=c
        if len([v for v in cum_d.values() if v>0])>=3:
            fc=forecast(cum_d,forecast_years,2025)
            region_forecasts[reg]=fc['values'][forecast_years.index(2030)]
    top_regions=sorted(region_forecasts.items(),key=lambda x:-x[1])[:15]
    
    # Top actions
    action_forecasts={}
    for act,yd in pd_by_year_action.items():
        cum_d={};c=0
        for y in actual_years:
            c+=yd.get(y,0);cum_d[y]=c
        if len([v for v in cum_d.values() if v>0])>=3:
            fc=forecast(cum_d,forecast_years,2025)
            action_forecasts[act]=fc['values'][forecast_years.index(2030)]
    top_actions=sorted(action_forecasts.items(),key=lambda x:-x[1])[:10]
    
    # Raw cube
    pd_regions=sorted(set(r['region'] for r in pd_rows if r['region']))
    pd_actions=sorted(set(r['action'] for r in pd_rows if r['action']))
    pd_years=sorted(set(r['year'] for r in pd_rows))
    ri={r:i for i,r in enumerate(pd_regions)}
    ai={a:i for i,a in enumerate(pd_actions)}
    gi={a:i for i,a in enumerate(pd_ages)}
    yi={y:i for i,y in enumerate(pd_years)}
    cube_rows=[]
    for r in pd_rows:
        if not r['region'] or not r['action'] or not r['age']:continue
        yr,reg,act,age=r['year'],r['region'],r['action'],r['age']
        if yr not in yi or reg not in ri or act not in ai or age not in gi:continue
        cube_rows.append([yi[yr],ri[reg],ai[act],gi[age],r['active'],r['actions']])
    
    pop_2025=POPULATION.get(2025,142.8)*1e6
    fc_2030=vol_fc['values'][forecast_years.index(2030)]
    pop_2030=POPULATION.get(2030,139.3)*1e6
    
    data={
        'forecast_years':forecast_years,
        'actual_years':actual_years,
        'age_groups':age_groups,
        'pd_ages':pd_ages,
        'summary':{
            'volunteers_cumulative_2025':vol_cum[2025],
            'registrations_cumulative_2025':reg_cum[2025],
            'actions_cumulative_2025':act_cum[2025],
            'volunteers_per_year_2025':vol_per_year[2025],
            'num_regions':len(set(r['region'] for r in regi_rows if r['region'])),
            'forecast_2030':fc_2030,
            'penetration_2025_pct':round((vol_cum[2025]/pop_2025)*100,2),
            'penetration_2030_pct':round((fc_2030/pop_2030)*100,2),
            'population_2025':round(POPULATION.get(2025,142.8),1),
            'population_2030':round(POPULATION.get(2030,139.3),1),
        },
        'national':{
            'volunteers_cumulative':[vol_cum[y] for y in actual_years],
            'volunteers_per_year':[vol_per_year[y] for y in actual_years],
            'volunteer_cum_fc':vol_fc,
            'growth_rates_pct':growth,
        },
        'actions':{
            'cumulative':[act_cum[y] for y in actual_years],
            'per_year':[act_per_year.get(y,0) for y in actual_years],
            'cum_fc':act_fc,
        },
        'registrations':{
            'cumulative':[reg_cum[y] for y in actual_years],
            'per_year':[reg_per_year.get(y,0) for y in actual_years],
            'cum_fc':reg_fc,
            'by_age_cum':{ag:[reg_age_cum[ag][y] for y in actual_years] for ag in age_groups},
        },
        'pd_analytics':{
            'by_year_action':{a:dict(pd_by_year_action[a]) for a in all_actions},
            'by_year_age':{a:dict(pd_by_year_age[a]) for a in pd_ages},
        },
        'vol_age_forecasts':vol_age_fc,
        'top_region_names':[r[0] for r in top_regions],
        'top_actions':{'names':[a[0] for a in top_actions]},
        'population':POPULATION,
        'raw_cube':{'years':pd_years,'regions':pd_regions,'actions':pd_actions,'ages':pd_ages,'rows':cube_rows},
    }
    
    out='/home/v/Документы/rabot_dobr1/forecast_data_new.json'
    with open(out,'w',encoding='utf-8') as f:json.dump(data,f,ensure_ascii=False)
    
    s=data['summary']
    print(f'Волонтёров кумулятивно 2025: {s["volunteers_cumulative_2025"]:,}')
    print(f'Регистраций кумулятивно 2025: {s["registrations_cumulative_2025"]:,}')
    print(f'Действий кумулятивно 2025: {s["actions_cumulative_2025"]:,}')
    print(f'Волонтёров за 2025: {s["volunteers_per_year_2025"]:,}')
    print(f'Прогноз волонтёров 2030: {s["forecast_2030"]:,}')
    print(f'Регионов: {s["num_regions"]}')
    print(f'Проникновение 2025: {s["penetration_2025_pct"]}%')

if __name__=='__main__':main()
