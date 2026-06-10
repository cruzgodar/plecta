// Completion logic for the Spruce language server, kept as a pure module (no LSP
// types) so it can be unit-tested directly; server.mjs maps the neutral items
// returned here onto LSP CompletionItems. Like tokenizer.mjs, this leans on the
// vendored stdlib.js copy (build-and-install.sh keeps it fresh).
//
// Completion contexts, matching how names resolve at compile time:
//   * Inside a `@@@ ... @@@` declaration block the body is plain JS, so bare
//     identifiers fall through to globalThis — we offer the reserved globals
//     (the format stdlib plus filePath/JSON5) alongside anything the document
//     has already defined or imported.
//   * After an `@` function call we offer the reserved *functions* (the stdlib
//     renderers) plus the document's defined/imported names, since `@name`
//     invokes whatever `name` resolves to in module scope.
// In both contexts we also offer exports from any *not-yet-imported* JS file in
// the workspace; accepting one carries an auto-import edit (see buildImportEdits)
// that adds the ESM import to a declaration block.
import { readdirSync, readFileSync } from "fs";
import { dirname, join, relative, resolve as resolvePath, sep } from "path";
import { stdlib } from "./stdlib.js";

// Reserved names split by whether they're callable. Derived from the stdlib so
// new format functions show up automatically; unioned across formats because a
// document's output format isn't known while editing (the keys overlap anyway).
const reservedFunctions = new Map(); // name -> signature string, e.g. "(body)"
const reservedConstants = new Set(); // non-function stdlib names ($ and _)
for (const format of Object.values(stdlib)) {
	for (const [name, value] of Object.entries(format)) {
		if (typeof value === "function") {
			if (!reservedFunctions.has(name)) reservedFunctions.set(name, signatureOf(value));
		} else {
			reservedConstants.add(name);
		}
	}
}

// Format-independent globals splatted by spruce.js's _compileImpl: filePath (the
// document's absolute path) and JSON5 (the parser used for json-block arguments).
// Kept in step with the setGlobal calls there.
const EXTRA_GLOBALS = [
	{ label: "filePath", kind: "constant", detail: "absolute path of the current document" },
	{ label: "JSON5", kind: "module", detail: "JSON5 parser" },
];

// Every reserved name, regardless of context — used to keep auto-import
// suggestions from shadowing a built-in that's already in scope.
const RESERVED_NAMES = new Set([
	...reservedFunctions.keys(),
	...reservedConstants,
	...EXTRA_GLOBALS.map(g => g.label),
]);

// Pull the parameter list out of a function's source for display, e.g. a stdlib
// method `heading(body, headingNumber) { ... }` -> "(body, headingNumber)".
function signatureOf(fn) {
	const src = Function.prototype.toString.call(fn);
	const m = /^[^(]*\(([\s\S]*?)\)/.exec(src);
	return m ? `(${m[1].replace(/\s+/g, " ").trim()})` : "()";
}

function reservedGlobalItems() {
	const items = [];
	for (const [name, sig] of reservedFunctions) {
		items.push({ label: name, kind: "function", detail: `reserved ${sig}` });
	}
	for (const name of reservedConstants) {
		items.push({ label: name, kind: "constant", detail: "reserved" });
	}
	return items.concat(EXTRA_GLOBALS);
}

function reservedFunctionItems() {
	return [...reservedFunctions].map(([name, sig]) => ({ label: name, kind: "function", detail: `reserved ${sig}` }));
}

// Every `@@@ ... @@@` declaration block, as offsets into `text`: `openerStart`
// (start of the opener line), `bodyStart`/`bodyEnd` (the JS body between the
// opener line's newline and the closer line), and `tag` (the format after `@@@`,
// "" for a non-targeted block). The scan is line-based so it survives a document
// that doesn't fully parse mid-edit. A bare `@@@` line closes a block; a `@@@tag`
// line while already inside both closes the current block and opens the next (the
// grammar's soft terminator). An unterminated trailing block runs to end of
// document so completion still works while the closing fence is being typed.
function declarationBlocks(text) {
	const blocks = [];
	const fence = /^[ \t]*@@@[ \t]*([A-Za-z0-9]*)[ \t]*$/;
	let open = null;
	let pos = 0;
	for (const line of text.split("\n")) {
		const lineStart = pos;
		const nextStart = pos + line.length + 1; // +1 for the consumed "\n"
		// Strip a trailing "\r" so CRLF documents still match the fence regex.
		const m = fence.exec(line.replace(/\r$/, ""));
		if (m) {
			const tag = m[1];
			if (!open) {
				open = { openerStart: lineStart, bodyStart: nextStart, tag };
			} else if (tag === "") {
				blocks.push({ ...open, bodyEnd: lineStart });
				open = null;
			} else {
				blocks.push({ ...open, bodyEnd: lineStart });
				open = { openerStart: lineStart, bodyStart: nextStart, tag };
			}
		}
		pos = nextStart;
	}
	if (open) blocks.push({ ...open, bodyEnd: text.length });
	return blocks;
}

function inDeclarationBlock(text, offset) {
	return declarationBlocks(text).some(b => offset >= b.bodyStart && offset <= b.bodyEnd);
}

// The identifier prefix of a `@name` call ending at `offset`, or null when the
// cursor isn't in call position. Rejects `@@@` (declaration fence) and `@@`
// (escaped @) so those don't trigger function completion.
function callPrefix(text, offset) {
	let i = offset;
	while (i > 0 && /[A-Za-z0-9_$]/.test(text[i - 1])) i--;
	if (text[i - 1] !== "@") return null;
	if (text[i - 2] === "@") return null;
	return text.slice(i, offset);
}

const FUNC_DECL = /(?:^|[\s;}])(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g;
const VAR_FUNC = /(?:^|[\s;}])(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g;
const VAR_ANY = /(?:^|[\s;}])(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g;
const IMPORT_STMT = /\bimport\s+([^;'"]*?)\s+from\s*["']([^"']+)["']/g;

// Names the document makes available in module scope: top-level function/const
// declarations in any declaration block, and every binding of an
// `import ... from` statement. Returned as a name -> item Map so callers can
// dedupe; functions win over plain variables when a name appears both ways.
function definedNames(text, filePath, roots) {
	const items = new Map();
	const add = (name, kind, detail) => {
		const existing = items.get(name);
		if (existing && (existing.kind === "function" || kind !== "function")) return;
		items.set(name, { label: name, kind, detail });
	};

	for (const { bodyStart, bodyEnd } of declarationBlocks(text)) {
		const body = text.slice(bodyStart, bodyEnd);
		for (const m of body.matchAll(FUNC_DECL)) add(m[1], "function", "defined in document");
		for (const m of body.matchAll(VAR_FUNC)) add(m[1], "function", "defined in document");
		for (const m of body.matchAll(VAR_ANY)) add(m[1], "variable", "defined in document");

		for (const m of body.matchAll(IMPORT_STMT)) {
			const kinds = new Map(moduleExports(m[2], filePath, roots).map(e => [e.label, e.kind]));
			for (const { local, imported } of parseImportClause(m[1])) {
				const kind = imported && imported !== "default" ? (kinds.get(imported) ?? "variable") : "variable";
				add(local, kind, `imported from ${m[2]}`);
			}
		}
	}

	return items;
}

// Every name that resolves in `text`'s module scope: the reserved stdlib names
// (functions, constants, and injected globals) plus everything the document
// defines or imports. A bare `@name` call whose name isn't in this set resolves
// to nothing, so the tokenizer flags it as an undefined function. Name-only and
// side-effect-free (no module exports are read), so it's cheap to call per edit.
export function inScopeNames(text) {
	const names = new Set(RESERVED_NAMES);
	for (const name of definedNames(text, null, []).keys()) names.add(name);
	return names;
}

// The source ranges (absolute offsets) of import statements whose every binding
// is unused — i.e. the local name never appears anywhere outside the import
// statements themselves (not as an `@name` call, not referenced in declaration
// JS). The server marks these with the Unnecessary tag so VSCode dims them, the
// way it grays an unused JS import. Statement-level (not per-binding): an import
// is dimmed only when all of its bindings are unused, which is the common case
// for the single-binding imports the auto-import edit produces.
export function unusedImportRanges(text) {
	const stmts = [];
	for (const { bodyStart, bodyEnd } of declarationBlocks(text)) {
		const body = text.slice(bodyStart, bodyEnd);
		for (const m of body.matchAll(IMPORT_STMT)) {
			const start = bodyStart + m.index;
			stmts.push({ start, end: start + m[0].length, locals: parseImportClause(m[1]).map(b => b.local) });
		}
	}
	if (stmts.length === 0) return [];

	// Blank out every import statement so a binding only counts as "used" when it
	// occurs somewhere other than an import (an @-call or a JS reference).
	const chars = text.split("");
	for (const s of stmts) for (let i = s.start; i < s.end; i++) chars[i] = " ";
	const masked = chars.join("");

	const ranges = [];
	for (const s of stmts) {
		const allUnused = s.locals.length > 0
			&& s.locals.every(name => !new RegExp(`\\b${escapeRe(name)}\\b`).test(masked));
		if (allUnused) ranges.push({ start: s.start, end: s.end });
	}
	return ranges;
}

// Local bindings introduced by an `import` clause (the text between `import` and
// `from`), each as { local, imported }: `imported` is the source export name,
// "default" for a default import, or null for a `* as ns` namespace import.
function parseImportClause(clause) {
	const bindings = [];
	const ns = /\*\s+as\s+([\w$]+)/.exec(clause);
	if (ns) bindings.push({ local: ns[1], imported: null });

	const group = /\{([^}]*)\}/.exec(clause);
	if (group) {
		for (const part of group[1].split(",")) {
			const seg = /^\s*([\w$]+)(?:\s+as\s+([\w$]+))?\s*$/.exec(part);
			if (seg) bindings.push({ local: seg[2] || seg[1], imported: seg[1] });
		}
	}

	const head = clause.replace(/\{[^}]*\}/, "").replace(/\*\s+as\s+[\w$]+/, "").replace(/,/g, " ").trim();
	const def = /^([\w$]+)$/.exec(head);
	if (def) bindings.push({ local: def[1], imported: "default" });

	return bindings;
}

// The filesystem paths an import specifier might resolve to, mirroring how the
// compiler resolves a declaration block's imports (see importHooks.js): a
// relative specifier resolves against the cwd spruce runs from — which the
// editor can't know, so we try the document's own directory and every workspace
// root — and an absolute "/x" specifier resolves against a root (the compiler's
// --root). Bare specifiers (node packages) are left to default resolution and
// skipped here.
function importCandidates(specifier, filePath, roots) {
	if (specifier.startsWith("/")) {
		return roots.map(root => join(root, specifier));
	}
	if (specifier.startsWith(".")) {
		const bases = [];
		if (filePath) bases.push(dirname(filePath));
		bases.push(...roots);
		return bases.map(base => resolvePath(base, specifier));
	}
	return [];
}

// Resolve a specifier to a file and statically read its named exports, or [] if
// it can't be resolved/read. Wraps extractExports for the import code path.
function moduleExports(specifier, filePath, roots) {
	for (const candidate of importCandidates(specifier, filePath, roots)) {
		try {
			return extractExports(readFileSync(candidate, "utf8"));
		} catch {
			// Try the next candidate base.
		}
	}
	return [];
}

// Statically read a module's named exports without executing it (the LSP must
// stay side-effect-free): function/const exports and re-export lists. Default
// exports aren't usable as bare names, so they're dropped.
function extractExports(src) {
	const items = new Map();
	for (const m of src.matchAll(/export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g)) {
		items.set(m[1], { label: m[1], kind: "function" });
	}
	for (const m of src.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)?/g)) {
		if (!items.has(m[1])) items.set(m[1], { label: m[1], kind: m[2] ? "function" : "variable" });
	}
	for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
		for (const part of m[1].split(",")) {
			const seg = /^\s*([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(part);
			if (!seg) continue;
			const name = seg[2] || seg[1];
			if (name === "default" || items.has(name)) continue;
			items.set(name, { label: name, kind: "function" });
		}
	}
	return [...items.values()];
}

// --- Workspace scan for auto-import candidates -----------------------------

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", "coverage"]);
const MAX_FILES = 1500;

// A `./`-relative specifier from a workspace root to a file, using POSIX
// separators (what an ESM import wants). Imports inside a declaration block
// resolve against the cwd spruce runs from — normally the workspace root — so a
// root-relative path is the cwd-stable choice.
function relSpecifier(root, file) {
	let rel = relative(root, file).split(sep).join("/");
	if (!rel.startsWith(".")) rel = "./" + rel;
	return rel;
}

function walkJsFiles(dir, root, out, budget) {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (budget.count >= MAX_FILES) return;
		if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (!SKIP_DIRS.has(entry.name)) walkJsFiles(full, root, out, budget);
		} else if (entry.isFile() && /\.(mjs|cjs|js)$/.test(entry.name)) {
			budget.count++;
			let src;
			try {
				src = readFileSync(full, "utf8");
			} catch {
				continue;
			}
			const specifier = relSpecifier(root, full);
			for (const exp of extractExports(src)) {
				out.push({ label: exp.label, kind: exp.kind, specifier });
			}
		}
	}
}

// Walking the tree on every keystroke would be wasteful; the client filters a
// returned list locally as the user types, so a short TTL cache is plenty.
let exportCache = { key: null, time: 0, items: [] };

function collectWorkspaceExports(roots) {
	const key = roots.join("\0");
	const now = Date.now();
	if (exportCache.key === key && now - exportCache.time < 5000) return exportCache.items;

	const items = [];
	const budget = { count: 0 };
	for (const root of roots) walkJsFiles(root, root, items, budget);

	exportCache = { key, time: now, items };
	return items;
}

// --- Auto-import edit -------------------------------------------------------

function escapeRe(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// One indentation step for the document, inferred from the first indented line:
// a leading tab means tabs (one tab per step), otherwise the leading run of
// spaces is taken as one step. Falls back to a single tab when nothing in the
// document is indented yet.
function detectIndent(text) {
	const m = /^([ \t]+)\S/m.exec(text);
	if (!m) return "\t";
	return m[1][0] === "\t" ? "\t" : m[1];
}

// The text edits (offset-based, for server.mjs to turn into LSP TextEdits) that
// add `import { name } from "<specifier>"` to the document. Per the requested
// behavior we always target a *non-targeted* (`@@@` with no format) declaration
// block: extend an existing import from the same specifier, else add an import
// line at the top of the first such block, else create a new block at the top of
// the document. Returns [] when the name is already imported from that specifier.
export function buildImportEdits(text, specifier, name) {
	const blocks = declarationBlocks(text).filter(b => b.tag === "");
	const indent = detectIndent(text);
	const importLine = `${indent}import { ${name} } from "${specifier}";`;

	if (blocks.length === 0) {
		return [{ start: 0, end: 0, newText: `@@@\n${importLine}\n@@@\n\n` }];
	}

	const importRe = new RegExp(`import\\s+(?:[\\w$]+\\s*,\\s*)?\\{([^}]*)\\}\\s*from\\s*["']${escapeRe(specifier)}["']`);
	for (const block of blocks) {
		const body = text.slice(block.bodyStart, block.bodyEnd);
		const m = importRe.exec(body);
		if (!m) continue;

		if (new RegExp(`\\b${escapeRe(name)}\\b`).test(m[1])) return []; // already imported

		// Insert into the existing named group, just after its last binding.
		const groupStart = m.index + m[0].indexOf("{") + 1;
		const braceRel = m.index + m[0].indexOf("}");
		let k = braceRel;
		while (k > groupStart && /\s/.test(body[k - 1])) k--;
		const at = block.bodyStart + k;
		const newText = k > groupStart ? `, ${name}` : `${name} `;
		return [{ start: at, end: at, newText }];
	}

	// No import from this specifier yet: add one at the top of the first block.
	return [{ start: blocks[0].bodyStart, end: blocks[0].bodyStart, newText: `${importLine}\n` }];
}

// Merge reserved items with the document's defined names, dropping any reserved
// entry the document redefines (a user override shadows the built-in).
function withDefined(reserved, defined) {
	const out = reserved.filter(item => !defined.has(item.label));
	return out.concat([...defined.values()]);
}

// Workspace exports for names not already in scope, deduped by name+specifier so
// the same symbol from two files stays distinguishable. Each carries `autoImport`
// (the specifier) so the server can attach the import edit on accept.
function autoImportItems(defined, roots) {
	const seen = new Set();
	const items = [];
	for (const exp of collectWorkspaceExports(roots)) {
		if (RESERVED_NAMES.has(exp.label) || defined.has(exp.label)) continue;
		const key = `${exp.label}\0${exp.specifier}`;
		if (seen.has(key)) continue;
		seen.add(key);
		items.push({
			label: exp.label,
			kind: exp.kind,
			detail: `auto-import from ${exp.specifier}`,
			autoImport: { specifier: exp.specifier },
		});
	}
	return items;
}

// Returns neutral completion items for the cursor at `offset`, or [] when the
// cursor isn't in a completion context. Auto-import items carry an `autoImport`
// field; the rest are plain { label, kind, detail }.
export function collectCompletions(text, offset, { filePath = null, roots = [] } = {}) {
	const defined = definedNames(text, filePath, roots);

	let items;
	if (inDeclarationBlock(text, offset)) {
		items = withDefined(reservedGlobalItems(), defined);
	} else if (callPrefix(text, offset) !== null) {
		items = withDefined(reservedFunctionItems(), defined);
	} else {
		return [];
	}

	return items.concat(autoImportItems(defined, roots));
}
