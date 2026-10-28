import { describe, expect, it } from "vitest";
import { findSecrets, redactSecrets } from "../src/core/secrets.js";

// Fixtures are assembled at runtime so this file never contains a literal credential.
const fake = {
  anthropic: "sk-ant-api03-" + "A".repeat(40),
  openai: "sk-proj-" + "b1C2d3E4".repeat(4),
  github: "ghp_" + "x9Y8z7W6".repeat(5),
  githubPat: "github_pat_" + "11ABCDEFG0".repeat(4),
  aws: "AKIA" + "IOSFODNN7EXAMPLE",
  slack: "xoxb-" + "1234567890-abcdefghijkl",
  jwt: "eyJhbGciOiJIUzI1NiJ9." + "eyJzdWIiOiIxMjM0NTY3ODkwIn0." + "dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
  pem: "-----BEGIN RSA PRIVATE KEY-----\nMIIEow" + "Q".repeat(60) + "\n-----END RSA PRIVATE KEY-----",
  stripe: "sk_live_" + "4eC39HqLyjWDarjtT1zdp7dc",
  google: "AIza" + "SyA-1234567890abcdefghijklmnopqrstu"
};

describe("secret detection", () => {
  it.each(Object.entries(fake))("detects %s credentials", (_name, value) => {
    expect(findSecrets(`config: ${value}`).length).toBeGreaterThan(0);
    expect(redactSecrets(`value ${value} end`)).not.toContain(value);
  });

  it("detects credential assignments, bearer headers and URL passwords", () => {
    expect(findSecrets("Use api_key=super-secret-value").length).toBeGreaterThan(0);
    expect(findSecrets("DATABASE_PASSWORD=hunter2hunter2").length).toBeGreaterThan(0);
    expect(findSecrets("Authorization: Bearer abcdef0123456789abcdef").length).toBeGreaterThan(0);
    expect(findSecrets("postgres://admin:s3cr3tP4ss@db.internal:5432/app").length).toBeGreaterThan(0);
  });

  it("does not flag ordinary engineering prose", () => {
    const benign = [
      "max_tokens: 100",
      "token budget: 4000 per request",
      "Rotate the token: see docs/auth.md",
      "password field is validated in src/forms/password.ts",
      "api_key: <your-key-here>",
      "OPENAI_API_KEY=${OPENAI_API_KEY}",
      "The secret: we cache aggressively",
      "Use sk-learn style naming",
      "commit 7f3a2c1 changed tokenizer.ts"
    ];
    for (const text of benign) {
      expect(findSecrets(text), text).toEqual([]);
    }
  });

  it("redacts the value but keeps the key name readable", () => {
    const out = redactSecrets("STRIPE_SECRET=sk_live_" + "4eC39HqLyjWDarjtT1zdp7dc");
    expect(out).toContain("STRIPE_SECRET=");
    expect(out).toContain("[REDACTED");
  });

  it("redacts whole PEM blocks", () => {
    const out = redactSecrets(`before\n${fake.pem}\nafter`);
    expect(out).toContain("before");
    expect(out).toContain("after");
    expect(out).not.toContain("MIIEow");
  });
});
