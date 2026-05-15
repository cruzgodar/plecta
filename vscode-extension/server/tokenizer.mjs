import { spruce } from "../../spruce.js";

export const TOKEN_TYPES = [
	"heading",
	"bold",
	"italic",
	"boldItalic",
	"inlineCode",
	"codeBlock",
	"list",
	"function",
	"string",
	"operator",
	"namespace",
	"marker",
];

export const TOKEN_MODIFIERS = [];

const typeIndex = Object.fromEntries(TOKEN_TYPES.map((t, i) => [t, i]));

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
		emitMarkered(t, node, 1, "inlineCode");
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
		emit(t, s + openIdx, s + openIdx + 3, "marker");
		emit(t, s + openIdx + 3, s + closeIdx, "codeBlock");
		emit(t, s + closeIdx, s + closeIdx + 3, "marker");
		return true;
	},

	// Embedded grammars in the TextMate file handle these — no LSP tokens.
	math(_node, _t) { return true; },
	inlineDisplayMath(_node, _t) { return true; },
	displayMath(_node, _t) { return true; },
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
		emit(t, s + closeBracket + 2, e - 1, "namespace");
	},

	functionCall_wrapped(node, t) {
		emit(t, node.source.startIdx, node.source.startIdx + 1, "function");
	},
	functionCall_bare(node, t) {
		emit(t, node.source.startIdx, node.source.startIdx + 1, "function");
	},
	functionCall_raw(node, t) {
		emit(t, node.source.startIdx, node.source.startIdx + 1, "function");
	},
	functionCall_escaped(node, t) {
		emit(t, node.source.startIdx, node.source.endIdx, "function");
		return true;
	},

	jsIdentifier(node, t) {
		emit(t, node.source.startIdx, node.source.endIdx, "function");
		return true;
	},

	// Raw blocks: the content is a string, EXCEPT for nested function calls,
	// which keep their own coloring. We let children emit their tokens first
	// (so nested @funcs render as functions), then fill the gaps with `string`.
	rawBlock(node, t) {
		const inner = [];
		for (const child of node.children) child.collect(inner);
		inner.sort((a, b) => a.start - b.start);

		const start = node.source.startIdx;
		const end = node.source.endIdx;
		let cursor = start;
		for (const tok of inner) {
			if (tok.start > cursor) emit(t, cursor, tok.start, "string");
			if (tok.end > cursor) cursor = tok.end;
		}
		if (cursor < end) emit(t, cursor, end, "string");
		for (const tok of inner) t.push(tok);
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

const semantics = spruce.createSemantics();

semantics.addOperation("collect(tokens)", {
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
});

export function collectTokens(text) {
	const match = spruce.match(text);
	if (match.failed()) return [];
	const tokens = [];
	semantics(match).collect(tokens);
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
