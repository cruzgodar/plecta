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
    | htmlTag<any>
    | newline          // Needs to be above paragraph or else newlines will always lead to paragraphs
    | paragraph
  
  
  
  heading = spaceOrTab* headingHashes spaceOrTab+ inline<(newline | end)>+
  headingHashes = "#" "#"? "#"? "#"? "#"? "#"?
  
  
  
  codeBlock
    = spaceOrTab* "${bt}${bt}${bt}" spaceOrTab* alnum* spaceOrTab* newline
      codeBlockBody
   	  newline spaceOrTab* "${bt}${bt}${bt}" &(newline | end)
	
  codeBlockBody = (functionCall | ~(newline spaceOrTab* "${bt}${bt}${bt}" (newline | end)) any)*
  
  
  
  displayMath
    = spaceOrTab* "$$" spaceOrTab* newline
      displayMathBody
   	  newline spaceOrTab* "$$" &(newline | end)
	
  displayMathBody = (functionCall | ~(newline spaceOrTab* "$$" (newline | end)) any)*
  
  
  
  declarationBlock
    = spaceOrTab* "@@@" spaceOrTab* alnum* spaceOrTab* newline
    declarationBlockBody
    declarationBlockTerminator

  declarationBlockBody = (~(newline spaceOrTab* "@@@") any)*

  declarationBlockTerminator
    = newline spaceOrTab* "@@@" spaceOrTab* &(newline | end) --hard
    | newline &(spaceOrTab* "@@@" spaceOrTab* alnum)         --soft
  
  
  
  unorderedList = unorderedItem (space* unorderedItem)* &(newline | end)
  unorderedItem = spaceOrTab* "-" spaceOrTab+ inline<(newline | end)>+

  orderedList = orderedItem (space* orderedItem)* &(newline | end)
  orderedItem = spaceOrTab* orderedItemStarter spaceOrTab+ inline<(newline | end)>+
  orderedItemStarter
  	= (digit+ ".") --numeric
    | "+" 		   --plus
  
  
  
  paragraph = (inline<(doubleNewline | end)> | newline ~newline)+

  boldItalic
    = "***" inline<"***">+ "***"
    | "___" inline<"___">+ "___"

  bold
    = "**" ~"*" inline<"**">+ "**" ~"*"
    | "__" ~"_" inline<"__">+ "__" ~"_"

  italic
    = "*" ~"*" inline<"*">+ "*" ~"*"
    | "_" ~"_" inline<"_">+ "_" ~"_"
  
  link = "[" inline<"]">+ "]" "(" inlineRaw<")">+ ")" 

  // Code and math are non-folding
  code = "${bt}" ~"${bt}" inlineRaw<"${bt}">+ "${bt}" ~"${bt}"

  inlineMath = "$" ~"$" inlineRaw<"$">+ "$" ~"$"
  inlineDisplayMath = "$$" inlineRaw<"$$">+ "$$"
  
  // allowedInsides is either any for block-level tags or ~newline any for inline ones
  htmlTag<allowedInsides>
  	= htmlOpenTag<allowedInsides> htmlTagBody<allowedInsides>* htmlCloseTag --openClose
    | htmlVoidTag<allowedInsides> --void
	
  htmlOpenTag<allowedInsides> = "<" htmlTagName htmlAttribute<allowedInsides>* htmlTagWs<allowedInsides>* ">"
  htmlCloseTag = "</" htmlTagName ">"
  htmlVoidTag<allowedInsides> = "<" htmlTagName htmlAttribute<allowedInsides>* htmlTagWs<allowedInsides>* "/"? ">"
  
  htmlTagName = (functionCall | letter) (functionCall | letter | digit | "-")*
  
  htmlAttribute<allowedInsides> = htmlTagWs<allowedInsides>+ htmlTagName ("=" htmlAttributeValue<allowedInsides>)?
  
  htmlAttributeValue<allowedInsides>
    = "\"" (functionCall | ~"\"" allowedInsides)* "\""  --doubleQuote
    | "'" (functionCall | ~"'" allowedInsides)* "'"     --singleQuote
    | (functionCall | ~spaceOrTab ~newline ~">" any)+   --bare
    
  htmlTagBody<allowedInsides>
    = htmlTag<allowedInsides>
    | functionCall
    | (~htmlCloseTag allowedInsides)
    
  htmlTagWs<allowedInsides>
  	= spaceOrTab              --single
    | &allowedInsides newline --double

  escape = "\\" any

  inline<stop>
    = boldItalic
    | bold
    | italic
    | code
    | inlineMath
    | inlineDisplayMath
    | link
    | htmlTag<~newline any>
    | functionCall
    | escape
    | (~stop ~newline any)

  inlineRaw<stop>
    = functionCall
    | (~stop ~newline any)

  newline = "\r\n" | "\n" | "\r"
  doubleNewline = newline spaceOrTab* newline
  
  spaceOrTab = " " | "\t"
  
  
  
  functionCall
  	= "\\@"                                           --escaped
    | "@(" jsIdentifier (parsedBlock | rawBlock)* ")" --wrapped
    | "@" jsIdentifier (parsedBlock | rawBlock)*      --bare
    
  jsIdentifier = jsIdentifierStart jsIdentifierPart*
  jsIdentifierStart = letter | "_" | "$"
  jsIdentifierPart = jsIdentifierStart | digit
  
  parsedBlock = "[" inline<"]">+ "]"
  rawBlock = "{" (rawBlockEscaped | rawBlockCharacter)+ "}"
  
  rawBlockCharacter = ~"}" ~newline any
  rawBlockEscaped = "\\)"
}
`;

const plecta = ohm.grammar(grammar);

const semantics = plecta.createSemantics();

semantics.addOperation("eval", {
	heading(_1, hashes, _2, body)
	{
		// TODO
		return hashes.sourceString.length + body.eval();
	},

	codeBlock(_1, _2, _3, language, _4, _5, body, _6, _7, _8, _9)
	{
		// TODO
		return body.eval();
	},

	displayMath(_1, _2, _3, _4, body, _5, _6, _7, _8)
	{
		// TODO
		return body.eval();
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