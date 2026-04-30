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
      (rawBlockEscapable | raw<~(newline spaceOrTab* "${bt}${bt}${bt}" (newline | end)) any, "${bt}${bt}${bt}">)*
      newline spaceOrTab* "${bt}${bt}${bt}" &(newline | end)
  
  
  
  displayMath
    = spaceOrTab* "$$" spaceOrTab* newline
      (rawBlockEscapable | raw<~(newline spaceOrTab* "$$" (newline | end)) any, "$$">)*
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
    | "+"      --plus
  
  
  
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
    "(" (rawBlockEscapable | raw<~")" ~doubleNewline any, ")">)+ ")"

  // Code and math are non-folding
  code = "${bt}" ~"${bt}" (rawBlockEscapable | raw<~"${bt}" ~doubleNewline any, "${bt}">)+ "${bt}" ~"${bt}"

  inlineMath = "$" ~"$" (rawBlockEscapable | raw<~"$" ~doubleNewline any, "$">)+ "$" ~"$"
  inlineDisplayMath = "$$" (rawBlockEscapable | raw<~"$$" ~doubleNewline any, "$$">)+ "$$"

  escape = "\\" any

  inline<allowed>
    = boldItalic
    | bold
    | italic
    | code
    | inlineMath
    | inlineDisplayMath
    | link
    | functionCall
    | escape
    | allowed
 

  // The raw content of code blocks, display math, etc.
  raw<allowed, escapable> = rawEscape<escapable> | functionCall | allowed
  
  rawEscape<escapable> = "\\" escapable

  newline = "\r\n" | "\n" | "\r"
  doubleNewline = newline spaceOrTab* newline
  
  spaceOrTab = " " | "\t"
  
  
  
  functionCall
    = "@" space* "(" space* jsIdentifier spacePaddedBlock* space* ")" --wrapped
    | "@" space* jsIdentifier spacePaddedBlock*                       --bare
    | "@" space* rawBlock                                             --raw
    | "\\@"                                                           --escaped
    
  jsIdentifier = jsIdentifierStart jsIdentifierPart*
  jsIdentifierStart = letter | "_" | "$"
  jsIdentifierPart = jsIdentifierStart | digit
  
  spacePaddedBlock = space* parsedOrRawBlock
  parsedOrRawBlock = parsedBlock | rawBlock
  parsedBlock = "[" inline<~"]" any>+ "]"
  rawBlock = "{" (rawBlockEscape | functionCall | (~"}" any))+ "}"
  
  rawBlockEscape = "\\" rawBlockEscapable
  rawBlockEscapable = "}"
}`;



const plecta = ohm.grammar(grammar);

const semantics = plecta.createSemantics();

// Convert all syntactic sugar to function calls, escaping characters as necessary.
// The only characters that are unescaped are those in raw environments that would
// no longer considered valid escape sequences when desugaring.
semantics.addOperation("desugar", {
	heading(leadingSpace, hashes, _2, body)
	{
		return `${leadingSpace.desugar()}@heading{${hashes.sourceString.length}}[${body.desugar()}]`;
	},

	codeBlock(leadingSpace, _2, _3, language, _4, _5, body, _6, _7, _8, _9)
	{
		return `${leadingSpace.desugar()}@codeBlock{${language.desugar()}}{${body.desugar()}}`;
	},

	displayMath(leadingSpace, _2, _3, _4, body, _5, _6, _7, _8)
	{
		return `${leadingSpace.desugar()}@displayMath{${body.desugar()}}`;
	},

	declarationBlock(_1, _2, _3, scope, _4, _5, body, _6)
	{
		return this.sourceString;
	},

	unorderedList(leadingSpace, firstItem, _1, restItems, _2)
	{
		const restItemsWrapped = restItems.children.map(item => `[${item.desugar()}]`).join("");

		return `${leadingSpace.desugar()}@unorderedList[${firstItem.desugar()}]${restItemsWrapped}`;
	},

	unorderedItem(_1, _2, _3, body)
	{
		return body.desugar();
	},

	orderedList(leadingSpace, firstItem, _1, restItems, _2)
	{
		const restItemsWrapped = restItems.children.map(item => `[${item.desugar()}]`).join("");

		return `${leadingSpace.desugar()}@orderedList[${firstItem.desugar()}]${restItemsWrapped}`;
	},

	orderedItem(_1, _2, _3, body)
	{
		return body.desugar();
	},



	boldItalic(_1, body, _2)
	{
		return `@boldItalic[${body.desugar()}]`;
	},

	bold(_1, body, _2)
	{
		return `@bold[${body.desugar()}]`;
	},

	italic(_1, body, _2)
	{
		return `@italic[${body.desugar()}]`;
	},

	link(_1, displayText, _2, _3, url, _4)
	{
		return `@link[${displayText.desugar()}]{${url.desugar()}}`;
	},

	code(_1, body, _2)
	{
		return `@code{${body.desugar()}}`;
	},

	inlineMath(_1, body, _2)
	{
		return `@inlineMath{${body.desugar()}}`;
	},

	inlineDisplayMath(_1, body, _2)
	{
		return `@inlineDisplayMath{${body.desugar()}}`;
	},

	escape(backslash, escapedCharacter)
	{
		return this.sourceString;
	},

	rawEscape(_1, escapedCharacter)
	{
		return escapedCharacter.desugar();
	},



	functionCall_wrapped(_1, _2, _3, _4, name, spacePaddedBlocks, _5, _6)
	{
		return `@(${name.desugar()}${spacePaddedBlocks.desugar()})`;
	},

	functionCall_bare(_1, _2, name, spacePaddedBlocks)
	{
		return `@${name.desugar()}${spacePaddedBlocks.desugar()}`;
	},

	functionCall_raw(_1, _2, block)
	{
		return `@${block.desugar()}`;
	},

	functionCall_escaped(_1)
	{
		return this.sourceString;
	},

	jsIdentifier(_1, _2)
	{
		return this.sourceString;
	},

	spacePaddedBlock(_1, block)
	{
		return block.desugar();
	},

	parsedBlock(_1, body, _2)
	{
		return `[${body.desugar()}]`;
	},

	rawBlock(_1, body, _2)
	{
		return `{${body.desugar()}}`;
	},

	rawBlockEscape(_1, _2)
	{
		return this.sourceString;
	},



	rawBlockEscapable(character)
	{
		return "\\" + character.desugar();
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
let codeToExecute = "";
let functionCallLocations = {};

semantics.addOperation("getCode", {
	declarationBlock(_1, _2, _3, scope, _4, _5, body, _6)
	{
		if (!scope.sourceString || scope.sourceString === outputFormat)
		{
			codeToExecute += "\n" + body.sourceString + "\n\n";
		}

		return "";
	},

	functionCall_wrapped(_1, _2, _3, _4, name, spacePaddedBlocks, _5, _6)
	{
		const startIdx = this.source.startIdx;
		const id = JSON.stringify(startIdx);

		functionCallLocations[startIdx] = this.source.getLineAndColumn();
		functionCallLocations[startIdx].sourceString = this.sourceString;

		const functionArguments = spacePaddedBlocks.children
			.map(block => JSON.stringify(block.getCode()))
			.join(",");

		codeToExecute += `__plectaOutput[${id}] = ${name.getCode()}(${functionArguments});\n`;

		return "";
	},

	functionCall_bare(_1, _2, name, spacePaddedBlocks)
	{
		const startIdx = this.source.startIdx;
		const id = JSON.stringify(startIdx);

		functionCallLocations[startIdx] = this.source.getLineAndColumn();
		functionCallLocations[startIdx].sourceString = this.sourceString;

		const functionArguments = spacePaddedBlocks.children
			.map(block => JSON.stringify(block.getCode()))
			.join(",");

		codeToExecute += `__plectaOutput[${id}] = ${name.getCode()}(${functionArguments});\n`;

		return "";
	},

	functionCall_raw(_1, _2, block)
	{
		return block.getCode();
	},

	functionCall_escaped(_1)
	{
		return "@";
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

	// JS needs the unescaped versions of these characters
	rawBlockEscape(_1, escapedCharacter)
	{
		return escapedCharacter.sourceString;
	},

	escape(backslash, escapedCharacter)
	{
		return escapedCharacter.sourceString;
	},



	_terminal()
	{
		return this.sourceString;
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



function getCode(matchResult)
{
	codeToExecute = "";
	functionCallLocations = {};
	semantics(matchResult).getCode();
	return { codeToExecute, functionCallLocations };
}

for (const [key, value] of Object.entries(stdlib))
{
	globalThis[key] = value;
}

async function runCode(code, baseDir = process.cwd())
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
		throw new Error(`${ex}`);
	}
}

process.on("exit", () =>
{
	// Synchronous cleanup on exit — async fs won't run here
	for (const path of pendingCleanup)
	{
		try { unlinkSync(path); } catch {}
	}
});

process.on("SIGINT", () => process.exit(130))



async function main(input)
{
	const desugared = semantics(plecta.match(input)).desugar();
	const { codeToExecute, functionCallLocations } = getCode(plecta.match(desugared));
	console.log(functionCallLocations);
	const __plectaOutput = await runCode(codeToExecute);
}

main(String.raw`
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
		declaration1
	@@@tex
		declaration2
	@@@

	- 1
	- 2
	- 3

	1. ordered
	+  list

	<a href="b">
		raw html
	</a>

	Paragraph with *italic*, **bold**, ***bolditalic***,
	${bt}code${bt}, $math$, $$displaystyle math$$, [a link](to somewhere),
	<span style="something">html</span>, and escaped characters: \@x \*c\*
	\$ \${bt}. Also a @f [function call]{with a raw input \} } [
		and escaped characters \]
	] [and a separated line @g[with a function]]

	@{
		A manual raw block
	}
`)