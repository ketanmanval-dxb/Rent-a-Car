import { describe, expect, it } from "vitest";
import { loadContracts } from "../helpers/contracts";
import { createUser, PASSWORD } from "../helpers/fixtures";
import { q } from "../helpers/test-db";

// Better Auth against driveeasy_test: sign-up creates a customer, role can't be self-assigned,
// emails are unique case-insensitively, passwords are hashed.

const c = await loadContracts();

describe.skipIf(!c.auth)("auth (Better Auth server)", () => {
  it("sign-up creates a customer with a hashed password", async () => {
    const u = await createUser(c);
    const [row] = await q<{ role: string }>("SELECT role FROM users WHERE id = $1", [u.id]);
    expect(row.role).toBe("customer");
    const [acc] = await q<{ password: string }>("SELECT password FROM accounts WHERE user_id = $1", [u.id]);
    expect(acc.password).toBeTruthy();
    expect(acc.password).not.toContain(PASSWORD);
  });

  it("role cannot be set at sign-up", async () => {
    const email = `qa-role-${Date.now()}@example.test`;
    const attempt = await c.auth.api
      .signUpEmail({ body: { name: "QA Sneaky", email, password: PASSWORD, role: "admin" } })
      .then((r: { user: { id: string } }) => r.user.id, () => null);
    if (attempt) {
      const [row] = await q<{ role: string }>("SELECT role FROM users WHERE id = $1", [attempt]);
      expect(row.role).toBe("customer");
    }
  });

  it("rejects a duplicate email, case-insensitively", async () => {
    const u = await createUser(c);
    await expect(c.auth.api.signUpEmail({ body: { name: "Dup", email: u.email.toUpperCase(), password: PASSWORD } })).rejects.toBeTruthy();
  });

  it("rejects short passwords", async () => {
    await expect(c.auth.api.signUpEmail({ body: { name: "Short", email: `qa-short-${Date.now()}@example.test`, password: "short" } })).rejects.toBeTruthy();
  });

  it("sign-in works with the right password and fails with a wrong one", async () => {
    const u = await createUser(c);
    const ok = await c.auth.api.signInEmail({ body: { email: u.email, password: PASSWORD } });
    expect(ok.user?.id ?? ok.id).toBe(u.id);
    await expect(c.auth.api.signInEmail({ body: { email: u.email, password: "WrongPassword!1" } })).rejects.toBeTruthy();
  });
});
