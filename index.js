const ohm = require("ohm-js");

const grammar = String.raw`
	plecta {
		text = inline<end>*

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

		inlineRaw<stop>
			= ("\\" ("\\" | stop) | ~stop ~newline any)

		newline = "\r\n" | "\n" | "\r"
	}
`;

const plecta = ohm.grammar(grammar);

console.log(plecta.match("a *b*").succeeded());