import os

HTML_FILE = r'e:\rabot_dobr\index.html'
CSS_FILE = r'e:\rabot_dobr\styles.css'
JS_FILE = r'e:\rabot_dobr\dashboard.js'
DATA_FILE = r'e:\rabot_dobr\forecast_data.json'
OUT_FILE = r'e:\rabot_dobr\dashboard_standalone.html'

def build():
    try:
        with open(HTML_FILE, 'r', encoding='utf-8') as f:
            html = f.read()

        with open(CSS_FILE, 'r', encoding='utf-8') as f:
            css = f.read()

        with open(JS_FILE, 'r', encoding='utf-8') as f:
            js = f.read()

        with open(DATA_FILE, 'r', encoding='utf-8') as f:
            data = f.read()

        # Replace styles
        html = html.replace('<link rel="stylesheet" href="styles.css">', f'<style>\n{css}\n</style>')

        # Replace JS
        inject_script = f"""
<script>
window.INJECTED_DATA = {data};
</script>
<script>
{js}
</script>
"""
        html = html.replace('<script src="dashboard.js"></script>', inject_script)

        with open(OUT_FILE, 'w', encoding='utf-8') as f:
            f.write(html)
            
        print(f"Successfully created standalone dashboard: {OUT_FILE}")
        size_mb = os.path.getsize(OUT_FILE) / (1024 * 1024)
        print(f"File size: {size_mb:.2f} MB")
        
    except Exception as e:
        print(f"Error building standalone dashboard: {e}")

if __name__ == '__main__':
    build()
