/**
 * @file relevant.ts
 * Conditional expression evaluator for Questbee form fields.
 *
 * Evaluates the `relevant` string on a field definition and returns whether
 * the field should be shown. Returns `true` (show) for empty/missing expressions.
 *
 * Grammar (standard precedence — `and` binds tighter than `or`):
 *   expr     := or_expr
 *   or_expr  := and_expr ('or' and_expr)*
 *   and_expr := clause ('and' clause)*
 *   clause   := selected_call | comparison
 *   selected_call := 'selected' '(' IDENT ',' STRING ')'
 *   comparison    := IDENT OP literal
 *   OP             := '=' | '!=' | '>' | '<' | '>=' | '<='
 *   literal        := STRING | NUMBER
 *
 * Supported operators: = != > < >= <=
 * Supported connectives: and, or
 * Supported function: selected(field_id, 'value')
 */

export type FormValues = Record<string, any>;

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type Token =
  | { kind: "ident"; value: string }
  | { kind: "op"; value: string }
  | { kind: "string"; value: string }
  | { kind: "number"; value: number }
  | { kind: "kw_and" }
  | { kind: "kw_or" }
  | { kind: "kw_selected" }
  | { kind: "lparen" }
  | { kind: "rparen" }
  | { kind: "comma" };

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    if (/\s/.test(expr[i])) { i++; continue; }

    if (i + 1 < expr.length) {
      const two = expr[i] + expr[i + 1];
      if (two === ">=" || two === "<=" || two === "!=") {
        tokens.push({ kind: "op", value: two });
        i += 2;
        continue;
      }
    }

    if (expr[i] === "=") { tokens.push({ kind: "op", value: "=" }); i++; continue; }
    if (expr[i] === ">") { tokens.push({ kind: "op", value: ">" }); i++; continue; }
    if (expr[i] === "<") { tokens.push({ kind: "op", value: "<" }); i++; continue; }
    if (expr[i] === "(") { tokens.push({ kind: "lparen" }); i++; continue; }
    if (expr[i] === ")") { tokens.push({ kind: "rparen" }); i++; continue; }
    if (expr[i] === ",") { tokens.push({ kind: "comma" }); i++; continue; }

    if (expr[i] === "'" || expr[i] === '"') {
      const quote = expr[i++];
      let str = "";
      while (i < expr.length && expr[i] !== quote) str += expr[i++];
      i++;
      tokens.push({ kind: "string", value: str });
      continue;
    }

    if (/\d/.test(expr[i]) || (expr[i] === "-" && i + 1 < expr.length && /\d/.test(expr[i + 1]))) {
      let num = "";
      if (expr[i] === "-") num += expr[i++];
      while (i < expr.length && /[\d.]/.test(expr[i])) num += expr[i++];
      tokens.push({ kind: "number", value: parseFloat(num) });
      continue;
    }

    if (/[a-zA-Z_]/.test(expr[i])) {
      let word = "";
      while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i])) word += expr[i++];
      if (word === "and")           tokens.push({ kind: "kw_and" });
      else if (word === "or")       tokens.push({ kind: "kw_or" });
      else if (word === "selected") tokens.push({ kind: "kw_selected" });
      else                          tokens.push({ kind: "ident", value: word });
      continue;
    }

    i++;
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Parser / Evaluator
// ---------------------------------------------------------------------------

class Parser {
  private pos = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly values: FormValues,
  ) {}

  evaluate(): boolean {
    return this.parseOr();
  }

  private parseOr(): boolean {
    let result = this.parseAnd();
    while (this.peek()?.kind === "kw_or") {
      this.advance();
      const right = this.parseAnd();
      result = result || right;
    }
    return result;
  }

  private parseAnd(): boolean {
    let result = this.parseClause();
    while (this.peek()?.kind === "kw_and") {
      this.advance();
      const right = this.parseClause();
      result = result && right;
    }
    return result;
  }

  private parseClause(): boolean {
    const tok = this.peek();
    if (!tok) return true;

    if (tok.kind === "kw_selected") {
      this.advance();
      this.advance(); // '('
      const fieldTok = this.advance();
      this.advance(); // ','
      const valTok = this.advance();
      this.advance(); // ')'

      const fieldName = (fieldTok as Extract<Token, { kind: "ident" }>).value;
      const checkValue = (valTok as Extract<Token, { kind: "string" }>).value;
      const fieldValue = this.values[fieldName];

      if (Array.isArray(fieldValue)) return fieldValue.includes(checkValue);
      return String(fieldValue ?? "") === checkValue;
    }

    const fieldTok = this.advance();
    const opTok = this.advance();
    const litTok = this.advance();

    if (!fieldTok || !opTok || !litTok) return true;

    const fieldName = (fieldTok as Extract<Token, { kind: "ident" }>).value;
    const op = (opTok as Extract<Token, { kind: "op" }>).value;
    const litValue =
      litTok.kind === "string" ? litTok.value :
      litTok.kind === "number" ? litTok.value :
      undefined;

    return compare(this.values[fieldName], op, litValue);
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private advance(): Token | undefined {
    return this.tokens[this.pos++];
  }
}

function compare(fieldVal: any, op: string, litVal: any): boolean {
  const fNum = parseFloat(String(fieldVal ?? ""));
  const lNum = typeof litVal === "number" ? litVal : parseFloat(String(litVal ?? ""));

  if (!isNaN(fNum) && !isNaN(lNum)) {
    switch (op) {
      case "=":  return fNum === lNum;
      case "!=": return fNum !== lNum;
      case ">":  return fNum > lNum;
      case "<":  return fNum < lNum;
      case ">=": return fNum >= lNum;
      case "<=": return fNum <= lNum;
    }
  }

  const fStr = String(fieldVal ?? "");
  const lStr = String(litVal ?? "");
  switch (op) {
    case "=":  return fStr === lStr;
    case "!=": return fStr !== lStr;
    case ">":  return fStr > lStr;
    case "<":  return fStr < lStr;
    case ">=": return fStr >= lStr;
    case "<=": return fStr <= lStr;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Arithmetic evaluator (for `calculated` field expressions)
// ---------------------------------------------------------------------------

export function evaluateExpression(expression: string, values: FormValues): number {
  if (!expression) return NaN;

  const substituted = expression.replace(/[a-zA-Z_][a-zA-Z0-9_]*/g, (name) => {
    const val = parseFloat(String(values[name] ?? ""));
    return isNaN(val) ? "0" : String(val);
  });

  try {
    if (!/^[\d\s+\-*/().]+$/.test(substituted)) return NaN;
    // eslint-disable-next-line no-new-func
    return Function(`"use strict"; return (${substituted})`)() as number;
  } catch {
    return NaN;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate a `relevant` expression against the current form values.
 * Returns `true` if the field should be shown, `false` if hidden.
 */
export function evaluateRelevant(
  expression: string | undefined,
  values: FormValues,
): boolean {
  if (!expression || expression.trim() === "") return true;
  try {
    const tokens = tokenize(expression.trim());
    return new Parser(tokens, values).evaluate();
  } catch {
    return true;
  }
}
