// Escaner de hardware: clasifica la GPU y recomienda modo de rendimiento.
// La GPU llega como string de WebGL (renderer) porque en Node no hay forma de
// leerla: WEBGL_debug_renderer_info da en Windows algo como
// "ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)".
// Puro y testeable: nada de OS aca salvo scan().
const os = require('os');
const { autoRamMax } = require('./configManager');

// 'alta' | 'media' | 'baja' | 'software' | 'desconocida'
function classifyGpu(str) {
  const s = String(str || '').toLowerCase().trim();
  if (!s) return 'desconocida';

  // Sin GPU real (render por software): el juego va a ir mal SIEMPRE.
  if (/llvmpipe|softpipe|swiftshader|basic render|microsoft basic|warp|mesa offscreen|virgl|virtualbox|vmware|parallels/.test(s)) {
    return 'software';
  }
  // Apple Silicon
  if (/apple m\d+ (pro|max|ultra)/.test(s)) return 'alta';
  if (/apple m\d+/.test(s)) return 'media';
  // NVIDIA
  if (/geforce rtx|\brtx \d|rtx a\d|quadro rtx/.test(s)) return 'alta';
  if (/gtx (16[5-8]0|10[6-8]0|9[78]0)|quadro (p|t)\d{3,4}/.test(s)) return 'alta';
  if (/gtx (1050|960|950|870m|860m|780|770|760|750)|gtx 9[456]0m|mx(1|2|3|4|5)\d0|gt (1030|x)/.test(s)) return 'media';
  if (/geforce (8[24]0m|9[24]0m|930m|920m|940mx)|gt (7[13]0|6[45]0|555|540)|gtx? (4[67]0|480)/.test(s)) return 'baja';
  // AMD (Radeon)
  if (/rx (5[6-9]\d0|6\d{3}|7\d{3}|9\d{3})|radeon (vii|vega (56|64)|7[89]0m|8[89]0m)/.test(s)) return 'alta';
  if (/rx (5[4-9]0|4[6-8]0)|radeon (pro|w)\d|radeon 6[89]0m/.test(s)) return 'media';
  if (/radeon (r[57]|hd) |radeon graphics|vega (3|5|6|7|8|10|11)\b/.test(s)) return 'baja';
  // Intel
  if (/\barc a\d|\barc b\d|\biris xe (max|graphics)/.test(s)) return 'media';
  if (/iris (xe|plus|pro)|iris\(r\) xe/.test(s)) return 'media';
  if (/uhd graphics|hd graphics|gma|intel.*graphics (3|4|5|6)\d0/.test(s)) return 'baja';
  return 'desconocida';
}

// ANGLE (...Device...) -> nombre legible; si no, el string tal cual.
function cleanGpuName(str) {
  const s = String(str || '').trim();
  const m = s.match(/ANGLE \(([^,]+),\s*([^,]+)/);
  if (m) {
    return m[2].replace(/\s+(Direct3D\d*|vs_\d|ps_\d|ps_5_0|D3D\d*|OpenGL|Vulkan|\(0x[0-9a-f]+\)).*/i, '').trim();
  }
  return s;
}

// score: gpu(0-4) + cpu(0-3) + ram(0-3) -> 0..10
function recommendMode({ cores = 0, ramGB = 0, gpuTier = 'desconocida' }) {
  const gpuScore = { alta: 4, media: 2, desconocida: 2, baja: 1, software: 0 }[gpuTier] ?? 2;
  const cpuScore = cores >= 8 ? 3 : cores >= 6 ? 2 : cores >= 4 ? 1 : 0;
  const ramScore = ramGB >= 16 ? 3 : ramGB >= 12 ? 2 : ramGB >= 8 ? 1 : 0;
  const score = gpuScore + cpuScore + ramScore;

  let recommended;
  if (gpuTier === 'software' || ramGB < 8) {
    recommended = 'minimo'; // sin GPU real o casi sin RAM no hay tu tia
  } else if (gpuTier === 'baja') {
    recommended = score >= 7 ? 'medio' : 'minimo'; // GPU floja limita aunque sobre CPU
  } else if (score >= 7) {
    recommended = 'alto';
  } else if (score >= 4) {
    recommended = 'medio';
  } else {
    recommended = 'minimo';
  }

  const reasons = [];
  reasons.push({ k: 'gpu', text: `GPU (${gpuTier === 'desconocida' ? 'no reconocida' : gpuTier})` });
  reasons.push({ k: 'cpu', text: `${cores} nucleos` });
  reasons.push({ k: 'ram', text: `${ramGB} GB de RAM` });
  return { score, recommended, reasons };
}

// Heap sugerido: el default por maquina, nunca por debajo del ramHint del modo,
// y siempre dejando >=2 GB al sistema.
function suggestRamMax(ramGB, ramHint) {
  const totalMB = Math.round(ramGB * 1024);
  const cap = Math.max(2048, Math.floor((totalMB - 2048) / 512) * 512);
  const base = Math.max(autoRamMax(ramGB * 1073741824), ramHint || 0);
  return Math.min(base, cap);
}

// Scan real: usa el string de GPU que manda el renderer y los ramHint del manifest.
function scan({ gpu, ramHints } = {}) {
  const cpus = os.cpus();
  const cores = cpus.length;
  const model = ((cpus[0] && cpus[0].model) || '').replace(/\s+/g, ' ').trim();
  const totalBytes = os.totalmem();
  const ramGB = Math.round(totalBytes / 1073741824);
  const tier = classifyGpu(gpu);
  const rec = recommendMode({ cores, ramGB, gpuTier: tier });
  const ramHint = (ramHints || {})[rec.recommended] || 0;
  return {
    cpu: { model, cores },
    ramGB,
    gpu: { name: cleanGpuName(gpu), raw: String(gpu || ''), tier },
    score: rec.score,
    recommended: rec.recommended,
    reasons: rec.reasons,
    suggestedRamMax: suggestRamMax(ramGB, ramHint),
  };
}

module.exports = { classifyGpu, cleanGpuName, recommendMode, suggestRamMax, scan };
