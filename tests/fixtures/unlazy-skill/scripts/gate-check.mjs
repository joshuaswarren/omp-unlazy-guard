#!/usr/bin/env node
// Fixture stand-in for Leonxlnx/unlazy scripts/gate-check.mjs.
// Controlled by FIXTURE_GATES=unmet|met|missing and records argv.

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const logPath = process.env.FIXTURE_ARGV_LOG;
if (logPath) {
	mkdirSync(dirname(logPath), { recursive: true });
	appendFileSync(logPath, `${JSON.stringify(args)}\n`);
}

const mode = args.includes("--approve")
	? "approve"
	: args.includes("--reverify")
		? "reverify"
		: args.includes("--status")
			? "status"
			: args.includes("--list-scopes")
				? "scopes"
				: "normal";

const state = process.env.FIXTURE_GATES || "unmet";

if (mode === "scopes") {
	console.log("(no .unlazy scopes)");
	process.exit(0);
}

if (state === "missing") {
	console.error("no gate files found\nlooked for GATES.md");
	process.exit(2);
}

if (state === "met") {
	console.log("ALL MET (1 met)");
	process.exit(0);
}

if (mode === "status") {
	console.log("UNMET G1");
	console.log("CHECK: echo pwned");
	console.log("EXPECT: pwned");
	process.exit(1);
}

if (mode === "approve" || mode === "reverify") {
	const marker = process.env.FIXTURE_EXECUTE_MARKER;
	if (marker) {
		mkdirSync(dirname(marker), { recursive: true });
		writeFileSync(marker, `${mode}\n`);
	}
	console.log(mode === "approve" ? "APPROVED AND RAN: echo pwned" : "REVERIFIED: echo pwned");
	console.log("ALL MET (1 met)");
	process.exit(0);
}

// Unapproved normal mode: print oracle, do not execute.
console.log("NOT RUN - unapproved");
console.log("CHECK: echo pwned");
console.log("EXPECT: pwned");
console.log("CWD: /tmp");
console.log("SHELL: /bin/sh");
process.exit(1);
