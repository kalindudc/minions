---
name: bench
description: Run performance benchmarks and profile analysis for pi-minions. Use when asked to analyze performance, find bottlenecks, profile the extension, or optimize code.
---

# Performance Benchmarking

Run benchmarks and write analysis to tmp/profiles/analysis.md.

## When to Use

ALWAYS use when asked about:
- Performance analysis
- Bottleneck detection
- Code profiling
- Speed optimization

Do NOT use for unit tests or functional bugs.

## Steps

1. Run benchmarks:
   ```bash
   npm run test:bench
   ```

2. Generate report:
   ```bash
   npm run profile
   ```

3. Write analysis to tmp/profiles/analysis.md.

## Analysis Template

```markdown
# Performance Analysis: YYYY-MM-DD

## Summary
- Profiles: X CPU, X heap
- Critical: X, Warning: X

## Benchmarks

AgentTree:
- add 1000 nodes: X ops/sec (Y ms) - STATUS
- getTotalUsage: X ops/sec (Y ms) - STATUS

Logger:
- 1000 messages: X ops/sec (Y ms) - STATUS
- Sync I/O: appendFileSync at extensions/pi/logger.ts:23

Spinner:
- 80ms interval: ~62/sec - STATUS
- Location: extensions/pi/tools/spawn.ts:196

## Profile
- Script time: X ms, GC: X ms (X%), Idle: X ms (X%)
- Top hotspot: function (X ms, Y%)

## Issues

Critical:
1. description at file:line - fix

Warning:
1. description at file:line - fix

## Recommendations

| Priority | Issue | Location | Action |
|----------|-------|----------|--------|
| P0 | desc | file:line | action |
| P1 | desc | file:line | action |
```

## Status Labels

- GOOD: GC under 5%, idle over 30%
- WARNING: GC 5-10%, O(n), sync I/O
- CRITICAL: unbounded growth, over 100ms blocking

## Key Locations

- Sync I/O: extensions/pi/logger.ts:23
- Spinner interval: extensions/pi/tools/spawn.ts:196
- O(n) aggregation: extensions/pi/tree.ts:111

## Rules

ALWAYS:
- Include specific ops/sec numbers
- List file:line for each issue

NEVER:
- Output analysis in conversation
- Use subjective terms without numbers
