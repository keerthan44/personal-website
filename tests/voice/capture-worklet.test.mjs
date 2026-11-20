import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function loadWorklet(sampleRate) {
  const src = readFileSync(new URL('../../public/voice/capture-worklet.js', import.meta.url), 'utf8');
  const posted = [];
  const registry = {};
  class AudioWorkletProcessor { constructor() { this.port = { postMessage: (msg, transfer) => posted.push({ msg, transfer }) }; } }
  vm.runInNewContext(src, { AudioWorkletProcessor, registerProcessor: (n, c) => { registry[n] = c; }, sampleRate, Math, Int16Array, Number });
  return { Proc: registry['pcm-capture'], posted };
}

test('pcm-capture posts 20 ms Int16 chunks with an rms level, transferring the buffer', () => {
  const { Proc, posted } = loadWorklet(48000);
  assert.ok(Proc, 'registered as pcm-capture');
  const proc = new Proc();
  const block = new Float32Array(128).fill(0.5);
  for (let i = 0; i < 7; i++) assert.strictEqual(proc.process([[block]]), true);
  assert.strictEqual(posted.length, 0); // 896 < 960
  proc.process([[block]]);
  assert.strictEqual(posted.length, 1);
  const { msg, transfer } = posted[0];
  assert.ok(msg.pcm instanceof ArrayBuffer || Object.prototype.toString.call(msg.pcm) === '[object ArrayBuffer]');
  assert.strictEqual(msg.pcm.byteLength, 960 * 2);
  assert.strictEqual(transfer[0], msg.pcm);
  assert.ok(Math.abs(msg.level - 0.5) < 1e-6);
  const s = new Int16Array(msg.pcm);
  assert.ok(Math.abs(s[0] - 16384) <= 1);
});

test('pcm-capture chunk size follows the context rate and survives empty inputs', () => {
  const { Proc, posted } = loadWorklet(44100);
  const proc = new Proc();
  assert.strictEqual(proc.process([[]]), true);
  assert.strictEqual(proc.process([]), true);
  const block = new Float32Array(882).fill(2); // clamps
  proc.process([[block]]);
  assert.strictEqual(posted.length, 1);
  assert.strictEqual(posted[0].msg.pcm.byteLength, 882 * 2);
  assert.strictEqual(new Int16Array(posted[0].msg.pcm)[0], 32767);
});
