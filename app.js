const samples = [
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
  controls: {
    topCrop: document.getElementById("topCrop"),
    leftCrop: document.getElementById("leftCrop"),
    rightCrop: document.getElementById("rightCrop"),
    bottomCrop: document.getElementById("bottomCrop"),
    satMin: document.getElementById("satMin"),
    valMax: document.getElementById("valMax"),
    minArea: document.getElementById("minArea"),
    manualArea: document.getElementById("manualArea"),
  },
  outputs: {
    topCrop: document.getElementById("topCropOut"),
    leftCrop: document.getElementById("leftCropOut"),
    rightCrop: document.getElementById("rightCropOut"),
    bottomCrop: document.getElementById("bottomCropOut"),
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
  els.outputs.topCrop.textContent = `${els.controls.topCrop.value}%`;
  els.outputs.leftCrop.textContent = `${els.controls.leftCrop.value}%`;
  els.outputs.rightCrop.textContent = `${els.controls.rightCrop.value}%`;
  els.outputs.bottomCrop.textContent = `${els.controls.bottomCrop.value}%`;
  els.outputs.satMin.textContent = els.controls.satMin.value;
  els.outputs.valMax.textContent = els.controls.valMax.value;
  els.outputs.minArea.textContent = els.controls.minArea.value;
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
  ctx.drawImage(state.image, 0, 0, els.canvas.width, els.canvas.height);
  const width = els.canvas.width;
  const height = els.canvas.height;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const step = Math.max(1, Math.round(Math.sqrt((width * height) / 180000)));
  const xs = [];
  const ys = [];
  const sats = [];
  const vals = [];

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const offset = (y * width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const { h, s, v } = rgbToHsv(r, g, b);
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const isSeedHue = h >= 16 && h <= 82;
      const isNotGreen = !(h >= 85 && h <= 165 && s > 0.18);
      if (isSeedHue && isNotGreen && s * 100 >= 8 && v <= 238 && luma >= 40) {
        xs.push(x);
        ys.push(y);
        sats.push(s * 100);
        vals.push(v);
      }
    }
  }

  els.controls.manualArea.value = "";
  if (xs.length < 40) {
    setRangeValue(els.controls.topCrop, 25);
    setRangeValue(els.controls.leftCrop, 3);
    setRangeValue(els.controls.rightCrop, 3);
    setRangeValue(els.controls.bottomCrop, 2);
    setRangeValue(els.controls.satMin, 14);
    setRangeValue(els.controls.valMax, 220);
    setRangeValue(els.controls.minArea, Math.round((width * height) / 5100));
    syncOutputs();
    return;
  }

  const marginX = width * 0.025;
  const marginY = height * 0.035;
  const minX = percentile(xs, 0.02);
  const maxX = percentile(xs, 0.98);
  const minY = percentile(ys, 0.03);
  const maxY = percentile(ys, 0.98);
  const satMin = percentile(sats, 0.10) - 5;
  const valMax = percentile(vals, 0.95) + 12;
  const scaledMinArea = Math.round((width * height) / 5100);

  setRangeValue(els.controls.topCrop, ((minY - marginY) / height) * 100);
  setRangeValue(els.controls.leftCrop, ((minX - marginX) / width) * 100);
  setRangeValue(els.controls.rightCrop, ((width - maxX - marginX) / width) * 100);
  setRangeValue(els.controls.bottomCrop, ((height - maxY - marginY) / height) * 100);
  setRangeValue(els.controls.satMin, satMin);
  setRangeValue(els.controls.valMax, valMax);
  setRangeValue(els.controls.minArea, scaledMinArea);
  syncOutputs();
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
  const topY = Math.floor(height * settings.topCrop);
  const leftX = Math.floor(width * settings.leftCrop);
  const rightX = Math.floor(width * (1 - settings.rightCrop));
  const bottomY = Math.floor(height * (1 - settings.bottomCrop));

  for (let y = topY; y < bottomY; y += 1) {
    for (let x = leftX; x < rightX; x += 1) {
      const offset = (y * width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const { h, s, v } = rgbToHsv(r, g, b);
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const isSeedHue = h >= 18 && h <= 78;
      const isNotGreen = !(h >= 85 && h <= 165 && s > 0.18);
      const isSeedPixel = isSeedHue && isNotGreen && s * 100 >= settings.satMin && v <= settings.valMax && luma >= 45;
      if (isSeedPixel) mask[y * width + x] = 1;
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

    while (stack.length) {
      const p = stack.pop();
      const x = p % width;
      const y = Math.floor(p / width);
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
      components.push({
        area,
        cx: sumX / area,
        cy: sumY / area,
        minX,
        maxX,
        minY,
        maxY,
      });
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

function referenceStatsFor(components) {
  const manual = Number(els.controls.manualArea.value);
  if (manual > 0) {
    return {
      area: manual,
      baseArea: manual,
      averageArea: manual,
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
      cv: 0,
      singleCount: 0,
      method: "none",
    };
  }
  const areas = components.map((item) => item.area);
  const sorted = [...areas].sort((a, b) => a - b);
  const index = Math.round((sorted.length - 1) * 0.30);
  const baseArea = sorted[index];
  const likelySingles = sorted.filter((area) => area >= baseArea * 0.75 && area <= baseArea * 1.75);
  const singles = likelySingles.length >= 5 ? likelySingles : [baseArea];
  const averageArea = mean(singles);
  const cv = averageArea ? standardDeviation(singles, averageArea) / averageArea : 0;
  const blendedArea = baseArea * 0.65 + averageArea * 0.35;
  return {
    area: Math.round(blendedArea),
    baseArea: Math.round(baseArea),
    averageArea: Math.round(averageArea),
    cv,
    singleCount: singles.length,
    method: "area-model",
  };
}

function estimateCounts(components, referenceStats) {
  return components.map((component) => {
    const areaRatio = referenceStats.area > 0 ? component.area / referenceStats.area : 1;
    const estimated = referenceStats.area > 0 ? Math.max(1, Math.round(areaRatio)) : 1;
    return { ...component, areaRatio, estimated };
  });
}

function drawOverlay(items, total, settings) {
  ctx.drawImage(state.image, 0, 0, els.canvas.width, els.canvas.height);
  const topY = Math.floor(els.canvas.height * settings.topCrop);
  const leftX = Math.floor(els.canvas.width * settings.leftCrop);
  const rightX = Math.floor(els.canvas.width * (1 - settings.rightCrop));
  const bottomY = Math.floor(els.canvas.height * (1 - settings.bottomCrop));
  ctx.save();
  ctx.fillStyle = "rgba(45,109,79,.10)";
  ctx.fillRect(leftX, topY, rightX - leftX, bottomY - topY);
  ctx.strokeStyle = "rgba(45,109,79,.75)";
  ctx.lineWidth = 3;
  ctx.strokeRect(leftX, topY, rightX - leftX, bottomY - topY);

  items.forEach((item, index) => {
    const w = item.maxX - item.minX;
    const h = item.maxY - item.minY;
    ctx.strokeStyle = item.estimated > 1 ? "rgba(201,155,54,.95)" : "rgba(45,109,79,.9)";
    ctx.lineWidth = 2;
    ctx.strokeRect(item.minX, item.minY, w, h);
    ctx.fillStyle = item.estimated > 1 ? "rgba(201,155,54,.95)" : "rgba(45,109,79,.9)";
    ctx.beginPath();
    ctx.arc(item.cx, item.cy, 5, 0, Math.PI * 2);
    ctx.fill();
    if (item.estimated > 1) {
      ctx.fillStyle = "#1e2521";
      ctx.font = "18px Segoe UI, Arial";
      ctx.fillText(String(item.estimated), item.cx + 7, item.cy - 7);
    }
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

function processImage() {
  syncOutputs();
  if (!state.image) return;

  ctx.drawImage(state.image, 0, 0, els.canvas.width, els.canvas.height);
  const width = els.canvas.width;
  const height = els.canvas.height;
  const settings = {
    topCrop: Number(els.controls.topCrop.value) / 100,
    leftCrop: Number(els.controls.leftCrop.value) / 100,
    rightCrop: Number(els.controls.rightCrop.value) / 100,
    bottomCrop: Number(els.controls.bottomCrop.value) / 100,
    satMin: Number(els.controls.satMin.value),
    valMax: Number(els.controls.valMax.value),
    minArea: Number(els.controls.minArea.value),
  };
  const imageData = ctx.getImageData(0, 0, width, height);
  const mask = denoise(makeMask(imageData, width, height, settings), width, height);
  const components = connectedComponents(mask, width, height, settings.minArea);
  const referenceStats = referenceStatsFor(components);
  const items = estimateCounts(components, referenceStats);
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
    ? `${last.referenceStats.area} px / avg ${last.referenceStats.averageArea} px`
    : "Auto";
  els.adjustment.textContent = state.adjustment > 0 ? `+${state.adjustment}` : String(state.adjustment);
  els.source.textContent = state.sourceName || "Not loaded";
  els.report.value = last
    ? `Source: ${state.sourceName}\nEstimated seeds: ${last.total}\nDetected regions: ${last.components.length}\nReference seed area: ${last.referenceStats.area} px\nLikely single-seed average area: ${last.referenceStats.averageArea} px\nSeed area variation: ${Math.round(last.referenceStats.cv * 100)}%\nManual adjustment: ${state.adjustment}${expected}${difference}`
    : "";
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
}

attachEvents();
syncOutputs();
