"use client";

import { useEffect, useState } from "react";
import { Button, Card, Icon } from "@/components/ds";

const SKILL_SOURCE_URL =
  "https://github.com/tskoyo/proofofpool/blob/main/subgraph/skill/SKILL.md";

/** Verbatim from the skill's own README, so the two stay recognisably the same thing. */
const EXAMPLE_QUESTIONS = [
  "Is 0x88f3…7d4c likely a bot?",
  "How much extra fee has anonymous flow paid LPs?",
  "Which wallets burn their attestation allowance fastest?",
  "Did anyone swap without going through the ProofPool router?",
];

export interface SkillSectionProps {
  /** Full SKILL.md, read at build time. Null when the file was not found. */
  skillText: string | null;
}

export function SkillSection({ skillText }: SkillSectionProps) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2400);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copySkill() {
    if (!skillText) return;
    try {
      await navigator.clipboard.writeText(skillText);
      setCopied(true);
      setFailed(false);
    } catch {
      // Clipboard access needs a secure context, so this fails on plain http.
      // Send them to the source rather than leaving the button dead.
      setFailed(true);
    }
  }

  const kb = skillText ? Math.round(skillText.length / 1024) : 0;

  return (
    <section id="skill" style={{ padding: "0 48px 110px", maxWidth: 780, margin: "0 auto" }}>
      <h2 style={{ fontSize: 28, fontWeight: 600, textAlign: "center", marginBottom: 8 }}>
        Ask an AI agent about this pool
      </h2>
      <p
        style={{
          textAlign: "center",
          color: "var(--text-secondary)",
          lineHeight: 1.6,
          margin: "0 auto 36px",
          maxWidth: 560,
        }}
      >
        Every swap here is indexed by a Subgraph on The Graph. Copy the skill below, hand it to
        Claude, Cursor or ChatGPT, and ask it whatever you like — it carries the endpoint, the
        schema, and the field-level traps that otherwise produce confident wrong answers.
      </p>

      <Card padding="28px">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexWrap: "wrap",
            justifyContent: "space-between",
            marginBottom: 22,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Icon name="sparkles" size={22} style={{ color: "var(--accent-primary)" }} />
            <div>
              <div style={{ fontWeight: 600, fontFamily: "var(--font-mono)" }}>
                proofpool-analytics
              </div>
              <div style={{ color: "var(--text-tertiary)", fontSize: "var(--text-caption)" }}>
                {skillText ? `Agent skill · ${kb} KB · no API key` : "Agent skill · no API key"}
              </div>
            </div>
          </div>

          {skillText ? (
            <Button
              variant={copied ? "secondary" : "accent"}
              onClick={copySkill}
              icon={<Icon name={copied ? "check" : "copy"} size={16} />}
            >
              {copied ? "Copied to clipboard" : "Copy skill"}
            </Button>
          ) : (
            <a href={SKILL_SOURCE_URL} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
              <Button variant="accent">View skill on GitHub</Button>
            </a>
          )}
        </div>

        <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-body-s)", marginBottom: 10 }}>
          Then ask it things like:
        </div>
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
          {EXAMPLE_QUESTIONS.map((q) => (
            <li
              key={q}
              style={{
                background: "var(--surface-sunken)",
                borderRadius: "var(--radius-m)",
                padding: "10px 14px",
                fontSize: "var(--text-body-s)",
                color: "var(--text-primary)",
              }}
            >
              {q}
            </li>
          ))}
        </ul>

        <p
          style={{
            margin: "20px 0 0",
            fontSize: "var(--text-caption)",
            color: "var(--text-tertiary)",
            lineHeight: 1.55,
          }}
        >
          {failed ? (
            <>
              Clipboard access was blocked — copy it from{" "}
              <a href={SKILL_SOURCE_URL} target="_blank" rel="noreferrer">
                GitHub
              </a>{" "}
              instead.
            </>
          ) : (
            <>
              The indexed history is seeded testnet traffic, not organic usage — the skill says so
              too, and refuses to turn bot-like flow into a claim about a person.{" "}
              <a href={SKILL_SOURCE_URL} target="_blank" rel="noreferrer">
                Source
              </a>
              .
            </>
          )}
        </p>
      </Card>
    </section>
  );
}
