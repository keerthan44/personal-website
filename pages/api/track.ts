import { createTrackHandler } from "../../voice-agent/analytics.mjs";

export default createTrackHandler({
  fetchImpl: fetch,
  env: process.env,
  now: Date.now,
});
