#!/usr/bin/env python3
"""
Generate every brand raster under `apps/web/public/` from the constants below.

    python3 apps/web/scripts/generate-icons.py

WHY A COMMITTED SCRIPT AND COMMITTED PNGs, RATHER THAN A BUILD STEP
=============================================================================
This repository is a TEMPLATE. A fork that rebrands it must not be forced to
install an image toolchain (sharp, ImageMagick, librsvg) in CI just to produce
a favicon, so no image library appears in any `package.json` and nothing in
`npm run build` calls this file. The PNGs it writes are committed; this script
is the documented, reproducible way to REGENERATE them after a rebrand, run by
hand, on a machine with Python 3 and Pillow:

    pip install --user 'Pillow>=10'

The mark itself also exists as hand-editable vector art in
`apps/web/public/icons/source.svg`. That SVG and the geometry constants in this
file describe the same mark and must be kept in step — this script deliberately
does NOT rasterise the SVG, because doing so would reintroduce exactly the
rendering dependency (rsvg / cairosvg / a headless browser) the committed-PNG
approach exists to avoid.

WHAT IT WRITES
=============================================================================
    public/icons/icon-192.png              192  manifest, purpose: any
    public/icons/icon-512.png              512  manifest, purpose: any
    public/icons/icon-maskable-192.png     192  manifest, purpose: maskable
    public/icons/icon-maskable-512.png     512  manifest, purpose: maskable
    public/icons/badge-96.png               96  notification badge, monochrome
    public/icons/apple-touch-icon-180.png  180  iOS Home Screen
    public/favicon.ico                   16/32/48 frames

`public/favicon.svg` and `public/icons/source.svg` are hand-written vector and
are NOT touched by this script.

Running it is idempotent: same inputs, byte-comparable outputs, every file
rewritten from scratch.

THREE PLATFORM RULES THIS ENCODES (get one wrong and the icon looks broken
only on the platform that cares)
=============================================================================
1. MASKABLE icons are cropped by the launcher to a shape it chooses — circle,
   squircle, teardrop. So their background is FULL-BLEED with no rounding of
   our own, and all meaningful content stays inside the centred safe-zone
   circle of 80% diameter. A maskable icon that reuses the standard artwork
   gets its own rounded corners shaved off.
2. The Android notification BADGE is used as an ALPHA MASK. Every opaque pixel
   is repainted in the system's colour, so a blue square would render as a
   solid blob. It is therefore a transparent canvas with the mark in white.
3. The iOS touch icon must have NO alpha channel at all: iOS composites
   transparency against black, so transparent corners come out as black
   corners. It is written as RGB with the rounded-square corners filled with
   the background colour.
"""

from __future__ import annotations

import os
from PIL import Image, ImageDraw

# =============================================================================
# Brand constants
# =============================================================================
# SOURCE OF TRUTH: `packages/shared/index.js` (`THEME_COLOR`, `BACKGROUND_COLOR`).
# That file is what the application, the theme and the manifest read at runtime;
# these two literals are its rasteriser-side copy, because a Python script
# cannot import a CommonJS module. If you rebrand, edit `packages/shared/index.js`
# FIRST, mirror the value here, then re-run this script.
BRAND_COLOR = "#1976d2"       # == THEME_COLOR
BACKGROUND_COLOR = "#ffffff"  # == BACKGROUND_COLOR (opaque fill for the iOS icon)

# The mark is drawn in this colour on the brand-coloured plate.
FOREGROUND_COLOR = "#ffffff"

# =============================================================================
# Mark geometry — all fractions, so the mark is resolution independent
# =============================================================================
# The mark: three horizontal rounded bars, centred, of decreasing width. It is
# deliberately generic (this is a template) and it silhouettes correctly — the
# widths still read as three distinct bars at 16px, which a glyph or a wordmark
# would not.
CORNER_RADIUS_RATIO = 0.22   # rounded-square plate radius, as a fraction of size
BAR_WIDTH_RATIOS = (1.00, 0.75, 0.50)  # top to bottom, as fractions of mark width
STACK_HEIGHT_RATIO = 0.86    # stack height as a fraction of mark width
BAR_HEIGHT_RATIO = 0.22      # one bar's height, as a fraction of stack height
BAR_GAP_RATIO = 0.17         # gap between bars, as a fraction of stack height
# 3 bars + 2 gaps must fill the stack exactly: 3(0.22) + 2(0.17) == 1.00. The
# gaps are wider than they need to look good at 512px on purpose: at 16px a bar
# is about two pixels tall, and a gap thinner than that merges the three bars
# into one smear.

# How much of the canvas the mark occupies, per icon family.
MARK_RATIO_STANDARD = 0.68   # rounded plate, corners are ours to shape
MARK_RATIO_MASKABLE = 0.50   # inside the 80%-diameter safe zone with room to spare
MARK_RATIO_BADGE = 0.70      # no plate, so the mark can breathe wider
MARK_RATIO_FAVICON = 0.80    # tab-sized: padding costs whole pixels, so spend fewer

# Anti-aliasing. Pillow's drawing primitives are hard-edged, so everything is
# drawn at this multiple and downsampled with LANCZOS; that resample IS the
# anti-aliasing. 8x rather than 4x because the 16px favicon frame is where it
# shows: at 4x its bar edges land on visibly coarser alpha steps.
SUPERSAMPLE = 8

# =============================================================================
# Paths
# =============================================================================
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.dirname(SCRIPT_DIR)           # apps/web
PUBLIC_DIR = os.path.join(WEB_DIR, "public")
ICONS_DIR = os.path.join(PUBLIC_DIR, "icons")

FAVICON_ICO_SIZES = (16, 32, 48)


def draw_mark(draw: ImageDraw.ImageDraw, size: int, mark_ratio: float, fill: str) -> None:
    """Draw the three-bar mark centred on a `size`x`size` canvas.

    `mark_ratio` is the width of the widest (top) bar as a fraction of the
    canvas; the stack is centred on both axes.
    """
    mark_width = size * mark_ratio
    stack_height = mark_width * STACK_HEIGHT_RATIO
    bar_height = stack_height * BAR_HEIGHT_RATIO
    bar_gap = stack_height * BAR_GAP_RATIO

    center_x = size / 2
    top = (size - stack_height) / 2
    # Pill ends: a radius of half the bar height is the largest that is still a
    # rounded rectangle rather than a lozenge with a flat middle.
    radius = bar_height / 2

    for index, width_ratio in enumerate(BAR_WIDTH_RATIOS):
        bar_width = mark_width * width_ratio
        y0 = top + index * (bar_height + bar_gap)
        draw.rounded_rectangle(
            (center_x - bar_width / 2, y0, center_x + bar_width / 2, y0 + bar_height),
            radius=radius,
            fill=fill,
        )


def render_standard(size: int, mark_ratio: float = MARK_RATIO_STANDARD) -> Image.Image:
    """Rounded brand-coloured plate, transparent corners, mark on top. RGBA."""
    scale = size * SUPERSAMPLE
    image = Image.new("RGBA", (scale, scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        (0, 0, scale - 1, scale - 1),
        radius=scale * CORNER_RADIUS_RATIO,
        fill=BRAND_COLOR,
    )
    draw_mark(draw, scale, mark_ratio, FOREGROUND_COLOR)
    return image.resize((size, size), Image.LANCZOS)


def render_maskable(size: int) -> Image.Image:
    """Full-bleed plate (the launcher applies its own mask), small mark. RGB.

    No alpha channel: every pixel is opaque by construction, and an RGB file
    makes it impossible to reintroduce transparent corners by accident.
    """
    scale = size * SUPERSAMPLE
    image = Image.new("RGB", (scale, scale), BRAND_COLOR)
    draw = ImageDraw.Draw(image)
    draw_mark(draw, scale, MARK_RATIO_MASKABLE, FOREGROUND_COLOR)
    return image.resize((size, size), Image.LANCZOS)


def render_badge(size: int) -> Image.Image:
    """Transparent canvas, white mark. RGBA — Android reads ONLY the alpha."""
    scale = size * SUPERSAMPLE
    image = Image.new("RGBA", (scale, scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw_mark(draw, scale, MARK_RATIO_BADGE, FOREGROUND_COLOR)
    return image.resize((size, size), Image.LANCZOS)


def render_apple_touch(size: int) -> Image.Image:
    """Rounded plate with the corners filled opaque. RGB — iOS renders alpha black."""
    standard = render_standard(size)
    canvas = Image.new("RGB", (size, size), BACKGROUND_COLOR)
    canvas.paste(standard, (0, 0), standard)
    return canvas


def main() -> None:
    os.makedirs(ICONS_DIR, exist_ok=True)

    outputs: list[tuple[str, Image.Image]] = [
        (os.path.join(ICONS_DIR, "icon-192.png"), render_standard(192)),
        (os.path.join(ICONS_DIR, "icon-512.png"), render_standard(512)),
        (os.path.join(ICONS_DIR, "icon-maskable-192.png"), render_maskable(192)),
        (os.path.join(ICONS_DIR, "icon-maskable-512.png"), render_maskable(512)),
        (os.path.join(ICONS_DIR, "badge-96.png"), render_badge(96)),
        (os.path.join(ICONS_DIR, "apple-touch-icon-180.png"), render_apple_touch(180)),
    ]

    for path, image in outputs:
        image.save(path, format="PNG", optimize=True)
        print(f"wrote {os.path.relpath(path, WEB_DIR)}  {image.size[0]}x{image.size[1]}  {image.mode}")

    # The .ico carries three frames because the contexts that still read it
    # differ: 16px is the browser tab, 32px the bookmark bar and taskbar, 48px
    # a Windows desktop shortcut. Each frame is rendered and downsampled
    # independently rather than letting the ICO encoder shrink one big frame —
    # the 16px bars survive the difference visibly. They also use the tighter
    # favicon crop, which `public/favicon.svg` matches.
    frames = [render_standard(size, MARK_RATIO_FAVICON) for size in FAVICON_ICO_SIZES]
    ico_path = os.path.join(PUBLIC_DIR, "favicon.ico")
    frames[-1].save(
        ico_path,
        format="ICO",
        sizes=[(size, size) for size in FAVICON_ICO_SIZES],
        append_images=frames[:-1],
    )
    print(
        f"wrote {os.path.relpath(ico_path, WEB_DIR)}  "
        f"{'/'.join(str(size) for size in FAVICON_ICO_SIZES)}px frames"
    )

    print("\nfavicon.svg and icons/source.svg are hand-written vector — not regenerated.")


if __name__ == "__main__":
    main()
