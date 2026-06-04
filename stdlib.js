const r = String.raw;

const html = {
	document(body, filePath)
	{
		return r`<!DOCTYPE html>
<html lang="en">

<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
</head>

<body>
${body}
</body>

</html>`;
	},

	heading(body, headingNumber)
	{
		return r`<h${headingNumber}>${body}</h${headingNumber}>`;
	},

	codeBlock(body, language)
	{
		return r`<pre><code>${body}</code></pre>`;
	},

	displayMath(body)
	{
		return r`<p>$$\begin{align*}${body}\end{align*}$$</p>`;
	},

	unorderedList(...items)
	{
		const itemsHtml = items.map(item => `<li>${item}</li>`).join("");
		return r`<ul>${itemsHtml}</ul>`;
	},

	orderedList(...items)
	{
		const itemsHtml = items.map(item => `<li>${item}</li>`).join("");
		return r`<ol>${itemsHtml}</ol>`;
	},

	paragraph(body)
	{
		return r`<p>${body}</p>`;
	},

	boldItalic(body)
	{
		return r`<strong><em>${body}</em></strong>`;
	},

	bold(body)
	{
		return r`<strong>${body}</strong>`;
	},

	italic(body)
	{
		return r`<em>${body}</em>`;
	},

	link(displayText, url)
	{
		return r`<a href="${url}">${displayText}</a>`;
	},

	code(body)
	{
		return r`<code>${body}</code>`;
	},

	math(body)
	{
		return r`$${body}$`;
	},

	inlineDisplayMath(body)
	{
		return r`$\displaystyle ${body}$`;
	},

	$: "$",
	_: "_",
};



const tex = {
	document(body, filePath)
	{
		return r`\documentclass{article}
\usepackage[T1]{fontenc}
\usepackage{microtype}
\usepackage{mathtools}
\usepackage{amsfonts}
\usepackage{amssymb}
\usepackage{enumitem}
\usepackage[dvipsnames]{xcolor}
\usepackage{graphicx}
\usepackage[total={7.5in, 10in}, heightrounded]{geometry}
\usepackage{setspace} \onehalfspacing
\usepackage[skip=8pt plus 1pt]{parskip}
\usepackage{hyperref}
\hypersetup
{
    colorlinks = true,
    allcolors = OliveGreen
}
\begin{document}
${body}
\end{document}`;
	},

	heading(body, headingNumber)
	{
		const commands = ["section", "subsection", "subsubsection", "paragraph", "subparagraph", "subparagraph"];
		return `\\${commands[headingNumber - 1]}{${body}}`;
	},

	codeBlock(body, language)
	{
		const languageOption = language ? `[language=${language}]` : "";
		return r`\begin{lstlisting}${languageOption}
	${body}
\end{lstlisting}`;
	},

	displayMath(body)
	{
		return r`\begin{align*}${body}\end{align*}`;
	},

	unorderedList(...items)
	{
		const itemsTex = items.map(item => r`\item ${item}`).join("\n");
		return r`\begin{itemize}
	${itemsTex}
\end{itemize}`;
	},

	orderedList(...items)
	{
		const itemsTex = items.map(item => r`\item ${item}`).join("\n");
		return r`\begin{enumerate}
	${itemsTex}
\end{enumerate}`;
	},

	paragraph(body)
	{
		return body;
	},

	boldItalic(body)
	{
		return r`\textbf{\emph{${body}}}`;
	},

	bold(body)
	{
		return r`\textbf{${body}}`;
	},

	italic(body)
	{
		return r`\emph{${body}}`;
	},

	link(displayText, url)
	{
		return r`\href{${url}}{${displayText}}`;
	},

	code(body)
	{
		return r`\texttt{${body}}`;
	},

	math(body)
	{
		return r`$${body}$`;
	},

	inlineDisplayMath(body)
	{
		return r`$\displaystyle ${body}$`;
	},

	$: "$",
	_: "_",
};



export const stdlib = { html, tex };