import type { BattleState } from "../battle/types";

import type {
    DamageResult,
    DamageRequest,
} from "./types";

import { buildDamageContext } from "./adapter";

export function calculateDamage(
    battle: BattleState,
    request: DamageRequest,
): DamageResult {

    const context =
        buildDamageContext(
            battle,
            request,
        );

    /*
        Ici on appellera
        GET_DAMAGE_SV(...)
    */

    throw new Error(
        "NCP engine not integrated yet.",
    );
}
