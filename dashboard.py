"""
Merchant Transaction Dashboard builder
--------------------------------------
1. Change EXCEL_PATH below (or pass a path:  python dashboard.py "D:\\file.xlsx")
2. Run this script (or double-click run_dashboard.bat)
3. The dashboard opens in your browser.

Uses only the Python standard library - nothing to install.
Reads .xlsx and .csv.  The sheet can hold one day, two days, ... any number of days.
"""
import collections
import csv
import datetime as dt
import json
import os
import re
import sys
import traceback
import webbrowser
import xml.etree.ElementTree as ET
import zipfile

# =====================================================================
#  EDIT HERE
# =====================================================================
EXCEL_PATH = r"C:\Users\Nizam\Desktop\Transaction Report Code\sample_transactions.xlsx"
#   ^ a file path, or a folder (then the newest .xlsx/.csv inside is used)

SHEET_NAME = None            # None = first sheet, or e.g. "Sheet1"
GROUP_MERCHANTS_BY = "id"    # "id" -> MerchantIDD ,  "name" -> Merchant_Name
IBAN_COLUMN = None           # None = auto-detect, or a header such as "Merchant_PAN"
DAYFIRST = True              # 05/10/2026 means 5 Oct (True) or May 10 (False)
OPEN_BROWSER = True
# Status values counted as "successful" (case-insensitive). Anything starting
# with "succ", "approv" or "00" is also treated as successful.
SUCCESS_VALUES = {"success", "successful", "approved", "completed", "paid", "ok", "settled", "0", "00", "000"}
# =====================================================================

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, "web")
OUT = os.path.join(HERE, "output")

ALIASES = {
    "mid": ["merchantidd", "merchantid", "mid"],
    "date": ["transactiondate", "transdate", "date"],
    "time": ["transactiontime", "transtime", "time"],
    "name": ["merchantname", "merchant", "name"],
    "pan": ["merchantpan", "pan"],
    "iban": ["iban", "merchantiban", "accountiban"],
    "amount": ["transamount", "transactionamount", "amount"],
    "mode": ["settlementmode"],
    "mcc": ["mcc"],
    "loc": ["merchantlocation", "location"],
    "city": ["merchantcity", "city"],
    "prov": ["province"],
    "status": ["trnxstatus", "transstatus", "transactionstatus", "status"],
}
KNOWN = {a for v in ALIASES.values() for a in v}
IBAN_RE = re.compile(r"^[A-Za-z]{2}\d{2}[A-Za-z0-9]{10,30}$")


def norm(s):
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


# ---------------------------------------------------------------- readers
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
RNS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def _col_index(ref):
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group(0):
        n = n * 26 + ord(ch) - 64
    return n - 1


def read_xlsx(path, sheet_name=None):
    """Minimal streaming .xlsx reader. Every cell comes back as text."""
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        shared = []
        if "xl/sharedStrings.xml" in names:
            with z.open("xl/sharedStrings.xml") as f:
                for _, el in ET.iterparse(f):
                    if el.tag == NS + "si":
                        parts = []
                        for ch in el:
                            if ch.tag == NS + "t":
                                parts.append(ch.text or "")
                            elif ch.tag == NS + "r":
                                parts.extend(t.text or "" for t in ch.findall(NS + "t"))
                        shared.append("".join(parts))
                        el.clear()

        wb = ET.fromstring(z.read("xl/workbook.xml"))
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        target = {r.get("Id"): r.get("Target") for r in rels}
        sheets = [(s.get("name"), target[s.get(RNS + "id")]) for s in wb.find(NS + "sheets")]
        if not sheets:
            raise ValueError("The workbook has no sheets.")
        chosen = sheets[0]
        if sheet_name:
            match = [s for s in sheets if s[0].lower() == str(sheet_name).lower()]
            if not match:
                raise ValueError("Sheet '%s' not found. Sheets: %s" % (sheet_name, [s[0] for s in sheets]))
            chosen = match[0]
        t = chosen[1].lstrip("/")
        part = t if t.startswith("xl/") else "xl/" + t

        rows = []
        with z.open(part) as f:
            for _, el in ET.iterparse(f):
                if el.tag != NS + "row":
                    continue
                vals = []
                for c in el.findall(NS + "c"):
                    idx = _col_index(c.get("r"))
                    while len(vals) <= idx:
                        vals.append(None)
                    typ = c.get("t")
                    v = c.find(NS + "v")
                    if typ == "s":
                        val = shared[int(v.text)] if v is not None and v.text else None
                    elif typ == "inlineStr":
                        node = c.find(NS + "is")
                        val = "".join(x.text or "" for x in node.iter(NS + "t")) if node is not None else None
                    else:
                        val = v.text if v is not None else None
                    vals[idx] = val
                rows.append(vals)
                el.clear()
        return rows


def read_csv(path):
    for enc in ("utf-8-sig", "cp1252"):
        try:
            with open(path, newline="", encoding=enc) as f:
                sample = f.read(8192)
                f.seek(0)
                try:
                    dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
                except csv.Error:
                    dialect = csv.excel
                return [r for r in csv.reader(f, dialect)]
        except UnicodeDecodeError:
            continue
    raise ValueError("Could not decode the CSV file.")


# ---------------------------------------------------------------- parsing
_DATE_ISO = ["%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d", "%Y%m%d"]
_DATE_DMY = ["%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y", "%d-%m-%y", "%d/%m/%y"]
_DATE_MDY = ["%m-%d-%Y", "%m/%d/%Y", "%m.%d.%Y", "%m-%d-%y", "%m/%d/%y"]
_DATE_TXT = ["%d-%b-%Y", "%d %b %Y", "%d-%b-%y", "%d %B %Y", "%b %d, %Y", "%d-%B-%Y"]
_EXCEL_EPOCH = dt.date(1899, 12, 30)


def parse_date(s):
    """-> (date or None, seconds-from-midnight found inside the value or None)"""
    s = (s or "").strip()
    if not s:
        return None, None
    try:
        f = float(s)
    except ValueError:
        f = None
    if f is not None:
        if 19000101 <= f <= 21001231:
            s2 = str(int(f))
            try:
                return dt.datetime.strptime(s2, "%Y%m%d").date(), None
            except ValueError:
                return None, None
        if 20000 < f < 80000:
            secs = round((f - int(f)) * 86400)
            return _EXCEL_EPOCH + dt.timedelta(days=int(f)), (secs if secs else None)
        return None, None
    secs = None
    m = re.search(r"[ T]+(\d{1,2}:\d{2}.*)$", s)
    if m:
        secs = parse_time(m.group(1))
        s = s[: m.start()].strip()
    order = _DATE_ISO + (_DATE_DMY + _DATE_MDY if DAYFIRST else _DATE_MDY + _DATE_DMY) + _DATE_TXT
    for fmt in order:
        try:
            return dt.datetime.strptime(s, fmt).date(), secs
        except ValueError:
            pass
    return None, None


def parse_time(s):
    """-> seconds from midnight or None. Handles 14:35:22, 2:35 PM, 143522, 0.6083 (Excel)."""
    s = (s or "").strip()
    if not s:
        return None
    try:
        f = float(s)
    except ValueError:
        f = None
    if f is not None:
        if 0 <= f < 1:
            return min(86399, round(f * 86400))
        if f >= 1 and abs(f - round(f)) > 1e-9:          # Excel datetime serial
            return min(86399, round((f - int(f)) * 86400))
        if f == 0:
            return 0
        if 0 < f <= 235959:                                # hhmmss
            d = str(int(f)).zfill(6)
            h, mi, se = int(d[:2]), int(d[2:4]), int(d[4:])
            if h < 24 and mi < 60 and se < 60:
                return h * 3600 + mi * 60 + se
        return None
    m = re.search(r"(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([AaPp][Mm])?", s)
    if not m:
        return None
    h, mi, se = int(m.group(1)), int(m.group(2)), int(m.group(3) or 0)
    ap = (m.group(4) or "").lower()
    if ap == "pm" and h < 12:
        h += 12
    if ap == "am" and h == 12:
        h = 0
    if h > 23 or mi > 59 or se > 59:
        return None
    return h * 3600 + mi * 60 + se


def parse_amount(s):
    s = re.sub(r"[^0-9.\-]", "", (s or "").replace(",", ""))
    try:
        return float(s)
    except ValueError:
        return 0.0


def clean_id(s):
    s = (s or "").strip()
    return s[:-2] if re.fullmatch(r"\d+\.0", s) else s


def is_success(status):
    s = (status or "").strip().lower()
    return s in SUCCESS_VALUES or s.startswith(("succ", "approv", "00"))


# ---------------------------------------------------------------- build
def pick_file(path):
    if os.path.isdir(path):
        files = [os.path.join(path, f) for f in os.listdir(path)
                 if f.lower().endswith((".xlsx", ".xlsm", ".csv")) and not f.startswith("~$")]
        if not files:
            raise FileNotFoundError("No .xlsx/.csv files in folder: " + path)
        return max(files, key=os.path.getmtime)
    if not os.path.exists(path):
        raise FileNotFoundError("File not found: " + path)
    return path


def load_table(path):
    low = path.lower()
    if low.endswith((".xlsx", ".xlsm")):
        return read_xlsx(path, SHEET_NAME)
    if low.endswith(".csv"):
        return read_csv(path)
    if low.endswith(".xls"):
        raise ValueError("Old .xls format is not supported - open it in Excel and Save As .xlsx or .csv.")
    raise ValueError("Unsupported file type: " + path)


def build(path):
    rows = load_table(path)
    if not rows:
        raise ValueError("The file is empty.")

    hi, best = 0, -1
    for i, r in enumerate(rows[:30]):
        score = sum(1 for c in r if norm(c) in KNOWN)
        if score > best:
            hi, best = i, score
    if best < 3:
        raise ValueError("Could not find the header row. First row seen: %s" % rows[0][:12])
    header = [norm(c) for c in rows[hi]]
    ci = {}
    for key, aliases in ALIASES.items():
        for a in aliases:
            if a in header:
                ci[key] = header.index(a)
                break
    if "date" not in ci or ("name" not in ci and "mid" not in ci):
        raise ValueError("Need at least Transaction_Date and Merchant_Name/MerchantIDD columns. Found: %s" % rows[hi])
    data = rows[hi + 1:]

    # ---- find the IBAN column
    def col_matches(idx, n=300):
        vals = [(r[idx] or "").replace(" ", "") for r in data[:n] if idx < len(r) and r[idx]]
        return bool(vals) and sum(1 for v in vals if IBAN_RE.match(v)) / len(vals) >= 0.5

    iban_idx = None
    if IBAN_COLUMN:
        if norm(IBAN_COLUMN) in header:
            iban_idx = header.index(norm(IBAN_COLUMN))
    if iban_idx is None and "iban" in ci:
        iban_idx = ci["iban"]
    if iban_idx is None and "pan" in ci and col_matches(ci["pan"]):
        iban_idx = ci["pan"]
    if iban_idx is None:
        for idx in range(len(header)):
            if col_matches(idx):
                iban_idx = idx
                break
    if iban_idx is None:
        iban_idx = ci.get("pan")
    iban_name = rows[hi][iban_idx] if iban_idx is not None and iban_idx < len(rows[hi]) else "(none)"

    def cell(r, idx):
        if idx is None or idx >= len(r) or r[idx] is None:
            return ""
        return str(r[idx]).strip()

    agg = collections.defaultdict(lambda: [0, 0.0])
    meta = {}
    skipped = notime = 0
    for r in data:
        if not any(r):
            continue
        d, tsec_d = parse_date(cell(r, ci["date"]))
        if d is None:
            skipped += 1
            continue
        ts = parse_time(cell(r, ci.get("time")))
        if ts is None:
            ts = tsec_d
        if ts is None:
            ts, notime = 0, notime + 1
        slot = min(95, ts // 900)

        mid = clean_id(cell(r, ci.get("mid")))
        name = cell(r, ci.get("name"))
        key = (name or mid) if GROUP_MERCHANTS_BY == "name" else (mid or name)
        if not key:
            skipped += 1
            continue
        mt = meta.get(key)
        if mt is None:
            mt = meta[key] = {k: collections.Counter() for k in ("id", "name", "iban", "city", "prov", "mcc", "loc")}
        mt["id"][mid] += 1
        mt["name"][name or key] += 1
        mt["iban"][re.sub(r"\s+", "", cell(r, iban_idx)).upper()] += 1
        mt["city"][cell(r, ci.get("city"))] += 1
        mt["prov"][cell(r, ci.get("prov"))] += 1
        mt["mcc"][clean_id(cell(r, ci.get("mcc")))] += 1
        mt["loc"][cell(r, ci.get("loc"))] += 1

        status = cell(r, ci.get("status")) or "(blank)"
        mode = cell(r, ci.get("mode")) or "(blank)"
        agg[(key, d, slot, status, mode)][0] += 1
        agg[(key, d, slot, status, mode)][1] += parse_amount(cell(r, ci.get("amount")))

    if not agg:
        raise ValueError("No valid rows found (dates could not be read). Check Transaction_Date format.")

    dates = sorted({k[1] for k in agg})
    date_ix = {d: i for i, d in enumerate(dates)}
    keys = sorted(meta, key=lambda k: str(meta[k]["name"].most_common(1)[0][0]).lower())
    m_ix = {k: i for i, k in enumerate(keys)}
    st_count = collections.Counter()
    mo_set = set()
    for (k, d, sl, st, mo), (c, a) in agg.items():
        st_count[st] += c
        mo_set.add(mo)
    statuses = [s for s, _ in st_count.most_common()]
    modes = sorted(mo_set)
    st_ix = {s: i for i, s in enumerate(statuses)}
    mo_ix = {s: i for i, s in enumerate(modes)}

    def top(counter):
        v = counter.most_common(1)[0][0] if counter else ""
        return v

    merchants = []
    for k in keys:
        m = meta[k]
        merchants.append({
            "id": top(m["id"]) or k, "name": top(m["name"]), "iban": top(m["iban"]),
            "city": top(m["city"]), "prov": top(m["prov"]), "mcc": top(m["mcc"]), "loc": top(m["loc"]),
        })
    out_rows = [[m_ix[k], date_ix[d], sl, st_ix[st], mo_ix[mo], c, round(a, 2)]
                for (k, d, sl, st, mo), (c, a) in sorted(agg.items(), key=lambda kv: (kv[0][1], kv[0][2]))]
    total = sum(r[5] for r in out_rows)
    warnings = []
    if skipped:
        warnings.append("%d row(s) skipped (unreadable date or no merchant)." % skipped)
    if notime:
        warnings.append("%d row(s) had no readable time and were placed at 00:00." % notime)
    return {
        "meta": {
            "file": os.path.basename(path), "generated": dt.datetime.now().strftime("%d %b %Y %H:%M"),
            "transactions": total, "merchants": len(merchants), "ibanColumn": iban_name,
            "groupBy": GROUP_MERCHANTS_BY, "warnings": warnings,
        },
        "merchants": merchants,
        "dates": [d.isoformat() for d in dates],
        "statuses": statuses,
        "success": [is_success(s) for s in statuses],
        "modes": modes,
        "rows": out_rows,
    }


def write_outputs(payload, path):
    js = "window.DASH = " + json.dumps(payload, separators=(",", ":"), ensure_ascii=False).replace("</", "<\\/") + ";\n"
    with open(os.path.join(WEB, "data.js"), "w", encoding="utf-8") as f:   # for editing the web files
        f.write(js)

    def rd(name):
        with open(os.path.join(WEB, name), encoding="utf-8") as f:
            return f.read()

    html = rd("index.html")
    html = html.replace('<link rel="stylesheet" href="style.css">', "<style>\n" + rd("style.css") + "\n</style>")
    html = html.replace('<script src="data.js"></script>', "<script>\n" + js + "</script>")
    html = html.replace('<script src="app.js"></script>', "<script>\n" + rd("app.js").replace("</script", "<\\/script") + "\n</script>")
    os.makedirs(OUT, exist_ok=True)
    stem = re.sub(r"[^A-Za-z0-9_.-]+", "_", os.path.splitext(os.path.basename(path))[0])
    target = os.path.join(OUT, "Dashboard_%s.html" % stem)
    with open(target, "w", encoding="utf-8") as f:
        f.write(html)
    return target


def main():
    args = [a for a in sys.argv[1:] if a != "-v"]
    path = args[0] if args else EXCEL_PATH
    path = pick_file(path)
    print("Reading:", path)
    payload = build(path)
    m = payload["meta"]
    print("  %s transactions | %d merchants | %d day(s): %s -> %s" % (
        format(m["transactions"], ","), m["merchants"], len(payload["dates"]), payload["dates"][0], payload["dates"][-1]))
    print("  IBAN taken from column:", m["ibanColumn"])
    for w in m["warnings"]:
        print("  WARNING:", w)
    target = write_outputs(payload, path)
    print("Dashboard written to:", target)
    if OPEN_BROWSER:
        webbrowser.open("file:///" + target.replace("\\", "/"))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("\nERROR:", exc)
        if "-v" in sys.argv:
            traceback.print_exc()
        sys.exit(1)
