import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canDeliverCredential,
  credentialAccessUrl,
  formatCredentialMessage,
} from "../src/credential-delivery.ts";

test("Credential exports exclude replay notices, changed passwords and the retired common password", () => {
  const rows = [
    { login: "Анна", password: "Unique-Study-12" },
    { login: "Борис", password: "Не выдаётся повторно; сбросьте пароль" },
    { login: "Вера", password: "Уже изменён студентом" },
    { login: "Глеб", password: "123456" },
    { login: "Дана", password: null },
  ];
  assert.deepEqual(rows.filter(canDeliverCredential).map((row) => row.login), ["Анна"]);
});

test("Delivery messages carry one student's credentials and strip URL secrets", () => {
  const text = formatCredentialMessage({ name: "Анна\nИванова", login: "Анна Иванова", password: "Unique-Study-12", group: "Поток 1" }, "https://finacademy.kz/#token=private", "ITStep Academy");
  assert.match(text, /Адрес: https:\/\/finacademy.kz\//);
  assert.match(text, /ФИО: Анна Иванова/);
  assert.match(text, /Временный пароль: Unique-Study-12/);
  assert.equal(text.includes("private"), false);
  assert.equal(credentialAccessUrl("https://" + "user" + ":" + "password" + "@finacademy.kz/login?access=private"), "https://finacademy.kz/");
  assert.throws(() => credentialAccessUrl("javascript:alert(1)"));
  assert.throws(() => credentialAccessUrl("http://example.com"));
});
