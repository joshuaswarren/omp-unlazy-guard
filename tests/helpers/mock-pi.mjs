export function createMockPi() {
	const handlers = new Map();
	const commands = new Map();
	const messages = [];
	const entries = [];
	const notifies = [];
	const statuses = [];
	const tools = [];

	return {
		handlers,
		commands,
		messages,
		entries,
		notifies,
		statuses,
		tools,
		zod: {
			object: (shape) => ({ shape, optional: () => ({}) }),
			string: () => ({ optional: () => ({ describe: () => ({}) }) }),
		},
		on(name, fn) {
			handlers.set(name, fn);
		},
		sendMessage(message, options) {
			messages.push({ message, options });
		},
		appendEntry(entry) {
			entries.push(entry);
		},
		registerCommand(name, spec) {
			commands.set(name, spec);
		},
		registerTool(spec) {
			tools.push(spec);
		},
		ctx(cwd) {
			return {
				cwd,
				ui: {
					notify(text, level) {
						notifies.push({ text, level });
					},
					setStatus(key, value) {
						statuses.push({ key, value });
					},
				},
			};
		},
		async emit(name, event, ctx) {
			const fn = handlers.get(name);
			if (!fn) throw new Error(`no handler for ${name}`);
			return fn(event, ctx);
		},
	};
}
