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
  await run("py", ["-3", "-B", "tests/branch_numbers_test.py"], source);
  await run(process.execPath, ["tests/shared-templates.cjs"], source);
  await run(process.execPath, ["tests/pages-templates.cjs"], source);
  await run(process.execPath, ["tests/document-editing.cjs"], source);
  await run(process.execPath, ["tests/fill-layout.cjs"], source);
  await run(process.execPath, ["tests/staff-archive.cjs"], source);
  await run(process.execPath, ["tests/web.cjs"], source);
  await run(process.execPath, ["tests/ui-editor.cjs"], source);
  await run(process.execPath, ["tests/archive-camera.cjs"], source);
  const web = await serve(process.env.CONTRACT_TEST_BUILD || path.join(source, "dist"), {sampleFaces: !process.env.CONTRACT_TEST_BUILD});
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
