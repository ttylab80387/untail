# Generates the Untail gecko icon sources. Run: python3 gen.py && render with rsvg-convert.
import math

def bez(p, t):
    u = 1 - t
    return tuple(u**3*a + 3*u*u*t*b + 3*u*t*t*c + t**3*d for a, b, c, d in zip(*p))

def dbez(p, t):
    u = 1 - t
    return tuple(3*u*u*(b-a) + 6*u*t*(c-b) + 3*t*t*(d-c) for a, b, c, d in zip(*p))

def tapered(p, w0, w1, n=32):
    left, right = [], []
    for i in range(n + 1):
        t = i / n
        x, y = bez(p, t)
        dx, dy = dbez(p, t)
        m = math.hypot(dx, dy)
        nx, ny = -dy / m, dx / m
        w = (w0 + (w1 - w0) * t) / 2
        left.append((x + nx*w, y + ny*w))
        right.append((x - nx*w, y - ny*w))
    pts = left + right[::-1]
    return 'M' + ' L'.join(f'{x:.2f} {y:.2f}' for x, y in pts) + ' Z'

# Body sits higher; the detached tail starts below a clear gap and curls to the right.
TAIL = ((50, 74), (50, 82), (58, 84), (61, 92))
LEGS = 'M42 37 L33.5 35.5 L31 29.5 M58 37 L66.5 35.5 L69 29.5 M42 55 L33.5 57 L31 63 M58 55 L66.5 57 L69 63'

def toes(x, y, up):
    d = -1 if up else 1
    return ' '.join(f'M{x} {y} L{x+dx} {y+d*dy}' for dx, dy in ((-3.2, 1.6), (0, 3.4), (3.2, 1.6)))

TOES = ' '.join([toes(31, 29.5, True), toes(69, 29.5, True), toes(31, 63, False), toes(69, 63, False)])

def glyph(fg, eye):
    eyes = f'<circle cx="44.6" cy="20.2" r="1.8" fill="{eye}"/><circle cx="55.4" cy="20.2" r="1.8" fill="{eye}"/>' if eye else ''
    return (
        f'<path d="M50 11.5 C56.5 11.5 59.5 17 58.6 22.5 C58 26.5 55 29.5 54 31.5 L46 31.5 C45 29.5 42 26.5 41.4 22.5 C40.5 17 43.5 11.5 50 11.5 Z" fill="{fg}"/>'
        f'<ellipse cx="50" cy="46" rx="9.6" ry="18" fill="{fg}"/>'
        f'<path d="{LEGS}" fill="none" stroke="{fg}" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/>'
        f'<path d="{TOES}" fill="none" stroke="{fg}" stroke-width="2.4" stroke-linecap="round"/>'
        f'<circle cx="50" cy="74" r="3.6" fill="{fg}"/>'
        f'<path d="{tapered(TAIL, 7.2, 0.4)}" fill="{fg}"/>'
        f'{eyes}'
    )

BG, FG = '#0f6b5f', '#ffffff'
CENTER_Y = 51.5  # vertical centre of the glyph's bounding box (y 11.5..92)

def svg(scale, bg, fg, eye):
    tx, ty = 50 - 50*scale, 50 - CENTER_Y*scale
    rect = f'<rect width="100" height="100" fill="{bg}"/>' if bg else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">{rect}'
            f'<g transform="translate({tx:.3f} {ty:.3f}) scale({scale})">{glyph(fg, eye)}</g></svg>\n')

# iOS / store icon: full-bleed background.
open('icon.svg', 'w').write(svg(0.86, BG, FG, BG))
# Android adaptive foreground: transparent, glyph inside the 66/108 safe zone.
open('adaptive-foreground.svg', 'w').write(svg(0.56, None, FG, BG))
# Android 13+ themed icon: one-colour silhouette (the system tints it), no eyes.
open('monochrome.svg', 'w').write(svg(0.56, None, '#000000', None))
