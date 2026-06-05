// spruce.js (and its stdlib.js dependency) live at the repo root, outside this
// extension folder, so vsce can't package them from there. build-and-install.sh
// vendors fresh copies into server/ before packaging; the dev host relies on the
// same copies. Run that script once after cloning so these exist.
import { grammarFor } from "./spruce.js";

export const TOKEN_TYPES = [
	"heading",
	"bold",
	"italic",
	"boldItalic",
	"inlineCode",
	"codeBlock",
	"list",
	"spruceFunction",
	"string",
	"linkText",
	"operator",
	"namespace",
	"marker",
	"languageTag",
	"bracket1",
	"bracket2",
	"bracket3",
];

export const TOKEN_MODIFIERS = [];

const typeIndex = Object.fromEntries(TOKEN_TYPES.map((t, i) => [t, i]));

// Bracket-pair colorization. The color advances both with nesting depth and
// between adjacent same-depth blocks, but a block's own nesting doesn't bleed
// into its parent's sibling sequence. So instead of one global running counter,
// each nesting level has its own counter: `bracketColorCounter` holds the color
// for the next bracket opened at the current level. Opening a block colors it
// with that value; its children start one past it (deeper = next color); and
// once the block closes the level resets so the next sibling also lands one past
// the block (adjacent = next color). e.g. `@f[@g[x]][y]` -> f=1, g=2, y=2.
// Module scope because parsedBlock re-matches its body through a fresh collect
// (see below) and the colors must flow across that boundary. Reset per document
// in collectTokens.
const BRACKET_COLORS = 2;
let bracketColorCounter = 0;
function bracketType(color) {
	return `bracket${(color % BRACKET_COLORS) + 1}`;
}

// Emit the opening/closing delimiter terminals of a bracketed node, running
// `collectBody` (which descends into the body) in between. Children are colored
// one past this block; afterwards the level is reset so the next sibling is too.
function emitBracketed(node, t, collectBody) {
	const open = node.children[0];
	const close = node.children[node.children.length - 1];
	const color = bracketColorCounter;
	emit(t, open.source.startIdx, open.source.endIdx, bracketType(color));
	bracketColorCounter = color + 1;
	collectBody();
	bracketColorCounter = color + 1;
	emit(t, close.source.startIdx, close.source.endIdx, bracketType(color));
}

// Rule handlers. Returning true means "fully handled, don't recurse into children";
// returning undefined falls through to recursing into all children.
const handlers = {
	heading(node, t) {
		emit(t, node.source.startIdx, node.source.endIdx, "heading");
		return true;
	},

	bold(node, t) {
		emitMarkered(t, node, 2, "bold");
		return true;
	},

	italic(node, t) {
		emitMarkered(t, node, 1, "italic");
		return true;
	},

	boldItalic(node, t) {
		emitMarkered(t, node, 3, "boldItalic");
		return true;
	},

	code(node, t) {
		// Backticks share the light-blue raw color (string), not the gray
		// marker color used for *_ delimiters.
		const s = node.source.startIdx;
		const e = node.source.endIdx;
		emit(t, s, s + 1, "string");
		emit(t, s + 1, e - 1, "inlineCode");
		emit(t, e - 1, e, "string");
		return true;
	},

	codeBlock(node, t) {
		const text = node.source.contents;
		const s = node.source.startIdx;
		const openIdx = text.indexOf("```");
		const closeIdx = text.lastIndexOf("```");
		if (openIdx < 0 || closeIdx <= openIdx) {
			emit(t, s, node.source.endIdx, "codeBlock");
			return true;
		}
		// Find the optional language tag: alnum* after ``` and optional whitespace.
		let i = openIdx + 3;
		while (text[i] === " " || text[i] === "\t") i++;
		const langStart = i;
		while (i < text.length && /[A-Za-z0-9]/.test(text[i])) i++;
		const langEnd = i;

		emit(t, s + openIdx, s + openIdx + 3, "string");
		if (langEnd > langStart) emit(t, s + langStart, s + langEnd, "languageTag");
		emit(t, s + langEnd, s + closeIdx, "codeBlock");
		emit(t, s + closeIdx, s + closeIdx + 3, "string");
		return true;
	},

	// Math content is handled by the embedded LaTeX TextMate grammar, but we
	// still emit semantic tokens for the $ / $$ delimiters so they pick up the
	// light-blue raw color (overriding the gray TextMate fallback).
	math(node, t) {
		const s = node.source.startIdx;
		const e = node.source.endIdx;
		emit(t, s, s + 1, "string");
		emit(t, e - 1, e, "string");
		return true;
	},
	inlineDisplayMath(node, t) {
		const s = node.source.startIdx;
		const e = node.source.endIdx;
		emit(t, s, s + 2, "string");
		emit(t, e - 2, e, "string");
		return true;
	},
	displayMath(node, t) {
		const text = node.source.contents;
		const s = node.source.startIdx;
		const openIdx = text.indexOf("$$");
		const closeIdx = text.lastIndexOf("$$");
		if (openIdx < 0 || closeIdx <= openIdx) return true;
		emit(t, s + openIdx, s + openIdx + 2, "string");
		emit(t, s + closeIdx, s + closeIdx + 2, "string");
		return true;
	},
	declarationBlock(_node, _t) { return true; },

	link(node, t) {
		const text = node.source.contents;
		const closeBracket = text.indexOf("](");
		if (closeBracket < 0) return;
		const s = node.source.startIdx;
		const e = node.source.endIdx;
		emit(t, s, s + 1, "operator");
		emit(t, s + closeBracket, s + closeBracket + 2, "operator");
		emit(t, e - 1, e, "operator");
		// Display text `[...]` is green (linkText); the URL `(...)` stays string.
		emit(t, s + 1, s + closeBracket, "linkText");
		emit(t, s + closeBracket + 2, e - 1, "string");
		return true;
	},

	// `(@name[...])` — the wrapping parens are a bracket pair, so they take part
	// in the sequential coloring (the paren first, then any inner blocks). We take
	// over recursion to interleave open-bracket / body / close-bracket correctly.
	functionCall_wrapped(node, t) {
		emitBracketed(node, t, () => {
			const atOffset = node.source.contents.indexOf("@");
			if (atOffset >= 0) {
				const s = node.source.startIdx + atOffset;
				emit(t, s, s + 1, "spruceFunction");
			}
			for (const c of node.children) c.collect(t);
		});
		return true;
	},
	functionCall_bare(node, t) {
		emit(t, node.source.startIdx, node.source.startIdx + 1, "spruceFunction");
	},
	functionCall_raw(node, t) {
		emit(t, node.source.startIdx, node.source.startIdx + 1, "spruceFunction");
	},
	// Escape sequences (@] @} @@ etc.): the @ is a keyword like any other
	// single @, and the escaped character renders as raw (string).
	functionCall_escaped(node, t) {
		const s = node.source.startIdx;
		const e = node.source.endIdx;
		emit(t, s, s + 1, "spruceFunction");
		emit(t, s + 1, e, "string");
		return true;
	},

	jsIdentifier(node, t) {
		emit(t, node.source.startIdx, node.source.endIdx, "spruceFunction");
		return true;
	},

	// Parsed blocks (`[[ ... ]]`, optionally hash-prefixed) contain a full
	// sub-document — at compile time the body is re-matched against the `document`
	// rule (see spruce.js). The grammar treats the body as raw `any` here, so to
	// highlight the markup inside (headings, bold, nested @funcs, ...) we re-match
	// it ourselves and splice the resulting tokens back at the body's offset. The
	// `[[` / `]]` (and any hashes) delimiters take sequential bracket colors.
	parsedBlock(node, t) {
		emitBracketed(node, t, () => {
			const body = node.children[1];
			const offset = body.source.startIdx;
			const match = activeGrammar.match(body.sourceString, "document");
			if (match.succeeded()) {
				const inner = [];
				semanticsFor(activeGrammar)(match).collect(inner);
				for (const tok of inner) emit(t, tok.start + offset, tok.end + offset, tok.type);
			}
		});
		return true;
	},

	// Inline parsed blocks (`[ ... ]`, optionally hash-prefixed) are parsed
	// directly (no re-match), so their body subtree can recurse normally. The
	// `[` / `]` delimiters take sequential bracket colors.
	parsedInlineBlock(node, t) {
		emitBracketed(node, t, () => node.children[1].collect(t));
		return true;
	},

	// Raw blocks: the content is a string, EXCEPT for nested function calls,
	// which keep their own coloring. We let children emit their tokens first
	// (so nested @funcs render as functions), then fill the gaps with `string`.
	// The `{` / `}` (and any hashes) delimiters take sequential bracket colors.
	rawBlock(node, t) {
		emitBracketed(node, t, () => {
			const body = node.children[1];
			const inner = [];
			body.collect(inner);
			inner.sort((a, b) => a.start - b.start);

			const start = body.source.startIdx;
			const end = body.source.endIdx;
			let cursor = start;
			for (const tok of inner) {
				if (tok.start > cursor) emit(t, cursor, tok.start, "string");
				if (tok.end > cursor) cursor = tok.end;
			}
			if (cursor < end) emit(t, cursor, end, "string");
			for (const tok of inner) t.push(tok);
		});
		return true;
	},

	orderedItemStarter_numeric(node, t) {
		emit(t, node.source.startIdx, node.source.endIdx, "list");
		return true;
	},
	orderedItemStarter_plus(node, t) {
		emit(t, node.source.startIdx, node.source.endIdx, "list");
		return true;
	},

	unorderedItem(node, t) {
		const offset = node.source.contents.indexOf("-");
		if (offset >= 0) {
			const s = node.source.startIdx + offset;
			emit(t, s, s + 1, "list");
		}
	},

	// Raw HTML tags (`<div>`, `</p>`, ...) get the light-blue raw color (string).
	// The rule allows leading whitespace, so start at the `<` so indentation isn't
	// colored.
	htmlTag(node, t) {
		const offset = node.source.contents.indexOf("<");
		if (offset >= 0) {
			emit(t, node.source.startIdx + offset, node.source.endIdx, "string");
		}
		return true;
	},
};

function emit(tokens, start, end, type) {
	if (end > start) tokens.push({ start, end, type });
}

// Emit a `marker` token for the first/last `markerLen` chars of `node` and
// a `contentType` token for everything in between.
function emitMarkered(tokens, node, markerLen, contentType) {
	const s = node.source.startIdx;
	const e = node.source.endIdx;
	emit(tokens, s, s + markerLen, "marker");
	emit(tokens, s + markerLen, e - markerLen, contentType);
	emit(tokens, e - markerLen, e, "marker");
}

const collectOperation = {
	_terminal() {},
	_iter(...children) {
		for (const c of children) c.collect(this.args.tokens);
	},
	_nonterminal(...children) {
		const handler = handlers[this.ctorName];
		const stop = handler && handler(this, this.args.tokens);
		if (stop) return;
		for (const c of children) c.collect(this.args.tokens);
	},
};

// The grammar is built on demand per input (its hash depth varies), so cache one
// semantics per grammar instance rather than creating it once at module load.
const semanticsCache = new WeakMap();

function semanticsFor(grammar) {
	let semantics = semanticsCache.get(grammar);
	if (!semantics) {
		semantics = grammar.createSemantics();
		semantics.addOperation("collect(tokens)", collectOperation);
		semanticsCache.set(grammar, semantics);
	}
	return semantics;
}

// The grammar that can parse the document currently being tokenized. Held at
// module scope so the parsedBlock handler can re-match block bodies against it.
let activeGrammar = null;

export function collectTokens(text) {
	const grammar = grammarFor(text);
	activeGrammar = grammar;
	const match = grammar.match(text);
	if (match.failed()) return [];
	bracketColorCounter = 0;
	const tokens = [];
	semanticsFor(grammar)(match).collect(tokens);
	return tokens;
}

export function encodeTokens(text, tokens) {
	const lineStarts = computeLineStarts(text);
	const flat = [];
	for (const tok of tokens) splitByLine(tok, lineStarts, text, flat);
	flat.sort((a, b) => a.line - b.line || a.char - b.char);

	const filtered = [];
	let lastLine = -1, lastEnd = -1;
	for (const tok of flat) {
		if (tok.line === lastLine && tok.char < lastEnd) continue;
		filtered.push(tok);
		lastLine = tok.line;
		lastEnd = tok.char + tok.length;
	}

	const data = [];
	let prevLine = 0, prevChar = 0;
	for (const tok of filtered) {
		const deltaLine = tok.line - prevLine;
		const deltaChar = deltaLine === 0 ? tok.char - prevChar : tok.char;
		data.push(deltaLine, deltaChar, tok.length, typeIndex[tok.type], 0);
		prevLine = tok.line;
		prevChar = tok.char;
	}
	return data;
}

function computeLineStarts(text) {
	const starts = [0];
	for (let i = 0; i < text.length; i++) {
		const ch = text.charCodeAt(i);
		if (ch === 10) starts.push(i + 1);
		else if (ch === 13) {
			if (text.charCodeAt(i + 1) === 10) i++;
			starts.push(i + 1);
		}
	}
	return starts;
}

function offsetToLineChar(offset, lineStarts) {
	let lo = 0, hi = lineStarts.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >>> 1;
		if (lineStarts[mid] <= offset) lo = mid;
		else hi = mid - 1;
	}
	return { line: lo, char: offset - lineStarts[lo] };
}

function splitByLine(tok, lineStarts, text, out) {
	const startPos = offsetToLineChar(tok.start, lineStarts);
	const endPos = offsetToLineChar(tok.end, lineStarts);
	if (startPos.line === endPos.line) {
		const length = endPos.char - startPos.char;
		if (length > 0) out.push({ line: startPos.line, char: startPos.char, length, type: tok.type });
		return;
	}
	const firstLineEnd = lineEndOffset(text, lineStarts, startPos.line);
	const firstLen = firstLineEnd - tok.start;
	if (firstLen > 0) out.push({ line: startPos.line, char: startPos.char, length: firstLen, type: tok.type });
	for (let l = startPos.line + 1; l < endPos.line; l++) {
		const len = lineEndOffset(text, lineStarts, l) - lineStarts[l];
		if (len > 0) out.push({ line: l, char: 0, length: len, type: tok.type });
	}
	if (endPos.char > 0) out.push({ line: endPos.line, char: 0, length: endPos.char, type: tok.type });
}

function lineEndOffset(text, lineStarts, line) {
	const nextStart = line + 1 < lineStarts.length ? lineStarts[line + 1] : text.length;
	let end = nextStart;
	while (end > lineStarts[line] && (text.charCodeAt(end - 1) === 10 || text.charCodeAt(end - 1) === 13)) end--;
	return end;
}

export function tokenize(text) {
	return encodeTokens(text, collectTokens(text));
}
