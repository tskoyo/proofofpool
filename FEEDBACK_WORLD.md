# Testing report — World ID Selfie Check integration

Developer feedback (SDK friction, documentation gaps) and
[user feedback](#user-feedback--testing-the-selfie-check-flow) from running the
flow on real devices.

Written while integrating Selfie Check into ProofPool, a Uniswap v4 hook that
prices verified humans differently from anonymous flow.

**Environment**

| | |
|---|---|
| `@worldcoin/idkit` | 4.2.1 |
| `@worldcoin/idkit-core` | 4.2.2 |
| Preset | `selfieCheckLegacy` with `allow_legacy_proofs: true` |
| Proof | protocol version `3.0`, `environment: production` |
| Stack | Next.js 15 App Router, server-side RP signing and verification |

Items below are split by how strongly we can evidence them. The first section is
what we hit and confirmed against a real production proof; the second is friction
that cost us time but where we may have missed a doc page.

---

## Confirmed mismatches between documentation and runtime

### 1. Selfie Check returns `identifier: "face"`, but every doc says `"selfie"`

This one silently broke our integration and took a logging pass to find.

`ResponseItemV3.identifier` is documented in the shipped type definitions
(`@worldcoin/idkit-core/dist/index.d.ts`) as:

```ts
/** Credential identifier (e.g., "proof_of_human", "selfie") */
identifier: string;
```

and the neighbouring `issuer_schema_id` field documents `11=selfie`. Following
that, we filtered the response with `r.identifier === "selfie"`.

A real production Selfie Check proof actually returns:

```json
{
  "protocol_version": "3.0",
  "action": "verify",
  "environment": "production",
  "responses": [
    { "identifier": "face", "signal_hash": "0x00d8…94aa", "proof": "…", "merkle_root": "…", "nullifier": "…" }
  ]
}
```

`identifier` is **`"face"`**, not `"selfie"`.

**Why this is costly:** the failure is silent and looks like a proof problem.
The user completes the whole Selfie Check journey in World App, gets
"Verification declined", and nothing in the client error surface indicates that
the credential was present and simply didn't match the name in the docs. We only
found it by logging every identifier in the response server-side.

**Suggested fix:** correct the JSDoc examples and any docs pages listing
credential identifiers, and ideally publish the identifiers as an exported
enum/union type rather than `identifier: string`. A string-typed field with a
misleading doc example gives no compile-time protection.

### 2. The hashing helper is exported as `hashSignal`, not `hashToField`

Docs and examples we found for computing a signal hash refer to `hashToField`
from `@worldcoin/idkit-core/hashing`. The v4 package exports:

```ts
// @worldcoin/idkit-core/dist/hashing.d.ts
declare function hashSignal(signal: string | Uint8Array): string;
export { hashSignal };
```

There is no `hashToField` export. `hashToField` is still the name used in the
Solidity helper (`ByteHasher.hashToField`), so the two sides of the same concept
have different names — easy to trip over when porting an on-chain integration to
the cloud API.

### 3. `environment` defaults to `production` and is easy to get wrong silently

`IDKitRequestConfig.environment` is optional and defaults to `"production"`. If
the Portal action was created in staging, the request goes to production, finds
nothing, and the symptom is a QR code that does nothing — presenting as a
frontend bug.

**Suggested fix:** when a request targets an app/action that exists in a
different environment than the one requested, return a distinguishable error
code rather than nothing. This is called out in the docs' troubleshooting notes,
but only after you already know to look for it.

---

## Friction and documentation gaps

### 4. Cloud-only credential support is under-signposted

Only Orb credentials can be verified on-chain (`groupId = 1` via
`WorldIDRouter.verifyProof`). Selfie Check has no on-chain verifier, so any
integration that wants an on-chain consequence must verify in a backend and
attest the result itself — a materially different trust model, since the
contract ends up trusting an RP-held key rather than a ZK proof.

That constraint is stated in the on-chain docs, but it isn't visible from the
Selfie Check material, which is where someone building an on-chain product
starts. We designed against the on-chain path first and had to rework the
contracts after discovering it.

**Suggested fix:** state the on-chain/cloud-only split directly on each
credential's page.

### 5. Legacy `/api/v2/verify/{app_id}` vs `/api/v4/verify/{rp_id}`

`selfieCheckLegacy` produces a protocol `3.0` proof, which reads as "legacy" and
points toward the v2 endpoint. The current API reference documents only v4, so
there's no authoritative page saying whether v2 is still supported for legacy
presets, or that v4 accepts `protocol_version: "3.0"` bodies.

What was genuinely helpful once found: the v4 request body is *exactly* the
IDKit result object, so `JSON.stringify(result)` is the whole integration. That
property deserves to be stated loudly — we initially destructured the result into
a hand-built v2-shaped body, which was wasted work and introduced a bug
(`verification_level` populated with the credential identifier).

### 6. `signal_hash` binding is the integrator's responsibility, and this isn't spelled out

With the "forward the result verbatim" model, the RP cannot inject its own
`signal_hash` — the proof carries its own. Verification therefore confirms the
proof is internally consistent, but says nothing about whether the *subject the
RP is about to act on* is the one the proof was issued for.

Concretely: a client can send a valid proof issued for address A alongside a
request body claiming address B. The verify call succeeds, and a naive backend
registers B.

The RP must independently compare `response.signal_hash` against
`hashSignal(subject)` and reject on mismatch. We do this, but it was a
conclusion we reached ourselves rather than something the integration guide
warned about.

**Suggested fix:** add this comparison to the integration guide's verification
step, next to the existing nullifier-storage guidance. It's the same class of
requirement — something the API cannot enforce for you — and omitting it is a
silent authorization bug rather than a visible failure.

---

## What worked well

- The v4 result object being byte-identical to the verify request body is an
  excellent design decision once known; it removes an entire class of remapping
  bugs.
- Server-side RP signing via `@worldcoin/idkit-core/signing` was a two-line
  integration and the "sign on the server, never the client" boundary is
  unambiguous in the docs.
- `nullifier` semantics (deterministic per identity+action) are documented
  clearly enough that we could reason correctly about what single-use does and
  does not mean before writing any contract code.
- The controlled `IDKitRequestWidget` (`open` / `onOpenChange`) is a better API
  than the v3 render-prop pattern.

---

## User feedback — testing the Selfie Check flow

Everything above is developer-side. This section is what happened when people
actually ran the flow on their phones.

**Headline: there is no friction inside Selfie Check itself.** Once a World
account exists, the credential flow is fast and straightforward — no delays, no
service errors, no retries, nothing that needed explaining to the person doing
it. For an integrator choosing between credential types, that matters: the
step we expected to be the risky part of the funnel was the part nobody
noticed.

### The one friction point is upstream of you

Users who do not already have World App installed have to install it and create
an account before they can do anything. That is the only drop-off surface we
found, and it is not in Selfie Check.

It is also handled well. World's own onboarding is simple and well guided, and
nobody needed help getting through it. But it is still the difference between a
sub-minute flow and a multi-minute one, and for an app like ours — where
verification buys a *fee discount*, not access to the product — that gap is
where a real user decides the discount is not worth it.

Worth knowing rather than acting on, because the fix is distribution, not UX.

### What we observed

Tested on both Android and iOS by project contributors, some of whom already had
World App installed and some of whom did not. Both platforms completed the flow
successfully; we saw no behavioural difference between them.

- Selfie capture worked first time. No retries, no failed or timed-out
  verifications, no waiting on World's service.
- The app → World App → app handoff returned cleanly; nobody got stranded in
  World App or had to navigate back manually.
- Nobody misread what the selfie was for, but see the caveat: we already knew.

### Caveat on who tested this

Everyone who ran the flow had already built or seen the app, so this covers
**usability, not comprehension**. Whether a first-time user understands why a
liveness check earns a lower swap fee — or trusts it enough to try — is not
something a team testing its own product can measure, and we are not claiming
to have done so.

Drop-off numbers in the usual sense do not exist here either. Testing was a
handful of deliberate runs, not traffic.

---

## Not verified

Stated for completeness, so nothing here is read as a confirmed defect:

- Whether `/api/v2/verify/{app_id}` still accepts legacy proofs — we migrated to
  v4 before testing it.
- Whether `/api/v4/verify/{rp_id}` requires an `Authorization` header. We send
  none, on the basis that the docs don't document one.
- Sandbox behaviour. All testing described here was against production.
