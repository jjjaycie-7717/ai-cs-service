# Fence Alert Retrieval Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make fence alert setup and related alarm queries retrieve the intended FAQ instead of falling back to generic product answers.

**Architecture:** Add narrowly targeted intent patterns and query hints in `server.js` so high-frequency fence alert setup, no-alarm, delay, and alarm-without-penalty phrasings map to the correct FAQ priority set. Protect the change with a focused flow test that reproduces the current miss and verifies the corrected answer path.

**Tech Stack:** Node.js, Express, local flow test harness, Qdrant-backed retrieval

---

### Task 1: Add regression coverage

**Files:**
- Modify: `scripts/test_flows.js`

**Step 1: Write the failing test**
- Add a chat flow assertion for `怎么开启电子围栏告警？`
- Expect the reply to include setup guidance such as `开机`, `连接APP`, `启用围栏`

**Step 2: Run test to verify it fails**
- Run: `npm run test:flows`
- Expected: the new assertion fails because current routing does not prioritize the setup FAQ

### Task 2: Tighten fence alert intent routing

**Files:**
- Modify: `server.js`

**Step 1: Write minimal implementation**
- Add a new intent profile for fence alert setup wording like `开启/设置/启用 + 围栏 + 告警/报警/提醒`
- Add focused query hints that point to `F860-028`
- Broaden nearby fence alarm profiles only where needed for the chosen query family

**Step 2: Run tests to verify it passes**
- Run: `npm run test:flows`
- Expected: new fence alert setup assertion passes and existing flow cases remain green

### Task 3: Verify with live retrieval

**Files:**
- No file changes

**Step 1: Run live endpoint checks**
- Run the local server and call `/api/retrieve` and `/api/chat` with the repaired query family
- Confirm the setup question no longer falls back
