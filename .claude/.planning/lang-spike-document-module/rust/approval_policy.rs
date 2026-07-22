//! approval-policy — funções puras. Tradução fiel de `approval-policy.ts` (#289).

use crate::money::Money;

/// Projeção mínima da autoridade de aprovação (ACL — lida do `auth`).
#[derive(Debug, Clone)]
pub struct ApproverAuthority {
    pub user_id: String,
    pub can_approve: bool,
    pub limit: Option<Money>, // `limit: Money | null` → Option nativo
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApprovalError {
    ApproverNotFound,
    ApproverMissingPermission,
    ApproverLimitExceeded,
    NoApproverWithSufficientLimit,
}

/// US1 — valida o aprovador contra o valor líquido. Função pura.
pub fn check_approver(
    net_value: Money,
    authority: Option<&ApproverAuthority>,
) -> Result<(), ApprovalError> {
    // `ok_or` + `?`: o `authority === null` do TS vira early-return sem boilerplate.
    let a = authority.ok_or(ApprovalError::ApproverNotFound)?;
    if !a.can_approve {
        return Err(ApprovalError::ApproverMissingPermission);
    }
    // #299: alçada opt-in. `limit == None` = sem limite configurado = aprova.
    if let Some(limit) = a.limit {
        if net_value.greater_than(limit) {
            return Err(ApprovalError::ApproverLimitExceeded);
        }
    }
    Ok(())
}

/// US3 (cascata) — escolhe o próximo aprovador com alçada suficiente (menor limite ≥ líquido).
/// Dois erros: `<= 1` candidato ⇒ ApproverLimitExceeded; `> 1` e nenhum suficiente ⇒ NoApprover...
pub fn escalate<'a>(
    net_value: Money,
    candidates: &'a [ApproverAuthority],
) -> Result<&'a ApproverAuthority, ApprovalError> {
    let sufficient: Vec<&ApproverAuthority> = candidates
        .iter()
        .filter(|c| c.can_approve && matches!(c.limit, Some(l) if !net_value.greater_than(l)))
        .collect();

    match sufficient.first() {
        None => Err(if candidates.len() <= 1 {
            ApprovalError::ApproverLimitExceeded
        } else {
            ApprovalError::NoApproverWithSufficientLimit
        }),
        Some(_) => Ok(sufficient
            .iter()
            .copied()
            .min_by_key(|c| c.limit.map(Money::cents).unwrap_or(i64::MAX))
            .unwrap()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn money(c: i64) -> Money {
        Money::from_cents(c).unwrap()
    }

    #[test]
    fn none_authority_is_not_found() {
        assert_eq!(
            check_approver(money(100), None),
            Err(ApprovalError::ApproverNotFound)
        );
    }

    #[test]
    fn no_limit_approves() {
        let a = ApproverAuthority {
            user_id: "u1".into(),
            can_approve: true,
            limit: None,
        };
        assert_eq!(check_approver(money(99_900), Some(&a)), Ok(()));
    }

    #[test]
    fn over_limit_is_exceeded() {
        let a = ApproverAuthority {
            user_id: "u1".into(),
            can_approve: true,
            limit: Some(money(10_000)),
        };
        assert_eq!(
            check_approver(money(15_000), Some(&a)),
            Err(ApprovalError::ApproverLimitExceeded)
        );
    }

    #[test]
    fn escalate_picks_smallest_sufficient_limit() {
        let cs = vec![
            ApproverAuthority {
                user_id: "big".into(),
                can_approve: true,
                limit: Some(money(100_000)),
            },
            ApproverAuthority {
                user_id: "fit".into(),
                can_approve: true,
                limit: Some(money(20_000)),
            },
        ];
        let chosen = escalate(money(15_000), &cs).unwrap();
        assert_eq!(chosen.user_id, "fit");
    }
}
