import { expect, it } from "vitest";
import { createApp } from "../../src/server/app";
import { fakeAdapter } from "../helpers/fake-adapter";

it("reports availability and tested flags without secrets", async () => {
  const res = await createApp({ registry: { anthropic: fakeAdapter({}) } }).request("/api/models");
  const body = await res.json() as { models: { id: string; available: boolean; tested: boolean }[] };
  expect(body.models.find((m) => m.id === "claude-haiku")).toMatchObject({ available: true, tested: true });
  expect(body.models.find((m) => m.id === "openai")).toMatchObject({ available: false, tested: false });
  expect(JSON.stringify(body)).not.toMatch(/sk-ant|api[_-]?key/i);
});

it("nothing is available with an empty registry (a keyless deployment)", async () => {
  const body = await (await createApp({}).request("/api/models")).json() as { models: { available: boolean }[] };
  expect(body.models.every((m) => !m.available)).toBe(true);
});

it("gives the client what the context meter needs", async () => {
  const body = await (await createApp({}).request("/api/models")).json() as
    { contextWarning: { amber: number; red: number }; systemPromptTokens: number; models: { contextWindow: number }[] };
  expect(body.contextWarning).toEqual({ amber: 0.75, red: 0.9 });
  expect(body.systemPromptTokens).toBeGreaterThan(1000);
  expect(body.models.every((m) => m.contextWindow > 0)).toBe(true);
});
