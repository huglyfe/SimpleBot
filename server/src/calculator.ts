export function calculate(expression: string): number {
  const parser = new ArithmeticParser(expression);
  const result = parser.parse();
  if (!Number.isFinite(result)) throw new Error('Result is not finite');
  return result;
}

class ArithmeticParser {
  #index = 0;

  constructor(private readonly source: string) {}

  parse(): number {
    const value = this.expression();
    this.space();
    if (this.#index !== this.source.length) {
      throw new Error(
        `Unexpected token at position ${String(this.#index + 1)}`,
      );
    }
    return value;
  }

  expression(): number {
    let value = this.term();
    for (;;) {
      if (this.take('+')) value += this.term();
      else if (this.take('-')) value -= this.term();
      else return value;
    }
  }

  term(): number {
    let value = this.unary();
    for (;;) {
      if (this.take('*')) value *= this.unary();
      else if (this.take('/')) value = divide(value, this.unary(), '/');
      else if (this.take('%')) value = divide(value, this.unary(), '%');
      else return value;
    }
  }

  unary(): number {
    if (this.take('+')) return this.unary();
    if (this.take('-')) return -this.unary();
    return this.power();
  }

  power(): number {
    let value = this.primary();
    if (this.take('^')) value **= this.unary();
    return value;
  }

  primary(): number {
    if (this.take('(')) {
      const value = this.expression();
      if (!this.take(')')) throw new Error('Missing closing parenthesis');
      return value;
    }
    this.space();
    const match = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/iu.exec(
      this.source.slice(this.#index),
    );
    if (match === null) {
      throw new Error(
        `Expected a number at position ${String(this.#index + 1)}`,
      );
    }
    this.#index += match[0].length;
    return Number(match[0]);
  }

  take(token: string): boolean {
    this.space();
    if (!this.source.startsWith(token, this.#index)) return false;
    this.#index += token.length;
    return true;
  }

  space(): void {
    while (/\s/u.test(this.source[this.#index] ?? '')) this.#index += 1;
  }
}

function divide(left: number, right: number, operator: '/' | '%'): number {
  if (right === 0) throw new Error('Division by zero');
  return operator === '/' ? left / right : left % right;
}
