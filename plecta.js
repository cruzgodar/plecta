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
  
  
  
  heading = spaceOrTab* "#" "#"? "#"? "#"? "#"? "#"? spaceOrTab+ inline<~(newline | end) any>+
  
  
  
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
  
  
  
  unorderedList = unorderedItem (newline unorderedItem)* &(newline | end)
  unorderedItem = spaceOrTab* "-" spaceOrTab+ inline<~(newline | end) any>+

  orderedList = orderedItem (newline orderedItem)* &(newline | end)
  orderedItem = spaceOrTab* orderedItemStarter spaceOrTab+ inline<~(newline | end) any>+
  orderedItemStarter
  	= (digit+ ".") --numeric
    | "+" 		   --plus
  
  
  
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
  
  link = "[" inline<~"]" any>+ "]" "(" raw<~")" ~doubleNewline any>+ ")" 

  // Code and math are non-folding
  code = "${bt}" ~"${bt}" raw<~"${bt}" ~doubleNewline any>+ "${bt}" ~"${bt}"

  inlineMath = "$" ~"$" raw<~"$" ~doubleNewline any>+ "$" ~"$"
  inlineDisplayMath = "$$" raw<~"$$" ~doubleNewline any>+ "$$"

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
  raw<allowed>
    = functionCallRaw
    | allowed

  newline = "\r\n" | "\n" | "\r"
  doubleNewline = newline spaceOrTab* newline
  
  spaceOrTab = " " | "\t"
  
  
  
  functionCall
    = "@(" jsIdentifier (parsedBlock | rawBlock)* ")" --wrapped
    | "@" jsIdentifier (parsedBlock | rawBlock)*      --bare
    | "@" rawBlock                                    --rawShortcut
    | "\\@"                                           --escaped
    
  functionCallRaw
    = "@(" jsIdentifier rawBlock* ")" --wrapped
    | "@" jsIdentifier rawBlock*      --bare
    | "@" rawBlock                    --rawShortcut
    | "\\@"                           --escaped
    
  jsIdentifier = jsIdentifierStart jsIdentifierPart*
  jsIdentifierStart = letter | "_" | "$"
  jsIdentifierPart = jsIdentifierStart | digit
  
  parsedBlock = "[" inline<~"]" any>+ "]"
  rawBlock = "{" (escapeRaw<"}"> | (~"}" ~newline any))+ "}"
  
  escapeRaw<stop> = "\\" ("\\" | stop)
}`;

const plecta = ohm.grammar(grammar);

const semantics = plecta.createSemantics();

semantics.addOperation("desugar", {
	heading(_1, hashes, _2, body)
	{
		return `@heading{${hashes.length}}[${body.desugar()}]`;
	},

	codeBlock(_1, _2, _3, language, _4, _5, body, _6, _7, _8, _9)
	{
		return `@codeBlock{${language}}{${body.desugar()}}`;
	},

	displayMath(_1, _2, _3, _4, body, _5, _6, _7, _8)
	{
		return `@displayMath{${hashes.length}}[${body.desugar()}]`;
	},

	declarationBlock(_1, _2, _3, scope, _4, _5, body, _6)
	{
		// TODO
		return body.eval();
	},

	unorderedList(firstItem, spaces, restItems, _2)
	{
		// TODO
		return [
			firstItem.eval(),
			...spaces.flatMap((space, i) => [space.eval(), restItems[i].eval()])
		].join("\n");
	},

	unorderedItem(_1, _2, _3, body)
	{
		// TODO
		return body.eval()
	},

	orderedList(firstItem, spaces, restItems, _2)
	{
		// TODO
		return [
			firstItem.eval(),
			...spaces.flatMap((space, i) => [space.eval(), restItems[i].eval()])
		].join("\n");
	},

	orderedItem(_1, _2, _3, body)
	{
		// TODO
		return body.eval()
	},

	htmlTag_openClose(openTag, body, closeTag)
	{
		// TODO
		return openTag.eval() + body.eval() + closeTag.eval();
	},

	htmlTag_void(voidTag)
	{
		// TODO
		return voidTag.eval();
	},



	boldItalic(_1, body, _2)
	{
		// TODO
		return body.eval();
	},

	bold(_1, body, _2)
	{
		// TODO
		return body.eval();
	},

	italic(_1, body, _2)
	{
		// TODO
		return body.eval();
	},

	link(_1, displayText, _2, _3, url, _4)
	{
		// TODO
		return displayText.eval();
	},

	code(_1, body, _2)
	{
		// TODO
		return body.eval();
	},

	inlineMath(_1, body, _2)
	{
		// TODO
		return body.eval();
	},

	inlineDisplayMath(_1, body, _2)
	{
		// TODO
		return body.eval();
	},

	escape(backslash, escapedCharacter)
	{
		return escapedCharacter.eval();
	},



	functionCall_wrapped(_1, name, blocks, _2)
	{
		// TODO
		return "[OUTPUT]"
	},

	functionCall_bare(_1, name, blocks)
	{
		// TODO
		return "[OUTPUT]"
	},

	functionCall_escaped(_1)
	{
		return "@";
	},



	_terminal()
	{
		return this.sourceString;
	},

	_iter(...children)
	{
		return children.map(c => c.eval()).join("");
	},
});

console.log(
	semantics(plecta.match(`
	### test`)).eval()
);