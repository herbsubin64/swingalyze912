import json, sys, urllib.request

def get(url, data=None):
    req = urllib.request.Request(url, data=(json.dumps(data).encode() if data else None), headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(req) as r: return json.loads(r.read().decode())

gold = json.load(open('fixtures/golf1.golden.json'))
name = gold['video']
status = get('http://localhost:3000/api/status')
if not status.get('ok'): print(json.dumps({"ok":False,"error":"status"})); sys.exit(1)

res = get('http://localhost:3000/api/analyze', {"video":name})
if not res.get('ok'): print(json.dumps({"ok":False,"error":"analyze", "detail":res})); sys.exit(1)

exp = gold['expect']; s = res.get('series') or {}
ok_series = (s.get('samples',0) >= exp['series']['minSamples'] and 0 < (s.get('stepSec',1)) <= exp['series']['stepMax'])

kf = res.get('keyframes') or {}; ratio = kf.get('ratio', 0)
ok_kf = (ratio >= exp['keyframes']['ratioMin'] and ratio <= exp['keyframes']['ratioMax'])

st = res.get('stance') or {}; af = (((st.get('address') or {}).get('frac')))
ok_stance = (af is None) or (exp['stance']['addressMin'] <= af <= exp['stance']['addressMax'])

out = {"ok": (ok_series and ok_kf and ok_stance), "series":ok_series, "keyframes":ok_kf, "stance":ok_stance}
print(json.dumps(out))
sys.exit(0 if out["ok"] else 2)
