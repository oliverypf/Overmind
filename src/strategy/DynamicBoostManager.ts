import {log} from '../console/log';
import {CombatIntel} from '../intel/CombatIntel';
import {profile} from '../profiler/decorator';
import {boostResources} from '../resources/map_resources';

/**
 * Boost tier levels
 */
type BoostTier = 0 | 1 | 2 | 3;

/**
 * Boost recommendation for a creep role
 */
interface BoostRecommendation {
	role: string;
	boosts: MineralBoostConstant[];
	tier: BoostTier;
	reason: string;
}

/**
 * Colony boost status
 */
interface ColonyBoostStatus {
	available: {[boost: string]: number};
	canBoostTier: {[boostType: string]: BoostTier};
	underAttack: boolean;
	threatLevel: number;
}

/**
 * DynamicBoostManager: Intelligently decides when and what to boost based on:
 * - Available boost resources
 * - Threat level
 * - Economic situation
 * - Combat requirements
 */
@profile
export class DynamicBoostManager {

	static settings = {
		// Minimum boost amount to consider using that tier
		minBoostAmount: 1000,
		// Threat level thresholds
		lowThreat: 500,
		mediumThreat: 2000,
		highThreat: 5000,
		// Economic thresholds
		energySurplus: 500000,
		energyNormal: 100000,
	};

	/**
	 * Analyze colony's boost capabilities
	 */
	static analyzeColony(colony: any): ColonyBoostStatus {
		const available: {[boost: string]: number} = {};
		const canBoostTier: {[boostType: string]: BoostTier} = {};

		// Check terminal and storage for boost resources
		const terminal = colony.terminal;
		const storage = colony.storage;

		// Aggregate boost resources
		for (const boostType in boostResources) {
			const tiers = (boostResources as any)[boostType] as MineralBoostConstant[];
			canBoostTier[boostType] = 0;

			for (let tier = 3; tier >= 1; tier--) {
				const boost = tiers[tier - 1];
				let amount = 0;

				if (terminal) {
					amount += terminal.store[boost] || 0;
				}
				if (storage) {
					amount += storage.store[boost] || 0;
				}

				available[boost] = amount;

				if (amount >= this.settings.minBoostAmount && canBoostTier[boostType] === 0) {
					canBoostTier[boostType] = tier as BoostTier;
				}
			}
		}

		// Assess threat level
		const hostiles = colony.room.hostiles || [];
		const threatLevel = _.sum(hostiles, (h: Creep) =>
			CombatIntel.getAttackDamage(h) +
			CombatIntel.getRangedAttackDamage(h) +
			CombatIntel.getHealAmount(h)
		);

		return {
			available,
			canBoostTier,
			underAttack: hostiles.length > 0,
			threatLevel,
		};
	}

	/**
	 * Get recommended boost tier based on situation
	 */
	static getRecommendedTier(status: ColonyBoostStatus, role: string): BoostTier {
		// Combat roles always get highest available during attacks
		const combatRoles = ['ranged', 'melee', 'healer', 'dismantler'];

		if (combatRoles.includes(role)) {
			if (status.threatLevel >= this.settings.highThreat) {
				return 3; // Use T3 boosts for serious threats
			} else if (status.threatLevel >= this.settings.mediumThreat) {
				return 2; // Use T2 for moderate threats
			} else if (status.underAttack) {
				return 1; // At least T1 for any attack
			}
		}

		// Economic roles - boost based on resources available
		const economicRoles = ['worker', 'miner', 'hauler', 'upgrader'];

		if (economicRoles.includes(role)) {
			// Only boost if we have surplus
			const hasEnergySurplus = (status.available[RESOURCE_ENERGY] || 0) > this.settings.energySurplus;
			if (hasEnergySurplus) {
				return 2; // Use T2 for economy during surplus
			}
		}

		return 0; // No boost by default
	}

	/**
	 * Get boost wishlist for a combat role
	 */
	static getCombatBoostWishlist(role: string, status: ColonyBoostStatus): MineralBoostConstant[] {
		const tier = this.getRecommendedTier(status, role);
		if (tier === 0) return [];

		const wishlist: MineralBoostConstant[] = [];

		switch (role) {
			case 'ranged':
			case 'hydralisk':
				// Ranged attack, tough, heal, move
				if (status.canBoostTier['ranged_attack'] >= tier) {
					wishlist.push(boostResources.ranged_attack[Math.min(tier, status.canBoostTier['ranged_attack']) - 1]);
				}
				if (status.canBoostTier['tough'] >= tier) {
					wishlist.push(boostResources.tough[Math.min(tier, status.canBoostTier['tough']) - 1]);
				}
				if (status.canBoostTier['heal'] >= tier) {
					wishlist.push(boostResources.heal[Math.min(tier, status.canBoostTier['heal']) - 1]);
				}
				if (status.canBoostTier['move'] >= tier) {
					wishlist.push(boostResources.move[Math.min(tier, status.canBoostTier['move']) - 1]);
				}
				break;

			case 'melee':
			case 'zergling':
				// Attack, tough, move
				if (status.canBoostTier['attack'] >= tier) {
					wishlist.push(boostResources.attack[Math.min(tier, status.canBoostTier['attack']) - 1]);
				}
				if (status.canBoostTier['tough'] >= tier) {
					wishlist.push(boostResources.tough[Math.min(tier, status.canBoostTier['tough']) - 1]);
				}
				if (status.canBoostTier['move'] >= tier) {
					wishlist.push(boostResources.move[Math.min(tier, status.canBoostTier['move']) - 1]);
				}
				break;

			case 'healer':
			case 'transfuser':
				// Heal, tough, move
				if (status.canBoostTier['heal'] >= tier) {
					wishlist.push(boostResources.heal[Math.min(tier, status.canBoostTier['heal']) - 1]);
				}
				if (status.canBoostTier['tough'] >= tier) {
					wishlist.push(boostResources.tough[Math.min(tier, status.canBoostTier['tough']) - 1]);
				}
				if (status.canBoostTier['move'] >= tier) {
					wishlist.push(boostResources.move[Math.min(tier, status.canBoostTier['move']) - 1]);
				}
				break;

			case 'dismantler':
				// Dismantle, tough, move
				if (status.canBoostTier['dismantle'] >= tier) {
					wishlist.push(boostResources.dismantle[Math.min(tier, status.canBoostTier['dismantle']) - 1]);
				}
				if (status.canBoostTier['tough'] >= tier) {
					wishlist.push(boostResources.tough[Math.min(tier, status.canBoostTier['tough']) - 1]);
				}
				if (status.canBoostTier['move'] >= tier) {
					wishlist.push(boostResources.move[Math.min(tier, status.canBoostTier['move']) - 1]);
				}
				break;
		}

		return wishlist;
	}

	/**
	 * Get boost wishlist for an economic role
	 */
	static getEconomicBoostWishlist(role: string, status: ColonyBoostStatus): MineralBoostConstant[] {
		const tier = this.getRecommendedTier(status, role);
		if (tier === 0) return [];

		const wishlist: MineralBoostConstant[] = [];

		switch (role) {
			case 'upgrader':
				// Upgrade, carry, move
				if (status.canBoostTier['upgradeController'] >= tier) {
					wishlist.push(boostResources.upgradeController[Math.min(tier, status.canBoostTier['upgradeController']) - 1]);
				}
				if (status.canBoostTier['capacity'] >= tier) {
					wishlist.push(boostResources.capacity[Math.min(tier, status.canBoostTier['capacity']) - 1]);
				}
				break;

			case 'miner':
				// Harvest
				if (status.canBoostTier['harvest'] >= tier) {
					wishlist.push(boostResources.harvest[Math.min(tier, status.canBoostTier['harvest']) - 1]);
				}
				break;

			case 'hauler':
				// Capacity, move
				if (status.canBoostTier['capacity'] >= tier) {
					wishlist.push(boostResources.capacity[Math.min(tier, status.canBoostTier['capacity']) - 1]);
				}
				if (status.canBoostTier['move'] >= tier) {
					wishlist.push(boostResources.move[Math.min(tier, status.canBoostTier['move']) - 1]);
				}
				break;

			case 'worker':
				// Build/repair, harvest, capacity
				if (status.canBoostTier['build'] >= tier) {
					wishlist.push(boostResources.build[Math.min(tier, status.canBoostTier['build']) - 1]);
				}
				break;
		}

		return wishlist;
	}

	/**
	 * Get dynamic boost wishlist for any role
	 */
	static getBoostWishlist(colony: any, role: string): MineralBoostConstant[] {
		const status = this.analyzeColony(colony);

		const combatRoles = ['ranged', 'hydralisk', 'melee', 'zergling', 'healer', 'transfuser', 'dismantler'];
		const economicRoles = ['upgrader', 'miner', 'hauler', 'worker'];

		if (combatRoles.includes(role)) {
			return this.getCombatBoostWishlist(role, status);
		} else if (economicRoles.includes(role)) {
			return this.getEconomicBoostWishlist(role, status);
		}

		return [];
	}

	/**
	 * Check if a colony should boost a specific role
	 */
	static shouldBoost(colony: any, role: string): boolean {
		const status = this.analyzeColony(colony);

		// Combat roles - always boost during threats
		const combatRoles = ['ranged', 'hydralisk', 'melee', 'zergling', 'healer', 'transfuser', 'dismantler'];
		if (combatRoles.includes(role)) {
			return status.underAttack || status.threatLevel > this.settings.lowThreat;
		}

		// Economic roles - only boost during surplus
		const economicRoles = ['upgrader', 'miner', 'hauler', 'worker'];
		if (economicRoles.includes(role)) {
			// Check energy level
			const storageEnergy = colony.storage ? colony.storage.store[RESOURCE_ENERGY] : 0;
			const terminalEnergy = colony.terminal ? colony.terminal.store[RESOURCE_ENERGY] : 0;
			const energy = storageEnergy + terminalEnergy;
			return energy > this.settings.energySurplus;
		}

		return false;
	}

	/**
	 * Get a summary of boost recommendations for a colony
	 */
	static getBoostSummary(colony: any): BoostRecommendation[] {
		const status = this.analyzeColony(colony);
		const recommendations: BoostRecommendation[] = [];

		const roles = ['ranged', 'melee', 'healer', 'dismantler', 'upgrader', 'miner'];

		for (const role of roles) {
			const boosts = role.includes('ranged') || role.includes('melee') ||
						   role.includes('healer') || role.includes('dismantler')
				? this.getCombatBoostWishlist(role, status)
				: this.getEconomicBoostWishlist(role, status);

			if (boosts.length > 0) {
				const tier = this.getRecommendedTier(status, role);
				let reason = '';

				if (status.underAttack) {
					reason = `Under attack (threat: ${status.threatLevel})`;
				} else if (tier > 0) {
					reason = 'Surplus resources available';
				}

				recommendations.push({
					role,
					boosts,
					tier,
					reason,
				});
			}
		}

		return recommendations;
	}
}
