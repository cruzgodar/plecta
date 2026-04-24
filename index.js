const ohm = require("ohm-js");

const bt = "`";

const grammar = String.raw`
plecta {
  document = chunk+
  
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
	
  codeBlockBody = (~(newline spaceOrTab* "${bt}${bt}${bt}" (newline | end)) any)*
  
  
  
  displayMath
    = spaceOrTab* "$$" spaceOrTab* newline
      displayMathBody
   	  newline spaceOrTab* "$$" &(newline | end)
	
  displayMathBody = (~(newline spaceOrTab* "$$" (newline | end)) any)*
  
  
  
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
  orderedItem = spaceOrTab* digit+ "." spaceOrTab+ inline<(newline | end)>+
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
  
  htmlTagName = letter (letter | digit | "-")*
  
  htmlAttribute<allowedInsides> = htmlTagWs<allowedInsides>+ htmlTagName ("=" htmlAttributeValue<allowedInsides>)?
  
  htmlAttributeValue<allowedInsides>
    = "\"" (~"\"" allowedInsides)* "\""  --doubleQuote
    | "'" (~"'" allowedInsides)* "'"     --singleQuote
    | (~spaceOrTab ~newline ~">" any)+   --bare
    
  htmlTagBody<allowedInsides>
    = htmlTag<allowedInsides>
    | (~htmlCloseTag allowedInsides)
    
  htmlTagWs<allowedInsides>
  	= spaceOrTab              --single
    | &allowedInsides newline --double

  escape = "\\" ("@" | "*" | "_" | "$" | "${bt}" | "<" | ">" | "\\")

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
  	= escapeRaw<stop>
    | (~stop ~newline any)

  newline = "\r\n" | "\n" | "\r"
  doubleNewline = newline spaceOrTab* newline
  
  spaceOrTab = " " | "\t"
  
  
  
  functionCall
    = "@(" (~space ~("[" | "{" | ")") any)* (parsedBlock | rawBlock)* ")" --wrapped
  	| "@" (~space ~("[" | "{") any)* (parsedBlock | rawBlock)*      --bare
  
  parsedBlock = "[" inline<"]">+ "]"
  rawBlock = "{" inlineRaw<"}">+ "}"
}
`;

const plecta = ohm.grammar(grammar);

console.log(plecta.match("a *b*").succeeded());