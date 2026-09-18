import { Injectable } from "@nestjs/common";
import type { TransactionSql } from "postgres";

export type RecoverableEarning = Readonly<{
  id: string;
  amount_minor: string;
}>;

export type ClaimAllocation = Readonly<{
  earningId: string;
  earningAmountMinor: string;
  payoutAmountMinor: string;
  recoveryAmountMinor: string;
}>;

@Injectable()
export class ClaimRecoveryService {
  async allocate(
    sql: TransactionSql,
    input: {
      organizationId: string;
      partnerId: string;
      currency: string;
      earnings: readonly RecoverableEarning[];
    },
  ): Promise<ClaimAllocation[]> {
    const [ledger] = await sql<
      { balance: string }[]
    >`select coalesce(sum(amount_minor),0)::text balance
      from ledger_entries where organization_id=${input.organizationId}
      and partner_id=${input.partnerId} and currency=${input.currency}`;
    const [reserved] = await sql<
      { amount: string }[]
    >`select coalesce(sum(ci.earning_amount_minor-ci.amount_minor),0)::text amount
      from claims c
      join claim_items ci on ci.organization_id=c.organization_id and ci.claim_id=c.id
      where c.organization_id=${input.organizationId} and c.partner_id=${input.partnerId}
      and c.currency=${input.currency} and c.status in ('created','processing')`;
    const projectedBalance = BigInt(ledger?.balance ?? "0") + BigInt(reserved?.amount ?? "0");
    let remainingDebt = projectedBalance < 0n ? -projectedBalance : 0n;

    return [...input.earnings]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((earning) => {
        const amount = BigInt(earning.amount_minor);
        const recovery = amount < remainingDebt ? amount : remainingDebt;
        remainingDebt -= recovery;
        return {
          earningId: earning.id,
          earningAmountMinor: amount.toString(),
          payoutAmountMinor: (amount - recovery).toString(),
          recoveryAmountMinor: recovery.toString(),
        };
      });
  }
}
