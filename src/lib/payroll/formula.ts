/**
 * Safe arithmetic formula evaluator for salary components.
 * Supports numbers, + - * / ( ), unary minus, identifiers (e.g. GROSS, BASIC, RATE, DAYS)
 * and the functions MIN(a,b,...), MAX(a,b,...), ROUND(x).
 * No `eval` — tokens are parsed with a small recursive-descent parser.
 *
 * The arithmetic is exact: every number in a formula, and every variable, is an exact fraction (see exact-fraction.ts), so 0.1 + 0.2 is 0.3 and
 * a third times three is one. Formulas work in NAIRA. ROUND(x) takes a value to the kobo, half up (half away from zero for a negative one), by the
 * same shared rule as every other line.
 */
import { Exact } from "../exact-fraction";

type Token = { t: "num"; v: Exact } | { t: "id"; v: string } | { t: "op"; v: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const text = src.slice(i, j);
      let v: Exact;
      try {
        v = Exact.decimal(text);
      } catch {
        throw new Error(`Invalid number near "${text}"`);
      }
      out.push({ t: "num", v });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      out.push({ t: "id", v: src.slice(i, j).toUpperCase() });
      i = j;
      continue;
    }
    if ("+-*/(),%".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }
    throw new Error(`Unexpected character "${c}" in formula`);
  }
  return out;
}

const HUNDRED = Exact.int(100);
const NOT_FINITE = "Formula did not produce a finite number";

/** Evaluate a formula with exact fractions: variables in, an exact result out. Variable names are upper case. */
export function evaluateFormulaExact(formula: string, vars: Record<string, Exact>): Exact {
  const tokens = tokenize(formula);
  let pos = 0;
  const peek = () => tokens[pos];
  const take = () => tokens[pos++];
  const expectOp = (v: string) => {
    const tk = take();
    if (!tk || tk.t !== "op" || tk.v !== v) throw new Error(`Expected "${v}" in formula`);
  };

  function expr(): Exact {
    let left = term();
    while (peek() && peek().t === "op" && (peek().v === "+" || peek().v === "-")) {
      const op = take().v;
      const right = term();
      left = op === "+" ? left.add(right) : left.sub(right);
    }
    return left;
  }
  function term(): Exact {
    let left = factor();
    while (peek() && peek().t === "op" && (peek().v === "*" || peek().v === "/")) {
      const op = take().v;
      const right = factor();
      if (op === "/" && right.isZero()) throw new Error("Division by zero in formula");
      left = op === "*" ? left.mul(right) : left.div(right);
    }
    return left;
  }
  function factor(): Exact {
    const tk = take();
    if (!tk) throw new Error("Unexpected end of formula");
    let value: Exact;
    if (tk.t === "num") value = tk.v;
    else if (tk.t === "op" && tk.v === "-") value = factor().neg();
    else if (tk.t === "op" && tk.v === "(") {
      value = expr();
      expectOp(")");
    } else if (tk.t === "id") {
      if (peek() && peek().t === "op" && peek().v === "(") {
        take();
        const args: Exact[] = [];
        if (!(peek() && peek().t === "op" && peek().v === ")")) {
          args.push(expr());
          while (peek() && peek().t === "op" && peek().v === ",") {
            take();
            args.push(expr());
          }
        }
        expectOp(")");
        if (tk.v === "MIN" || tk.v === "MAX" || tk.v === "ROUND") {
          if (args.length === 0) throw new Error(NOT_FINITE);
          if (tk.v === "MIN") value = Exact.min(...args);
          else if (tk.v === "MAX") value = Exact.max(...args);
          else value = Exact.ratio(args[0].mul(HUNDRED).round(), 100); // to the kobo, half up
        } else throw new Error(`Unknown function ${tk.v}`);
      } else {
        if (!(tk.v in vars)) throw new Error(`Unknown variable ${tk.v} in formula`);
        value = vars[tk.v];
      }
    } else throw new Error(`Unexpected token "${tk.v}" in formula`);
    // postfix percent: 10% => 0.10
    if (peek() && peek().t === "op" && peek().v === "%") {
      take();
      value = value.div(HUNDRED);
    }
    return value;
  }

  const result = expr();
  if (pos !== tokens.length) throw new Error("Unexpected trailing tokens in formula");
  return result;
}

/** The same, for callers that have plain numbers (screens, validation, tests): numbers in, the nearest number out. */
export function evaluateFormula(formula: string, vars: Record<string, number>): number {
  const exact: Record<string, Exact> = {};
  for (const [name, v] of Object.entries(vars)) {
    if (!Number.isFinite(v)) throw new Error(NOT_FINITE);
    exact[name] = Exact.fromNumber(v);
  }
  return evaluateFormulaExact(formula, exact).toNumber();
}

export function validateFormula(formula: string, allowedVars: string[]): string | null {
  try {
    const vars: Record<string, number> = {};
    for (const v of allowedVars) vars[v.toUpperCase()] = 1;
    evaluateFormula(formula, vars);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
