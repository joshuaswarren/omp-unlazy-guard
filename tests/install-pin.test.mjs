import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const installer = join(root, "scripts", "install.sh");
const SHA = "a".repeat(40);

function run(args, opts = {}) {
	return spawnSync("sh", [installer, ...args], {
		encoding: "utf8",
		timeout: 15_000,
		...opts,
	});
}

describe("installer pin + inspect-then-confirm", () => {
	it("help names third-party, pin, inspect-then-confirm, transcripts, and OS scope", () => {
		const r = run(["--help"]);
		assert.equal(r.status, 0, r.stderr);
		const text = `${r.stdout}\n${r.stderr}`;
		assert.match(text, /unofficial third-party/i);
		assert.match(text, /Not an official Unlazy companion/);
		assert.match(text, /40-char/);
		assert.match(text, /main/);
		assert.match(text, /inspect/i);
		assert.match(text, /--yes/);
		assert.match(text, /sessions/);
		assert.match(text, /Linux/);
		assert.match(text, /macOS/);
		assert.match(text, /Not supported: Windows/);
	});

	it("refuses floating refs", () => {
		for (const pin of ["main", "master", "HEAD", "latest", "develop", "abc", "deadbeef", "v1", "release-1.0"]) {
			const r = run(["--pin", pin]);
			assert.equal(r.status, 2, `expected refuse for ${pin}: ${r.stderr}`);
			assert.match(r.stderr, /refusing|floating|missing --pin|Accepted/i);
		}
	});

	it("inspects without writing when --yes is absent", () => {
		const dir = mkdtempSync(join(tmpdir(), "unlazy-guard-install-"));
		const dest = join(dir, "unlazy-guard.ts");
		const src = join(root, "unlazy-guard.ts");
		const r = run(["--pin", SHA, "--from-file", src, "--dest", dest]);
		assert.equal(r.status, 0, r.stderr);
		assert.match(r.stdout, /inspect-only|Nothing written/i);
		assert.match(r.stdout, /third-party/i);
		assert.match(r.stdout, /sha256/i);
		assert.match(r.stdout, /commands that will run/i);
		assert.equal(existsSync(dest), false);
	});

	it("writes only after --yes, after printing the payload", () => {
		const dir = mkdtempSync(join(tmpdir(), "unlazy-guard-install-"));
		const dest = join(dir, "unlazy-guard.ts");
		const src = join(root, "unlazy-guard.ts");
		const r = run(["--pin", SHA, "--from-file", src, "--dest", dest, "--yes"]);
		assert.equal(r.status, 0, r.stderr + r.stdout);
		assert.match(r.stdout, /sha256/i);
		assert.match(r.stdout, /commands that will run/i);
		assert.match(r.stdout, /installed /);
		assert.equal(readFileSync(dest, "utf8"), readFileSync(src, "utf8"));
	});

	it("shows a diff against an existing dest before confirm", () => {
		const dir = mkdtempSync(join(tmpdir(), "unlazy-guard-install-"));
		const dest = join(dir, "unlazy-guard.ts");
		const src = join(dir, "incoming.ts");
		writeFileSync(dest, "old payload\n");
		writeFileSync(src, "new payload\n");
		const r = run(["--pin", SHA, "--from-file", src, "--dest", dest]);
		assert.equal(r.status, 0, r.stderr);
		assert.match(r.stdout, /unified diff/);
		assert.match(r.stdout, /old payload/);
		assert.match(r.stdout, /new payload/);
		assert.equal(readFileSync(dest, "utf8"), "old payload\n");
	});
});
