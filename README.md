# tree-sitter-camille (esqueleto)

Gramática Tree-sitter inicial para a linguagem Camille, derivada das
categorias léxicas do `camille.tmLanguage.json` (extensão VS Code) e das
formas de sintaxe visíveis em `snippets.json`.

**Status:** gera com `tree-sitter generate` sem conflitos não resolvidos,
e os 7 casos em `test/corpus/basics.txt` passam (`tree-sitter test`).
Isso valida que a *estrutura* da gramática funciona — não que ela está
completa ou correta em relação ao compilador real.

## O que já está coberto

- Comentários `//`
- `let`, incluindo os binding operators (`let/bind`, `let*`, `let+`, ...)
  como um node próprio `let_keyword`
- `extern nome : tipo = "string"`
- Tuplas `#(a, b, c)`
- `case sujeito { padrão => corpo ... }`
- Funções `(param: tipo) => { ... }` com `let` local dentro do bloco
- Números binário/octal/hex/decimal
- Strings e as variantes de char literal (`'a'`, `'\n'`, `'\065'`, `'\\'`)
- Identificadores minúsculos, `Constructor`, `_wildcard`, `_discard`,
  `[]`
- Expressões binárias com uma tabela de precedência **provisória**
  (`queries/highlights.scm` inclui um mapeamento inicial pros captures
  do Zed)

## O que ainda precisa vir do `.mly` real (marcado como `TODO(.mly)` no grammar.js)

- Precedência e associatividade exatas dos operadores — a tabela atual
  é um palpite razoável de linguagem ML, não foi extraída do parser real
- Gramática completa de tipos (`_type` só cobre nome simples e aplicação
  tipo `Tipo(Tipo, Tipo)`)
- Gramática completa de padrões (`_pattern` não cobre construtores com
  argumentos, padrões "or" com `|`, ranges, etc.)
- `import`, `impl`, `mod`, `val`, `rec`, `as` — ainda sem nenhuma regra
- Se expressões soltas são válidas no nível de módulo (deixei permitido
  para o parser não quebrar feio, mas isso é um palpite)
- Semântica exata de `<-` e `->` (o tmLanguage só confirma que existem,
  não o que fazem)

## Workflow usado (e recomendado pra continuar)

1. Editar `grammar.js`
2. `npm run generate` — se der conflito não resolvido, a mensagem de
   erro já mostra as duas interpretações possíveis; resolver com
   `prec`/`prec.left`/`prec.right` no ponto de uso, ou declarar em
   `conflicts` quando a ambiguidade for genuína (ex.: `(x)` vs
   `(x) => ...` só se resolve olhando o token seguinte)
3. Adicionar um caso novo em `test/corpus/basics.txt` (ou um arquivo
   novo em `test/corpus/`) pra qualquer construção nova do `.mly` que
   você for portando
4. `npm run test` — usar `tree-sitter test --update` pra regravar as
   expectativas depois de uma mudança estrutural deliberada (sempre
   revisar o diff antes de aceitar, não é pra usar às cegas)
5. `npm run parse -- caminho/arquivo.cm` pra inspecionar a árvore de um
   arquivo `.cm` real e comparar contra o que o compilador aceitaria

## Ligação com a extensão do Zed

Este repositório é o que entra em `[grammars.camille]` no
`extension.toml` da extensão do Zed (via `repository`/`rev`, ou
`file://` local durante desenvolvimento). O arquivo
`queries/highlights.scm` aqui é um ponto de partida direto para
`languages/camille/highlights.scm` na extensão.
