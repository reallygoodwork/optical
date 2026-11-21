#!/usr/bin/env python3
"""Server cost benchmark: wall ms, CPU ms (node + ffmpeg children), output bytes, peak RSS.
Usage: python3 scripts/perf.py [runs] [out.json]"""
import json, resource, subprocess, sys, statistics, os
runs = int(sys.argv[1]) if len(sys.argv) > 1 else 3
out = sys.argv[2] if len(sys.argv) > 2 else None
CASES = ["og-png","quote-jpeg","variants-png","stat-gif","quote-mp4","story-mp4","story-video-mp4","html-mp4","preview-video"]
tsx = os.path.join("node_modules", ".bin", "tsx")
def one(name):
    before = resource.getrusage(resource.RUSAGE_CHILDREN)
    p = subprocess.run([tsx, "scripts/perf-case.ts", name], capture_output=True, text=True)
    after = resource.getrusage(resource.RUSAGE_CHILDREN)
    if p.returncode: raise SystemExit(p.stderr[-2000:])
    r = json.loads(p.stdout.strip().splitlines()[-1])
    r["cpu"] = ((after.ru_utime - before.ru_utime) + (after.ru_stime - before.ru_stime)) * 1000
    r["maxrss"] = after.ru_maxrss
    return r
base = statistics.median([one("noop")["cpu"] for _ in range(3)])
res = {}
for c in CASES:
    rs = [one(c) for _ in range(runs)]
    res[c] = {"ms": statistics.median(r["ms"] for r in rs), "cpu": max(0, statistics.median(r["cpu"] for r in rs) - base), "bytes": rs[0]["bytes"], "rssMB": max(r["rss"] for r in rs) / 1e6}
    print(f'{c:18} wall {res[c]["ms"]:8.0f} ms   cpu {res[c]["cpu"]:8.0f} ms   {res[c]["bytes"]/1024:8.0f} KB   rss {res[c]["rssMB"]:6.0f} MB', flush=True)
tw = sum(v["ms"] for v in res.values()); tc = sum(v["cpu"] for v in res.values()); tb = sum(v["bytes"] for v in res.values())
print(f'{"TOTAL":18} wall {tw:8.0f} ms   cpu {tc:8.0f} ms   {tb/1024:8.0f} KB   (startup cpu subtracted: {base:.0f} ms)')
if out: json.dump(res, open(out, "w"), indent=1)
