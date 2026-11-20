import test from 'node:test';
import assert from 'node:assert';
import { floatToInt16, int16ToFloat, rms, Batcher } from '../../public/voice/pcm.mjs';

test('floatToInt16 maps full scale and zero', () => {
  const out = floatToInt16(new Float32Array([1, -1, 0, 0.5]));
  assert.ok(out instanceof Int16Array);
  assert.strictEqual(out[0], 32767);
  assert.strictEqual(out[1], -32768);
  assert.strictEqual(out[2], 0);
  assert.ok(Math.abs(out[3] - 16384) <= 1, `0.5 -> ${out[3]}`);
});

test('floatToInt16 clamps out-of-range input', () => {
  const out = floatToInt16(new Float32Array([1.5, -2, 10]));
  assert.deepStrictEqual(Array.from(out), [32767, -32768, 32767]);
});

test('int16ToFloat round-trips within 1e-4', () => {
  const src = new Float32Array([0, 0.25, -0.25, 0.999, -0.999, 0.5]);
  const back = int16ToFloat(floatToInt16(src));
  assert.ok(back instanceof Float32Array);
  for (let i = 0; i < src.length; i++) assert.ok(Math.abs(back[i] - src[i]) < 1e-4, `${i}: ${back[i]} vs ${src[i]}`);
});

test('rms of zeros is 0 and of constant 0.5 is 0.5', () => {
  assert.strictEqual(rms(new Float32Array(16)), 0);
  assert.ok(Math.abs(rms(new Float32Array(16).fill(0.5)) - 0.5) < 1e-9);
  assert.strictEqual(rms(new Float32Array(0)), 0);
});

test('Batcher returns full chunks and keeps the remainder', () => {
  const b = new Batcher(4);
  assert.deepStrictEqual(b.push(new Int16Array([1, 2, 3])), []);
  const chunks = b.push(new Int16Array([4, 5, 6, 7, 8, 9]));
  assert.strictEqual(chunks.length, 2);
  assert.deepStrictEqual(Array.from(chunks[0]), [1, 2, 3, 4]);
  assert.deepStrictEqual(Array.from(chunks[1]), [5, 6, 7, 8]);
  const next = b.push(new Int16Array([10, 11, 12]));
  assert.deepStrictEqual(next.map((c) => Array.from(c)), [[9, 10, 11, 12]]);
});
