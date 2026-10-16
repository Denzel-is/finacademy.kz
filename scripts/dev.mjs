import { spawn } from "node:child_process";
const children = [
  spawn(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "dev",
      "--port",
      "8787",
      "--ip",
      "127.0.0.1",
    ],
    { stdio: "inherit" },
  ),
  spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"],
    { stdio: "inherit" },
  ),
];
function close() {
  for (const child of children) child.kill();
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
for (const child of children)
  child.on("exit", (code) => {
    if (code) {
      close();
      process.exitCode = code;
    }
  });
