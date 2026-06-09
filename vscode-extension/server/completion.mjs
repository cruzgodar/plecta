// Completion logic for the Spruce language server, kept as a pure module (no LSP
// types) so it can be unit-tested directly; server.mjs maps the neutral items
// returned here onto LSP CompletionItems. Like tokenizer.mjs, this leans on the
// vendored stdlib.js copy (build-and-install.sh keeps it fresh).
//
// Two completion contexts, matching how names resolve at compile time:
//   * Inside a `@@@ ... @@@` declaration block the body is plain JS, so bare
//     identifiers fall through to globalThis — we offer the reserved globals
//     (the format stdlib plus include/filePath/JSON5) alongside anything the
//     document has already defined or included.
//   * After an `@` function call we offer the reserved *functions* (the stdlib
//     renderers) plus the document's defined/included names, since `@name`
//     invokes whatever `name` resolves to in module scope.
import { readFileSync } from "fs";
import { dirname, resolve as resolvePath } from "path";
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

// Format-independent globals splatted by spruce.js's _compileImpl: include() (a
// function), filePath (the document's absolute path), and JSON5 (the parser used
// for json-block arguments). Kept in step with the setGlobal calls there.
const EXTRA_GLOBALS = [
	{ label: "include", kind: "function", detail: "(specifier) — import a helper module's exports" },
	{ label: "filePath", kind: "constant", detail: "absolute path of the current document" },
	{ label: "JSON5", kind: "module", detail: "JSON5 parser" },
];

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

// Bodies of every `@@@ ... @@@` declaration block, as { start, end } offsets into
// `text` (the range between the opener line's newline and the closer line). The
// scan is line-based so it survives a document that doesn't fully parse mid-edit.
// A bare `@@@` line closes a block; a `@@@tag` line while already inside both
// closes the current block and opens the next (the grammar's soft terminator).
// An unterminated trailing block runs to end-of-document so completion still
// works while the closing fence is being typed.
function declarationBodies(text) {
	const bodies = [];
	const fence = /^[ \t]*@@@[ \t]*([A-Za-z0-9]*)[ \t]*$/;
	let inside = false;
	let bodyStart = -1;
	let pos = 0;
	for (const line of text.split("\n")) {
		const lineStart = pos;
		const nextStart = pos + line.length + 1; // +1 for the consumed "\n"
		// Strip a trailing "\r" so CRLF documents still match the fence regex.
		const m = fence.exec(line.replace(/\r$/, ""));
		if (m) {
			const tag = m[1];
			if (!inside) {
				inside = true;
				bodyStart = nextStart;
			} else if (tag === "") {
				bodies.push({ start: bodyStart, end: lineStart });
				inside = false;
			} else {
				bodies.push({ start: bodyStart, end: lineStart });
				bodyStart = nextStart;
			}
		}
		pos = nextStart;
	}
	if (inside) bodies.push({ start: bodyStart, end: text.length });
	return bodies;
}

function inDeclarationBlock(text, offset) {
	return declarationBodies(text).some(b => offset >= b.start && offset <= b.end);
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
const INCLUDE_CALL = /\binclude\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g;

// Names the document defines: top-level function/const declarations in any
// declaration block, plus every export pulled in by an include() call. Returned
// as a name -> item Map so callers can dedupe against reserved names; functions
// win over plain variables when a name appears both ways.
function definedNames(text, filePath) {
	const items = new Map();
	const add = (name, kind, detail) => {
		const existing = items.get(name);
		if (existing && (existing.kind === "function" || kind !== "function")) return;
		items.set(name, { label: name, kind, detail });
	};

	for (const { start, end } of declarationBodies(text)) {
		const body = text.slice(start, end);
		for (const m of body.matchAll(FUNC_DECL)) add(m[1], "function", "defined in document");
		for (const m of body.matchAll(VAR_FUNC)) add(m[1], "function", "defined in document");
		for (const m of body.matchAll(VAR_ANY)) add(m[1], "variable", "defined in document");
	}

	for (const m of text.matchAll(INCLUDE_CALL)) {
		for (const exp of includedExports(m[1], filePath)) {
			add(exp.label, exp.kind, `included from ${m[1]}`);
		}
	}

	return items;
}

// Statically read the named exports of an included module without executing it
// (the LSP must stay side-effect-free): function/const exports and re-export
// lists. Absolute "/x" specifiers need the --root the editor doesn't know about,
// so they're skipped; default exports aren't usable as bare names.
function includedExports(specifier, filePath) {
	if (!filePath || specifier.startsWith("/")) return [];

	let src;
	try {
		src = readFileSync(resolvePath(dirname(filePath), specifier), "utf8");
	} catch {
		return [];
	}

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

// Merge reserved items with the document's defined names, dropping any reserved
// entry the document redefines (a user override shadows the built-in).
function withDefined(reserved, defined) {
	const out = reserved.filter(item => !defined.has(item.label));
	return out.concat([...defined.values()]);
}

// Returns neutral completion items ({ label, kind, detail }) for the cursor at
// `offset`, or [] when the cursor isn't in a completion context.
export function collectCompletions(text, offset, { filePath = null } = {}) {
	const defined = definedNames(text, filePath);

	if (inDeclarationBlock(text, offset)) {
		return withDefined(reservedGlobalItems(), defined);
	}

	if (callPrefix(text, offset) !== null) {
		return withDefined(reservedFunctionItems(), defined);
	}

	return [];
}
