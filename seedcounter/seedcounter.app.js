const samples = [
  "20.png",
  "20(2).png",
  "20(3).png",
  "55.jpg",
  "82.jpg",
  "102.jpg",
  "103.jpg",
  "103 (2).jpg",
  "103 (3).jpg",
  "103 (4).jpg",
  "104.jpg",
  "108.jpg",
  "115.jpg",
];

const state = {
  image: null,
  sourceName: "",
  expectedCount: null,
  adjustment: 0,
  last: null,
  cameraStream: null,
  roiPoints: [],
  isDrawingRoi: false,
  draggingRoiIndex: null,
  roiDragFrame: null,
};

const defaultSettings = {
  topCrop: 25,
  leftCrop: 3,
  rightCrop: 3,
  bottomCrop: 2,
  satMin: 14,
  valMax: 220,
  minArea: 180,
};

const els = {
  canvas: document.getElementById("canvas"),
  stage: document.querySelector(".stage"),
  camera: document.getElementById("camera"),
  empty: document.getElementById("emptyState"),
  count: document.getElementById("countValue"),
  components: document.getElementById("componentValue"),
  area: document.getElementById("areaValue"),
  adjustment: document.getElementById("adjustValue"),
  source: document.getElementById("sourceValue"),
  report: document.getElementById("report"),
  fileInput: document.getElementById("fileInput"),
  startCamera: document.getElementById("startCamera"),
  capturePhoto: document.getElementById("capturePhoto"),
  recount: document.getElementById("recount"),
  copyReport: document.getElementById("copyReport"),
  plusOne: document.getElementById("plusOne"),
  minusOne: document.getElementById("minusOne"),
  resetAdjust: document.getElementById("resetAdjust"),
  startRoi: document.getElementById("startRoi"),
  finishRoi: document.getElementById("finishRoi"),
  clearRoi: document.getElementById("clearRoi"),
  roiStatus: document.getElementById("roiStatus"),
  controls: {
    satMin: document.getElementById("satMin"),
    valMax: document.getElementById("valMax"),
    minArea: document.getElementById("minArea"),
    manualArea: document.getElementById("manualArea"),
  },
  outputs: {
    satMin: document.getElementById("satMinOut"),
    valMax: document.getElementById("valMaxOut"),
    minArea: document.getElementById("minAreaOut"),
  },
};

const ctx = els.canvas.getContext("2d", { willReadFrequently: true });

function parseExpectedCount(name) {
  const match = name.match(/^(\d+)/);
  return match ? Number(match[1]) : null;
}

function setCanvasSize(width, height) {
  els.canvas.width = width;
  els.canvas.height = height;
}

function loadImage(src, name) {
  const img = new Image();
  img.onload = () => {
    showCanvas();
    state.image = img;
    state.sourceName = name;
    state.expectedCount = parseExpectedCount(name);
    state.adjustment = 0;
    state.roiPoints = [];
    state.isDrawingRoi = false;
    setCanvasSize(img.naturalWidth, img.naturalHeight);
    suggestDetectionParameters();
    showLoadedStage();
    processImage();
  };
  img.onerror = () => {
    els.report.value = `Unable to load image: ${name}`;
  };
  img.src = src;
}

function showLoadedStage() {
  els.empty.hidden = true;
  els.stage.classList.add("is-loaded");
  els.stage.classList.remove("is-previewing");
}

function showCameraPreview() {
  els.camera.hidden = false;
  els.canvas.hidden = true;
  els.empty.hidden = true;
  els.stage.classList.add("is-previewing");
  els.stage.classList.remove("is-loaded");
}

function showCanvas() {
  els.camera.hidden = true;
  els.canvas.hidden = false;
}

function syncOutputs() {
  els.outputs.satMin.textContent = els.controls.satMin.value;
  els.outputs.valMax.textContent = els.controls.valMax.value;
  els.outputs.minArea.textContent = els.controls.minArea.value;
  syncRoiStatus();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.round((sorted.length - 1) * ratio)];
}

function setRangeValue(control, value) {
  control.value = String(Math.round(clamp(value, Number(control.min), Number(control.max))));
}

function suggestDetectionParameters() {
  if (!state.image) return;
  els.controls.manualArea.value = "";
  setRangeValue(els.controls.satMin, defaultSettings.satMin);
  setRangeValue(els.controls.valMax, defaultSettings.valMax);
  setRangeValue(els.controls.minArea, defaultSettings.minArea);
  syncOutputs();
}

function syncRoiStatus() {
  if (!els.roiStatus) return;
  const pointCount = state.roiPoints.length;
  els.stage.classList.toggle("is-drawing-roi", state.isDrawingRoi);
  els.stage.classList.toggle("is-editing-roi", state.draggingRoiIndex !== null);
  els.startRoi.disabled = !state.image;
  els.finishRoi.disabled = !state.isDrawingRoi || pointCount < 3;
  els.clearRoi.disabled = !state.image || pointCount === 0;
  if (state.draggingRoiIndex !== null) {
    els.roiStatus.textContent = `Editing point ${state.draggingRoiIndex + 1}`;
  } else if (state.isDrawingRoi) {
    els.roiStatus.textContent = `${pointCount} point${pointCount === 1 ? "" : "s"} selected`;
  } else if (pointCount >= 3) {
    els.roiStatus.textContent = `Polygon ROI active (${pointCount} points)`;
  } else {
    els.roiStatus.textContent = "No ROI";
  }
}

function canvasPointFromEvent(event) {
  const rect = els.canvas.getBoundingClientRect();
  const canvasRatio = els.canvas.width / els.canvas.height;
  const rectRatio = rect.width / rect.height;
  let drawWidth = rect.width;
  let drawHeight = rect.height;
  let offsetX = 0;
  let offsetY = 0;
  if (rectRatio > canvasRatio) {
    drawWidth = rect.height * canvasRatio;
    offsetX = (rect.width - drawWidth) / 2;
  } else {
    drawHeight = rect.width / canvasRatio;
    offsetY = (rect.height - drawHeight) / 2;
  }
  const x = ((event.clientX - rect.left - offsetX) / drawWidth) * els.canvas.width;
  const y = ((event.clientY - rect.top - offsetY) / drawHeight) * els.canvas.height;
  if (x < 0 || y < 0 || x > els.canvas.width || y > els.canvas.height) return null;
  return { x, y };
}

function nearestRoiPointIndex(point) {
  if (state.roiPoints.length < 3 || state.isDrawingRoi) return null;
  const radius = Math.max(12, Math.min(24, els.canvas.width * 0.018));
  let nearest = null;
  let nearestDistance = Infinity;
  state.roiPoints.forEach((roiPoint, index) => {
    const distance = Math.hypot(point.x - roiPoint.x, point.y - roiPoint.y);
    if (distance <= radius && distance < nearestDistance) {
      nearest = index;
      nearestDistance = distance;
    }
  });
  return nearest;
}

function updateDraggedRoiPoint(point) {
  if (state.draggingRoiIndex === null) return;
  state.roiPoints[state.draggingRoiIndex] = {
    x: clamp(point.x, 0, els.canvas.width),
    y: clamp(point.y, 0, els.canvas.height),
  };
  if (state.roiDragFrame) return;
  state.roiDragFrame = requestAnimationFrame(() => {
    state.roiDragFrame = null;
    processImage();
  });
}

function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

function makeMask(imageData, width, height, settings) {
  const mask = new Uint8Array(width * height);
  const data = imageData.data;
  const roi = settings.roiPoints?.length >= 3 ? settings.roiPoints : null;
  const topY = roi ? Math.max(0, Math.floor(Math.min(...roi.map((point) => point.y)))) : Math.floor(height * settings.topCrop);
  const leftX = roi ? Math.max(0, Math.floor(Math.min(...roi.map((point) => point.x)))) : Math.floor(width * settings.leftCrop);
  const rightX = roi ? Math.min(width, Math.ceil(Math.max(...roi.map((point) => point.x)))) : Math.floor(width * (1 - settings.rightCrop));
  const bottomY = roi ? Math.min(height, Math.ceil(Math.max(...roi.map((point) => point.y)))) : Math.floor(height * (1 - settings.bottomCrop));

  for (let y = topY; y < bottomY; y += 1) {
    for (let x = leftX; x < rightX; x += 1) {
      if (roi && !pointInPolygon(x + 0.5, y + 0.5, roi)) continue;
      const offset = (y * width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const { h, s, v } = rgbToHsv(r, g, b);
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const isSeedHue = h >= 18 && h <= 78;
      const isNotGreen = !(h >= 85 && h <= 165 && s > 0.18);
      const isBrightLowColorShadow = luma > 145 && s < 0.24 && chroma < 34;
      const isBrownSeedPixel =
        isSeedHue &&
        isNotGreen &&
        s * 100 >= settings.satMin &&
        v <= settings.valMax &&
        luma >= 35 &&
        chroma >= 10;
      const isDarkSeedPixel = luma <= 115 && v <= Math.min(settings.valMax, 155) && !(s < 0.08 && chroma < 14);
      const isSeedPixel =
        (isBrownSeedPixel || isDarkSeedPixel) &&
        !isBrightLowColorShadow;
      if (isSeedPixel) mask[y * width + x] = 1;
    }
  }
  return mask;
}

function makeFaintCandidateMask(imageData, width, height, settings) {
  const mask = new Uint8Array(width * height);
  const data = imageData.data;
  const roi = settings.roiPoints?.length >= 3 ? settings.roiPoints : null;
  const topY = roi ? Math.max(0, Math.floor(Math.min(...roi.map((point) => point.y)))) : Math.floor(height * settings.topCrop);
  const leftX = roi ? Math.max(0, Math.floor(Math.min(...roi.map((point) => point.x)))) : Math.floor(width * settings.leftCrop);
  const rightX = roi ? Math.min(width, Math.ceil(Math.max(...roi.map((point) => point.x)))) : Math.floor(width * (1 - settings.rightCrop));
  const bottomY = roi ? Math.min(height, Math.ceil(Math.max(...roi.map((point) => point.y)))) : Math.floor(height * (1 - settings.bottomCrop));

  for (let y = topY; y < bottomY; y += 1) {
    for (let x = leftX; x < rightX; x += 1) {
      if (roi && !pointInPolygon(x + 0.5, y + 0.5, roi)) continue;
      const offset = (y * width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const { h, s, v } = rgbToHsv(r, g, b);
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const isFaintTanSeedPixel =
        h >= 18 &&
        h <= 78 &&
        !(h >= 85 && h <= 165 && s > 0.18) &&
        s >= 0.075 &&
        chroma >= 6 &&
        chroma <= 34 &&
        luma >= 70 &&
        luma <= 190 &&
        v <= Math.min(settings.valMax + 16, 232);
      const isFlatBrightBackground = luma > 198 && s < 0.12 && chroma < 10;
      if (isFaintTanSeedPixel && !isFlatBrightBackground) mask[y * width + x] = 1;
    }
  }
  return mask;
}

function denoise(mask, width, height) {
  const out = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let n = 0;
      for (let yy = -1; yy <= 1; yy += 1) {
        for (let xx = -1; xx <= 1; xx += 1) {
          n += mask[(y + yy) * width + x + xx];
        }
      }
      out[y * width + x] = n >= 3 ? 1 : 0;
    }
  }
  return out;
}

function isPlausibleComponent(component, imageWidth, imageHeight, minArea) {
  const boxWidth = component.maxX - component.minX + 1;
  const boxHeight = component.maxY - component.minY + 1;
  const boxArea = boxWidth * boxHeight;
  const fillRatio = boxArea > 0 ? component.area / boxArea : 0;
  const aspectRatio = Math.max(boxWidth / boxHeight, boxHeight / boxWidth);
  const coversTooMuchFrame = boxWidth > imageWidth * 0.62 || boxHeight > imageHeight * 0.62;
  const veryLarge = component.area > minArea * 90;
  const thinArtifact = aspectRatio > 7 && component.area > minArea * 2;
  const sparseArtifact = fillRatio < 0.10 && component.area > minArea * 2;

  return !(coversTooMuchFrame && veryLarge) && !thinArtifact && !sparseArtifact;
}

function connectedComponents(mask, width, height, minArea) {
  const visited = new Uint8Array(mask.length);
  const components = [];
  const stack = [];
  const neighbors = [-1, 1, -width, width];

  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i] || visited[i]) continue;
    visited[i] = 1;
    stack.length = 0;
    stack.push(i);
    let area = 0;
    let sumX = 0;
    let sumY = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    const pixels = [];

    while (stack.length) {
      const p = stack.pop();
      const x = p % width;
      const y = Math.floor(p / width);
      pixels.push(p);
      area += 1;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      for (const step of neighbors) {
        const next = p + step;
        if (next < 0 || next >= mask.length || visited[next] || !mask[next]) continue;
        if (step === -1 && x === 0) continue;
        if (step === 1 && x === width - 1) continue;
        visited[next] = 1;
        stack.push(next);
      }
    }

    if (area >= minArea) {
      const component = {
        area,
        cx: sumX / area,
        cy: sumY / area,
        minX,
        maxX,
        minY,
        maxY,
        pixels,
      };
      if (isPlausibleComponent(component, width, height, minArea)) {
        components.push(component);
      }
    }
  }
  return components;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values, average) {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function componentColorStats(imageData, component) {
  const data = imageData.data;
  let sumS = 0;
  let sumChroma = 0;
  let sumLuma = 0;
  let darkPixels = 0;
  let colorPixels = 0;

  component.pixels.forEach((point) => {
    const offset = point * 4;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const { s } = rgbToHsv(r, g, b);
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sumS += s;
    sumChroma += chroma;
    sumLuma += luma;
    if (luma <= 125) darkPixels += 1;
    if (chroma >= 12 && s >= 0.10) colorPixels += 1;
  });

  const area = component.pixels.length || 1;
  return {
    meanS: sumS / area,
    meanChroma: sumChroma / area,
    meanLuma: sumLuma / area,
    darkFraction: darkPixels / area,
    colorFraction: colorPixels / area,
  };
}

function hasSeedColorEvidence(component, mode = "strong") {
  const color = component.colorStats;
  if (!color) return false;
  const flatBackground = color.meanLuma > 155 && color.meanChroma < 10 && color.darkFraction < 0.04;
  if (flatBackground) return false;

  if (mode === "faint") {
    return color.meanChroma >= 7.5 &&
      color.meanS >= 0.075 &&
      color.colorFraction >= 0.08 &&
      color.meanLuma <= 190;
  }

  return color.meanChroma >= 11 ||
    color.meanS >= 0.13 ||
    color.darkFraction >= 0.18 ||
    color.colorFraction >= 0.18;
}

function enrichAndFilterComponents(components, imageData, mode = "strong") {
  return components
    .map((component) => ({ ...component, colorStats: componentColorStats(imageData, component) }))
    .filter((component) => hasSeedColorEvidence(component, mode));
}

function shapeStatsFor(component) {
  const boxWidth = component.maxX - component.minX + 1;
  const boxHeight = component.maxY - component.minY + 1;
  const boxArea = boxWidth * boxHeight;
  const fillRatio = boxArea > 0 ? component.area / boxArea : 0;
  const aspectRatio = Math.max(boxWidth / boxHeight, boxHeight / boxWidth);
  const equivalentDiameter = Math.sqrt((4 * component.area) / Math.PI);
  const boxDiameter = Math.max(boxWidth, boxHeight);
  const completeness = boxDiameter > 0 ? equivalentDiameter / boxDiameter : 0;
  return { boxWidth, boxHeight, fillRatio, aspectRatio, completeness };
}

function referenceStatsFor(components) {
  const manual = Number(els.controls.manualArea.value);
  if (manual > 0) {
    return {
      area: manual,
      baseArea: manual,
      averageArea: manual,
      medianLongAxis: 0,
      medianShortAxis: 0,
      areaStd: 0,
      cv: 0,
      singleCount: 0,
      method: "manual",
    };
  }
  if (!components.length) {
    return {
      area: 0,
      baseArea: 0,
      averageArea: 0,
      medianLongAxis: 0,
      medianShortAxis: 0,
      areaStd: 0,
      cv: 0,
      singleCount: 0,
      method: "none",
    };
  }
  const sortedComponents = [...components].sort((a, b) => a.area - b.area);
  const seedLikeComponents = sortedComponents.filter((component) => {
    const shape = shapeStatsFor(component);
    return shape.fillRatio >= 0.42 &&
      shape.fillRatio <= 0.90 &&
      shape.aspectRatio <= 2.25 &&
      shape.completeness >= 0.60 &&
      component.colorStats?.meanChroma >= 9;
  });
  const candidateAreas = seedLikeComponents.length >= 4
    ? seedLikeComponents.map((component) => component.area)
    : sortedComponents.map((component) => component.area);
  const sorted = [...candidateAreas].sort((a, b) => a - b);
  const index = Math.round((sorted.length - 1) * 0.30);
  const baseArea = sorted[index];
  const likelySingleComponents = sortedComponents.filter((component) => {
    const shape = shapeStatsFor(component);
    return component.area >= baseArea * 0.75 &&
      component.area <= baseArea * 1.55 &&
      shape.fillRatio >= 0.42 &&
      shape.aspectRatio <= 2.35 &&
      shape.completeness >= 0.58;
  });
  const singles = likelySingleComponents.length >= 4 ? likelySingleComponents.map((component) => component.area) : [baseArea];
  const singleShapes = likelySingleComponents.length >= 4
    ? likelySingleComponents.map((component) => shapeStatsFor(component))
    : [];
  const averageArea = mean(singles);
  const areaStd = standardDeviation(singles, averageArea);
  const cv = averageArea ? areaStd / averageArea : 0;
  const blendedArea = baseArea * 0.25 + median(singles) * 0.35 + averageArea * 0.40;
  return {
    area: Math.round(blendedArea),
    baseArea: Math.round(baseArea),
    averageArea: Math.round(averageArea),
    medianLongAxis: Math.round(median(singleShapes.map((shape) => Math.max(shape.boxWidth, shape.boxHeight)))),
    medianShortAxis: Math.round(median(singleShapes.map((shape) => Math.min(shape.boxWidth, shape.boxHeight)))),
    areaStd: Math.round(areaStd),
    cv,
    singleCount: singles.length,
    method: "area-model",
  };
}

function estimateByAreaDistribution(component, referenceStats) {
  const meanArea = referenceStats.averageArea || referenceStats.area;
  if (!meanArea) return 1;
  const areaStd = Math.max(referenceStats.areaStd || 0, meanArea * 0.12);
  const areaMultiple = component.area / meanArea;
  const rough = Math.max(1, Math.round(areaMultiple));
  const maxCount = Math.max(1, Math.min(40, Math.ceil(component.area / meanArea + 3)));
  let best = rough;
  let bestScore = Infinity;

  for (let count = 1; count <= maxCount; count += 1) {
    const expectedArea = count * meanArea;
    const spread = Math.max(areaStd * Math.sqrt(count), meanArea * 0.18);
    const score = Math.abs(component.area - expectedArea) / spread;
    if (score < bestScore) {
      best = count;
      bestScore = score;
    }
  }

  const residual = areaMultiple - best;
  if (best >= 8 && residual >= 0.42 && areaStd / meanArea <= 0.18) {
    return best + 1;
  }

  return best;
}

function estimateCounts(components, referenceStats) {
  return components.map((component) => {
    const shape = shapeStatsFor(component);
    const areaRatio = referenceStats.area > 0 ? component.area / referenceStats.area : 1;
    const areaEstimate = referenceStats.area > 0 ? estimateByAreaDistribution(component, referenceStats) : 1;
    const longAxis = Math.max(shape.boxWidth, shape.boxHeight);
    const shortAxis = Math.min(shape.boxWidth, shape.boxHeight);
    const hasScale = referenceStats.medianLongAxis > 0 && referenceStats.medianShortAxis > 0;
    const longAxisRatio = hasScale ? longAxis / referenceStats.medianLongAxis : 0;
    const shortAxisRatio = hasScale ? shortAxis / referenceStats.medianShortAxis : 0;
    const looksMerged =
      hasScale &&
      areaRatio >= 1.10 &&
      longAxisRatio >= 1.45 &&
      shortAxisRatio >= 0.70 &&
      shape.fillRatio >= 0.32 &&
      shape.completeness >= 0.48;
    const shapeEstimate = looksMerged ? Math.max(2, Math.round(longAxisRatio)) : 1;
    const estimated = looksMerged && areaEstimate < 3 ? Math.max(areaEstimate, Math.min(shapeEstimate, areaEstimate + 1)) : areaEstimate;
    return { ...component, areaRatio, estimated, shapeEstimate };
  });
}

function boxArea(component) {
  return Math.max(0, component.maxX - component.minX + 1) * Math.max(0, component.maxY - component.minY + 1);
}

function boxIntersectionArea(a, b) {
  const left = Math.max(a.minX, b.minX);
  const right = Math.min(a.maxX, b.maxX);
  const top = Math.max(a.minY, b.minY);
  const bottom = Math.min(a.maxY, b.maxY);
  if (right < left || bottom < top) return 0;
  return (right - left + 1) * (bottom - top + 1);
}

function boxIntersectionSize(a, b) {
  const left = Math.max(a.minX, b.minX);
  const right = Math.min(a.maxX, b.maxX);
  const top = Math.max(a.minY, b.minY);
  const bottom = Math.min(a.maxY, b.maxY);
  if (right < left || bottom < top) return { width: 0, height: 0 };
  return { width: right - left + 1, height: bottom - top + 1 };
}

function detectionConfidence(item) {
  const shape = shapeStatsFor(item);
  const color = item.colorStats || {};
  return (
    Math.min(1, shape.fillRatio) * 1.5 +
    Math.min(1, shape.completeness) +
    Math.min(1, (color.meanChroma || 0) / 28) +
    Math.min(1, (color.darkFraction || 0) * 2)
  );
}

function resolveOverlappingCounts(items, referenceStats) {
  const resolved = items.map((item) => ({ ...item }));
  const adjusted = new Set();
  const typicalLongAxis = referenceStats.medianLongAxis || Math.sqrt(referenceStats.area || 0);
  const typicalShortAxis = referenceStats.medianShortAxis || typicalLongAxis;
  const typicalFootprint = Math.max(1, typicalLongAxis * typicalShortAxis);
  for (let i = 0; i < resolved.length; i += 1) {
    for (let j = i + 1; j < resolved.length; j += 1) {
      const a = resolved[i];
      const b = resolved[j];
      if (a.estimated < 4 || b.estimated < 4 || adjusted.has(i) || adjusted.has(j)) continue;
      const intersection = boxIntersectionArea(a, b);
      if (!intersection) continue;
      const intersectionSize = boxIntersectionSize(a, b);
      const smallerBoxRatio = intersection / Math.min(boxArea(a), boxArea(b));
      const centerConflict = componentCenterInsideBox(a, b) || componentCenterInsideBox(b, a);
      const seedSizedConflict =
        intersection / typicalFootprint >= 0.35 &&
        intersection / typicalFootprint <= 2.40 &&
        Math.max(intersectionSize.width, intersectionSize.height) >= typicalLongAxis * 0.45 &&
        Math.min(intersectionSize.width, intersectionSize.height) >= typicalShortAxis * 0.45;
      if (smallerBoxRatio < 0.18 && !centerConflict && !seedSizedConflict) continue;

      const targetIndex = detectionConfidence(a) <= detectionConfidence(b) ? i : j;
      const target = resolved[targetIndex];
      target.estimated = Math.max(1, target.estimated - 1);
      target.overlapAdjusted = true;
      adjusted.add(targetIndex);
    }
  }
  return resolved;
}

function componentCenterInsideBox(component, box, padding = 0) {
  return component.cx >= box.minX - padding &&
    component.cx <= box.maxX + padding &&
    component.cy >= box.minY - padding &&
    component.cy <= box.maxY + padding;
}

function mergeFaintSingleCandidates(strongComponents, faintComponents, referenceStats) {
  if (!referenceStats.area || !faintComponents.length) return strongComponents;
  const medianShortAxis = referenceStats.medianShortAxis || Math.sqrt(referenceStats.area);
  const padding = Math.max(4, Math.round(medianShortAxis * 0.30));
  const accepted = [];

  faintComponents.forEach((component) => {
    if (strongComponents.some((strong) => componentCenterInsideBox(component, strong, padding))) return;
    if (accepted.some((existing) => componentCenterInsideBox(component, existing, padding))) return;

    const shape = shapeStatsFor(component);
    const areaRatio = component.area / referenceStats.area;
    const longAxis = Math.max(shape.boxWidth, shape.boxHeight);
    const shortAxis = Math.min(shape.boxWidth, shape.boxHeight);
    const longAxisRatio = referenceStats.medianLongAxis ? longAxis / referenceStats.medianLongAxis : 1;
    const shortAxisRatio = referenceStats.medianShortAxis ? shortAxis / referenceStats.medianShortAxis : 1;
    const plausibleSingle =
      areaRatio >= 0.22 &&
      areaRatio <= 1.25 &&
      shape.fillRatio >= 0.34 &&
      shape.aspectRatio <= 2.8 &&
      longAxisRatio <= 1.45 &&
      shortAxisRatio >= 0.35 &&
      shape.completeness >= 0.46;
    if (plausibleSingle) accepted.push({ ...component, faintCandidate: true });
  });

  return [...strongComponents, ...accepted];
}

function detectComponentsAtMinArea(imageData, width, height, settings, minArea) {
  const localSettings = { ...settings, minArea };
  const mask = denoise(makeMask(imageData, width, height, localSettings), width, height);
  return enrichAndFilterComponents(connectedComponents(mask, width, height, minArea), imageData, "strong");
}

function detectFaintComponentsAtMinArea(imageData, width, height, settings, minArea) {
  const localSettings = { ...settings, minArea };
  const mask = denoise(makeFaintCandidateMask(imageData, width, height, localSettings), width, height);
  return enrichAndFilterComponents(connectedComponents(mask, width, height, minArea), imageData, "faint");
}

function drawOverlay(items, total, settings) {
  ctx.drawImage(state.image, 0, 0, els.canvas.width, els.canvas.height);
  const roi = settings.roiPoints?.length >= 3 ? settings.roiPoints : state.roiPoints;
  ctx.save();
  drawAnalysisRegion(settings, roi);

  items.forEach((item, index) => {
    const w = item.maxX - item.minX;
    const h = item.maxY - item.minY;
    const isMerged = item.estimated > 1;
    const boxColor = isMerged ? "rgba(201,155,54,.95)" : "rgba(45,109,79,.9)";
    ctx.strokeStyle = boxColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(item.minX, item.minY, w, h);
    ctx.fillStyle = boxColor;
    ctx.beginPath();
    ctx.arc(item.cx, item.cy, 5, 0, Math.PI * 2);
    ctx.fill();
    const countText = `x${item.estimated}`;
    const countX = Math.max(4, Math.min(els.canvas.width - 42, item.minX + 2));
    const countY = Math.max(18, item.minY - 6);
    ctx.fillStyle = isMerged ? "rgba(255,244,205,.96)" : "rgba(255,255,255,.90)";
    ctx.strokeStyle = boxColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(countX, countY - 18, 38, 20, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#1e2521";
    ctx.font = `${isMerged ? "700 " : ""}13px Segoe UI, Arial`;
    ctx.fillText(countText, countX + 7, countY - 4);
    if (index < 120) {
      ctx.fillStyle = "rgba(255,255,255,.85)";
      ctx.fillRect(item.cx + 6, item.cy + 4, 24, 18);
      ctx.fillStyle = "#1e2521";
      ctx.font = "12px Segoe UI, Arial";
      ctx.fillText(String(index + 1), item.cx + 10, item.cy + 17);
    }
  });

  ctx.fillStyle = "rgba(255,255,255,.9)";
  ctx.fillRect(12, 12, 168, 58);
  ctx.fillStyle = "#2d6d4f";
  ctx.font = "700 32px Segoe UI, Arial";
  ctx.fillText(`${total}`, 24, 52);
  ctx.fillStyle = "#66716b";
  ctx.font = "13px Segoe UI, Arial";
  ctx.fillText("estimated seeds", 78, 52);
  ctx.restore();
}

function drawAnalysisRegion(settings, roi) {
  ctx.fillStyle = "rgba(45,109,79,.10)";
  ctx.strokeStyle = "rgba(45,109,79,.75)";
  ctx.lineWidth = 3;
  if (roi.length >= 1) {
    ctx.beginPath();
    ctx.moveTo(roi[0].x, roi[0].y);
    roi.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
    if (!state.isDrawingRoi && roi.length >= 3) ctx.closePath();
    if (!state.isDrawingRoi && roi.length >= 3) ctx.fill();
    if (roi.length >= 2) ctx.stroke();
    roi.forEach((point, index) => {
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#2d6d4f";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#2d6d4f";
      ctx.font = "11px Segoe UI, Arial";
      ctx.fillText(String(index + 1), point.x + 9, point.y - 9);
    });
    return;
  }

  const topY = Math.floor(els.canvas.height * settings.topCrop);
  const leftX = Math.floor(els.canvas.width * settings.leftCrop);
  const rightX = Math.floor(els.canvas.width * (1 - settings.rightCrop));
  const bottomY = Math.floor(els.canvas.height * (1 - settings.bottomCrop));
  ctx.fillRect(leftX, topY, rightX - leftX, bottomY - topY);
  ctx.strokeRect(leftX, topY, rightX - leftX, bottomY - topY);
}

function processImage() {
  syncOutputs();
  if (!state.image) return;

  ctx.drawImage(state.image, 0, 0, els.canvas.width, els.canvas.height);
  const width = els.canvas.width;
  const height = els.canvas.height;
  const settings = {
    topCrop: defaultSettings.topCrop / 100,
    leftCrop: defaultSettings.leftCrop / 100,
    rightCrop: defaultSettings.rightCrop / 100,
    bottomCrop: defaultSettings.bottomCrop / 100,
    satMin: Number(els.controls.satMin.value),
    valMax: Number(els.controls.valMax.value),
    minArea: Number(els.controls.minArea.value),
    roiPoints: state.roiPoints.length >= 3 && !state.isDrawingRoi ? state.roiPoints : null,
  };
  const imageData = ctx.getImageData(0, 0, width, height);
  let components = detectComponentsAtMinArea(imageData, width, height, settings, settings.minArea);
  let activeMinArea = settings.minArea;
  if (!components.length) {
    activeMinArea = Math.max(10, Math.round(settings.minArea * 0.08));
    components = detectComponentsAtMinArea(imageData, width, height, settings, activeMinArea);
  }
  const referenceStats = referenceStatsFor(components);
  const faintComponents = detectFaintComponentsAtMinArea(imageData, width, height, settings, Math.max(8, activeMinArea * 0.25));
  const mergedComponents = mergeFaintSingleCandidates(components, faintComponents, referenceStats);
  const items = resolveOverlappingCounts(estimateCounts(mergedComponents, referenceStats), referenceStats);
  const rawTotal = items.reduce((sum, item) => sum + item.estimated, 0);
  const total = Math.max(0, rawTotal + state.adjustment);

  state.last = { settings, components: items, referenceStats, rawTotal, total };
  drawOverlay(items, total, settings);
  updateResult();
}

function updateResult() {
  const last = state.last;
  const expected = state.expectedCount ? `\nFilename reference count: ${state.expectedCount}` : "";
  const difference = state.expectedCount && last ? `\nDifference from reference: ${last.total - state.expectedCount}` : "";
  els.empty.hidden = Boolean(state.image);
  els.stage.classList.toggle("is-loaded", Boolean(state.image));
  els.count.textContent = last ? last.total : "0";
  els.components.textContent = last ? last.components.length : "0";
  els.area.textContent = last?.referenceStats?.area
    ? `${last.referenceStats.area} px / ${last.referenceStats.method}`
    : "Auto";
  els.adjustment.textContent = state.adjustment > 0 ? `+${state.adjustment}` : String(state.adjustment);
  els.source.textContent = state.sourceName || "Not loaded";
  els.report.value = last
    ? `Source: ${state.sourceName}\nEstimated seeds: ${last.total}\nDetected regions: ${last.components.length}\nReference seed area: ${last.referenceStats.area} px\nReference method: ${last.referenceStats.method}\nAnalysis region: ${state.roiPoints.length >= 3 ? "polygon ROI" : "fallback rectangle"}\nLikely single-seed average area: ${last.referenceStats.averageArea} px\nSeed area variation: ${Math.round(last.referenceStats.cv * 100)}%\nManual adjustment: ${state.adjustment}${expected}${difference}`
    : "";
  syncRoiStatus();
}

async function startCamera() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((track) => track.stop());
  }
  state.cameraStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  els.camera.srcObject = state.cameraStream;
  await els.camera.play();
  showCameraPreview();
  els.capturePhoto.disabled = false;
}

function capturePhoto() {
  const video = els.camera;
  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;
  setCanvasSize(width, height);
  ctx.drawImage(video, 0, 0, width, height);
  showCanvas();
  const img = new Image();
  img.onload = () => {
    state.image = img;
    state.sourceName = `webcam ${new Date().toLocaleTimeString()}`;
    state.expectedCount = null;
    state.adjustment = 0;
    state.roiPoints = [];
    state.isDrawingRoi = false;
    suggestDetectionParameters();
    showLoadedStage();
    processImage();
  };
  img.src = els.canvas.toDataURL("image/jpeg", 0.92);
}

function attachEvents() {
  Object.values(els.controls).forEach((control) => {
    control.addEventListener("input", processImage);
  });
  els.fileInput.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    showCanvas();
    loadImage(URL.createObjectURL(file), file.name);
  });
  els.startCamera.addEventListener("click", () => {
    startCamera().catch((error) => {
      els.report.value = `Unable to start webcam: ${error.message}`;
    });
  });
  els.capturePhoto.addEventListener("click", capturePhoto);
  els.recount.addEventListener("click", processImage);
  els.copyReport.addEventListener("click", () => navigator.clipboard.writeText(els.report.value));
  els.plusOne.addEventListener("click", () => {
    state.adjustment += 1;
    processImage();
  });
  els.minusOne.addEventListener("click", () => {
    state.adjustment -= 1;
    processImage();
  });
  els.resetAdjust.addEventListener("click", () => {
    state.adjustment = 0;
    processImage();
  });
  els.startRoi.addEventListener("click", () => {
    if (!state.image) return;
    state.roiPoints = [];
    state.isDrawingRoi = true;
    state.draggingRoiIndex = null;
    processImage();
  });
  els.finishRoi.addEventListener("click", () => {
    if (state.roiPoints.length < 3) return;
    state.isDrawingRoi = false;
    state.draggingRoiIndex = null;
    processImage();
  });
  els.clearRoi.addEventListener("click", () => {
    state.roiPoints = [];
    state.isDrawingRoi = false;
    state.draggingRoiIndex = null;
    processImage();
  });
  els.canvas.addEventListener("pointerdown", (event) => {
    if (!state.image) return;
    const point = canvasPointFromEvent(event);
    if (!point) return;
    if (!state.isDrawingRoi) {
      const pointIndex = nearestRoiPointIndex(point);
      if (pointIndex === null) return;
      state.draggingRoiIndex = pointIndex;
      els.canvas.setPointerCapture(event.pointerId);
      updateDraggedRoiPoint(point);
      event.preventDefault();
      return;
    }
    state.roiPoints.push(point);
    processImage();
  });
  els.canvas.addEventListener("pointermove", (event) => {
    if (!state.image || state.draggingRoiIndex === null) return;
    const point = canvasPointFromEvent(event);
    if (!point) return;
    updateDraggedRoiPoint(point);
    event.preventDefault();
  });
  const stopRoiDrag = (event) => {
    if (state.draggingRoiIndex === null) return;
    state.draggingRoiIndex = null;
    if (state.roiDragFrame) {
      cancelAnimationFrame(state.roiDragFrame);
      state.roiDragFrame = null;
    }
    if (els.canvas.hasPointerCapture?.(event.pointerId)) {
      els.canvas.releasePointerCapture(event.pointerId);
    }
    processImage();
  };
  els.canvas.addEventListener("pointerup", stopRoiDrag);
  els.canvas.addEventListener("pointercancel", stopRoiDrag);
  els.canvas.addEventListener("lostpointercapture", (event) => {
    if (state.draggingRoiIndex === null) return;
    stopRoiDrag(event);
  });
}

attachEvents();
syncOutputs();
