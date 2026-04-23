const ohm = require("ohm-js");

const grammar = String.raw`
	plecta {
		document = (paragraph | twoOrMoreNewlines)+
  
  
  
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
		
		code = "\`" ~"\`" inlineRaw<"\`">+ "\`" ~"\`"

		math = "$" ~"$" inlineRaw<"$">+ "$" ~"$"
		displayMath = "$$" inlineRaw<"$$">+ "$$"

		escape = "\\" ("@" | "*" | "_" | "$" | "\`" | "\\")

		inline<stop>
			= boldItalic
			| bold
			| italic
			| code
			| math
			| displayMath
			| link
			| escape
			| (~stop ~newline any)

		// Used for delimeters that aren't folding
		inlineRaw<stop>
			= ("\\" ("\\" | stop) | ~stop ~newline any)

		newline = "\r\n" | "\n" | "\r"
		doubleNewline = newline newline
		twoOrMoreNewlines = doubleNewline newline*
	}
`;

const plecta = ohm.grammar(grammar);

console.log(plecta.match("a *b*").succeeded());