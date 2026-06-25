interface PokemonState {
  species: string;
  position: 'p1a' | 'p1b' | 'p2a' | 'p2b';
  level: number;
  currentHP: number;     // absolu si on connaît maxHP, sinon %
  maxHP: number | null;  // null si jamais révélé en absolu (adversaire)
  status: StatusCondition | null;
  boosts: Record<StatId, number>;  // -6 à +6
  volatiles: Set<string>;          // confusion, taunt, substitute...
  revealedMoves: string[];          // appris au fil du replay
  revealedItem: string | null;
  revealedAbility: string | null;
  isTerastallized: boolean;
  teraType: string | null;
  // Champs à compléter manuellement si jamais révélés :
  knownSet: PartialPokemonSet;     // ce qu'on sait
  userProvidedSet: PartialPokemonSet | null; // ce que l'utilisateur a rempli
}

interface BattleState {
  turnNumber: number;
  field: {
    weather: string | null;
    terrain: string | null;
    isTrickRoom: boolean;
    isGravity: boolean;
  };
  sides: {
    p1: SideState;  // hazards, tailwind, reflect, lightscreen...
    p2: SideState;
  };
  pokemon: Record<string, PokemonState>;  // clé = position ou ident unique
  teams: { p1: PokemonState[]; p2: PokemonState[] };  // les 4 non-actifs inclus
}
