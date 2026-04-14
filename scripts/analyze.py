import pandas as pd
import numpy as np

df = pd.read_csv(r'e:\rabot_dobr\exporter-yc-prod_1dc154f83b0f42caa6f18b2f04a75b3b.csv', sep=';')
print('Shape:', df.shape)
print('Years:', sorted(df['year'].unique()))
print('Regions:', df['region_name'].nunique())
print('Actions:', df['fa.action_name'].nunique())
print('Age groups:', list(df['age_group'].unique()))
print()

yearly = df.groupby('year')['active_count'].sum()
print('Total active_count by year:')
print(yearly.to_string())
print()

yearly_actions = df.groupby('year')['actions_count'].sum()
print('Total actions_count by year:')
print(yearly_actions.to_string())
print()

# Top 10 regions by total active_count
top_regions = df.groupby('region_name')['active_count'].sum().nlargest(10)
print('Top 10 regions:')
print(top_regions.to_string())
print()

# By age group
by_age = df.groupby(['year', 'age_group'])['active_count'].sum().unstack(fill_value=0)
print('By age group per year:')
print(by_age.to_string())
