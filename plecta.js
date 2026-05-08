import { randomUUID } from "crypto";
import { unlinkSync } from "fs";
import { unlink, writeFile } from "fs/promises";
import * as ohm from "ohm-js";
import { join } from "path";
import process from "process";
import { pathToFileURL } from "url";
import { stdlib } from "./stdlib.js";

const pendingCleanup = new Set();

const outputFormat = "html";

const bt = "`";

const grammar = String.raw`
plecta {
  document = chunk*
  
  chunk
    = heading
    | codeBlock
    | displayMath
    | declarationBlock
    | unorderedList
    | orderedList
    | newline          // Needs to be above paragraph or else newlines will always lead to paragraphs
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
  
  
  
  // We include spaceOrTab* here so we can extract the leading indentation
  unorderedList = spaceOrTab* unorderedItem (newline unorderedItem)* &(newline | end)
  unorderedItem = spaceOrTab* "-" spaceOrTab+ inline<~(newline | end) any>+

  orderedList = spaceOrTab* orderedItem (newline orderedItem)* &(newline | end)
  orderedItem = spaceOrTab* orderedItemStarter spaceOrTab+ inline<~(newline | end) any>+
  orderedItemStarter
    = (digit+ ".") --numeric
    | "+"          --plus
  
  
  
  paragraph = inline<~(doubleNewline | end) any>+

  boldItalic
    = "***" inline<~"***" any>+ "***"
    | "___" inline<~"___" any>+ "___"

  bold
    = "**" ~"*" inline<~"**" any>+ "**" ~"*"
    | "__" ~"_" inline<~"__" any>+ "__" ~"_"

  italic
    = "*" ~"*" inline<~"*" any>+ "*" ~"*"
    | "_" ~"_" inline<~"_" any>+ "_" ~"_"
  
  link
    = "[" inline<~"]" any>+ "]"
      "(" raw<~")" ~doubleNewline any>+ ")"

  // Code and math are non-folding
  code = "${bt}" ~"${bt}" raw<~"${bt}" ~doubleNewline any>+ "${bt}" ~"${bt}"

  math = "$" ~"$" raw<~"$" ~doubleNewline any>+ "$" ~"$"
  inlineDisplayMath = "$$" raw<~"$$" ~doubleNewline any>+ "$$"

  inline<allowed> = parsedBlockEscapable | inlineWithoutEscapable<allowed>

  inlineWithoutEscapable<allowed>
    = boldItalic
    | bold
    | italic
    | code
    | math
    | inlineDisplayMath
    | link
    | functionCall
    | allowed
 

  // The raw content of code blocks, display math, etc.
  raw<allowed> = rawBlockEscapable | functionCall | allowed

  newline = "\r\n" | "\n" | "\r"
  doubleNewline = newline spaceOrTab* newline
  
  spaceOrTab = " " | "\t"
  
  
  
  functionCall
    = "@" spaceOrTab* "(" space* jsIdentifier spacePaddedBlock* space* ")" --wrapped
    | "@" spaceOrTab* jsIdentifier spacePaddedBlock*                       --bare
    | "@" spaceOrTab* rawBlock                                             --raw
    | "@" (~space any)                                                     --escaped
	| "@" space                                                            --invalid
    
  jsIdentifier = jsIdentifierStart jsIdentifierPart*
  jsIdentifierStart = letter | "_" | "$"
  jsIdentifierPart = jsIdentifierStart | digit
  
  spacePaddedBlock = space* parsedOrRawBlock
  parsedOrRawBlock = parsedBlock | rawBlock

  parsedBlock
	= "###[" inlineWithoutEscapable<~"]###" any>+ "]###"
	| "##[" inlineWithoutEscapable<~"]##" any>+ "]##"
	| "#[" inlineWithoutEscapable<~"]#" any>+ "]#"
	| "[" inlineWithoutEscapable<~"]" any>+ "]"

  rawBlock
	= "###{" (functionCall | (~"}###" any))+ "}###"
	| "##{" (functionCall | (~"}##" any))+ "}##"
	| "#{" (functionCall | (~"}#" any))+ "}#"
	| "{" (functionCall | (~"}" any))+ "}"
  
  parsedBlockEscapable = "]"
  rawBlockEscapable = "}"
}`;



const plecta = ohm.grammar(grammar);

const semantics = plecta.createSemantics();

// Each handler that emits a function call into the desugared output captures
// its location in the *original* source. The id is a sequential counter shared
// with getCode — both walk their parse trees in source order, so the nth
// emitted function call here matches the nth function call getCode encounters.
let nextFunctionCallId = 0;
let functionCallLocations = {};

let declarationBlockOriginalLines = [];

function captureFunctionCall(node)
{
	functionCallLocations[nextFunctionCallId++] = node.source.getLineAndColumn();
}

// Convert all syntactic sugar to function calls, escaping characters as necessary.
// The only characters that are unescaped are those in raw environments that would
// no longer considered valid escape sequences when desugaring.
semantics.addOperation("desugar", {
	heading(leadingSpace, hashes, _2, body)
	{
		captureFunctionCall(this);
		return `${leadingSpace.desugar()}@(heading{${hashes.sourceString.length}}[${body.desugar()}])`;
	},

	codeBlock(leadingSpace, _2, _3, language, _4, _5, body, _6, _7, _8, _9)
	{
		captureFunctionCall(this);
		return `${leadingSpace.desugar()}@(codeBlock{${language.desugar()}}{${body.desugar()}})`;
	},

	displayMath(leadingSpace, _2, _3, _4, body, _5, _6, _7, _8)
	{
		captureFunctionCall(this);
		return `${leadingSpace.desugar()}@(displayMath{${body.desugar()}})`;
	},

	declarationBlock(_1, _2, _3, scope, _4, _5, body, _6)
	{
		declarationBlockOriginalLines.push(body.source.getLineAndColumn().lineNum);
		return this.sourceString;
	},

	unorderedList(leadingSpace, firstItem, _1, restItems, _2)
	{
		captureFunctionCall(this);
		const restItemsWrapped = restItems.children.map(item => `[${item.desugar()}]`).join("");

		return `${leadingSpace.desugar()}@(unorderedList[${firstItem.desugar()}]${restItemsWrapped})`;
	},

	unorderedItem(_1, _2, _3, body)
	{
		return body.desugar();
	},

	orderedList(leadingSpace, firstItem, _1, restItems, _2)
	{
		captureFunctionCall(this);
		const restItemsWrapped = restItems.children.map(item => `[${item.desugar()}]`).join("");

		return `${leadingSpace.desugar()}@(orderedList[${firstItem.desugar()}]${restItemsWrapped})`;
	},

	orderedItem(_1, _2, _3, body)
	{
		return body.desugar();
	},



	boldItalic(_1, body, _2)
	{
		captureFunctionCall(this);
		return `@(boldItalic[${body.desugar()}])`;
	},

	bold(_1, body, _2)
	{
		captureFunctionCall(this);
		return `@(bold[${body.desugar()}])`;
	},

	italic(_1, body, _2)
	{
		captureFunctionCall(this);
		return `@(italic[${body.desugar()}])`;
	},

	link(_1, displayText, _2, _3, url, _4)
	{
		captureFunctionCall(this);
		return `@(link[${displayText.desugar()}]{${url.desugar()}})`;
	},

	code(_1, body, _2)
	{
		captureFunctionCall(this);
		return `@(code{${body.desugar()}})`;
	},

	math(_1, body, _2)
	{
		captureFunctionCall(this);
		return `@(math{${body.desugar()}})`;
	},

	inlineDisplayMath(_1, body, _2)
	{
		captureFunctionCall(this);
		return `@(inlineDisplayMath{${body.desugar()}})`;
	},



	functionCall_wrapped(_1, _2, _3, _4, name, spacePaddedBlocks, _5, _6)
	{
		captureFunctionCall(this);
		return `@(${name.desugar()}${spacePaddedBlocks.desugar()})`;
	},

	functionCall_bare(_1, _2, name, spacePaddedBlocks)
	{
		captureFunctionCall(this);
		return `@${name.desugar()}${spacePaddedBlocks.desugar()}`;
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

	parsedBlock(start, body, end)
	{
		return `${start.desugar()}${body.desugar()}${end.desugar()}`;
	},

	rawBlock(start, body, end)
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
});



// Produces the code to be run. We do *not* want this to be nested, so they
// get written in order to this accumulator, which is reset by getCode().
// getCode walks the desugared parse tree in the same order desugar walked the
// original, so the nth function call here corresponds to the nth captured
// location — we use that to rekey locations by desugared startIdx.
//
// Function-call arguments are emitted as JS template literals so that nested
// function calls can interpolate via `${__plectaOutput[<id>]}`. Raw text
// pieces therefore need to be escaped for use inside a template literal.
let codeToExecute = "";
let nextGetCodeId = 0;
let locationsByStartIdx = {};
let nextGetCodeDeclarationId = 0;
let declarationBlockRanges = [];

function escapeForTemplate(s)
{
	return s
		.replace(/\\/g, "\\\\")
		.replace(/`/g, "\\`")
		.replace(/\$\{/g, "\\${");
}

semantics.addOperation("getCode", {
	declarationBlock(_1, _2, _3, scope, _4, _5, body, _6)
	{
		const originalStart = declarationBlockOriginalLines[nextGetCodeDeclarationId++];

		if (!scope.sourceString || scope.sourceString === outputFormat)
		{
			const linesBefore = codeToExecute.split("\n").length;
			codeToExecute += "\n" + body.sourceString + "\n\n";

			// +1: leading "\n" lands the body on the next line in codeToExecute.
			// +1: runCode prepends an `export const __plectaOutput = {};` line.
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
		const startIdx = this.source.startIdx;
		const id = JSON.stringify(startIdx);

		locationsByStartIdx[startIdx] = functionCallLocations[nextGetCodeId++];

		const functionArguments = spacePaddedBlocks.children
			.map(block => "`" + block.getCode() + "`")
			.join(",");

		const nameCode = name.getCode();

		// With args, do a plain call so a non-function (i.e. a constant) lets
		// JS throw a TypeError that logSourceError can render. Without args,
		// keep the typeof guard so a bare `@x` resolves to the constant value.
		const rhs = spacePaddedBlocks.children.length > 0
			? `${nameCode}(${functionArguments})`
			: `typeof ${nameCode} === "function" ? ${nameCode}() : ${nameCode}`;

		codeToExecute += `__plectaOutput[${id}] = ${rhs};\n`;

		return "${__plectaOutput[" + id + "]}";
	},

	functionCall_bare(_1, _2, name, spacePaddedBlocks)
	{
		const startIdx = this.source.startIdx;
		const id = JSON.stringify(startIdx);

		locationsByStartIdx[startIdx] = functionCallLocations[nextGetCodeId++];

		const functionArguments = spacePaddedBlocks.children
			.map(block => "`" + block.getCode() + "`")
			.join(",");

		const nameCode = name.getCode();

		const rhs = spacePaddedBlocks.children.length > 0
			? `${nameCode}(${functionArguments})`
			: `typeof ${nameCode} === "function" ? ${nameCode}() : ${nameCode}`;

		codeToExecute += `__plectaOutput[${id}] = ${rhs};\n`;

		return "${__plectaOutput[" + id + "]}";
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

	spacePaddedBlock(_1, block)
	{
		return block.getCode();
	},

	parsedBlock(_1, body, _2)
	{
		return body.getCode();
	},

	rawBlock(_1, body, _2)
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
});



semantics.addOperation("insertCodeOutput(__plectaOutput)", {
	declarationBlock(_1, _2, _3, scope, _4, _5, body, _6)
	{
		return "";
	},

	functionCall_wrapped(_1, _2, _3, _4, name, spacePaddedBlocks, _5, _6)
	{
		const id = JSON.stringify(this.source.startIdx);
		return this.args.__plectaOutput[id];
	},

	functionCall_bare(_1, _2, name, spacePaddedBlocks)
	{
		const id = JSON.stringify(this.source.startIdx);
		return this.args.__plectaOutput[id];
	},

	functionCall_raw(_1, _2, block)
	{
		return block.insertCodeOutput(this.args.__plectaOutput);
	},

	functionCall_escaped(_1, character)
	{
		return character.getCode();
	},

	rawBlock(_1, body, _2)
	{
		return body.insertCodeOutput(this.args.__plectaOutput);
	},



	_terminal()
	{
		return this.sourceString;
	},

	_nonterminal(...children)
	{
		return children.map(c => c.insertCodeOutput(this.args.__plectaOutput)).join("");
	},

	_iter(...children)
	{
		return children.map(c => c.insertCodeOutput(this.args.__plectaOutput)).join("");
	},
});



function desugar(matchResult)
{
	nextFunctionCallId = 0;
	functionCallLocations = {};
	declarationBlockOriginalLines = [];
	return semantics(matchResult).desugar();
}

function getCode(matchResult)
{
	codeToExecute = "";
	nextGetCodeId = 0;
	locationsByStartIdx = {};
	nextGetCodeDeclarationId = 0;
	declarationBlockRanges = [];
	semantics(matchResult).getCode();
	return {
		codeToExecute,
		functionCallLocations: locationsByStartIdx,
		declarationBlockRanges,
	};
}

function insertCodeOutput(matchResult, __plectaOutput)
{
	return semantics(matchResult).insertCodeOutput(__plectaOutput);
}

if (Object.hasOwn(stdlib, outputFormat))
{
	for (const [key, value] of Object.entries(stdlib[outputFormat]))
	{
		globalThis[key] = value;
	}
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

function logSourceError(ex, body, source, functionCallLocations, declarationBlockRanges)
{
	const stack = ex.stack || `${ex}`;
	const fragmentMatch = stack.match(/\.__fragments_[^:]+\.mjs:(\d+):\d+/);

	if (!fragmentMatch) return false;

	const errorLineInBody = parseInt(fragmentMatch[1]);
	const bodyLine = body.split("\n")[errorLineInBody - 1] || "";
	// Matches both forms emitted by getCode:
	//   __plectaOutput[N] = name(...);
	//   __plectaOutput[N] = typeof name === "function" ? name() : name;
	const callMatch = bodyLine.match(/__plectaOutput\[(\d+)\]\s*=\s*(?:typeof\s+)?([A-Za-z_$][\w$]*)/);

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

async function runCode(code, source, functionCallLocations, declarationBlockRanges, baseDir = process.cwd())
{
	const body = `export const __plectaOutput = {};
${code}`;

	const url = URL.createObjectURL(new Blob([body], { type: "text/javascript" }));

	const path = join(baseDir, `.__fragments_${randomUUID()}.mjs`);

	await writeFile(path, body);
	pendingCleanup.add(path);

	try
	{
		const module = await import(pathToFileURL(path).href);
		await unlink(path).catch(() => {});
		pendingCleanup.delete(path);
		return module.__plectaOutput;
	}

	catch(ex)
	{
		await unlink(path).catch(() => {});
		pendingCleanup.delete(path);
		logSourceError(ex, body, source, functionCallLocations, declarationBlockRanges);
		throw new Error(`${ex}`);
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



export async function compile(input)
{
	const desugared = desugar(plecta.match(input));
	const desugaredMatch = plecta.match(desugared);
	const { codeToExecute, functionCallLocations, declarationBlockRanges } = getCode(desugaredMatch);
	const __plectaOutput = await runCode(codeToExecute, input, functionCallLocations, declarationBlockRanges);
	return insertCodeOutput(desugaredMatch, __plectaOutput);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
{
	compile(String.raw`
	# Heading
	## subheading

	${bt}${bt}${bt}js
		f(x)
		{
			const y = "\n";
		}
	${bt}${bt}${bt}
	$$
		\{ 1, 2 \} \$$
	$$

	@@@html
		function f()
		{
			return "output";
		}

		function g(x)
		{
			return parseInt(x) + 1;
		}
		const x = 1;
	@@@tex
		// declaration
	@@@

	- 1
	- 2
	- 3

	1. ordered
	+  list

	<a href="b">
		raw html
	</a>

	Paragraph with *italic*[oops], **bold ] **, ***bolditalic***,
	${bt}code${bt}, $math$, $$displaystyle math$$, [a link](to somewhere),
	, and escaped characters: @x[1] , @$, @_
`).then(console.log);
}