import { createStatsHandler } from "../../voice-agent/analytics.mjs";

export default createStatsHandler({
  fetchImpl: fetch,
  env: process.env,
  now: Date.now,
});
