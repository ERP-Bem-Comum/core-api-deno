/// Teste do approval-policy (Expecto). Espelha os testes de contrato do domínio.
module Financial.Domain.ApprovalPolicyTests

open Expecto
open Financial.Domain.Money
open Financial.Domain.ApprovalPolicy

let private money c =
    match fromCents c with
    | Ok m -> m
    | Error _ -> failwith "fixture inválida"

[<Tests>]
let tests =
    testList
        "approval-policy"
        [ test "None → ApproverNotFound" {
              Expect.equal (checkApprover (money 100L) None) (Error ApproverNotFound) "sem autoridade"
          }
          test "limit None aprova" {
              let a = { UserId = "u1"; CanApprove = true; Limit = None }
              Expect.equal (checkApprover (money 99_900L) (Some a)) (Ok()) "sem limite = aprova"
          }
          test "acima do limite → ApproverLimitExceeded" {
              let a = { UserId = "u1"; CanApprove = true; Limit = Some(money 10_000L) }
              Expect.equal
                  (checkApprover (money 15_000L) (Some a))
                  (Error ApproverLimitExceeded)
                  "excede o teto"
          }
          test "cascata escolhe o menor limite suficiente" {
              let cs =
                  [ { UserId = "big"; CanApprove = true; Limit = Some(money 100_000L) }
                    { UserId = "fit"; CanApprove = true; Limit = Some(money 20_000L) } ]

              match escalate (money 15_000L) cs with
              | Ok chosen -> Expect.equal chosen.UserId "fit" "menor suficiente"
              | Error e -> failtestf "esperava Ok, veio %A" e
          } ]
