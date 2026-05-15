import { test } from "node:test";
import assert from "node:assert/strict";
import { collectTokens, tokenize } from "./tokenizer.mjs";

test("heading line emits a single heading token over the whole line", () => {
	const tokens = collectTokens("# Hello\n");
	const heading = tokens.find(t => t.type === "heading");
	assert.ok(heading);
	assert.equal(heading.start, 0);
	// Heading spans "# Hello" (no trailing newline).
	assert.equal(heading.end, 7);
});

test("bold span emits a single bold token covering the whole span", () => {
	const tokens = collectTokens("**hi**");
	const bold = tokens.filter(t => t.type === "bold");
	assert.equal(bold.length, 1);
	assert.equal(bold[0].start, 0);
	assert.equal(bold[0].end, 6);
});

test("italic span emits a single italic token", () => {
	const tokens = collectTokens("*hi*");
	const it = tokens.find(t => t.type === "italic");
	assert.ok(it);
	assert.equal(it.start, 0);
	assert.equal(it.end, 4);
});

test("***bold italic*** emits a boldItalic token", () => {
	const tokens = collectTokens("***hi***");
	const bi = tokens.find(t => t.type === "boldItalic");
	assert.ok(bi);
});

test("inline `code` emits inlineCode, codeBlock emits codeBlock", () => {
	const inline = collectTokens("`x`");
	assert.ok(inline.find(t => t.type === "inlineCode"));

	const block = collectTokens("```\nfoo\n```\n");
	assert.ok(block.find(t => t.type === "codeBlock"));
});

test("@name[body] colors @ and name as function, body recurses", () => {
	const tokens = collectTokens("@name[body]");
	const fns = tokens.filter(t => t.type === "function");
	// One for the @, one for the identifier `name`.
	assert.ok(fns.length >= 2);
	assert.equal(fns[0].start, 0);
	assert.equal(fns[0].end, 1);
});

test("raw block content is string, with function-call gaps preserved", () => {
	// @outer{ raw stuff @inner[x] more } — outer is functionCall_raw.
	const tokens = collectTokens("@outer{ raw @inner[x] more }");
	const strings = tokens.filter(t => t.type === "string");
	const fns = tokens.filter(t => t.type === "function");
	assert.ok(strings.length >= 1, "expected at least one string token in raw block");
	// The inner @ and identifier should still emit function tokens.
	assert.ok(fns.find(t => t.start > 6 && t.end <= 20), "expected inner function tokens preserved");
	// No string token should overlap a function token.
	for (const s of strings) {
		for (const f of fns) {
			const overlap = s.start < f.end && f.start < s.end;
			assert.ok(!overlap, `string ${JSON.stringify(s)} overlaps function ${JSON.stringify(f)}`);
		}
	}
});

test("list marker `- ` emits a list token", () => {
	const tokens = collectTokens("- item\n");
	const list = tokens.find(t => t.type === "list");
	assert.ok(list);
	assert.equal(list.end - list.start, 1);
});

test("ordered list starter `1.` emits a list token", () => {
	const tokens = collectTokens("1. item\n");
	const list = tokens.find(t => t.type === "list");
	assert.ok(list);
});

test("tokenize returns delta-encoded data array", () => {
	const data = tokenize("# Hi\n");
	assert.ok(Array.isArray(data));
	assert.equal(data.length % 5, 0);
	assert.ok(data.length >= 5);
});

test("failed parse yields empty token list", () => {
	const tokens = collectTokens("unterminated `code");
	assert.deepEqual(tokens, []);
});
