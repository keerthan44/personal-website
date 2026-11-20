import { createTokenHandler } from "../../voice-agent/token.mjs";

export default createTokenHandler({
  fetchImpl: fetch,
  env: process.env,
  now: Date.now,
});
