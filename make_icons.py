import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
SIZES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}
TOP = (30, 78, 216)      # #1E4ED8
BOTTOM = (10, 168, 158)  # #0AA89E


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def make(size):
    ss = size * 8
    img = Image.new("RGBA", (ss, ss), (0, 0, 0, 0))
    px = img.load()
    for y in range(ss):
        for x in range(ss):
            t = (x + y) / (2.0 * (ss - 1))
            r, g, b = lerp(TOP, BOTTOM, t)
            px[x, y] = (r, g, b, 255)

    mask = Image.new("L", (ss, ss), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, ss - 1, ss - 1], radius=int(ss * 0.225), fill=255)
    img.putalpha(mask)

    d = ImageDraw.Draw(img)
    w = int(ss * 0.072)

    # 放大镜：镜圈 + 手柄
    cx, cy, r = ss * 0.445, ss * 0.415, ss * 0.205
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(255, 255, 255, 255), width=w)
    hx0, hy0 = cx + r * 0.62, cy + r * 0.62
    hx1, hy1 = cx + r * 1.55, cy + r * 1.55
    d.line([hx0, hy0, hx1, hy1], fill=(255, 255, 255, 255), width=int(w * 1.15))
    rr = w * 0.58
    d.ellipse([hx1 - rr, hy1 - rr, hx1 + rr, hy1 + rr], fill=(255, 255, 255, 255))

    # 镜内三个小圆点，暗示「多个网盘源」
    for i, frac in enumerate((0.55, 1.0, 1.45)):
        px0 = cx - r * 0.55 * (frac - 0.0)
        py0 = cy + r * (0.30 - 0.30 * (i - 1))
        rad = ss * 0.026
        d.ellipse([px0 - rad, py0 - rad, px0 + rad, py0 + rad], fill=(255, 255, 255, 235))

    return img.resize((size, size), Image.LANCZOS)


for folder, size in SIZES.items():
    path = os.path.join(HERE, "app", "res", folder)
    os.makedirs(path, exist_ok=True)
    make(size).save(os.path.join(path, "ic_launcher.png"))
    print(folder, size, "ok")

make(432).save(os.path.join(HERE, "icon-preview.png"))
print("preview ok")
