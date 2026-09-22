---
description: Example authentication guidance; load when asked about auth or OAuth in this project
---
# Auth Patterns (example)

This is a sample skill for testing on-demand skill loading. It does not mean this repository already has authentication, NextAuth, or OAuth configured.

Before adding authentication, inspect the actual application and dependencies. Identify the framework, existing session strategy, protected routes, and test conventions. If none exist, report that clearly and ask for the provider and session requirements before implementing.

For an OAuth implementation, plan the callback flow, state and CSRF protection, session persistence, secret handling, route protection, and end-to-end verification. Never invent existing file paths or claim that a provider is configured without checking.
