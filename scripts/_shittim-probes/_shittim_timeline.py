"""
用官方 render_still.exe 扫时间轴，找出角色出现的时刻，并统计每帧差异。

这是**最权威**的还原手段：发行版自带这个命令行工具，
它和登录界面走同一套渲染代码（日志 [0]~[6] 完全一致），
所以它输出的 PNG 就是"原本的效果"本身，不需要任何猜测。

用法：
  python scripts/_shittim_timeline.py
"""
import os, subprocess, collections
from PIL import Image, ImageChops

ROOT = r"D:\下载\ShittimLogon-1.4.1\ShittimLogon-1.4.1"
EXE = os.path.join(ROOT, "bin", "x64", "render_still.exe")
ASSETS = os.path.join(ROOT, "assets")
OUT = os.path.join(os.environ["TEMP"], "kaoyan-timeline")
os.makedirs(OUT, exist_ok=True)


def render(scene, t=None, w=640, h=360, extra=None):
    out = os.path.join(OUT, f"{scene}_t{t if t is not None else 'def'}.png")
    cmd = [EXE, "--assets", ASSETS, "--scene", scene, "--out", out,
           "--width", str(w), "--height", str(h)]
    if t is not None:
        cmd += ["--time", str(t)]
    if extra:
        cmd += extra
    r = subprocess.run(cmd, capture_output=True, text=True, errors="ignore")
    ok = os.path.exists(out)
    return out if ok else None, r.stdout + r.stderr


def stats(path):
    im = Image.open(path).convert("RGB")
    small = im.resize((64, 36))
    px = list(small.getdata())
    # 颜色数（量化）与平均亮度，用来找"角色出现"的帧
    q = small.quantize(colors=64)
    cols = len(q.getcolors(100000) or [])
    # 皮肤/深色像素比例：角色（黑长发、肤色）会让深色像素明显增多
    dark = sum(1 for r, g, b in px if r + g + b < 260)
    return {"colors": cols, "dark": round(dark / len(px), 3)}


print("=== 先确认 --time 是否被接受 ===")
p, log = render("day_1", t=2.0)
print("  日志尾部:", " | ".join(l for l in log.strip().splitlines()[-4:]))

print("\n=== day_1 沿时间轴扫描 ===")
rows = []
for t in [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 9.9]:
    p, log = render("day_1", t=t)
    if not p:
        print(f"  t={t}: 渲染失败")
        continue
    s = stats(p)
    rows.append((t, s))
    print(f"  t={t:>4}s  色数 {s['colors']:>3}  深色占比 {s['dark']}")

if rows:
    best = max(rows, key=lambda r: r[1]["dark"])
    print(f"\n深色像素最多（最可能有角色）的时刻：t={best[0]}s  深色占比 {best[1]['dark']}")

print("\n输出目录:", OUT)
