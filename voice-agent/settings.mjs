import { RESUME } from './resume.mjs';
import { buildPrompt } from './prompt.mjs';

export const KEYTERMS = [
  'Keerthan', 'Gopalakrishnan', 'LiveKit', 'Deepgram', 'Kraftx', 'IntellifyAi',
  'Blue Machines', 'BigBasket', 'IoTReady', 'Neoscale', 'PES University', 'DuckDB', 'Temporal',
];

export const GREETING =
  "Hi, I'm Keerthan's AI agent. Ask me anything about his work: what he's built, where he's worked, or whether he's open to new roles.";

export function buildSettings() {
  const prompt = buildPrompt(RESUME);
  return {
    type: 'Settings',
    tags: ['portfolio'],
    mip_opt_out: true,
    experimental: true,
    audio: {
      // placeholder; the client overwrites with its AudioContext.sampleRate
      input: { encoding: 'linear16', sample_rate: 48000 },
      output: { encoding: 'linear16', sample_rate: 24000, container: 'none' },
    },
    agent: {
      listen: {
        provider: {
          type: 'deepgram',
          version: 'v2',
          model: 'flux-general-en',
          keyterms: KEYTERMS,
          eot_threshold: 0.7,
          eot_timeout_ms: 5000,
        },
      },
      think: [
        { provider: { type: 'open_ai', model: 'gpt-4.1-mini', temperature: 0.4 }, prompt },
        { provider: { type: 'anthropic', model: 'claude-haiku-4-5', temperature: 0.4 }, prompt },
      ],
      speak: { provider: { type: 'deepgram', version: 'v2', model: 'flux-miles-en' } },
      greeting: GREETING,
    },
  };
}
