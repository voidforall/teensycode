# TeensyCode

My build-along project for Vercel Academy's [Build Your Own AI Coding Agent Harness](https://vercel.com/academy/build-ai-agent-harness) course.

The course incrementally builds a TypeScript coding-agent harness with tools, safety gates, sandbox backends, context management, subagents, human approval, and multiple interfaces.

## Requirements

- [Bun](https://bun.sh/) 1.x
- A [Vercel AI Gateway](https://vercel.com/ai-gateway) API key

## Setup

```bash
bun install
cp .env.example .env
# Add your AI_GATEWAY_API_KEY to .env
```

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

