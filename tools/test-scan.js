// Test del escaner de hardware: clasificacion de GPU (strings reales de WebGL)
// + recomendacion de modo + RAM sugerida. Puro: no toca la maquina.
// Uso: node tools/test-scan.js
const { classifyGpu, cleanGpuName, recommendMode, suggestRamMax } = require('../src/main/launcher/hardwareScan');

let fails = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${name}: ${JSON.stringify(got)}${ok ? '' : ` (esperado ${JSON.stringify(want)})`}`);
};

console.log('--- classifyGpu (strings tipicos de ANGLE/WebGL) ---');
check('RTX 4060', classifyGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'alta');
check('GTX 1650', classifyGpu('ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'alta');
check('GTX 1050', classifyGpu('ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'media');
check('MX150', classifyGpu('ANGLE (NVIDIA, NVIDIA GeForce MX150 Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'media');
check('UHD 620', classifyGpu('ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00003EA0) Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'baja');
check('Iris Xe', classifyGpu('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'media');
check('RX 580', classifyGpu('ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'media');
check('RX 6700 XT', classifyGpu('ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'alta');
check('Vega 8 iGPU', classifyGpu('ANGLE (AMD, AMD Radeon(TM) Vega 8 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'baja');
check('SwiftShader', classifyGpu('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), 'software');
check('llvmpipe (Linux)', classifyGpu('llvmpipe (LLVM 17.0.6, 256 bits)'), 'software');
check('Basic Render Driver', classifyGpu('ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'software');
check('vacio', classifyGpu(''), 'desconocida');

console.log('\n--- cleanGpuName ---');
check('ANGLE NVIDIA', cleanGpuName('ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'NVIDIA GeForce RTX 4060');
check('ANGLE Intel', cleanGpuName('ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00003EA0) Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'Intel(R) UHD Graphics 620');
check('crudo', cleanGpuName('llvmpipe (LLVM 17.0.6, 256 bits)'), 'llvmpipe (LLVM 17.0.6, 256 bits)');

console.log('\n--- recommendMode ---');
const r1 = recommendMode({ cores: 12, ramGB: 32, gpuTier: 'alta' });
check('RTX + 12 nucleos + 32 GB', r1.recommended, 'alto');
const r2 = recommendMode({ cores: 6, ramGB: 16, gpuTier: 'alta' });
check('GTX 1650 + 16 GB', r2.recommended, 'alto');
const r3 = recommendMode({ cores: 4, ramGB: 8, gpuTier: 'media' });
check('Iris Xe + 4 nucleos + 8 GB', r3.recommended, 'medio');
const r4 = recommendMode({ cores: 4, ramGB: 8, gpuTier: 'baja' });
check('UHD 620 + 8 GB', r4.recommended, 'muerto');
const r5 = recommendMode({ cores: 4, ramGB: 4, gpuTier: 'media' });
check('4 GB de RAM', r5.recommended, 'muerto');
const r6 = recommendMode({ cores: 8, ramGB: 16, gpuTier: 'software' });
check('Sin GPU real', r6.recommended, 'muerto');
const r7 = recommendMode({ cores: 2, ramGB: 8, gpuTier: 'baja' });
check('Celeron + iGPU floja', r7.recommended, 'muerto');
const r8 = recommendMode({ cores: 6, ramGB: 12, gpuTier: 'baja' });
check('Vega 8 + 6 nucleos + 12 GB', r8.recommended, 'minimo');
const r9 = recommendMode({ cores: 8, ramGB: 16, gpuTier: 'baja' });
check('GPU baja pero CPU/RAM de sobra', r9.recommended, 'medio');
console.log('  reasons r1:', r1.reasons.map((x) => x.text).join(' · '));

console.log('\n--- suggestRamMax ---');
check('32 GB / alto', suggestRamMax(32, 6144), 8192);
check('16 GB / medio', suggestRamMax(16, 4096), 6144);
check('8 GB / minimo', suggestRamMax(8, 3072), 4096);
check('4 GB / minimo (tope: deja 2 GB al sistema)', suggestRamMax(4, 3072), 2048);

console.log(fails ? `\n${fails} FALLA(S)` : '\nTodo OK ✔');
process.exit(fails ? 1 : 0);
