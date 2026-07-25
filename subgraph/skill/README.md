# proofpool-analytics skill

An agent skill for querying and interpreting the [ProofPool](../../README.md)
Subgraph — verified vs unverified swap flow, the fee premium anonymous wallets
pay LPs, per-wallet trading cadence, and World ID attestation usage.

The skill is [SKILL.md](./SKILL.md). It carries the endpoint, the schema, the
field-level traps that produce wrong answers, and the analytical method for
questions like *"does this address look automated?"*

## Install

Copy the directory into wherever your agent loads skills from:

```bash
cp -r subgraph/skill ~/.claude/skills/proofpool-analytics
```

Then ask questions in plain language:

- *Is `0x88f3…7d4c` likely a bot?*
- *How much extra fee has anonymous flow paid LPs?*
- *Which wallets burn their attestation allowance fastest?*
- *Did anyone swap without going through the ProofPool router?*

No API key. The Subgraph Studio endpoint is public and read-only, and the skill
queries it with a plain HTTP POST.

## Pointing it at a different deployment

The endpoint is version-pinned in SKILL.md. If ProofPool is redeployed, the
subgraph is republished at a new version URL and the old one stops resolving —
replace the endpoint in the `## The endpoint` section.

The schema and the interpretation guidance are unchanged by a redeploy; only the
URL moves.

## What it will not tell you

The skill is deliberate about the limits of this data, because the interesting
questions are exactly where over-claiming is tempting:

- **A verified wallet is not a unique person.** ProofPool proves a live human
  authorised a swap. Nothing binds a World nullifier to one address, so one
  human can verify many wallets.
- **Bot-like flow is a description of behaviour, not an accusation**, and never
  a conclusion about who is behind an address.
- **Addresses cannot be linked.** Nothing in the data connects two wallets to
  one operator.

## A note on the demo data

The history indexed by the public deployment is **seeded synthetic testnet
traffic** — wallets scripted into behavioural archetypes so there is something
to analyse. The patterns are real and so is the detection, but the traders were
planted. See [SETUP.md](../../SETUP.md#6-seed-the-demo-traffic).
