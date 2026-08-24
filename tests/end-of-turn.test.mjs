import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
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

afterEach(() => {
	if (prevSkill === undefined) delete process.env.UNLAZY_SKILL_ROOT;
	else process.env.UNLAZY_SKILL_ROOT = prevSkill;
	if (prevGates === undefined) delete process.env.FIXTURE_GATES;
	else process.env.FIXTURE_GATES = prevGates;
});

async function loadGuard() {
	return import(`${guardUrl.href}?t=${Date.now()}-${Math.random()}`);
}

describe("end-of-turn behavior against pinned omp 18.0.4 contract", () => {
	it("exports the pinned omp version the tests target", async () => {
		const { PINNED_OMP_VERSION } = await loadGuard();
		assert.equal(PINNED_OMP_VERSION, "18.0.4");
	});

	it("session_stop continues when gates are unmet (omp 18.0.4 settle hook)", async () => {
		process.env.UNLAZY_SKILL_ROOT = skillRoot;
		process.env.FIXTURE_GATES = "unmet";
		const { default: unlazyGuard } = await loadGuard();
		const pi = createMockPi();
		unlazyGuard(pi);
		const cwd = mkdtempSync(join(tmpdir(), "unlazy-eot-"));
		writeFileSync(join(cwd, "GATES.md"), "- [ ] G1\n  CHECK: echo pwned\n  EXPECT: pwned\n");
		const result = await pi.emit(
			"session_stop",
			{
				type: "session_stop",
				messages: [],
				turn_id: 1,
				session_id: "sess1",
				session_file: join(cwd, "fake-session.jsonl"),
				stop_hook_active: false,
			},
			pi.ctx(cwd),
		);
		assert.equal(result?.continue, true);
		assert.equal(result?.decision, "block");
		assert.match(result.additionalContext, /block 1\/6/);
		assert.match(result.reason, /third-party/);
	});

	it("session_stop does not continue when gates are met", async () => {
		process.env.UNLAZY_SKILL_ROOT = skillRoot;
		process.env.FIXTURE_GATES = "met";
		const { default: unlazyGuard } = await loadGuard();
		const pi = createMockPi();
		unlazyGuard(pi);
		const cwd = mkdtempSync(join(tmpdir(), "unlazy-eot-"));
		const result = await pi.emit(
			"session_stop",
			{ type: "session_stop", messages: [], turn_id: 2, session_id: "s", stop_hook_active: false },
			pi.ctx(cwd),
		);
		assert.equal(result, undefined);
	});

	it("session_stop is a no-op while stop_hook_active (continuation cap / re-entry)", async () => {
		process.env.UNLAZY_SKILL_ROOT = skillRoot;
		process.env.FIXTURE_GATES = "unmet";
		const { default: unlazyGuard } = await loadGuard();
		const pi = createMockPi();
		unlazyGuard(pi);
		const cwd = mkdtempSync(join(tmpdir(), "unlazy-eot-"));
		const result = await pi.emit(
			"session_stop",
			{ type: "session_stop", messages: [], turn_id: 3, session_id: "s", stop_hook_active: true },
			pi.ctx(cwd),
		);
		assert.equal(result, undefined);
	});

	it("session_stop releases after MAX_BLOCKS without progress", async () => {
		process.env.UNLAZY_SKILL_ROOT = skillRoot;
		process.env.FIXTURE_GATES = "unmet";
		const { default: unlazyGuard, MAX_BLOCKS } = await loadGuard();
		const pi = createMockPi();
		unlazyGuard(pi);
		const cwd = mkdtempSync(join(tmpdir(), "unlazy-eot-"));
		let last;
		for (let i = 0; i < MAX_BLOCKS + 1; i++) {
			last = await pi.emit(
				"session_stop",
				{ type: "session_stop", messages: [], turn_id: i, session_id: "s", stop_hook_active: false },
				pi.ctx(cwd),
			);
		}
		assert.equal(last, undefined);
		assert.match(pi.notifies.at(-1).text, /releasing after 6/);
	});

	it("turn_end does not request a continuation (not the settle hook)", async () => {
		process.env.UNLAZY_SKILL_ROOT = skillRoot;
		process.env.FIXTURE_GATES = "unmet";
		const { default: unlazyGuard } = await loadGuard();
		const pi = createMockPi();
		unlazyGuard(pi);
		const cwd = mkdtempSync(join(tmpdir(), "unlazy-eot-"));
		const result = await pi.emit(
			"turn_end",
			{ type: "turn_end", turnIndex: 0, message: {}, toolResults: [] },
			pi.ctx(cwd),
		);
		assert.equal(result, undefined);
		assert.equal(pi.messages.length, 0);
		assert.ok(pi.statuses.some((s) => s.value === "unlazy: unmet gates"));
	});

	it("agent_end fallback sendMessage fires when session_stop never ran", async () => {
		process.env.UNLAZY_SKILL_ROOT = skillRoot;
		process.env.FIXTURE_GATES = "unmet";
		const { default: unlazyGuard } = await loadGuard();
		const pi = createMockPi();
		unlazyGuard(pi);
		const cwd = mkdtempSync(join(tmpdir(), "unlazy-eot-"));
		await pi.emit("agent_end", { type: "agent_end", messages: [] }, pi.ctx(cwd));
		await new Promise((resolve) => setTimeout(resolve, 20));
		assert.equal(pi.messages.length, 1);
		assert.match(pi.messages[0].message.content, /block 1\/6/);
		assert.equal(pi.messages[0].options.deliverAs, "nextTurn");
		assert.equal(pi.messages[0].options.triggerTurn, true);
	});

	it("agent_end does not sendMessage after session_stop already continued", async () => {
		process.env.UNLAZY_SKILL_ROOT = skillRoot;
		process.env.FIXTURE_GATES = "unmet";
		const { default: unlazyGuard } = await loadGuard();
		const pi = createMockPi();
		unlazyGuard(pi);
		const cwd = mkdtempSync(join(tmpdir(), "unlazy-eot-"));
		const ctx = pi.ctx(cwd);
		const stop = await pi.emit(
			"session_stop",
			{ type: "session_stop", messages: [], turn_id: 1, session_id: "s", stop_hook_active: false },
			ctx,
		);
		assert.equal(stop.continue, true);
		await pi.emit("agent_end", { type: "agent_end", messages: [] }, ctx);
		await new Promise((resolve) => setTimeout(resolve, 20));
		assert.equal(pi.messages.length, 0);
	});

	it("decideEndOfTurn matches the omp 18.0.4 stop-hook contract", async () => {
		const { decideEndOfTurn } = await loadGuard();
		assert.equal(decideEndOfTurn({ hasLedger: true, ok: false, unmetHint: "G1", stopHookActive: true }).action, "noop");
		assert.equal(decideEndOfTurn({ hasLedger: true, ok: true, unmetHint: "all gates met" }).action, "noop");
		const cont = decideEndOfTurn({ hasLedger: true, ok: false, unmetHint: "UNMET G1" });
		assert.equal(cont.action, "continue");
		const rel = decideEndOfTurn({
			hasLedger: true,
			ok: false,
			unmetHint: "UNMET G1",
			prev: { hash: "UNMET G1".slice(0, 120), blocks: 6 },
		});
		assert.equal(rel.action, "release");
	});
});
