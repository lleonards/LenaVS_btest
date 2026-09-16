import assert from 'assert';
import {
  buildAlignmentBlocks,
  buildAlignmentText,
  countAlignmentWords,
  mapAlignmentToBlocks,
} from './src/utils/lyricsAlignment.js';

// Letra de exemplo: mesma divisão de blocos que o sistema já faz.
const stanzas = [
  { text: 'Eu quero cantar\numa canção' },
  { text: 'E depois\n[Refrão]\nvoltar' },
];

const blocks = buildAlignmentBlocks(stanzas);
const alignmentText = buildAlignmentText(blocks);

// 1) Texto enviado ao alinhador: mesmas palavras, mesma ordem (tags entre colchetes fora).
assert.strictEqual(alignmentText, 'Eu quero cantar uma canção E depois voltar', 'texto do alinhador divergente');
assert.strictEqual(countAlignmentWords(blocks), 8, 'contagem de palavras alinháveis divergente');
assert.strictEqual(blocks[0].text, stanzas[0].text, 'texto do bloco 0 foi alterado');

// 2) Blocos originais preservados (nada re-dividido).
assert.strictEqual(blocks.length, 2, 'número de blocos mudou');

// 3) Alinhamento perfeito: Eu 10.02–10.45, quero 10.5–11.0, cantar 11.0–12.51 ...
const words = [
  { text: 'eu', start: 10.02, end: 10.45 },
  { text: 'quero', start: 10.5, end: 11.0 },
  { text: 'cantar', start: 11.0, end: 12.51 },
  { text: 'uma', start: 12.9, end: 13.2 },
  { text: 'canção', start: 13.3, end: 14.0 },
  { text: 'e', start: 20.0, end: 20.2 },
  { text: 'depois', start: 20.3, end: 21.0 },
  { text: 'voltar', start: 25.0, end: 26.4 },
];

const perfect = mapAlignmentToBlocks({ stanzas, alignedWords: words, audioDuration: 30 });

// Bloco 1: início = início da 1a palavra (10.02 → 00:10), fim = fim da última (14.0 → 00:14)
assert.strictEqual(perfect.blocks[0].startTime, '00:10', 'bloco 0 startTime errado');
assert.strictEqual(perfect.blocks[0].endTime, '00:14', 'bloco 0 endTime errado');
assert.strictEqual(perfect.blocks[1].startTime, '00:20', 'bloco 1 startTime errado');
assert.strictEqual(perfect.blocks[1].endTime, '00:26', 'bloco 1 endTime errado');
assert.strictEqual(perfect.meta.reliable, true, 'meta.reliable deveria ser true');
assert.match(perfect.blocks[0].startTime, /^\d{2}:\d{2}$/, 'formato MM:SS inválido');

console.log('Blocos (alinhamento perfeito):');
perfect.blocks.forEach((b) => console.log(`  bloco ${b.index}: ${b.startTime} → ${b.endTime} (${b.startSeconds}s → ${b.endSeconds}s)`));

// 4) 40% de palavras faltando → modo proporcional, sem travar e sem sobreposição.
const partial = mapAlignmentToBlocks({
  stanzas,
  alignedWords: [words[0], words[2], words[6]],
  audioDuration: 30,
});

assert.strictEqual(partial.blocks.length, 2, 'perdeu blocos no modo proporcional');
assert.strictEqual(partial.meta.reliable, false, 'meta.reliable deveria indicar resultado aproximado');
partial.blocks.forEach((block, index) => {
  const parse = (value) => Number(value.split(':')[0]) * 60 + Number(value.split(':')[1]);
  assert.ok(parse(block.endTime) > parse(block.startTime), `bloco ${index} sem duração`);
  if (index > 0) {
    const previousEnd = parse(partial.blocks[index - 1].endTime);
    assert.ok(parse(block.startTime) >= previousEnd, `bloco ${index} sobrepõe o anterior`);
  }
});

console.log('Blocos (alinhamento parcial):');
partial.blocks.forEach((b) => console.log(`  bloco ${b.index}: ${b.startTime} → ${b.endTime} (modo ${partial.meta.mode})`));

// 5) Resultado vazio → não inventa tempos silenciosamente.
const empty = mapAlignmentToBlocks({ stanzas, alignedWords: [] });
assert.strictEqual(empty.meta.mode, 'none', 'modo vazio deveria ser none');
assert.ok(empty.blocks.every((b) => b.startTime === null), 'modo vazio não deveria gerar tempos');

// 6) Duas letras iguais em blocos diferentes não compartilham a mesma palavra global.
const repeated = mapAlignmentToBlocks({
  stanzas: [{ text: 'Amor amor' }, { text: 'Amor amor' }],
  alignedWords: [
    { text: 'amor', start: 1, end: 1.4 },
    { text: 'amor', start: 1.5, end: 2 },
    { text: 'amor', start: 10, end: 10.4 },
    { text: 'amor', start: 10.5, end: 11 },
  ],
  audioDuration: 12,
});
assert.strictEqual(repeated.blocks[1].startTime, '00:10', 'segundo bloco repetido com tempo errado');

console.log('\nTodos os testes de mapeamento passaram.');
