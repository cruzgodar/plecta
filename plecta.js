import { spawn } from "child_process";
import fs from "fs";

const args = process.argv.slice(2);

const options = {
	recursive: args.includes("-r"),
	pdf: args.includes("--pdf")
};



function txsToTex(filename, recursive)
{
	console.log(filename);

	let tex = fs.readFileSync(filename, "utf8");

	const declarationBlocks = [];

	if (recursive)
	{
		// Find input statements of .txs files.
		tex = tex.replaceAll(/\\input\{(.+?)\}/g, (match, $1) =>
		{
			const extension = $1.slice($1.lastIndexOf(".") + 1);

			if (extension !== "txs")
			{
				return match;
			}

			declarationBlocks.push(...txsToTex($1, true));

			return `\\input{${$1.slice(0, $1.lastIndexOf(".") + 1) + "tex"}}`;
		});
	}

	const texWithoutDeclarations = tex.replaceAll(/\n___([\s\S]+?)___/g, (match, $1) =>
	{
		declarationBlocks.push($1);

		return match.replaceAll(/\n/g, "\n% ");
	});

	const evaluationBlocks = [];

	const reservedVars = Array.from(texWithoutDeclarations.matchAll(/_PLECTA_([0-9]+)/g));

	const minIndex = (reservedVars?.reduce((acc, value) => Math.max(acc, parseInt(value[1])), -1) ?? -1) + 1;

	const texWithEvaluations = texWithoutDeclarations
		.replaceAll(/__([^\n]*?)__/g, (match, $1) =>
		{
			const varName = `_PLECTA_${evaluationBlocks.length + minIndex}`;

			evaluationBlocks.push($1);

			return varName;
		});

	const jsToEvaluate = declarationBlocks
		.concat(evaluationBlocks.map((block, index) => `const _PLECTA_${index + minIndex} = ${block};`)).join("\n")
		+ `\n\nreturn {${evaluationBlocks.map((block, index) => `_PLECTA_${index + minIndex}`).join(",")}}`;

	const customFunction = new Function(jsToEvaluate);
	const evaluatedVars = customFunction();

	const finalizedTex = texWithEvaluations
		.replaceAll(/_PLECTA_([0-9]+)/g, (match, $1) =>
		{
			const index = parseInt($1);
			const varName = `_PLECTA_${index}`;

			if (index < minIndex)
			{
				return varName;
			}

			const evaluatedVar = evaluatedVars[varName];

			if (typeof evaluatedVar !== "number" && typeof evaluatedVar !== "string")
			{
				const charNumber = (new RegExp(varName)).exec(texWithEvaluations).index;
				const lineNumber = (texWithEvaluations.slice(0, charNumber).match(/\n/g) || []).length + 1;

				console.warn(`Expression __${evaluationBlocks[index - minIndex]}__ on line ${lineNumber} evaluates to neither a number nor a string`);
			}

			return evaluatedVar;
		});

	const outputFilename = filename.replace(".txs", ".tex");

	fs.writeFileSync(outputFilename, finalizedTex);

	return declarationBlocks;
}

async function compile(filenames)
{
	await Promise.all(filenames.map(filename =>
	{
		return new Promise((resolve, reject) =>
		{
			const outputFilename = filename.slice(0, filename.lastIndexOf(".") + 1) + "tex";
			
			const proc = spawn("pdflatex", [outputFilename]);

			proc.stdout.on("data", data => console.log(data.toString()));
			proc.stderr.on("data", data => reject(data.toString()));
			proc.on("close", () => resolve());
		})
	}));
}

const filenames = args.filter(arg =>
{
	const extension = arg.slice(arg.lastIndexOf(".") + 1);
	
	return extension === "txs";
});

filenames.forEach(filename => txsToTex(filename, options.recursive));

if (options.pdf)
{
	compile(filenames);
}