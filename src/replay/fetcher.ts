// replay/types.ts
interface ParsedLine {
  turn: number;
  raw: string;
  type: string;        // 'move' | 'switch' | '-damage' | ...
  args: string[];
}

interface ParsedReplay {
  format: string;       // ex: "gen9vgc2025reghbo3"
  players: { p1: string; p2: string };
  teamPreview: { p1: PokemonDetails[]; p2: PokemonDetails[] };
  turns: ParsedLine[][];  // turns[0] = lignes du tour 1, etc.
}
