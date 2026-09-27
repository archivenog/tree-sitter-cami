; Camille — highlights (Tree-sitter), para a extensão Zed.
; Espelha tree-sitter-camille/queries/highlights.scm.

; ---------------------------------------------------------------------------
; Comentários
; ---------------------------------------------------------------------------
(line_comment) @comment

; ---------------------------------------------------------------------------
; Literais
; ---------------------------------------------------------------------------
(number) @number
(string) @string
(escape_sequence) @string.escape
(special_escape) @string.special
(character) @string.special

; ---------------------------------------------------------------------------
; Identificadores
; ---------------------------------------------------------------------------
(lower_identifier) @variable
(wildcard) @variable.builtin

; ---------------------------------------------------------------------------
; Tipos e construtores
; ---------------------------------------------------------------------------
(type_name (type_constructor) @type)
(type_constructor_path (type_constructor) @type)
(type_variable) @type
(constructor_path (type_constructor) @constructor)

; ---------------------------------------------------------------------------
; Módulos
; ---------------------------------------------------------------------------
(module_name (type_constructor) @module)

; ---------------------------------------------------------------------------
; Definições
; ---------------------------------------------------------------------------
(value_definition pattern: (lower_identifier) @function)
(extern_definition name: (lower_identifier) @function)
(type_definition name: (type_name) @type)

; ---------------------------------------------------------------------------
; Parâmetros (sobrepõe @module/@type acima para nomes de binder)
; ---------------------------------------------------------------------------
(lambda_parameter_list (lower_identifier) @variable.parameter)
(functor_parameter name: (module_name (type_constructor) @variable.parameter))
(signature_parameter name: (module_name (type_constructor) @variable.parameter))

; ---------------------------------------------------------------------------
; Campos / membros
; ---------------------------------------------------------------------------
(field_expression field: (lower_identifier) @property)
(record_expression_row name: (lower_identifier) @property)
(record_row name: (lower_identifier) @property)
(pattern_record_row name: (lower_identifier) @property)

; ---------------------------------------------------------------------------
; Operadores
; ---------------------------------------------------------------------------
(infix_operator) @operator
(prefix_operator) @operator
(operator_path) @operator
(operator_variable) @operator
(let_operator) @operator

[
  "=" "=>" "->" ":" ":=" ":>" "@" "|"
  "+" "-" "*" "&&" "||" "!="
] @operator

; ---------------------------------------------------------------------------
; Palavras-chave
; ---------------------------------------------------------------------------
[
  "let" "rec" "type" "extern" "import" "include"
  "mod" "impl" "case" "when"
] @keyword

; ---------------------------------------------------------------------------
; Pontuação
; ---------------------------------------------------------------------------
[ "(" ")" "[" "]" "{" "}" "#(" ] @punctuation.bracket
[ "," ";" "." "..." ] @punctuation.delimiter
