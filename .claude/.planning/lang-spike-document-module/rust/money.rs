//! Money — VO em centavos (i64), newtype. Espelha `shared/kernel/money.ts`.
//! Regra do domain.md: branded type + smart constructor; imutável; nenhum panic cruza a borda.

/// Money em centavos. Campo privado: só `from_cents` constrói.
/// Equivale ao `as Money` auditado do TS — mas aqui é garantia do compilador, não convenção.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Money(i64);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MoneyError {
    Negative,
    Overflow,
}

impl Money {
    pub const ZERO: Money = Money(0);

    /// Smart constructor. Retorna `Result` — sem `throw`/panic (regra do domínio).
    pub fn from_cents(cents: i64) -> Result<Money, MoneyError> {
        if cents < 0 {
            return Err(MoneyError::Negative);
        }
        Ok(Money(cents))
    }

    pub fn cents(self) -> i64 {
        self.0
    }

    /// Espelha `Money.greaterThan(a, b)` do TS.
    pub fn greater_than(self, other: Money) -> bool {
        self.0 > other.0
    }

    pub fn add(self, other: Money) -> Result<Money, MoneyError> {
        self.0
            .checked_add(other.0)
            .map(Money)
            .ok_or(MoneyError::Overflow)
    }
}
