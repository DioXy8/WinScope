export const SAMPLE_VGC_LOG = `|j|☆Alice
|j|☆Bob
|player|p1|Alice|266|1500
|player|p2|Bob|268|1480
|teamsize|p1|4
|teamsize|p2|4
|gametype|doubles
|gen|9
|tier|[Gen 9] VGC 2025 Reg H (Bo3)
|rule|Species Clause: Limit one of each Pokémon
|rule|Item Clause: Limit one of each item
|clearpoke
|poke|p1|Incineroar, F|item
|poke|p1|Rillaboom, M|item
|poke|p1|Amoonguss, M|item
|poke|p1|Flutter Mane|item
|poke|p2|Urshifu-Rapid-Strike, M|item
|poke|p2|Tornadus, M|item
|poke|p2|Calyrex-Shadow|item
|poke|p2|Grimmsnarl, M|item
|teampreview
|
|start
|switch|p1a: Incineroar|Incineroar, F|100/100
|switch|p1b: Rillaboom|Rillaboom, M|100/100
|switch|p2a: Urshifu|Urshifu-Rapid-Strike, M|100/100
|switch|p2b: Tornadus|Tornadus, M|100/100
|turn|1
|move|p1a: Incineroar|Fake Out|p2b: Tornadus
|-damage|p2b: Tornadus|88/100
|cant|p2b: Tornadus|flinch
|move|p1b: Rillaboom|Grassy Glide|p2a: Urshifu
|-supereffective|p2a: Urshifu
|-damage|p2a: Urshifu|45/100
|move|p2a: Urshifu|Surging Strikes|p1b: Rillaboom
|-crit|p1b: Rillaboom
|-damage|p1b: Rillaboom|62/100
|-crit|p1b: Rillaboom
|-damage|p1b: Rillaboom|24/100
|-crit|p1b: Rillaboom
|-damage|p1b: Rillaboom|0 fnt
|faint|p1b: Rillaboom
|-fieldstart|move: Grassy Terrain|[from] ability: Grassy Surge
|upkeep
|turn|2
|switch|p1b: Amoonguss|Amoonguss, M|100/100
|move|p2b: Tornadus|Bleakwind Storm|p1a: Incineroar
|-supereffective|p1a: Incineroar
|-damage|p1a: Incineroar|54/100
|-unboost|p1a: Incineroar|spe|1
|move|p1a: Incineroar|Fake Out|p2a: Urshifu
|-damage|p2a: Urshifu|32/100
|cant|p2a: Urshifu|flinch
|move|p1b: Amoonguss|Spore|p2b: Tornadus
|-status|p2b: Tornadus|slp
|-weather|none|[upkeep]
|upkeep
|-heal|p1a: Incineroar|60/100|[from] item: Leftovers
|turn|3
|win|Alice
/**
 * Petit complément de log isolé, juste pour tester la Mega Evolution
 * (mécanique propre à Pokémon Champions, absente du sample principal).
 */
export const SAMPLE_MEGA_EVOLUTION_LINES = `|switch|p1a: Garchomp|Garchomp, M|100/100
|-mega|p1a: Garchomp|Garchomp|Garchompite
|move|p1a: Garchomp|Earthquake|p2a: Urshifu
`;
`;
