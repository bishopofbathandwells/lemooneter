#!/usr/bin/env python3
"""Preprocess a raw subject photo for Lemooneter.

Pipeline (designed for sources on solid black backgrounds, the dominant
style of the current image set):

    1. Threshold luminance > T --> foreground mask
    2. Keep the largest connected component (rejects stray bright pixels)
    3. Fill interior holes (so dark internal features like the smiley's
       eyes or the cheese moon's craters stay opaque)
    4. Erode the mask by N pixels so the alpha boundary sits on
       fully-interior pixels rather than on the contaminated rim
    5. Gaussian-blur the mask edge (sigma=1.0) for anti-aliasing
    6. Crop to bbox + padding, square the canvas, resize to TARGET with
       Lanczos
    7. Save as transparent WebP at the requested quality

Usage:
    python tools/prepare_image.py raw-fruits/lemon.jpg fruits/lemon.webp
    python tools/prepare_image.py raw-fruits/moon.jpg  fruits/moon.webp --extra-inset

Dependencies: pillow, numpy, scipy. Install with:
    python -m pip install pillow numpy scipy
"""
from __future__ import annotations

import argparse
import os
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

TARGET_PX = 1024
PAD_PX = 22
BLUR_SIGMA = 1.0


def process(
    input_path: str,
    output_path: str,
    lum_thresh: int = 12,
    extra_inset: bool = False,
    quality: int = 90,
) -> None:
    src = Image.open(input_path).convert("RGB")
    arr = np.array(src)
    H, W = arr.shape[:2]

    # 1. Threshold the source to find foreground pixels.
    lum = arr.astype(np.int32).mean(axis=2)
    fg = lum > lum_thresh

    # 2. Keep the largest connected component.
    labeled, n = ndimage.label(fg)
    if n == 0:
        sys.exit(f"No foreground above threshold {lum_thresh} in {input_path}")
    sizes = ndimage.sum(fg, labeled, range(1, n + 1))
    fg = labeled == (np.argmax(sizes) + 1)

    # 3. Fill interior holes so dark internal features stay opaque.
    fg = ndimage.binary_fill_holes(fg)

    # 4. Erode the mask. The moon photo has a bright limb that benefits from
    #    a more aggressive inset; most fruits don't need it.
    n_erode = 5 if extra_inset else 3
    fg_eroded = ndimage.binary_erosion(fg, iterations=n_erode)

    # 5. Anti-alias the edge with a small Gaussian blur.
    alpha = (fg_eroded.astype(np.uint8) * 255)
    alpha_img = Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(BLUR_SIGMA))
    alpha_arr = np.array(alpha_img)

    ys, xs = np.where(fg_eroded)
    if len(xs) == 0:
        sys.exit(f"Mask emptied after erosion in {input_path} -- check the source")
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())

    # 6. Build RGBA, crop tight square around the subject, resize.
    rgba = np.dstack([arr, alpha_arr])
    img = Image.fromarray(rgba, "RGBA")
    cx_ = (x0 + x1) // 2
    cy_ = (y0 + y1) // 2
    half = max(x1 - x0, y1 - y0) // 2 + PAD_PX
    sx0, sy0 = max(0, cx_ - half), max(0, cy_ - half)
    sx1, sy1 = min(W, cx_ + half), min(H, cy_ + half)
    crop = img.crop((sx0, sy0, sx1, sy1))
    cw, ch = crop.size
    side = max(cw, ch)
    if cw != ch:
        canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        canvas.paste(crop, ((side - cw) // 2, (side - ch) // 2))
        crop = canvas
    crop = crop.resize((TARGET_PX, TARGET_PX), Image.LANCZOS)

    # 7. Save.
    out_dir = os.path.dirname(output_path)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    crop.save(output_path, "WEBP", quality=quality, method=6)
    bbox_w, bbox_h = x1 - x0 + 1, y1 - y0 + 1
    print(
        f"{input_path} -> {output_path}: "
        f"bbox {bbox_w}x{bbox_h}, {os.path.getsize(output_path)} bytes"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input", help="Raw source image (JPEG/PNG, black background)")
    parser.add_argument("output", help="Output WebP path")
    parser.add_argument(
        "--lum-thresh", type=int, default=12,
        help="Luminance cutoff for foreground (0-255). Default: 12.",
    )
    parser.add_argument(
        "--extra-inset", action="store_true",
        help="Erode 5 px instead of 3. Use for the moon photo or any subject with a bright thin limb.",
    )
    parser.add_argument(
        "--quality", type=int, default=90,
        help="WebP quality (0-100). Default: 90.",
    )
    args = parser.parse_args()
    process(args.input, args.output, args.lum_thresh, args.extra_inset, args.quality)


if __name__ == "__main__":
    main()
