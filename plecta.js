const ohm = require("ohm-js");

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
      (rawBlockEscapable | raw<~(newline spaceOrTab* "${bt}${bt}${bt}" (newline | end)) any>)*
      newline spaceOrTab* "${bt}${bt}${bt}" &(newline | end)
  
  
  
  displayMath
    = spaceOrTab* "$$" spaceOrTab* newline
      (rawBlockEscapable | raw<~(newline spaceOrTab* "$$" (newline | end)) any>)*
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
    "(" (rawBlockEscapable | raw<~")" ~doubleNewline any>)+ ")" 

  // Code and math are non-folding
  code = "${bt}" ~"${bt}" (rawBlockEscapable | raw<~"${bt}" ~doubleNewline any>)+ "${bt}" ~"${bt}"

  inlineMath = "$" ~"$" (rawBlockEscapable | raw<~"$" ~doubleNewline any>)+ "$" ~"$"
  inlineDisplayMath = "$$" (rawBlockEscapable | raw<~"$$" ~doubleNewline any>)+ "$$"

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
  raw<allowed> = functionCall | allowed

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
  rawBlock = "{" (rawBlockEscape | raw<~"}" any>)+ "}"
  
  rawBlockEscape = "\\" rawBlockEscapable
  rawBlockEscapable = "\\" | "}"
}`;

const plecta = ohm.grammar(grammar);

const semantics = plecta.createSemantics();

// Convert all syntactic sugar to function calls, escaping characters as necessary.
// No characters are unescaped.
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

	_iter(...children)
	{
		return children.map(c => c.desugar()).join("");
	},
});

const parsed = semantics(plecta.match(String.raw`
	# Heading
	## subheading

	${bt}${bt}${bt}js
		f(x)
		{
			const y = "\n";
		}
	${bt}${bt}${bt}
	$$
		\{ 1, 2 \}
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
	${bt}code${bt}, $math$, $$displaystyle math$$, [link](somewhere),
	<span style="something">html</span>, and escaped characters: \@x \*c\*
	\$ \${bt}. Also a @f[function call]{with a raw input \} }[and escaped characters \]]

	@{
		A manual raw block
	}
	`));

console.log(parsed.desugar());