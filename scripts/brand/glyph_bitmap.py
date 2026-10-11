# logo.bmp -> glyph.pbm (squircle frame) + glyph box. Squircle and glyph limits were
# measured on the 1254 px artwork (x 110..1141, y 108..1112).
import struct, sys
src, out = sys.argv[1], sys.argv[2]
b = open(src, 'rb').read()
off = struct.unpack_from('<I', b, 10)[0]; w, h = struct.unpack_from('<ii', b, 18); bpp = struct.unpack_from('<H', b, 28)[0]
row = ((w * bpp // 8) + 3) // 4 * 4; bottom_up = h > 0; h = abs(h)
def g(x, y):
    yy = h - 1 - y if bottom_up else y
    return b[off + yy * row + x * (bpp // 8) + 1]  # green channel
X0, Y0, X1, Y1 = 110, 108, 1141, 1112   # squircle (coordinate frame)
IX0, IY0, IX1, IY1 = 170, 170, 1080, 1050  # interior: excludes the bright rim
rows, box = [], [10**9, 10**9, -1, -1]
for y in range(Y0, Y1 + 1):
    r = []
    for x in range(X0, X1 + 1):
        on = IX0 <= x <= IX1 and IY0 <= y <= IY1 and not (x < 260 and y < 260) and g(x, y) > 140
        r.append('1' if on else '0')
        if on: box = [min(box[0], x), min(box[1], y), max(box[2], x), max(box[3], y)]
    rows.append(''.join(r))
open(f'{out}/glyph.pbm', 'w').write(f'P1\n{X1 - X0 + 1} {Y1 - Y0 + 1}\n' + '\n'.join(rows) + '\n')
open(f'{out}/box.txt', 'w').write(f'{box[0] - X0} {box[1] - Y0} {box[2] - box[0] + 1} {box[3] - box[1] + 1}')
