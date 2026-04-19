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

		code = "\`" ~"\`" inline<"\`">+ "\`" ~"\`"

		escape = "\\" ("@" | "*" | "_" | "\\")

		inline<stop>
			= boldItalic
			| bold
			| italic
			| code
			| escape
			| (~stop ~newline any)

		newline = "\r\n" | "\n" | "\r"
	}
`;

const plecta = ohm.grammar(grammar);

console.log(plecta.match("a *b*").succeeded());