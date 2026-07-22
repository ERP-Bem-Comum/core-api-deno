/// Money — VO em centavos, single-case DU. Espelha `shared/kernel/money.ts`.
/// Regra do domain.md: branded type + smart constructor; imutável; nenhuma exceção cruza a borda.
module Financial.Domain.Money

// Construtor privado ao módulo: só `fromCents` cria. Equivale ao `as Money` do TS — mas sem cast.
type Money = private Money of int64

type MoneyError =
    | Negative
    | Overflow

let zero = Money 0L

/// Smart constructor. Retorna Result — sem `throw` (regra do domínio).
let fromCents (cents: int64) : Result<Money, MoneyError> =
    if cents < 0L then Error Negative else Ok(Money cents)

let cents (Money c) = c

/// Espelha `Money.greaterThan(a, b)`.
let greaterThan (Money a) (Money b) = a > b

let add (Money a) (Money b) : Result<Money, MoneyError> =
    if a > System.Int64.MaxValue - b then Error Overflow else Ok(Money(a + b))
