#!/usr/bin/env python3
"""
Генератор обновлённого дашборда ДОБРО с данными Жмурко (2016+).
Парсит CSV, строит forecast data JSON, генерирует standalone HTML.
"""
import csv
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

# === Parse CSVs ===
def parse_pd_csv(path):
    """Parse жмурко_ПД (actions) CSV"""
    rows = []
    with open(path, encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for r in reader:
            year = int(r['year'])
            if year < 2016:
                continue
            rows.append({
                'year': year,
                'action': r['fa.action_name'].strip(),
                'region': r['region_name'].strip(),
                'age': r['age_group'].strip(),
                'active': int(r['active_count']),
                'actions': int(r['actions_count']),
            })
    return rows

def parse_regi_csv(path):
    """Parse жмурко_реги (registrations) CSV"""
    rows = []
    with open(path, encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for r in reader:
            year = int(r['Год'])
            if year < 2016:
                continue
            region = r['Регион'].strip()
            rows.append({
                'year': year,
                'region': region,
                'total': int(r['Всего регистраций']),
                'age_0_13': int(r['0-13']),
                'age_14_17': int(r['14-17']),
                'age_18_24': int(r['18-24']),
                'age_25_35': int(r['25-35']),
                'age_36_55': int(r['36-55']),
                'age_55plus': int(r['55+']),
            })
    return rows

# === Forecast ===
def poly_fit(xs, ys, degree=2):
    """Polynomial least-squares fit"""
    n = len(xs)
    d = min(degree, n - 1)
    size = d + 1
    # Build normal equations
    ATA = [[0.0]*size for _ in range(size)]
    ATy = [0.0]*size
    for i in range(n):
        x, y = xs[i], ys[i]
        for j in range(size):
            xj = x**j
            ATy[j] += xj * y
            for k in range(size):
                ATA[j][k] += xj * x**k
    # Gauss elimination
    M = [row[:] + [ATy[i]] for i, row in enumerate(ATA)]
    for col in range(size):
        max_row = col
        for row in range(col+1, size):
            if abs(M[row][col]) > abs(M[max_row][col]):
                max_row = row
        M[col], M[max_row] = M[max_row], M[col]
        if abs(M[col][col]) < 1e-12:
            continue
        for row in range(col+1, size):
            f = M[row][col] / M[col][col]
            for j in range(col, size+1):
                M[row][j] -= f * M[col][j]
    coeffs = [0.0]*size
    for i in range(size-1, -1, -1):
        coeffs[i] = M[i][size]
        for j in range(i+1, size):
            coeffs[i] -= M[i][j] * coeffs[j]
        coeffs[i] /= M[i][i]
    return coeffs

def poly_eval(coeffs, x):
    return sum(c * x**i for i, c in enumerate(coeffs))

def forecast(yearly_data, forecast_years, train_up_to=2025):
    """Build forecast with CI. Only train on years <= train_up_to"""
    train_xs = [y for y in sorted(yearly_data.keys()) if y <= train_up_to]
    train_ys = [yearly_data[y] for y in train_xs]
    if len(train_xs) < 2:
        return {'values': [0]*len(forecast_years), 'upper': [0]*len(forecast_years), 'lower': [0]*len(forecast_years)}
    
    coeffs = poly_fit(train_xs, train_ys, 2)
    fitted = [poly_eval(coeffs, x) for x in train_xs]
    residuals = [y - f for y, f in zip(train_ys, fitted)]
    rmse = math.sqrt(sum(r**2 for r in residuals) / len(residuals))
    last_train = max(train_xs)
    
    values, upper, lower = [], [], []
    for y in forecast_years:
        val = max(0, poly_eval(coeffs, y))
        ahead = max(0, y - last_train)
        margin = rmse * (1 + 0.3 * ahead) * 1.96 + val * 0.04 * ahead
        values.append(round(val))
        upper.append(round(val + margin))
        lower.append(round(max(0, val - margin)))
    return {'values': values, 'upper': upper, 'lower': lower}

# === Build Data JSON ===
def build_data(pd_rows, regi_rows):
    # Get metadata
    all_years = sorted(set(r['year'] for r in pd_rows))
    actual_years = [y for y in all_years if y <= 2026]
    forecast_years = list(range(min(all_years), 2031))
    
    regions = sorted(set(r['region'] for r in pd_rows if r['region']))
    actions = sorted(set(r['action'] for r in pd_rows if r['action']))
    ages = ['0-13', '14-17', '18-24', '25-35', '36-54', '55-64']
    
    # National aggregates by year
    nat_active = defaultdict(int)
    nat_actions = defaultdict(int)
    nat_by_age = {ag: defaultdict(int) for ag in ages}
    nat_by_age['55+'] = defaultdict(int)  # registration data uses 55+
    
    for r in pd_rows:
        nat_active[r['year']] += r['active']
        nat_actions[r['year']] += r['actions']
        if r['age'] in nat_by_age:
            nat_by_age[r['age']][r['year']] += r['active']
    
    # National registrations
    reg_total = defaultdict(int)
    reg_by_age = {'0-13': defaultdict(int), '14-17': defaultdict(int), 
                  '18-24': defaultdict(int), '25-35': defaultdict(int),
                  '36-55': defaultdict(int), '55+': defaultdict(int)}
    
    for r in regi_rows:
        if r['region']:  # skip national totals (empty region)
            reg_total[r['year']] += r['total']
            for ag_key, csv_key in [('0-13','age_0_13'),('14-17','age_14_17'),('18-24','age_18_24'),
                                     ('25-35','age_25_35'),('36-55','age_36_55'),('55+','age_55plus')]:
                reg_by_age[ag_key][r['year']] += r[csv_key]
        else:
            # National total row - use it
            pass
    
    # If no regional data summed, use national rows
    for r in regi_rows:
        if not r['region']:
            for ag_key, csv_key in [('0-13','age_0_13'),('14-17','age_14_17'),('18-24','age_18_24'),
                                     ('25-35','age_25_35'),('36-55','age_36_55'),('55+','age_55plus')]:
                if r['year'] not in reg_by_age[ag_key] or reg_by_age[ag_key][r['year']] == 0:
                    reg_by_age[ag_key][r['year']] = r[csv_key]
            if r['year'] not in reg_total or reg_total[r['year']] == 0:
                reg_total[r['year']] = r['total']
    
    # Build forecasts (train on <=2025 only)
    active_fc = forecast(nat_active, forecast_years, 2025)
    actions_fc = forecast(nat_actions, forecast_years, 2025)
    reg_fc = forecast(reg_total, forecast_years, 2025)
    
    # Age forecasts
    age_fc = {}
    for ag in ages:
        d = {y: nat_by_age[ag].get(y, 0) for y in all_years if y <= 2025}
        if sum(d.values()) > 0:
            age_fc[ag] = forecast(d, forecast_years, 2025)
        else:
            age_fc[ag] = {'values': [0]*len(forecast_years), 'upper': [0]*len(forecast_years), 'lower': [0]*len(forecast_years)}
    
    # Registration age forecasts
    reg_age_fc = {}
    for ag in ['0-13', '14-17', '18-24', '25-35', '36-55', '55+']:
        d = {y: reg_by_age[ag].get(y, 0) for y in all_years if y <= 2025}
        reg_age_fc[ag] = forecast(d, forecast_years, 2025)
    
    # Growth rates
    growth = []
    for i in range(1, len(actual_years)):
        prev = nat_active.get(actual_years[i-1], 0)
        curr = nat_active.get(actual_years[i], 0)
        growth.append(round((curr-prev)/prev*100, 1) if prev > 0 else 0)
    
    # Top regions by 2030 forecast
    region_yearly = defaultdict(lambda: defaultdict(int))
    for r in pd_rows:
        if r['region']:
            region_yearly[r['region']][r['year']] += r['active']
    
    region_forecasts = {}
    for reg, yd in region_yearly.items():
        train_d = {y: v for y, v in yd.items() if y <= 2025}
        if sum(train_d.values()) > 100:
            fc = forecast(train_d, forecast_years, 2025)
            idx2030 = forecast_years.index(2030)
            region_forecasts[reg] = fc['values'][idx2030]
    
    top_regions = sorted(region_forecasts.items(), key=lambda x: -x[1])[:15]
    
    # Top actions by 2030
    action_yearly = defaultdict(lambda: defaultdict(int))
    for r in pd_rows:
        if r['action']:
            action_yearly[r['action']][r['year']] += r['active']
    
    action_forecasts = {}
    for act, yd in action_yearly.items():
        train_d = {y: v for y, v in yd.items() if y <= 2025}
        if sum(train_d.values()) > 100:
            fc = forecast(train_d, forecast_years, 2025)
            idx2030 = forecast_years.index(2030)
            action_forecasts[act] = fc['values'][idx2030]
    
    top_actions = sorted(action_forecasts.items(), key=lambda x: -x[1])[:10]
    
    # Build raw_cube for filters
    region_list = sorted(set(r['region'] for r in pd_rows if r['region']))
    action_list = sorted(set(r['action'] for r in pd_rows if r['action']))
    age_list = [a for a in ages if a]
    
    region_idx = {r: i for i, r in enumerate(region_list)}
    action_idx = {a: i for i, a in enumerate(action_list)}
    age_idx_map = {a: i for i, a in enumerate(age_list)}
    year_idx = {y: i for i, y in enumerate(all_years)}
    
    cube_rows = []
    for r in pd_rows:
        if not r['region'] or not r['action'] or not r['age']:
            continue
        yi = year_idx.get(r['year'])
        ri = region_idx.get(r['region'])
        ai = action_idx.get(r['action'])
        gi = age_idx_map.get(r['age'])
        if yi is not None and ri is not None and ai is not None and gi is not None:
            cube_rows.append([yi, ri, ai, gi, r['active'], r['actions']])
    
    # Registrations by region
    regi_by_region = defaultdict(list)
    for r in regi_rows:
        if r['region']:
            regi_by_region[r['region']].append(r)
    
    # Summary KPIs
    vol_2025 = nat_active.get(2025, 0)
    vol_2026 = nat_active.get(2026, 0)
    fc2030 = active_fc['values'][forecast_years.index(2030)]
    
    data = {
        'forecast_years': forecast_years,
        'actual_years': actual_years,
        'age_groups': ages,
        'summary': {
            'total_volunteers_2025': vol_2025,
            'total_volunteers_2026': vol_2026,
            'forecast_2030': fc2030,
            'total_actions_2025': nat_actions.get(2025, 0),
            'num_regions': len(region_list),
        },
        'national': {
            'actual_active': [nat_active.get(y, 0) for y in actual_years],
            'actual_actions': [nat_actions.get(y, 0) for y in actual_years],
            'active_poly': active_fc,
            'actions_poly': actions_fc,
            'growth_rates_pct': growth,
            'by_age': age_fc,
        },
        'registrations': {
            'historical_years': sorted(reg_total.keys()),
            'historical_values': [reg_total.get(y, 0) for y in sorted(reg_total.keys())],
            'by_age': reg_by_age,
            'forecast': reg_fc,
            'age_forecasts': reg_age_fc,
        },
        'top_region_names': [r[0] for r in top_regions],
        'top_actions': {
            'names': [a[0] for a in top_actions],
        },
        'raw_cube': {
            'years': all_years,
            'regions': region_list,
            'actions': action_list,
            'ages': age_list,
            'rows': cube_rows,
        },
    }
    
    return data

def main():
    pd_path = '/tmp/жмурко_ПД_utf8.csv'
    regi_path = '/tmp/жмурко_реги_utf8.csv'
    
    print("Parsing PD CSV...")
    pd_rows = parse_pd_csv(pd_path)
    print(f"  {len(pd_rows)} rows (2016+)")
    
    print("Parsing registrations CSV...")
    regi_rows = parse_regi_csv(regi_path)
    print(f"  {len(regi_rows)} rows (2016+)")
    
    print("Building forecast data...")
    data = build_data(pd_rows, regi_rows)
    
    # Save JSON
    out_json = '/home/v/Документы/rabot_dobr1/forecast_data_new.json'
    with open(out_json, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
    print(f"Saved {out_json}")
    
    # Print summary
    s = data['summary']
    print(f"\nSummary:")
    print(f"  Volunteers 2025: {s['total_volunteers_2025']:,}")
    print(f"  Volunteers 2026: {s['total_volunteers_2026']:,}")
    print(f"  Forecast 2030: {s['forecast_2030']:,}")
    print(f"  Actions 2025: {s['total_actions_2025']:,}")
    print(f"  Regions: {s['num_regions']}")
    print(f"  Years: {data['actual_years']}")
    print(f"  Forecast years: {data['forecast_years']}")

if __name__ == '__main__':
    main()
