#!/usr/bin/env python3
"""Generate the built-in macOS-style wallpaper set via Gemini (generate_image.py).

Run once to populate static/wallpapers/. Safe to re-run (skips files that already exist
unless --force is passed).
"""
import os
import sys
from generate_image import generate_image

OUT_DIR = os.path.join(os.path.dirname(__file__), "static", "wallpapers")

WALLPAPERS = [
    ("wp-aurora-blue.png",
     "Abstract macOS-style desktop wallpaper, deep navy-to-teal gradient with flowing "
     "translucent silk ribbons of cyan and electric blue light curving across the frame, "
     "soft volumetric glow, layered depth, smooth bokeh, premium and serene, ultra-high "
     "detail, seamless gradients, no text no logos no watermark, 16:9 cinematic"),
    ("wp-sunrise-coral.png",
     "Abstract macOS-style desktop wallpaper, warm sunrise gradient blending coral, "
     "magenta, peach and golden amber, smooth flowing wave layers like soft folded fabric, "
     "gentle light bloom, dreamy and elegant, ultra-high detail, seamless gradients, "
     "no text no logos no watermark, 16:9 cinematic"),
    ("wp-graphite-fold.png",
     "Abstract macOS-style desktop wallpaper, dark graphite and charcoal monochrome, "
     "smooth folded matte-glass surfaces catching subtle silver rim light, minimal "
     "sophisticated depth, very dark for dark-mode UI, ultra-high detail, seamless "
     "gradients, no text no logos no watermark, 16:9 cinematic"),
    ("wp-emerald-glass.png",
     "Abstract macOS-style desktop wallpaper, layered translucent glass shards in emerald, "
     "jade and teal with soft refracted light and gentle gradients, calm and crisp, "
     "ultra-high detail, seamless gradients, no text no logos no watermark, 16:9 cinematic"),
    ("wp-violet-nebula.png",
     "Abstract macOS-style desktop wallpaper, smooth gradient mesh of deep indigo, violet "
     "and magenta with a soft nebula-like glow and faint flowing light streaks, rich and "
     "atmospheric, ultra-high detail, seamless gradients, no text no logos no watermark, "
     "16:9 cinematic"),
    ("wp-pastel-light.png",
     "Abstract macOS-style desktop wallpaper, soft pastel light gradient of off-white, "
     "pale sky blue and lavender with gentle flowing translucent waves, bright airy "
     "minimal, ideal background for light mode UI, ultra-high detail, seamless gradients, "
     "no text no logos no watermark, 16:9 cinematic"),
    ("login-bg.png",
     "Abstract dark moody desktop wallpaper, deep midnight blue to black gradient with "
     "subtle flowing aqua and violet light ribbons concentrated toward the center, strong "
     "dark vignette around the edges, cinematic depth and bokeh, premium login screen "
     "background, ultra-high detail, seamless gradients, no text no logos no watermark, "
     "16:9 cinematic"),
]


def main():
    force = "--force" in sys.argv
    os.makedirs(OUT_DIR, exist_ok=True)
    ok, skip, fail = 0, 0, 0
    for fname, prompt in WALLPAPERS:
        out = os.path.join(OUT_DIR, fname)
        if os.path.exists(out) and not force:
            print(f"⏭  skip (exists): {fname}")
            skip += 1
            continue
        print(f"🎨 generating: {fname}")
        result = generate_image(prompt, out)
        if result:
            ok += 1
        else:
            fail += 1
    print(f"\nDone. generated={ok} skipped={skip} failed={fail}")
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
