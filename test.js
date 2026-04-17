const { parse } = require("./index.js");

const tests = [
	// ─── Document Structure ─────────────────────
	{ name: "empty document", input: "" },
	{ name: "single newline", input: "\n" },
	{ name: "multiple blank lines", input: "\n\n\n" },

	// ─── Paragraphs ─────────────────────────────
	{ name: "simple paragraph", input: "Hello, world!\n" },
	{ name: "paragraph without trailing newline", input: "Hello, world!" },
	{ name: "multi-line paragraph", input: "Line one\nLine two\nLine three\n" },
	{ name: "two paragraphs", input: "First paragraph.\n\nSecond paragraph.\n" },

	// ─── ATX Headings ───────────────────────────
	{ name: "h1", input: "# Heading 1\n" },
	{ name: "h2", input: "## Heading 2\n" },
	{ name: "h3", input: "### Heading 3\n" },
	{ name: "h4", input: "#### Heading 4\n" },
	{ name: "h5", input: "##### Heading 5\n" },
	{ name: "h6", input: "###### Heading 6\n" },
	{ name: "heading without trailing newline", input: "# Heading" },
	{ name: "heading with inline content", input: "## A *bold* heading\n" },

	// ─── Thematic Breaks ────────────────────────
	{ name: "star thematic break", input: "***\n" },
	{ name: "dash thematic break", input: "---\n" },
	{ name: "underscore thematic break", input: "___\n" },
	{ name: "spaced star break", input: "* * *\n" },
	{ name: "spaced dash break", input: "- - -\n" },
	{ name: "many stars", input: "**********\n" },
	{ name: "break with leading spaces", input: "   ---\n" },

	// ─── Fenced Code Blocks ─────────────────────
	{ name: "backtick code block", input: "```\ncode here\n```\n" },
	{ name: "backtick with info string", input: "```javascript\nconst x = 1;\n```\n" },
	{ name: "empty backtick code block", input: "```\n```\n" },
	{ name: "code block with blank lines", input: "```\nline 1\n\nline 3\n```\n" },
	{ name: "tilde code block", input: "~~~\ncode here\n~~~\n" },
	{ name: "tilde with info string", input: "~~~python\nprint('hello')\n~~~\n" },
	{ name: "code block at end without trailing newline", input: "```\ncode\n```" },

	// ─── Blockquotes ────────────────────────────
	{ name: "simple blockquote", input: "> Quote text\n" },
	{ name: "multi-line blockquote", input: "> Line 1\n> Line 2\n" },
	{ name: "blockquote without space", input: ">No space\n" },
	{ name: "empty blockquote", input: ">\n" },

	// ─── Unordered Lists ────────────────────────
	{ name: "dash list", input: "- Item 1\n- Item 2\n- Item 3\n" },
	{ name: "star list", input: "* Item 1\n* Item 2\n" },
	{ name: "plus list", input: "+ Item 1\n+ Item 2\n" },

	// ─── Ordered Lists ──────────────────────────
	{ name: "ordered list with dot", input: "1. First\n2. Second\n3. Third\n" },
	{ name: "ordered list with paren", input: "1) First\n2) Second\n" },

	// ─── Emphasis ───────────────────────────────
	{ name: "star emphasis", input: "*emphasis*\n" },
	{ name: "underscore emphasis", input: "_emphasis_\n" },
	{ name: "star strong", input: "**strong**\n" },
	{ name: "underscore strong", input: "__strong__\n" },
	{ name: "strong inside emphasis", input: "*a **b** c*\n" },
	{ name: "emphasis inside strong", input: "**a *b* c**\n" },
	{ name: "bold italic with stars", input: "***bold italic***\n" },

	// ─── Code Spans ─────────────────────────────
	{ name: "single backtick code", input: "`code`\n" },
	{ name: "double backtick code", input: "``code with ` inside``\n" },

	// ─── Links ──────────────────────────────────
	{ name: "simple link", input: "[text](url)\n" },
	{ name: "link with title", input: '[text](url "title")\n' },
	{ name: "link with single-quote title", input: "[text](url 'title')\n" },

	// ─── Images ─────────────────────────────────
	{ name: "simple image", input: "![alt](url)\n" },
	{ name: "image with title", input: '![alt](url "title")\n' },

	// ─── Autolinks ──────────────────────────────
	{ name: "autolink", input: "<https://example.com>\n" },
	{ name: "mailto autolink", input: "<mailto:user@example.com>\n" },

	// ─── Escaped Characters ─────────────────────
	{ name: "escaped star", input: "\\*not emphasis\\*\n" },
	{ name: "escaped hash", input: "\\# not a heading\n" },
	{ name: "escaped backslash", input: "\\\\ backslash\n" },

	// ─── Hard Line Breaks ───────────────────────
	{ name: "trailing space break", input: "Line one  \nLine two\n" },
	{ name: "backslash break", input: "Line one\\\nLine two\n" },

	// ─── Mixed Content ──────────────────────────
	{
		name: "full document",
		input:
			"# Title\n" +
			"\n" +
			"A paragraph with *emphasis* and **strong** text.\n" +
			"\n" +
			"## Code Example\n" +
			"\n" +
			"```javascript\n" +
			"const x = 1;\n" +
			"```\n" +
			"\n" +
			"- Item with `code`\n" +
			"- Item with [a link](https://example.com)\n" +
			"\n" +
			"> A blockquote\n" +
			"\n" +
			"---\n",
	},
];

let passed = 0;
let failed = 0;

for (const test of tests) {
	const result = parse(test.input);

	if (result.succeeded()) {
		passed++;
	} else {
		failed++;
		console.log(`FAIL: ${test.name}`);
		console.log(`  ${result.shortMessage}`);
		console.log();
	}
}

console.log(`${passed} passed, ${failed} failed out of ${tests.length} tests`);

if (failed > 0) {
	process.exit(1);
}
