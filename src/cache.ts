import type { ModelMessage } from "ai";

export function addCacheControl(messages: ModelMessage[]): ModelMessage[] {
  const lastStableIndex = messages.length - 3;

  return messages.map((message, index) => {
    if (index !== 0 && index !== lastStableIndex) return message;

    return {
      ...message,
      providerOptions: {
        ...message.providerOptions,
        anthropic: {
          ...message.providerOptions?.anthropic,
          cacheControl: { type: "ephemeral" },
        },
      },
    };
  });
}
