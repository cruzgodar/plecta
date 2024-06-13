# Plecta
A straightforward Latex preprocessor that provides support for JavaScript macros.

## Usage
1. Anywhere in a `.txs` document, add a block bounded by three underscores to declare functions and variable.
```js
	___
	// Converts strings of the form "1, 2 ; 3, 4" into e.g. 
	// \left[ \begin{array}{cc} 1 & 2 \\ 3 & 4 \end{array} \right],
	// using the first row to determine the number of columns.
	function M(matrixString)
	{
		const rows = matrixString.split(";");

		const numCols = rows[0].split(",").length;

		return `\\left[ \\begin{array}{${"c".repeat(numCols)}} ${matrixString.replaceAll(/,/g, "&").replaceAll(/;/g, "\\\\")}\\end{array} \\right]`;
	}
	___
```

2. In the body of the `.txs` document, surround an expression in two underscores to evaluate it and place the result into the document.
```
	Usual text, and then a macro: $__M("1, 2 ; 3, 4 ; 5, 6")__$.
```

Internally, all declaration blocks are appended together in order, and then all evaluation blocks are appended after them and stored in distinct reserved variable names. The whole block of JS is then evaluated, and the evaluation blocks in the Latex are replaced with their values, while the declaration blocks are commented out.

3. Run `node plecta.js file.txs`, which converts the `.txs` to a `.tex` file. Alternatively, add `--pdf` to skip the second step.