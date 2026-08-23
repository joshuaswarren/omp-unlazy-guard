// unlazy-guard.ts — omp/pi extension giving live omp panes Unlazy coverage
// equivalent-or-better than Claude Code's Stop hook.
//
// Claude ~/.claude/settings.json Stop does NOT run inside omp (Oh My Pi).
// This extension:
//   - before_agent_start: inject reminder when GATES ledgers have unmet items
//   - agent_end: re-prompt (sendMessage) while unmet, with MaxBlocks release
//   - tool_call: block bash that runs gate-check mutating modes without --root
//     safety; allow status; surface approve/reverify via commands/tools
//   - registerCommand: unlazy-status | unlazy-reverify | unlazy-approve | unlazy-scopes
//   - registerTool: unlazy_status (agent-callable)
//   - Depth Tree: --list-scopes + scoped --status when .unlazy/ present
//
// Gate execution stays in upstream gate-check.mjs (skillshare unlazy skill).
// Approvals remain under ~/.unlazy/approved (outside repo). CHECKs use ambient creds.
//
// Deploy: ~/.omp/agent/extensions/unlazy-guard.ts (omp auto-discovers).
// Source: homelab-infra/scripts/omp-unlazy-guard/ + skillsharesync omp-unlazy-guard/.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MAX_BLOCKS = 6;
const STATUS_TIMEOUT_MS = 8000;
const ENV_SKILL = process.env.UNLAZY_SKILL_ROOT;

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

interface GateStatus {
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
	const child = spawn(process.execPath, args, {
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

function summarizeUnmet(stdout: string, stderr: string, code: number): GateStatus {
	const text = `${stdout}\n${stderr}`.trim();
	const noFiles =
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

function reminderText(status: GateStatus, where: string): string {
	return (
		`unlazy${where}: ${status.unmetHint}. ` +
		`Do not claim done. Run skill://unlazy / gate-check: ` +
		`node <unlazy>/scripts/gate-check.mjs --status --root . ` +
		`(mutating CHECK needs --approve; approvals under ~/.unlazy/approved). ` +
		`Slash: /unlazy-status /unlazy-reverify /unlazy-approve /unlazy-scopes`
	);
}

export default function unlazyGuard(pi: any): void {
	const blocksByCwd = new Map<string, { hash: string; blocks: number }>();

	function cwdOf(ctx: any): string {
		try {
			if (typeof ctx?.cwd === "string" && ctx.cwd) return ctx.cwd;
		} catch {
			/* ignore */
		}
		return process.cwd();
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
				attribution: "unlazy-guard",
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

	pi.on("agent_end", async (_event: unknown, ctx: any) => {
		const cwd = cwdOf(ctx);
		const status = await statusFor(cwd);
		if (!status.hasLedger || status.ok) {
			blocksByCwd.delete(cwd);
			return;
		}
		const hash = status.unmetHint.slice(0, 120);
		const prev = blocksByCwd.get(cwd);
		const next = !prev || prev.hash !== hash ? { hash, blocks: 1 } : { hash, blocks: prev.blocks + 1 };
		blocksByCwd.set(cwd, next);
		if (next.blocks > MAX_BLOCKS) {
			const msg =
				`unlazy: releasing after ${MAX_BLOCKS} end-blocks without gate progress; ` +
				`${status.unmetHint}`;
			try {
				pi.sendMessage?.({
					role: "user",
					content: msg,
					timestamp: Date.now(),
				});
			} catch {
				ctx?.ui?.notify?.(msg, "warning");
			}
			blocksByCwd.delete(cwd);
			return;
		}
		const msg = reminderText(status, ` [block ${next.blocks}/${MAX_BLOCKS}]`);
		try {
			// Re-prompt so the agent cannot silently settle with unmet gates
			// (Claude Stop equivalent for omp).
			pi.sendMessage?.({
				role: "user",
				content: msg,
				timestamp: Date.now(),
			});
		} catch {
			ctx?.ui?.notify?.(msg, "warning");
		}
	});

	pi.on("tool_call", async (event: any) => {
		if (event?.toolName !== "bash") return;
		const command = typeof event?.input?.command === "string" ? event.input.command : "";
		if (!command.includes("gate-check.mjs")) return;
		// Refuse approve/reverify without an explicit --root or ledger path —
		// prefer intentional cwd binding (ambient-cred safety reminder).
		const mutating = /\s--approve\b|\s--reverify\b/.test(` ${command} `);
		if (!mutating) return;
		if (/\s--root\b|\s--scope\b|\sGATES\.md\b|\sgates\//.test(command)) return;
		return {
			block: true,
			reason:
				"unlazy-guard: mutating gate-check (--approve/--reverify) must pass --root <dir> or --scope <id> " +
				"so CHECK approval binds the intended ledger. Use /unlazy-approve or /unlazy-reverify.",
		};
	});

	const runUserFacing = async (args: string[], ctx: any) => {
		const cwd = cwdOf(ctx);
		const root = skillRoot();
		if (!root) {
			ctx?.ui?.notify?.("unlazy skill not found on this host", "error");
			return;
		}
		const result = await runNode([gateCheckBin(root), ...args, "--root", cwd], cwd, 120000);
		const text = (result.stdout || result.stderr || `exit ${result.code}`).trim();
		ctx?.ui?.notify?.(text.slice(0, 500) || `exit ${result.code}`, result.code === 0 ? "info" : "warning");
		try {
			pi.appendEntry?.({
				type: "unlazy-gate-check",
				content: text,
				exitCode: result.code,
			});
		} catch {
			/* optional */
		}
	};

	pi.registerCommand?.("unlazy-status", {
		description: "Unlazy: report GATES ledger status (no CHECK execution)",
		handler: async (_args: string, ctx: any) => runUserFacing(["--status"], ctx),
	});
	pi.registerCommand?.("unlazy-reverify", {
		description: "Unlazy: reverify runnable gates (demote stale)",
		handler: async (_args: string, ctx: any) => runUserFacing(["--reverify"], ctx),
	});
	pi.registerCommand?.("unlazy-approve", {
		description: "Unlazy: approve pending oracles then run CHECKs",
		handler: async (_args: string, ctx: any) => runUserFacing(["--approve"], ctx),
	});
	pi.registerCommand?.("unlazy-scopes", {
		description: "Unlazy: list Depth Tree / .unlazy pipeline scopes",
		handler: async (_args: string, ctx: any) => {
			const text = await listScopes(cwdOf(ctx));
			ctx?.ui?.notify?.(text.slice(0, 500), "info");
		},
	});

	const z = pi.zod;
	if (pi.registerTool && z) {
		pi.registerTool({
			name: "unlazy_status",
			label: "Unlazy status",
			description:
				"Report Unlazy GATES ledger status for the current workspace (no CHECK execution). " +
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
