process.env.LOAD_FIXTURE = ".local/load-hour-fixture.json";
process.env.DURATION_SECONDS = "3600";
process.env.LOAD_HTTP2 = "1";
await import("./run-load.mjs");
