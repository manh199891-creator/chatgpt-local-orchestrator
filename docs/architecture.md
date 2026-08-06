# Architecture Overview

This document outlines the target architecture for **ChatGPT Local Orchestrator**, a system designed to coordinate high-capability AI coding agents operating on a local environment directly from browser-based ChatGPT interactions.

## Target Architecture Flow

```
ChatGPT Web
     │
     ▼
Browser Extension
     │
     ▼
Local Bridge
     │
     ▼
Local Orchestrator
     │
     ▼
Codex / Antigravity
     │
     ▼
Review Package
     │
     ▼
ChatGPT Web Review
```

## Component Responsibilities

### 1. ChatGPT Web
- User interface for composing prompts, reviewing architectural specifications, and receiving structured progress updates.

### 2. Browser Extension (Manifest V3)
- Side panel UI embedded within Chrome/Edge.
- Captures context, manages project selection, and passes user approval signals to the Local Bridge.

### 3. Local Bridge (`apps/bridge`)
- Fastify HTTP server running strictly on `127.0.0.1:43120`.
- Acts as the local security gateway and IPC interface between the browser extension and the local orchestrator daemon.

### 4. Local Orchestrator
- Coordinates execution pipelines, manages isolated Git worktrees for sub-tasks, and tracks execution status across agent runs.

### 5. Codex / Antigravity Autonomous Agents
- Specialized local CLI coding subagents executing code modifications, test suites, and system verification tasks in isolated worktrees.

### 6. Review Package
- Generates structured execution reports, diff summaries, test results, and status artifacts after agent execution finishes.

### 7. ChatGPT Web Review
- Feedback loop where generated review packages are analyzed in ChatGPT Web to determine phase approval, iterations, or shipping readiness.
