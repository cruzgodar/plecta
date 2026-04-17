const ohm = require("ohm-js");

const grammar = String.raw`
	plecta {
		text = (italic | ~newline any)+
		
		italic = "*" italicContent "*"
		italicContent = (~"*" ~newline any)+
		
		newline = "\r\n" | "\n" | "\r"
	}
`;

const plecta = ohm.grammar(grammar);

console.log(plecta.match("a *b*").succeeded());