import assert from "node:assert/strict";
import { test } from "node:test";
import { compile } from "./spruce.js";
import { stdlib } from "./stdlib.js";

// Silence console.log globally so logSourceError output (used in the
// error-reporting tests, which capture it themselves via t.mock.method)
// doesn't corrupt the TAP stream during unrelated failures.
console.log = () => {};

// Stdlib snippet that defines helpers reused across tests.
const lib = `@@@html
function id(x) { return x; }
function up(x) { return x.toUpperCase(); }
function join(...args) { return args.join(","); }
function noop() {}
@@@
`;

// Most lib-prefixed inputs produce a leading "\n" in the output because the
// document chunks are: [declarationBlock, newline, paragraph]. The
// declarationBlock substitutes to "" but the chunk-separating newline survives.
const NL = "\n";


// ============================================================================
// Block-level sugar
// ============================================================================

test("block: h1 through h6", async () =>
{
	for (let i = 1; i <= 6; i++)
	{
		const hashes = "#".repeat(i);
		assert.equal(await compile(`${hashes} X`, "html"), `<h${i}>X</h${i}>`);
	}
});

test("block: heading body parses inline elements", async () =>
{
	assert.equal(
		await compile("## **bold** heading", "html"),
		"<h2><strong>bold</strong> heading</h2>",
	);
});

test("block: code block with language tag", async () =>
{
	assert.equal(
		await compile("```js\nx = 1\n```", "html"),
		"<pre><code>x = 1</code></pre>",
	);
});

test("block: display math", async () =>
{
	assert.equal(
		await compile("$$\nbody\n$$", "html"),
		"<p>$$\\begin{align*}body\\end{align*}$$</p>",
	);
});

test("block: unordered list, single item", async () =>
{
	assert.equal(await compile("- a", "html"), "<ul><li>a</li></ul>");
});

test("block: unordered list, multiple items", async () =>
{
	assert.equal(
		await compile("- a\n- b\n- c", "html"),
		"<ul><li>a</li><li>b</li><li>c</li></ul>",
	);
});

test("block: unordered list with inline elements", async () =>
{
	assert.equal(
		await compile("- *italic* item", "html"),
		"<ul><li><em>italic</em> item</li></ul>",
	);
});

test("block: ordered list with numeric starters", async () =>
{
	assert.equal(
		await compile("1. one\n2. two", "html"),
		"<ol><li>one</li><li>two</li></ol>",
	);
});

test("block: ordered list with plus starters", async () =>
{
	assert.equal(
		await compile("+  a\n+  b", "html"),
		"<ol><li>a</li><li>b</li></ol>",
	);
});

test("block: declaration block matching scope makes its definitions available", async () =>
{
	assert.equal(
		await compile(`@@@html\nfunction f() { return "R"; }\n@@@\n@f`, "html"),
		NL + "R",
	);
});

test("block: declaration block with non-matching scope is dropped", async () =>
{
	assert.equal(await compile("@@@tex\nignored body\n@@@\nplain", "html"), NL + "plain");
});

test("block: multi-scope declaration block, only matching scope runs", async () =>
{
	assert.equal(
		await compile(`@@@html\nfunction f() { return "html-result"; }\n@@@tex\nthis is dead code\n@@@\n@f`, "html"),
		NL + "html-result",
	);
});

test("block: declaration block alone produces empty output", async () =>
{
	assert.equal(
		await compile(`@@@html\nfunction f() { return "x"; }\n@@@`, "html"),
		"",
	);
});


// ============================================================================
// Inline sugar
// ============================================================================

test("inline: italic with *", async () =>
{
	assert.equal(await compile("*x*", "html"), "<em>x</em>");
});

test("inline: italic with _", async () =>
{
	assert.equal(await compile("_x_", "html"), "<em>x</em>");
});

test("inline: bold with **", async () =>
{
	assert.equal(await compile("**x**", "html"), "<strong>x</strong>");
});

test("inline: bold with __", async () =>
{
	assert.equal(await compile("__x__", "html"), "<strong>x</strong>");
});

test("inline: boldItalic with ***", async () =>
{
	assert.equal(await compile("***x***", "html"), "<strong><em>x</em></strong>");
});

test("inline: boldItalic with ___", async () =>
{
	assert.equal(await compile("___x___", "html"), "<strong><em>x</em></strong>");
});

test("inline: code", async () =>
{
	assert.equal(await compile("`code`", "html"), "<code>code</code>");
});

test("inline: math", async () =>
{
	assert.equal(await compile("$math$", "html"), "$math$");
});

test("inline: display math", async () =>
{
	assert.equal(await compile("$$disp$$", "html"), "$\\displaystyle disp$");
});

test("inline: link", async () =>
{
	assert.equal(await compile("[t](u)", "html"), `<a href="u">t</a>`);
});

test("inline: link text parses inline elements", async () =>
{
	assert.equal(await compile("[**t**](u)", "html"), `<a href="u"><strong>t</strong></a>`);
});

test("inline: paragraph with mixed inline forms", async () =>
{
	assert.equal(
		await compile("alpha *e* beta **b** gamma", "html"),
		"alpha <em>e</em> beta <strong>b</strong> gamma",
	);
});

test("inline: repeated bold", async () =>
{
	assert.equal(
		await compile("**a** **b** **c**", "html"),
		"<strong>a</strong> <strong>b</strong> <strong>c</strong>",
	);
});

test("inline: boundary case **a***b** (parser keeps trailing **b** as bold)", async () =>
{
	assert.equal(await compile("**a***b**", "html"), "**a*<strong>b</strong>");
});


// ============================================================================
// Function calls
// ============================================================================

test("call: bare", async () =>
{
	assert.equal(await compile(lib + "@id[hi]", "html"), NL + "hi");
});

test("call: wrapped", async () =>
{
	assert.equal(await compile(lib + "@(id [hi])", "html"), NL + "hi");
});

test("call: raw passes content through verbatim", async () =>
{
	assert.equal(await compile("@{stuff}", "html"), "stuff");
});

test("call: escaped @ becomes literal @", async () =>
{
	assert.equal(await compile("\\@", "html"), "@");
});

test("call: multiple parsed-block args", async () =>
{
	assert.equal(await compile(lib + "@join[a][b][c]", "html"), NL + "a,b,c");
});

test("call: nested calls regression - inner result reaches outer arg", async () =>
{
	assert.equal(await compile(lib + "@(up [@(up [hi])])", "html"), NL + "HI");
});

test("call: function call inside a heading body", async () =>
{
	assert.equal(await compile(lib + "# @up[hello]", "html"), NL + "<h1>HELLO</h1>");
});

test("call: function call inside a bold span", async () =>
{
	assert.equal(await compile(lib + "**@up[hi]**", "html"), NL + "<strong>HI</strong>");
});

test("call: function call inside a list item", async () =>
{
	assert.equal(
		await compile(lib + "- @up[a]\n- @up[b]", "html"),
		NL + "<ul><li>A</li><li>B</li></ul>",
	);
});

test("call: function call inside a raw block @{...}", async () =>
{
	assert.equal(await compile(lib + "@{ @up[hi] }", "html"), NL + " HI ");
});

test("call: function returning undefined substitutes empty (Array.join skips it)", async () =>
{
	assert.equal(await compile(lib + "@noop", "html"), NL);
});

test("call: template-hostile arg, backtick triggers inline-code parse", async () =>
{
	assert.equal(await compile(lib + "@id[a`b`c]", "html"), NL + "a<code>b</code>c");
});

test("call: template-hostile arg, $ triggers inline math", async () =>
{
	assert.equal(await compile(lib + "@id[a$b$c]", "html"), NL + "a$b$c");
});

test("call: template-hostile arg, literal backtick in raw block (regression)", async () =>
{
	// Without escapeForTemplate turning ` into \`, the surrounding `…` wrapping
	// in the generated template literal terminates early and the JS fails to
	// parse, causing compile() to reject.
	assert.equal(await compile(lib + "@id{`}", "html"), NL + "`");
});


// ============================================================================
// Escapes
// ============================================================================

test("escape: backslash @", async () => assert.equal(await compile("\\@", "html"), "@"));
test("escape: backslash *", async () => assert.equal(await compile("\\*", "html"), "*"));
test("escape: backslash _", async () => assert.equal(await compile("\\_", "html"), "_"));
test("escape: backslash backtick", async () => assert.equal(await compile("\\`", "html"), "`"));
test("escape: backslash [", async () => assert.equal(await compile("\\[", "html"), "["));
test("escape: backslash ]", async () => assert.equal(await compile("\\]", "html"), "]"));
test("escape: backslash <", async () => assert.equal(await compile("\\<", "html"), "<"));

test("escape: backslash $ keeps the backslash (stdlib special-case)", async () =>
{
	assert.equal(await compile("\\$", "html"), "\\$");
});

test("escape: multiple escapes in one paragraph", async () =>
{
	assert.equal(await compile("a \\@ b \\* c", "html"), "a @ b * c");
});


// ============================================================================
// Whitespace, boundaries, pathological inputs
// ============================================================================

test("misc: empty input -> empty output", async () =>
{
	assert.equal(await compile("", "html"), "");
});

test("misc: single character", async () =>
{
	assert.equal(await compile("a", "html"), "a");
});

test("misc: plain text passes through", async () =>
{
	assert.equal(await compile("plain text", "html"), "plain text");
});

test("misc: two paragraphs preserve blank-line separator", async () =>
{
	assert.equal(await compile("p1\n\np2", "html"), "p1\n\np2");
});

test("misc: raw HTML in a paragraph passes through untouched", async () =>
{
	assert.equal(await compile("<span>x</span>", "html"), "<span>x</span>");
});

test("misc: HTML mid-paragraph passes through", async () =>
{
	assert.equal(
		await compile("before <em>html</em> after", "html"),
		"before <em>html</em> after",
	);
});

test("misc: long line of plain characters", async () =>
{
	const long = "x".repeat(500);
	assert.equal(await compile(long, "html"), long);
});


// ============================================================================
// Error reporting
// ============================================================================

test("error: undefined function call rejects and logs red ANSI with the name", async (t) =>
{
	const logs = [];
	t.mock.method(console, "log", (...args) => { logs.push(args.join(" ")); });

	await assert.rejects(compile("@undefined[x]", "html"));

	const combined = logs.join("\n");
	assert.match(combined, /\x1b\[1;31m/, "log should contain bold-red ANSI");
	assert.match(combined, /\x1b\[0m/, "log should contain ANSI reset");
	assert.match(combined, /undefined/, "log should reference 'undefined'");
	assert.match(combined, /\x1b\[1;31m\s*1\x1b\[0m/, "line 1 should be highlighted");
});

test("error: error inside declaration block body maps to original-source line", async (t) =>
{
	const logs = [];
	t.mock.method(console, "log", (...args) => { logs.push(args.join(" ")); });

	await assert.rejects(
		compile("@@@html\nthrow new Error(\"boom\");\n@@@", "html"),
		/boom/,
	);

	const combined = logs.join("\n");
	assert.match(
		combined,
		/\x1b\[1;31m\s*2\x1b\[0m \| \x1b\[1;31mthrow new Error\("boom"\);\x1b\[0m/,
		"declaration-block error should highlight line 2 whole-line red",
	);
});

test("error: successful compile produces no logSourceError output", async (t) =>
{
	const logs = [];
	t.mock.method(console, "log", (...args) => { logs.push(args.join(" ")); });

	await compile("# H", "html");

	const combined = logs.join("\n");
	assert.doesNotMatch(combined, /\x1b\[1;31m/);
});


// ============================================================================
// Idempotency / no state bleed between calls
// ============================================================================

test("state: same input twice -> same output", async () =>
{
	const a = await compile("# X", "html");
	const b = await compile("# X", "html");
	assert.equal(a, b);
	assert.equal(a, "<h1>X</h1>");
});

test("state: different inputs back-to-back don't leak state", async () =>
{
	assert.equal(await compile("# A", "html"), "<h1>A</h1>");
	assert.equal(await compile("# B", "html"), "<h1>B</h1>");
	assert.equal(await compile("# A", "html"), "<h1>A</h1>");
});

test("state: nested calls then sugar", async () =>
{
	assert.equal(await compile(lib + "@(up [@(up [hi])])", "html"), NL + "HI");
	assert.equal(await compile("**bold**", "html"), "<strong>bold</strong>");
});


// ============================================================================
// Output format parameter
// ============================================================================

test("format: tex format uses tex stdlib", async () =>
{
	assert.equal(await compile("# X", "tex"), "\\chapter{X}");
});

test("format: tex format applies tex sugar throughout", async () =>
{
	assert.equal(await compile("**bold**", "tex"), "\\textbf{bold}");
});

test("format: declaration-block scope follows the format param", async () =>
{
	// Same source, different format -> different declaration block runs.
	const src = `@@@html\nfunction f() { return "H"; }\n@@@tex\nfunction f() { return "T"; }\n@@@\n@f`;
	assert.equal(await compile(src, "html"), NL + "H");
	assert.equal(await compile(src, "tex"), NL + "T");
});

test("format: unknown format is allowed (no stdlib defaults applied)", async () =>
{
	// User-defined declaration block under an unknown scope still runs and is usable.
	const src = `@@@bogus\nfunction greet() { return "hello"; }\n@@@\n@greet`;
	assert.equal(await compile(src, "bogus"), NL + "hello");
});


// ============================================================================
// Post-compile hooks
// ============================================================================

test("document hook: stdlib document wraps the compiled body", async () =>
{
	stdlib.html.document = body => `<doc>${body}</doc>`;
	try
	{
		assert.equal(await compile("# X", "html"), "<doc><h1>X</h1></doc>");
	}
	finally
	{
		delete stdlib.html.document;
	}
});

test("document hook: no document registered leaves body unchanged", async () =>
{
	assert.equal(await compile("# X", "html"), "<h1>X</h1>");
});

test("document hook: hook is not callable inline as @document[...]", async (t) =>
{
	t.mock.method(console, "log", () => {});
	stdlib.html.document = body => `WRAP(${body})`;
	try
	{
		// `document` is excluded from the globalThis splat, so referencing it
		// inline should fail with the standard undefined-function error path.
		await assert.rejects(compile("@document[x]", "html"));
	}
	finally
	{
		delete stdlib.html.document;
	}
});


// ============================================================================
// Isolation: serialization and globalThis hygiene
// ============================================================================

test("isolation: concurrent compiles do not corrupt each other", async () =>
{
	// Run several compiles that overlap on the await inside runCode. Without
	// serialization, desugar()/getCode()'s module-level state gets stomped
	// across awaits and outputs cross-contaminate.
	const [a, b, c] = await Promise.all([
		compile("# A", "html"),
		compile("# B", "tex"),
		compile("# C", "html"),
	]);
	assert.match(a, /<h1>A<\/h1>/);
	assert.match(b, /\\chapter\{B\}/);
	assert.match(c, /<h1>C<\/h1>/);
	// And the formats must not have cross-contaminated.
	assert.doesNotMatch(a, /\\chapter/);
	assert.doesNotMatch(b, /<h1>/);
});

test("isolation: compile does not leak stdlib onto globalThis", async () =>
{
	const sentinelKey = "heading"; // present in both html and tex stdlib
	const hadBefore = Object.hasOwn(globalThis, sentinelKey);
	const valueBefore = hadBefore ? globalThis[sentinelKey] : undefined;

	await compile("# X", "html");

	assert.equal(Object.hasOwn(globalThis, sentinelKey), hadBefore);
	if (hadBefore) assert.equal(globalThis[sentinelKey], valueBefore);
});

test("isolation: pre-existing globalThis entry is restored after compile", async () =>
{
	const sentinel = Symbol("preexisting");
	const had = Object.hasOwn(globalThis, "bold");
	const prior = had ? globalThis.bold : undefined;

	globalThis.bold = sentinel;
	try
	{
		await compile("**x**", "html");
		assert.equal(globalThis.bold, sentinel);
	}
	finally
	{
		if (had) globalThis.bold = prior;
		else delete globalThis.bold;
	}
});

test("isolation: user declaration block still overrides the stdlib name", async () =>
{
	const src = `@@@html\nfunction heading(n, body) { return "OVERRIDE:" + body; }\n@@@\n# X`;
	assert.equal(await compile(src, "html"), NL + "OVERRIDE:X");
});
