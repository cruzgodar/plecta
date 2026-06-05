# Heading
## subheading

```js
	code
```
$$
	math
$$

@@@
	import { testFunction } from "./testDeclarations.js";
@@@html
	function center(body)
	{
		return String.raw`<div style="display: flex; justify-content: center; width: 100%">${body}</div>`;
	}

	function f(stuff)
	{
		return `ran function on ${stuff}`;
	}

	function thm(name, body)
	{
		return `<div class="thm"> <p>Theorem: ${name}</p>
		${body}
		</div>`
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

Paragraph with *italic*, **bold**, ***bolditalic*** 
`code`, $math$, $$displaystyle math$$, [link](to somewhere),
and escaped characters: @@x @*c@*

iwfb;iweufb
@f[
    argument
		argument2
]

@thm[
	name
][[
	body
]]

@g{ @f[h] }

@testFunction#[[
	entire paragraph

	@f[hi]

	1. hello
	2. also
	3. three
]]#{hello}