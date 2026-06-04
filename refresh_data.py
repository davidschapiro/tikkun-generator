#!/usr/bin/env python3
"""
Refresh parasha and holiday schedule data in index.html.
Run biannually via GitHub Actions (Jan 1 and Jul 1).
Fetches ~2.5 years of data from Hebcal and updates the embedded JS.
"""

import urllib.request, json, re, sys
from datetime import date
from collections import defaultdict

today      = date.today()
start_str  = today.isoformat()
end_str    = date(today.year + 2, 12, 31).isoformat()
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
    'Bamidbar':'Numbers','Nasso':'Numbers',
    'Beha\u2019alotcha':'Numbers','Sh\u2019lach':'Numbers','Korach':'Numbers',
    'Chukat':'Numbers','Balak':'Numbers','Chukat-Balak':'Numbers','Pinchas':'Numbers',
    'Matot':'Numbers','Masei':'Numbers','Matot-Masei':'Numbers',
    'Devarim':'Deuteronomy','Vaetchanan':'Deuteronomy','Eikev':'Deuteronomy',
    'Re\u2019eh':'Deuteronomy','Shoftim':'Deuteronomy','Ki Teitzei':'Deuteronomy',
    'Ki Tavo':'Deuteronomy','Nitzavim':'Deuteronomy','Vayeilech':'Deuteronomy',
    'Nitzavim-Vayeilech':'Deuteronomy','Ha\u2019azinu':'Deuteronomy',
    'Vezot Haberakhah':'Deuteronomy',
}

BOOK_HE = {
    'Genesis':'\u05d1\u05bc\u05b0\u05e8\u05b5\u05d0\u05e9\u05c1\u05b4\u05d9\u05ea',
    'Exodus':'\u05e9\u05c1\u05b0\u05de\u05b9\u05d5\u05ea',
    'Leviticus':'\u05d5\u05b7\u05d9\u05bc\u05b4\u05e7\u05b0\u05e8\u05b8\u05d0',
    'Numbers':'\u05d1\u05bc\u05b7\u05de\u05bc\u05b4\u05d3\u05b0\u05d1\u05bc\u05b8\u05e8',
    'Deuteronomy':'\u05d3\u05bc\u05b0\u05d1\u05b8\u05e8\u05b4\u05d9\u05dd',
}

def fetch(url):
    with urllib.request.urlopen(url) as r:
        return json.loads(r.read())

def fmt_date(d):
    # Cross-platform date formatting without %-d
    return d.strftime('%b %d, %Y').replace(' 0', ' ')

def build_parasha_list(israel=False):
    i = '&i=on' if israel else ''
    items = []
    for year in range(today.year, today.year + 3):
        url = (f"https://www.hebcal.com/hebcal?v=1&cfg=json&year={year}"
               f"&maj=off&min=off&nx=off&mf=off&ss=off&mod=off&s=on&leyning=0{i}")
        data = fetch(url)
        items += [x for x in data.get('items', []) if x.get('category') == 'parashat']
    seen, result = set(), []
    for item in sorted(items, key=lambda x: x['date']):
        if item['date'] < start_str:
            continue
        name = item['title'].replace('Parashat ', '').replace('Parashas ', '')
        book = BOOK_MAP.get(name, 'Other')
        d    = date.fromisoformat(item['date'])
        key  = item['date'] + name
        if key not in seen:
            seen.add(key)
            result.append({'name': name, 'date': item['date'],
                           'book': book, 'label': f"{name} \u00b7 {fmt_date(d)}"})
    return result

def build_holiday_data(israel=False):
    i = '&i=on' if israel else ''
    url = (f"https://www.hebcal.com/hebcal?v=1&cfg=json"
           f"&start={start_str}&end={end_str}"
           f"&s=off&leyning=1&maj=on&min=off&mf=off&ss=off&mod=off{i}")
    data = fetch(url)
    holidays = []
    for item in data['items']:
        if item.get('category') != 'holiday':
            continue
        l = item.get('leyning', {})
        keys = [k for k in l if k not in ('torah', 'haftarah', 'haftarah_sephardic', 'triennial')]
        if not keys:
            continue
        holidays.append({'date': item['date'], 'title': item['title'], 'leyning': l})
    # Add YK Mincha
    for h in [x for x in holidays if x['title'] == 'Yom Kippur']:
        holidays.append({'date': h['date'], 'title': 'Yom Kippur (Mincha)', 'leyning': {
            '1': 'Leviticus 18:1-18:21',
            '2': 'Leviticus 18:22-18:25',
            '3': 'Leviticus 18:26-18:30',
        }})
    holidays.sort(key=lambda x: (x['date'], x['title']))
    return {f"{h['date']}|{h['title']}": h['leyning'] for h in holidays}

def replace_js_object(html, const_name, new_value):
    """Replace 'const NAME = {...}' using brace counting — no regex backtracking."""
    marker     = f'const {const_name} = {{'
    start      = html.find(marker)
    if start == -1:
        raise ValueError(f"Marker not found: {marker}")
    brace_start = html.index('{', start)
    depth, i    = 0, brace_start
    while i < len(html):
        if   html[i] == '{': depth += 1
        elif html[i] == '}':
            depth -= 1
            if depth == 0:
                return html[:brace_start] + new_value + html[i+1:]
        i += 1
    raise ValueError(f"No matching closing brace for {const_name}")

def build_static_opts(parasha_list, holiday_keyed):
    by_year = defaultdict(lambda: defaultdict(list))
    for p in parasha_list:
        by_year[p['date'][:4]][p['book']].append(p)
    lines = ['<option value="">&#8595; Jump to parasha or holiday</option>']
    for year in sorted(by_year.keys()):
        books_sorted = sorted(
            by_year[year].keys(),
            key=lambda b: by_year[year][b][0]['date']
        )
        for book in books_sorted:
            lbl = f"{year} \u00b7 {BOOK_HE[book]} {book}"
            lines.append(f'<optgroup label="{lbl}">')
            for p in by_year[year][book]:
                lines.append(f'<option value="{p["date"]}">{p["label"]}</option>')
            lines.append('</optgroup>')
    h_by_year = defaultdict(list)
    for key in holiday_keyed:
        dt = key.split('|')[0]
        h_by_year[dt[:4]].append({'key': key, 'dt': dt})
    for year in sorted(h_by_year.keys()):
        lines.append(f'<optgroup label="{year} \u00b7 \U0001f54d Holidays">')
        for h in sorted(h_by_year[year], key=lambda x: (x['dt'], x['key'])):
            title = h['key'].split('|', 1)[1]
            d     = date.fromisoformat(h['dt'])
            label = f"{title} \u00b7 {fmt_date(d)}"
            val   = 'holiday|' + h['key']
            lines.append(f'<option value="{val}">{label}</option>')
        lines.append('</optgroup>')
    return '\n    '.join(lines)

# ── Fetch ────────────────────────────────────────────────────────
print("Building parasha lists...")
pd = build_parasha_list(False)
pi = build_parasha_list(True)
print(f"  Diaspora: {len(pd)}, Israel: {len(pi)}")

print("Building holiday data...")
hd = build_holiday_data(False)
hi = build_holiday_data(True)
print(f"  Diaspora: {len(hd)}, Israel: {len(hi)}")

# ── Patch index.html ─────────────────────────────────────────────
with open('index.html', encoding='utf-8') as f:
    html = f.read()

print("Patching index.html...")

html = replace_js_object(
    html, 'PARASHA_LISTS',
    '{{\n  diaspora: {pd},\n  israel:   {pi}\n}}'.format(
        pd=json.dumps(pd, ensure_ascii=False),
        pi=json.dumps(pi, ensure_ascii=False)
    )
)
html = replace_js_object(
    html, 'HOLIDAY_DATA',
    '{{\n  diaspora: {hd},\n  israel:   {hi}\n}}'.format(
        hd=json.dumps(hd, ensure_ascii=False),
        hi=json.dumps(hi, ensure_ascii=False)
    )
)

# Rebuild static select optgroups
static_opts = build_static_opts(pd, hd)
old_sel = re.search(
    r'<select class="parasha-select" id="parashaSelect">.*?</select>',
    html, re.DOTALL
)
if old_sel:
    html = (html[:old_sel.start()]
            + f'<select class="parasha-select" id="parashaSelect">\n    {static_opts}\n    </select>'
            + html[old_sel.end():])

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(html)

print(f"Done. index.html updated ({len(html)//1024}KB)")
