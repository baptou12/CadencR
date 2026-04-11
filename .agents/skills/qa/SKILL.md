---
name: qa
description: >
  QA test a running feature in the Cadence app using browser automation. Use this skill whenever the user asks
  to "test", "QA", "smoke test", "check if it works", "verify the feature", "try it in the browser", or
  wants to validate that something they just built actually works in the real app. Also trigger when the user
  says "run QA", "does it look right", or "let me see it working". If a feature was just implemented and the
  user wants confirmation it works end-to-end, this is the skill to use.
---

# QA Testing

Test Cadence features by running the app in a browser and verifying behavior interactively.

The argument describes the feature to test. If empty, infer the feature from the current session context such as recent file changes, the active branch, or the conversation history.

## Step 1: Ensure Dev Servers Are Running

The Cadence stack has two servers:
- Frontend (Vite): `http://localhost:1420`
- Backend (Rust service): `http://localhost:5005/api/health`

Check if they're already up and healthy:

```bash
curl -sf --max-time 2 http://localhost:5005/api/health && echo "API: ok" || echo "API: down"
curl -sf --max-time 2 http://localhost:1420 && echo "Frontend: ok" || echo "Frontend: down"
```

If either is down, kill stale processes and restart the full stack:

```bash
lsof -ti:1420 -ti:5005 | xargs kill -9 2>/dev/null || true
cd /workspace/cadence && pnpm dev &
```

Then poll until both servers respond, timing out after 60 seconds:

```bash
for i in $(seq 1 60); do
  api=$(curl -sf --max-time 1 http://localhost:5005/api/health && echo "ok" || echo "")
  fe=$(curl -sf --max-time 1 http://localhost:1420 > /dev/null 2>&1 && echo "ok" || echo "")
  [ "$api" = "ok" ] && [ "$fe" = "ok" ] && echo "Both servers ready" && break
  sleep 1
done
```

If servers do not come up within 60 seconds, report the failure and stop.

## Step 2: Plan Test Procedures

Before touching the browser:

1. Identify 3-5 concrete test cases covering the happy path and key edge cases.
2. For each test case, note the steps and expected outcome.
3. Briefly tell the user what will be tested.

## Step 3: Open the App

Open `http://localhost:1420` with the browser automation available in the current agent environment, wait for load completion, and keep the session open for the rest of the checks.

Cadence uses hash routing, so URLs look like `http://localhost:1420/#/projects/1/features`.

## Step 4: Execute Test Cases

For each test case:

1. Navigate to the right part of the app.
2. Interact with the UI.
3. Verify the result against expectations.
4. Record pass or fail plus any unexpected behavior.

Take screenshots of interesting states, especially failures, and check browser console or runtime errors before finishing.

For React controlled inputs, ensure interactions trigger real input events rather than only mutating DOM values.

## Step 5: Report Results

Produce a concise report:

```text
## QA Report: [Feature Name]

Result: X/Y passed

Failed
- [Test case]: Expected [X], got [Y]. Screenshot: /tmp/qa-failure-1.png

Passed
- [Test case]

Console Errors
- None
```

Focus on failures. Do not shut down the dev servers when done.
