/**
 * engine/megaStones.ts
 *
 * Table de correspondance "nom de Mega Stone" -> "nom de forme Mega",
 * nécessaire car le protocole Showdown (|-mega|POKEMON|SPECIES|MEGASTONE)
 * ne donne que l'espèce de BASE et le nom de l'objet, jamais directement le
 * nom de la forme résultante.
 *
 * Construite à partir de la liste réelle des Mega Stones disponibles dans
 * Pokémon Champions Reg M-B (cf. ITEMS_CHAMPIONS du calculateur NCP) et des
 * formes 'Mega X' correspondantes présentes dans POKEDEX_CHAMPIONS.
 *
 * NOTE D'ENTRETIEN : si une future Regulation Set (M-C, etc.) ajoute de
 * nouvelles Mega Stones, il faudra étendre cette table en conséquence — le
 * code qui s'en sert (engine/reducer.ts) ne plante pas si une stone est
 * inconnue, il laisse juste le Pokémon sous sa forme de base (megaForme reste
 * null), à corriger manuellement ici dès qu'on identifie le cas.
 */

export const MEGA_STONE_TO_FORME: Record<string, string> = {
  Venusaurite: 'Mega Venusaur',
  'Charizardite X': 'Mega Charizard X',
  'Charizardite Y': 'Mega Charizard Y',
  Blastoisinite: 'Mega Blastoise',
  Beedrillite: 'Mega Beedrill',
  Pidgeotite: 'Mega Pidgeot',
  'Raichunite X': 'Mega Raichu X',
  'Raichunite Y': 'Mega Raichu Y',
  Clefablite: 'Mega Clefable',
  Alakazite: 'Mega Alakazam',
  Victreebelite: 'Mega Victreebel',
  Slowbronite: 'Mega Slowbro',
  Gengarite: 'Mega Gengar',
  Kangaskhanite: 'Mega Kangaskhan',
  Starminite: 'Mega Starmie',
  Pinsirite: 'Mega Pinsir',
  Gyaradosite: 'Mega Gyarados',
  Aerodactylite: 'Mega Aerodactyl',
  Dragoninite: 'Mega Dragonite',
  Meganiumite: 'Mega Meganium',
  Feraligite: 'Mega Feraligatr',
  Ampharosite: 'Mega Ampharos',
  Steelixite: 'Mega Steelix',
  Scizorite: 'Mega Scizor',
  Heracronite: 'Mega Heracross',
  Skarmorite: 'Mega Skarmory',
  Houndoominite: 'Mega Houndoom',
  Tyranitarite: 'Mega Tyranitar',
  Gardevoirite: 'Mega Gardevoir',
  Sablenite: 'Mega Sableye',
  Aggronite: 'Mega Aggron',
  Medichamite: 'Mega Medicham',
  Manectite: 'Mega Manectric',
  Sharpedonite: 'Mega Sharpedo',
  Cameruptite: 'Mega Camerupt',
  Altarianite: 'Mega Altaria',
  Banettite: 'Mega Banette',
  Chimechite: 'Mega Chimecho',
  Absolite: 'Mega Absol',
  Glalitite: 'Mega Glalie',
  Garchompite: 'Mega Garchomp',
  Lucarionite: 'Mega Lucario',
  Abomasite: 'Mega Abomasnow',
  Galladite: 'Mega Gallade',
  Froslassite: 'Mega Froslass',
  Emboarite: 'Mega Emboar',
  Excadrite: 'Mega Excadrill',
  Audinite: 'Mega Audino',
  Chandelurite: 'Mega Chandelure',
  Golurkite: 'Mega Golurk',
  Chesnaughtite: 'Mega Chesnaught',
  Delphoxite: 'Mega Delphox',
  Greninjite: 'Mega Greninja',
  Floettite: 'Mega Floette',
  Meowsticite: 'Mega Meowstic',
  Hawluchanite: 'Mega Hawlucha',
  Crabominite: 'Mega Crabominable',
  Drampanite: 'Mega Drampa',
  Scovillainite: 'Mega Scovillain',
  Glimmoranite: 'Mega Glimmora',
  Falinksite: 'Mega Falinks',
  Staraptite: 'Mega Staraptor',
  Blazikenite: 'Mega Blaziken',
  Mawilite: 'Mega Mawile',
  Swampertite: 'Mega Swampert',
  Sceptilite: 'Mega Sceptile',
  Metagrossite: 'Mega Metagross',
  Scolipite: 'Mega Scolipede',
  Scraftinite: 'Mega Scrafty',
  Eelektrossite: 'Mega Eelektross',
  Pyroarite: 'Mega Pyroar',
  Malamarite: 'Mega Malamar',
  Barbaracite: 'Mega Barbaracle',
  Dragalgite: 'Mega Dragalge',
};

/** Résout le nom de forme Mega depuis le nom de la Mega Stone, ou null si inconnue. */
export function resolveMegaForme(megaStone: string): string | null {
  return MEGA_STONE_TO_FORME[megaStone] ?? null;
}
