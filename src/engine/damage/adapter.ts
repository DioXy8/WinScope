export function buildDamageContext(
    battle: BattleState,
    request: DamageRequest,
) {

    return {

        attacker:
            buildPokemon(...),

        defender:
            buildPokemon(...),

        move:
            buildMove(...),

        field:
            buildField(...),
    };

}
