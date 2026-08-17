from __future__ import annotations

import colorsys
import math
import re
from collections import deque
from pathlib import Path
from statistics import median

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "01_source_data" / "sample_photos"
SAMPLE_EXTENSIONS = {".jpg", ".jpeg", ".png"}
DEFAULT_SETTINGS = {
    "top_crop": 0.25,
    "left_crop": 0.03,
    "right_crop": 0.03,
    "bottom_crop": 0.02,
    "sat_min": 14,
    "val_max": 220,
    "min_area": 180,
}


def expected_count(name: str) -> int | None:
    match = re.match(r"^(\d+)", name)
    return int(match.group(1)) if match else None


def percentile(values: list[float], ratio: float) -> float:
    if not values:
        return 0
    sorted_values = sorted(values)
    return sorted_values[round((len(sorted_values) - 1) * ratio)]


def mask_image(image: Image.Image, top_crop=0.25, left_crop=0.03, right_crop=0.03, bottom_crop=0.02, sat_min=14, val_max=220, min_area=180):
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
            chroma = max(r, g, b) - min(r, g, b)
            luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
            is_seed_hue = 18 <= h <= 78
            is_not_green = not (85 <= h <= 165 and s > 0.18)
            is_bright_low_color_shadow = luma > 145 and s < 0.24 and chroma < 34
            is_brown_seed_pixel = (
                is_seed_hue
                and is_not_green
                and s * 100 >= sat_min
                and v <= val_max
                and luma >= 35
                and chroma >= 10
            )
            is_dark_seed_pixel = luma <= 115 and v <= min(val_max, 155) and not (s < 0.08 and chroma < 14)
            if (
                (is_brown_seed_pixel or is_dark_seed_pixel)
                and not is_bright_low_color_shadow
            ):
                mask[y * width + x] = 1
    return denoise(mask, width, height), width, height


def faint_candidate_mask(image: Image.Image, top_crop=0.25, left_crop=0.03, right_crop=0.03, bottom_crop=0.02, sat_min=14, val_max=220, min_area=180):
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
            chroma = max(r, g, b) - min(r, g, b)
            luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
            is_faint_tan_seed_pixel = (
                18 <= h <= 78
                and not (85 <= h <= 165 and s > 0.18)
                and s >= 0.075
                and chroma >= 6
                and chroma <= 34
                and luma >= 70
                and luma <= 190
                and v <= min(val_max + 16, 232)
            )
            is_flat_bright_background = luma > 198 and s < 0.12 and chroma < 10
            if is_faint_tan_seed_pixel and not is_flat_bright_background:
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


def plausible_component(component: dict[str, float], width: int, height: int, min_area: int) -> bool:
    box_width = component["max_x"] - component["min_x"] + 1
    box_height = component["max_y"] - component["min_y"] + 1
    box_area = box_width * box_height
    fill_ratio = component["area"] / box_area if box_area else 0
    aspect_ratio = max(box_width / box_height, box_height / box_width)
    covers_too_much_frame = box_width > width * 0.62 or box_height > height * 0.62
    very_large = component["area"] > min_area * 90
    thin_artifact = aspect_ratio > 7 and component["area"] > min_area * 2
    sparse_artifact = fill_ratio < 0.10 and component["area"] > min_area * 2
    return not (covers_too_much_frame and very_large) and not thin_artifact and not sparse_artifact


def components(mask: bytearray, width: int, height: int, min_area=180):
    visited = bytearray(len(mask))
    found = []
    for i, value in enumerate(mask):
        if not value or visited[i]:
            continue
        visited[i] = 1
        q = deque([i])
        area = 0
        min_x = width
        max_x = 0
        min_y = height
        max_y = 0
        pixels = []
        while q:
            p = q.pop()
            pixels.append(p)
            area += 1
            x = p % width
            y = p // width
            min_x = min(min_x, x)
            max_x = max(max_x, x)
            min_y = min(min_y, y)
            max_y = max(max_y, y)
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
            component = {"area": area, "min_x": min_x, "max_x": max_x, "min_y": min_y, "max_y": max_y, "pixels": pixels}
            if plausible_component(component, width, height, min_area):
                found.append(component)
    return found


def shape_stats(component: dict[str, float]) -> dict[str, float]:
    box_width = component["max_x"] - component["min_x"] + 1
    box_height = component["max_y"] - component["min_y"] + 1
    box_area = box_width * box_height
    fill_ratio = component["area"] / box_area if box_area else 0
    aspect_ratio = max(box_width / box_height, box_height / box_width)
    equivalent_diameter = ((4 * component["area"]) / 3.141592653589793) ** 0.5
    box_diameter = max(box_width, box_height)
    completeness = equivalent_diameter / box_diameter if box_diameter else 0
    return {
        "box_width": box_width,
        "box_height": box_height,
        "fill_ratio": fill_ratio,
        "aspect_ratio": aspect_ratio,
        "completeness": completeness,
    }


def component_color_stats(image: Image.Image, component: dict[str, float]) -> dict[str, float]:
    rgb = image.convert("RGB")
    pixels = rgb.load()
    width, _ = rgb.size
    sum_s = 0
    sum_chroma = 0
    sum_luma = 0
    dark_pixels = 0
    color_pixels = 0
    component_pixels = component.get("pixels", [])
    for point in component_pixels:
        x = point % width
        y = point // width
        r, g, b = pixels[x, y]
        _, s, _ = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        chroma = max(r, g, b) - min(r, g, b)
        luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
        sum_s += s
        sum_chroma += chroma
        sum_luma += luma
        if luma <= 125:
            dark_pixels += 1
        if chroma >= 12 and s >= 0.10:
            color_pixels += 1
    area = len(component_pixels) or 1
    return {
        "mean_s": sum_s / area,
        "mean_chroma": sum_chroma / area,
        "mean_luma": sum_luma / area,
        "dark_fraction": dark_pixels / area,
        "color_fraction": color_pixels / area,
    }


def has_seed_color_evidence(component: dict[str, float], mode: str = "strong") -> bool:
    color = component.get("color_stats")
    if not color:
        return False
    flat_background = color["mean_luma"] > 155 and color["mean_chroma"] < 10 and color["dark_fraction"] < 0.04
    if flat_background:
        return False
    if mode == "faint":
        return (
            color["mean_chroma"] >= 7.5
            and color["mean_s"] >= 0.075
            and color["color_fraction"] >= 0.08
            and color["mean_luma"] <= 190
        )
    return (
        color["mean_chroma"] >= 11
        or color["mean_s"] >= 0.13
        or color["dark_fraction"] >= 0.18
        or color["color_fraction"] >= 0.18
    )


def enrich_and_filter_components(components_found: list[dict[str, float]], image: Image.Image, mode: str = "strong") -> list[dict[str, float]]:
    enriched = []
    for component in components_found:
        component = {**component, "color_stats": component_color_stats(image, component)}
        if has_seed_color_evidence(component, mode):
            enriched.append(component)
    return enriched


def auto_reference_stats(components_found: list[dict[str, float]]):
    if not components_found:
        return {"area": 0, "base": 0, "average": 0, "median_long_axis": 0, "median_short_axis": 0, "area_std": 0, "cv": 0, "single_count": 0}
    sorted_components = sorted(components_found, key=lambda item: item["area"])
    seed_like = [
        component
        for component in sorted_components
        if 0.42 <= shape_stats(component)["fill_ratio"] <= 0.90
        and shape_stats(component)["aspect_ratio"] <= 2.25
        and shape_stats(component)["completeness"] >= 0.60
        and component.get("color_stats", {}).get("mean_chroma", 0) >= 9
    ]
    candidate_areas = [component["area"] for component in seed_like] if len(seed_like) >= 4 else [component["area"] for component in sorted_components]
    sorted_areas = sorted(candidate_areas)
    index = round((len(sorted_areas) - 1) * 0.30)
    base = sorted_areas[index]
    likely_single_components = [
        component
        for component in sorted_components
        if base * 0.75 <= component["area"] <= base * 1.55
        and shape_stats(component)["fill_ratio"] >= 0.42
        and shape_stats(component)["aspect_ratio"] <= 2.35
        and shape_stats(component)["completeness"] >= 0.58
    ]
    singles = [component["area"] for component in likely_single_components] if len(likely_single_components) >= 4 else [base]
    single_shapes = [shape_stats(component) for component in likely_single_components] if len(likely_single_components) >= 4 else []
    average = sum(singles) / len(singles)
    if len(singles) > 1 and average:
        variance = sum((a - average) ** 2 for a in singles) / (len(singles) - 1)
        area_std = variance ** 0.5
        cv = area_std / average
    else:
        area_std = 0
        cv = 0
    blended = base * 0.25 + median(singles) * 0.35 + average * 0.40
    return {
        "area": round(blended),
        "base": round(base),
        "average": round(average),
        "median_long_axis": round(median([max(shape["box_width"], shape["box_height"]) for shape in single_shapes])),
        "median_short_axis": round(median([min(shape["box_width"], shape["box_height"]) for shape in single_shapes])),
        "area_std": round(area_std),
        "cv": cv,
        "single_count": len(singles),
        "method": "area-model",
    }


def component_estimate(component: dict[str, float], stats: dict[str, float]) -> int:
    ref = stats["area"]
    if not ref:
        return 0
    shape = shape_stats(component)
    area_ratio = component["area"] / ref
    area_estimate = estimate_by_area_distribution(component, stats)
    long_axis = max(shape["box_width"], shape["box_height"])
    short_axis = min(shape["box_width"], shape["box_height"])
    has_scale = stats["median_long_axis"] > 0 and stats["median_short_axis"] > 0
    long_axis_ratio = long_axis / stats["median_long_axis"] if has_scale else 0
    short_axis_ratio = short_axis / stats["median_short_axis"] if has_scale else 0
    looks_merged = (
        has_scale
        and area_ratio >= 1.10
        and long_axis_ratio >= 1.45
        and short_axis_ratio >= 0.70
        and shape["fill_ratio"] >= 0.32
        and shape["completeness"] >= 0.48
    )
    shape_estimate = max(2, round(long_axis_ratio)) if looks_merged else 1
    if looks_merged and area_estimate < 3:
        return max(area_estimate, min(shape_estimate, area_estimate + 1))
    return area_estimate


def box_area(component: dict[str, float]) -> int:
    return max(0, component["max_x"] - component["min_x"] + 1) * max(0, component["max_y"] - component["min_y"] + 1)


def box_intersection_area(a: dict[str, float], b: dict[str, float]) -> int:
    left = max(a["min_x"], b["min_x"])
    right = min(a["max_x"], b["max_x"])
    top = max(a["min_y"], b["min_y"])
    bottom = min(a["max_y"], b["max_y"])
    if right < left or bottom < top:
        return 0
    return (right - left + 1) * (bottom - top + 1)


def box_intersection_size(a: dict[str, float], b: dict[str, float]) -> dict[str, int]:
    left = max(a["min_x"], b["min_x"])
    right = min(a["max_x"], b["max_x"])
    top = max(a["min_y"], b["min_y"])
    bottom = min(a["max_y"], b["max_y"])
    if right < left or bottom < top:
        return {"width": 0, "height": 0}
    return {"width": right - left + 1, "height": bottom - top + 1}


def detection_confidence(item: dict[str, float]) -> float:
    shape = shape_stats(item)
    color = item.get("color_stats", {})
    return (
        min(1, shape["fill_ratio"]) * 1.5
        + min(1, shape["completeness"])
        + min(1, color.get("mean_chroma", 0) / 28)
        + min(1, color.get("dark_fraction", 0) * 2)
    )


def resolve_overlapping_counts(items: list[dict[str, float]], stats: dict[str, float]) -> list[dict[str, float]]:
    resolved = [dict(item) for item in items]
    adjusted = set()
    typical_long_axis = stats["median_long_axis"] or stats["area"] ** 0.5
    typical_short_axis = stats["median_short_axis"] or typical_long_axis
    typical_footprint = max(1, typical_long_axis * typical_short_axis)
    for i, a in enumerate(resolved):
        for j in range(i + 1, len(resolved)):
            b = resolved[j]
            if a["estimated"] < 4 or b["estimated"] < 4 or i in adjusted or j in adjusted:
                continue
            intersection = box_intersection_area(a, b)
            if not intersection:
                continue
            intersection_size = box_intersection_size(a, b)
            smaller_box_ratio = intersection / min(box_area(a), box_area(b))
            center_conflict = component_center_inside_box(a, b) or component_center_inside_box(b, a)
            seed_sized_conflict = (
                intersection / typical_footprint >= 0.35
                and intersection / typical_footprint <= 2.40
                and max(intersection_size["width"], intersection_size["height"]) >= typical_long_axis * 0.45
                and min(intersection_size["width"], intersection_size["height"]) >= typical_short_axis * 0.45
            )
            if smaller_box_ratio < 0.18 and not center_conflict and not seed_sized_conflict:
                continue
            target_index = i if detection_confidence(a) <= detection_confidence(b) else j
            target = resolved[target_index]
            target["estimated"] = max(1, target["estimated"] - 1)
            target["overlap_adjusted"] = True
            adjusted.add(target_index)
    return resolved


def estimate_by_area_distribution(component: dict[str, float], stats: dict[str, float]) -> int:
    mean_area = stats["average"] or stats["area"]
    if not mean_area:
        return 1
    area_std = max(stats.get("area_std", 0), mean_area * 0.12)
    area_multiple = component["area"] / mean_area
    rough = max(1, round(area_multiple))
    max_count = max(1, min(40, math.ceil(component["area"] / mean_area + 3)))
    best = rough
    best_score = float("inf")
    for count in range(1, max_count + 1):
        expected_area = count * mean_area
        spread = max(area_std * (count ** 0.5), mean_area * 0.18)
        score = abs(component["area"] - expected_area) / spread
        if score < best_score:
            best = count
            best_score = score
    residual = area_multiple - best
    if best >= 8 and residual >= 0.42 and area_std / mean_area <= 0.18:
        return best + 1
    return best


def component_center_inside_box(component: dict[str, float], box: dict[str, float], padding: int = 0) -> bool:
    return (
        component.get("cx", (component["min_x"] + component["max_x"]) / 2) >= box["min_x"] - padding
        and component.get("cx", (component["min_x"] + component["max_x"]) / 2) <= box["max_x"] + padding
        and component.get("cy", (component["min_y"] + component["max_y"]) / 2) >= box["min_y"] - padding
        and component.get("cy", (component["min_y"] + component["max_y"]) / 2) <= box["max_y"] + padding
    )


def merge_faint_single_candidates(strong_components: list[dict[str, float]], faint_components: list[dict[str, float]], stats: dict[str, float]) -> list[dict[str, float]]:
    if not stats["area"] or not faint_components:
        return strong_components
    median_short_axis = stats["median_short_axis"] or stats["area"] ** 0.5
    padding = max(4, round(median_short_axis * 0.30))
    accepted = []
    for component in faint_components:
        if any(component_center_inside_box(component, strong, padding) for strong in strong_components):
            continue
        if any(component_center_inside_box(component, existing, padding) for existing in accepted):
            continue
        shape = shape_stats(component)
        area_ratio = component["area"] / stats["area"]
        long_axis = max(shape["box_width"], shape["box_height"])
        short_axis = min(shape["box_width"], shape["box_height"])
        long_axis_ratio = long_axis / stats["median_long_axis"] if stats["median_long_axis"] else 1
        short_axis_ratio = short_axis / stats["median_short_axis"] if stats["median_short_axis"] else 1
        plausible_single = (
            area_ratio >= 0.22
            and area_ratio <= 1.25
            and shape["fill_ratio"] >= 0.34
            and shape["aspect_ratio"] <= 2.8
            and long_axis_ratio <= 1.45
            and short_axis_ratio >= 0.35
            and shape["completeness"] >= 0.46
        )
        if plausible_single:
            accepted.append(component)
    return [*strong_components, *accepted]


def detect_components_at_min_area(image: Image.Image, settings: dict[str, float], min_area: int) -> tuple[list[dict[str, float]], int, int]:
    local_settings = {**settings, "min_area": min_area}
    mask, width, height = mask_image(image, **local_settings)
    found = enrich_and_filter_components(components(mask, width, height, min_area), image, "strong")
    return found, width, height


def detect_faint_components_at_min_area(image: Image.Image, settings: dict[str, float], min_area: int) -> list[dict[str, float]]:
    local_settings = {**settings, "min_area": min_area}
    mask, width, height = faint_candidate_mask(image, **local_settings)
    return enrich_and_filter_components(components(mask, width, height, min_area), image, "faint")


def estimate(path: Path, reference: int | None = None, settings: dict[str, float] | None = None):
    image = Image.open(path)
    active_settings = settings or DEFAULT_SETTINGS.copy()
    active_min_area = round(active_settings["min_area"])
    components_found, width, height = detect_components_at_min_area(image, active_settings, active_min_area)
    if not components_found:
        active_min_area = max(10, round(active_settings["min_area"] * 0.08))
        components_found, width, height = detect_components_at_min_area(image, active_settings, active_min_area)
    if reference:
        stats = {"area": reference, "base": reference, "average": reference, "median_long_axis": 0, "median_short_axis": 0, "area_std": 0, "cv": 0, "single_count": 0, "method": "manual"}
    else:
        stats = auto_reference_stats(components_found)
    faint_components = detect_faint_components_at_min_area(image, active_settings, max(8, round(active_min_area * 0.25)))
    merged_components = merge_faint_single_candidates(components_found, faint_components, stats)
    estimated_components = [
        {**component, "estimated": component_estimate(component, stats)}
        for component in merged_components
    ] if stats["area"] else []
    resolved_components = resolve_overlapping_counts(estimated_components, stats)
    total = sum(component["estimated"] for component in resolved_components)
    areas = [component["area"] for component in resolved_components]
    return total, len(resolved_components), stats, sum(areas), active_settings


def main():
    rows = []
    sample_paths = sorted(path for path in SOURCE.iterdir() if path.suffix.lower() in SAMPLE_EXTENSIONS)
    for path in sample_paths:
        correct = expected_count(path.name)
        total, block_count, ref, seed_pixels, settings = estimate(path)
        rows.append([path.name, correct, total, total - correct, block_count, ref["area"], ref["average"], round(ref["cv"] * 100), ref["method"], settings])

    errors = [abs(row[3]) / row[1] * 100 for row in rows if row[1]]
    exact = sum(1 for row in rows if row[3] == 0)
    print(f"exact={exact}/{len(rows)}")
    print(f"mape={sum(errors) / len(errors):.2f}%")
    print("file\tcorrect\tauto\tdiff\tblocks\tauto_ref\tavg_single\tcv_pct\tmethod\tsettings")
    for row in rows:
        settings_text = ",".join(f"{key}={value}" for key, value in row[9].items())
        print("\t".join(map(str, row[:9] + [settings_text])))


if __name__ == "__main__":
    main()
