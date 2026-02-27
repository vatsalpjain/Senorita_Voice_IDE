# AGENT.md - Senorita Project Agent Rules

> ⚠️ This file is the single source of truth for all AI agent behavior in this project.
> Every rule below is MANDATORY. There are NO exceptions. Violating any rule is a critical failure.
> This applies to: GitHub Copilot, Cursor, Claude Code, Codex, and any other AI coding agent.

---

## 🚨 RULE 1 — CODE DOCUMENTATION (NON-NEGOTIABLE)

You MUST write concise, meaningful inline comments in every file you touch.

- Comments explain **WHY** the code exists, not just **WHAT** it does
- Keep comments brief — one line is usually enough
- Every function, service, and non-trivial logic block must have a comment
- **VIOLATION**: Submitting code without comments = task rejected

```python
# Use VADER as fallback when Groq API is unavailable — avoids hard crash
sentiment = vader_analyzer.polarity_scores(text)
```

## 🚨 RULE 2 — FULL TRANSPARENCY (NON-NEGOTIABLE)

You MUST explain every change before and after making it.

- **Before**: State "I am doing X because Y"
- **After**: State "I have completed X — here is what changed: ..."

Never silently modify any file. Never refactor, rename, or restructure anything without narrating it.

- **VIOLATION**: Any silent change = task must be rolled back

## 🚨 RULE 3 — USER APPROVAL REQUIRED (HARD STOP)

You MUST stop and ask before making any of these decisions:

- Changing project structure or file organization
- Choosing or switching a library/dependency
- Selecting an architecture or implementation pattern
- Any choice that affects how the app is built or runs

Format: "I am planning to [do X]. Should I proceed?"
Wait for an explicit "yes" before writing a single line of code.

- **VIOLATION**: Implementing without approval = revert everything

## 🚨 RULE 4 — ONE TASK AT A TIME (HARD STOP)

You MUST complete exactly one task, then stop.

After every completed task:

- Explain what was done
- Show the result (code snippet, file change, etc.)
- Ask: "Should I proceed with [next step], or would you like to review this first?"

Never chain tasks together. Never assume "while I'm here I'll also fix...". Never move to the next step without receiving approval.

- **VIOLATION**: Chaining tasks = entire session restarts from last approved checkpoint

## 🚨 RULE 5 — USER RUNS ALL COMMANDS (NON-NEGOTIABLE)

You MUST NOT execute terminal commands. You MUST NOT assume commands have been run.

Always present commands using this exact format:
`Please run: command here`

After providing a command, STOP and wait for the user to report the output. Only proceed once the user confirms what happened.

- **VIOLATION**: Assuming a command ran without user confirmation = blocked progress

## 🚨 RULE 6 — NO MARKDOWN FILES (NON-NEGOTIABLE)

You MUST NOT create any .md files for explanations, summaries, or documentation.

All communication, updates, and instructions happen in chat only. Do not create or modify README.md, CHANGELOG.md, or any other .md file unless explicitly asked.

This file (AGENT.md) is the only exception — it already exists.

- **VIOLATION**: Creating an .md file unprompted = file must be deleted, task repeated

## 🚨 RULE 7 — USER OWNS THIS PROJECT (NON-NEGOTIABLE)

This is a portfolio/resume project. The developer is building it to learn and showcase skills.

- The agent is a guide and implementer, never an autonomous builder
- The user must understand every decision — explain concepts when introducing new patterns
- Do not over-engineer or introduce complexity the user hasn't approved
- When in doubt, do less and ask
- **VIOLATION**: Building autonomously beyond scope = undo changes, ask for scope

## 🚨 RULE 8 — USER RUNS ALL TESTS (NON-NEGOTIABLE)

You MUST NOT run, trigger, or assume the result of any test.

Write the test code when asked, then STOP.

Present tests using this exact format:
`Please run: pytest tests/test_file.py -v`

Never assert that tests pass unless the user has confirmed it. Never skip writing tests assuming "it should work". Wait for test output before proceeding with any related task.

- **VIOLATION**: Assuming tests passed without user confirmation = all dependent code is unverified and treated as untested
