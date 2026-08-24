import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createMockPi } from "./helpers/mock-pi.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const skillRoot = join(root, "tests/fixtures/unlazy-skill");
const guardUrl = new URL("../unlazy-guard.ts", import.meta.url);

const prevSkill = process.env.UNLAZY_SKILL_ROOT;
const prevGates = process.env.FIXTURE_GATES;
const prevLog = process.env.FIXTURE_ARGV_LOG;
const prevMarker = process.env.FIXTURE_EXECUTE_MARKER;

afterEach(() => {
	for (const [key, prev] of [
		["UNLAZY_SKILL_ROOT", prevSkill],
		["FIXTURE_GATES", prevGates],
		["FIXTURE_ARGV_LOG", prevLog],
		["FIXTURE_EXECUTE_MARKER", prevMarker],
	]) {
		if (prev === undefined) delete process.env[key];
		else process.env[key] = prev;
	}
});

async function loadGuard() {
	return import(`${guardUrl.href}?t=${Date.now()}-${Math.random()}`);
}

describe("inspect-then-confirm approval", () => {
	it("parseSlashMode defaults to inspect and treats confirm as the second step", async () => {
		const { parseSlashMode } = await loadGuard();
		assert.equal(parseSlashMode(""), "inspect");
		assert.equal(parseSlashMode("inspect"), "inspect");
		assert.equal(parseSlashMode("confirm"), "confirm");
		assert.equal(parseSlashMode("yes"), "unknown");
		assert.equal(parseSlashMode("help"), "help");
	});

	it("/unlazy-approve without args shows CHECK payload and does not execute", async () => {
		process.env.UNLAZY_SKILL_ROOT = skillRoot;
		process.env.FIXTURE_GATES = "unmet";
		const dir = mkdtempSync(join(tmpdir(), "unlazy-approve-"));
		const marker = join(dir, "executed");
		const log = join(dir, "argv.log");
		process.env.FIXTURE_EXECUTE_MARKER = marker;
		process.env.FIXTURE_ARGV_LOG = log;
		writeFileSync(join(dir, "GATES.md"), "- [ ] G1: demo\n  CHECK: echo pwned\n  EXPECT: pwned\n  CWD: .\n");

		const { default: unlazyGuard } = await loadGuard();
		const pi = createMockPi();
		unlazyGuard(pi);
		await pi.commands.get("unlazy-approve").handler("", pi.ctx(dir));

		assert.equal(existsSync(marker), false);
		const argv = readFileSync(log, "utf8");
		assert.match(argv, /--status/);
		assert.doesNotMatch(argv, /--approve/);
		const text = pi.entries.at(-1).content;
		assert.match(text, /nothing will execute yet/i);
		assert.match(text, /CHECK: echo pwned/);
		assert.match(text, /\/unlazy-approve confirm/);
	});

	it("/unlazy-approve confirm without inspect is refused and still does not execute", async () => {
		process.env.UNLAZY_SKILL_ROOT = skillRoot;
		process.env.FIXTURE_GATES = "unmet";
		const dir = mkdtempSync(join(tmpdir(), "unlazy-approve-"));
		const marker = join(dir, "executed");
		process.env.FIXTURE_EXECUTE_MARKER = marker;
		writeFileSync(join(dir, "GATES.md"), "- [ ] G1\n  CHECK: echo pwned\n  EXPECT: pwned\n");

		const { default: unlazyGuard } = await loadGuard();
		const pi = createMockPi();
		unlazyGuard(pi);
		await pi.commands.get("unlazy-approve").handler("confirm", pi.ctx(dir));

		assert.equal(existsSync(marker), false);
		assert.ok(pi.entries.some((e) => /confirm refused/i.test(e.content)));
		assert.ok(pi.entries.some((e) => /CHECK: echo pwned/.test(e.content)));
	});

	it("/unlazy-approve inspect then confirm executes --approve once", async () => {
		process.env.UNLAZY_SKILL_ROOT = skillRoot;
		process.env.FIXTURE_GATES = "unmet";
		const dir = mkdtempSync(join(tmpdir(), "unlazy-approve-"));
		const marker = join(dir, "executed");
		const log = join(dir, "argv.log");
		process.env.FIXTURE_EXECUTE_MARKER = marker;
		process.env.FIXTURE_ARGV_LOG = log;
		writeFileSync(join(dir, "GATES.md"), "- [ ] G1\n  CHECK: echo pwned\n  EXPECT: pwned\n");

		const { default: unlazyGuard } = await loadGuard();
		const pi = createMockPi();
		unlazyGuard(pi);
		const ctx = pi.ctx(dir);
		await pi.commands.get("unlazy-approve").handler("inspect", ctx);
		assert.equal(existsSync(marker), false);
		await pi.commands.get("unlazy-approve").handler("confirm", ctx);
		assert.equal(readFileSync(marker, "utf8").trim(), "approve");
		assert.match(readFileSync(log, "utf8"), /--approve/);
	});

	it("blocks mutating gate-check bash without --root", async () => {
		const { mutatingGateCheckLacksRoot } = await loadGuard();
		assert.equal(mutatingGateCheckLacksRoot("node scripts/gate-check.mjs --approve"), true);
		assert.equal(mutatingGateCheckLacksRoot("node scripts/gate-check.mjs --approve --root ."), false);
		assert.equal(mutatingGateCheckLacksRoot("node scripts/gate-check.mjs --status"), false);
	});
});
