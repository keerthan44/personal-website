declare module "*/voice-agent/token.mjs" {
  import type { NextApiRequest, NextApiResponse } from "next";
  export function createTokenHandler(deps: {
    fetchImpl: typeof fetch;
    env: { [key: string]: string | undefined };
    now: () => number;
  }): (req: NextApiRequest, res: NextApiResponse) => Promise<void>;
}

declare module "*/voice-agent/analytics.mjs" {
  import type { NextApiRequest, NextApiResponse } from "next";
  type Deps = {
    fetchImpl: typeof fetch;
    env: { [key: string]: string | undefined };
    now: () => number;
  };
  export function createTrackHandler(deps: Deps): (req: NextApiRequest, res: NextApiResponse) => Promise<void>;
  export function createStatsHandler(deps: Deps): (req: NextApiRequest, res: NextApiResponse) => Promise<void>;
}
