"""Creates sample_transactions.xlsx (3 days) so you can try the dashboard. Stdlib only."""
import datetime as dt
import math
import os
import random
import zipfile
from xml.sax.saxutils import escape

random.seed(7)
HERE = os.path.dirname(os.path.abspath(__file__))
COLS = ["MerchantIDD", "APGID", "Trans_Id", "Transaction_Date", "Transaction_Time", "BIN", "Stan_No", "RRN_No",
        "Authorization_Code", "Merchant_Name", "Merchant_PAN", "Trans_Amount", "SettlementMode", "MCC",
        "Merchant_Location", "Merchant_City", "Province", "Trnx_Status"]
NAMES = ["Daraz Online", "Foodpanda", "Careem Rides", "Jazz Load", "Telenor Easypay", "K-Electric", "SNGPL Gas",
         "PTCL Broadband", "Al-Fatah Store", "Imtiaz Super Market", "Hyperstar", "Servis Shoes", "Khaadi", "Sapphire",
         "Gul Ahmed", "Metro Cash & Carry", "Shell Pakistan", "PSO Fuel", "Airlink Comm", "PIA Booking", "Bykea",
         "Cheezious", "Pizza Hut", "KFC", "McDonalds", "Emporium Mall", "Packages Mall", "Lucky One", "Chase Up",
         "Naheed", "Medicam Pharmacy", "Sehat Pharmacy", "Shaukat Khanum", "Aga Khan Lab", "LUMS Fees", "NUST Fees",
         "Habib Bank Bill", "Nayatel", "StormFiber", "Zameen.com", "OLX Pakistan", "Markaz Express", "Rozee.pk",
         "Sozo World", "Gourmet Bakers"]
CITIES = [("Karachi", "Sindh"), ("Lahore", "Punjab"), ("Islamabad", "ICT"), ("Peshawar", "KPK"),
          ("Quetta", "Balochistan"), ("Faisalabad", "Punjab")]
MCCS = ["5311", "5812", "4121", "4814", "4900", "5411", "5651", "5541", "4511", "8062", "8220", "5912"]
HOUR_W = [1, 1, 1, 1, 1, 2, 4, 8, 12, 15, 17, 19, 22, 20, 18, 17, 18, 20, 24, 26, 22, 14, 7, 3]

merchants = []
for i, n in enumerate(NAMES):
    city, prov = random.choice(CITIES)
    merchants.append({
        "id": "MID%07d" % (1000300 + i * 17), "name": n, "city": city, "prov": prov, "mcc": random.choice(MCCS),
        "iban": "PK%02dALFH%016d" % (random.randint(10, 99), random.randint(10 ** 15, 10 ** 16 - 1)),
        "pan": "", "w": 1.0 / math.pow(i + 1, 0.9), "peak": random.randint(7, 22),
    })

days = [dt.date(2026, 10, 28), dt.date(2026, 10, 29), dt.date(2026, 10, 30)]
rows = []
for d in days:
    for _ in range(9000):
        m = random.choices(merchants, [x["w"] for x in merchants])[0]
        hw = [w * (3 if abs(h - m["peak"]) <= 1 else 1) for h, w in enumerate(HOUR_W)]
        h = random.choices(range(24), hw)[0]
        rows.append((d, h * 3600 + random.randint(0, 3599), m))
rows.sort(key=lambda r: (r[0], r[1]))

EPOCH = dt.date(1899, 12, 30)
table = []
for n, (d, s, m) in enumerate(rows):
    st = random.choices(["Success", "Failed", "Reversed"], [92, 5, 3])[0]
    table.append([m["id"], "APG%03d" % random.randint(1, 20), "TXN%010d" % (5000000 + n), (d - EPOCH).days,
                  "%02d:%02d:%02d" % (s // 3600, s % 3600 // 60, s % 60), "4%05d" % random.randint(0, 99999),
                  "%06d" % random.randint(0, 999999), "%012d" % random.randint(0, 10 ** 12 - 1),
                  "%06d" % random.randint(0, 999999), m["name"], m["iban"],
                  round(random.lognormvariate(7.4, 1.0), 2), random.choice(["T+1", "T+2", "Same Day"]), m["mcc"],
                  m["name"] + " Outlet", m["city"], m["prov"], st])


def colname(i):
    return chr(65 + i)


def cell(ci, ri, v):
    ref = "%s%d" % (colname(ci), ri)
    if isinstance(v, (int, float)):
        return '<c r="%s"><v>%s</v></c>' % (ref, v)
    return '<c r="%s" t="inlineStr"><is><t>%s</t></is></c>' % (ref, escape(str(v)))


sheet = ['<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>']
for ri, row in enumerate([COLS] + table, start=1):
    sheet.append('<row r="%d">%s</row>' % (ri, "".join(cell(ci, ri, v) for ci, v in enumerate(row))))
sheet.append("</sheetData></worksheet>")

out = os.path.join(HERE, "sample_transactions.xlsx")
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
    z.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
    z.writestr("xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Transactions" sheetId="1" r:id="rId1"/></sheets></workbook>')
    z.writestr("xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
    z.writestr("xl/worksheets/sheet1.xml", "".join(sheet))
print("Wrote", out, "-", len(table), "rows")
