#!/usr/bin/env python3
"""
Refresh parasha and holiday schedule data in index.html.
Run biannually via GitHub Actions (Jan 1 and Jul 1).
Fetches ~18 months of data from Hebcal and updates the embedded JS.
"""

import urllib.request, json, re, sys
from datetime import date, timedelta
from collections import defaultdict

# ── Date range: today → 18 months ahead ─────────────────────────
today = date.today()
end   = date(today.year + (2 if today.month >= 7 else 1),
             today.month - 6 if today.month > 6 else today.month + 6,
             1) + timedelta(days=180)
# Simpler: just always fetch current year + next 2 years
start_str = today.isoformat()
end_str   = date(today.year + 2, 12, 31).isoformat()
print(f"Fetching {start_str} → {end_str}")

BOOK_MAP = {
    'Bereshit':'Genesis','Noach':'Genesis','Lech-Lecha':'Genesis','Vayera':'Genesis',
    'Chayei Sara':'Genesis','Toldot':'Genesis','Vayetzei':'Genesis','Vayishlach':'Genesis',
    'Vayeshev':'Genesis','Miketz':'Genesis','Vayigash':'Genesis','Vayechi':'Genesis',
    'Shemot':'Exodus','Vaera':'Exodus','Bo':'Exodus','Beshalach':'Exodus','Yitro':'Exodus',
    'Mishpatim':'Exodus','Terumah':'Exodus','Tetzaveh':'Exodus','Ki Tisa':'Exodus',
    'Vayakhel':'Exodus','Pekudei':'Exodus','Vayakhel-Pekudei':'Exodus',
    'Vayikra':'Leviticus','Tzav':'Leviticus','Shmini':'Leviticus','Tazria':'Leviticus',
    'Metzora':'Leviticus','Tazria-Metzora':'Leviticus','Achrei Mot':'Leviticus',
    'Kedoshim':'Leviticus','Achrei Mot-Kedoshim':'Leviticus','Emor':'Leviticus',
    'Behar':'Leviticus','Bechukotai':'Leviticus','Behar-Bechukotai':'Leviticus',
    'Bamidbar':'Numbers','Nasso':'Numbers','\u05d1\u05be\u05d4\u05e2\u05dc\u05d5\u05ea\u05db':'Numbers',
    'Beha\u2019alotcha':'Numbers','Sh\u2019lach':'Numbers','Korach':'Numbers',
    'Chukat':'Numbers','Balak':'Numbers','Chukat-Balak':'Numbers','Pinchas':'Numbers',
    'Matot':'Numbers','Masei':'Numbers','Matot-Masei':'Numbers',
    'Devarim':'Deuteronomy','Vaetchanan':'Deuteronomy','Eikev':'Deuteronomy',
    'Re\u2019eh':'Deuteronomy','Shoftim':'Deuteronomy','Ki Teitzei':'Deuteronomy',
    'Ki Tavo':'Deuteronomy','Nitzavim':'Deuteronomy','Vayeilech':'Deuteronomy',
    'Nitzavim-Vayeilech':'Deuteronomy','Ha\u2019azinu':'Deuteronomy',
    'Vezot Haberakhah':'Deuteronomy',
}

def fetch(url):
    with urllib.request.urlopen(url) as r:
        return json.loads(r.read())

def build_parasha_list(israel=False):
    i = '&i=on' if israel else ''
    items = []
    for year in range(today.year, today.year + 3):
        url = f"https://www.hebcal.com/hebcal?v=1&cfg=json&year={year}&maj=off&min=off&nx=off&mf=off&ss=off&mod=off&s=on&leyning=0{i}"
        data = fetch(url)
        items += [x for x in data.get('items',[]) if x.get('category')=='parashat']
    seen, result = set(), []
    for item in sorted(items, key=lambda x: x['date']):
        if item['date'] < start_str: continue
        name = item['title'].replace('Parashat ','').replace('Parashas ','')
        book = BOOK_MAP.get(name, 'Other')
        d = date.fromisoformat(item['date'])
        label = f"{name} · {d.strftime('%b %-d, %Y')}"
        key = item['date'] + name
        if key not in seen:
            seen.add(key)
            result.append({'name':name,'date':item['date'],'book':book,'label':label})
    return result

def build_holiday_data(israel=False):
    i = '&i=on' if israel else ''
    url = f"https://www.hebcal.com/hebcal?v=1&cfg=json&start={start_str}&end={end_str}&s=off&leyning=1&maj=on&min=off&mf=off&ss=off&mod=off{i}"
    data = fetch(url)
    holidays = []
    for item in data['items']:
        if item.get('category') != 'holiday': continue
        l = item.get('leyning', {})
        aliyot_keys = [k for k in l if k not in ('torah','haftarah','haftarah_sephardic','triennial')]
        if not aliyot_keys: continue
        holidays.append({'date': item['date'], 'title': item['title'], 'leyning': l})
    # Add YK Mincha for each YK date
    yk_dates = [h['date'] for h in holidays if h['title'] == 'Yom Kippur']
    for d in yk_dates:
        holidays.append({'date': d, 'title': 'Yom Kippur (Mincha)', 'leyning': {
            '1': 'Leviticus 18:1-18:21',
            '2': 'Leviticus 18:22-18:25',
            '3': 'Leviticus 18:26-18:30',
        }})
    holidays.sort(key=lambda x: (x['date'], x['title']))
    return {f"{h['date']}|{h['title']}": h['leyning'] for h in holidays}

print("Building parasha lists...")
pd = build_parasha_list(False)
pi = build_parasha_list(True)
print(f"  Diaspora: {len(pd)}, Israel: {len(pi)}")

print("Building holiday data...")
hd = build_holiday_data(False)
hi = build_holiday_data(True)
print(f"  Diaspora: {len(hd)}, Israel: {len(hi)}")

# ── Patch index.html ─────────────────────────────────────────────
with open('index.html') as f:
    html = f.read()

def replace_js_const(html, name, new_value_json):
    # Replace content of a specific key inside PARASHA_LISTS or HOLIDAY_DATA
    pattern = rf'({re.escape(name)}:\s*)(\[.*?\]|\{{.*?\}})(,?\n)'
    replacement = rf'\g<1>{new_value_json}\g<3>'
    return re.sub(pattern, replacement, html, count=1, flags=re.DOTALL)

html = replace_js_const(html, 'diaspora', json.dumps(pd, ensure_ascii=False))
# Second diaspora occurrence is in HOLIDAY_DATA
count = html.count('"diaspora"')
# More reliable: find and replace both data blocks
pd_js = json.dumps(pd, ensure_ascii=False)
pi_js = json.dumps(pi, ensure_ascii=False)
hd_js = json.dumps(hd, ensure_ascii=False)
hi_js = json.dumps(hi, ensure_ascii=False)

# Replace PARASHA_LISTS block
html = re.sub(
    r'(const PARASHA_LISTS = \{\s*diaspora: )(\[.*?\])(,\s*israel:\s*)(\[.*?\])(\s*\};)',
    lambda m: m.group(1) + pd_js + m.group(3) + pi_js + m.group(5),
    html, count=1, flags=re.DOTALL
)
# Replace HOLIDAY_DATA block
html = re.sub(
    r'(const HOLIDAY_DATA = \{\s*diaspora: )(\{.*?\})(,\s*israel:\s*)(\{.*?\})(\s*\};)',
    lambda m: m.group(1) + hd_js + m.group(3) + hi_js + m.group(5),
    html, count=1, flags=re.DOTALL
)

# Also rebuild static optgroups in select element
BOOK_HE = {
    'Genesis':'\u05d1\u05bc\u05b0\u05e8\u05b5\u05d0\u05e9\u05c1\u05b4\u05d9\u05ea',
    'Exodus':'\u05e9\u05c1\u05b0\u05de\u05b9\u05d5\u05ea',
    'Leviticus':'\u05d5\u05b7\u05d9\u05bc\u05b4\u05e7\u05b0\u05e8\u05b8\u05d0',
    'Numbers':'\u05d1\u05bc\u05b7\u05de\u05bc\u05b4\u05d3\u05b0\u05d1\u05bc\u05b8\u05e8',
    'Deuteronomy':'\u05d3\u05bc\u05b0\u05d1\u05b8\u05e8\u05b4\u05d9\u05dd',
}

def build_static_opts(parasha_list, holiday_keyed):
    by_year = defaultdict(lambda: defaultdict(list))
    for p in parasha_list:
        by_year[p['date'][:4]][p['book']].append(p)
    lines = ['<option value="">↓ Jump to parasha or holiday</option>']
    for year in sorted(by_year.keys()):
        books_sorted = sorted(by_year[year].keys(), key=lambda b: by_year[year][b][0]['date'])
        for book in books_sorted:
            lines.append(f'<optgroup label="{year} · {BOOK_HE[book]} {book}">')
            for p in by_year[year][book]:
                lines.append(f'<option value="{p["date"]}">{p["label"]}</option>')
            lines.append('</optgroup>')
    h_by_year = defaultdict(list)
    for key in holiday_keyed:
        dt = key.split('|')[0]
        h_by_year[dt[:4]].append({'key': key, 'dt': dt})
    for year in sorted(h_by_year.keys()):
        lines.append(f'<optgroup label="{year} · 🕍 Holidays">')
        for h in sorted(h_by_year[year], key=lambda x: (x['dt'], x['key'])):
            title = h['key'].split('|', 1)[1]
            d = date.fromisoformat(h['dt'])
            label = f"{title} · {d.strftime('%b %-d, %Y')}"
            lines.append(f'<option value="holiday|{h[\"key\"]}">{label}</option>')
        lines.append('</optgroup>')
    return '\n    '.join(lines)

static_opts = build_static_opts(pd, hd)
old_sel = re.search(r'<select class="parasha-select" id="parashaSelect">.*?</select>', html, re.DOTALL)
if old_sel:
    html = html[:old_sel.start()] + \
        f'<select class="parasha-select" id="parashaSelect">\n    {static_opts}\n    </select>' + \
        html[old_sel.end():]

with open('index.html', 'w') as f:
    f.write(html)

print(f"\nDone. index.html updated ({len(html)//1024}KB)")
