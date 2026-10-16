export type DeliveryCredential = {
  name?: string;
  login: string;
  password?: string | null;
  group?: string;
};
export type IssuedCredential = DeliveryCredential & { password: string };

export function canDeliverCredential(row: DeliveryCredential): row is IssuedCredential {
  return typeof row.password === "string" && row.password.length >= 10 &&
    !/^(?:Не выдаётся|Уже изменён)/i.test(row.password);
}

export function credentialUnavailableReason(row: DeliveryCredential) {
  if (typeof row.password === "string" && /^(?:Не выдаётся|Уже изменён)/i.test(row.password)) return row.password;
  return "Пароль не доступен для повторной выдачи.";
}

export function credentialAccessUrl(value = "https://finacademy.kz/") {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))
    throw new Error("Адрес входа должен использовать HTTPS.");
  return `${url.origin}/`;
}

const oneLine = (value: string) => value.replace(/[\r\n]+/g, " ").trim();
export function formatCredentialMessage(row: IssuedCredential, accessUrl: string, organizationName?: string) {
  return [
    organizationName ? oneLine(organizationName) : "Доступ к тестированию",
    `Адрес: ${credentialAccessUrl(accessUrl)}`,
    ...(row.name ? [`ФИО: ${oneLine(row.name)}`] : []),
    ...(row.group ? [`Поток: ${oneLine(row.group)}`] : []),
    `Логин: ${oneLine(row.login)}`,
    `Временный пароль: ${row.password}`,
    "При первом входе замените временный пароль своим.",
  ].join("\n");
}
