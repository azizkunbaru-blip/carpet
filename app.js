/**
 * Carpet Aesthetic Product Photo Generator
 * - Auto background removal (optional) using @imgly/background-removal (AGPL).
 * - Manual mask fallback (brush).
 * - Generate 2 background variants via Gemini image model (REST generateContent).
 * - Composite cutout over background with natural shadow.
 *
 * NOTE:
 * - GitHub Pages biasanya tidak mendukung COOP/COEP headers → performa removeBackground bisa turun. 4
 * - Gemini image REST endpoint: /v1beta/models/{model}:generateContent 5
 */

let removeBackgroundLib = null; // lazy import

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);

const apiKeyEl = $("apiKey");
const modelEl = $("model");
const fileInput = $("fileInput");
const keepShapeEl = $("keepShape");
const watermarkEl = $("watermark");

const stylizeEl = $("stylize");
const stylizeVal = $("stylizeVal");
const ratioEl = $("ratio");
const resEl = $("res");

const carpetColorEl = $("carpetColor");
const carpetColorHexEl = $("carpetColorHex");
const carpetTypeEl = $("carpetType");
const ornamentChipsEl = $("ornamentChips");
const ornamentPickEl = $("ornamentPick");
const ornamentAddEl = $("ornamentAdd");
const ornamentCustomEl = $("ornamentCustom");
const ornamentAddCustomEl = $("ornamentAddCustom");
const moodEl = $("mood");
const lightEl = $("light");
const lightIntensityEl = $("lightIntensity");
const lightIntensityVal = $("lightIntensityVal");
const cameraPosEl = $("cameraPos");
const cameraTypeEl = $("cameraType");
const cameraCustomEl = $("cameraCustom");

const btnReset = $("btnReset");
const btnAutoRemove = $("btnAutoRemove");
const btnMaskMode = $("btnMaskMode");
const btnGenerate = $("btnGenerate");
const btnRegen = $("btnRegen");

const statusEl = $("status");
const statusText = statusEl.querySelector(".text");
const progressWrap = $("progressWrap");
const progressText = $("progressText");

const canvasCutout = $("canvasCutout");
const ctxCutout = canvasCutout.getContext("2d");

const canvasA = $("canvasA");
const ctxA = canvasA.getContext("2d");

const canvasB = $("canvasB");
const ctxB = canvasB.getContext("2d");

const btnDownloadCutout = $("btnDownloadCutout");
const btnDownloadA = $("btnDownloadA");
const btnDownloadB = $("btnDownloadB");

// Manual mask UI
const maskUI = $("maskUI");
const canvasMask = $("canvasMask");
const ctxMask = canvasMask.getContext("2d");
const brushSizeEl = $("brushSize");
const brushSizeVal = $("brushSizeVal");
const btnMaskApply = $("btnMaskApply");
const btnMaskClear = $("btnMaskClear");
const btnMaskClose = $("btnMaskClose");

// ---------- State ----------
const ORNAMENT_OPTIONS = [
  "pot tanaman kecil hijau",
  "buku tulis minimal",
  "laptop tipis",
  "majalah aesthetic",
  "mug kopi",
  "vas kecil",
  "bunga kering",
  "lilin aromaterapi",
  "kacamata",
  "tanpa ornamen"
];

let state = {
  apiKey: "",
  model: "gemini-3-pro-image-preview",
  file: null,
  inputImageBitmap: null,

  cutoutBlob: null,     // PNG w/ alpha
  cutoutBitmap: null,   // ImageBitmap

  ornaments: ["tanpa ornamen"],

  lastSettingsHash: "",
  lastPromptA: "",
  lastPromptB: ""
};

// ---------- Utils ----------
function setStatus(msg, busy=false){
  statusText.textContent = msg;
  $("status").querySelector(".dot").style.background = busy ? "#f59e0b" : "#22c55e";
  $("status").querySelector(".dot").style.boxShadow = busy ? "0 0 0 6px rgba(245,158,11,.12)" : "0 0 0 6px rgba(34,197,94,.12)";
}
function setProgress(show, text=""){
  progressWrap.classList.toggle("hide", !show);
  if(text) progressText.textContent = text;
}
function clamp(n,min,max){ return Math.max(min, Math.min(max,n)); }

function saveLocal(){
  const data = {
    apiKey: apiKeyEl.value || "",
    model: modelEl.value,
    keepShape: keepShapeEl.checked,
    watermark: watermarkEl.checked,
    stylize: stylizeEl.value,
    ratio: ratioEl.value,
    res: resEl.value,
    carpetColor: carpetColorEl.value,
    carpetColorHex: carpetColorHexEl.value,
    carpetType: carpetTypeEl.value,
    ornaments: state.ornaments,
    mood: moodEl.value,
    light: lightEl.value,
    lightIntensity: lightIntensityEl.value,
    cameraPos: cameraPosEl.value,
    cameraType: cameraTypeEl.value,
    cameraCustom: cameraCustomEl.value
  };
  localStorage.setItem("carpetPhotoGen.v1", JSON.stringify(data));
}
function loadLocal(){
  const raw = localStorage.getItem("carpetPhotoGen.v1");
  if(!raw) return;
  try{
    const d = JSON.parse(raw);
    apiKeyEl.value = d.apiKey || "";
    modelEl.value = d.model || modelEl.value;
    keepShapeEl.checked = d.keepShape ?? true;
    watermarkEl.checked = d.watermark ?? false;
    stylizeEl.value = d.stylize ?? "30";
    ratioEl.value = d.ratio ?? "4:5";
    resEl.value = d.res ?? "1536";
    carpetColorEl.value = d.carpetColor ?? "cream";
    carpetColorHexEl.value = d.carpetColorHex ?? "";
    carpetTypeEl.value = d.carpetType ?? "short pile fluffy carpet";
    state.ornaments = Array.isArray(d.ornaments) ? d.ornaments : ["tanpa ornamen"];
    moodEl.value = d.mood ?? "clean studio";
    lightEl.value = d.light ?? "window soft daylight";
    lightIntensityEl.value = d.lightIntensity ?? "60";
    cameraPosEl.value = d.cameraPos ?? "top-down 90 degrees, straight overhead, flat lay";
    cameraTypeEl.value = d.cameraType ?? "iPhone 15 Pro";
    cameraCustomEl.value = d.cameraCustom ?? "";

    // apply dependent UI toggles
    stylizeVal.textContent = stylizeEl.value;
    lightIntensityVal.textContent = lightIntensityEl.value;
    syncCustomColorUI();
    syncCameraCustomUI();
    renderOrnaments();
  }catch{}
}

function syncCustomColorUI(){
  const isCustom = carpetColorEl.value === "custom";
  carpetColorHexEl.disabled = !isCustom;
  if(!isCustom) carpetColorHexEl.value = "";
}
function syncCameraCustomUI(){
  const isCustom = cameraTypeEl.value === "custom";
  cameraCustomEl.disabled = !isCustom;
  if(!isCustom) cameraCustomEl.value = "";
}

function renderOrnaments(){
  ornamentChipsEl.innerHTML = "";
  for(const item of state.ornaments){
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.innerHTML = `<span>${escapeHtml(item)}</span><button type="button" title="Hapus">×</button>`;
    chip.querySelector("button").addEventListener("click", () => {
      state.ornaments = state.ornaments.filter(x => x !== item);
      if(state.ornaments.length === 0) state.ornaments = ["tanpa ornamen"];
      enforceOrnamentRules();
      renderOrnaments();
      saveLocal();
    });
    ornamentChipsEl.appendChild(chip);
  }
  enforceOrnamentRules();
}

function enforceOrnamentRules(){
  const hasNo = state.ornaments.includes("tanpa ornamen");
  if(hasNo && state.ornaments.length > 1){
    state.ornaments = ["tanpa ornamen"];
  }
  // disable pick if "tanpa ornamen"
  ornamentPickEl.disabled = hasNo;
  ornamentAddEl.disabled = hasNo;
  ornamentCustomEl.disabled = hasNo;
  ornamentAddCustomEl.disabled = hasNo;
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, (m)=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[m]));
}

function aspectToWH(aspect, base){
  // base = desired long edge? we'll produce a canvas with exact pixel W/H
  // Use common mapping for 1:1, 4:5, 9:16, 16:9 with base = max dimension
  const [a,b] = aspect.split(":").map(Number);
  if(!a || !b) return {w:base,h:base};

  // Keep max dimension = base
  if(a >= b){
    const w = base;
    const h = Math.round(base * (b/a));
    return {w,h};
  }else{
    const h = base;
    const w = Math.round(base * (a/b));
    return {w,h};
  }
}

function settingsHash(){
  const obj = {
    model: modelEl.value,
    keepShape: keepShapeEl.checked,
    stylize: Number(stylizeEl.value),
    ratio: ratioEl.value,
    res: Number(resEl.value),
    carpetColor: carpetColorEl.value,
    carpetColorHex: carpetColorHexEl.value,
    carpetType: carpetTypeEl.value,
    ornaments: [...state.ornaments].sort(),
    mood: moodEl.value,
    light: lightEl.value,
    lightIntensity: Number(lightIntensityEl.value),
    cameraPos: cameraPosEl.value,
    cameraType: cameraTypeEl.value,
    cameraCustom: cameraCustomEl.value
  };
  return JSON.stringify(obj);
}

async function fileToBitmap(file){
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  await img.decode();
  const bmp = await createImageBitmap(img);
  URL.revokeObjectURL(url);
  return bmp;
}

function drawContain(ctx, bmp, w, h){
  ctx.clearRect(0,0,w,h);
  const scale = Math.min(w / bmp.width, h / bmp.height);
  const nw = bmp.width * scale;
  const nh = bmp.height * scale;
  const x = (w - nw)/2;
  const y = (h - nh)/2;
  ctx.drawImage(bmp, x, y, nw, nh);
  return {x,y,nw,nh,scale};
}

async function blobToBitmap(blob){
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  await img.decode();
  const bmp = await createImageBitmap(img);
  URL.revokeObjectURL(url);
  return bmp;
}

function canvasToBlob(canvas, type="image/png", quality=0.92){
  return new Promise((resolve)=>canvas.toBlob(resolve, type, quality));
}

// ---------- Background removal ----------
async function lazyLoadRemoveBackground(){
  if(removeBackgroundLib) return removeBackgroundLib;
  // Using ESM bundle from unpkg (version pinned). If unpkg path changes, adjust here.
  // From docs: import imglyRemoveBackground from "@imgly/background-removal" 6
  const mod = await import("https://unpkg.com/@imgly/background-removal@1.5.8/dist/index.js?module");
  // default export function
  removeBackgroundLib = mod.default || mod;
  return removeBackgroundLib;
}

async function autoRemoveBackground(){
  if(!state.file) throw new Error("Upload foto produk dulu.");
  setStatus("Menghapus background (auto)...", true);
  setProgress(true, "Downloading model (first run) / removing background...");
  try{
    const removeBg = await lazyLoadRemoveBackground();

    // config ringan supaya lebih aman di GH Pages
    const config = {
      device: "cpu",
      model: "isnet", // smaller model (~40MB) per docs 7
      output: { format: "image/png", quality: 0.95, type: "foreground" },
      // progress callback (best-effort)
      progress: (key, current, total) => {
        const pct = total ? Math.round((current/total)*100) : 0;
        setProgress(true, `Downloading ${key}… ${pct}%`);
      }
    };

    const blob = await removeBg(state.file, config);
    state.cutoutBlob = blob;
    state.cutoutBitmap = await blobToBitmap(blob);
    await renderCutoutPreview();
    btnDownloadCutout.disabled = false;

    setStatus("Auto remove BG selesai. Siap generate.", false);
  } catch (e){
    console.error(e);
    setStatus("Auto remove gagal/berat. Pakai Manual Mask (Brush).", false);
    throw e;
  } finally {
    setProgress(false);
  }
}

// ---------- Manual Mask (brush) ----------
let maskMode = {
  enabled: false,
  drawing: false,
  brush: 24
};

function openMaskUI(){
  if(!state.inputImageBitmap){
    alert("Upload gambar dulu.");
    return;
  }
  maskUI.classList.remove("hide");
  maskMode.enabled = true;

  // Init mask canvas: show input image + black mask overlay
  const w = canvasMask.width, h = canvasMask.height;
  ctxMask.clearRect(0,0,w,h);
  // draw image
  drawContain(ctxMask, state.inputImageBitmap, w, h);

  // create a separate mask layer in same canvas by using globalComposite? simpler: store mask in ImageData on offscreen.
  // We'll store mask strokes in offscreen canvas
  initMaskLayers();
  repaintMaskCanvas();
}

let maskLayer = null;   // offscreen canvas storing mask (white=fg, black=bg)
let imgLayer = null;    // offscreen canvas storing resized image for mask pipeline
let imgDrawRect = null;

function initMaskLayers(){
  const w = canvasMask.width, h = canvasMask.height;

  maskLayer = document.createElement("canvas");
  maskLayer.width = w; maskLayer.height = h;
  const mctx = maskLayer.getContext("2d");
  mctx.fillStyle = "black";
  mctx.fillRect(0,0,w,h);

  imgLayer = document.createElement("canvas");
  imgLayer.width = w; imgLayer.height = h;
  const ictx = imgLayer.getContext("2d");
  ictx.clearRect(0,0,w,h);
  imgDrawRect = drawContain(ictx, state.inputImageBitmap, w, h);
}

function repaintMaskCanvas(){
  const w = canvasMask.width, h = canvasMask.height;
  ctxMask.clearRect(0,0,w,h);

  // draw image
  ctxMask.drawImage(imgLayer, 0,0);

  // draw mask overlay semi-transparent
  ctxMask.save();
  ctxMask.globalAlpha = 0.35;
  ctxMask.drawImage(maskLayer, 0,0);
  ctxMask.restore();

  // info
  ctxMask.save();
  ctxMask.fillStyle = "rgba(0,0,0,.35)";
  ctxMask.fillRect(10,10,190,26);
  ctxMask.fillStyle = "white";
  ctxMask.font = "12px system-ui";
  ctxMask.fillText("Brush: putih = produk", 18, 28);
  ctxMask.restore();
}

function getCanvasPos(evt, canvas){
  const rect = canvas.getBoundingClientRect();
  const x = (evt.clientX - rect.left) * (canvas.width / rect.width);
  const y = (evt.clientY - rect.top) * (canvas.height / rect.height);
  return {x,y};
}

function drawMaskDot(x,y){
  const mctx = maskLayer.getContext("2d");
  mctx.save();
  mctx.fillStyle = "white";
  mctx.beginPath();
  mctx.arc(x,y,maskMode.brush,0,Math.PI*2);
  mctx.fill();
  mctx.restore();
}

canvasMask.addEventListener("pointerdown", (e)=>{
  if(!maskMode.enabled) return;
  maskMode.drawing = true;
  canvasMask.setPointerCapture(e.pointerId);
  const {x,y} = getCanvasPos(e, canvasMask);
  drawMaskDot(x,y);
  repaintMaskCanvas();
});
canvasMask.addEventListener("pointermove", (e)=>{
  if(!maskMode.enabled || !maskMode.drawing) return;
  const {x,y} = getCanvasPos(e, canvasMask);
  drawMaskDot(x,y);
  repaintMaskCanvas();
});
canvasMask.addEventListener("pointerup", ()=>{
  maskMode.drawing = false;
});
canvasMask.addEventListener("pointercancel", ()=>{
  maskMode.drawing = false;
});

async function applyMaskToCreateCutout(){
  if(!maskLayer || !imgLayer) return;

  setStatus("Membuat cutout dari mask...", true);
  setProgress(true, "Applying mask...");

  const w = imgLayer.width, h = imgLayer.height;

  // Create cutout canvas
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  const octx = out.getContext("2d");

  // Draw image
  octx.drawImage(imgLayer, 0,0);

  // Apply alpha from mask:
  // alpha = mask luminance
  const imgData = octx.getImageData(0,0,w,h);
  const maskCtx = maskLayer.getContext("2d");
  const maskData = maskCtx.getImageData(0,0,w,h);

  const data = imgData.data;
  const m = maskData.data;

  for(let i=0;i<data.length;i+=4){
    const alpha = m[i]; // R channel (0..255)
    data[i+3] = alpha;
  }
  octx.putImageData(imgData, 0,0);

  // Convert to blob/bitmap
  const blob = await canvasToBlob(out, "image/png");
  state.cutoutBlob = blob;
  state.cutoutBitmap = await blobToBitmap(blob);

  await renderCutoutPreview();
  btnDownloadCutout.disabled = false;

  setProgress(false);
  setStatus("Cutout siap. Sekarang Generate.", false);
}

// ---------- Render previews ----------
async function renderInputPreview(){
  if(!state.inputImageBitmap){
    ctxCutout.clearRect(0,0,canvasCutout.width,canvasCutout.height);
    return;
  }
  // show the raw input in cutout canvas (until cutout ready)
  drawContain(ctxCutout, state.inputImageBitmap, canvasCutout.width, canvasCutout.height);
}
async function renderCutoutPreview(){
  if(!state.cutoutBitmap){
    await renderInputPreview();
    return;
  }
  // draw cutout on checker bg
  const w = canvasCutout.width, h = canvasCutout.height;
  drawChecker(ctxCutout, w, h, 20);
  drawContain(ctxCutout, state.cutoutBitmap, w, h);
}

function drawChecker(ctx,w,h,size){
  ctx.clearRect(0,0,w,h);
  for(let y=0;y<h;y+=size){
    for(let x=0;x<w;x+=size){
      const isDark = ((x/size)+(y/size))%2===0;
      ctx.fillStyle = isDark ? "rgba(255,255,255,.06)" : "rgba(0,0,0,.10)";
      ctx.fillRect(x,y,size,size);
    }
  }
}

// ---------- Prompt building ----------
function normalizeOrnaments(){
  const hasNo = state.ornaments.includes("tanpa ornamen");
  if(hasNo) return "no ornaments, no extra props";
  return state.ornaments.join(", ");
}

function getCarpetColorPhrase(){
  if(carpetColorEl.value === "custom"){
    const hex = (carpetColorHexEl.value || "").trim();
    return hex ? `custom carpet color (${hex})` : "custom carpet color";
  }
  return carpetColorEl.value;
}

function stylizeToWords(v){
  const n = Number(v);
  if(n <= 10) return "very low stylization";
  if(n <= 30) return "low stylization";
  if(n <= 60) return "medium stylization";
  return "high stylization";
}

function lightIntensityToWords(v){
  const n = Number(v);
  if(n <= 25) return "subtle light intensity";
  if(n <= 55) return "balanced light intensity";
  if(n <= 80) return "bright light intensity";
  return "very bright light intensity";
}

function buildBackgroundPrompt(variantLabel){
  const carpetColor = getCarpetColorPhrase();
  const carpetType = carpetTypeEl.value;
  const ornaments = normalizeOrnaments();
  const mood = moodEl.value;
  const light = lightEl.value;
  const lightIntensity = lightIntensityToWords(lightIntensityEl.value);
  const cameraPos = cameraPosEl.value;
  const cameraType = (cameraTypeEl.value === "custom" ? (cameraCustomEl.value || "custom camera") : cameraTypeEl.value);

  const stylize = stylizeToWords(stylizeEl.value);

  // Important constraints
  // We generate BACKGROUND ONLY (no product) to keep product 100% unchanged.
  const prompt = `
Generate a photorealistic product photography BACKGROUND ONLY (no product, no hands, no humans).
Scene: an aesthetic ${carpetColor} ${carpetType} carpet surface, ${mood} vibe.
Props/ornaments: ${ornaments}.
Lighting: ${light}, ${lightIntensity}. Natural soft shadows on carpet fibers, realistic highlights.
Camera: ${cameraType}, ${cameraPos}. Sharp focus, clean, realistic texture.
Style constraints: ultra realistic, no AI artifacts, crisp details, clean composition, ${stylize}.
Variant: ${variantLabel} (slightly different prop arrangement and carpet pattern randomness, but same mood and color family).
Negative: product, logo, text, watermark overlay graphics, weird objects, extra limbs, blur, distortion.
  `.trim();

  return prompt;
}

// ---------- Gemini REST (image generation) ----------
async function geminiGenerateImageBase64(prompt, {model, aspectRatio, imageSize}){
  const apiKey = (apiKeyEl.value || "").trim();
  if(!apiKey) throw new Error("Isi Gemini API Key dulu.");

  // Endpoint per docs 8
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const body = {
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      // For image models, use imageConfig fields (docs show aspectRatio, imageSize) 9
      imageConfig: {
        aspectRatio
      }
    }
  };

  if(model.includes("gemini-3-pro-image")){
    // allow "2K" for HD, per docs imageSize: "2K" 10
    if(imageSize) body.generationConfig.imageConfig.imageSize = imageSize;
  }

  // For some responses, responseModalities can be required; keep safe:
  // docs show responseModalities for image-only; but examples work without if using image models.
  // We'll set it explicitly:
  body.generationConfig.responseModalities = ["IMAGE"];

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify(body)
  });

  if(!res.ok){
    const t = await res.text();
    throw new Error(`Gemini error ${res.status}: ${t}`);
  }

  const json = await res.json();
  const parts = json?.candidates?.[0]?.content?.parts || [];
  // Find inlineData
  const inline = parts.find(p => p.inlineData?.data);
  if(!inline) throw new Error("Tidak ada image data dari Gemini.");
  return inline.inlineData.data; // base64
}

function base64ToBlob(b64, mime="image/png"){
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for(let i=0;i<len;i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], {type:mime});
}

// ---------- Compositing ----------
async function compositeProductOverBackground(bgBitmap, variantCtx){
  const outRes = Number(resEl.value);
  const aspect = ratioEl.value;

  // Decide final W/H
  const {w,h} = aspectToWH(aspect, outRes);

  // Create output canvas
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  const octx = out.getContext("2d");

  // Draw background cover
  drawCover(octx, bgBitmap, w, h);

  // Add subtle vignette
  addVignette(octx, w, h);

  // Draw product cutout centered with natural shadow
  if(!state.cutoutBitmap) throw new Error("Cutout belum ada. Klik Auto Remove BG atau Manual Mask dulu.");
  const product = state.cutoutBitmap;

  // product size relative to canvas
  const targetScale = clamp(0.62 - (Number(stylizeEl.value)/300), 0.48, 0.68);
  const pw = Math.round(w * targetScale);
  const ph = Math.round(pw * (product.height / product.width));

  const x = Math.round((w - pw)/2);
  const y = Math.round((h - ph)/2);

  // shadow: blurred ellipse under product
  drawContactShadow(octx, x, y, pw, ph);

  // draw product
  octx.drawImage(product, x, y, pw, ph);

  // Optional watermark (simple)
  if(watermarkEl.checked){
    octx.save();
    octx.fillStyle = "rgba(255,255,255,.65)";
    octx.font = "14px system-ui";
    octx.fillText("carpet aesthetic", 16, h - 16);
    octx.restore();
  }

  // Paint into preview canvas
  variantCtx.canvas.width = w;
  variantCtx.canvas.height = h;
  variantCtx.clearRect(0,0,w,h);
  variantCtx.drawImage(out, 0,0);

  // Return blob for download
  return await canvasToBlob(out, "image/png");
}

function drawCover(ctx, bmp, w, h){
  const scale = Math.max(w / bmp.width, h / bmp.height);
  const nw = bmp.width * scale;
  const nh = bmp.height * scale;
  const x = (w - nw)/2;
  const y = (h - nh)/2;
  ctx.drawImage(bmp, x, y, nw, nh);
}

function addVignette(ctx,w,h){
  const g = ctx.createRadialGradient(w/2, h/2, Math.min(w,h)*0.25, w/2, h/2, Math.max(w,h)*0.75);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.18)");
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0,0,w,h);
  ctx.restore();
}

function drawContactShadow(ctx, x,y,pw,ph){
  // Ellipse under product
  const cx = x + pw/2;
  const cy = y + ph*0.80;
  const rx = pw*0.32;
  const ry = ph*0.10;

  // Fake blur by multiple fills
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  for(let i=0;i<18;i++){
    const a = 0.02 + i*0.0035;
    ctx.fillStyle = `rgba(0,0,0,${a})`;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx + i*2.2, ry + i*1.2, 0, 0, Math.PI*2);
    ctx.fill();
  }
  ctx.restore();
}

// ---------- Generate flow ----------
function mapImageSize(){
  // For gemini-3-pro-image-preview, allow "2K" to get HD; we downscale if needed.
  const model = modelEl.value;
  const res = Number(resEl.value);

  if(model === "gemini-2.5-flash-image"){
    return {imageSize: null}; // fixed-ish
  }
  // Use 2K for >=1536
  if(res >= 1536) return {imageSize: "2K"};
  return {imageSize: "1K"};
}

async function generateVariants(){
  if(!state.cutoutBitmap) throw new Error("Cutout belum ada. Auto Remove BG / Manual Mask dulu.");

  const model = modelEl.value;
  const aspect = ratioEl.value;
  const {imageSize} = mapImageSize();

  setStatus("Generate background + compositing…", true);
  setProgress(true, "Generating Variant A background…");

  const promptA = buildBackgroundPrompt("A");
  const promptB = buildBackgroundPrompt("B");
  state.lastPromptA = promptA;
  state.lastPromptB = promptB;

  // Variant A
  const b64A = await geminiGenerateImageBase64(promptA, {model, aspectRatio: aspect, imageSize});
  const bgBlobA = base64ToBlob(b64A, "image/png");
  const bgBmpA = await blobToBitmap(bgBlobA);

  setProgress(true, "Compositing Variant A…");
  const outBlobA = await compositeProductOverBackground(bgBmpA, ctxA);

  // Variant B
  setProgress(true, "Generating Variant B background…");
  const b64B = await geminiGenerateImageBase64(promptB, {model, aspectRatio: aspect, imageSize});
  const bgBlobB = base64ToBlob(b64B, "image/png");
  const bgBmpB = await blobToBitmap(bgBlobB);

  setProgress(true, "Compositing Variant B…");
  const outBlobB = await compositeProductOverBackground(bgBmpB, ctxB);

  // Enable downloads
  btnDownloadA.disabled = false;
  btnDownloadB.disabled = false;
  btnRegen.disabled = false;

  // Store for re-download
  state._outA = outBlobA;
  state._outB = outBlobB;

  setProgress(false);
  setStatus("Selesai! Variants siap di-download.", false);
}

// ---------- Downloads ----------
function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------- Presets ----------
function applyPreset(which){
  if(which === "p1"){
    carpetColorEl.value = "cream";
    carpetTypeEl.value = "light shaggy carpet";
    state.ornaments = ["pot tanaman kecil hijau"];
    moodEl.value = "clean studio";
    lightEl.value = "window soft daylight";
    lightIntensityEl.value = "65";
    cameraPosEl.value = "top-down 90 degrees, straight overhead, flat lay";
    cameraTypeEl.value = "iPhone 15 Pro";
  }
  if(which === "p2"){
    carpetColorEl.value = "beige";
    carpetTypeEl.value = "smooth velvet carpet";
    state.ornaments = ["majalah aesthetic"];
    moodEl.value = "luxury calm";
    lightEl.value = "golden hour warm";
    lightIntensityEl.value = "70";
    cameraPosEl.value = "45 degree angle, slightly elevated";
    cameraTypeEl.value = "Sony A7IV with 50mm lens";
  }
  if(which === "p3"){
    carpetColorEl.value = "light grey";
    carpetTypeEl.value = "woven carpet";
    state.ornaments = ["tanpa ornamen"];
    moodEl.value = "clean studio";
    lightEl.value = "diffused studio softbox";
    lightIntensityEl.value = "60";
    cameraPosEl.value = "top-down 90 degrees, straight overhead, flat lay";
    cameraTypeEl.value = "Canon R6 with 35mm lens";
  }
  renderOrnaments();
  syncCustomColorUI();
  syncCameraCustomUI();
  lightIntensityVal.textContent = lightIntensityEl.value;
  saveLocal();
  setStatus("Preset diterapkan.", false);
}

// ---------- Events ----------
stylizeEl.addEventListener("input", ()=>{
  stylizeVal.textContent = stylizeEl.value;
  saveLocal();
});
lightIntensityEl.addEventListener("input", ()=>{
  lightIntensityVal.textContent = lightIntensityEl.value;
  saveLocal();
});
brushSizeEl.addEventListener("input", ()=>{
  brushSizeVal.textContent = brushSizeEl.value;
  maskMode.brush = Number(brushSizeEl.value);
});

carpetColorEl.addEventListener("change", ()=>{
  syncCustomColorUI();
  saveLocal();
});
cameraTypeEl.addEventListener("change", ()=>{
  syncCameraCustomUI();
  saveLocal();
});

[
  apiKeyEl, modelEl, keepShapeEl, watermarkEl,
  ratioEl, resEl, carpetTypeEl, moodEl, lightEl, cameraPosEl,
  carpetColorHexEl, cameraCustomEl
].forEach(el => el.addEventListener("change", saveLocal));

fileInput.addEventListener("change", async ()=>{
  const file = fileInput.files?.[0];
  if(!file) return;
  state.file = file;
  state.cutoutBlob = null;
  state.cutoutBitmap = null;

  btnDownloadCutout.disabled = true;
  btnDownloadA.disabled = true;
  btnDownloadB.disabled = true;
  btnRegen.disabled = true;

  setStatus("Memuat gambar...", true);
  setProgress(true, "Decoding image...");
  try{
    state.inputImageBitmap = await fileToBitmap(file);
    await renderInputPreview();
    setStatus("Gambar siap. Lanjut Auto Remove BG / Manual Mask.", false);
  }finally{
    setProgress(false);
  }
});

btnAutoRemove.addEventListener("click", async ()=>{
  try{
    await autoRemoveBackground();
    saveLocal();
  }catch(e){
    alert(String(e?.message || e));
  }
});

btnMaskMode.addEventListener("click", ()=>{
  openMaskUI();
});

btnMaskApply.addEventListener("click", async ()=>{
  try{
    await applyMaskToCreateCutout();
    saveLocal();
  }catch(e){
    alert(String(e?.message || e));
  }
});

btnMaskClear.addEventListener("click", ()=>{
  if(!maskLayer) return;
  const mctx = maskLayer.getContext("2d");
  mctx.fillStyle = "black";
  mctx.fillRect(0,0,maskLayer.width, maskLayer.height);
  repaintMaskCanvas();
});
btnMaskClose.addEventListener("click", ()=>{
  maskUI.classList.add("hide");
  maskMode.enabled = false;
});

btnGenerate.addEventListener("click", async ()=>{
  try{
    const h = settingsHash();
    state.lastSettingsHash = h;
    await generateVariants();
    saveLocal();
  }catch(e){
    console.error(e);
    alert(String(e?.message || e));
    setProgress(false);
    setStatus("Error. Cek API key / koneksi / cutout.", false);
  }
});

btnRegen.addEventListener("click", async ()=>{
  try{
    await generateVariants();
  }catch(e){
    console.error(e);
    alert(String(e?.message || e));
    setProgress(false);
    setStatus("Error regenerate.", false);
  }
});

btnDownloadCutout.addEventListener("click", ()=>{
  if(!state.cutoutBlob) return;
  downloadBlob(state.cutoutBlob, "cutout.png");
});
btnDownloadA.addEventListener("click", ()=>{
  if(!state._outA) return;
  downloadBlob(state._outA, "variant-a.png");
});
btnDownloadB.addEventListener("click", ()=>{
  if(!state._outB) return;
  downloadBlob(state._outB, "variant-b.png");
});

btnReset.addEventListener("click", ()=>{
  if(confirm("Reset semua setting & hasil?")){
    localStorage.removeItem("carpetPhotoGen.v1");
    location.reload();
  }
});

// Ornament picker
function initOrnamentPicker(){
  ornamentPickEl.innerHTML = "";
  for(const opt of ORNAMENT_OPTIONS){
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    ornamentPickEl.appendChild(o);
  }
}
ornamentAddEl.addEventListener("click", ()=>{
  const v = ornamentPickEl.value;
  if(!v) return;

  if(v === "tanpa ornamen"){
    state.ornaments = ["tanpa ornamen"];
  }else{
    state.ornaments = state.ornaments.filter(x => x !== "tanpa ornamen");
    if(!state.ornaments.includes(v)) state.ornaments.push(v);
  }
  enforceOrnamentRules();
  renderOrnaments();
  saveLocal();
});
ornamentAddCustomEl.addEventListener("click", ()=>{
  const v = (ornamentCustomEl.value || "").trim();
  if(!v) return;

  state.ornaments = state.ornaments.filter(x => x !== "tanpa ornamen");
  if(!state.ornaments.includes(v)) state.ornaments.push(v);
  ornamentCustomEl.value = "";
  enforceOrnamentRules();
  renderOrnaments();
  saveLocal();
});

// Preset buttons
document.querySelectorAll("[data-preset]").forEach(btn=>{
  btn.addEventListener("click", ()=>applyPreset(btn.dataset.preset));
});

// ---------- Boot ----------
initOrnamentPicker();
loadLocal();
renderOrnaments();
setStatus("Siap.", false);
