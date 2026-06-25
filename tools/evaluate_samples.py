from __future__ import annotations

import colorsys
import re
from collections import deque
from pathlib import Path
from statistics import median

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "Source"


def expected_count(name: str) -> int | None:
    match = re.match(r"^(\d+)", name)
    return int(match.group(1)) if match else None


def mask_image(image: Image.Image, top_crop=0.25, left_crop=0.03, right_crop=0.03, bottom_crop=0.02, sat_min=14, val_max=220):
    rgb = image.convert("RGB")
    width, height = rgb.size
    pixels = rgb.load()
    top_y = int(height * top_crop)
    left_x = int(width * left_crop)
    right_x = int(width * (1 - right_crop))
    bottom_y = int(height * (1 - bottom_crop))
    mask = bytearray(width * height)
    for y in range(top_y, bottom_y):
        for x in range(left_x, right_x):
            r, g, b = pixels[x, y]
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            h *= 360
            v *= 255
            luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
            is_seed_hue = 18 <= h <= 78
            is_not_green = not (85 <= h <= 165 and s > 0.18)
            if is_seed_hue and is_not_green and s * 100 >= sat_min and v <= val_max and luma >= 45:
                mask[y * width + x] = 1
    return denoise(mask, width, height), width, height


def denoise(mask: bytearray, width: int, height: int) -> bytearray:
    out = bytearray(len(mask))
    for y in range(1, height - 1):
        row = y * width
        for x in range(1, width - 1):
            n = 0
            for yy in (-1, 0, 1):
                base = (y + yy) * width
                for xx in (-1, 0, 1):
                    n += mask[base + x + xx]
            if n >= 3:
                out[row + x] = 1
    return out


def components(mask: bytearray, width: int, height: int, min_area=180):
    visited = bytearray(len(mask))
    found = []
    for i, value in enumerate(mask):
        if not value or visited[i]:
            continue
        visited[i] = 1
        q = deque([i])
        area = 0
        while q:
            p = q.pop()
            area += 1
            x = p % width
            for step in (-1, 1, -width, width):
                nxt = p + step
                if nxt < 0 or nxt >= len(mask) or visited[nxt] or not mask[nxt]:
                    continue
                if step == -1 and x == 0:
                    continue
                if step == 1 and x == width - 1:
                    continue
                visited[nxt] = 1
                q.append(nxt)
        if area >= min_area:
            found.append(area)
    return found


def auto_reference_stats(areas: list[int]):
    if not areas:
        return {"area": 0, "base": 0, "average": 0, "cv": 0, "single_count": 0}
    sorted_areas = sorted(areas)
    index = round((len(sorted_areas) - 1) * 0.30)
    base = sorted_areas[index]
    likely_singles = [a for a in sorted_areas if base * 0.75 <= a <= base * 1.75]
    singles = likely_singles if len(likely_singles) >= 5 else [base]
    average = sum(singles) / len(singles)
    if len(singles) > 1 and average:
        variance = sum((a - average) ** 2 for a in singles) / (len(singles) - 1)
        cv = variance ** 0.5 / average
    else:
        cv = 0
    blended = base * 0.65 + average * 0.35
    return {
        "area": round(blended),
        "base": round(base),
        "average": round(average),
        "cv": cv,
        "single_count": len(singles),
    }


def estimate(path: Path, reference: int | None = None):
    image = Image.open(path)
    mask, width, height = mask_image(image)
    areas = components(mask, width, height)
    stats = {"area": reference, "base": reference, "average": reference, "cv": 0, "single_count": 0} if reference else auto_reference_stats(areas)
    ref = stats["area"]
    total = sum(max(1, round(a / ref)) for a in areas) if ref else 0
    return total, len(areas), stats, sum(areas)


def main():
    rows = []
    calibrated_refs = []
    for path in sorted(SOURCE.glob("*.jpg")):
        correct = expected_count(path.name)
        total, block_count, ref, seed_pixels = estimate(path)
        if correct:
            calibrated_refs.append(round(seed_pixels / correct))
        rows.append([path.name, correct, total, total - correct, block_count, ref["area"], ref["average"], round(ref["cv"] * 100)])

    global_ref = round(median(calibrated_refs))
    print(f"global_ref_from_filenames={global_ref}")
    print("file\tcorrect\tauto\tdiff\tblocks\tauto_ref\tavg_single\tcv_pct\tglobal\tdiff_global")
    for row in rows:
        path = SOURCE / row[0]
        correct = row[1]
        total, _, _, _ = estimate(path, reference=global_ref)
        print("\t".join(map(str, row + [total, total - correct])))


if __name__ == "__main__":
    main()
