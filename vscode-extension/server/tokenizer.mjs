import { spruce } from "../../spruce.js";

export const TOKEN_TYPES = [
	"keyword",
	"string",
	"number",
	"macro",
	"parameter",
	"function",
	"operator",
	"decorator",
	"namespace",
	"variable",
];

export const TOKEN_MODIFIERS = [];

const typeIndex = Object.fromEntries(TOKEN_TYPES.map((t, i) => [t, i]));

// Rule handlers. Each returns true if it fully handled the node (no further
// recursion); false/undefined to fall through to default child recursion.
const handlers = {
	headingHashes(node, t) {
		emit(t, node.source.startIdx, node.source.endIdx, "keyword");
		return true;
	},

	bold(node, t) {
		const s = node.source.startIdx, e = node.source.endIdx;
		emit(t, s, s + 2, "macro");
		emit(t, e - 2, e, "macro");
	},

	italic(node, t) {
		const s = node.source.startIdx, e = node.source.endIdx;
		emit(t, s, s + 1, "parameter");
		emit(t, e - 1, e, "parameter");
	},

	boldItalic(node, t) {
		const s = node.source.startIdx, e = node.source.endIdx;
		emit(t, s, s + 3, "macro");
		emit(t, e - 3, e, "macro");
	},

	code(node, t) {
		emit(t, node.source.startIdx, node.source.endIdx, "string");
		return true;
	},

	codeBlock(node, t) {
		emit(t, node.source.startIdx, node.source.endIdx, "string");
		return true;
	},

	math(node, t) {
		emit(t, node.source.startIdx, node.source.endIdx, "number");
		return true;
	},

	inlineDisplayMath(node, t) {
		emit(t, node.source.startIdx, node.source.endIdx, "number");
		return true;
	},

	displayMath(node, t) {
		emit(t, node.source.startIdx, node.source.endIdx, "number");
		return true;
	},

	declarationBlock(node, t) {
		emit(t, node.source.startIdx, node.source.endIdx, "decorator");
		return true;
	},

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
		emit(t, node.source.startIdx, node.source.startIdx + 1, "operator");
	},
	functionCall_bare(node, t) {
		emit(t, node.source.startIdx, node.source.startIdx + 1, "operator");
	},
	functionCall_raw(node, t) {
		emit(t, node.source.startIdx, node.source.startIdx + 1, "operator");
	},
	functionCall_escaped(node, t) {
		emit(t, node.source.startIdx, node.source.endIdx, "operator");
		return true;
	},

	jsIdentifier(node, t) {
		emit(t, node.source.startIdx, node.source.endIdx, "function");
		return true;
	},

	orderedItemStarter_numeric(node, t) {
		emit(t, node.source.startIdx, node.source.endIdx, "keyword");
		return true;
	},
	orderedItemStarter_plus(node, t) {
		emit(t, node.source.startIdx, node.source.endIdx, "keyword");
		return true;
	},

	unorderedItem(node, t) {
		const offset = node.source.contents.indexOf("-");
		if (offset >= 0) {
			const s = node.source.startIdx + offset;
			emit(t, s, s + 1, "keyword");
		}
	},
};

function emit(tokens, start, end, type) {
	if (end > start) tokens.push({ start, end, type });
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
