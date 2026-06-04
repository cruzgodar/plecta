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

test("inline `code` splits backticks + content (backticks are string)", () => {
	const tokens = collectTokens("`x`");
	const strings = tokens.filter(t => t.type === "string");
	const code = tokens.find(t => t.type === "inlineCode");
	assert.equal(strings.length, 2);
	assert.equal(strings[0].start, 0); assert.equal(strings[0].end, 1);
	assert.equal(strings[1].start, 2); assert.equal(strings[1].end, 3);
	assert.equal(code.start, 1); assert.equal(code.end, 2);
});

test("fenced ``` ... ``` block splits triple-backticks + body", () => {
	const tokens = collectTokens("```\nfoo\n```\n");
	const fences = tokens.filter(t => t.type === "string");
	const body = tokens.find(t => t.type === "codeBlock");
	assert.equal(fences.length, 2);
	assert.equal(fences[0].end - fences[0].start, 3);
	assert.equal(fences[1].end - fences[1].start, 3);
	assert.ok(body);
});

test("``` block with language tag emits a languageTag token", () => {
	const tokens = collectTokens("```js\nfoo\n```\n");
	const lang = tokens.find(t => t.type === "languageTag");
	assert.ok(lang);
	assert.equal(lang.end - lang.start, 2);
});

test("inline $math$ delimiters are string-colored", () => {
	const src = "$x$";
	const tokens = collectTokens(src);
	const strings = tokens.filter(t => t.type === "string");
	assert.ok(strings.find(t => t.start === 0 && t.end === 1));
	assert.ok(strings.find(t => t.start === 2 && t.end === 3));
});

test("@name[body] colors @ and name as spruceFunction, body recurses", () => {
	const tokens = collectTokens("@name[body]");
	const fns = tokens.filter(t => t.type === "spruceFunction");
	// One for the @, one for the identifier `name`.
	assert.ok(fns.length >= 2);
	assert.equal(fns[0].start, 0);
	assert.equal(fns[0].end, 1);
});

test("wrapped (@name[body]) colors @ and name as spruceFunction", () => {
	const src = "(@name[body])";
	const tokens = collectTokens(src);
	const fns = tokens.filter(t => t.type === "spruceFunction");
	// At least one for the @ and one for the identifier `name`.
	assert.ok(fns.length >= 2);
	const atTok = fns.find(t => t.start === src.indexOf("@"));
	assert.ok(atTok, "expected a token starting at the @ position");
	assert.equal(atTok.end - atTok.start, 1);
});

test("link URL is highlighted as string", () => {
	const tokens = collectTokens("[text](https://example.com)");
	const strings = tokens.filter(t => t.type === "string");
	assert.ok(strings.find(t => t.start === 7 && t.end === 26));
});

test("escaped @x emits keyword @ and string escaped char", () => {
	const src = "a @] b";
	const tokens = collectTokens(src);
	const atIdx = src.indexOf("@");
	const fn = tokens.find(t => t.type === "spruceFunction" && t.start === atIdx);
	assert.ok(fn);
	assert.equal(fn.end, atIdx + 1);
	const str = tokens.find(t => t.type === "string" && t.start === atIdx + 1);
	assert.ok(str);
	assert.equal(str.end, atIdx + 2);
});

test("raw block content is string, with function-call gaps preserved", () => {
	// @outer{ raw stuff @inner[x] more } — outer is functionCall_raw.
	const tokens = collectTokens("@outer{ raw @inner[x] more }");
	const strings = tokens.filter(t => t.type === "string");
	const fns = tokens.filter(t => t.type === "spruceFunction");
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

test("parsed block body is highlighted as a full document", () => {
	const src = "@f[[# Heading\n\n**bold** and @g[x]]]";
	const tokens = collectTokens(src);
	// Block-level + inline markup inside the [[ ]] is highlighted.
	assert.ok(tokens.find(t => t.type === "heading" && src.slice(t.start, t.end) === "# Heading"));
	assert.ok(tokens.find(t => t.type === "bold" && src.slice(t.start, t.end) === "bold"));
	// The nested @g function call inside the parsed block is highlighted too.
	const gAt = src.indexOf("@g");
	assert.ok(tokens.find(t => t.type === "spruceFunction" && t.start === gAt));
});

test("nested parsed block inside a parsed block is highlighted recursively", () => {
	const src = "@f[[outer @h[[**deep**]] end]]";
	const tokens = collectTokens(src);
	assert.ok(tokens.find(t => t.type === "bold" && src.slice(t.start, t.end) === "deep"));
});

test("nested brackets @g[@f[x]] pair correctly with sequential colors", () => {
	// The `]]` must split into two closers, each matching its opener — the bug
	// was the pair colorizer treating `]]` as a single (unmatched) token.
	const src = "@g[@f[x]]";
	const brackets = collectTokens(src)
		.filter(t => t.type.startsWith("bracket"))
		.sort((a, b) => a.start - b.start);
	// Outer `[` (idx 2) and outer `]` (idx 8) share a color; inner `[` (5) / `]` (7) share another.
	const outerOpen = brackets.find(t => t.start === 2);
	const innerOpen = brackets.find(t => t.start === 5);
	const innerClose = brackets.find(t => t.start === 7);
	const outerClose = brackets.find(t => t.start === 8);
	assert.ok(outerOpen && innerOpen && innerClose && outerClose, "all four delimiters colored");
	assert.equal(outerOpen.type, outerClose.type);
	assert.equal(innerOpen.type, innerClose.type);
	assert.notEqual(outerOpen.type, innerOpen.type);
});

test("sibling brackets get sequential (not nesting-based) colors", () => {
	const src = "@a[x] @b[y] @c[z]";
	const opens = collectTokens(src)
		.filter(t => t.type.startsWith("bracket") && src[t.start] === "[")
		.sort((a, b) => a.start - b.start);
	assert.equal(opens.length, 3);
	// Three same-depth siblings cycle through the three colors.
	assert.equal(opens[0].type, "bracket1");
	assert.equal(opens[1].type, "bracket2");
	assert.equal(opens[2].type, "bracket3");
});

test("hash-prefixed delimiter is colored as a single unit", () => {
	const src = "@f#[[ inner ]]#";
	const brackets = collectTokens(src).filter(t => t.type.startsWith("bracket"));
	assert.ok(brackets.find(t => src.slice(t.start, t.end) === "#[["));
	assert.ok(brackets.find(t => src.slice(t.start, t.end) === "]]#"));
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
