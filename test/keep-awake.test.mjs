import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { KeepAwakeController } from "../src/keep-awake.mjs";

test("KeepAwakeController starts caffeinate on macOS and stops it", () => {
  const spawned = [];
  const child = new EventEmitter();
  child.pid = 1234;
  child.killed = false;
  child.kill = (signal) => {
    child.killed = true;
    child.signal = signal;
    return true;
  };
  child.unref = () => {};

  const controller = new KeepAwakeController({
    config: { handoff: { keepAwake: true } },
    platform: "darwin",
    spawnImpl: (command, args, options) => {
      spawned.push({ command, args, options });
      return child;
    },
  });

  const started = controller.start();
  assert.equal(started.active, true);
  assert.equal(started.pid, 1234);
  assert.deepEqual(spawned.map(({ command, args }) => ({ command, args })), [
    { command: "caffeinate", args: ["-dimsu"] },
  ]);

  const stopped = controller.stop();
  assert.equal(stopped.active, false);
  assert.equal(child.signal, "SIGTERM");
});

test("KeepAwakeController does nothing when disabled or not on macOS", () => {
  let spawned = 0;
  const spawnImpl = () => {
    spawned += 1;
    throw new Error("should not spawn");
  };

  const disabled = new KeepAwakeController({
    config: { handoff: { keepAwake: false } },
    platform: "darwin",
    spawnImpl,
  }).start();
  const nonMac = new KeepAwakeController({
    config: { handoff: { keepAwake: true } },
    platform: "linux",
    spawnImpl,
  }).start();

  assert.equal(disabled.enabled, false);
  assert.equal(disabled.active, false);
  assert.equal(nonMac.enabled, true);
  assert.equal(nonMac.active, false);
  assert.equal(nonMac.message, "macOS only");
  assert.equal(spawned, 0);
});
