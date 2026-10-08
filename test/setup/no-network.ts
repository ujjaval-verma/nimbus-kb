import { beforeEach } from "vitest";

const blocked = (async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  throw new Error(`tests never call the network (tried ${url})`);
}) as typeof fetch;
globalThis.fetch = blocked;
beforeEach(() => { globalThis.fetch = blocked; });
