const { spawn } = require("node:child_process");
const path = require("node:path");
const serve = require("./server.cjs");
const source = path.resolve(__dirname, "..");
const run = (command, args, cwd, env = process.env) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(Error(`${args.join(" ")} exited ${code}`)),
    );
  });

(async () => {
  await run("py", ["-3", "-B", "tests/test_build.py"], source);
  await run(process.execPath, ["tests/excel-export.cjs"], source);
  await run(process.execPath, ["tests/web.cjs"], source);
  await run(process.execPath, ["tests/ui-editor.cjs"], source);
  const web = await serve(path.join(source, "dist"));
  try {
    for (const name of [
      "cash",
      "external",
      "exchange",
      "contract-files",
      "schedule",
      "smart-tables",
      "camera-square",
      "scroll-slots",
    ]) {
      await run(
        process.execPath,
        [path.join(source, `test-${name}.cjs`)],
        path.dirname(source),
        { ...process.env, CONTRACT_TEST_URL: web.url },
      );
    }
  } finally {
    web.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
