const ohm = require("ohm-js");

const grammar = String.raw`
plecta {
	document = chunk+
	
	chunk
		= heading
		| codeBlock
		| paragraph
		| twoOrMoreNewlines
	
	
	
	heading = spaceOrTab* "#" "#"? "#"? "#"? "#"? "#"? spaceOrTab+ inline<(newline | end)>+
	
	
	
	codeBlock
		= spaceOrTab* "\`\`\`" spaceOrTab* alnum* spaceOrTab* newline
		codeBlockBody
		newline spaceOrTab* "\`\`\`" &(newline | end)
		
	codeBlockBody = (~(newline spaceOrTab* "\`\`\`" (newline | end)) any)*
	
	
	
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
	code = "\`" ~"\`" inlineRaw<"\`">+ "\`" ~"\`"

	inlineMath = "$" ~"$" inlineRaw<"$">+ "$" ~"$"
	inlineDisplayMath = "$$" inlineRaw<"$$">+ "$$"

	escape = "\\" ("@" | "*" | "_" | "$" | "\`" | "\\")

	inline<stop>
		= boldItalic
		| bold
		| italic
		| code
		| inlineMath
		| inlineDisplayMath
		| link
		| escape
		| (~stop ~newline any)
		
	escapeRaw<stop> = "\\" ("\\" | stop)

	inlineRaw<stop>
		= escapeRaw<stop>
		| (~stop ~newline any)
		
	blockInteriorRaw<stop>
		= escapeRaw<stop>
		| (~(newline spaceOrTab* stop) any)

	newline = "\r\n" | "\n" | "\r"
	doubleNewline = newline newline
	twoOrMoreNewlines = doubleNewline newline*
	
	spaceOrTab = " " | "\t"
}
`;

const plecta = ohm.grammar(grammar);

console.log(plecta.match("a *b*").succeeded());