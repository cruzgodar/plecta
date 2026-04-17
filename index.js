const ohm = require("ohm-js");
const { readFileSync } = require("fs");
const { join } = require("path");

const grammarText = readFileSync(join(__dirname, "markdown.ohm"), "utf-8");
const grammar = ohm.grammar(grammarText);

function parse(input) {
	return grammar.match(input);
}

module.exports = { grammar, parse };
