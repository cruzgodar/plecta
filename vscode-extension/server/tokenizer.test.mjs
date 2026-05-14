import { test } from "node:test";
import assert from "node:assert/strict";
import { collectTokens, tokenize } from "./tokenizer.mjs";

test("heading hashes produce a keyword token", () => {
	const tokens = collectTokens("# Hello\n");
	const heading = tokens.find(t => t.type === "keyword" && t.start === 0);
	assert.ok(heading, "expected a keyword token at offset 0");
	assert.equal(heading.end, 1);
});

test("bold markers produce two macro tokens", () => {
	const tokens = collectTokens("**hi**");
	const macros = tokens.filter(t => t.type === "macro");
	assert.equal(macros.length, 2);
	assert.equal(macros[0].start, 0);
	assert.equal(macros[0].end, 2);
	assert.equal(macros[1].start, 4);
	assert.equal(macros[1].end, 6);
});

test("inline code produces a string token spanning the whole span", () => {
	const tokens = collectTokens("`x`");
	const code = tokens.find(t => t.type === "string");
	assert.ok(code);
	assert.equal(code.start, 0);
	assert.equal(code.end, 3);
});

test("function call @name[body] colors @ and name", () => {
	const tokens = collectTokens("@name[body]");
	const at = tokens.find(t => t.type === "operator" && t.start === 0);
	const ident = tokens.find(t => t.type === "function");
	assert.ok(at);
	assert.ok(ident);
	assert.equal(ident.start, 1);
	assert.equal(ident.end, 5);
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
