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
	"escape",
	"invalid",
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

// Bold/italic are token *modifiers*, not types: they compose with whatever type
// a span already has (a bold link stays `linkText` green and additionally gains
// the bold style) instead of replacing it. LSP tokens can't overlap, so we can't
// layer a separate "bold" token over a link — the styling has to ride along on
// the link's own token as a modifier bit.
export const TOKEN_MODIFIERS = ["bold", "italic"];

const typeIndex = Object.fromEntries(TOKEN_TYPES.map((t, i) => [t, i]));
const modifierIndex = Object.fromEntries(TOKEN_MODIFIERS.map((m, i) => [m, i]));
const MOD_BOLD = 1 << modifierIndex.bold;
const MOD_ITALIC = 1 << modifierIndex.italic;

// Bold/italic nest (e.g. `**a *b* c**`), and the inner span should carry both
// modifiers. We thread the active set down through recursion: emitting a token
// stamps it with whatever modifiers are in scope, and entering a bold/italic
// span ORs in its bit for the duration of its children. Module scope because
// emit() (called from deep in the tree) needs to read it. Reset per document.
let activeModifiers = 0;

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
// `delimiterType` overrides the color of the delimiters themselves (used by
// wrapped function calls to paint their parens like the function name) while
// leaving the inner/sibling bracket-color sequencing untouched.
function emitBracketed(node, t, collectBody, delimiterType) {
	const open = node.children[0];
	const close = node.children[node.children.length - 1];
	const color = bracketColorCounter;
	const type = delimiterType ?? bracketType(color);
	emit(t, open.source.startIdx, open.source.endIdx, type);
	bracketColorCounter = color + 1;
	collectBody();
	bracketColorCounter = color + 1;
	emit(t, close.source.startIdx, close.source.endIdx, type);
}

// Raw environments (code blocks, inline code, math, @{} raw blocks) render their
// content as a single flat color, EXCEPT for nested @function calls, which the
// compiler still interprets and which therefore stay purple+bold like in parsed
// content. We let the body's children emit their own tokens first (so nested
// @funcs keep their function coloring), then — when `fillType` is given — paint
// the leftover gaps with that raw color. Math passes no `fillType` so its body
// stays under the embedded LaTeX grammar; only the @funcs get semantic tokens.
function emitRawBody(t, bodyNode, start, end, fillType) {
	const inner = [];
	bodyNode.collect(inner);
	inner.sort((a, b) => a.start - b.start);
	if (fillType) {
		let cursor = start;
		for (const tok of inner) {
			if (tok.start > cursor) emit(t, cursor, tok.start, fillType);
			if (tok.end > cursor) cursor = tok.end;
		}
		if (cursor < end) emit(t, cursor, end, fillType);
	}
	for (const tok of inner) t.push(tok);
}

// Rule handlers. Returning true means "fully handled, don't recurse into children";
// returning undefined falls through to recursing into all children.
const handlers = {
	heading(node, t) {
		emit(t, node.source.startIdx, node.source.endIdx, "heading");
		return true;
	},

	bold(node, t) {
		emitStyledSpan(t, node, 2, "bold", MOD_BOLD);
		return true;
	},

	italic(node, t) {
		emitStyledSpan(t, node, 1, "italic", MOD_ITALIC);
		return true;
	},

	boldItalic(node, t) {
		emitStyledSpan(t, node, 3, "boldItalic", MOD_BOLD | MOD_ITALIC);
		return true;
	},

	code(node, t) {
		// Backticks share the light-blue raw color (string), not the gray
		// marker color used for *_ delimiters. The body is raw, but nested @funcs
		// (which the compiler still interprets) keep their function coloring.
		const s = node.source.startIdx;
		const e = node.source.endIdx;
		emit(t, s, s + 1, "string");
		emitRawBody(t, node.children[1], s + 1, e - 1, "inlineCode");
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
		// The body is raw, but nested @funcs keep their function coloring.
		emitRawBody(t, node.children[6], s + langEnd, s + closeIdx, "codeBlock");
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
		// No fill type: leave the body to the embedded LaTeX grammar, but still
		// surface any nested @funcs (which the compiler interprets) as functions.
		emitRawBody(t, node.children[1], s + 1, e - 1, null);
		emit(t, e - 1, e, "string");
		return true;
	},
	inlineDisplayMath(node, t) {
		const s = node.source.startIdx;
		const e = node.source.endIdx;
		emit(t, s, s + 2, "string");
		emitRawBody(t, node.children[1], s + 2, e - 2, null);
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
		// No fill type: the body stays under the embedded LaTeX grammar; only
		// nested @funcs get semantic tokens.
		emitRawBody(t, node.children[4], s + openIdx + 2, s + closeIdx, null);
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

	// `(@name[...])` — the wrapping parens are painted like the function name
	// (spruceFunction) rather than as a bracket pair, but inner blocks still take
	// sequential bracket colors, so we take over recursion to interleave
	// open-paren / @ / body / close-paren correctly.
	functionCall_wrapped(node, t) {
		emitBracketed(node, t, () => {
			const atOffset = node.source.contents.indexOf("@");
			if (atOffset >= 0) {
				const s = node.source.startIdx + atOffset;
				emit(t, s, s + 1, "spruceFunction");
			}
			for (const c of node.children) c.collect(t);
		}, "spruceFunction");
		return true;
	},
	functionCall_bare(node, t) {
		emit(t, node.source.startIdx, node.source.startIdx + 1, "spruceFunction");
	},
	functionCall_raw(node, t) {
		emit(t, node.source.startIdx, node.source.startIdx + 1, "spruceFunction");
	},
	// Escape sequences (@] @} @@ etc.): both the escaping @ and the escaped
	// character take the light-orange escape color, so the whole 2-char sequence
	// reads as one escape unit.
	functionCall_escaped(node, t) {
		emit(t, node.source.startIdx, node.source.endIdx, "escape");
		return true;
	},

	// A bare @ that isn't a valid call (e.g. "@" followed by a space): the
	// compiler rejects it, so flag the whole sequence as invalid. Matched inside
	// raw blocks too (functionCall is part of the raw grammar), so it surfaces in
	// both parsed and raw contexts.
	functionCall_invalid(node, t) {
		emit(t, node.source.startIdx, node.source.endIdx, "invalid");
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
				// Preserve modifiers computed inside the re-matched sub-document
				// (e.g. **bold** within the block) and add any ambient ones.
				for (const tok of inner) {
					emitWith(t, tok.start + offset, tok.end + offset, tok.type, tok.modifiers | activeModifiers);
				}
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
			emitRawBody(t, body, body.source.startIdx, body.source.endIdx, "string");
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

	// Raw HTML tags (`<div>`, `</p>`, ...) get the light-blue raw color (string),
	// EXCEPT for nested @funcs (which the compiler interprets) — those keep their
	// function coloring, like any other raw environment. The rule allows leading
	// whitespace, so start at the `<` so indentation isn't colored. The body is
	// children[2] (after the optional whitespace and the `<`).
	htmlTag(node, t) {
		const offset = node.source.contents.indexOf("<");
		if (offset < 0) return true;
		const start = node.source.startIdx + offset;
		emitRawBody(t, node.children[2], start, node.source.endIdx, "string");
		return true;
	},
};

function emit(tokens, start, end, type) {
	if (end > start) tokens.push({ start, end, type, modifiers: activeModifiers });
}

// Like emit, but with an explicit modifier set instead of the ambient one.
function emitWith(tokens, start, end, type, modifiers) {
	if (end > start) tokens.push({ start, end, type, modifiers });
}

// Emit a bold/italic span: `marker` tokens for the first/last `markerLen`
// delimiter chars, then recurse into the content so nested constructs (links,
// code, @funcs, nested emphasis) keep their own colors — only OR-ing in `modBit`
// so they additionally render bold/italic. Plain text not claimed by any child
// token is filled with `contentType` (also carrying the modifier). Children and
// gap-fillers stay non-overlapping, as LSP semantic tokens require.
function emitStyledSpan(tokens, node, markerLen, contentType, modBit) {
	const s = node.source.startIdx;
	const e = node.source.endIdx;
	const contentStart = s + markerLen;
	const contentEnd = e - markerLen;
	emit(tokens, s, contentStart, "marker");
	emit(tokens, contentEnd, e, "marker");

	const prev = activeModifiers;
	activeModifiers = prev | modBit;
	const inner = [];
	for (const c of node.children) c.collect(inner);
	activeModifiers = prev;

	inner.sort((a, b) => a.start - b.start);
	let cursor = contentStart;
	for (const tok of inner) {
		if (tok.start > cursor) emitWith(tokens, cursor, tok.start, contentType, prev | modBit);
		if (tok.end > cursor) cursor = tok.end;
	}
	if (cursor < contentEnd) emitWith(tokens, cursor, contentEnd, contentType, prev | modBit);
	for (const tok of inner) tokens.push(tok);
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
	activeModifiers = 0;
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
		data.push(deltaLine, deltaChar, tok.length, typeIndex[tok.type], tok.modifiers | 0);
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
	const mod = tok.modifiers | 0;
	const startPos = offsetToLineChar(tok.start, lineStarts);
	const endPos = offsetToLineChar(tok.end, lineStarts);
	if (startPos.line === endPos.line) {
		const length = endPos.char - startPos.char;
		if (length > 0) out.push({ line: startPos.line, char: startPos.char, length, type: tok.type, modifiers: mod });
		return;
	}
	const firstLineEnd = lineEndOffset(text, lineStarts, startPos.line);
	const firstLen = firstLineEnd - tok.start;
	if (firstLen > 0) out.push({ line: startPos.line, char: startPos.char, length: firstLen, type: tok.type, modifiers: mod });
	for (let l = startPos.line + 1; l < endPos.line; l++) {
		const len = lineEndOffset(text, lineStarts, l) - lineStarts[l];
		if (len > 0) out.push({ line: l, char: 0, length: len, type: tok.type, modifiers: mod });
	}
	if (endPos.char > 0) out.push({ line: endPos.line, char: 0, length: endPos.char, type: tok.type, modifiers: mod });
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
