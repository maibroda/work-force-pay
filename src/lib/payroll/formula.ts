/**
 * Safe arithmetic formula evaluator for salary components.
 * Supports numbers, + - * / ( ), unary minus, identifiers (e.g. GROSS, BASIC, RATE, DAYS)
 * and the functions MIN(a,b,...), MAX(a,b,...), ROUND(x).
 * No `eval` — tokens are parsed with a small recursive-descent parser.
 */
type Token = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

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
      const n = Number(src.slice(i, j));
      if (!Number.isFinite(n)) throw new Error(`Invalid number near "${src.slice(i, j)}"`);
      out.push({ t: "num", v: n });
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

export function evaluateFormula(formula: string, vars: Record<string, number>): number {
  const tokens = tokenize(formula);
  let pos = 0;
  const peek = () => tokens[pos];
  const take = () => tokens[pos++];
  const expectOp = (v: string) => {
    const tk = take();
    if (!tk || tk.t !== "op" || tk.v !== v) throw new Error(`Expected "${v}" in formula`);
  };

  function expr(): number {
    let left = term();
    while (peek() && peek().t === "op" && (peek().v === "+" || peek().v === "-")) {
      const op = take().v;
      const right = term();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }
  function term(): number {
    let left = factor();
    while (peek() && peek().t === "op" && (peek().v === "*" || peek().v === "/")) {
      const op = take().v;
      const right = factor();
      if (op === "/" && right === 0) throw new Error("Division by zero in formula");
      left = op === "*" ? left * right : left / right;
    }
    return left;
  }
  function factor(): number {
    const tk = take();
    if (!tk) throw new Error("Unexpected end of formula");
    let value: number;
    if (tk.t === "num") value = tk.v;
    else if (tk.t === "op" && tk.v === "-") value = -factor();
    else if (tk.t === "op" && tk.v === "(") {
      value = expr();
      expectOp(")");
    } else if (tk.t === "id") {
      if (peek() && peek().t === "op" && peek().v === "(") {
        take();
        const args: number[] = [];
        if (!(peek() && peek().t === "op" && peek().v === ")")) {
          args.push(expr());
          while (peek() && peek().t === "op" && peek().v === ",") {
            take();
            args.push(expr());
          }
        }
        expectOp(")");
        if (tk.v === "MIN") value = Math.min(...args);
        else if (tk.v === "MAX") value = Math.max(...args);
        else if (tk.v === "ROUND") value = Math.round(args[0] * 100) / 100;
        else throw new Error(`Unknown function ${tk.v}`);
      } else {
        if (!(tk.v in vars)) throw new Error(`Unknown variable ${tk.v} in formula`);
        value = vars[tk.v];
      }
    } else throw new Error(`Unexpected token "${tk.v}" in formula`);
    // postfix percent: 10% => 0.10
    if (peek() && peek().t === "op" && peek().v === "%") {
      take();
      value = value / 100;
    }
    return value;
  }

  const result = expr();
  if (pos !== tokens.length) throw new Error("Unexpected trailing tokens in formula");
  if (!Number.isFinite(result)) throw new Error("Formula did not produce a finite number");
  return result;
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
