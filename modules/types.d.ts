declare module "*.pdf";

declare module "*/voice-agent/token.mjs" {
  import type { NextApiRequest, NextApiResponse } from "next";
  export function createTokenHandler(deps: {
    fetchImpl: typeof fetch;
    env: { [key: string]: string | undefined };
    now: () => number;
  }): (req: NextApiRequest, res: NextApiResponse) => Promise<void>;
}
