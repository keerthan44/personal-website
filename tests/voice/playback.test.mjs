import test from 'node:test';
import assert from 'node:assert';
import { Player } from '../../public/voice/playback.mjs';
import { makeClock, makeAudioContextClass } from './fakes.mjs';

const pcm = (samples) => new Int16Array(samples).buffer; // 24 kHz int16

function setup() {
  const clock = makeClock(1000); // currentTime = 1 s
  const Ctx = makeAudioContextClass(clock);
  const ctx = new Ctx({ sampleRate: 48000 });
  const player = new Player(ctx, 24000);
  return { clock, ctx, player };
}

test('three enqueues schedule back-to-back start times', () => {
  const { ctx, player } = setup();
  player.enqueue(pcm(2400)); // 100 ms
  player.enqueue(pcm(4800)); // 200 ms
  player.enqueue(pcm(2400));
  const starts = ctx.sources.map((s) => s.startedAt);
  assert.strictEqual(starts.length, 3);
  assert.ok(Math.abs(starts[0] - 1.0) < 1e-9);
  assert.ok(Math.abs(starts[1] - 1.1) < 1e-9);
  assert.ok(Math.abs(starts[2] - 1.3) < 1e-9);
  assert.strictEqual(player.busy, true);
  assert.ok(Math.abs(player.drainMs - 400) < 1e-6);
});

test('samples are converted from int16 into the buffer', () => {
  const { ctx, player } = setup();
  player.enqueue(new Int16Array([16384, -32768]).buffer);
  const data = ctx.sources[0].buffer.getChannelData(0);
  assert.ok(Math.abs(data[0] - 0.5) < 1e-3);
  assert.ok(Math.abs(data[1] + 1) < 1e-3);
  assert.strictEqual(ctx.sources[0].buffer.sampleRate, 24000);
});

test('flush stops every un-ended source and clears busy', () => {
  const { ctx, player } = setup();
  player.enqueue(pcm(2400));
  player.enqueue(pcm(2400));
  player.enqueue(pcm(2400));
  ctx.sources[0].onended?.(); // first one finished naturally
  player.flush();
  assert.strictEqual(ctx.sources[0].stopped, 0);
  assert.strictEqual(ctx.sources[1].stopped, 1);
  assert.strictEqual(ctx.sources[2].stopped, 1);
  assert.strictEqual(player.busy, false);
  assert.strictEqual(player.drainMs, 0);
});

test('flush disconnects the utterance gain node', () => {
  const { ctx, player } = setup();
  player.enqueue(pcm(2400));
  const gain = ctx.sources[0].connectedTo[0];
  player.flush();
  assert.strictEqual(gain.disconnected, 1);
});

test('enqueue after flush starts at currentTime', async () => {
  const { clock, ctx, player } = setup();
  player.enqueue(pcm(24000)); // 1 s
  await clock.advance(200);
  player.flush();
  player.enqueue(pcm(2400));
  assert.ok(Math.abs(ctx.sources[1].startedAt - 1.2) < 1e-9);
});

test('drains to idle as time passes', async () => {
  const { clock, player } = setup();
  player.enqueue(pcm(2400));
  await clock.advance(150);
  assert.strictEqual(player.busy, false);
  assert.strictEqual(player.drainMs, 0);
});

test('level reads the analyser, clamped to 0..1', () => {
  const { player } = setup();
  assert.strictEqual(player.level, 0);
  player.analyser.value = 0.1;
  assert.ok(player.level > 0 && player.level <= 1);
  player.analyser.value = 1;
  assert.strictEqual(player.level, 1);
});

test('close stops audio and is safe to call twice', () => {
  const { ctx, player } = setup();
  player.enqueue(pcm(2400));
  player.close();
  player.close();
  assert.strictEqual(ctx.sources[0].stopped, 1);
  player.enqueue(pcm(2400));
  assert.strictEqual(ctx.sources.length, 1);
});
