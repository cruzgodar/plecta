# Plecta
Latex is a robust and incredibly versatile language, but it's not without its problems. While the language is technically Turing-complete, actually writing anything resembling a program is an exercise in frustration, even down to what should be straightforward macros. Plecta (Latin for weave) is a preprocessor that lets you break out of Latex and write freely in JavaScript, and since there are no required changes to your project structure, you can incorporate it at your own pace.

Plecta files have the `.txs` extension (for TeXScript), which are a superset of standard `.tex` files. To get started, rename an existing `.tex` file to `.txs` or create a new one and start writing Latex as usual.

## Usage

Plecta adds two different constructs to Latex: **declaration blocks** and **expressions**. Beginning with the former, add a block of JavaScript bounded by three underscores to declare functions and variables that you'll use later in the document --- for example,
```js
___
// Converts strings of the form "1, 2 ; 3, 4" into e.g. 
// \left[ \begin{array}{cc} 1 & 2 \\ 3 & 4 \end{array} \right],
// using the first row to determine the number of columns.
function M(matrixString)
{
	const rows = matrixString.split(";");

	const numCols = rows[0].split(",").length;

	return "\\left[ \\begin{array}{"
		+ "c".repeat(numCols)
		+ "} "
		+ matrixString.replaceAll(/,/g, " &")
			.replaceAll(/;/g, "\\\\")
		+ " \\end{array} \\right]";
}
___
```
You'll typically need just a single block in the preamble, but you can add as many as you like, anywhere the document.

The other construct Plecta adds is **expressions**: in the body of the `.txs` document, surround a snippet of JavaScript in two underscores to evaluate it and replace it with its output.
```
Usual text, and then a macro: $__M("1, 2 ; 3, 4 ; 5, 6")__$.
```
Internally, all declaration blocks are appended together in order, and then all expressions are wrapped in a generator function that yields them one at a time. The whole block of JS is then evaluated, and the expressions in the Latex are replaced with their values, while the declaration blocks are commented out.

To convert the `.txs` file back into a compilable `.tex` one, run `node plecta.js /path/to/file.txs` — it will write its output to `/path/to/file.tex`. Optionally, include `--pdf` when running to immediately run `pdflatex` on the the outputted `.tex` file. If you have multiple separate `.txs` files to convert, simply separate them by spaces, as in `node plecta.js /path/to/file1.txs /path/to/file2.txs ...`.

Plecta supports spreading declaration blocks across files. For instance, the example project contains a file called `preamble.txs` with standard Latex preamble contents and the example declaration block above, along with a file `main.txs` that includes it with the standard syntax `\\input{./preamble.txs}`. To tell Plecta to look for declaration blocks in included files and convert them too, run it with the `-r` (recursive) option: for example, `node plecta.js main.txs -r` will convert `preamble.txs` to `preamble.tex` and update the input statement in `main.txs` to point to `preamble.tex` when converting. If you run Plecta without the `-r` option on a file that tries to includes a `.txs` one, it will output a warning (and then likely throw an error, since `.txs` files are not valid Latex syntax).