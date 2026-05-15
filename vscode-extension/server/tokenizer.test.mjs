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

test("bold splits into marker + bold + marker", () => {
	const tokens = collectTokens("**hi**");
	const markers = tokens.filter(t => t.type === "marker");
	const bold = tokens.find(t => t.type === "bold");
	assert.equal(markers.length, 2);
	assert.equal(markers[0].start, 0); assert.equal(markers[0].end, 2);
	assert.equal(markers[1].start, 4); assert.equal(markers[1].end, 6);
	assert.equal(bold.start, 2); assert.equal(bold.end, 4);
});

test("italic splits into marker + italic + marker (1-char markers)", () => {
	const tokens = collectTokens("*hi*");
	const markers = tokens.filter(t => t.type === "marker");
	const it = tokens.find(t => t.type === "italic");
	assert.equal(markers.length, 2);
	assert.equal(markers[0].end - markers[0].start, 1);
	assert.equal(it.start, 1); assert.equal(it.end, 3);
});

test("***boldItalic*** has 3-char markers and inner boldItalic", () => {
	const tokens = collectTokens("***hi***");
	const markers = tokens.filter(t => t.type === "marker");
	assert.equal(markers.length, 2);
	assert.equal(markers[0].end - markers[0].start, 3);
	assert.ok(tokens.find(t => t.type === "boldItalic"));
});

test("inline `code` splits backticks + content", () => {
	const tokens = collectTokens("`x`");
	const markers = tokens.filter(t => t.type === "marker");
	const code = tokens.find(t => t.type === "inlineCode");
	assert.equal(markers.length, 2);
	assert.equal(code.start, 1); assert.equal(code.end, 2);
});

test("fenced ``` ... ``` block splits triple-backticks + body", () => {
	const tokens = collectTokens("```\nfoo\n```\n");
	const markers = tokens.filter(t => t.type === "marker");
	const body = tokens.find(t => t.type === "codeBlock");
	assert.equal(markers.length, 2);
	assert.equal(markers[0].end - markers[0].start, 3);
	assert.equal(markers[1].end - markers[1].start, 3);
	assert.ok(body);
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
