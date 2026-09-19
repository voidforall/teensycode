# TeensyCode

My build-along project for Vercel Academy's [Build Your Own AI Coding Agent Harness](https://vercel.com/academy/build-ai-agent-harness) course.

The course incrementally builds a TypeScript coding-agent harness with tools, safety gates, sandbox backends, context management, subagents, human approval, and multiple interfaces.

## Requirements

- [Bun](https://bun.sh/) 1.x
- A [DeepSeek API key](https://platform.deepseek.com/api_keys) with available balance

## Setup

```bash
bun install
cp -n .env.example .env # keep an existing .env
# Add DEEPSEEK_API_KEY=<your key> to .env (never commit this file)
```

If you already have a `.env` from AI Gateway, add the `DEEPSEEK_API_KEY` line to it instead of overwriting the file. The agent now connects directly to DeepSeek; `AI_GATEWAY_API_KEY` is no longer used.

Run the current agent against this repository:

```bash
bun run start . "Read the package.json"
```

Check the TypeScript types:

```bash
bun run typecheck
```

## Course progress

- [ ] 1. The Agent Loop
- [ ] 2. Tool Design
- [ ] 3. The System Prompt
- [ ] 4. The Sandbox Abstraction
- [ ] 5. Context Management
- [ ] 6. Subagent Delegation
- [ ] 7. Sandbox Lifecycle
- [ ] 8. Human-in-the-Loop
- [ ] 9. Planning and Verification
- [ ] 10. Surfaces
- [ ] 11. Extensibility
- [ ] Capstone

## Notes

The repository starts at the course's initial chatbot stage. Each lesson should be committed separately so the implementation history mirrors the course progression.
