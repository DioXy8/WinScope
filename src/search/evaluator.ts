/**
 * search/evaluator.ts
 *
 * Heuristique PROVISOIRE d'évaluation d'un BattleState en "% de chances de
 * gagner" pour p1. Tant que le vrai damage calculator + moteur de recherche
 * (search/turnAnalyzer.ts) ne sont pas branchés sur une vraie recherche
 * complète, on approxime avec une formule basée sur :
 *   1. Le nombre de Pokémon vivants de chaque côté (le facteur dominant —
 *      un Pokémon de réserve en pleine forme vaut largement plus qu'une
 *      fraction de %HP sur les actifs : avoir un Pokémon d'avance change
 *      fondamentalement l'issue probable d'un match VGC).
 *   2. Les HP% cumulés des Pokémon vivants (facteur secondaire, pour
 *      distinguer "à égalité numérique mais en meilleure santé").
 *   3. Les boosts et statuts actifs (ajustement fin).
 *
 * CE N'EST PAS le moteur de simulation final décrit dans l'architecture du
 * projet. C'est une estimation rapide, suffisante pour afficher une courbe
 * de tendance dans l'UI en attendant une vraie recherche multi-tours.
 */

import type { BattleState, PokemonState } from '../engine/state';

/**
 * VGC Reg M-B : 6 Pokémon annoncés en Team Preview, mais seulement 4
 * réellement amenés en combat par côté (même constante que
 * App.tsx::getKnownTargets — MAX_TEAM_SIZE). Une fois que 4 Pokémon
 * RÉELLEMENT envoyés (hasBeenSentOut) ont été vus pour un côté, les
 * entrées jamais envoyées restantes sont des fantômes de Team Preview
 * garantis ne jamais apparaître.
 */
export const REG_MB_MAX_TEAM_SIZE = 4;

/** Sur les Pokémon RÉELLEMENT envoyés en combat pour ce côté, vus jusqu'ici (fainted ou non). Exporté pour partage avec minimax.ts (isTerminal doit appliquer la même logique de fantômes de Team Preview). */
export function sentOutCountForSide(battle: BattleState, side: 'p1' | 'p2'): number {
  return Object.values(battle.pokemonByKey).filter((p) => p.side === side && p.hasBeenSentOut).length;
}

/** Score brut d'un seul Pokémon VIVANT : HP% (ajusté par statut) + bonus de boost. Toujours 0 si KO. */
function pokemonHealthScore(p: PokemonState): number {
  if (p.fainted) return 0;
  const maxHp = p.maxHp ?? 100;
  const hpFraction = Math.max(0, Math.min(1, p.currentHp / maxHp));
  const statusFactor = p.status === 'slp' || p.status === 'frz' ? 0.85 : p.status === 'par' ? 0.92 : 1;

  // Bonus de boost ADDITIF plutôt que multiplicatif sur le %HP : avec un
  // multiplicateur borné à [0.25, 1.75] appliqué à un hpFraction max de 1.0,
  // même un boost énorme (Shell Smash : +2/+2/+2, -1/-1, somme nette +4) ne
  // pouvait jamais déplacer le score de plus de quelques points une fois
  // noyé dans ALIVE_COUNT_WEIGHT=4 par Pokémon vivant — largement
  // insuffisant pour refléter qu'un tel boost change concrètement la donne
  // (dégâts ~doublés, joue quasi toujours en premier). Le bonus additif
  // reste une approximation grossière (aucune pondération par stat — un
  // boost de vitesse ou d'attaque compte pareil qu'un boost défensif, et il
  // ignore si l'adversaire peut ou non exploiter la faiblesse en Def/SpD
  // laissée par Shell Smash), mais pèse enfin un poids comparable à une
  // vraie différence de Pokémon en vie.
  // `p.boosts` peut être un objet PARTIEL (seules les stats effectivement
  // modifiées présentes, ex: `{atk: -1}` sans def/spa/spd/spe) selon le
  // chemin de construction de l'état — additionner une clé manquante
  // (`undefined`) transforme silencieusement TOUT le calcul en NaN, qui se
  // propage ensuite jusqu'au % affiché sans qu'aucune erreur ne remonte.
  // D'où `?? 0` sur chaque stat : une stat non présente = non boostée.
  const boostSum =
    (p.boosts.atk ?? 0) + (p.boosts.spa ?? 0) + (p.boosts.def ?? 0) + (p.boosts.spd ?? 0) + (p.boosts.spe ?? 0);
  const boostBonus = Math.max(-1.5, Math.min(1.5, boostSum * 0.25));

  return hpFraction * statusFactor + boostBonus;
}

interface SideSummary {
  /** Nombre de Pokémon connus de ce camp qui ne sont pas K.O. (fantômes de Team Preview exclus, réserves non confirmées pondérées). */
  aliveCount: number;
  /** Somme des scores de santé des Pokémon vivants (entre 0 et aliveCount). */
  healthSum: number;
  /** Nombre de Pokémon RÉELLEMENT CONFIRMÉS (déjà envoyés au moins une fois) encore en vie — exclut les réserves non confirmées, même pondérées. Sert à détecter "ce camp n'a plus AUCUN combattant connu sur le terrain", un vrai désavantage tactique (doit envoyer un inconnu à l'aveugle) que le simple aliveCount pondéré ne capture pas. */
  confirmedFieldedCount: number;
}

function summarizeSide(battle: BattleState, side: 'p1' | 'p2'): SideSummary {
  const pokemons = Object.values(battle.pokemonByKey).filter((p) => p.side === side);
  const sentOutCount = sentOutCountForSide(battle, side);
  const unconfirmed = pokemons.filter((p) => !p.hasBeenSentOut && !p.fainted);
  // "Roster complet" : soit les 4 du bring-4 sont déjà tous confirmés (peu
  // importe combien de fantômes de Team Preview restent), soit il ne reste
  // simplement plus aucune entrée "jamais envoyée" à départager (scénario
  // sans données de Team Preview du tout, ou tout le monde déjà vu).
  const rosterComplete = sentOutCount >= REG_MB_MAX_TEAM_SIZE || unconfirmed.length === 0;

  // Combien des membres RÉELLEMENT amenés en combat restent inconnus (Reg
  // M-B : 4 au total). Répartie sur toutes les entrées "jamais envoyées et
  // pas fainted" (dont certaines sont en réalité des fantômes qui ne
  // sortiront jamais) — on ne sait pas LESQUELLES sont réelles, donc un
  // poids proportionnel plutôt que tout-ou-rien. Ex: 2 déjà envoyés, 4
  // jamais-envoyés dans pokemonByKey (Team Preview) → 2 des 4 sont réels →
  // poids 0.5 chacun, soit 2.0 au total (pas 4.0, ni 0).
  const unconfirmedWeight =
    rosterComplete || unconfirmed.length === 0
      ? 0
      : Math.min(1, Math.max(0, REG_MB_MAX_TEAM_SIZE - sentOutCount) / unconfirmed.length);

  let aliveCount = 0;
  let healthSum = 0;
  let confirmedFieldedCount = 0;
  for (const p of pokemons) {
    if (p.fainted) continue;
    if (p.hasBeenSentOut) {
      // Confirmé réel : sur le terrain ou déjà vu ce combat, poids plein.
      aliveCount += 1;
      healthSum += pokemonHealthScore(p);
      confirmedFieldedCount += 1;
    } else if (!rosterComplete) {
      // Annoncé en Team Preview, jamais envoyé : peut-être un des membres
      // restants du bring-4, peut-être un fantôme laissé à la maison — poids
      // proportionnel (voir ci-dessus). Si l'équipe des 4 est déjà complète
      // (rosterComplete), cette entrée est un fantôme GARANTI : exclue
      // entièrement (aliveCount/healthSum inchangés dans ce cas).
      aliveCount += unconfirmedWeight;
      healthSum += unconfirmedWeight * pokemonHealthScore(p); // vraies %HP/boosts si connus, sinon la valeur par défaut (100%, pas de boost) déjà gérée par pokemonHealthScore
    }
  }
  return { aliveCount, healthSum, confirmedFieldedCount };
}

/**
 * Poids relatif du nombre de Pokémon vivants par rapport aux HP% cumulés,
 * dans le score final. Une valeur élevée signifie qu'un avantage numérique
 * (ex: 3 Pokémon vivants contre 1) domine largement de simples différences
 * de %HP — cohérent avec la réalité du jeu : un Pokémon de réserve en
 * pleine forme est presque toujours plus précieux qu'un peu de %HP en plus
 * sur les Pokémon déjà actifs.
 */
const ALIVE_COUNT_WEIGHT = 4;

/**
 * Pénalité structurelle appliquée quand un camp n'a plus qu'UN SEUL Pokémon
 * vivant face à un adversaire qui en a strictement plus : en double, ce
 * dernier Pokémon encaisse potentiellement les deux attaques adverses
 * CHAQUE tour tout en ne pouvant riposter qu'une fois — un désavantage
 * mécanique réel, pas juste un ajustement arbitraire. Sans ce facteur,
 * l'ancien modèle purement additif (aliveCount*poids + HP%) sous-estimait
 * nettement la gravité de ce genre de fin de match (ex: 30% HP, seul,
 * contre deux Pokémon pleine forme, estimé à ~30% de victoire — bien trop
 * optimiste pour une situation généralement quasi perdue).
 */
const OUTNUMBERED_ALONE_PENALTY = 0.65;

/**
 * Pénalité structurelle appliquée quand un camp n'a PLUS AUCUN combattant
 * CONFIRMÉ sur le terrain (tous ses membres déjà envoyés sont tombés),
 * même s'il a en théorie des réserves non confirmées restantes (Reg M-B).
 * Le simple `aliveCount` pondéré traite "2 réserves inconnues probables"
 * comme équivalent à "2 Pokémon confirmés en pleine forme" — ce qui ignore
 * un vrai désavantage tactique : ce camp doit envoyer un Pokémon à
 * l'aveugle (sans savoir s'il match bien) FACE à un adversaire déjà
 * installé (positionnement, boosts, terrain en sa faveur). Sans ce
 * facteur, balayer complètement les 2 actifs adverses sans dommage pouvait
 * ressortir à un ~50/50 dès que l'adversaire avait des réserves non
 * confirmées — largement trop pessimiste pour un tour qui vient de gagner
 * un tempo décisif.
 */
const NO_CONFIRMED_FIGHTER_PENALTY = 0.7;

function sideScore(summary: SideSummary, isOutnumberedAlone: boolean): number {
  const base = summary.aliveCount * ALIVE_COUNT_WEIGHT + summary.healthSum;
  const outnumberedAdjusted = isOutnumberedAlone ? base * OUTNUMBERED_ALONE_PENALTY : base;
  const noConfirmedFighter = summary.confirmedFieldedCount === 0 && summary.aliveCount > 0;
  return noConfirmedFighter ? outnumberedAdjusted * NO_CONFIRMED_FIGHTER_PENALTY : outnumberedAdjusted;
}

/**
 * Retourne une estimation du % de victoire de p1, entre 1 et 99 (jamais 0/100
 * tant que les deux joueurs ont au moins un Pokémon en vie, pour éviter de
 * donner une fausse impression de certitude absolue tant que le match n'est
 * pas réellement terminé).
 *
 * RÔLE DANS LE PIPELINE : cette fonction évalue une POSITION ISOLÉE (nombre
 * de vivants + %HP + boosts/statut), SANS AUCUNE RECHERCHE elle-même — c'est
 * une heuristique statique de feuille (« leaf eval »), comme la fonction
 * d'évaluation d'un moteur d'échecs. Ce n'est PAS elle qui fait la recherche
 * en profondeur : c'est le rôle de search/minimax.ts, qui l'appelle au bout
 * de sa recherche adversariale multi-tours (alpha-beta, plusieurs plis) pour
 * juger les positions atteintes. Avant l'ajout de minimax.ts, turnAnalyzer.ts
 * appelait cette heuristique juste après UN SEUL tour simulé (d'où l'ancienne
 * limite « horizon 1 tour, Calm Mind jamais reconnu ») — ce n'est plus le cas
 * pour l'analyse par défaut de l'UI (recherche à profondeur 2+ via minimax.ts),
 * mais reste vrai de cette fonction PRISE SEULE, et reste la limite réelle
 * dès que la profondeur de recherche configurée (nodeBudget/maxDepth) est
 * épuisée avant la fin du combat.
 */
export function estimateWinProbability(battle: BattleState): number {
  const p1Summary = summarizeSide(battle, 'p1');
  const p2Summary = summarizeSide(battle, 'p2');

  if (p1Summary.aliveCount === 0 && p2Summary.aliveCount === 0) return 50;
  if (p1Summary.aliveCount === 0) return 0;
  if (p2Summary.aliveCount === 0) return 100;

  const p1Outnumbered = p1Summary.aliveCount === 1 && p2Summary.aliveCount > 1;
  const p2Outnumbered = p2Summary.aliveCount === 1 && p1Summary.aliveCount > 1;

  const p1 = sideScore(p1Summary, p1Outnumbered);
  const p2 = sideScore(p2Summary, p2Outnumbered);
  const total = p1 + p2;
  if (total === 0) return 50;

  const raw = (p1 / total) * 100;
  return Math.max(1, Math.min(99, Math.round(raw)));
}
