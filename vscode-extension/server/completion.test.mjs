import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildImportEdits, collectCompletions, inScopeNames, unusedImportRanges } from "./completion.mjs";

const labels = items => items.map(i => i.label);
const find = (items, label) => items.find(i => i.label === label);

test("declaration block offers reserved globals", () => {
	const doc = "@@@\nlet x = 1;\n@@@\n";
	const items = collectCompletions(doc, doc.indexOf("let x"), {});
	const names = labels(items);
	for (const reserved of ["document", "bold", "heading", "filePath", "JSON5"]) {
		assert.ok(names.includes(reserved), `expected reserved global ${reserved}`);
	}
});

test("declaration block surfaces names the document defines", () => {
	const doc = "@@@\nfunction greet() {}\nconst PI = 3.14;\n\n@@@\n";
	const items = collectCompletions(doc, doc.indexOf("const PI"), {});
	assert.equal(find(items, "greet")?.kind, "function");
	assert.equal(find(items, "PI")?.kind, "variable");
});

test("declaration block completions work before the closing fence is typed", () => {
	// No terminating @@@ yet — the cursor is still inside the open block.
	const doc = "@@@\nfunction half() {}\n";
	const items = collectCompletions(doc, doc.length, {});
	assert.ok(labels(items).includes("document"), "reserved globals still offered");
	assert.equal(find(items, "half")?.kind, "function");
});

test("@-call offers reserved functions and defined names, not value globals", () => {
	const doc = "@@@\nfunction greet() {}\n@@@\n\nHello @gr";
	const items = collectCompletions(doc, doc.length, {});
	const names = labels(items);
	assert.ok(names.includes("bold"), "reserved function offered");
	assert.ok(names.includes("greet"), "defined function offered");
	assert.ok(!names.includes("filePath"), "value-only globals are not call targets");
	assert.ok(!names.includes("JSON5"), "JSON5 is not a call target");
});

test("@-call reserved functions carry a parameter signature", () => {
	const items = collectCompletions("text @he", 8, {});
	assert.match(find(items, "heading")?.detail ?? "", /\(body, headingNumber\)/);
});

test("a document override shadows the reserved built-in (no duplicate)", () => {
	const doc = "@@@\nfunction bold() {}\n@@@\n\n@bo";
	const items = collectCompletions(doc, doc.length, {});
	const bolds = items.filter(i => i.label === "bold");
	assert.equal(bolds.length, 1, "exactly one `bold` entry");
	assert.equal(bolds[0].detail, "defined in document", "the document's definition wins");
});

test("@@@ and @@ do not trigger function completion", () => {
	assert.equal(collectCompletions("@@", 2, {}).length, 0, "@@ escape");
	assert.equal(collectCompletions("@@@", 3, {}).length, 0, "@@@ fence opener");
});

test("plain prose offers no completions", () => {
	assert.equal(collectCompletions("just some text", 5, {}).length, 0);
});

test("a named import resolves its bindings' kinds from the module's exports", () => {
	const dir = mkdtempSync(join(tmpdir(), "spruce-completion-"));
	try {
		writeFileSync(join(dir, "helpers.js"), [
			"export function alpha() {}",
			"export const beta = (x) => x;",
			"export const GAMMA = 42;",
			"const delta = () => {};",
			"export { delta };",
			"export default function () {}",
		].join("\n"));
		const docPath = join(dir, "doc.sp");
		const doc = '@@@\nimport { alpha, beta, GAMMA, delta } from "./helpers.js"\n@@@\n\n@a';
		const items = collectCompletions(doc, doc.length, { filePath: docPath });

		assert.equal(find(items, "alpha")?.kind, "function");
		assert.equal(find(items, "beta")?.kind, "function", "arrow const export is a function");
		assert.equal(find(items, "GAMMA")?.kind, "variable");
		assert.ok(find(items, "delta"), "re-exported binding is offered");
		assert.match(find(items, "alpha")?.detail ?? "", /imported from \.\/helpers\.js/);
	} finally {
		rmSync(dir, { recursive: true });
	}
});

test("a relative import resolves against the document's own directory", () => {
	// The helper sits at the project root; the document is in a subfolder, so the
	// import has to climb out with `../`, the way the compiler resolves it.
	const root = mkdtempSync(join(tmpdir(), "spruce-completion-"));
	try {
		writeFileSync(join(root, "helpers.js"), "export function fromRoot() {}");
		mkdirSync(join(root, "posts"));
		const docPath = join(root, "posts", "doc.sp");
		const doc = '@@@\nimport { fromRoot } from "../helpers.js"\n@@@\n\n@f';
		const items = collectCompletions(doc, doc.length, { filePath: docPath, roots: [root] });
		assert.equal(find(items, "fromRoot")?.kind, "function");
	} finally {
		rmSync(root, { recursive: true });
	}
});

test("an absolute import specifier is a filesystem path", () => {
	const root = mkdtempSync(join(tmpdir(), "spruce-completion-"));
	try {
		const libPath = join(root, "lib.js");
		writeFileSync(libPath, "export function abs() {}");
		const doc = `@@@\nimport { abs } from "${libPath}"\n@@@\n\n@a`;
		const items = collectCompletions(doc, doc.length, { filePath: join(root, "doc.sp"), roots: [root] });
		assert.equal(find(items, "abs")?.kind, "function");
	} finally {
		rmSync(root, { recursive: true });
	}
});

test("an unresolvable import is ignored without throwing", () => {
	const doc = '@@@\nimport { x } from "./missing.js"\n@@@\n\n@a';
	const items = collectCompletions(doc, doc.length, { filePath: "/some/doc.sp", roots: [] });
	assert.ok(Array.isArray(items));
});

test("auto-import specifiers are generated relative to the document's directory", () => {
	const root = mkdtempSync(join(tmpdir(), "spruce-completion-"));
	try {
		mkdirSync(join(root, "sub"));
		writeFileSync(join(root, "sub", "helper.js"), "export function gadget() {}");
		mkdirSync(join(root, "posts"));
		const docPath = join(root, "posts", "doc.sp");
		// Cursor is in @-call position, so workspace auto-imports are offered.
		const doc = "@g";
		const items = collectCompletions(doc, doc.length, { filePath: docPath, roots: [root] });
		const gadget = find(items, "gadget");
		assert.ok(gadget?.autoImport, "gadget is offered as an auto-import");
		assert.equal(gadget.autoImport.specifier, "../sub/helper.js");
	} finally {
		rmSync(root, { recursive: true });
	}
});

test("inScopeNames includes reserved names, document definitions, and imports", () => {
	const doc = '@@@\nimport { foo } from "./x.js";\nfunction bar() {}\n@@@\n';
	const names = inScopeNames(doc);
	assert.ok(names.has("heading"), "reserved stdlib name");
	assert.ok(names.has("foo"), "imported binding");
	assert.ok(names.has("bar"), "defined function");
	assert.ok(!names.has("nope"));
});

test("unusedImportRanges flags an import whose binding is never used", () => {
	const doc = '@@@\nimport { unused } from "./x.js";\n@@@\n\n# hi';
	const ranges = unusedImportRanges(doc);
	assert.equal(ranges.length, 1);
	assert.equal(doc.slice(ranges[0].start, ranges[0].end), 'import { unused } from "./x.js"');
});

test("unusedImportRanges leaves an @-call-used import alone", () => {
	const doc = '@@@\nimport { used } from "./x.js";\n@@@\n\n@used[hi]';
	assert.deepEqual(unusedImportRanges(doc), []);
});

test("unusedImportRanges ignores the binding name appearing as prose/parsed-block text", () => {
	// `debug` shows up as ordinary text inside the parsed block (a /debug/ URL), but
	// there's no `@debug` call, so the import is unused despite the textual matches.
	const doc = [
		'@@@',
		'import { debug } from "./x.js";',
		'@@@',
		'',
		'@other[[',
		'\t<a href="/debug/htmdl-docs">HTMDL Documentation</a>',
		'\t<a href="/debug/glsl-docs">GLSL Docs</a>',
		']]',
	].join("\n");
	const ranges = unusedImportRanges(doc);
	assert.equal(ranges.length, 1);
	assert.equal(doc.slice(ranges[0].start, ranges[0].end), 'import { debug } from "./x.js"');
});

test("unusedImportRanges counts an @-call use even with the name elsewhere as text", () => {
	const doc = [
		'@@@',
		'import { debug } from "./x.js";',
		'@@@',
		'',
		'@debug[[',
		'\t<a href="/debug/htmdl-docs">HTMDL Documentation</a>',
		']]',
	].join("\n");
	assert.deepEqual(unusedImportRanges(doc), []);
});

test("unusedImportRanges leaves an import used only in declaration JS alone", () => {
	const doc = '@@@\nimport { helper } from "./x.js";\nfunction wrap(x) { return helper(x); }\n@@@\n';
	assert.deepEqual(unusedImportRanges(doc), []);
});

test("unusedImportRanges dims only the unused binding when an import is partly used", () => {
	const doc = '@@@\nimport { used, dead } from "./x.js";\n@@@\n\n@used[hi]';
	const ranges = unusedImportRanges(doc);
	assert.equal(ranges.length, 1);
	assert.equal(doc.slice(ranges[0].start, ranges[0].end), "dead");
});

test("unusedImportRanges dims an aliased unused binding at its alias", () => {
	const doc = '@@@\nimport { used, orig as dead } from "./x.js";\n@@@\n\n@used[hi]';
	const ranges = unusedImportRanges(doc);
	assert.equal(ranges.length, 1);
	assert.equal(doc.slice(ranges[0].start, ranges[0].end), "dead");
});

// Apply offset-based edits (all pure inserts here) right-to-left so earlier
// offsets stay valid as we splice.
function applyEdits(text, edits) {
	let out = text;
	for (const e of [...edits].sort((a, b) => b.start - a.start)) {
		out = out.slice(0, e.start) + e.newText + out.slice(e.end);
	}
	return out;
}

test("buildImportEdits creates a new block with no trailing blank line inside", () => {
	const doc = "# hi";
	const out = applyEdits(doc, buildImportEdits(doc, "./x.js", "foo"));
	assert.equal(out, '@@@\n\timport { foo } from "./x.js";\n@@@\n\n# hi');
});

test("buildImportEdits opens a blank line between a new import and following code", () => {
	const doc = '@@@\nconst x = 1;\n@@@\n';
	const out = applyEdits(doc, buildImportEdits(doc, "./x.js", "foo"));
	assert.equal(out, '@@@\n\timport { foo } from "./x.js";\n\nconst x = 1;\n@@@\n');
});

test("buildImportEdits keeps the single blank line when one already exists", () => {
	const doc = '@@@\nimport { a } from "./a.js";\n\nconst x = 1;\n@@@\n';
	const out = applyEdits(doc, buildImportEdits(doc, "./x.js", "foo"));
	assert.equal(
		out,
		'@@@\nimport { a } from "./a.js";\n\timport { foo } from "./x.js";\n\nconst x = 1;\n@@@\n',
	);
});

test("buildImportEdits adds no blank line when the block has no non-import statement", () => {
	const doc = '@@@\nimport { a } from "./a.js";\n@@@\n';
	const out = applyEdits(doc, buildImportEdits(doc, "./x.js", "foo"));
	assert.equal(out, '@@@\nimport { a } from "./a.js";\n\timport { foo } from "./x.js";\n@@@\n');
});

test("buildImportEdits separates an extended group from following code", () => {
	const doc = '@@@\nimport { a } from "./x.js";\nconst y = 1;\n@@@\n';
	const out = applyEdits(doc, buildImportEdits(doc, "./x.js", "foo"));
	assert.equal(out, '@@@\nimport { a, foo } from "./x.js";\n\nconst y = 1;\n@@@\n');
});

test("buildImportEdits is a no-op when the name is already imported", () => {
	const doc = '@@@\nimport { foo } from "./x.js";\n@@@\n';
	assert.deepEqual(buildImportEdits(doc, "./x.js", "foo"), []);
});
