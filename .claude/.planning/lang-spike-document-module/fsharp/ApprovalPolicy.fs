/// approval-policy — funções puras. Tradução fiel de `approval-policy.ts` (#289).
module Financial.Domain.ApprovalPolicy

open Financial.Domain.Money

type ApproverAuthority =
    { UserId: string
      CanApprove: bool
      Limit: Money option } // `limit: Money | null` → option nativo

type ApprovalError =
    | ApproverNotFound
    | ApproverMissingPermission
    | ApproverLimitExceeded
    | NoApproverWithSufficientLimit

/// US1 — valida o aprovador contra o valor líquido.
/// ATENÇÃO: os guards `when` abaixo derrotam a checagem de exaustividade do compilador — é o
/// preço do estilo condicional em F#. Onde possível, prefira match sem guard (ver `Document.submit`).
let checkApprover (netValue: Money) (authority: ApproverAuthority option) : Result<unit, ApprovalError> =
    match authority with
    | None -> Error ApproverNotFound
    | Some a when not a.CanApprove -> Error ApproverMissingPermission
    // #299: alçada opt-in — só enforça o teto quando `Limit` está definido.
    | Some { Limit = Some limit } when greaterThan netValue limit -> Error ApproverLimitExceeded
    | Some _ -> Ok()

/// US3 (cascata) — escolhe o próximo aprovador com alçada suficiente (menor limite ≥ líquido).
let escalate (netValue: Money) (candidates: ApproverAuthority list) : Result<ApproverAuthority, ApprovalError> =
    let sufficient =
        candidates
        |> List.filter (fun c ->
            c.CanApprove
            && (match c.Limit with
                | Some l -> not (greaterThan netValue l)
                | None -> false))

    match sufficient with
    | [] ->
        Error(
            if List.length candidates <= 1 then
                ApproverLimitExceeded
            else
                NoApproverWithSufficientLimit
        )
    | _ ->
        sufficient
        |> List.minBy (fun c ->
            match c.Limit with
            | Some l -> cents l
            | None -> System.Int64.MaxValue)
        |> Ok
