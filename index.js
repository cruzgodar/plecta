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
  
  
  
  heading = spaceOrTab* "#" "#"? "#"? "#"? "#"? "#"? spaceOrTab+ inline<(newline | end)>+
  
  
  
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
  
  
  
  unorderedList = unorderedItem (newline unorderedItem)* &(newline | end)
  unorderedItem = spaceOrTab* "-" spaceOrTab+ inline<(newline | end)>+

  orderedList = orderedItem (newline orderedItem)* &(newline | end)
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

  escape = "\\" ("*" | "_" | "$" | "${bt}" | "<" | ">" | "\\")

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
    
  escapeRaw<stop> = "\\" ("\\" | stop)

  inlineRaw<stop>
    = functionCall
  	| escapeRaw<stop>
    | (~stop ~newline any)

  newline = "\r\n" | "\n" | "\r"
  doubleNewline = newline spaceOrTab* newline
  
  spaceOrTab = " " | "\t"
  
  
  
  functionCall
    = "@(" jsIdentifier (parsedBlock | rawBlock)* ")" --wrapped
    | "@" jsIdentifier (parsedBlock | rawBlock)*      --bare
    | "\\@"                                           --escaped
    
  jsIdentifier = jsIdentifierStart jsIdentifierPart*
  jsIdentifierStart = letter | "_" | "$"
  jsIdentifierPart = jsIdentifierStart | digit
  
  parsedBlock = "[" inline<"]">+ "]"
  rawBlock = "{" (escapeRaw<"}"> | (~"}" ~newline any))+ "}"
}
`;

const plecta = ohm.grammar(grammar);

console.log(plecta.match("a *b*").succeeded());