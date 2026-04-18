const ohm = require("ohm-js");

const grammar = String.raw`
	plecta {
		text = inline<end>*
		
		bold
			= "**" ~"*" inline<"**">+ "**" ~"*"
			| "__" ~"_" inline<"__">+ "__" ~"_"
			
		italic
			= "*" ~"*" inline<"*">+ "*" ~"*"
			| "_" ~"_" inline<"_">+ "_" ~"_"
			
		boldItalic
			= "***" inline<"***">+ "***"
			| "___" inline<"___">+ "___"
		
		inline<stop> = boldItalic | bold | italic | (~stop ~newline any)
		
		newline = "\r\n" | "\n" | "\r"
		}
`;

const plecta = ohm.grammar(grammar);

console.log(plecta.match("a *b*").succeeded());