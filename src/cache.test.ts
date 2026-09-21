import { expect, test } from "bun:test";
import type { ModelMessage } from "ai";
import { addCacheControl } from "./cache";

test("marks the first and last stable messages without marking the newest two", () => {
  const messages: ModelMessage[] = [
    { role: "user", content: "start" },
    { role: "assistant", content: "first" },
    { role: "assistant", content: "stable", providerOptions: { custom: { flag: true } } },
    { role: "assistant", content: "recent" },
    { role: "user", content: "latest" },
  ];

  const result = addCacheControl(messages);

  expect(result[0].providerOptions?.anthropic).toEqual({ cacheControl: { type: "ephemeral" } });
  expect(result[1].providerOptions).toBeUndefined();
  expect(result[2].providerOptions).toEqual({
    custom: { flag: true },
    anthropic: { cacheControl: { type: "ephemeral" } },
  });
  expect(result[3].providerOptions).toBeUndefined();
  expect(result[4].providerOptions).toBeUndefined();
  expect(messages[0].providerOptions).toBeUndefined();
});

test("marks the first message even when the conversation is short", () => {
  const result = addCacheControl([{ role: "user", content: "hello" }]);
  expect(result[0].providerOptions?.anthropic).toEqual({ cacheControl: { type: "ephemeral" } });
});
