import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const ompRoot = join(root, "node_modules", "@oh-my-pi", "pi-coding-agent");

describe("named omp version pin", () => {
	it("package.json pins an exact omp version, not latest or a range", () => {
		const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
		const pinned = pkg.devDependencies["@oh-my-pi/pi-coding-agent"];
		assert.equal(pinned, "18.0.4");
		assert.equal(pkg.ompTestPin.version, "18.0.4");
		assert.doesNotMatch(pinned, /^[\^~>=<]/);
		assert.notEqual(pinned, "latest");
		assert.notEqual(pinned, "*");
	});

	it("installed @oh-my-pi/pi-coding-agent is exactly 18.0.4", () => {
		assert.equal(existsSync(join(ompRoot, "package.json")), true, "pin package missing; run npm ci --ignore-scripts");
		const pkg = JSON.parse(readFileSync(join(ompRoot, "package.json"), "utf8"));
		assert.equal(pkg.version, "18.0.4");
	});

	it("pinned omp 18.0.4 documents session_stop as the settle / end-of-turn hook", () => {
		const events = readFileSync(join(ompRoot, "src/extensibility/shared-events.ts"), "utf8");
		assert.match(events, /export interface SessionStopEvent/);
		assert.match(events, /stop_hook_active/);
		assert.match(events, /session_file\?/);
		assert.match(events, /export interface SessionStopEventResult/);
		assert.match(events, /continue\?: boolean/);
		assert.match(events, /decision\?: "block"/);
		assert.match(events, /export interface AgentEndEvent/);
		assert.match(events, /willContinue\?/);
		assert.match(events, /export interface TurnEndEvent/);
	});
});
