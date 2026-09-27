/**
 * grammar.js — gramática Tree-sitter para Camille
 *
 * Portada diretamente de src/syntax/parser.mly (parser Menhir do
 * compilador Camille). Cada grupo de regras do .mly tem um bloco
 * correspondente aqui, na mesma ordem; os desvios são anotados com
 * "DESVIO(.mly):" ao lado da regra.
 *
 * Desvios estruturais em relação ao .mly (todos deliberados):
 *
 * 1. Tokens virtuais ES6_FUN/ES6_DOT não existem aqui. O lexer do
 *    compilador injeta um ES6_FUN antes de "(" quando o grupo termina
 *    em "=>" (lambda) ou "when" (guard de case), e um ES6_DOT antes de
 *    "(" seguido de "." (aplicação de módulo). Tree-sitter é GLR:
 *    declaramos as ambiguidades em `conflicts` e o parser testa os
 *    dois caminhos em paralelo, resolvendo com o lookahead real.
 *
 * 2. Menhir resolve precedência com %left implícito por níveis de
 *    regras (exprInfix0..4). Aqui cada nível virou uma regra própria
 *    com prec.left(N, ...) — mesma hierarquia, precedências explícitas.
 *
 * 3. Validações semânticas (arity de construtor, tipos) acontecem
 *    depois do parsing no compilador e NÃO foram portadas — a gramática
 *    é um pouco mais permissiva, como convém a um editor.
 *
 * Léxico vem de src/syntax/lexer.ml:
 *  - números: INTEIROS (int_of_string) nas 4 bases com "_" — sem floats
 *  - chars: escapes apenas n t " \ ' b r e '\DDD' decimal
 *  - strings: escapes \\ \" \n \t \e \x (os dois últimos marcados
 *    especial, não geram erro de recovery)
 *  - lident inclui "_foo" (LOWER), só "_" puro é WILDCARD
 *  - "as" é palavra reservada (token AS) mas não aparece em produção
 *    nenhuma do .mly — reservada aqui também, sem regra sintática.
 */

module.exports = grammar({
  name: 'camille',

  extras: $ => [/\s/, $.line_comment],

  // keyword extraction: literais-string nas regras não colidem com
  // LOWER/UPPER/LETOP porque todos começam por estes tokens-palavra.
  word: $ => $.lower_identifier,

  superseded: $ => [$.line_comment],

  // Ambiguidades genuínas de LR(1) que o lexer do compilador resolve
  // com injeção de tokens virtuais (ES6_FUN/ES6_DOT). Aqui o GLR
  // bifurca e decide com mais lookahead:
  //  - (x) => ...   (lambda)     vs  f(x)          (aplicação)
  //  - Order.Eq => 0 (case arm)  vs  Ctor(...)     (construtor/apply)
  //  - Mod.(+)      (op por caminho) vs Mod.x DOT ...
  //  - (x : τ) => ...             vs  (x : τ)       (constraint)
  //  - forall binders {a} => τ    vs  bloco { ... }
  conflicts: $ => [
    // Módulos: `include (M : S)` pode ser path ascrito ou o começo de
    // `(M : S) => ...` (functor) — decide o lookahead do `=>`.
    [$.module_path_expression, $.functor_parameter],
    [$._sig_module_body, $.signature_functor],

    // Ambiguidade estrutural central da linguagem: qualquer átomo serve
    // como expressão, padrão de lambda ou padrão de let. O GLR decide
    // com o contexto (é um `=` de let? um `=>` de lambda?).
    [$._expression, $._pattern, $._lambda_params],
    [$._expression, $.pattern_literal],
    [$._expression, $._lambda_params, $.pattern_literal],
    [$._expression, $._lambda_params],
    [$._pattern, $._lambda_params],
    [$._forall_binder, $.wildcard],
    [$._forall_binder, $.module_path_expression],
    [$._expression, $._pattern, $._lambda_params, $._forall_binder],
    [$._expression, $._forall_binder],
    [$._expression, $._block_content],
    [$._expression, $._pattern],
    [$.record_expression, $.constructor_expression, $.record_pattern],
    [$.module_path_expression, $.signature_path_application],
    [$.module_path_expression, $.signature_path_expression],
    [$.module_path_expression, $.operator_path],
    [$.lambda_parameter_list, $.implicit_tuple_pattern, $.parenthesized_pattern],
    [$._expression, $.implicit_tuple_expression],
    [$._case_subject_item, $.parenthesized_expression],
    [$._expression, $._case_subject_item],
    [$._type_entry, $._type_apply],
    [$._type_entry, $._type_atom],
    [$._expression, $._expr_close, $._lambda_params, $._pattern],
    [$._expression, $._expr_close],
    [$._expression, $._expr_close, $.pattern_literal],
    [$._expression, $._expr_entry_no_let],
    [$._expression, $._expr_close, $._lambda_params, $.pattern_literal],
    [$._expression, $._expr_sequence_rest],
    [$.record_expression_row, $.pattern_record_row],

    [$._expression, $._pattern_close],
    [$.module_path_expression, $.functor_parameter, $.signature_parameter],
    [$._sig_module_body, $.signature_functor, $._sig_module_functor_body],
    [$._sig_module_body, $._sig_module_functor_body],
    [$.type_definition, $.signature_type],
    [$.module_structure, $.signature_structure],
    [$._var_lower_name, $._pattern],
    [$._var_lower_name, $._let_name],
    [$._expr_close, $._pattern_close],
    [$._expr_close, $.pattern_literal],
    [$.module_type_definition, $.signature_module_type],
    [$.functor_parameter, $.signature_parameter],
    [$._expression, $._expr_maybe_braced0],
    [$._expression, $._case_body],
    [$._expr_close, $._lambda_params],
    [$.extern_definition, $.signature_extern],
    [$.constructor_expression, $.constructor_pattern],
    [$.simple_constructor_pattern, $.constructor_expression],
    [$.module_name, $.constructor_path],
    [$._pattern, $.parenthesized_pattern],
    [$.list_expression, $.list_pattern],
  ],

  rules: {
    // ============================================================
    // source_file  (~ .mly: structure / signature)
    // ============================================================
    // A estrutura do .mly é uma lista de termEntry/sigEntry com EOF.
    source_file: $ => repeat($._term_entry),

    // ------------------------------------------------------------
    // (* Core Terms *) — termEntry
    // ------------------------------------------------------------
    _term_entry: $ => choice(
      $.type_definition,        // termType
      $.value_definition,       // termValue
      $.extern_definition,      // termExtern
      $.import_declaration,     // termImport
      $.module_definition,      // termModule
      $.module_type_definition, // termModType
      $.include_declaration,    // termInclude
    ),

    // termType: TYPE UPPER termTypeParams termTypeDecl
    // (termTypeAbstract = vazio, ou = termTypeDeclClosed)
    type_definition: $ => seq(
      'type',
      field('name', $.type_name),
      optional(field('params', $.type_parameters)),
      optional(seq('=', field('declaration', $._type_declaration_closed))),
      // termTypeRecord/termTypeConstruct sem '=' (rows direto)
      optional(field('body', choice($.record_rows, $.constructor_rows))),
    ),

    // termValue: LET letName = exprMaybeBraced | REC letName = exprEntry
    value_definition: $ => seq(
      choice('let', 'rec'),
      field('pattern', $._let_name),
      '=',
      field('body', $._expr_maybe_braced),
    ),

    // termExtern: EXTERNAL varLowerName : typeEntry = STRING
    extern_definition: $ => seq(
      'extern',
      field('name', $._var_lower_name),
      ':',
      field('type', $._type_entry),
      '=',
      field('linkage', $.string),
    ),

    // termImport: IMPORT newUpperComplexPath
    import_declaration: $ => seq(
      'import',
      field('path', $.module_path),
    ),

    // termInclude: INCLUDE termModuleExpr
    include_declaration: $ => seq(
      'include',
      field('body', $._module_expression),
    ),

    // termModule: MOD UPPER termModuleBody | MOD IMPL UPPER termModuleBody
    module_definition: $ => seq(
      'mod',
      optional('impl'),
      field('name', $.module_name),
      field('body', $._term_module_body),
    ),

    // termModType: MOD TYPE UPPER (EQUAL sigModuleBody)?
    module_type_definition: $ => seq(
      'mod',
      'type',
      field('name', $.module_name),
      optional(seq('=', field('body', $._sig_module_body))),
    ),

    // termModuleBody: EQUAL termModuleExpr | COLON termModuleAnnoExpr
    _term_module_body: $ => choice(
      seq('=', $._module_expression),
      seq(':', $.module_annotation_body),
    ),

    // termModuleAnnoExpr: sigModuleBody EQUAL termModuleExpr
    module_annotation_body: $ => seq(
      field('annotation', $._sig_module_body),
      '=',
      field('body', $._module_expression),
    ),

    // ------------------------------------------------------------
    // (* Module expressions *) — termModuleExpr e filhos
    // ------------------------------------------------------------
    _module_expression: $ => choice(
      $.module_structure,      // termModuleStructure
      $.module_path,           // termModuleQualified
      $.module_functor,        // termModuleFun
      $.module_application,    // termModuleApp
      $.module_any,            // termModuleAny
      $.module_ascription,     // termModuleAnn
    ),

    module_any: $ => '_',

    // termModuleStructure: LBRACE RBRACE | braces(termModuleStructureRec)
    // termModuleStructureRec: termEntry sem separador obrigatório
    // termModuleStructure: LBRACE RBRACE | braces(termModuleStructureRec)
    module_structure: $ => braces1($, repeat($._term_entry)),

    // termModuleQualified: newUpperComplexPathMod
    module_path: $ => $.module_path_expression,

    // Caminho pontuado de módulos: M, M.N, M.N.P (newUpperComplexPathMod)
    module_path_expression: $ => sep1($.module_name, '.'),

    // termModuleFun: ES6_FUN termModuleParams (COLON sigModuleFunctorBind)?
    //   FATARROW termModuleFunctorBody
    // params: parens(named) ou braces(implicit — mod impl)
    module_functor: $ => seq(
      field('parameters', choice(
        $.functor_parameter_list,
        $.functor_implicit_parameter_list,
      )),
      optional(seq(':', field('annotation', $._sig_module_functor_bind))),
      '=>',
      field('body', $._module_functor_body),
    ),

    // termModuleParams: parens(sep1(termModuleParamNamed, COMMA))
    functor_parameter_list: $ => parens1($, sep1_term($.functor_parameter, ',')),
    functor_parameter: $ => seq(
      field('name', $.module_name),
      ':',
      field('annotation', $._sig_module_functor_bind),
    ),

    // termModuleParamImplicit: braces(newUpperName : impl_moduleImpl)
    // (mod impl: parâmetro implícito de instância)
    functor_implicit_parameter_list: $ => braces1($, sep1(
      seq(
        field('name', $.module_name),
        ':',
        field('annotation', $.impl_module_instance),
      ), ',')),

    // impl_moduleImpl: newUpperComplexPathMty (braces(impl_moduleImplWith))?
    impl_module_instance: $ => seq(
      field('head', $.type_constructor_path),
      optional(field('items', $.impl_instance_items)),
    ),

    // impl_moduleImplWith: impl_moduleImplType (SEMICOLON? ...)*
    impl_instance_items: $ => braces1($, repeat1(seq(
      $.impl_instance_item,
      optional(';'),
    ))),
    impl_instance_item: $ => seq(
      'type',
      field('name', $.type_name),
      '=',
      field('definition', $._type_entry),
    ),

    // termModuleFunctorBody:
    //   structure | qualified | fun | app | parens(expr | annotated)
    _module_functor_body: $ => choice(
      $.module_structure,
      $.module_path,
      $.module_functor,
      $.module_application,
      $.module_ascription,
      $.parenthesized_module_expression,
    ),

    // termModuleAnn: parens(termModuleAnnotatedInner(termModuleExpr))
    // termModuleAnnotatedInner: body COLON anno | body COLON_GT anno
    // (opt_parens dos dois lados — permitimos ascribe um path direto)
    module_ascription: $ => seq(
      '(',
      field('body', choice(
        $.module_path,
        $.module_structure,
        $.module_functor,
        $.module_application,
        $.parenthesized_module_expression,
      )),
      field('operator', choice(':', ':>')),
      field('annotation', choice(
        $._sig_module_body,
        $.parenthesized_module_expression,
      )),
      ')',
    ),

    parenthesized_module_expression: $ => seq('(', $._module_expression, ')'),

    // termModuleApp: head LPAREN RPAREN | head parens(sep1(argm, COMMA))
    // termModuleApplyArgm: termModuleApplyArg | LPAREN RPAREN (unit)
    module_application: $ => prec(2, seq(
      field('function', choice($.module_path, $.module_application)),
      field('arguments', choice(
        $.module_argument_list,
        $.module_unit_argument,
      )),
    )),
    module_unit_argument: $ => seq('(', ')'),
    module_argument_list: $ => parens1($, sep1_term($._module_argument, ',')),
    _module_argument: $ => choice(
      $.module_structure,
      $.module_path,
      $.module_application,
      $.module_functor,
      $.parenthesized_module_expression,
      $.module_unit_argument,
    ),

    // ------------------------------------------------------------
    // (* Signatures *) — sigModuleBody e filhos
    // ------------------------------------------------------------
    _sig_module_body: $ => choice(
      $.signature_path,        // sigModuleQualified
      $.signature_structure,   // sigModuleSignature
      $.signature_functor,     // sigModuleFun
      $.signature_with,        // sigModuleWith
      $.parenthesized_signature,
    ),

    parenthesized_signature: $ => seq('(', $._sig_module_body, ')'),

    // sigModuleQualified: newUpperComplexPathMty (path com aplicação)
    signature_path: $ => $.signature_path_expression,

    // newUpperComplexPathMty = newComplexPath(modExtPath, newUpperName)
    // modExtPathApplied: path ES6_DOT parens(args) — aplicação de módulo
    // em caminhos de tipo de módulo (Mod.Functor(Int))
    signature_path_expression: $ => choice(
      sep1($.module_name, '.'),
      $.signature_path_application,
    ),
    signature_path_application: $ => seq(
      field('function', sep1($.module_name, '.')),
      field('arguments', $.signature_path_arguments),
    ),
    signature_path_arguments: $ => parens1($, sep1($.signature_path_arguments, ',')),

    // sigModuleSignature: LBRACE RBRACE | braces(sigModuleSignatureRec)
    signature_structure: $ => choice(
      seq('{', '}'),
      braces1($, repeat1(seq($._signature_entry, optional(';')))),
    ),

    // sigEntry: sigType | sigValue | sigExtern | sigModule | sigModType | sigInclude
    _signature_entry: $ => choice(
      $.signature_type,
      $.signature_value,
      $.signature_extern,
      $.signature_module,
      $.signature_module_type,
      $.signature_include,
    ),

    // sigType: TYPE UPPER termTypeParams termTypeDecl
    signature_type: $ => seq(
      'type',
      field('name', $.type_name),
      optional(field('params', $.type_parameters)),
      choice(
        // termTypeDecl: abstract (vazio) ou = closed
        seq('=', field('declaration', $._type_declaration_closed)),
        optional(field('body', choice($.record_rows, $.constructor_rows))),
      ),
    ),

    // sigValue: LET varLowerName : typeEntry | VAL varLowerName : typeEntry
    signature_value: $ => seq(
      choice('let', 'val'),
      field('name', $._var_lower_name),
      ':',
      field('type', $._type_entry),
    ),

    // sigExtern: EXTERNAL varLowerName : typeEntry = STRING
    signature_extern: $ => seq(
      'extern',
      field('name', $._var_lower_name),
      ':',
      field('type', $._type_entry),
      '=',
      field('linkage', $.string),
    ),

    // sigModule: MOD UPPER COLON opt_parens(sigModuleBody)
    signature_module: $ => seq(
      'mod',
      field('name', $.module_name),
      ':',
      field('body', $._sig_module_body),
    ),

    // sigModType: MOD TYPE UPPER (EQUAL opt_parens(sigModuleBody))?
    signature_module_type: $ => seq(
      'mod',
      'type',
      field('name', $.module_name),
      optional(seq('=', field('body', $._sig_module_body))),
    ),

    // sigInclude: INCLUDE sigModuleBody
    signature_include: $ => seq(
      'include',
      field('body', $._sig_module_body),
    ),

    // sigModuleFun: ES6_FUN parens(sep1(moduleParamType, COMMA)) FATARROW body
    //   | ES6_FUN parens(sigModuleBody) FATARROW body
    //   | ES6_FUN sigModuleBody FATARROW body
    signature_functor: $ => seq(
      field('parameters', choice(
        $.signature_parameter_list,
        $.parenthesized_signature,
        $._sig_module_body,
      )),
      '=>',
      field('body', $._sig_module_functor_body),
    ),

    // moduleParamType: named | unnamed (_ : S)
    signature_parameter_list: $ => parens1($, sep1_term(choice(
      $.signature_parameter,
      $.signature_parameter_unnamed,
    ), ',')),
    signature_parameter: $ => seq(
      field('name', $.module_name),
      ':',
      field('annotation', $._sig_module_functor_bind),
    ),
    signature_parameter_unnamed: $ => seq(
      '_',
      ':',
      field('annotation', $._sig_module_functor_bind),
    ),

    // sigModuleFunctorBind: qualified | signature | with | parens(sigModuleBody)
    _sig_module_functor_bind: $ => choice(
      $.signature_path,
      $.signature_structure,
      $.signature_with,
      $.parenthesized_signature,
    ),

    // sigModuleFunctorBody: qualified | signature | fun | parens(functorBody)
    _sig_module_functor_body: $ => choice(
      $.signature_path,
      $.signature_structure,
      $.signature_functor,
      $.parenthesized_signature,
    ),

    // sigModuleWith: head braces(sigModuleWithRec)
    // sigModuleWithEntry: type = | type := | mod :
    signature_with: $ => seq(
      field('head', $._sig_module_functor_bind),
      field('items', $.with_items),
    ),
    with_items: $ => braces1($, repeat1(seq($.with_item, optional(';')))),
    with_item: $ => choice(
      // sigModuleWithType: TYPE UPPER params EQUAL termTypeDeclClosed
      seq(
        'type',
        field('name', $.type_name),
        optional(field('params', $.type_parameters)),
        '=',
        field('definition', $._type_declaration_closed),
      ),
      // sigModuleWithTypeSubst: TYPE UPPER params COLON_EQ typeEntry
      seq(
        'type',
        field('name', $.type_name),
        optional(field('params', $.type_parameters)),
        ':=',
        field('substitution', $._type_entry),
      ),
      // sigModuleWithMod: MOD UPPER COLON braces(sigModuleWithRec)
      seq(
        'mod',
        field('module_name', $.module_name),
        ':',
        field('items', $.with_items),
      ),
    ),

    // ------------------------------------------------------------
    // (* Type declarations *) — termTypeDecl e filhos
    // ------------------------------------------------------------
    // termTypeDecl: termTypeAbstract (vazio) | EQUAL termTypeDeclClosed
    // termTypeDeclClosed: synonym | record | construct
    _type_declaration_closed: $ => choice(
      $._type_entry,            // termTypeSynonym
      $.record_rows,            // termTypeRecord (via typeRecordRows)
      $.constructor_rows,       // termTypeConstruct (via termDataRows)
    ),

    // typeRecordRows: braces(sep1(typeRecordRow, COMMA))
    record_rows: $ => braces1($, sep1_term($.record_row, ',')),
    record_row: $ => seq(
      field('name', $.lower_identifier),
      ':',
      field('type', $._type_entry),
    ),

    // termDataRows: braces(sep1(termDataRow, COMMA))
    // termDataRow: UPPER | UPPER termDataArgs
    constructor_rows: $ => braces1($, sep1_term($.constructor_row, ',')),
    constructor_row: $ => seq(
      field('name', $.type_constructor),
      optional(field('arguments', $.constructor_arguments)),
    ),
    constructor_arguments: $ => parens1($, sep1($._type_entry, ',')),

    // termTypeParams: typeTypeParamsNAry | vazio
    // typeTypeParamsNAry: typeBindersClosed(newLowerName)
    // typeBindersClosed: parens(um binder) | parens(sep1(binder, COMMA))
    type_parameters: $ => seq('(', sep1_term($._type_binder_mixed, ','), ')'),

    // typeBinderMixed(name): name (: kindEntry)? | _ (: kindEntry)?
    _type_binder_mixed: $ => choice(
      seq(field('name', $.lower_identifier), optional(seq(':', field('kind', $._kind_entry)))),
      seq('_', optional(seq(':', field('kind', $._kind_entry)))),
    ),

    // ------------------------------------------------------------
    // (* Core Expressions *)
    // ------------------------------------------------------------
    _expression: $ => choice(
      $.lambda_expression,        // exprLambda / exprLambdaType
      $.case_expression,          // exprCase
      $.expression_let,           // exprLet
      $.expression_sequence,      // exprSequence
      $.binary_expression,        // exprBinop (níveis 0-4)
      $.unary_expression,         // exprUnary
      $.implicit_tuple_expression,// exprTuple (não-#)
      $.tuple_expression,         // exprTuple (#)
      $.record_expression,        // exprRecord
      $.list_expression,          // exprList
      $.constraint_expression,    // exprConstraintOpen (x : τ)
      $.application_expression,   // exprApply
      $.type_application_expression, // VTA f[Int]
      $.impl_application_expression, // VMA f@Impl
      $.constructor_expression,   // exprConstructor
      $.function_path_expression, // exprFunction
      $.field_expression,         // exprField
      $.parenthesized_expression, // exprParens
      $.lower_identifier,               // exprVariable
      $.operator_variable,        // exprVariable: parens(op) — (==) usado como função
      $.number,                   // literalNumber
      $.character,                // literalChar
      $.string,                   // STRING literal
      $.unit_expression,          // literalUnit ()
    ),

    // varLowerName: LPAREN prefix RPAREN | LPAREN infix RPAREN | newLowerName
    // — permite usar um operador entre parênteses como valor: (==)(1, 1)
    operator_variable: $ => seq(
      '(',
      // '+'/'-'/'*' podem ser lexados como tokens anônimos (unary/binary),
      // então aceitamos também essas formas literais.
      choice($.prefix_operator, $.infix_operator, '+', '-', '*'),
      ')',
    ),

    // exprEntry = exprEntryNoLet | exprLet
    // Top-level permitido dentro de blocks via _statement.

    // exprLet: letop pattLet = bind ; body | LET ... | REC ...
    expression_let: $ => prec.right(seq(
      field('binding', choice($.let_operator, 'let', 'rec')),
      field('pattern', $._let_name),
      '=',
      field('bound', $._expr_maybe_braced),
      ';',
      field('body', $._expr_maybe_braced0),
    )),

    // letName: letNameOptionalParens | pattTupleUnprefixed | pattEntryOptionalConstraint
    // varLowerName: parens(prefix/infix) | newLowerName — usado por
    // termValue/termExtern/sigValue (definições e assinaturas de valor)
    _var_lower_name: $ => choice(
      $.lower_identifier,
      $.let_name_operator,
    ),

    _let_name: $ => choice(
      $.let_name_operator,      // let (+) = ... (com : anotação possível)
      $.pattern_constraint,     // let (x : Int) = ...
      // letNameOptionalParens: letNameOperator COLON typeEntry
      seq($.let_name_operator, ':', field('annotation', $._type_entry)),
      $.lower_identifier,             // let x = ...
      $.implicit_tuple_pattern, // let (a, b) = ...
      $.tuple_pattern,          // let #(a, b) = ...
      $.list_pattern,           // let [x, ...xs] = ...
      $.record_pattern,         // let (User { name }) = ...
      $.constructor_pattern,    // let Some(x) = ...
      $.pattern_literal,        // let () = ..., let 1 = ...
      $.wildcard,               // let _ = ...
    ),

    // letNameOptionalParens: operator COLON type | operator | parens(...)
    // letNameOperator: LPAREN LETOP RPAREN | LPAREN prefix RPAREN | LPAREN infix RPAREN
    let_name_operator: $ => seq(
      '(',
      choice($.let_operator, $.prefix_operator, $.infix_operator),
      ')',
    ),

    // LETOP: "let" binding_operator_suffix
    // lexer.ml: LETOP = "let" binding_operator_suffix
    //   binding_operator_suffix = binding_operator_char binding_symbol_char*
    //                           | '/' lident
    let_operator: $ => token(/let(?:[$(?&*+\-\/<>=@^|][!$%&*+\-/:=>?@^|]*|\/[a-z_][A-Za-z0-9_']*)/),

    // prefixop: [~?!] operator*
    prefix_operator: _ => token(/[~?!][!$%&*+\-.\/:=<>?@^|~]*/),
    // infixop0..4 + PLUS/MINUS/STAR (regra infix do .mly)
    infix_operator: $ => choice(
      // BARBAR / AMPAMP são literais nas regras binárias; aqui para M.(+)
      token(prec(1, '||')),
      token(prec(1, '&&')),
      token(prec(1, '!=')),
      $._infixop0,
      $._infixop1,
      $._infixop2,
      $._infixop3,
      $._infixop4,
      // '+'/'-'/'*' são cobertos por _infixop2/_infixop3; não usar prec(1)
      // aqui, senão o lexer parte '++' em duas tokens de 1 char.
    ),

    // lexer.ml: infixop0 = [=<>|&$] operator*
    _infixop0: _ => token(/(?:[=<>|&$][!$%&*+\-.\/:=<>?@^|~]*)/),
    _infixop1: _ => token(/(?:\^[!$%&*+\-.\/:=<>?@^|~]*)/),
    _infixop2: _ => token(/(?:[+\-][!$%&*+\-.\/:=<>?@^|~]*)/),
    _infixop3: _ => token(/(?:[*\/%][!$%&*+\-.\/:=<>?@^|~]*)/),
    _infixop4: _ => token(/(?:\*\*[!$%&*+\-.\/:=<>?@^|~]*)/),

    // exprSequence0 / exprSequence: exprApply ; next (sem seq no meio)
    expression_sequence: $ => prec.right(-1, seq(
      field('first', choice($.application_expression, $.type_application_expression,
                            $.impl_application_expression)),
      ';',
      field('rest', $._expr_sequence_rest),
    )),
    _expr_sequence_rest: $ => choice(
      $._expression,
      $.expression_sequence,
    ),

    // exprMaybeBraced0: braces(exprSequence0) | exprSequence0
    _expr_maybe_braced0: $ => choice(
      $.block,
      $._expression,
      $.expression_sequence,
    ),

    // exprMaybeBraced: braces(exprSequence) | exprEntryNoLet
    _expr_maybe_braced: $ => choice(
      $.block,
      $._expr_entry_no_let,
    ),

    _expr_entry_no_let: $ => choice(
      $.lambda_expression,
      $.case_expression,
      $._expr_close,
    ),

    // exprClose: exprTuple | exprBinop
    _expr_close: $ => choice(
      $.implicit_tuple_expression,
      $.tuple_expression,
      $.binary_expression,
      $.unary_expression,
      $.application_expression,
      $.type_application_expression,
      $.impl_application_expression,
      $.constructor_expression,
      $.function_path_expression,
      $.record_expression,
      $.list_expression,
      $.constraint_expression,
      $.field_expression,
      $.parenthesized_expression,
      $.lower_identifier,
      $.operator_variable,
      $.number,
      $.character,
      $.string,
      $.unit_expression,
    ),

    // block = braces(exprSequence) — corpo de lambda / bind / etc.
    // Dentro aceita exprEntry (com let) e sequências.
    block: $ => braces1($, $._block_content),
    _block_content: $ => choice(
      $._expression,
      $.expression_sequence,
    ),

    // exprLambdaParams: ES6_FUN _ | () | #(...) | (single) | var | (params)
    // _lambda_params cobre as 6 formas do .mly. O ES6_FUN é virtual:
    // qualquer "(" que precede "=>" é parâmetro.
    lambda_expression: $ => prec.right(seq(
      field('parameters', choice(
        $._lambda_params,
        $.lambda_type_parameters,
      )),
      optional(seq(':', field('return_type', $._type_entry))),
      '=>',
      field('body', $._expr_maybe_braced),
    )),

    // exprLambdaParams sem ES6_FUN:
    _lambda_params: $ => choice(
      $.wildcard,                          // ES6_FUN _
      $.unit_expression,                   // ES6_FUN ()
      $.lower_identifier,                        // ES6_FUN x
      $.implicit_tuple_pattern,            // ES6_FUN (a, b)
      $.tuple_pattern,                     // ES6_FUN #(a, b) (tupleCase SHARP)
      $.parenthesized_pattern,             // ES6_FUN (x)
      $.pattern_constraint,                // ES6_FUN (x : Int)
      $.lambda_parameter_list,             // ES6_FUN (a, b)
      $.constructor_pattern,               // ES6_FUN Some(x) — ctor case como lambda
      $.list_pattern,                      // ES6_FUN [x, ...xs]
    ),

    // ES6_FUN parens(separated_nonempty_or_term_list(COMMA,
    //   pattEntryOptionalConstraint))
    // separated_nonempty_or_term_list(COMMA, pattEntryOptionalConstraint)
    // — vírgula final permitida.
    lambda_parameter_list: $ => seq('(', sep1_term($._pattern, ','), ')'),

    // exprLambdaTypeParams: ES6_FUN braces(typeBindersForall)
    // ({a} => τ — lambda de TIPO/forall em posição de expressão)
    lambda_type_parameters: $ => seq(
      '{',
      repeat1(seq($._forall_binder, optional(','))),
      '}',
    ),

    // typeBindersForall: type_Binders(newLowerName) | impl_Binders(newUpperName)
    _forall_binder: $ => choice(
      // type_BinderMixed: name (: kind)? | _ (: kind)?
      seq(field('name', $.lower_identifier), optional(seq(':', field('kind', $._kind_entry)))),
      seq('_', optional(seq(':', field('kind', $._kind_entry)))),
      // impl_BinderMixed: Upper : impl_moduleImpl
      seq(field('module', $.module_name), ':', $.impl_module_instance),
    ),

    // exprCase: CASE caseSubject braces(nonempty(exprCaseBranch))
    case_expression: $ => seq(
      'case',
      field('subject', $._case_subject),
      field('arms', braces1($, repeat1($.case_arm))),
    ),

    // caseSubject: exprEntryNoConstructor | parens(tuple de exprs)
    _case_subject: $ => choice(
      $._expr_entry_no_let,
      $.case_subject_tuple,
    ),
    case_subject_tuple: $ => prec(1, seq(
      '(',
      sep1_term($._case_subject_item, ','),
      ')',
    )),
    _case_subject_item: $ => choice(
      $._expression,
      $.constraint_expression,
    ),

    // exprCaseBranch: caseMany when? => expr (COMMA?) | caseEntry => expr (COMMA?)
    case_arm: $ => prec(1, seq(
      field('pattern', choice($.case_pattern_multi, $._case_entry)),
      optional(field('guard', $.case_guard)),
      '=>',
      field('body', $._case_body),
      optional(','),
    )),

    // caseMany: ES6_FUN pattEntry | ES6_FUN parens(tuple implícito)
    case_pattern_multi: $ => prec(1, seq(
      choice($.lower_identifier, $.wildcard, $.tuple_pattern),
      $.case_guard,
    )),

    // caseGuard: WHEN (ES6_FUN)? exprBinop
    case_guard: $ => seq(
      'when',
      field('condition', $._expression),
    ),

    // caseEntry: baseCase | ctorCase | tupleCase
    // Um construtor simples (Upper) como padrão de arm é o caso mais
    // comum (Order.Eq, True, None) — ctorCase sem argumentos.
    _case_entry: $ => choice(
      $.wildcard,
      $.string,
      $.number,
      $.character,
      $.constructor_pattern,
      $.simple_constructor_pattern,
      $.record_pattern,
      $.list_pattern,
      $.tuple_pattern,
      $.implicit_tuple_pattern,
      $.lower_identifier,
      $.parenthesized_pattern,
    ),

    // CtorCase sem argumentos: newUpperComplexPath ES6_FUN (LPAREN RPAREN)
    // ou com args — aqui cobre tanto Upper quanto Upper(args).
    simple_constructor_pattern: $ => $.constructor_path,

    // caseExpr: exprCase | exprBraced | exprClose
    _case_body: $ => choice(
      $.case_expression,
      $.block,
      $._expr_close,
    ),

    // exprBinop — níveis 0..4 do .mly, cada um com prec.left(N)
    // exprBinop: || && (prec 1)
    binary_expression: $ => choice(
      ...[
        // [level, operators] — ordem do .mly: exprBinop(||,&&),
        // exprInfix0, exprInfix1, exprInfix2(+,-), exprInfix3(*,/), exprInfix4
        [1, choice('||', '&&', '!=', $._infixop0)],
        [2, $._infixop1],
        [3, choice($._infixop2, '+', '-')],
        [4, choice($._infixop3, '*')],
        [5, $._infixop4],
      ].map(([level, op]) => prec.left(level, seq(
        field('left', $._expression),
        field('operator', op),
        field('right', $._expression),
      ))),
    ),

    // exprUnary: MINUS exprUnary | PLUS exprUnary | exprApply
    unary_expression: $ => prec(6, seq(
      field('operator', choice('-', '+')),
      field('operand', $._expression),
    )),

    // exprTuple: #(sep1(exprEntryOptionalConstraint, COMMA))
    //          | parens(sep1(exprEntryOptionalConstraint, COMMA))
    tuple_expression: $ => seq(
      '#(',
      sep1_term($._expression, ','),
      ')',
    ),

    // A forma com parênteses ambígua com application; resolvida por GLR.
    implicit_tuple_expression: $ => prec(-1, seq(
      '(',
      choice($._expression, $.constructor_expression),
      repeat1(seq(',', choice($._expression, $.constructor_expression))),
      optional(','),
      ')',
    )),

    // unit literal ()
    unit_expression: $ => seq('(', ')'),

    // exprApply: base args | base [types] | base [@impls] | base ()
    application_expression: $ => prec(8, seq(
      field('function', $._expression),
      field('arguments', choice(
        $.argument_list,
        $.unit_expression,
      )),
    )),
    argument_list: $ => parens1($, sep1_term($._expression, ',')),

    // VTA: brackets(typeEntry) — f[Int](x)
    type_application_expression: $ => prec(9, seq(
      field('function', $._expression),
      field('type_arguments', $.type_argument_list),
    )),
    type_argument_list: $ => brackets1($, sep1($._type_entry, ',')),

    // VMA: brackets(newTemporaryImpPath = @Path) — f@Impl
    impl_application_expression: $ => prec(9, seq(
      field('function', $._expression),
      field('impl_arguments', $.impl_argument_list),
    )),
    impl_argument_list: $ => brackets1($, sep1($.impl_argument, ',')),
    impl_argument: $ => seq('@', $.type_constructor_path),

    // exprRecord: Path { rows } | Path { expr | rows }
    record_expression: $ => seq(
      field('name', $.constructor_path),
      '{',
      choice(
        seq(field('base', $._expression), '|'),
        optional('|'),
      ),
      field('rows', $.record_expression_rows),
      '}',
    ),
    record_expression_rows: $ => sep1_term($.record_expression_row, ','),
    record_expression_row: $ => seq(
      field('name', $.lower_identifier),
      optional(seq('=', field('value', $._expression))),
    ),

    // exprList: [] | [opt_spread(exprListExpr) (, ...)*]
    list_expression: $ => seq(
      '[',
      optional(seq(
        sep1($.list_expression_item, ','),
        optional(','),
      )),
      ']',
    ),
    list_expression_item: $ => seq(
      optional(field('spread', '...')),
      field('element', $._expression),
    ),

    // exprConstraintOpen: exprEntry COLON typeEntry
    constraint_expression: $ => prec.right(1, seq(
      field('value', $._expression),
      ':',
      field('type', $._type_entry),
    )),

    // exprConstructor: newUpperComplexPath
    constructor_expression: $ => $.constructor_path,

    // constructor_path: Upper (.Upper)* — newUpperComplexPath
    constructor_path: $ => sep1($.type_constructor, '.'),

    // exprFunction: newLowerComplexPath | path.(op)
    function_path_expression: $ => seq(
      field('path', choice(
        $.module_path,
        $.lower_qualified_path,
        $.operator_path,
      )),
    ),

    // newLowerComplexPath: newUpperComplexPath DOT newLowerName — P.succ, M.f
    lower_qualified_path: $ => seq(
      field('module', $.module_path),
      '.',
      field('field', $.lower_identifier),
    ),
    // path DOT parens(operatorAccessName): M.(+), N.Inner.(!)
    operator_path: $ => seq(
      field('module', sep1($.module_name, '.')),
      '.',
      '(',
      field('operator', choice($.prefix_operator, $.infix_operator)),
      ')',
    ),

    // exprField: exprAtom DOT newLowerName
    field_expression: $ => prec(7, seq(
      field('record', choice(
        $.lower_identifier,
        $.parenthesized_expression,
        $.field_expression,
      )),
      '.',
      field('field', $.lower_identifier),
    )),

    // exprParens: parens(exprEntry)
    parenthesized_expression: $ => seq('(', $._expression, ')'),

    // ------------------------------------------------------------
    // (* Core Patterns *)
    // ------------------------------------------------------------
    _pattern: $ => choice(
      $.pattern_or,
      $.record_pattern,
      $.tuple_pattern,
      $.implicit_tuple_pattern,
      $.list_pattern,
      $.constructor_pattern,
      $.pattern_constraint,
      $.parenthesized_pattern,
      $.pattern_literal,
      $.wildcard,
      $.lower_identifier,
      $.simple_constructor_pattern,
    ),

    // pattOr: pattClose PIPE pattEntry
    pattern_or: $ => prec.right(1, seq(
      field('left', $._pattern_close),
      '|',
      field('right', $._pattern),
    )),

    _pattern_close: $ => choice(
      $.record_pattern,
      $.tuple_pattern,
      $.constructor_pattern,
      $.list_pattern,
      $.pattern_literal,
      $.wildcard,
      $.lower_identifier,
      $.parenthesized_pattern,
      $.pattern_constraint,
      $.simple_constructor_pattern,
    ),

    // pattTuple: #(sep1(pattEntryOptionalConstraint, COMMA))
    tuple_pattern: $ => seq('#(', sep1_term($._pattern, ','), ')'),

    // pattTupleUnprefixed: parens(sep1(pattTupleItem, COMMA))
    implicit_tuple_pattern: $ => prec(-1, seq('(', sep1_term($._pattern, ','), ')')),

    // pattRecord: newUpperComplexPath braces(sep1(pattRecordRow, COMMA))
    record_pattern: $ => seq(
      field('name', $.constructor_path),
      field('rows', braces1($, sep1_term($.pattern_record_row, ','))),
    ),
    pattern_record_row: $ => seq(
      field('name', $.lower_identifier),
      optional(seq('=', field('pattern', $._pattern))),
    ),

    // pattConstrArgs: parens(sep1(pattEntry, COMMA))
    constructor_pattern: $ => seq(
      field('name', $.constructor_path),
      field('arguments', choice(
        parens1($, sep1($._pattern, ',')),
        $.unit_expression,
      )),
    ),

    // pattList: [] | [opt_spread(pattTupleItem)]
    list_pattern: $ => seq(
      '[',
      optional(seq(
        sep1($.list_pattern_item, ','),
        optional(','),
      )),
      ']',
    ),
    list_pattern_item: $ => seq(
      optional(field('spread', '...')),
      field('element', $._pattern),
    ),

    // pattConstraintOpen: pattEntry COLON typeEntry
    pattern_constraint: $ => prec.right(2, seq(
      field('pattern', $._pattern),
      ':',
      field('type', $._type_entry),
    )),

    // pattParens: parens(pattEntry)
    parenthesized_pattern: $ => seq('(', choice($._pattern, $.simple_constructor_pattern), ')'),

    // pattLiteral: STRING | literalEntry
    // pattLiteral: STRING | literalEntry (inclui literalUnit `()`)
    pattern_literal: $ => choice($.number, $.character, $.string, $.unit_expression),

    wildcard: $ => '_',

    // ------------------------------------------------------------
    // (* Core Types *)
    // ------------------------------------------------------------
    _type_entry: $ => choice(
      $.type_forall,       // typeForall
      $.type_arrow,        // typeArrow
      $.type_tuple,        // typeProd
      $.type_application,  // typeApply
      $.type_variable,     // typeVariable
      $.type_constructor_path, // typeConstructor
      $.parenthesized_type,// typeParens
    ),

    // typeForall: ES6_FUN braces(typeBindersForall) FATARROW typeEntry
    type_forall: $ => prec.right(seq(
      field('binders', $.forall_binders),
      '=>',
      field('body', $._type_entry),
    )),
    forall_binders: $ => seq(
      '{',
      repeat1(seq($._forall_binder, optional(','))),
      '}',
    ),

    // typeArrow: typeProd ARROW typeEntry (associativo à direita)
    type_arrow: $ => prec.right(1, seq(
      field('parameter', $._type_prod),
      '->',
      field('return', $._type_entry),
    )),

    // typeProd: sep1(typeApply, STAR)
    _type_prod: $ => choice(
      $.type_tuple,
      $._type_apply,
    ),
    type_tuple: $ => prec.left(2, seq(
      $._type_apply,
      repeat1(seq('*', $._type_apply)),
    )),

    // typeApply: typeAtom parens(sep1(typeEntry, COMMA)) | typeAtom
    _type_apply: $ => choice(
      $.type_application,
      $._type_atom,
    ),
    type_application: $ => prec(3, seq(
      field('constructor', $._type_atom),
      field('arguments', parens1($, sep1($._type_entry, ','))),
    )),

    // typeAtom: constructor | variable | parens
    _type_atom: $ => choice(
      $.type_constructor_path,
      $.type_variable,
      $.parenthesized_type,
    ),

    type_constructor_path: $ => sep1($.type_constructor, '.'),
    type_variable: $ => $.lower_identifier,
    parenthesized_type: $ => seq('(', $._type_entry, ')'),

    // ------------------------------------------------------------
    // (* Core kinds *) — kindEntry
    // ------------------------------------------------------------
    _kind_entry: $ => choice(
      $.kind_arrow,
      $.kind_type,
      $.parenthesized_kind,
    ),
    kind_arrow: $ => prec.right(seq(
      field('parameter', choice($.kind_type, $.parenthesized_kind)),
      '->',
      field('body', $._kind_entry),
    )),
    kind_type: $ => '*',
    parenthesized_kind: $ => seq('(', $._kind_entry, ')'),

    // ------------------------------------------------------------
    // Léxico (lexer.ml)
    // ------------------------------------------------------------
    // lower_identifier (lident): ('_'|lower) (alpha|digit|'_')*
    // NB: "_foo" é LOWER no lexer — regra discard separada é só
    // açúcar de highlight; lexicalmente é um identifier.
    lower_identifier: $ => /[a-z_][A-Za-z0-9_']*/,

    // upper identifier (uident) — token ÚNICO para Upper em todos os papéis
    // (constructor/module/type). Tokens iguais conflitam no lexer e impedem o
    // GLR de bifurcar (P.succ vs P como construtor).
    type_constructor: $ => /[A-Z][A-Za-z0-9_']*/,
    module_name: $ => $.type_constructor,
    type_name: $ => $.type_constructor,

    // NUMBER: Opt('-') Plus(digit) via int_of_string — mas int_of_string
    // também aceita 0b/0o/0x e "_". Mantemos as 4 bases com "_".
    number: $ => choice(
      $.binary_number,
      $.octal_number,
      $.hex_number,
      $.decimal_number,
    ),
    binary_number: _ => token(/-?0[bB][01_]+/),
    octal_number: _ => token(/-?0[oO][0-7_]+/),
    hex_number: _ => token(/-?0[xX][0-9a-fA-F_]+/),
    decimal_number: _ => token(/-?[0-9][0-9_]*/),

    // STRING (read_string): escapes \\ \" \n \t \e \x; \e e \x são
    // destacados à parte (no compilador geram \e e \x literais no valor).
    string: $ => seq(
      '"',
      repeat(choice(
        $.escape_sequence,
        $.special_escape,
        token.immediate(prec(1, /[^"\\]+/)),
      )),
      '"',
    ),
    escape_sequence: _ => token.immediate(seq('\\', choice('\\', '"', 'n', 't'))),
    special_escape: _ => token.immediate(seq('\\', choice('e', 'x'))),

    // CHAR: '\\e' com e ∈ {n t " \ ' b r} | '\c' (c ≠ ' \ \n) — sem \DDD
    // (o lexer não tem a regra \DDD; tmLanguage tinha, mas o compilador não)
    character: _ => token(choice(
      /'\\[nt"\\'br]'/,
      /'[^'\\\n]'/,
    )),

    // comment: "//" até \n (regra comment do lexer)
    line_comment: _ => token(prec(1, /\/\/[^\n]*/)),
  },
});

// parens(content) — LPAREN content RPAREN
function parens1($, content) {
  return seq('(', content, ')');
}

// braces(content) — LBRACE content RBRACE
function braces1($, content) {
  return seq('{', content, '}');
}

// brackets(content)
function brackets1($, content) {
  return seq('[', content, ']');
}

// separated_nonempty_list(sep, X)
function sep1(item, sep) {
  return seq(item, repeat(seq(sep, item)));
}

// separated_nonempty_or_term_list(sep, X) — vírgula final permitida
function sep1_term(item, sep) {
  return seq(sep1(item, sep), optional(sep));
}
