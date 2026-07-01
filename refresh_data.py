#!/usr/bin/env python3
"""
Refresh parasha and holiday schedule data in index.html.
Run biannually via GitHub Actions (Jan 1 and Jul 1) -- see .github/workflows/refresh.yml.
Fetches 1.5 years of data ahead of today.

Architecture (changed June 2026 -- see AGENTS.md for the "why"):
Single source of truth is https://www.hebcal.com/leyning, NOT /hebcal. This
is a genuinely different Hebcal endpoint (same functionality as the
JS @hebcal/leyning package's getLeyningOnDate) that returns Shabbat,
holiday, AND Monday/Thursday weekday readings together in one stream,
disambiguated by an item['type'] field ("shabbat" / "holiday" / "weekday").
This replaced the old two-call /hebcal approach (one call for the parsha
list with leyning=0, a second for holiday leyning with leyning=1&maj=on...)
and, as a side effect, eliminated the need to hand-build Mincha leyning for
the public fast days and Yom Kippur -- /leyning already returns those as
separate "<Holiday> (Mincha)" items with correct haftarah, so that
synthesis logic (previously here, see git history) is gone entirely.

/leyning truncates any single request to 180 days, so the fetch is
paginated in <=175-day chunks. Weekday (Monday/Thursday) items are NOT
embedded here -- they're cheap to fetch live, on-demand, exactly the way
fetchParasha() in index.html already fetches a single Shabbat's leyning
at runtime. Embedding ~150 weekday dates here would only bloat the
dropdown for no benefit, since the weekday reading is always either
today's nearest Monday/Thursday or a button-triggered lookup, never
something a person scrolls a dropdown to find.
"""

import urllib.request, json, re
from datetime import date, timedelta
from collections import defaultdict

today      = date.today()
start_str  = today.isoformat()
end_str    = (today + timedelta(days=547)).isoformat()  # ~1.5 years
print(f"Fetching {start_str} -> {end_str} (1.5 years)")

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

def aliyah_range_str(a):
    """Convert a /leyning aliyah object {k,b,e,v} to our flat
    'Book ch:v-ch:v' string, matching the format the rest of index.html's
    JS (parseRange) already expects."""
    return f"{a['k']} {a['b']}-{a['e']}"

def fetch_leyning_items(israel=False):
    """Paginate /leyning in <=175-day chunks from today through end_str,
    for one location (Diaspora or Israel). Returns the raw item list."""
    i = '&i=on' if israel else ''
    items = []
    chunk_start = today
    end_date = date.fromisoformat(end_str)
    while chunk_start <= end_date:
        chunk_end = min(chunk_start + timedelta(days=175), end_date)
        url = (f"https://www.hebcal.com/leyning?cfg=json"
               f"&start={chunk_start.isoformat()}&end={chunk_end.isoformat()}{i}")
        data = fetch(url)
        items += data.get('items', [])
        chunk_start = chunk_end + timedelta(days=1)
    return items

def build_parasha_and_holiday_data(israel=False):
    """Single pass over /leyning's unified item stream, splitting into
    the two structures index.html actually consumes: a bare parasha list
    (name/date/book/label, no leyning -- that's fetched live at runtime by
    fetchParasha()) and a keyed holiday-leyning map (full aliyot, used
    for holidays/fasts/Rosh Chodesh, which ARE embedded since fetching
    each one live on every page load would mean dozens of extra requests
    just to populate the dropdown)."""
    items = fetch_leyning_items(israel)

    parashas, holidays = [], []
    seen_parasha = set()

    for item in items:
        itype = item.get('type')
        if itype == 'shabbat':
            # Hebcal's /leyning uses a straight apostrophe ('); BOOK_MAP
            # and every existing label use the curly one (\u2019) --
            # normalize so names like "Beha'alotcha" actually match.
            name = item['name']['en'].replace("'", '\u2019')
            if (item['date'], name) in seen_parasha:
                continue
            seen_parasha.add((item['date'], name))
            book = BOOK_MAP.get(name, 'Other')
            d = date.fromisoformat(item['date'])
            parashas.append({'name': name, 'date': item['date'],
                              'book': book, 'label': f"{name} \u00b7 {fmt_date(d)}"})
        elif itype == 'holiday':
            fk = item.get('fullkriyah', {})
            leyning = {}
            for k, a in fk.items():
                key = 'maftir' if k == 'M' else k
                leyning[key] = aliyah_range_str(a)
            if not leyning:
                # Items like "Erev Tish'a B'Av" carry only a `megillah`
                # reading (Lamentations), no Torah aliyot at all -- not a
                # tikkun-practice case this tool handles, same exclusion
                # the old /hebcal-based code applied.
                continue
            if 'summary' in item:
                leyning['torah'] = item['summary']
            if 'haftara' in item:
                leyning['haftarah'] = item['haftara']
            holidays.append({'date': item['date'], 'title': item['name']['en'].replace("'", '\u2019'), 'leyning': leyning})
        # itype == 'weekday' deliberately not collected here -- see module
        # docstring. Fetched live at runtime instead.

    holidays.sort(key=lambda x: (x['date'], x['title']))
    holiday_keyed = {f"{h['date']}|{h['title']}": h['leyning'] for h in holidays}
    return parashas, holiday_keyed

def replace_js_object(html, const_name, new_value):
    """Replace 'const NAME = {...}' using brace counting -- no regex backtracking."""
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
    lines = ['<option value="">&#8595; Jump to Parasha or Holiday / Fast Day</option>']
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

# -- Fetch ----------------------------------------------------------
print("Fetching from /leyning (Diaspora)...")
pd, hd = build_parasha_and_holiday_data(False)
print(f"  Parshiot: {len(pd)}, Holiday/fast/Rosh Chodesh entries: {len(hd)}")

print("Fetching from /leyning (Israel)...")
pi, hi = build_parasha_and_holiday_data(True)
print(f"  Parshiot: {len(pi)}, Holiday/fast/Rosh Chodesh entries: {len(hi)}")

# -- Patch index.html -------------------------------------------------
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
