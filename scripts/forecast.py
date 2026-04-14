"""
Volunteer Forecasting Engine v3 — Demographic-adjusted
Uses penetration rate model: Volunteers = PenetrationRate × Population

Sources:
  - Volunteer data: DOBRO.RF platform export
  - Demographics: Rosstat estimates & projections (rosstat_demographics.py)
"""
import pandas as pd
import numpy as np
import json
import warnings
warnings.filterwarnings('ignore')

from rosstat_demographics import (
    REGION_POPULATION,
    AGE_GROUP_SHARES,
    NATIONAL_POPULATION,
    get_region_population_series,
    get_national_population_series,
    get_age_group_population_series,
)

CSV_PATH = r'e:\rabot_dobr\exporter-yc-prod_1dc154f83b0f42caa6f18b2f04a75b3b.csv'
OUTPUT_PATH = r'e:\rabot_dobr\forecast_data.json'
FORECAST_YEARS = list(range(2020, 2031))
AGE_ORDER = ['0-13', '14-17', '18-24', '25-35', '36-54', '55-64', '65+']




def poly_forecast_rate(years, rates, forecast_years, degree=2):
    """Fit polynomial to penetration rates."""
    years = np.array(years, dtype=float)
    rates = np.array(rates, dtype=float)

    # Handle edge cases
    valid = ~np.isnan(rates)
    if valid.sum() < 2:
        return {
            'values': [0.0] * len(forecast_years),
            'upper': [0.0] * len(forecast_years),
            'lower': [0.0] * len(forecast_years),
        }

    years_v = years[valid]
    rates_v = rates[valid]

    deg = min(degree, len(years_v) - 1)
    coeffs = np.polyfit(years_v, rates_v, deg)
    poly = np.poly1d(coeffs)

    # RMSE for confidence interval
    fitted = poly(years_v)
    residuals = rates_v - fitted
    rmse = np.sqrt(np.mean(residuals ** 2)) if len(residuals) > 0 else 0

    last_year = float(years_v[-1])
    result_values = []
    upper_band = []
    lower_band = []

    for y in forecast_years:
        raw_rate = poly(y)
        rate = max(0, raw_rate)

        yrs_ahead = max(0, y - last_year)
        margin = rmse * (1 + 0.3 * yrs_ahead) * 1.96
        pct_margin = rate * 0.04 * yrs_ahead
        total_margin = margin + pct_margin

        upper = max(0, raw_rate + total_margin)
        lower = max(0, raw_rate - total_margin)

        result_values.append(round(rate, 6))
        upper_band.append(round(upper, 6))
        lower_band.append(round(lower, 6))

    return {
        'values': result_values,
        'upper': upper_band,
        'lower': lower_band,
    }


def rate_to_absolute(rate_forecast, population_series):
    """Convert penetration rate forecast to absolute numbers."""
    return {
        'values': [round(r * p * 1000) for r, p in zip(rate_forecast['values'], population_series)],
        'upper': [round(r * p * 1000) for r, p in zip(rate_forecast['upper'], population_series)],
        'lower': [round(r * p * 1000) for r, p in zip(rate_forecast['lower'], population_series)],
    }


def poly_forecast_absolute(years, values, forecast_years, degree=2):
    """Legacy: direct polynomial forecast for items without population basis (e.g., actions)."""
    years = np.array(years, dtype=float)
    values = np.array(values, dtype=float)

    if len(years) < 2:
        return {
            'values': [0] * len(forecast_years),
            'upper': [0] * len(forecast_years),
            'lower': [0] * len(forecast_years),
        }

    deg = min(degree, len(years) - 1)
    coeffs = np.polyfit(years, values, deg)
    poly = np.poly1d(coeffs)

    fitted = poly(years)
    residuals = values - fitted
    rmse = np.sqrt(np.mean(residuals ** 2)) if len(residuals) > 0 else 0

    last_year = float(years[-1])
    result_values = []
    upper_band = []
    lower_band = []

    for y in forecast_years:
        val = max(0, poly(y))
        yrs_ahead = max(0, y - last_year)
        margin = rmse * (1 + 0.3 * yrs_ahead) * 1.96
        pct_margin = val * 0.04 * yrs_ahead
        total_margin = margin + pct_margin

        result_values.append(round(val))
        upper_band.append(round(val + total_margin))
        lower_band.append(round(max(0, val - total_margin)))

    return {
        'values': result_values,
        'upper': upper_band,
        'lower': lower_band,
    }


def compute_growth_rates(values):
    """YoY growth rates in percent."""
    rates = []
    for i in range(1, len(values)):
        if values[i-1] > 0:
            rates.append(round((values[i] - values[i-1]) / values[i-1] * 100, 1))
        else:
            rates.append(None)
    return rates


def main():
    print("Loading data...")
    df = pd.read_csv(CSV_PATH, sep=';')
    print(f"  {len(df)} rows, {df['region_name'].nunique()} regions, years {df['year'].min()}-{df['year'].max()}")

    df = df.dropna(subset=['region_name'])
    all_years = sorted(df['year'].unique())
    all_regions = sorted(df['region_name'].unique())

    # ================================================================
    # 1. NATIONAL AGGREGATE — PENETRATION RATE MODEL
    # ================================================================
    print("Computing national forecasts (penetration rate model)...")
    yearly_active = df.groupby('year')['active_count'].sum()
    yearly_actions = df.groupby('year')['actions_count'].sum()

    nat_active_vals = [int(yearly_active.get(y, 0)) for y in all_years]
    nat_actions_vals = [int(yearly_actions.get(y, 0)) for y in all_years]

    # National population (thousands -> actual: multiply by 1000)
    nat_pop = get_national_population_series(FORECAST_YEARS)
    nat_pop_actual = get_national_population_series(all_years)

    # Compute penetration rates for actual years
    nat_penetration = [v / (p * 1000) if p else 0 for v, p in zip(nat_active_vals, nat_pop_actual)]

    print(f"  Penetration 2020: {nat_penetration[0]*100:.2f}%")
    print(f"  Penetration {all_years[-1]}: {nat_penetration[-1]*100:.2f}%")

    # Forecast penetration rate with logistic cap
    nat_rate_fc = poly_forecast_rate(all_years, nat_penetration, FORECAST_YEARS)

    # Convert to absolute numbers
    nat_active_fc = rate_to_absolute(nat_rate_fc, nat_pop)

    # Actions: use absolute forecast (no population basis for actions)
    nat_actions_fc = poly_forecast_absolute(all_years, nat_actions_vals, FORECAST_YEARS)

    growth_rates = compute_growth_rates(nat_active_vals)

    # National by age — penetration rate per age group
    nat_age = {}
    for ag in AGE_ORDER:
        ag_data = df[df['age_group'] == ag].groupby('year')['active_count'].sum()
        ag_vals = [int(ag_data.get(y, 0)) for y in all_years]

        # Age group population
        ag_pop_actual = get_age_group_population_series(ag, all_years)
        ag_pop_forecast = get_age_group_population_series(ag, FORECAST_YEARS)

        # Penetration per age group
        ag_rates = []
        for v, p in zip(ag_vals, ag_pop_actual):
            if p and p > 0:
                ag_rates.append(v / (p * 1000))
            else:
                ag_rates.append(0.0)

        ag_rate_fc = poly_forecast_rate(all_years, ag_rates, FORECAST_YEARS)
        nat_age[ag] = rate_to_absolute(ag_rate_fc, ag_pop_forecast)

    national = {
        'actual_years': list(map(int, all_years)),
        'actual_active': nat_active_vals,
        'actual_actions': nat_actions_vals,
        'growth_rates_pct': growth_rates,
        'forecast_years': FORECAST_YEARS,
        'active_poly': nat_active_fc,
        'penetration_rate': nat_rate_fc,
        'actions_poly': nat_actions_fc,
        'by_age': nat_age,
        'population': [int(p) for p in nat_pop],
    }

    # ================================================================
    # 2. PER-REGION FORECASTS — PENETRATION RATE MODEL
    # ================================================================
    print("Computing per-region forecasts (penetration rate model)...")
    regions_data = {}

    for i, reg in enumerate(all_regions):
        if (i + 1) % 10 == 0:
            print(f"  {i+1}/{len(all_regions)}: {reg}")

        reg_df = df[df['region_name'] == reg]

        # Volunteer counts
        reg_active = reg_df.groupby('year')['active_count'].sum()
        reg_actions = reg_df.groupby('year')['actions_count'].sum()

        act_vals = [int(reg_active.get(y, 0)) for y in all_years]
        actions_vals = [int(reg_actions.get(y, 0)) for y in all_years]

        # Regional population
        reg_pop_actual = get_region_population_series(reg, all_years)
        reg_pop_forecast = get_region_population_series(reg, FORECAST_YEARS)

        # If no demographic data for this region, use absolute forecast as fallback
        has_demo = reg in REGION_POPULATION and all(p is not None for p in reg_pop_actual)

        if has_demo:
            # Penetration rate model
            reg_penetration = [v / (p * 1000) if p and p > 0 else 0 for v, p in zip(act_vals, reg_pop_actual)]
            reg_rate_fc = poly_forecast_rate(all_years, reg_penetration, FORECAST_YEARS)
            act_fc = rate_to_absolute(reg_rate_fc, reg_pop_forecast)
        else:
            # Fallback to absolute polynomial
            act_fc = poly_forecast_absolute(all_years, act_vals, FORECAST_YEARS)
            reg_rate_fc = None

        # Actions: absolute forecast
        actions_fc = poly_forecast_absolute(all_years, actions_vals, FORECAST_YEARS)

        # By age group — use national age distribution applied to regional population
        reg_age = {}
        for ag in AGE_ORDER:
            ag_data = reg_df[reg_df['age_group'] == ag].groupby('year')['active_count'].sum()
            ag_vals = [int(ag_data.get(y, 0)) for y in all_years]

            if has_demo:
                # Regional age group population = regional total × national age share
                reg_ag_pop_actual = []
                for y, rp in zip(all_years, reg_pop_actual):
                    share = AGE_GROUP_SHARES.get(ag, {}).get(y, 0)
                    reg_ag_pop_actual.append(rp * share if rp else 0)

                reg_ag_pop_forecast = []
                for y, rp in zip(FORECAST_YEARS, reg_pop_forecast):
                    share = AGE_GROUP_SHARES.get(ag, {}).get(y, 0)
                    reg_ag_pop_forecast.append(rp * share if rp else 0)

                # Penetration per age group
                ag_rates = []
                for v, p in zip(ag_vals, reg_ag_pop_actual):
                    if p and p > 0:
                        ag_rates.append(v / (p * 1000))
                    else:
                        ag_rates.append(0.0)

                ag_rate_fc = poly_forecast_rate(all_years, ag_rates, FORECAST_YEARS)
                reg_age[ag] = rate_to_absolute(ag_rate_fc, reg_ag_pop_forecast)
            else:
                reg_age[ag] = poly_forecast_absolute(all_years, ag_vals, FORECAST_YEARS)

        regions_data[reg] = {
            'actual_active': act_vals,
            'actual_actions': actions_vals,
            'active_poly': act_fc,
            'actions_poly': actions_fc,
            'by_age': reg_age,
            'population': [int(p) if p else 0 for p in reg_pop_forecast],
            'penetration_rate': reg_rate_fc,
        }

    # ================================================================
    # 3. TOP LISTS FOR OVERVIEW
    # ================================================================
    print("Computing rankings...")
    region_2030 = [(reg, regions_data[reg]['active_poly']['values'][-1]) for reg in all_regions]
    region_2030.sort(key=lambda x: x[1], reverse=True)
    top_region_names = [r[0] for r in region_2030[:15]]

    # Top actions by total
    by_action = df.groupby(['year', 'fa.action_name'])['active_count'].sum().unstack(fill_value=0)
    top_actions = by_action.sum().nlargest(10).index.tolist()
    action_forecasts = {}
    for act in top_actions:
        vals = [int(by_action[act].get(y, 0)) for y in all_years]
        action_forecasts[act] = poly_forecast_absolute(all_years, vals, FORECAST_YEARS)

    # ================================================================
    # 4. SUMMARY STATS
    # ================================================================
    last_pen = nat_penetration[-1] * 100
    fc_pen = nat_rate_fc['values'][-1] * 100

    summary = {
        'total_volunteers_2025': nat_active_vals[-1],
        'forecast_2030': nat_active_fc['values'][-1],
        'total_actions_2025': nat_actions_vals[-1],
        'avg_growth_pct': round(np.mean([g for g in growth_rates if g is not None]), 1),
        'num_regions': len(all_regions),
        'num_actions': int(df['fa.action_name'].nunique()),
        'num_rows': len(df),
        'penetration_2025_pct': round(last_pen, 2),
        'penetration_2030_pct': round(fc_pen, 2),
        'population_2025': NATIONAL_POPULATION.get(2025, 0),
        'population_2030': NATIONAL_POPULATION.get(2030, 0),
    }

    # ================================================================
    # 5. REGISTRATIONS FORECAST
    # ================================================================
    print("Forecasting registrations...")
    reg_df = pd.read_csv(r'e:\\rabot_dobr\\Регистрации — Линейчатая диаграмма_2026-03-31_19-12-59.csv', sep=';')
    # Sum all age groups per year (columns from 1 to end)
    reg_years = reg_df['Год'].tolist()
    reg_totals = reg_df.iloc[:, 1:].sum(axis=1).tolist()
    
    # Calculate penetration rate of registrations
    reg_rates = []
    for y, count in zip(reg_years, reg_totals):
        pop = NATIONAL_POPULATION.get(y, 146000) * 1000  # population in individuals
        reg_rates.append(count / pop)
        
    # Forecast registration penetration rate to 2030
    reg_rate_fc = poly_forecast_rate(reg_years, reg_rates, FORECAST_YEARS)
    
    # Convert forecasted rates back to absolute values using 2030 population projection
    reg_pop_series = get_national_population_series(FORECAST_YEARS)
    reg_absolute_fc = rate_to_absolute(reg_rate_fc, reg_pop_series)

    registrations_data = {
        'historical_years': reg_years,
        'historical_values': reg_totals,
        'forecast': reg_absolute_fc
    }

    # ================================================================
    # 7. RAW DATA CUBE FOR CLIENT-SIDE FILTERING
    # ================================================================
    print("Building raw data cube for filters...")
    cube = df.groupby(['year','region_name','fa.action_name','age_group']).agg(
        active=('active_count','sum'),
        actions=('actions_count','sum')
    ).reset_index()

    cube_years = sorted([int(y) for y in cube['year'].unique()])
    cube_regions = sorted(cube['region_name'].unique().tolist())
    cube_actions = sorted(cube['fa.action_name'].unique().tolist())
    cube_ages = sorted(cube['age_group'].unique().tolist())

    yi_map = {v:i for i,v in enumerate(cube_years)}
    ri_map = {v:i for i,v in enumerate(cube_regions)}
    ai_map = {v:i for i,v in enumerate(cube_actions)}
    gi_map = {v:i for i,v in enumerate(cube_ages)}

    cube['yi'] = cube['year'].map(yi_map)
    cube['ri'] = cube['region_name'].map(ri_map)
    cube['ai'] = cube['fa.action_name'].map(ai_map)
    cube['gi'] = cube['age_group'].map(gi_map)

    raw_cube = {
        'years': cube_years,
        'regions': cube_regions,
        'actions': cube_actions,
        'ages': cube_ages,
        'rows': cube[['yi','ri','ai','gi','active','actions']].values.tolist()
    }
    print(f"  Cube: {len(raw_cube['rows'])} rows, {len(cube_years)} years × {len(cube_regions)} regions × {len(cube_actions)} actions × {len(cube_ages)} ages")

    # ================================================================
    # 8. ASSEMBLE & SAVE
    # ================================================================
    result = {
        'summary': summary,
        'national': national,
        'regions': regions_data,
        'region_names': all_regions,
        'top_region_names': top_region_names,
        'top_actions': {
            'names': top_actions,
            'forecasts': action_forecasts,
        },
        'registrations': registrations_data,
        'raw_cube': raw_cube,
        'age_groups': AGE_ORDER,
        'forecast_years': FORECAST_YEARS,
        'actual_years': list(map(int, all_years)),
    }

    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False)

    import os
    size_mb = os.path.getsize(OUTPUT_PATH) / 1024 / 1024
    print(f"\nSaved to {OUTPUT_PATH} ({size_mb:.1f} MB)")
    print(f"Summary:")
    print(f"  Volunteers 2025:     {summary['total_volunteers_2025']:,}")
    print(f"  Forecast 2030:       {summary['forecast_2030']:,}")
    print(f"  Penetration 2025:    {summary['penetration_2025_pct']}%")
    print(f"  Penetration 2030:    {summary['penetration_2030_pct']}%")
    print(f"  Population 2025:     {summary['population_2025']:,} тыс.")
    print(f"  Population 2030:     {summary['population_2030']:,} тыс.")
    print(f"  Avg growth:          {summary['avg_growth_pct']}%")
    print(f"  Regions:             {summary['num_regions']}")


if __name__ == '__main__':
    main()
