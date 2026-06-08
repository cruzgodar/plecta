#!/usr/bin/env node
import { randomUUID } from "crypto";
import { realpathSync, unlinkSync } from "fs";
import { readFile, unlink, writeFile } from "fs/promises";
import { register } from "module";
import * as ohm from "ohm-js";
import { extname, join, resolve as resolvePath } from "path";
import process from "process";
import { pathToFileURL } from "url";
import { makeInclude, stdlib } from "./stdlib.js";

const pendingCleanup = new Set();

// The resolve hook that reroutes absolute imports in declaration blocks runs on
// a separate thread, so it's registered once and stays for the process. Imports
// only get rerouted when their module URL carries a `?spruceRoot=` marker, so
// registering this unconditionally is a no-op until a root is in play.
let importHooksRegistered = false;
function ensureImportHooks()
{
	if (!importHooksRegistered)
	{
		register("./importHooks.js", import.meta.url);
		importHooksRegistered = true;
	}
}

// Turns a user-facing include() specifier into a URL to dynamically import.
// It can't lean on default ESM resolution, because that would resolve relative
// to stdlib.js (where include lives) rather than to the document. So it mirrors
// importHooks.js by hand: relative specifiers resolve against the fragment's
// base dir, absolute "/x" against --root, and bare specifiers fall through to
// node's package resolution. When a root is in play the URL is tagged with
// `?spruceRoot` (and the hooks armed) so the included file's own absolute
// imports keep rerouting against the same root, exactly as a static import in a
// declaration block would.
function makeIncludeResolver(baseDir, root)
{
	return (specifier) =>
	{
		let url;
		if (specifier.startsWith("/"))
		{
			url = pathToFileURL(join(root ?? "/", specifier));
		}
		else if (specifier.startsWith("."))
		{
			url = pathToFileURL(resolvePath(baseDir, specifier));
		}
		else
		{
			return specifier;
		}

		if (root)
		{
			url.searchParams.set("spruceRoot", root);
			ensureImportHooks();
		}

		return url.href;
	};
}

const bt = "`";

// Named stdlib functions that aren't callable inline as @name[...]. After the
// body is fully assembled, each is invoked in order on the running result, so
// the value compile returns is `lastHook(...firstHook(body)...)`. To add
// another whole-document transform, append its name here and provide a
// matching function on the format's stdlib entry.
const POST_COMPILE_HOOKS = ["document"];

// Reserved property on __spruceOutput where the generated module stashes any
// declaration-block binding (declared or imported) that shadows a post-compile
// hook. These hooks run on the host *after* the module, so unlike inline
// @-calls they can't be shadowed from module scope directly — we ferry the
// override out so the host can prefer it over the stdlib default.
const HOOK_OVERRIDES_KEY = "__spruceHookOverrides";

// The parsed/inline/raw block delimiters can be prefixed with any number of
// hashes (`#[[`, `##[[`, `###[[`, ...) to nest blocks past inner closers. Rather
// than hardcode a fixed ceiling, we scan each input for the deepest hash run that
// actually appears (see maxHashDepth) and generate exactly that many alternatives
// on demand, longest-first so the greedy match wins.
function blockRules(maxHashes)
{
	const parsed = [];
	const inline = [];
	const raw = [];
	const json = [];

	for (let n = maxHashes; n >= 1; n--)
	{
		const h = "#".repeat(n);
		parsed.push(`"${h}[[" (~"]]${h}" any)* "]]${h}"`);
		inline.push(`"${h}[" inlineWithoutEscapable<~"]${h}" any>+ "]${h}"`);
		raw.push(`"${h}{" (functionCall | (~"}${h}" any))+ "}${h}"`);
		json.push(`"${h}(" (functionCall | (~")${h}" any))+ ")${h}"`);
	}

	parsed.push(`"[[" (~"]]" any)* "]]"`);
	inline.push(`"[" inlineWithoutEscapable<~"]" any>* "]"`);
	raw.push(`"{" (functionCall | (~"}" any))* "}"`);
	json.push(`"(" (functionCall | (~")" any))* ")"`);

	const join = alts => alts.join("\n\t| ");

	return `parsedBlock
	= ${join(parsed)}

  parsedInlineBlock
	= ${join(inline)}

  rawBlock
	= ${join(raw)}

  jsonBlock
	= ${join(json)}`;
}

function buildGrammarSource(maxHashes)
{
	return String.raw`
spruce {
  document = chunk*

  // Raw-mode start rule (see compile's raw flag): the whole document is raw,
  // so only declaration blocks and function calls are interpreted and every other
  // character is literal, exactly as inside a @{} raw block. declarationBlock is
  // tried first (its @@@ opener would otherwise be eaten as an escaped @), then
  // functionCall, so @-calls win over the catch-all any.
  rawDocument = (declarationBlock | functionCall | any)*

  chunk
    = heading
    | codeBlock
    | displayMath
    | declarationBlock
    | unorderedList
    | orderedList
	| htmlTag
    | (spaceOrTab* newline) --blankLine          // Needs to be above paragraph or else newlines will always lead to paragraphs
    | functionCallChunk
    | paragraph
  
  
  
  heading = spaceOrTab* headingHashes spaceOrTab+ inline<~(newline | end) any>+
  headingHashes = "#" "#"? "#"? "#"? "#"? "#"?
  
  
  
  codeBlock
    = spaceOrTab* "${bt}${bt}${bt}" spaceOrTab* alnum* spaceOrTab* newline
      raw<~(newline spaceOrTab* "${bt}${bt}${bt}" (newline | end)) any>*
      newline spaceOrTab* "${bt}${bt}${bt}" &(newline | end)
  
  
  
  displayMath
    = spaceOrTab* "$$" spaceOrTab* newline
      raw<~(newline spaceOrTab* "$$" (newline | end)) any>*
      newline spaceOrTab* "$$" &(newline | end)
  
  
  
  declarationBlock
    = spaceOrTab* "@@@" spaceOrTab* alnum* spaceOrTab* newline
    declarationBlockBody
    declarationBlockTerminator
  
  declarationBlockBody = (~(newline spaceOrTab* "@@@") any)*

  declarationBlockTerminator
    = newline spaceOrTab* "@@@" spaceOrTab* &(newline | end) --hard
    | newline &(spaceOrTab* "@@@" spaceOrTab* alnum)         --soft
  
  
  
  unorderedList = spaceOrTab* unorderedItem (newline space* unorderedItem)* &(newline | end)
  unorderedItem = "-" spaceOrTab+ inline<~(newline | end) any>+

  orderedList = spaceOrTab* orderedItem (newline space* orderedItem)* &(newline | end)
  orderedItem = orderedItemStarter spaceOrTab+ inline<~(newline | end) any>+
  orderedItemStarter
    = (digit+ ".") --numeric
    | "+"          --plus



  htmlTag = spaceOrTab* "<" (functionCall | (~newline any))*
  
  
  
  paragraph = spaceOrTab* inline<~(doubleNewline | end) ~(newline spaceOrTab* "<") any>+

  boldItalic
    = "***" inline<~"***" any>+ "***"
    | "___" inline<~"___" any>+ "___"

  bold
    = "**" ~"*" inline<~"**" any>+ "**" ~"*"
    | "__" ~"_" inline<~"__" any>+ "__" ~"_"

  italic
    = "*" ~"*" inline<~"*" any>+ "*" ~"*"
    | "_" ~"_" inline<~"_" any>+ "_" ~"_"
  
  // This uses inlineWithoutEscapable, because otherwise the display text
  // can eat ] characters
  link
    = "[" inlineWithoutEscapable<~"]" any>+ "]"
      "(" raw<~")" ~doubleNewline any>+ ")"

  // Code and math are non-folding
  code = "${bt}" ~"${bt}" raw<~"${bt}" ~doubleNewline any>+ "${bt}" ~"${bt}"

  math = "$" ~"$" raw<~"$" ~doubleNewline any>+ "$" ~"$"
  inlineDisplayMath = "$$" raw<~"$$" ~doubleNewline any>+ "$$"

  // A run of text desugars to (@text[...]) and is later re-parsed, so literal
  // [ ] in prose would collide with that argument's own delimiters (or, for a
  // leading [, form a spurious [[ block opener). The text rule excludes [ ] so
  // they fall through to parsedBlockEscapable here, which desugars them to @[/@]
  // — a desugaring action rather than a string rewrite. inlineWithoutEscapable
  // comes first so link (which also opens with [) still wins over the escape.
  inline<allowed> = inlineWithoutEscapable<allowed> | parsedBlockEscapable

  inlineWithoutEscapable<allowed>
    = boldItalic
    | bold
    | italic
    | code
    | math
    | inlineDisplayMath
    | link
    | functionCall
    | (~boldItalic ~bold ~italic ~code ~math ~inlineDisplayMath ~link ~functionCall ~"[" ~"]" allowed)+ --text
 

  // The raw content of code blocks, display math, etc.
  raw<allowed> = rawBlockEscapable | functionCall | allowed

  newline = "\r\n" | "\n" | "\r"
  doubleNewline = newline spaceOrTab* newline
  
  spaceOrTab = " " | "\t"
  
  

  functionCallChunk = spaceOrTab* functionCall spaceOrTab* (newline | end)
  
  functionCall
    = "(" spaceOrTab* "@" space* jsIdentifier spacePaddedBlock* space* ")" --wrapped
    | "@" spaceOrTab* jsIdentifier spaceOrTabPaddedBlock*                  --bare
    | "@" spaceOrTab* rawBlock                                             --raw
    | "@" (~space any)                                                     --escaped
    | "@" space                                                            --invalid
    
  jsIdentifier = jsIdentifierStart jsIdentifierPart*
  jsIdentifierStart = letter | "_" | "$"
  jsIdentifierPart = jsIdentifierStart | digit
  
  spacePaddedBlock = space* parsedOrRawBlock
  spaceOrTabPaddedBlock = spaceOrTab* parsedOrRawBlock
  parsedOrRawBlock = parsedBlock | parsedInlineBlock | rawBlock | jsonBlock

  ${blockRules(maxHashes)}

  parsedBlockEscapable = "[" | "]"
  rawBlockEscapable = "}"
}`;
}

// Find the deepest run of hashes that forms part of a block delimiter, i.e. one
// immediately followed by an opening bracket/brace/paren (`###[`, `##{`, `#(`, ...)
// or immediately preceded by a closing one (`]###`, `}##`, `)#`, ...). The result
// bounds how many delimiter alternatives the on-demand grammar needs.
function maxHashDepth(text)
{
	let max = 0;
	const re = /#+(?=[[{(])|(?<=[\]})])#+/g;
	let match;
	while ((match = re.exec(text)))
	{
		if (match[0].length > max) max = match[0].length;
	}
	return max;
}

// Compiled grammars (and their attached semantics) are cached by hash depth so
// repeated compiles of similar documents reuse the same instance.
const grammarCache = new Map();

// The grammar and semantics currently in use. They're swapped per input by
// useGrammar so the semantics handlers below (which re-match nested blocks
// against `spruce`) always see the variant that can parse the active document.
let spruce;
let semantics;

function useGrammar(maxHashes)
{
	let entry = grammarCache.get(maxHashes);

	if (!entry)
	{
		const grammar = ohm.grammar(buildGrammarSource(maxHashes));
		entry = { grammar, semantics: attachSemantics(grammar.createSemantics()) };
		grammarCache.set(maxHashes, entry);
	}

	spruce = entry.grammar;
	semantics = entry.semantics;
	return entry;
}

// Build (or reuse) the grammar that can parse `text`, make it active, and return
// the compiled grammar. Used by tooling (e.g. the editor tokenizer) that needs
// the ohm grammar directly rather than going through compile().
export function grammarFor(text)
{
	return useGrammar(maxHashDepth(text)).grammar;
}

// Each handler that emits a function call into the desugared output captures
// its location in the *original* source. The id is a sequential counter shared
// with getCode — both walk their parse trees in source order, so the nth
// emitted function call here matches the nth function call getCode encounters.
let nextFunctionCallId = 0;
let functionCallLocations = {};

let declarationBlockOriginalLines = [];

// parsedBlock ([[ ]]) re-matches its body as a fresh document, so getLineAndColumn
// on nodes inside that re-match is relative to the body substring (its line 1),
// not the original source. This is the line-based analog of getCodeOffset: it
// holds the original-source line number that the current re-match's line 1 maps
// to, and accumulates through nesting. Reset by desugar(); pushed/popped around
// each re-match in parsedBlock. captureFunctionCall folds it into stored lineNums
// so runtime errors point at the real source line.
let desugarLineBase = 1;

function globalizeLineNum(localLineNum)
{
	return desugarLineBase + localLineNum - 1;
}

function captureFunctionCall(node)
{
	const location = node.source.getLineAndColumn();
	location.lineNum = globalizeLineNum(location.lineNum);
	functionCallLocations[nextFunctionCallId++] = location;
}

// Convert all syntactic sugar to function calls, escaping characters as necessary.
// The only characters that are unescaped are those in raw environments that would
// no longer considered valid escape sequences when desugaring.
// Attach all operations to a freshly created semantics for a given grammar.
// Called once per cached grammar variant by useGrammar.
function attachSemantics(sem)
{
	sem.addOperation("desugar", desugarOperation);
	sem.addOperation("getCode", getCodeOperation);
	sem.addOperation("insertCodeOutput(__spruceOutput)", insertCodeOutputOperation);
	return sem;
}

const desugarOperation = {
	heading(_1, hashes, _2, body)
	{
		captureFunctionCall(this);
		return `(@heading[${body.desugar()}]{${hashes.sourceString.length}})`;
	},

	codeBlock(_1, _2, _3, language, _4, _5, body, _6, _7, _8, _9)
	{
		captureFunctionCall(this);
		return `(@codeBlock{${body.desugar()}}{${language.desugar()}})`;
	},

	displayMath(_1, _2, _3, _4, body, _5, _6, _7, _8)
	{
		captureFunctionCall(this);
		return `(@displayMath{${body.desugar()}})`;
	},

	declarationBlock(_1, _2, _3, scope, _4, _5, body, _6)
	{
		declarationBlockOriginalLines.push(globalizeLineNum(body.source.getLineAndColumn().lineNum));
		return this.sourceString;
	},

	unorderedList(_1, firstItem, _2, _3, restItems, _4)
	{
		captureFunctionCall(this);
		const restItemsWrapped = restItems.children.map(item => `[${item.desugar()}]`).join("");

		return `(@unorderedList[${firstItem.desugar()}]${restItemsWrapped})`;
	},

	unorderedItem(_1, _2, body)
	{
		return body.desugar();
	},

	orderedList(_1, firstItem, _2, _3, restItems, _4)
	{
		captureFunctionCall(this);
		const restItemsWrapped = restItems.children.map(item => `[${item.desugar()}]`).join("");

		return `(@orderedList[${firstItem.desugar()}]${restItemsWrapped})`;
	},

	orderedItem(_1, _2, body)
	{
		return body.desugar();
	},

	paragraph(_1, body)
	{
		captureFunctionCall(this);
		return `(@paragraph[${body.desugar()}])`;
	},



	boldItalic(_1, body, _2)
	{
		captureFunctionCall(this);
		return `(@boldItalic[${body.desugar()}])`;
	},

	bold(_1, body, _2)
	{
		captureFunctionCall(this);
		return `(@bold[${body.desugar()}])`;
	},

	italic(_1, body, _2)
	{
		captureFunctionCall(this);
		return `(@italic[${body.desugar()}])`;
	},

	link(_1, displayText, _2, _3, url, _4)
	{
		captureFunctionCall(this);
		return `(@link[${displayText.desugar()}]{${url.desugar()}})`;
	},

	code(_1, body, _2)
	{
		captureFunctionCall(this);
		return `(@code{${body.desugar()}})`;
	},

	math(_1, body, _2)
	{
		captureFunctionCall(this);
		return `(@math{${body.desugar()}})`;
	},

	inlineDisplayMath(_1, body, _2)
	{
		captureFunctionCall(this);
		return `(@inlineDisplayMath{${body.desugar()}})`;
	},

	inlineWithoutEscapable_text(body)
	{
		// Must capture here even though @text is generated rather than written by
		// the user: getCode counts every wrapped/bare call it walks in the desugared
		// tree (including this one), so skipping the capture would shift every
		// subsequent call's location by one and misattribute runtime errors.
		captureFunctionCall(this);
		return `(@text[${body.desugar()}])`;
	},

	

	functionCall_wrapped(_1, _2, _3, _4, name, spacePaddedBlocks, _5, _6)
	{
		captureFunctionCall(this);
		return `(@${name.desugar()}${spacePaddedBlocks.desugar()})`;
	},

	functionCall_bare(_1, _2, name, spaceOrTabPaddedBlocks)
	{
		captureFunctionCall(this);
		return `@${name.desugar()}${spaceOrTabPaddedBlocks.desugar()}`;
	},

	functionCall_raw(_1, _2, block)
	{
		return `@${block.desugar()}`;
	},

	functionCall_escaped(_1, character)
	{
		return this.sourceString;
	},

	functionCall_invalid(_1, space)
	{
		const { lineNum, colNum } = this.source.getLineAndColumn();
		renderContext(this.source.sourceString, lineNum, line =>
		{
			const startCol = colNum - 1;
			const before = line.slice(0, startCol);
			const offending = line.slice(startCol, startCol + 2); // @ + the space
			const after = line.slice(startCol + 2);
			return `${before}${RED_BOLD}${offending}${RESET}${after}`;
		});
		throw new Error(`Expected an identifier, parentheses, or raw block following @.`);
	},

	jsIdentifier(_1, _2)
	{
		return this.sourceString;
	},

	spacePaddedBlock(_1, block)
	{
		return block.desugar();
	},

	spaceOrTabPaddedBlock(_1, block)
	{
		return block.desugar();
	},

	parsedBlock(start, body, end)
	{
		const inner = spruce.match(body.sourceString, "document");

		if (inner.failed())
		{
			throw new Error(inner.message);
		}

		// Shift the line base so nested captures globalize correctly: the re-match's
		// line 1 corresponds to the original-source line where this body begins.
		// Mirrors getCode's getCodeOffset bookkeeping, but line-based. Restore after.
		const savedBase = desugarLineBase;
		desugarLineBase = globalizeLineNum(body.source.getLineAndColumn().lineNum);
		const innerDesugared = semantics(inner).desugar();
		desugarLineBase = savedBase;

		return `${start.desugar()}${innerDesugared}${end.desugar()}`;
	},

	parsedInlineBlock(start, body, end)
	{
		return `${start.desugar()}${body.desugar()}${end.desugar()}`;
	},

	rawBlock(start, body, end)
	{
		return `${start.desugar()}${body.desugar()}${end.desugar()}`;
	},

	// Like rawBlock: preserve the (...) delimiters and desugar the body (so nested
	// @-calls and escapes are rewritten) so the re-parse re-recognizes it as a
	// jsonBlock argument. getCode wraps the body in JSON.parse(...) at the call site.
	jsonBlock(start, body, end)
	{
		return `${start.desugar()}${body.desugar()}${end.desugar()}`;
	},



	parsedBlockEscapable(character)
	{
		return `@${character.desugar()}`;
	},

	rawBlockEscapable(character)
	{
		return `@${character.desugar()}`;
	},



	_terminal()
	{
		return this.sourceString;
	},

	_nonterminal(...children)
	{
		return children.map(c => c.desugar()).join("");
	},

	_iter(...children)
	{
		return children.map(c => c.desugar()).join("");
	},
};



// Produces the code to be run. We do *not* want this to be nested, so they
// get written in order to this accumulator, which is reset by getCode().
// getCode walks the desugared parse tree in the same order desugar walked the
// original, so the nth function call here corresponds to the nth captured
// location — we use that to rekey locations by desugared startIdx.
//
// Function-call arguments are emitted as JS template literals so that nested
// function calls can interpolate via `${<storageName>[<id>]}`. Raw text
// pieces therefore need to be escaped for use inside a template literal.
//
// `storageName` is the identifier under which results are accumulated in the
// generated module. It is randomized per compile (see the getCode wrapper)
// so that user code in declaration blocks can't reach in by name and tamper
// with it; the module re-exports it under the stable alias `__spruceOutput`
// so the host's `module.__spruceOutput` read still resolves.
let codeToExecute = "";
let nextGetCodeId = 0;
// parsedBlock re-matches its body as a fresh document (the grammar stores it as
// raw text), so nested calls come back with startIdx relative to that body —
// 0-based, and thus colliding across sibling parsed-block arguments. We add this
// running offset (the body's global start, accumulated through nesting) to every
// id so each call recovers its true startIdx in the desugared document and stays
// unique. Reset by getCode(); pushed/popped around each re-match in parsedBlock.
let getCodeOffset = 0;
let locationsByStartIdx = {};
let nextGetCodeDeclarationId = 0;
let declarationBlockRanges = [];
let storageName = "__spruceOutput";
let currentOutputFormat = "";

function escapeForTemplate(s)
{
	return s
		.replace(/\\/g, "\\\\")
		.replace(/`/g, "\\`")
		.replace(/\$\{/g, "\\${");
}

// A function-call argument block compiles to a JS expression. parsed/inline/raw
// blocks become a template literal so their text (and any nested `${...}` call
// results) flows through as a string. A jsonBlock instead runs that same text
// through JSON.parse, so the function receives a real number/boolean/array/object
// rather than a string. `block` is the parsedOrRawBlock node; its first child is
// the matched alternative, whose rule name tells the two paths apart.
function compileArgument(block)
{
	const inner = block.getCode();
	return block.child(0).ctorName === "jsonBlock"
		? `JSON.parse(\`${inner}\`)`
		: "`" + inner + "`";
}

const getCodeOperation = {
	declarationBlock(_1, _2, _3, scope, _4, _5, body, _6)
	{
		const originalStart = declarationBlockOriginalLines[nextGetCodeDeclarationId++];

		if (!scope.sourceString || scope.sourceString === currentOutputFormat)
		{
			const linesBefore = codeToExecute.split("\n").length;
			codeToExecute += "\n" + body.sourceString + "\n\n";

			// +1: leading "\n" lands the body on the next line in codeToExecute.
			// +1: runCode prepends an `export const __spruceOutput = {};` line.
			const generatedStart = linesBefore + 2;
			const bodyLineCount = body.sourceString.split("\n").length;

			declarationBlockRanges.push({
				generatedStart,
				generatedEnd: generatedStart + bodyLineCount - 1,
				originalStart,
			});
		}

		return "";
	},

	functionCall_wrapped(_1, _2, _3, _4, name, spacePaddedBlocks, _5, _6)
	{
		const startIdx = this.source.startIdx + getCodeOffset;
		const id = JSON.stringify(startIdx);

		locationsByStartIdx[startIdx] = functionCallLocations[nextGetCodeId++];

		const functionArguments = spacePaddedBlocks.children
			.map(block => block.getCode())
			.join(",");

		const nameCode = name.getCode();

		// With args, do a plain call so a non-function (i.e. a constant) lets
		// JS throw a TypeError that logSourceError can render. Without args,
		// keep the typeof guard so a bare `@x` resolves to the constant value.
		const rhs = spacePaddedBlocks.children.length > 0
			? `${nameCode}(${functionArguments})`
			: `typeof ${nameCode} === "function" ? ${nameCode}() : ${nameCode}`;

		codeToExecute += `${storageName}[${id}] = ${rhs};\n`;

		return "${" + storageName + "[" + id + "]}";
	},

	functionCall_bare(_1, _2, name, spaceOrTabPaddedBlocks)
	{
		const startIdx = this.source.startIdx + getCodeOffset;
		const id = JSON.stringify(startIdx);

		locationsByStartIdx[startIdx] = functionCallLocations[nextGetCodeId++];

		const functionArguments = spaceOrTabPaddedBlocks.children
			.map(block => block.getCode())
			.join(",");

		const nameCode = name.getCode();

		const rhs = spaceOrTabPaddedBlocks.children.length > 0
			? `${nameCode}(${functionArguments})`
			: `typeof ${nameCode} === "function" ? ${nameCode}() : ${nameCode}`;

		codeToExecute += `${storageName}[${id}] = ${rhs};\n`;

		return "${" + storageName + "[" + id + "]}";
	},

	functionCall_raw(_1, _2, block)
	{
		return block.getCode();
	},

	functionCall_escaped(_1, character)
	{
		return character.getCode();
	},

	jsIdentifier(_1, _2)
	{
		return this.sourceString;
	},

	// Both padded-block forms are only ever a function-call argument, so they
	// own the wrapping: a string template literal, or JSON.parse for a jsonBlock.
	spacePaddedBlock(_1, block)
	{
		return compileArgument(block);
	},

	spaceOrTabPaddedBlock(_1, block)
	{
		return compileArgument(block);
	},

	parsedBlock(open, body, close)
	{
		const inner = spruce.match(body.sourceString, "document");

		if (inner.failed())
		{
			throw new Error(inner.message);
		}

		// The re-match restarts startIdx at 0, so shift ids by the body's global
		// start (relative to the current source, itself already shifted for nested
		// blocks) and restore afterward. This recovers each nested call's true
		// startIdx in the desugared document, keeping ids unique across siblings.
		const saved = getCodeOffset;
		getCodeOffset = saved + body.source.startIdx;
		const code = semantics(inner).getCode();
		getCodeOffset = saved;

		return code;
	},

	parsedInlineBlock(_1, body, _2)
	{
		return body.getCode();
	},

	rawBlock(_1, body, _2)
	{
		return body.getCode();
	},

	// Same template-literal body as a raw block; compileArgument wraps it in
	// JSON.parse(`...`) so the text is parsed into a real value at runtime.
	jsonBlock(_1, body, _2)
	{
		return body.getCode();
	},



	_terminal()
	{
		return escapeForTemplate(this.sourceString);
	},

	_nonterminal(...children)
	{
		return children.map(c => c.getCode()).join("");
	},

	_iter(...children)
	{
		return children.map(c => c.getCode()).join("");
	},
};



const insertCodeOutputOperation = {
	declarationBlock(_1, _2, _3, scope, _4, _5, body, _6)
	{
		return "";
	},

	functionCall_wrapped(_1, _2, _3, _4, name, spacePaddedBlocks, _5, _6)
	{
		const id = JSON.stringify(this.source.startIdx);
		return this.args.__spruceOutput[id];
	},

	functionCall_bare(_1, _2, name, spaceOrTabPaddedBlocks)
	{
		const id = JSON.stringify(this.source.startIdx);
		return this.args.__spruceOutput[id];
	},

	functionCall_raw(_1, _2, block)
	{
		return block.insertCodeOutput(this.args.__spruceOutput);
	},

	functionCall_escaped(_1, character)
	{
		// Final output pass: emit the literal character. Unlike getCode (which
		// escapes for embedding in a generated template literal), this string is
		// the output itself, so escaping here would leak a stray backslash for
		// characters like ` that escapeForTemplate touches.
		return character.sourceString;
	},

	rawBlock(_1, body, _2)
	{
		return body.insertCodeOutput(this.args.__spruceOutput);
	},



	_terminal()
	{
		return this.sourceString;
	},

	_nonterminal(...children)
	{
		return children.map(c => c.insertCodeOutput(this.args.__spruceOutput)).join("");
	},

	_iter(...children)
	{
		return children.map(c => c.insertCodeOutput(this.args.__spruceOutput)).join("");
	},
};



function desugar(matchResult)
{
	nextFunctionCallId = 0;
	functionCallLocations = {};
	declarationBlockOriginalLines = [];
	desugarLineBase = 1;
	return semantics(matchResult).desugar();
}

function getCode(matchResult, outputFormat)
{
	codeToExecute = "";
	nextGetCodeId = 0;
	getCodeOffset = 0;
	locationsByStartIdx = {};
	nextGetCodeDeclarationId = 0;
	declarationBlockRanges = [];
	storageName = `__spruce_${randomUUID().replaceAll("-", "_")}`;
	currentOutputFormat = outputFormat;

	semantics(matchResult).getCode();

	return {
		codeToExecute,
		functionCallLocations: locationsByStartIdx,
		declarationBlockRanges,
		storageName,
	};
}

function insertCodeOutput(matchResult, __spruceOutput)
{
	return semantics(matchResult).insertCodeOutput(__spruceOutput);
}

const RED_BOLD = "\x1b[1;31m";
const RESET = "\x1b[0m";

function renderContext(source, errorLine, highlightContent)
{
	const sourceLines = source.split("\n");
	const numContextLines = 3;
	const start = Math.max(0, errorLine - numContextLines - 1);
	const end = Math.min(sourceLines.length, errorLine + numContextLines);

	const parts = [];

	for (let i = start; i < end; i++)
	{
		const lineNum = String(i + 1).padStart(4);
		const lineContent = sourceLines[i];

		if (i + 1 === errorLine)
		{
			parts.push(`${RED_BOLD}${lineNum}${RESET} | ${highlightContent(lineContent)}`);
		}
		else
		{
			parts.push(`${lineNum} | ${lineContent}`);
		}
	}

	console.log(parts.join("\n"));
}

function logSourceError(ex, body, source, functionCallLocations, declarationBlockRanges, storageName)
{
	const stack = ex.stack || `${ex}`;
	// With --root the fragment is imported with a `?spruceRoot=...` query string,
	// so the stack frame reads `.__fragments_<uuid>.mjs?spruceRoot=/x:LINE:COL`.
	// Allow (and skip) that optional query between `.mjs` and the line:col.
	const fragmentMatch = stack.match(/\.__fragments_[^:?]+\.mjs(?:\?[^:]*)?:(\d+):\d+/);

	if (!fragmentMatch) return false;

	const errorLineInBody = parseInt(fragmentMatch[1]);
	const bodyLine = body.split("\n")[errorLineInBody - 1] || "";
	// Matches both forms emitted by getCode:
	//   <storageName>[N] = name(...);
	//   <storageName>[N] = typeof name === "function" ? name() : name;
	// storageName is `__spruce_<uuid-hex>` (only [a-zA-Z0-9_]), regex-safe.
	const callMatch = bodyLine.match(new RegExp(
		`${storageName}\\[(\\d+)\\]\\s*=\\s*(?:typeof\\s+)?([A-Za-z_$][\\w$]*)`
	));

	if (callMatch)
	{
		const [, id, funcName] = callMatch;
		const location = functionCallLocations[id];

		if (!location) return false;

		renderContext(source, location.lineNum, lineContent =>
		{
			const funcIdx = lineContent.indexOf(funcName);

			if (funcIdx >= 0)
			{
				const before = lineContent.slice(0, funcIdx);
				const after = lineContent.slice(funcIdx + funcName.length);
				return `${before}${RED_BOLD}${funcName}${RESET}${after}`;
			}

			return `${RED_BOLD}${lineContent}${RESET}`;
		});

		return true;
	}

	for (const range of declarationBlockRanges)
	{
		if (errorLineInBody >= range.generatedStart && errorLineInBody <= range.generatedEnd)
		{
			const originalLine = range.originalStart + (errorLineInBody - range.generatedStart);
			renderContext(source, originalLine, lineContent => `${RED_BOLD}${lineContent}${RESET}`);
			return true;
		}
	}

	return false;
}

async function runCode(code, source, functionCallLocations, declarationBlockRanges, storageName, root = null, baseDir = process.cwd())
{
	// Post-compile hooks (e.g. `document`) run on the host after this module,
	// so a declaration-block binding can't shadow them the way inline @-calls
	// do. Capture any such binding into the storage object as an epilogue —
	// `typeof` stays safe when the name was never declared — so the host can
	// prefer it over the stdlib default. Appended after the user code, so it
	// doesn't shift any declarationBlockRanges line offsets.
	const captureOverrides = POST_COMPILE_HOOKS
		.map(name => `if(typeof ${name}!=="undefined")(${storageName}[${JSON.stringify(HOOK_OVERRIDES_KEY)}]??={})[${JSON.stringify(name)}]=${name};`)
		.join("\n");

	// One-line prelude so declarationBlockRanges' line offset (linesBefore + 2)
	// stays correct. The storage var is randomized; the export-as alias keeps
	// `module.__spruceOutput` resolving for the host-side read below.
	const body = `const ${storageName} = {}; export { ${storageName} as __spruceOutput };
${code}
${captureOverrides}`;
	if (process.env.SPRUCE_DEBUG_BODY) console.error("---BODY---\n" + body + "\n---END---");

	const path = join(baseDir, `.__fragments_${randomUUID()}.mjs`);

	await writeFile(path, body);
	pendingCleanup.add(path);

	// Tag the import URL with the root so importHooks.js can reroute absolute
	// ("/x") specifiers in this block — and its import subgraph — to <root>/x.
	const moduleUrl = pathToFileURL(path);
	if (root)
	{
		moduleUrl.searchParams.set("spruceRoot", root);
		ensureImportHooks();
	}

	try
	{
		const module = await import(moduleUrl.href);
		await unlink(path).catch(() => {});
		pendingCleanup.delete(path);
		return module.__spruceOutput;
	}

	catch(ex)
	{
		await unlink(path).catch(() => {});
		pendingCleanup.delete(path);
		const rendered = logSourceError(ex, body, source, functionCallLocations, declarationBlockRanges, storageName);
		const error = new Error(`${ex}`);
		// Tell the CLI whether renderContext already printed the offending line, so
		// it can suppress the noisy JS stack and just exit when we've shown context.
		error.spruceContextRendered = rendered;
		throw error;
	}
}

process.on("exit", () =>
{
	for (const path of pendingCleanup)
	{
		try { unlinkSync(path); } catch {}
	}
});

process.on("SIGINT", () => process.exit(130))



// Serialize compile() calls. desugar/getCode share module-level state across
// await boundaries; the globalThis snapshot below also needs single-owner
// access. Chaining keeps the public API a plain async function.
let compileQueue = Promise.resolve();

export function compile(input, outputFormat, filePath = null, root = null, raw = false)
{
	const next = compileQueue.then(() => _compileImpl(input, outputFormat, filePath, root, raw));
	compileQueue = next.catch(() => {});
	return next;
}

async function _compileImpl(input, outputFormat, filePath, root, raw)
{
	// Snapshot the keys we're about to splat so we can restore on the way out.
	// Users still override behavior by declaring/importing the name in their
	// document — that shadows globalThis during the generated module's
	// execution exactly as before — but after compile() returns, the host's
	// globalThis is unchanged.
	const snapshot = [];
	const setGlobal = (key, value) =>
	{
		snapshot.push(Object.hasOwn(globalThis, key)
			? { key, had: true, value: globalThis[key] }
			: { key, had: false });
		globalThis[key] = value;
	};

	if (Object.hasOwn(stdlib, outputFormat))
	{
		for (const [key, value] of Object.entries(stdlib[outputFormat]))
		{
			if (POST_COMPILE_HOOKS.includes(key)) continue;
			setGlobal(key, value);
		}
	}

	// `include` is format-independent and shares the snapshot above, so any names
	// it splats onto globalThis are restored alongside the stdlib when we return.
	// The resolver mirrors importHooks.js: relative specifiers resolve against the
	// fragment's base dir (cwd, matching runCode), absolute "/x" against --root.
	setGlobal("include", makeInclude(makeIncludeResolver(process.cwd(), root), setGlobal));

	try
	{
		// Build the grammar for this input's hash depth and make it active before
		// any matching. Desugaring only ever reduces hash depth, so the same
		// grammar parses both the original input and the desugared output.
		useGrammar(maxHashDepth(input));

		// In raw mode the whole document is treated as raw content (as if wrapped in
		// @{}): only @-calls are interpreted, everything else is literal. Both the
		// initial match and the post-desugar re-match use the rawDocument start rule
		// so the desugared output is re-parsed under the same raw semantics.
		const startRule = raw ? "rawDocument" : "document";
		const desugared = desugar(spruce.match(input, startRule));
		const desugaredMatch = spruce.match(desugared, startRule);
		const { codeToExecute, functionCallLocations, declarationBlockRanges, storageName } = getCode(desugaredMatch, outputFormat);
		const __spruceOutput = await runCode(codeToExecute, input, functionCallLocations, declarationBlockRanges, storageName, root);
		let result = insertCodeOutput(desugaredMatch, __spruceOutput);

		const formatStdlib = stdlib[outputFormat];
		// A declaration block can shadow a post-compile hook by declaring or
		// importing its name; that override (if any) was ferried out on the
		// storage object and takes precedence over the stdlib default.
		const hookOverrides = __spruceOutput?.[HOOK_OVERRIDES_KEY] ?? {};
		for (const name of POST_COMPILE_HOOKS)
		{
			const hook = hookOverrides[name] ?? formatStdlib?.[name];
			if (typeof hook === "function")
			{
				result = hook(result, filePath);
			}
		}

		return result;
	}
	finally
	{
		for (const entry of snapshot)
		{
			if (entry.had) globalThis[entry.key] = entry.value;
			else delete globalThis[entry.key];
		}
	}
}

// process.argv[1] may be a symlink (e.g. the `spruce` bin installed by
// `npm link`/`npm install -g`), so resolve it to the real path before
// comparing against this module's URL — otherwise the CLI silently no-ops.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
{
	const argv = process.argv.slice(2);
	const positional = [];
	let formatOverride = null;
	let rootOverride = null;
	let rawMode = false;

	for (let i = 0; i < argv.length; i++)
	{
		const arg = argv[i];
		if (arg === "-f" || arg === "--format")
		{
			formatOverride = argv[++i];
		}
		else if (arg === "--root")
		{
			rootOverride = argv[++i];
		}
		else if (arg === "-r" || arg === "--raw")
		{
			rawMode = true;
		}
		else
		{
			positional.push(arg);
		}
	}

	const [inputPath, outputPath] = positional;

	if (!inputPath || !outputPath)
	{
		process.stderr.write("usage: spruce <input> <output> [-f|--format <format>] [--root <dir>] [-r|--raw]\n");
		process.exit(1);
	}

	const outputFormat = formatOverride ?? extname(outputPath).slice(1).toLowerCase();
	// Resolve --root against the cwd so relative roots behave intuitively.
	const root = rootOverride ? resolvePath(rootOverride) : null;

	const input = await readFile(inputPath, "utf-8");
	try
	{
		// Pass the absolute input path so post-compile hooks (e.g. `document`) get a
		// stable, fully-qualified path rather than whatever relative form the CLI
		// was invoked with.
		const result = await compile(input, outputFormat, resolvePath(inputPath), root, rawMode);
		await writeFile(outputPath, result);
	}
	catch (ex)
	{
		// renderContext already printed the offending source line for runtime
		// errors; in that case skip the noisy JS stack and just fail. Otherwise
		// (parse errors, missing files, ...) surface the message.
		if (!ex.spruceContextRendered) process.stderr.write(`${ex.message ?? ex}\n`);
		process.exit(1);
	}
}