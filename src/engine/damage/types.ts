export interface DamageResult {
    minDamage: number;
    maxDamage: number;

    minPercent: number;
    maxPercent: number;

    koChance: number | null;

    rolls: number[];

    description: string;
}

export interface DamageRequest {
    attackerId: string;
    defenderId: string;

    move: string;
}
