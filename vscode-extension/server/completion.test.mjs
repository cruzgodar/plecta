import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildImportEdits, collectCompletions } from "./completion.mjs";

const labels = items => items.map(i => i.label);
const find = (items, label) => items.find(i => i.label === label);

test("declaration block offers reserved globals", () => {
	const doc = "@@@\nlet x = 1;\n@@@\n";
	const items = collectCompletions(doc, doc.indexOf("let x"), {});
	const names = labels(items);
	for (const reserved of ["document", "bold", "heading", "include", "filePath", "JSON5"]) {
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

test("include() pulls in a module's exports", () => {
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
		const doc = '@@@\ninclude("./helpers.js")\n@@@\n\n@a';
		const items = collectCompletions(doc, doc.length, { filePath: docPath });

		assert.equal(find(items, "alpha")?.kind, "function");
		assert.equal(find(items, "beta")?.kind, "function", "arrow const export is a function");
		assert.equal(find(items, "GAMMA")?.kind, "variable");
		assert.ok(find(items, "delta"), "re-exported name is included");
		assert.ok(!find(items, "default"), "default export is not a bare name");
		assert.match(find(items, "alpha")?.detail ?? "", /included from \.\/helpers\.js/);
	} finally {
		rmSync(dir, { recursive: true });
	}
});

test("a relative include resolves against a workspace root, not just the doc dir", () => {
	// The helper sits at the project root; the document is in a subfolder and
	// includes it the way the spruce CLI (run from the root) would resolve it.
	const root = mkdtempSync(join(tmpdir(), "spruce-completion-"));
	try {
		writeFileSync(join(root, "helpers.js"), "export function fromRoot() {}");
		const docPath = join(root, "posts", "doc.sp");
		const doc = '@@@\ninclude("./helpers.js")\n@@@\n\n@f';
		const items = collectCompletions(doc, doc.length, { filePath: docPath, roots: [root] });
		assert.equal(find(items, "fromRoot")?.kind, "function");
	} finally {
		rmSync(root, { recursive: true });
	}
});

test("an absolute include specifier resolves against the workspace root", () => {
	const root = mkdtempSync(join(tmpdir(), "spruce-completion-"));
	try {
		writeFileSync(join(root, "lib.js"), "export function abs() {}");
		const doc = '@@@\ninclude("/lib.js")\n@@@\n\n@a';
		const items = collectCompletions(doc, doc.length, { filePath: join(root, "doc.sp"), roots: [root] });
		assert.equal(find(items, "abs")?.kind, "function");
	} finally {
		rmSync(root, { recursive: true });
	}
});

test("an unresolvable include is ignored without throwing", () => {
	const doc = '@@@\ninclude("/lib/x.js")\n@@@\n\n@a';
	const items = collectCompletions(doc, doc.length, { filePath: "/some/doc.sp", roots: [] });
	assert.ok(Array.isArray(items));
});
