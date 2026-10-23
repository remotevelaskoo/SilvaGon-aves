import assert from "node:assert/strict";
import test from "node:test";
import {
  createPasswordHash,
  createSessionToken,
  verifyAdminCredentials,
  verifySessionToken,
} from "../lib/auth.js";

const originalEnvironment = {
  ADMIN_USERNAME: process.env.ADMIN_USERNAME,
  ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH,
  SESSION_SECRET: process.env.SESSION_SECRET,
};

test.before(() => {
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD_HASH = createPasswordHash("Senha-de-teste-123!", "salt-de-teste-seguro");
  process.env.SESSION_SECRET = "segredo-de-teste-com-pelo-menos-32-caracteres";
});

test.after(() => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("valida somente a credencial administrativa correta", () => {
  assert.equal(verifyAdminCredentials("admin", "Senha-de-teste-123!"), true);
  assert.equal(verifyAdminCredentials("admin", "senha-incorreta"), false);
  assert.equal(verifyAdminCredentials("outro-usuario", "Senha-de-teste-123!"), false);
});

test("assina e valida uma sessão sem aceitar adulterações", () => {
  const token = createSessionToken("admin");
  assert.deepEqual(verifySessionToken(token), { username: "admin" });
  assert.equal(verifySessionToken(`${token}adulterado`), null);
});

