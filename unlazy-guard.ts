// unlazy-guard.ts — unofficial third-party omp/pi extension.
// Not affiliated with, endorsed by, or part of Leonxlnx/unlazy.
// Not an official Unlazy companion. Gate CHECK/EXPECT stay in upstream
// gate-check.mjs; this file only adds omp lifecycle hooks and slash commands.
//
// Claude ~/.claude/settings.json Stop does NOT run inside omp (Oh My Pi).
// This extension:
//   - before_agent_start / turn_start: reminder when GATES ledgers have unmet items
//   - session_stop (omp 18.x settle hook): continue while unmet, MaxBlocks release
//   - agent_end: fallback sendMessage on hosts that never emit session_stop
//   - turn_end: status only — not a settle hook
//   - tool_call: block bash that runs mutating gate-check without --root/--scope
//   - registerCommand: unlazy-status | unlazy-reverify | unlazy-approve | unlazy-scopes
//   - registerTool: unlazy_status (agent-callable)
//   - /unlazy-approve and /unlazy-reverify are inspect-then-confirm
//
// Approvals remain under ~/.unlazy/approved (outside repo). CHECKs use ambient creds.
// Deploy: ~/.omp/agent/extensions/unlazy-guard.ts (omp auto-discovers).
// COS-151: always spawn real `node` (process.execPath inside omp is the omp binary).
// COS-176: session_stop + inspect-then-confirm + documented transcripts/OS scope.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export const MAX_BLOCKS = 6;
export const STATUS_TIMEOUT_MS = 8000;
/** Host this companion's end-of-turn tests pin. Not a floating "latest". */
export const PINNED_OMP_VERSION = "18.0.4";
const ENV_SKILL = process.env.UNLAZY_SKILL_ROOT;

export type SlashMode = "inspect" | "confirm" | "help" | "unknown";

export type EndOfTurnDecision =
	| { action: "noop"; reason: string }
	| { action: "continue"; message: string; blocks: number; hash: string }
	| { action: "release"; message: string };

/** omp extensions run under the omp binary, so process.execPath is often `omp`, not node. */
export function resolveNodeBin(): string {
	const exec = process.execPath || "";
	const base = basename(exec).toLowerCase();
	if (base === "node" || base === "node.exe") return exec;
	const fromEnv = process.env.UNLAZY_NODE_BIN;
	if (fromEnv && existsSync(fromEnv)) return fromEnv;
	for (const candidate of ["/usr/bin/node", "/usr/local/bin/node", join(homedir(), ".local", "bin", "node")]) {
		if (existsSync(candidate)) return candidate;
	}
	const which = spawnSync("command", ["-v", "node"], { encoding: "utf8", shell: true });
	const hit = (which.stdout || "").trim().split("\n")[0];
	if (hit && existsSync(hit)) return hit;
	return "node";
}

export function parseSlashMode(args: string | undefined): SlashMode {
	const token = String(args || "")
		.trim()
		.split(/\s+/)
		.filter(Boolean)[0]
		?.toLowerCase();
	if (!token || token === "inspect" || token === "show" || token === "preview") return "inspect";
	if (token === "confirm" || token === "run" || token === "execute") return "confirm";
	if (token === "help" || token === "-h" || token === "--help") return "help";
	return "unknown";
}

export function mutatingGateCheckLacksRoot(command: string): boolean {
	if (!command.includes("gate-check.mjs")) return false;
	const mutating = /\s--approve\b|\s--reverify\b/.test(` ${command} `);
	if (!mutating) return false;
	if (/\s--root\b|\s--scope\b|\sGATES\.md\b|\sgates\//.test(command)) return false;
	return true;
}

export function decideEndOfTurn(input: {
	hasLedger: boolean;
	ok: boolean;
	unmetHint: string;
	stopHookActive?: boolean;
	willContinue?: boolean;
	prev?: { hash: string; blocks: number };
}): EndOfTurnDecision {
	if (input.stopHookActive) return { action: "noop", reason: "stop_hook_active" };
	if (input.willContinue) return { action: "noop", reason: "willContinue" };
	if (!input.hasLedger || input.ok) return { action: "noop", reason: "gates-met-or-absent" };
	const hash = input.unmetHint.slice(0, 120);
	const next =
		!input.prev || input.prev.hash !== hash
			? { hash, blocks: 1 }
			: { hash, blocks: input.prev.blocks + 1 };
	if (next.blocks > MAX_BLOCKS) {
		return {
			action: "release",
			message:
				`unlazy-guard (third-party): releasing after ${MAX_BLOCKS} end-of-turn blocks without gate progress; ` +
				`${input.unmetHint}`,
		};
	}
	return {
		action: "continue",
		blocks: next.blocks,
		hash: next.hash,
		message: reminderText(
			{
				ok: false,
				exitCode: 1,
				stdout: "",
				stderr: "",
				unmetHint: input.unmetHint,
				hasLedger: true,
			},
			` [block ${next.blocks}/${MAX_BLOCKS}]`,
		),
	};
}

function skillRoot(): string | null {
	const candidates = [
		ENV_SKILL,
		join(homedir(), ".config", "skillshare", "skills", "unlazy"),
		join(homedir(), ".claude", "skills", "unlazy"),
		join(homedir(), ".agents", "skills", "unlazy"),
	].filter(Boolean) as string[];
	for (const root of candidates) {
		if (existsSync(join(root, "scripts", "gate-check.mjs"))) return root;
	}
	return null;
}

function gateCheckBin(root: string): string {
	return join(root, "scripts", "gate-check.mjs");
}

export interface GateStatus {
	ok: boolean;
	exitCode: number;
	stdout: string;
	stderr: string;
	unmetHint: string;
	hasLedger: boolean;
}

function runNode(args: string[], cwd: string, timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
	const { promise, resolve } = Promise.withResolvers<{ code: number; stdout: string; stderr: string }>();
	let settled = false;
	const finish = (value: { code: number; stdout: string; stderr: string }) => {
		if (settled) return;
		settled = true;
		resolve(value);
	};
	const child = spawn(resolveNodeBin(), args, {
		cwd,
		stdio: ["ignore", "pipe", "pipe"],
		env: process.env,
	});
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (c: Buffer) => {
		stdout += c.toString();
	});
	child.stderr.on("data", (c: Buffer) => {
		stderr += c.toString();
	});
	child.on("error", (err) => finish({ code: 2, stdout, stderr: String(err) }));
	child.on("close", (code) => finish({ code: code ?? 2, stdout, stderr }));
	const timer = setTimeout(() => {
		child.kill("SIGKILL");
		finish({ code: 2, stdout, stderr: stderr + "\n(timeout)" });
	}, timeoutMs);
	timer.unref?.();
	return promise;
}

export function summarizeUnmet(stdout: string, stderr: string, code: number): GateStatus {
	const text = `${stdout}\n${stderr}`.trim();
	const infraFail =
		/unknown flags/i.test(text) ||
		/Run `omp --help`/i.test(text) ||
		/ENOENT/i.test(text);
	const noFiles =
		infraFail ||
		/no gate files found/i.test(text) ||
		(/looked for/i.test(text) && code === 2);
	const lines = text
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
	const interesting = lines
		.filter((l) => /unmet|FAIL|pending|gate|ABANDON|EXPECT|CHECK|scope/i.test(l))
		.slice(0, 8);
	const hint =
		interesting.join(" | ") ||
		(code === 0 ? "all gates met" : text.slice(0, 400) || `exit ${code}`);
	return {
		ok: code === 0,
		exitCode: code,
		stdout,
		stderr,
		unmetHint: hint,
		hasLedger: !noFiles,
	};
}

async function statusFor(cwd: string, extraArgs: string[] = []): Promise<GateStatus> {
	const root = skillRoot();
	if (!root) {
		return {
			ok: true,
			exitCode: 0,
			stdout: "",
			stderr: "unlazy skill not installed",
			unmetHint: "unlazy skill missing",
			hasLedger: false,
		};
	}
	const result = await runNode(
		[gateCheckBin(root), "--status", "--root", cwd, ...extraArgs],
		cwd,
		STATUS_TIMEOUT_MS,
	);
	return summarizeUnmet(result.stdout, result.stderr, result.code);
}

async function listScopes(cwd: string): Promise<string> {
	const root = skillRoot();
	if (!root) return "unlazy skill missing";
	const result = await runNode(
		[gateCheckBin(root), "--list-scopes", "--root", cwd],
		cwd,
		STATUS_TIMEOUT_MS,
	);
	return (result.stdout || result.stderr || `exit ${result.code}`).trim();
}

export function reminderText(status: GateStatus, where: string): string {
	return (
		`unlazy-guard (third-party)${where}: ${status.unmetHint}. ` +
		`Do not claim done. Run skill://unlazy / gate-check: ` +
		`node <unlazy>/scripts/gate-check.mjs --status --root . ` +
		`(mutating CHECK needs inspect then /unlazy-approve confirm; approvals under ~/.unlazy/approved). ` +
		`Slash: /unlazy-status /unlazy-reverify /unlazy-approve /unlazy-scopes`
	);
}

function isDir(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function ledgerLine(line: string): boolean {
	return /^\s*(- \[[ xX]\]|CHECK:|EXPECT:|CWD:|SHELL:|ABANDON:)/.test(line) || /^#{1,3} /.test(line);
}

export function collectLedgerPayload(cwd: string): string {
	const files: string[] = [];
	const rootGate = join(cwd, "GATES.md");
	if (existsSync(rootGate)) files.push(rootGate);
	const scoped = join(cwd, ".unlazy");
	if (isDir(scoped)) {
		for (const name of readdirSync(scoped)) {
			const scopeDir = join(scoped, name);
			if (!isDir(scopeDir)) continue;
			const scopeGate = join(scopeDir, "GATES.md");
			if (existsSync(scopeGate)) files.push(scopeGate);
			const gatesDir = join(scopeDir, "gates");
			if (!isDir(gatesDir)) continue;
			for (const leaf of readdirSync(gatesDir)) {
				if (leaf.endsWith(".md")) files.push(join(gatesDir, leaf));
			}
		}
	}
	if (!files.length) return "(no GATES.md or .unlazy/*/GATES.md in cwd)";
	return files
		.map((file) => {
			const text = readFileSync(file, "utf8");
			const lines = text.split(/\r?\n/).filter(ledgerLine);
			return `--- ${file} ---\n${lines.join("\n") || "(no CHECK/EXPECT lines)"}`;
		})
		.join("\n\n");
}

export function formatInspectPayload(opts: {
	cwd: string;
	mode: "approve" | "reverify";
	statusText: string;
	ledgerText: string;
}): string {
	const next =
		opts.mode === "approve"
			? "node <unlazy>/scripts/gate-check.mjs --approve --root <cwd>"
			: "node <unlazy>/scripts/gate-check.mjs --reverify --root <cwd>";
	return [
		"unlazy-guard (third-party) inspect — nothing will execute yet.",
		`cwd: ${opts.cwd}`,
		`requested: ${opts.mode}`,
		"Upstream --status (always non-executing):",
		opts.statusText || "(empty)",
		"",
		"Ledger CHECK/EXPECT/CWD/SHELL lines:",
		opts.ledgerText,
		"",
		`If that payload is what you intend, run /unlazy-${opts.mode} confirm`,
		`which shells out to: ${next}`,
		"Approvals stay under ~/.unlazy/approved (outside the repo).",
		"This companion does not reimplement CHECK logic.",
	].join("\n");
}

export default function unlazyGuard(pi: any): void {
	const blocksByCwd = new Map<string, { hash: string; blocks: number }>();
	const inspectedByCwd = new Map<string, { mode: "approve" | "reverify"; at: number }>();
	let sawSessionStop = false;
	let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

	function cwdOf(ctx: any): string {
		try {
			if (typeof ctx?.cwd === "string" && ctx.cwd) return ctx.cwd;
		} catch {
			/* ignore */
		}
		return process.cwd();
	}

	function cancelFallback(): void {
		if (fallbackTimer) {
			clearTimeout(fallbackTimer);
			fallbackTimer = null;
		}
	}

	function applyBlockState(cwd: string, decision: EndOfTurnDecision): void {
		if (decision.action === "continue") {
			blocksByCwd.set(cwd, { hash: decision.hash, blocks: decision.blocks });
			return;
		}
		blocksByCwd.delete(cwd);
	}

	function sendFallback(msg: string, ctx: any): void {
		try {
			pi.sendMessage?.(
				{ role: "user", content: msg, timestamp: Date.now() },
				{ deliverAs: "nextTurn", triggerTurn: true },
			);
		} catch {
			ctx?.ui?.notify?.(msg, "warning");
		}
	}

	async function endOfTurn(kind: "session_stop" | "agent_end", event: any, ctx: any): Promise<any> {
		const cwd = cwdOf(ctx);
		const status = await statusFor(cwd);
		const decision = decideEndOfTurn({
			hasLedger: status.hasLedger,
			ok: status.ok,
			unmetHint: status.unmetHint,
			stopHookActive: event?.stop_hook_active,
			willContinue: event?.willContinue,
			prev: blocksByCwd.get(cwd),
		});
		applyBlockState(cwd, decision);
		if (decision.action === "noop") {
			if (decision.reason === "gates-met-or-absent") ctx?.ui?.setStatus?.("unlazy", undefined);
			return;
		}
		if (kind === "session_stop") {
			sawSessionStop = true;
			cancelFallback();
			if (decision.action === "release") {
				ctx?.ui?.notify?.(decision.message, "warning");
				return;
			}
			return { continue: true, additionalContext: decision.message, decision: "block", reason: decision.message };
		}
		// agent_end is notification-only on omp 18.x. If session_stop exists, it
		// owns continuation. If this host never emits session_stop, fall back.
		if (sawSessionStop) return;
		cancelFallback();
		const msg = decision.message;
		const schedule = ctx?.setTimeout
			? (fn: () => void) => ctx.setTimeout(fn, 0)
			: (fn: () => void) => setTimeout(fn, 0);
		fallbackTimer = schedule(() => {
			fallbackTimer = null;
			if (sawSessionStop) return;
			sendFallback(msg, ctx);
		});
	}

	pi.on("before_agent_start", async (_event: unknown, ctx: any) => {
		const cwd = cwdOf(ctx);
		const status = await statusFor(cwd);
		if (!status.hasLedger || status.ok) return;
		return {
			message: {
				customType: "unlazy-gates",
				content: reminderText(status, ""),
				display: true,
				attribution: "unlazy-guard (third-party)",
			},
		};
	});

	pi.on("turn_start", async (_event: unknown, ctx: any) => {
		const cwd = cwdOf(ctx);
		const status = await statusFor(cwd);
		if (!status.hasLedger || status.ok) {
			ctx?.ui?.setStatus?.("unlazy", undefined);
			return;
		}
		ctx?.ui?.setStatus?.("unlazy", `unlazy: unmet gates`);
		ctx?.ui?.notify?.(reminderText(status, "").slice(0, 180), "warning");
	});

	pi.on("turn_end", async (_event: unknown, ctx: any) => {
		// turn_end is not settle. Do not continue or sendMessage here.
		const cwd = cwdOf(ctx);
		const status = await statusFor(cwd);
		if (!status.hasLedger || status.ok) {
			ctx?.ui?.setStatus?.("unlazy", undefined);
			return;
		}
		ctx?.ui?.setStatus?.("unlazy", `unlazy: unmet gates`);
	});

	pi.on("session_stop", async (event: any, ctx: any) => endOfTurn("session_stop", event, ctx));
	pi.on("agent_end", async (event: any, ctx: any) => endOfTurn("agent_end", event, ctx));

	pi.on("tool_call", async (event: any) => {
		if (event?.toolName !== "bash") return;
		const command = typeof event?.input?.command === "string" ? event.input.command : "";
		if (!mutatingGateCheckLacksRoot(command)) return;
		return {
			block: true,
			reason:
				"unlazy-guard (third-party): mutating gate-check (--approve/--reverify) must pass --root <dir> or --scope <id> " +
				"so CHECK approval binds the intended ledger. Inspect with /unlazy-approve, then /unlazy-approve confirm.",
		};
	});

	const notifyLong = (ctx: any, text: string, level: "info" | "warning" | "error") => {
		ctx?.ui?.notify?.(text.slice(0, 500) || "(empty)", level);
		try {
			pi.appendEntry?.({
				type: "unlazy-gate-check",
				content: text,
				exitCode: level === "info" ? 0 : 1,
			});
		} catch {
			/* optional — session JSONL still holds the omp turn */
		}
	};

	const inspectMutating = async (mode: "approve" | "reverify", ctx: any) => {
		const cwd = cwdOf(ctx);
		const status = await statusFor(cwd);
		const statusText = (status.stdout || status.stderr || status.unmetHint || "").trim();
		const ledgerText = collectLedgerPayload(cwd);
		inspectedByCwd.set(cwd, { mode, at: Date.now() });
		const body = formatInspectPayload({ cwd, mode, statusText, ledgerText });
		notifyLong(ctx, body, "info");
		return body;
	};

	const confirmMutating = async (mode: "approve" | "reverify", ctx: any) => {
		const cwd = cwdOf(ctx);
		const prior = inspectedByCwd.get(cwd);
		if (!prior || prior.mode !== mode) {
			const body =
				`unlazy-guard (third-party): confirm refused — inspect first. ` +
				`Run /unlazy-${mode} (no args) to see CHECK/EXPECT/status, then /unlazy-${mode} confirm.`;
			notifyLong(ctx, body, "warning");
			await inspectMutating(mode, ctx);
			return;
		}
		const root = skillRoot();
		if (!root) {
			ctx?.ui?.notify?.("unlazy skill not found on this host", "error");
			return;
		}
		const flag = mode === "approve" ? "--approve" : "--reverify";
		const result = await runNode([gateCheckBin(root), flag, "--root", cwd], cwd, 120000);
		const text = (result.stdout || result.stderr || `exit ${result.code}`).trim();
		inspectedByCwd.delete(cwd);
		notifyLong(ctx, text || `exit ${result.code}`, result.code === 0 ? "info" : "warning");
	};

	const mutatingHelp = (mode: "approve" | "reverify") =>
		`unlazy-guard (third-party) /unlazy-${mode}: inspect-then-confirm.\n` +
		`  /unlazy-${mode}          show CHECK/EXPECT and --status (does not execute)\n` +
		`  /unlazy-${mode} confirm  run upstream gate-check ${mode === "approve" ? "--approve" : "--reverify"} after inspect\n` +
		`A single-shot yes that hides the payload is refused.`;

	pi.registerCommand?.("unlazy-status", {
		description: "Unlazy (third-party guard): report GATES ledger status (no CHECK execution)",
		handler: async (_args: string, ctx: any) => {
			const cwd = cwdOf(ctx);
			const root = skillRoot();
			if (!root) {
				ctx?.ui?.notify?.("unlazy skill not found on this host", "error");
				return;
			}
			const result = await runNode([gateCheckBin(root), "--status", "--root", cwd], cwd, 120000);
			const text = (result.stdout || result.stderr || `exit ${result.code}`).trim();
			notifyLong(ctx, text || `exit ${result.code}`, result.code === 0 ? "info" : "warning");
		},
	});
	pi.registerCommand?.("unlazy-reverify", {
		description: "Unlazy (third-party guard): inspect CHECK payload, then confirm to reverify",
		handler: async (args: string, ctx: any) => {
			const mode = parseSlashMode(args);
			if (mode === "help") {
				notifyLong(ctx, mutatingHelp("reverify"), "info");
				return;
			}
			if (mode === "unknown") {
				notifyLong(ctx, `unknown args ${JSON.stringify(args)}. ${mutatingHelp("reverify")}`, "warning");
				return;
			}
			if (mode === "inspect") {
				await inspectMutating("reverify", ctx);
				return;
			}
			await confirmMutating("reverify", ctx);
		},
	});
	pi.registerCommand?.("unlazy-approve", {
		description: "Unlazy (third-party guard): inspect CHECK payload, then confirm to approve",
		handler: async (args: string, ctx: any) => {
			const mode = parseSlashMode(args);
			if (mode === "help") {
				notifyLong(ctx, mutatingHelp("approve"), "info");
				return;
			}
			if (mode === "unknown") {
				notifyLong(ctx, `unknown args ${JSON.stringify(args)}. ${mutatingHelp("approve")}`, "warning");
				return;
			}
			if (mode === "inspect") {
				await inspectMutating("approve", ctx);
				return;
			}
			await confirmMutating("approve", ctx);
		},
	});
	pi.registerCommand?.("unlazy-scopes", {
		description: "Unlazy (third-party guard): list Depth Tree / .unlazy pipeline scopes",
		handler: async (_args: string, ctx: any) => {
			const text = await listScopes(cwdOf(ctx));
			ctx?.ui?.notify?.(text.slice(0, 500), "info");
		},
	});

	const z = pi.zod;
	if (pi.registerTool && z) {
		pi.registerTool({
			name: "unlazy_status",
			label: "Unlazy status (third-party guard)",
			description:
				"Report Unlazy GATES ledger status for the current workspace (no CHECK execution). " +
				"Unofficial third-party omp helper — not official Unlazy. " +
				"Use before claiming work complete. Optional scope for Depth Tree pipelines under .unlazy/.",
			parameters: z.object({
				scope: z.string().optional().describe("Optional .unlazy/<scope> pipeline id"),
			}),
			execute: async (_id: string, params: { scope?: string }, _onUpdate: unknown, ctx: any) => {
				const cwd = cwdOf(ctx);
				const extra = params?.scope ? ["--scope", params.scope] : [];
				const status = await statusFor(cwd, extra);
				const scopes = await listScopes(cwd);
				const body = [
					`ok=${status.ok}`,
					`hasLedger=${status.hasLedger}`,
					`exit=${status.exitCode}`,
					status.unmetHint,
					"--- scopes ---",
					scopes,
				].join("\n");
				return { content: [{ type: "text", text: body }], details: status };
			},
		});
	}
}
