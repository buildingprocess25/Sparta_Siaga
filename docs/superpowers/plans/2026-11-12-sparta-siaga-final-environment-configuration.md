# SPARTA SIAGA — Final Environment Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the final, secure 3-environment configuration (Development, UAT, and Production) for SPARTA SIAGA, maintaining the existing Production SPARTA SSO integration while empowering Development and UAT with the 9-role simulator, gated Dev Tunnel access, and strict production session isolation.

**Architecture:** 
- In **Development**, loopback (`localhost`/`127.0.0.1`) accesses the 9-role Quick Login directly; mobile access via Dev Tunnel is unlocked only after server-side gate passcode verification (`?gate=...` or `/api/auth/gate-verify`).
- In **UAT**, the same 9-role Quick Login & Role Simulator is used for operational and RBAC testing, restricted to authorized evaluators via gate passcode, with zero redirection to SPARTA SSO.
- In **Production**, SPARTA SSO existing integration is strictly enforced; Quick Login and Role Simulator are disabled fail-closed; Development/UAT sessions are rejected by session isolation; no changes are made to the external SPARTA SSO portal.

**Tech Stack:** Next.js 16.1.7 (App Router), TypeScript 5.7, Jose (JWT), Postgres (pg), Tailwind CSS, Node.js crypto.

## Global Constraints
- Do NOT modify or build custom staging/UAT environments for the external SPARTA SSO Portal.
- Production MUST use the existing SPARTA SSO Portal (`https://sparta-alfamart.web.id` / `https://login.sparta.co.id`).
- Quick Login & Role Simulator MUST be strictly disabled in Production (fail-closed HTTP 403).
- No unauthenticated bypasses over public tunnels; tunnel/UAT access requires verified gate credentials.
- Development and UAT sessions must NEVER be accepted in Production (JWT environment claim isolation).
- No secrets stored in source code.
- No automatic git push or remote deployments.
- Existing database tables and business logic must remain intact.

---

### Task 1: Audit Current Configuration & Document Environment Matrix

**Files:**
- Create: `docs/05-production/FINAL_ENVIRONMENT_ARCHITECTURE.md`
- Test: Verify documentation accuracy

**Interfaces:**
- Input: Current codebase state in `lib/environment-policy.ts`, `app/login/page.tsx`, `scripts/run-dev.ts`, `.env.local`
- Output: Formal environment specification document

- [ ] **Step 1: Write `docs/05-production/FINAL_ENVIRONMENT_ARCHITECTURE.md`**
  Detail the 3-tier architecture, gate passcode verification mechanism, session isolation rules, and SSO production compatibility contract.

---

### Task 2: Gate Passcode Verification Engine & Environment Policy Updates

**Files:**
- Modify: `lib/environment-policy.ts`
- Create: `app/api/auth/gate-verify/route.ts`
- Modify: `app/api/auth/env-status/route.ts`
- Modify: `app/api/auth/quick-login/route.ts`
- Modify: `app/api/auth/logout/route.ts`

**Interfaces:**
- `isGatePasscodeVerified(req: Request): boolean` -> checks query parameter `gate`, header `x-gate-passcode`, or cookie `siaga_gate_token` against `UAT_GATE_PASSCODE` / `DEV_GATE_PASSCODE`.
- `isQuickLoginPermitted(req?: Request): { allowed: boolean; reason?: string; requiresGate?: boolean }` -> enforces Development/UAT rules with gate verification and fail-closed Production blocking.
- `POST /api/auth/gate-verify` -> accepts `{ passcode: string }`, verifies against configured gate passcode, sets secure cookie `siaga_gate_token`.
- `getLogoutRedirectUrl()` -> returns `"/login"` for Development and UAT, `getSsoModuleLauncherUrl()` for Production.

- [ ] **Step 1: Implement `isGatePasscodeVerified` and update `isQuickLoginPermitted` in `lib/environment-policy.ts`**
  - Allow `development` and `uat` environments.
  - On `localhost`/`127.0.0.1` in `development`: auto-allow.
  - On Dev Tunnel (or any non-loopback) in `development`: require verified gate passcode.
  - In `uat`: require verified gate passcode.
  - In `production`: strictly reject (`allowed: false`).
- [ ] **Step 2: Create `app/api/auth/gate-verify/route.ts`**
  - Verify passcode, set HttpOnly cookie `siaga_gate_token` (Path: `/`, SameSite: `Lax`).
- [ ] **Step 3: Update `app/api/auth/env-status/route.ts`**
  - Expose `requiresGate`, `isGateVerified`, and accurate `isQuickLoginAllowed` based on current request.
- [ ] **Step 4: Update `app/api/auth/quick-login/route.ts` and `app/api/auth/logout/route.ts`**
  - Quick Login consumes updated policy.
  - Logout clears `siaga_gate_token` on logout in dev/uat.

---

### Task 3: Session Isolation Between Environments

**Files:**
- Modify: `lib/jwt.ts`
- Modify: `proxy.ts`

**Interfaces:**
- `signSession(payload, expiresIn)` -> embeds `env: getSpartaEnvironment()` in JWT claims.
- `verifySession(token)` -> in Production (`isProductionEnvironment()`), strictly rejects tokens where `payload.env !== "production"`.
- `proxy(request)` -> enforces that non-production sessions are not permitted in Production runtime.

- [ ] **Step 1: Update `lib/jwt.ts`**
  - Add `env` to `SessionPayload`.
  - In `signSession`, inject current `getSpartaEnvironment()`.
  - In `verifySession`, enforce fail-closed check: if current environment is production, reject non-production tokens.
- [ ] **Step 2: Update `proxy.ts`**
  - Register `/api/auth/gate-verify` in `publicPrefixes`.
  - Support `.devtunnels.ms` in trusted origins for callback.
  - Enforce session isolation check on proxy pass-through.

---

### Task 4: UI Login Page Refinement for Development, UAT Gate, & Production SSO

**Files:**
- Modify: `app/login/page.tsx`

**Interfaces:**
- In `development` / `uat` (with gate verified or loopback): renders 9-role simulator.
- In `development` (via Dev Tunnel) / `uat` (without gate verified): renders Gate Passcode input dialog with clear instructions.
- In `production`: renders official SSO portal redirection / re-entry card, never rendering Quick Login or Role Simulator.

- [ ] **Step 1: Add Gate Passcode state and auto-verification from URL `?gate=...` in `app/login/page.tsx`**
- [ ] **Step 2: Render Gate Passcode verification UI when `requiresGate` is true and not yet verified**
- [ ] **Step 3: Ensure Production mode only displays official SSO Portal re-entry button and redirects to `ssoPortalUrl`**

---

### Task 5: Scripts & Environment Configuration Updates

**Files:**
- Modify: `scripts/run-dev.ts`
- Modify: `.env.local`
- Modify: `.env.example`
- Modify: `next.config.mjs`

- [ ] **Step 1: Update `scripts/run-dev.ts`**
  - Set UAT mode logging to announce Quick Login & Role Simulator for authorized testers (no redirect to localhost:5173).
- [ ] **Step 2: Update `.env.local`**
  - Point `SPARTA_LOGIN_URL` and `NEXT_PUBLIC_SPARTA_LOGIN_URL` to `"https://sparta-alfamart.web.id"`.
  - Point `SPARTA_API_URL` to `"https://sparta-api.alfamart.co.id"`.
  - Retain `UAT_GATE_PASSCODE`.
- [ ] **Step 3: Update `.env.example`**
  - Document `UAT_GATE_PASSCODE` / `DEV_GATE_PASSCODE`.
- [ ] **Step 4: Update `next.config.mjs`**
  - Ensure `allowedDevOrigins` includes `xt46b973-3004.asse.devtunnels.ms` and wildcard `*.devtunnels.ms`.

---

### Task 6: Comprehensive Security & Environment Test Suite Verification

**Files:**
- Modify: `scripts/test-final-auth-environments.ts`
- Run: `pnpm dlx tsx scripts/test-final-auth-environments.ts`
- Run: `pnpm run typecheck`
- Run: `pnpm run build`

- [ ] **Step 1: Update `scripts/test-final-auth-environments.ts`**
  - Test Section 1: Local Development loopback Quick Login (9 roles), Dev Tunnel unverified (403), Dev Tunnel with gate (200 OK).
  - Test Section 2: UAT Environment (9 roles enabled with gate passcode, unverified blocked with 403, logout redirects to `/login`).
  - Test Section 3: Production Environment (Quick Login strictly 403, simulation strictly 403, fail-closed DB checks).
  - Test Section 4: Session Isolation (Dev/UAT session token rejected in Production).
  - Test Section 5: SSO Production Compatibility (validate module access, token exchange format, callback redirect).
- [ ] **Step 2: Execute test suite and verify all test assertions pass**
- [ ] **Step 3: Run `pnpm run typecheck` and `pnpm run build` to confirm zero build/type errors**

