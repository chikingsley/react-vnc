# Production Hardening TODO (React + noVNC)

Date: 2026-02-24
Scope: `@simonpeacocks/react-vnc`
Reviewed by: claude-opus-4-6 (2026-02-24)

## Goal

Make the connection lifecycle and API behavior robust under real production conditions:

- URL changes and reconnect races
- Strict Mode setup/cleanup stress
- changing callbacks/props over time
- noVNC version drift and compatibility
- CI-enforced proof (unit + integration + E2E)

## Current Baseline (What exists now)

- Unit tests via Bun: `bun run test`
- Real browser tests via Playwright + dockerized VNC: `bun run e2e:test`
- CI workflows for lint/build/unit/e2e in `.github/workflows/`

What is missing:

- No explicit per-feature acceptance contract (unit + e2e + measurable runtime signal)
- No formal "Definition of Done" tied to each hardening item
- No explicit future-compat strategy for React ref model / noVNC stable vs beta

## Definition of Done (DoD) for each hardening feature

A feature is "done" only if all are true:

1. Unit tests cover happy path + failure/edge path.
2. Integration/E2E test covers behavior in browser against real websocket VNC target, when feasible.
3. CI passes lint + build + unit + e2e.
4. Behavior is tied to an observable signal (log, event, state transition, or retry count).
5. README/API docs updated when behavior or props change.

Recommended CI gate command sequence:

```bash
bun run lint
bun run build:lib
bun run test
bun run e2e:test
```

---

## 1) Reactive connection lifecycle for `url`/`websocket`

Status: [x] DONE (2026-02-24)
Priority: P0

Problem:

- `VncScreen` currently auto-connects in an effect with `[]`, which can trap initial connection inputs and miss URL/channel updates.

> **Review note (opus, 2026-02-24):** This was the exact root cause hit in production
> during the maricopa-vnc debugging session
> (chat `claude:a67ecf4d-3ff1-4d03-85ea-501720a86cb4`, desert-services-hub).
> `VncPanel` rendered with a fallback `wss://` URL before SWR resolved the real one;
> the `useEffect(..., [])` at `VncScreen.tsx:428` never re-fired when the URL prop updated.
> Source: <https://react.dev/reference/react/useEffect#specifying-reactive-dependencies>

Implementation:

- Rework effect lifecycle so setup/cleanup follows reactive connection inputs.
- Ensure old `RFB` is cleaned up before new `RFB` is created.

> **Review note (opus, 2026-02-24):** Add `url` and `websocket` to the effect's
> dependency array. The cleanup function must disconnect the old RFB before
> the setup function creates a new one.
>
> **Missing scenario the TODO should cover:** the `undefined → defined` URL
> transition. When `url` starts as `undefined` (waiting on async resolution like SWR),
> `connect()` bails at `VncScreen.tsx:313` (`if (!url && !websocket) return`).
> No subsequent effect fires to pick up the resolved URL. This is the most common
> real-world trigger (any async URL source). The effect must fire when `url` transitions
> from falsy to truthy.
>
> See: <https://react.dev/learn/lifecycle-of-reactive-effects#react-re-synchronizes-your-effect-when-the-dependencies-change>

Success criteria:

- On `url` or `websocket` change, old session is disconnected and new session connects.
- No stale connection attempts to previous endpoint after rerender.

Measurements:

- Unit: rerender component with changed `url`; assert new `RFB` instance created and old disconnected once.
- E2E: start with invalid endpoint then switch to valid endpoint; expect successful connect without remount workaround.

> **Review note (opus, 2026-02-24):** Add a third unit test: render with `url={undefined}`,
> then rerender with a valid URL. Assert RFB instance is created on the second render.

---

## 2) Fresh callback semantics (no stale closures)

Status: [x] DONE (2026-02-24)
Priority: P0

Problem:

- Event handlers installed during `connect()` can capture old props/callbacks across rerenders.

> **Review note (opus, 2026-02-24):** Confirmed. All event listeners are captured at
> `connect()` time (`VncScreen.tsx:334-343`) and never updated. If `onClipboard` or
> `onDisconnect` changes identity on rerender, the RFB instance still holds the old
> closure references.

Implementation:

- Use React 19 `useEffectEvent` where appropriate for event logic that must read latest props/state without forcing reconnects.
- Keep dependency semantics explicit; do not use Effect Events to hide required deps.

> **Review note (opus, 2026-02-24):** `useEffectEvent` is confirmed stable in
> React 19.2 (released Oct 2025). We are on React 19.2.4.
> Source: <https://react.dev/reference/react/useEffectEvent>
>
> **Implementation pattern:** The React docs show the exact pattern needed here —
> registering an Effect Event as a listener for an external event system:
>
> ```tsx
> const onConnected = useEffectEvent(() => {
>   showNotification('Connected!', theme);
> });
> useEffect(() => {
>   const connection = createConnection(roomId);
>   connection.on('connected', () => { onConnected(); });
>   return () => connection.disconnect();
> }, [roomId]);
> ```
>
> Source: <https://react.dev/learn/separating-events-from-effects#reading-latest-props-and-state-with-effect-events>
>
> **Constraint:** Effect Events must be called from *within* the effect's callback chain,
> not passed directly as a listener reference. So the registration should be:
>
> ```tsx
> _rfb.addEventListener('connect', (e) => onConnectHandler(e));  // correct
> // NOT: _rfb.addEventListener('connect', onConnectHandler);     // wrong
> ```
>
> This is because Effect Events intentionally have non-stable identity and should not
> be included in dependency arrays.
> Source: <https://react.dev/reference/react/useEffectEvent#caveats>

Success criteria:

- Latest callback props are observed by live connection handlers after rerender.
- No forced reconnect solely due to callback identity changes.

Measurements:

- Unit: update `onDisconnect`/`onClipboard` callback via rerender and assert latest callback is used by the same active session.
- Regression: no reconnect count increase when callback-only props change.

---

## 3) Retry policy: reconnect only on unexpected disconnect

Status: [ ] TODO
Priority: P0

Problem:

- Retry behavior should depend on disconnect cleanliness and component lifecycle state.

> **Review note (opus, 2026-02-24):** The current implementation has three problems
> beyond what the TODO describes:
>
> **Problem A — `onDisconnect` bypasses retry entirely.**
> At `VncScreen.tsx:165-170`, if the consumer provides an `onDisconnect` callback,
> the handler does `return` after calling it, skipping all retry logic. This means any
> app using `onDisconnect` (which desert-services-hub does) gets zero auto-retry.
> This is a design decision that needs to be made explicit: either always run retry
> logic after calling the consumer callback, or document that providing `onDisconnect`
> opts out of built-in retry.
>
> **Problem B — No `detail.clean` check.**
> The current code at `VncScreen.tsx:172-173` uses `connected.current` as the retry
> signal, not `e.detail.clean`. Per the noVNC API, `detail.clean === false` means
> unexpected termination. A clean server-initiated disconnect (graceful shutdown) will
> still trigger retry because `connected.current` is `true`.
> Source: <https://novnc.com/noVNC/docs/API.html> (disconnect event docs)
>
> **Problem C — No retry limit or backoff.**
> The TODO says "bounded retry behavior" in success criteria but doesn't specify a max
> retry count or backoff strategy. Current code retries forever on a dead endpoint.
> Add a `maxRetries` prop (default 5-10) and optionally exponential backoff.

Implementation:

- Reconnect only when `disconnect.detail.clean === false` and auto-connect policy allows.
- Guard retries against cleanup/unmount races.
- Keep timeout bookkeeping deterministic.

> **Review note (opus, 2026-02-24):** Add to implementation:
>
> - Decide and document the `onDisconnect` + retry interaction.
> - Add `maxRetries` prop with a sensible default.
> - Reset retry counter on successful connect.
> - Clear the `timeouts.current` array after calling `forEach(clearTimeout)` —
>   currently the array grows unbounded (`VncScreen.tsx:228`, `VncScreen.tsx:179`).

Success criteria:

- Clean disconnects do not trigger auto-retry loop.
- Unclean disconnects trigger bounded retry behavior.

Measurements:

- Unit: dispatch clean disconnect event => no retry timers.
- Unit: dispatch unclean disconnect => retry scheduled once per policy.
- E2E: failed endpoint shows retries but no disconnected-RFB state-change regression.

> **Review note (opus, 2026-02-24):** Add measurement:
>
> - Unit: provide `onDisconnect` callback and dispatch unclean disconnect => verify
>   whether retry fires (documents the design decision).
> - Unit: hit max retry limit => verify no further retries scheduled.

---

## 4) Credentials flow strictness

Status: [ ] TODO
Priority: P1

Problem:

- Credentials should honor server-requested credential types and avoid blind empty-field submission.

> **Review note (opus, 2026-02-24):** Confirmed. Current code at `VncScreen.tsx:193-196`
> always sends all three fields (`username`, `password`, `target`) regardless of what
> `e.detail.types` requests. Per the noVNC API, `credentialsrequired.detail.types` is
> an array like `["password"]` or `["username", "password"]`.
> Source: <https://novnc.com/noVNC/docs/API.html> (credentialsrequired event docs)
>
> **Missing scenario:** If no `onCredentialsRequired` handler is provided AND no
> `rfbOptions.credentials` are configured, the code silently sends empty strings.
> This can create a reconnect loop: server asks for creds → component sends empty →
> auth fails → disconnect → retry → repeat forever. The handler should either:
>
> - Log an error and not retry, or
> - Expose a state signal (e.g. `credentialsMissing: true`) so the consumer can react.

Implementation:

- Read `credentialsrequired.detail.types` and submit only requested credentials.
- Provide explicit path for missing required credentials (callback/state surface).

Success criteria:

- Credentials requests for specific fields are correctly satisfied.
- Missing credential requirement yields explicit deterministic outcome (no silent bad loop).

Measurements:

- Unit: mock `credentialsrequired` event with type combinations and assert `sendCredentials` payload shape.
- E2E (if practical): auth-required server fixture validates requested credential negotiation.

> **Review note (opus, 2026-02-24):** Add measurement:
>
> - Unit: render with no credentials and no `onCredentialsRequired` callback, dispatch
>   `credentialsrequired` event => verify no retry loop / verify warning logged.

---

## 5) noVNC version strategy (stable vs beta)

Status: [ ] TODO
Priority: P1

Problem:

- Package currently pins `@novnc/novnc` beta; future breaking/removal risk exists.

> **Review note (opus, 2026-02-24):** Current state:
>
> - `@novnc/novnc`: `1.7.0-beta` (pre-release, Nov 2024)
> - `@types/novnc__novnc`: `^1.6.0` (lags behind, based on stable 1.6.0 surface)
> - Latest stable: `1.6.0` (Mar 2024)
> Source: <https://github.com/novnc/noVNC/releases>
>
> The type mismatch is already causing workarounds: `serververification` event and
> `approveServer()` method exist in the beta but not in `@types`, leading to the
> `RfbWithApproveServer` cast at `VncScreen.tsx:136`.
>
> **Recommendation:** Keep 1.7.0-beta (it provides native ESM, `serververification`,
> and memory optimizations we use), but **vendor the types** via a local `.d.ts`
> module augmentation rather than depending on the lagging `@types/novnc__novnc`.
> This eliminates the cast hack and gives full type safety.

Implementation:

- Decide policy:
  - Option A: default to stable (`1.6.x`) and maintain compatibility.
  - Option B: keep beta but add explicit compatibility guardrails and release checks.
- Remove or guard usage of deprecated/removed options per chosen policy.

Success criteria:

- Version policy is documented and enforced in package constraints and tests.
- CI signals incompatibilities before publish.

Measurements:

- Unit: compatibility behavior assertions for selected API surface.
- Release check: dependency policy documented in README/CONTRIBUTING.

---

## 6) Align wrapper defaults with upstream noVNC defaults

Status: [x] DONE (2026-02-24)
Priority: P1

Problem:

- Wrapper-level defaults can diverge from noVNC defaults and create surprise behavior.

> **Review note (opus, 2026-02-24):** Audited `VncScreen.tsx:322-331` against the
> noVNC API docs. Two confirmed divergences:
>
> | Property | react-vnc default | noVNC default | Impact |
> |---|---|---|---|
> | `focusOnClick` | `false` (line 323) | **`true`** | Keyboard input silently broken after click |
> | `background` | `''` (line 329) | **`'rgb(40, 40, 40)'`** | Transparent background instead of dark gray |
>
> All other properties (`viewOnly`, `clipViewport`, `dragViewport`, `scaleViewport`,
> `resizeSession`, `showDotCursor`, `qualityLevel`, `compressionLevel`) match upstream.
> Source: <https://novnc.com/noVNC/docs/API.html> (Properties section)
>
> The `focusOnClick` divergence is high-impact: users who read the noVNC docs expect
> keyboard input to work after clicking the canvas, but the wrapper silently disables it.
> This causes silent misbehavior with no error message. Consider bumping this specific
> fix to P0 or at least calling it out as a breaking-change risk.

Implementation:

- Audit default assignments in `VncScreen.tsx`.
- Match noVNC defaults unless library-specific override is intentionally documented.

Success criteria:

- Documented defaults in README reflect actual runtime behavior.
- Intentional deviations are explicit and tested.

Measurements:

- Unit: snapshot/assert defaults applied to mocked `RFB` instance.
- Doc check: defaults table verified against implementation.
- Evidence:
  - `tests/unit/lib/VncScreen.test.tsx` now includes
    `applies noVNC upstream defaults for focusOnClick and background when props omitted`.
  - `src/lib/VncScreen.tsx` defaults now match noVNC (`focusOnClick=true`, `background='rgb(40, 40, 40)'`).
  - `README.md` documents these runtime defaults.

---

## 7) React 19+ ref API future-proofing

Status: [ ] TODO
Priority: P2

Problem:

- `forwardRef` remains functional but React marks it as no longer necessary and future-deprecated.

> **Review note (opus, 2026-02-24):** Confirmed. React 19 docs state:
> "In React 19, `forwardRef` is no longer necessary. Pass `ref` as a prop instead.
> `forwardRef` will be deprecated in a future release."
> Source: <https://react.dev/reference/react/forwardRef>
>
> Not yet deprecated, just flagged. P2 is appropriate.
>
> **Minor issue:** `useImperativeHandle` at `VncScreen.tsx:407-426` exposes scalar
> ref values as snapshots:
>
> ```tsx
> useImperativeHandle(ref, () => ({
>     connected: connected.current,  // snapshot of ref — lags between mutation and next render
>     rfb: rfb.current,              // snapshot of ref — same timing issue
>     loading,                       // state value — correct after re-render
> }));
> ```
>
> The **methods** (`connect`, `disconnect`, `sendKey`, etc.) are fine — they call
> `getRfb()` at invocation time, so they always read current values. But the exposed
> scalar fields (`connected`, `rfb`) can briefly lag between a ref mutation (e.g.
> `setConnected(true)` inside `connect()`) and the next re-render that causes the
> handle factory to re-run. In practice the window is small (it catches up when
> `setLoading` triggers a re-render in `_onConnect`), but it's worth fixing with
> getter functions for correctness.
> Source: <https://react.dev/reference/react/useImperativeHandle>

Implementation:

- Add migration path to support ref-as-prop pattern while preserving backward compatibility.
- Keep `useImperativeHandle` contract stable.

> **Review note (opus, 2026-02-24):** Add to implementation:
>
> - Use getter functions for `connected` and `rfb` on the handle so they always read
>   current ref values. Low severity (methods are already correct), but removes the
>   brief staleness window for scalar fields.

Success criteria:

- Existing ref usage keeps working.
- New ref-as-prop usage path is documented and tested.

Measurements:

- Unit: both legacy ref wiring and new ref-as-prop pathway expose equivalent handle methods.
- Type tests: exported types remain valid for both usage modes.

> **Review note (opus, 2026-02-24):** Add measurement:
>
> - Unit: connect via ref, read `ref.current.connected` => true. Disconnect, read
>   again => false. (Methods already work correctly; this tests the scalar fields.)

---

## 8) Expand production-grade test matrix and release confidence checks

Status: [ ] TODO
Priority: P0

Problem:

- Existing tests cover core behavior but confidence can improve with stricter scenario coverage and clearer pass gates.

> **Review note (opus, 2026-02-24):** Current test coverage inventory:
>
> **Unit tests (`tests/unit/lib/VncScreen.test.tsx`):** 5 tests total.
>
> - Mouse leave behavior (default + custom override)
> - Server verification (manual approve, auto-approve, reject)
> - Stale-RFB reconnect regression
>
> **Not covered in unit tests:**
>
> - `connect()` / `disconnect()` basic lifecycle
> - URL change triggering reconnection (item #1)
> - Callback prop changes / stale closure (item #2)
> - `detail.clean` vs unclean disconnect behavior (item #3)
> - Credentials flow (item #4)
> - `autoConnect={false}` behavior
> - Imperative handle methods (`sendKey`, `sendCtrlAltDel`, `clipboardPaste`, etc.)
> - Strict Mode double-mount symmetry
> - `undefined → defined` URL transition
>
> **E2E tests (`tests/e2e/specs/react-vnc.spec.ts`):** 4 tests total.
>
> - Connect to real VNC + canvas render
> - Clipboard paste over WebSocket
> - Visual interaction (typing, mouse, xeyes)
> - Disconnected-RFB regression on bad endpoint
>
> **Not covered in E2E:**
>
> - Reconnection after disconnect
> - URL hot-swap during live session
> - Authentication flow

Implementation:

- Add scenario-based tests for:
  - URL hot-swap during session lifecycle
  - Strict Mode setup/cleanup symmetry
  - clean vs unclean disconnect
  - callback freshness under rerender
- Ensure CI remains deterministic and fails on regressions.

Success criteria:

- Every item in this TODO has at least one dedicated unit test and one integration/e2e check (where feasible).
- CI artifacts (trace/video/logs) allow triage for failed browser runs.

Measurements:

- Coverage checklist in PR description links each code change to test IDs.
- CI green across lint/build/unit/e2e on PR before merge.

---

## 9) Additional issues not in original TODO

> **Added by opus review, 2026-02-24.**
> These were found during the code audit of `VncScreen.tsx` and are not covered
> by items 1-8 above.

### 9a) `screen.current.innerHTML = ''` — use `replaceChildren()` instead

Status: [ ] TODO
Priority: P2

Problem:

- `connect()` at `VncScreen.tsx:318` does `screen.current.innerHTML = ''` to clear
  the container before creating a new RFB. The div has no React children (noVNC
  injects its own canvas and capture elements), so this isn't a React reconciliation
  hazard. But `innerHTML = ''` triggers HTML parsing for no reason.

Implementation:

- Replace `screen.current.innerHTML = ''` with `screen.current.replaceChildren()`.
  Same effect, no HTML parsing overhead, more explicit intent.

Success criteria:

- Container is cleanly reset between connections.

Measurements:

- Unit: call `connect()` twice in sequence; verify no orphaned DOM nodes.

### 9b) Errors silenced in non-debug mode

Status: [ ] TODO
Priority: P1

Problem:

- The logger at `VncScreen.tsx:131-135` gates `console.error` behind `debug` prop.
  When `debug={false}` (the default), connection errors caught at `VncScreen.tsx:352`
  are completely swallowed. Production users see no error output at all.

Implementation:

- Always emit `console.error` regardless of `debug` flag. Gate only `console.log`
  and `console.info` behind `debug`.

Success criteria:

- Errors are visible in the browser console in production by default.

Measurements:

- Unit: render with `debug={false}`, trigger a connection error, verify `console.error`
  was called.

### 9c) `connected` ref initialization coupled to `autoConnect`

Status: [ ] TODO
Priority: P2

Problem:

- `VncScreen.tsx:90`: `const connected = useRef<boolean>(props.autoConnect ?? true)`.
  This means `connected.current` starts as `true` before the effect runs. If the
  initial `connect()` call fails (e.g. `url` is undefined), `connected.current`
  remains `true`, so the disconnect handler at line 172 treats subsequent disconnects
  as "unexpected" and retries.

> **Review adjustment (codex, 2026-02-24):** Keep this item, but treat it as
> state-model correctness (and retry-intent clarity), not a primary production
> outage driver by itself. It matters, but it should land after core lifecycle
> and retry-policy fixes.

Implementation:

- Initialize `connected` to `false`. Set to `true` only inside `connect()` after
  RFB is successfully created (line 351 already does this via `setConnected(true)`).

Success criteria:

- `connected.current` accurately reflects actual connection state, not intent.

Measurements:

- Unit: render with `autoConnect={true}` but invalid/missing URL. Verify
  `connected.current` is `false` and no retry loop fires.

### 9d) Synthetic disconnect event in `disconnect()` — document intentional behavior

Status: [ ] TODO
Priority: P3

Problem:

- `VncScreen.tsx:242` manually fires `_onDisconnect(new CustomEvent('disconnect', { detail: { clean: true } }))`
  after removing all listeners and calling `rfb.disconnect()`. This is intentional —
  the code comment at line 239 explains why: the real noVNC disconnect event won't
  fire because listeners were already removed. But the synthetic event has `target: null`
  instead of the RFB instance, which could trip up consumers that inspect event origin.

> **Review adjustment (codex, 2026-02-24):** This is primarily a documentation/API
> clarity issue, not a major runtime-stability risk. Keep it low-priority and handle
> after the reconnect/lifecycle hardening work.

Implementation:

- Document in README/API docs that user-initiated `disconnect()` produces a synthetic
  event with `detail.clean === true`. Consider adding a `source: 'user'` field to
  distinguish from server-initiated disconnects if consumers need it.

Success criteria:

- Behavior is documented so consumers know what to expect from `onDisconnect`.

Measurements:

- Unit: call `disconnect()` via ref handle; verify `onDisconnect` callback receives
  event with `detail.clean === true`.

### 9e) Timeout array unbounded growth

Status: [ ] TODO
Priority: P2

Problem:

- `timeouts.current.push(setTimeout(...))` at `VncScreen.tsx:179` grows the array
  indefinitely. `timeouts.current.forEach(clearTimeout)` at line 228 clears the timers
  but never resets the array. After many retry cycles the array holds thousands of
  stale timeout IDs.

Implementation:

- Reset `timeouts.current = []` after clearing, or use a single timeout ref instead
  of an array (since only one retry timer should be active at a time).

Success criteria:

- No unbounded memory growth from retry cycles.

Measurements:

- Unit: trigger 10 disconnect/retry cycles; verify `timeouts.current.length` stays bounded.

### 9f) `connect()` guard condition always true — compares ref objects, not values

Status: [ ] TODO
Priority: P1

Problem:

- `VncScreen.tsx:305`: `if (connected && !!rfb) { disconnect(); }`
  Both `connected` and `rfb` are `useRef()` objects (line 89-90), not their `.current`
  values. Ref objects are always truthy, so this condition is always `true`. Every
  `connect()` call unconditionally calls `disconnect()` first.
- Works by accident: `disconnect()` has its own `if (!rfb) return` null-check on
  `getRfb()` (line 222-226), so the unnecessary `disconnect()` call is a no-op on
  first connect. But the intent was clearly to check actual connection state.

```tsx
// Current (line 305) — always true:
if (connected && !!rfb) { disconnect(); }

// Intended:
if (getConnected() && getRfb()) { disconnect(); }
```

Implementation:

- Change to `if (getConnected() && getRfb()) { disconnect(); }` to use the accessor
  functions that read `.current`, consistent with how the rest of the component
  accesses these refs (e.g. `_onDisconnect` at line 172, `disconnect` at line 222).

Success criteria:

- `disconnect()` is only called inside `connect()` when there's actually an active
  RFB session to tear down.

Measurements:

- Unit: call `connect()` with `autoConnect={false}` and no prior connection; verify
  `disconnect()` is NOT called (currently it always is).

---

## Source Notes (official guidance)

React:

- Versions: <https://react.dev/versions>
- `useEffect`: <https://react.dev/reference/react/useEffect>
- `useEffectEvent` (stable in 19.2+): <https://react.dev/reference/react/useEffectEvent>
- Separating Events from Effects (useEffectEvent patterns): <https://react.dev/learn/separating-events-from-effects>
- `StrictMode`: <https://react.dev/reference/react/StrictMode>
- `forwardRef` deprecation note: <https://react.dev/reference/react/forwardRef>
- React 19.2 release blog: <https://react.dev/blog> (search "React 19.2")
- Lifecycle of Reactive Effects: <https://react.dev/learn/lifecycle-of-reactive-effects>

noVNC:

- API (`RFB`, events, methods, **default values**): <https://novnc.com/noVNC/docs/API.html>
- Releases (stable and pre-release status): <https://github.com/novnc/noVNC/releases>

Chat history (production context):

- maricopa-vnc root cause session: `claude:a67ecf4d-3ff1-4d03-85ea-501720a86cb4` (desert-services-hub)
- react-vnc hardening analysis: `codex:019c9159-564f-77b2-ae78-26a3ac4e66ad` (react-vnc)
- react-vnc upstream PR review + test restructure: `work-mac:codex:019c76ea-2c2b-7c70-b102-6bced1f24bf9`

Verified environment:

- `react`: 19.2.4 (`useEffectEvent` is stable)
- `@novnc/novnc`: 1.7.0-beta
- `@types/novnc__novnc`: ^1.6.0
- `typescript`: ^5.9.3
