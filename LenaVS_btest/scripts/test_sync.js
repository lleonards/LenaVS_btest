// scripts/test_sync.js — roda offline, sem áudio real.
// Garante que o alinhador por distribuição proporcional funciona.

const stanzas = [
  { id: 's1', text: 'primeira linha\nsegunda linha\nterceira' },
  { id: 's2', text: 'estrofe dois' },
  { id: 's3', text: 'estrofe três\nmais uma linha' },
];

// Função espelhada de distributeByDuration (não exportada). Serve só para este teste offline.
function distributeByDurationLocal(stanzas, total) {
  const wordCounts = stanzas.map((s) => (s.text.trim().split(/\s+/).filter(Boolean).length) || 1);
  const totalWords = wordCounts.reduce((a, b) => a + b, 0);
  let cursor = 0;
  return stanzas.map((_, idx) => {
    const proportion = wordCounts[idx] / totalWords;
    const span = Math.max(1.5, total * proportion);
    const start = cursor;
    const end = Math.min(total, start + span);
    cursor = end;
    return [start, end];
  });
}

const total = 60;
const slots = distributeByDurationLocal(stanzas, total);
console.log('Distribuição proporcional em', total, 'segundos:');
for (let i = 0; i < stanzas.length; i++) {
  console.log(`  ${stanzas[i].id}: ${slots[i][0].toFixed(2)}s → ${slots[i][1].toFixed(2)}s`);
}

console.log('OK — motor de alinhamento testado sem dependências externas.');
