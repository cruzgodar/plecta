import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { compile } from "./plecta.js";

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
		assert.equal(await compile(`${hashes} X`), `<h${i}>X</h${i}>`);
	}
});

test("block: heading body parses inline elements", async () =>
{
	assert.equal(
		await compile("## **bold** heading"),
		"<h2><strong>bold</strong> heading</h2>",
	);
});

test("block: code block with language tag", async () =>
{
	assert.equal(
		await compile("```js\nx = 1\n```"),
		"<pre><code>x = 1</code></pre>",
	);
});

test("block: display math", async () =>
{
	assert.equal(
		await compile("$$\nbody\n$$"),
		"<p>$$\\begin{align*}body\\end{align*}$$</p>",
	);
});

test("block: unordered list, single item", async () =>
{
	assert.equal(await compile("- a"), "<ul><li>a</li></ul>");
});

test("block: unordered list, multiple items", async () =>
{
	assert.equal(
		await compile("- a\n- b\n- c"),
		"<ul><li>a</li><li>b</li><li>c</li></ul>",
	);
});

test("block: unordered list with inline elements", async () =>
{
	assert.equal(
		await compile("- *italic* item"),
		"<ul><li><em>italic</em> item</li></ul>",
	);
});

test("block: ordered list with numeric starters", async () =>
{
	assert.equal(
		await compile("1. one\n2. two"),
		"<ol><li>one</li><li>two</li></ol>",
	);
});

test("block: ordered list with plus starters", async () =>
{
	assert.equal(
		await compile("+  a\n+  b"),
		"<ol><li>a</li><li>b</li></ol>",
	);
});

test("block: declaration block matching scope makes its definitions available", async () =>
{
	assert.equal(
		await compile(`@@@html\nfunction f() { return "R"; }\n@@@\n@f`),
		NL + "R",
	);
});

test("block: declaration block with non-matching scope is dropped", async () =>
{
	assert.equal(await compile("@@@tex\nignored body\n@@@\nplain"), NL + "plain");
});

test("block: multi-scope declaration block, only matching scope runs", async () =>
{
	assert.equal(
		await compile(`@@@html\nfunction f() { return "html-result"; }\n@@@tex\nthis is dead code\n@@@\n@f`),
		NL + "html-result",
	);
});

test("block: declaration block alone produces empty output", async () =>
{
	assert.equal(
		await compile(`@@@html\nfunction f() { return "x"; }\n@@@`),
		"",
	);
});


// ============================================================================
// Inline sugar
// ============================================================================

test("inline: italic with *", async () =>
{
	assert.equal(await compile("*x*"), "<em>x</em>");
});

test("inline: italic with _", async () =>
{
	assert.equal(await compile("_x_"), "<em>x</em>");
});

test("inline: bold with **", async () =>
{
	assert.equal(await compile("**x**"), "<strong>x</strong>");
});

test("inline: bold with __", async () =>
{
	assert.equal(await compile("__x__"), "<strong>x</strong>");
});

test("inline: boldItalic with ***", async () =>
{
	assert.equal(await compile("***x***"), "<strong><em>x</em></strong>");
});

test("inline: boldItalic with ___", async () =>
{
	assert.equal(await compile("___x___"), "<strong><em>x</em></strong>");
});

test("inline: code", async () =>
{
	assert.equal(await compile("`code`"), "<code>code</code>");
});

test("inline: math", async () =>
{
	assert.equal(await compile("$math$"), "$math$");
});

test("inline: display math", async () =>
{
	assert.equal(await compile("$$disp$$"), "$\\displaystyle disp$");
});

test("inline: link", async () =>
{
	assert.equal(await compile("[t](u)"), `<a href="u">t</a>`);
});

test("inline: link text parses inline elements", async () =>
{
	assert.equal(await compile("[**t**](u)"), `<a href="u"><strong>t</strong></a>`);
});

test("inline: paragraph with mixed inline forms", async () =>
{
	assert.equal(
		await compile("alpha *e* beta **b** gamma"),
		"alpha <em>e</em> beta <strong>b</strong> gamma",
	);
});

test("inline: repeated bold", async () =>
{
	assert.equal(
		await compile("**a** **b** **c**"),
		"<strong>a</strong> <strong>b</strong> <strong>c</strong>",
	);
});

test("inline: boundary case **a***b** (parser keeps trailing **b** as bold)", async () =>
{
	assert.equal(await compile("**a***b**"), "**a*<strong>b</strong>");
});


// ============================================================================
// Function calls
// ============================================================================

test("call: bare", async () =>
{
	assert.equal(await compile(lib + "@id[hi]"), NL + "hi");
});

test("call: wrapped", async () =>
{
	assert.equal(await compile(lib + "@(id [hi])"), NL + "hi");
});

test("call: raw passes content through verbatim", async () =>
{
	assert.equal(await compile("@{stuff}"), "stuff");
});

test("call: escaped @ becomes literal @", async () =>
{
	assert.equal(await compile("\\@"), "@");
});

test("call: multiple parsed-block args", async () =>
{
	assert.equal(await compile(lib + "@join[a][b][c]"), NL + "a,b,c");
});

test("call: nested calls regression - inner result reaches outer arg", async () =>
{
	assert.equal(await compile(lib + "@(up [@(up [hi])])"), NL + "HI");
});

test("call: function call inside a heading body", async () =>
{
	assert.equal(await compile(lib + "# @up[hello]"), NL + "<h1>HELLO</h1>");
});

test("call: function call inside a bold span", async () =>
{
	assert.equal(await compile(lib + "**@up[hi]**"), NL + "<strong>HI</strong>");
});

test("call: function call inside a list item", async () =>
{
	assert.equal(
		await compile(lib + "- @up[a]\n- @up[b]"),
		NL + "<ul><li>A</li><li>B</li></ul>",
	);
});

test("call: function call inside a raw block @{...}", async () =>
{
	assert.equal(await compile(lib + "@{ @up[hi] }"), NL + " HI ");
});

test("call: function returning undefined substitutes empty (Array.join skips it)", async () =>
{
	assert.equal(await compile(lib + "@noop"), NL);
});

test("call: template-hostile arg, backtick triggers inline-code parse", async () =>
{
	assert.equal(await compile(lib + "@id[a`b`c]"), NL + "a<code>b</code>c");
});

test("call: template-hostile arg, $ triggers inline math", async () =>
{
	assert.equal(await compile(lib + "@id[a$b$c]"), NL + "a$b$c");
});

test("call: template-hostile arg, literal backtick in raw block (regression)", async () =>
{
	// Without escapeForTemplate turning ` into \`, the surrounding `…` wrapping
	// in the generated template literal terminates early and the JS fails to
	// parse, causing compile() to reject.
	assert.equal(await compile(lib + "@id{`}"), NL + "`");
});


// ============================================================================
// Escapes
// ============================================================================

test("escape: backslash @", async () => assert.equal(await compile("\\@"), "@"));
test("escape: backslash *", async () => assert.equal(await compile("\\*"), "*"));
test("escape: backslash _", async () => assert.equal(await compile("\\_"), "_"));
test("escape: backslash backtick", async () => assert.equal(await compile("\\`"), "`"));
test("escape: backslash [", async () => assert.equal(await compile("\\["), "["));
test("escape: backslash ]", async () => assert.equal(await compile("\\]"), "]"));
test("escape: backslash <", async () => assert.equal(await compile("\\<"), "<"));

test("escape: backslash $ keeps the backslash (stdlib special-case)", async () =>
{
	assert.equal(await compile("\\$"), "\\$");
});

test("escape: multiple escapes in one paragraph", async () =>
{
	assert.equal(await compile("a \\@ b \\* c"), "a @ b * c");
});


// ============================================================================
// Whitespace, boundaries, pathological inputs
// ============================================================================

test("misc: empty input -> empty output", async () =>
{
	assert.equal(await compile(""), "");
});

test("misc: single character", async () =>
{
	assert.equal(await compile("a"), "a");
});

test("misc: plain text passes through", async () =>
{
	assert.equal(await compile("plain text"), "plain text");
});

test("misc: two paragraphs preserve blank-line separator", async () =>
{
	assert.equal(await compile("p1\n\np2"), "p1\n\np2");
});

test("misc: raw HTML in a paragraph passes through untouched", async () =>
{
	assert.equal(await compile("<span>x</span>"), "<span>x</span>");
});

test("misc: HTML mid-paragraph passes through", async () =>
{
	assert.equal(
		await compile("before <em>html</em> after"),
		"before <em>html</em> after",
	);
});

test("misc: long line of plain characters", async () =>
{
	const long = "x".repeat(500);
	assert.equal(await compile(long), long);
});


// ============================================================================
// Error reporting
// ============================================================================

test("error: undefined function call rejects and logs red ANSI with the name", async (t) =>
{
	const logs = [];
	t.mock.method(console, "log", (...args) => { logs.push(args.join(" ")); });

	await assert.rejects(compile("@undefined[x]"));

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
		compile("@@@html\nthrow new Error(\"boom\");\n@@@"),
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

	await compile("# H");

	const combined = logs.join("\n");
	assert.doesNotMatch(combined, /\x1b\[1;31m/);
});


// ============================================================================
// Idempotency / no state bleed between calls
// ============================================================================

test("state: same input twice -> same output", async () =>
{
	const a = await compile("# X");
	const b = await compile("# X");
	assert.equal(a, b);
	assert.equal(a, "<h1>X</h1>");
});

test("state: different inputs back-to-back don't leak state", async () =>
{
	assert.equal(await compile("# A"), "<h1>A</h1>");
	assert.equal(await compile("# B"), "<h1>B</h1>");
	assert.equal(await compile("# A"), "<h1>A</h1>");
});

test("state: nested calls then sugar", async () =>
{
	assert.equal(await compile(lib + "@(up [@(up [hi])])"), NL + "HI");
	assert.equal(await compile("**bold**"), "<strong>bold</strong>");
});
