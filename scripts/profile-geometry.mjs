import { performance } from 'node:perf_hooks';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { composeIcon } = await vite.ssrLoadModule('/src/engine/compose.ts');
  const { subjects, modifiers } = await vite.ssrLoadModule('/src/proof/icons.ts');
  const cases = [
    ['file + plus', subjects.file, modifiers.plus],
    ['folder + check', subjects.folder, modifiers.check],
    ['calendar + pencil', subjects.calendar, modifiers.pencil],
  ];
  for (const [name, subjectSvg, modifierSvg] of cases) {
    const input = {
      subjectSvg, modifierSvg,
      placement: { anchor: 'bottom-right', offsetX: 0, offsetY: 0, scale: 0.45 },
      composition: { mode: 'cutout', clearance: 2 },
    };
    composeIcon(input); // warm up imports and JIT
    for (const preview of [false, true]) {
      const durations = [];
      for (let i = 0; i < 12; i++) {
        input.placement.offsetX = (i % 6) * 0.25;
        const start = performance.now();
        composeIcon(input, { preview });
        durations.push(performance.now() - start);
      }
      durations.sort((a, b) => a - b);
      const median = (durations[5] + durations[6]) / 2;
      const p95 = durations[Math.ceil(durations.length * 0.95) - 1];
      process.stdout.write(`${name} ${preview ? 'drag preview' : 'exact'}: median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms\n`);
    }
  }
} finally {
  await vite.close();
}
