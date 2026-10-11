import math, sys
import re as _re
tmp, B = sys.argv[1], sys.argv[2] + "/"
_s = open(tmp + "/glyph.svg").read()
tr = _re.search(r"<g transform=\"([^\"]*)\"", _s).group(1)
d = max(_re.findall(r"<path d=\"([^\"]*)\"", _s), key=len)
box = open(tmp + "/box.txt").read()
gx, gy, gw, gh = map(float, box.split())
cx, cy = gx + gw / 2, gy + gh / 2
side = max(gw, gh) * 1.04
vb = '%.1f %.1f %.1f %.1f' % (cx - side/2, cy - side/2, side, side)
glyph = '<g transform="%s"><path d="%s"/></g>' % (tr, d)

open(B + 'glyph.svg', 'w').write('<svg xmlns="http://www.w3.org/2000/svg" viewBox="%s" fill="#000">\n<!-- Spokemark glyph, vectorized from assets/logo.png (potrace). Brand asset: see TRADEMARKS.md -->\n%s\n</svg>\n' % (vb, glyph))
# menu bar templates: idle = solid glyph; listening = glyph + indicator dot (knocked out)
open(B + 'tray-idle.svg', 'w').write('<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="%s" fill="#000">%s</svg>\n' % (vb, glyph))
x0, y0 = cx - side / 2, cy - side / 2
dx, dy, r = x0 + side * 0.84, y0 + side * 0.17, side * 0.115
open(B + 'tray-listening.svg', 'w').write('<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="%s" fill="#000">\n<defs><mask id="m"><rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" fill="#fff"/><circle cx="%.1f" cy="%.1f" r="%.1f" fill="#000"/></mask></defs>\n<g mask="url(#m)">%s</g><circle cx="%.1f" cy="%.1f" r="%.1f"/>\n</svg>\n' % (vb, x0, y0, side, side, dx, dy, r * 1.7, glyph, dx, dy, r))
def squircle(cx, cy, r, n=5.0, steps=240):
    pts = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        c, s = math.cos(t), math.sin(t)
        pts.append('%.1f,%.1f' % (cx + r * math.copysign(abs(c) ** (2 / n), c), cy + r * math.copysign(abs(s) ** (2 / n), s)))
    return 'M' + ' L'.join(pts) + ' Z'
sq = squircle(512, 512, 412)
gT = 'translate(100 100) scale(%.5f %.5f)' % (824/1032, 824/1005)
logo = '''<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<!-- Spokemark logo (vector recreation of assets/logo.png). Brand asset: see TRADEMARKS.md -->
<defs>
  <radialGradient id="body" cx="50%%" cy="46%%" r="62%%">
    <stop offset="0" stop-color="#020A2A"/><stop offset=".62" stop-color="#011A5C"/><stop offset=".9" stop-color="#0A3BC9"/><stop offset="1" stop-color="#1658FA"/>
  </radialGradient>
  <linearGradient id="glyph" x1="1" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#FFFFFF"/><stop offset=".45" stop-color="#E0EFFC"/><stop offset=".75" stop-color="#BBECFD"/><stop offset="1" stop-color="#18D2FD"/>
  </linearGradient>
  <filter id="glow" x="-20%%" y="-20%%" width="140%%" height="140%%"><feGaussianBlur stdDeviation="18"/></filter>
  <clipPath id="clip"><path d="%(sq)s"/></clipPath>
</defs>
<path d="%(sq)s" fill="url(#body)"/>
<g clip-path="url(#clip)">
  <g transform="%(gT)s" opacity=".85" filter="url(#glow)" fill="#1E7BFF">%(glyph)s</g>
  <g transform="%(gT)s" fill="url(#glyph)">%(glyph)s</g>
</g>
<path d="%(sq)s" fill="none" stroke="#2F6BFF" stroke-opacity=".9" stroke-width="5"/>
</svg>
''' % {'sq': sq, 'gT': gT, 'glyph': glyph}
open(B + 'logo.svg', 'w').write(logo)
print('viewBox', vb)
