import test from 'node:test';
import assert from 'node:assert';
import { cleanSpoken } from '../../public/voice/captions.mjs';
import { PRONUNCIATIONS, pronounceAll } from '../../public/voice/pronunciations.mjs';
import { GREETING } from '../../voice-agent/settings.mjs';

const exact = '\\{"word": "Keerthan", "pronounce": "ˈkiːɹtən"\\}';

test('plain text is unchanged', () => {
  assert.strictEqual(cleanSpoken('Hello there, {not markup}.'), 'Hello there, {not markup}.');
  assert.strictEqual(cleanSpoken(''), '');
});

test('exact markup becomes the word', () => {
  assert.strictEqual(cleanSpoken(`Hi ${exact}!`), 'Hi Keerthan!');
  assert.strictEqual(cleanSpoken(`${exact}'s work`), "Keerthan's work");
});

test('tolerates unescaped braces, double backslashes, spacing, key order, smart quotes', () => {
  assert.strictEqual(cleanSpoken('Hi {"word": "Keerthan", "pronounce": "x"}'), 'Hi Keerthan');
  assert.strictEqual(cleanSpoken('Hi \\\\{"word": "Keerthan", "pronounce": "x"\\\\}'), 'Hi Keerthan');
  assert.strictEqual(cleanSpoken('Hi \\{ "word" :  "Keerthan" ,  "pronounce" : "x" \\}'), 'Hi Keerthan');
  assert.strictEqual(cleanSpoken('Hi \\{"pronounce": "x", "word": "Keerthan"\\}'), 'Hi Keerthan');
  assert.strictEqual(cleanSpoken('Hi \\{“word”: “Keerthan”, “pronounce”: “x”\\}'), 'Hi Keerthan');
});

test('removes stray escaped braces', () => {
  assert.strictEqual(cleanSpoken('a \\{ b \\} c'), 'a  b  c');
});

test('round trips', () => {
  const plain = "Hey, I'm Keerthan, or at least the AI version. Ask me what I've built, or where I've worked.";
  assert.strictEqual(cleanSpoken(GREETING), plain, 'the shipped greeting captions cleanly');
  assert.strictEqual(cleanSpoken(pronounceAll(plain)), plain);
  const s = PRONUNCIATIONS.map((p) => p.word).join(', ') + ".";
  assert.strictEqual(cleanSpoken(pronounceAll(s)), s);
});

test('unclosed trailing fragment becomes the word', () => {
  assert.strictEqual(cleanSpoken('Hi \\{"word": "Keerthan", "pronounce": "ˈkiː'), 'Hi Keerthan');
  assert.strictEqual(cleanSpoken('Hi \\{"word": "Keerthan", '), 'Hi Keerthan');
  assert.strictEqual(cleanSpoken('Hi \\{"pronounce": "ˈkiːɹtən", "word": "Keerthan'), 'Hi Keerthan');
  assert.strictEqual(cleanSpoken('Hi \\{"pronounce": "ˈkiː'), 'Hi ');
  assert.strictEqual(cleanSpoken('Hi \\{'), 'Hi ');
});

test('orphan leading tail is removed', () => {
  assert.strictEqual(cleanSpoken('"pronounce": "ˈkiːɹtən"\\} is here'), ' is here');
  assert.strictEqual(cleanSpoken('ɹθən"\\}\'s work'), "'s work");
  assert.strictEqual(cleanSpoken('\\}'), '');
  for (const s of ['"word":', '"pronounce":']) assert.ok(!cleanSpoken(`${s} "x"\\} a`).includes(s));
});

test('many backslashes finish fast', () => {
  const s = '\\'.repeat(10000) + '{"word": "x"';
  for (const input of [s, '\\'.repeat(10000), '{'.repeat(5000)]) {
    const t0 = performance.now();
    cleanSpoken(input);
    assert.ok(performance.now() - t0 < 50);
  }
});
