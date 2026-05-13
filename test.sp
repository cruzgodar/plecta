# Heading
## subheading

```js
code
```
$$
math
$$

@@@html
	function center(body)
	{
		return String.raw`<div style="display: flex; justify-content: center; width: 100%">${body}</div>`;
	}
@@@tex
	function center(body)
	{
		return String.raw`\begin{center} ${body} \end{center}`;
	}
@@@

- 1
- 2
- 3

1. ordered
+  list

Paragraph with *italic*, **bold**, ***bolditalic***,
`code`, $math$, $$displaystyle math$$, [link](to somewhere),
and escaped characters: @@x @*c@*

@center[centered text!]