import {CombatIntel} from '../intel/CombatIntel';
import {Movement, NO_ACTION} from '../movement/Movement';
import {profile} from '../profiler/decorator';
import {insideBunkerBounds} from '../roomPlanner/layouts/bunker';
import {CombatTargeting} from '../targeting/CombatTargeting';
import {GoalFinder} from '../targeting/GoalFinder';
import {randomHex} from '../utilities/utils';
import {Zerg} from './Zerg';

interface CombatZergMemory extends CreepMemory {
	recovering: boolean;
	lastInDanger: number;
	partner?: string;
	swarm?: string;
}

export const DEFAULT_PARTNER_TICK_DIFFERENCE = 650;
export const DEFAULT_SWARM_TICK_DIFFERENCE = 500;

/**
 * CombatZerg is an extension of the Zerg class which contains additional combat-related methods
 */
@profile
export class CombatZerg extends Zerg {

	memory: CombatZergMemory;
	isCombatZerg: boolean;

	constructor(creep: Creep, notifyWhenAttacked = true) {
		super(creep, notifyWhenAttacked);
		this.isCombatZerg = true;
		_.defaults(this.memory, {
			recovering  : false,
			lastInDanger: 0,
			targets     : {}
		});
	}

	findPartner(partners: CombatZerg[], tickDifference = DEFAULT_PARTNER_TICK_DIFFERENCE): CombatZerg | undefined {
		if (this.memory.partner) {
			const partner = _.find(partners, partner => partner.name == this.memory.partner);
			if (partner) {
				return partner;
			} else {
				delete this.memory.partner;
				this.findPartner(partners, tickDifference);
			}
		} else {
			let partner = _.find(partners, partner => partner.memory.partner == this.name);
			if (!partner) {
				partner = _(partners)
					.filter(partner => !partner.memory.partner &&
									   Math.abs((this.ticksToLive || CREEP_LIFE_TIME)
												- (partner.ticksToLive || CREEP_LIFE_TIME)) <= tickDifference)
					.min(partner => Math.abs((this.ticksToLive || CREEP_LIFE_TIME)
											 - (partner.ticksToLive || CREEP_LIFE_TIME)));
			}
			if (_.isObject(partner)) {
				this.memory.partner = partner.name;
				partner.memory.partner = this.name;
				return partner;
			}
		}
	}

	findSwarm(partners: CombatZerg[], maxByRole: { [role: string]: number },
			  tickDifference = DEFAULT_SWARM_TICK_DIFFERENCE): string | undefined {
		if (this.memory.swarm) {
			return this.memory.swarm;
		} else {
			// Find a swarm that isn't too old and that has space for the creep's role
			const partnersBySwarm = _.groupBy(partners, partner => partner.memory.swarm);
			for (const swarmRef in partnersBySwarm) {
				if (swarmRef == undefined || swarmRef == 'undefined') continue;
				if (_.all(partnersBySwarm[swarmRef],
						  c => Math.abs((this.ticksToLive || CREEP_LIFE_TIME)
										- (c.ticksToLive || CREEP_LIFE_TIME)) <= tickDifference)) {
					const swarmCreepsByRole = _.groupBy(partnersBySwarm[swarmRef], c => c.memory.role);
					if ((swarmCreepsByRole[this.memory.role] || []).length + 1 <= maxByRole[this.memory.role]) {
						this.memory.swarm = swarmRef;
						return swarmRef;
					}
				}
			}
			// Otherwise just make a new swarm ref
			const newSwarmRef = randomHex(6);
			this.memory.swarm = newSwarmRef;
			return newSwarmRef;
		}
	}

	doMedicActions(roomName: string): void {
		// Travel to the target room
		if (!this.safelyInRoom(roomName)) {
			this.goToRoom(roomName, {ensurePath: true});
			return;
		}
		// Heal friendlies
		const target = CombatTargeting.findClosestHurtFriendly(this);
		if (target) {
			// Approach the target
			const range = this.pos.getRangeTo(target);
			if (range > 1) {
				this.goTo(target, {movingTarget: true});
			}

			// Heal or ranged-heal the target
			if (range <= 1) {
				this.heal(target);
			} else if (range <= 3) {
				this.rangedHeal(target);
			}
		} else {
			this.park();
		}
	}

	healSelfIfPossible(): CreepActionReturnCode | undefined {
		// Heal yourself if it won't interfere with attacking
		if (this.canExecute('heal')
			&& (this.hits < this.hitsMax || this.pos.findInRange(this.room.hostiles, 3).length > 0)) {
			return this.heal(this);
		}
	}

	/**
	 * Attack and chase the specified target
	 */
	attackAndChase(target: Creep | Structure): CreepActionReturnCode {
		let ret: CreepActionReturnCode;
		// Attack the target if you can, else move to get in range
		if (this.pos.isNearTo(target)) {
			ret = this.attack(target);
			// Move in the direction of the creep to prevent it from running away
			this.move(this.pos.getDirectionTo(target));
			return ret;
		} else {
			if (this.pos.getRangeTo(target.pos) > 10 && target instanceof Creep) {
				this.goTo(target, {movingTarget: true});
			} else {
				this.goTo(target);
			}
			return ERR_NOT_IN_RANGE;
		}
	}

	// Standard action sequences for engaging small numbers of enemies in a neutral room ===============================

	/**
	 * Automatically melee-attack the best creep in range
	 */
	autoMelee(possibleTargets = this.room.hostiles) {
		const target = CombatTargeting.findBestCreepTargetInRange(this, 1, possibleTargets)
					   || CombatTargeting.findBestStructureTargetInRange(this, 1);
		this.debug(`Melee target: ${target}`);
		if (target) {
			return this.attack(target);
		}
	}

	/**
	 * Automatically ranged-attack the best creep in range
	 */
	autoRanged(possibleTargets = this.room.hostiles, allowMassAttack = true) {
		const target = CombatTargeting.findBestCreepTargetInRange(this, 3, possibleTargets)
					   || CombatTargeting.findBestStructureTargetInRange(this, 3);
		this.debug(`Ranged target: ${target}`);
		if (target) {
			if (allowMassAttack
				&& CombatIntel.getMassAttackDamage(this, possibleTargets) > CombatIntel.getRangedAttackDamage(this)) {
				return this.rangedMassAttack();
			} else {
				return this.rangedAttack(target);
			}
		}
	}

	/**
	 * Automatically heal the best creep in range
	 */
	autoHeal(allowRangedHeal = true, friendlies = this.room.creeps) {
		const target = CombatTargeting.findBestHealingTargetInRange(this, allowRangedHeal ? 3 : 1, friendlies);
		this.debug(`Heal taget: ${target}`);
		if (target) {
			if (this.pos.getRangeTo(target) <= 1) {
				return this.heal(target);
			} else if (allowRangedHeal && this.pos.getRangeTo(target) <= 3) {
				return this.rangedHeal(target);
			}
		}
	}

	/**
	 * Navigate to a room, then engage hostile creeps there, perform medic actions, etc.
	 */
	autoSkirmish(roomName: string, verbose = false) {

		// Do standard melee, ranged, and heal actions
		if (this.getActiveBodyparts(ATTACK) > 0) {
			this.autoMelee(); // Melee should be performed first
		}
		if (this.getActiveBodyparts(RANGED_ATTACK) > 0) {
			this.autoRanged();
		}
		if (this.canExecute('heal')) {
			this.autoHeal(this.canExecute('rangedHeal'));
		}

		// Handle recovery if low on HP
		if (this.needsToRecover()) {
			this.debug(`Recovering!`);
			return this.recover();
		}

		// Travel to the target room
		if (!this.safelyInRoom(roomName)) {
			this.debug(`Going to room!`);
			return this.goToRoom(roomName, {ensurePath: true});
		}

		// Skirmish within the room
		const goals = GoalFinder.skirmishGoals(this);
		this.debug(JSON.stringify(goals));
		return Movement.combatMove(this, goals.approach, goals.avoid);

	}

	/**
	 * Navigate to a room, then engage hostile creeps there, perform medic actions, etc.
	 */
	autoCombat(roomName: string, verbose = false) {

		// Do standard melee, ranged, and heal actions
		if (this.getActiveBodyparts(ATTACK) > 0) {
			this.autoMelee(); // Melee should be performed first
		}
		if (this.getActiveBodyparts(RANGED_ATTACK) > 0) {
			this.autoRanged();
		}
		if (this.canExecute('heal')) {
			this.autoHeal(this.canExecute('rangedHeal'));
		}

		// Handle recovery if low on HP
		if (this.needsToRecover()) {
			this.debug(`Recovering!`);
			return this.recover();
		}

		// Travel to the target room
		if (!this.safelyInRoom(roomName)) {
			this.debug(`Going to room!`);
			return this.goToRoom(roomName, {ensurePath: true});
		}

		// Fight within the room
		const target = CombatTargeting.findTarget(this);
		const preferRanged = this.getActiveBodyparts(RANGED_ATTACK) > this.getActiveBodyparts(ATTACK);
		const targetRange = preferRanged ? 3 : 1;
		this.debug(`${target}, ${targetRange}`);
		if (target) {
			const avoid = [];
			// Avoid melee hostiles if you are a ranged creep
			if (preferRanged) {
				const meleeHostiles = _.filter(this.room.hostiles, h => CombatIntel.getAttackDamage(h) > 0);
				for (const hostile of meleeHostiles) {
					avoid.push({pos: hostile.pos, range: 2});
				}
			}
			return Movement.combatMove(this, [{pos: target.pos, range: targetRange}], avoid);
		}

	}

	autoBunkerCombat(roomName: string, verbose = false) {
		if (this.getActiveBodyparts(ATTACK) > 0) {
			this.autoMelee(); // Melee should be performed first
		}
		if (this.getActiveBodyparts(RANGED_ATTACK) > 0) {
			this.autoRanged();
		}

		// Travel to the target room
		if (!this.safelyInRoom(roomName)) {
			this.debug(`Going to room!`);
			return this.goToRoom(roomName, {ensurePath: true});
		}

		// TODO check if right colony, also yes colony check is in there to stop red squigglies
		const siegingCreeps = this.room.hostiles.filter(creep =>
			_.any(creep.pos.neighbors, pos => this.colony && insideBunkerBounds(pos, this.colony)));

		const target = CombatTargeting.findTarget(this, siegingCreeps);

		if (target) {
			return Movement.combatMove(this, [{pos: target.pos, range: 1}], [], {preferRamparts: true, requireRamparts: true});
		}
	}

	needsToRecover(recoverThreshold  = CombatIntel.minimumDamageTakenMultiplier(this.creep) < 1 ? 0.85 : 0.75,
				   reengageThreshold = 1.0): boolean {
		let recovering: boolean;
		if (this.memory.recovering) {
			recovering = this.hits < this.hitsMax * reengageThreshold;
		} else {
			recovering = this.hits < this.hitsMax * recoverThreshold;
		}
		this.memory.recovering = recovering;
		return recovering;
	}

	/**
	 * Retreat and get healed
	 */
	recover() {
		if (this.pos.findInRange(this.room.hostiles, 5).length > 0 || this.room.towers.length > 0) {
			this.memory.lastInDanger = Game.time;
		}
		const goals = GoalFinder.retreatGoals(this);
		const result = Movement.combatMove(this, goals.approach, goals.avoid, {allowExit: true});

		if (result == NO_ACTION && this.pos.isEdge) {
			if (Game.time < this.memory.lastInDanger + 3) {
				return this.moveOffExit();
			}
		}
		return result;
	}

	/**
	 * Calculate dynamic retreat threshold based on incoming damage vs healing capacity
	 */
	getDynamicRetreatThreshold(): number {
		const incomingDamage = this.getIncomingDamage();
		const healingCapacity = CombatIntel.maxFriendlyHealingTo(this.creep);
		const damageMultiplier = CombatIntel.minimumDamageTakenMultiplier(this.creep);
		const effectiveDamage = incomingDamage * damageMultiplier;

		// If damage significantly exceeds healing, retreat earlier
		if (effectiveDamage > healingCapacity * 1.5) {
			return 0.9; // 90% HP threshold - retreat early
		} else if (effectiveDamage > healingCapacity) {
			return 0.85; // 85% HP threshold - normal caution
		} else if (effectiveDamage > healingCapacity * 0.5) {
			return 0.75; // 75% HP threshold - some risk tolerance
		} else {
			return 0.6; // 60% HP threshold - can be aggressive
		}
	}

	/**
	 * Calculate incoming damage from nearby hostiles and towers
	 */
	getIncomingDamage(): number {
		let damage = 0;

		// Damage from nearby hostile creeps
		const nearbyHostiles = this.pos.findInRange(this.room.hostiles, 3);
		for (const hostile of nearbyHostiles) {
			const range = this.pos.getRangeTo(hostile);
			if (range <= 1) {
				damage += CombatIntel.getAttackDamage(hostile);
			}
			if (range <= 3) {
				damage += CombatIntel.getRangedAttackDamage(hostile);
			}
		}

		// Damage from enemy towers
		if (this.room.owner && !this.room.my) {
			damage += CombatIntel.towerDamageAtPos(this.pos) || 0;
		}

		return damage;
	}

	/**
	 * Check if recovery is needed using dynamic thresholds
	 */
	needsToRecoverDynamic(): boolean {
		const recoverThreshold = this.getDynamicRetreatThreshold();
		const reengageThreshold = Math.min(recoverThreshold + 0.1, 1.0);

		let recovering: boolean;
		if (this.memory.recovering) {
			recovering = this.hits < this.hitsMax * reengageThreshold;
		} else {
			recovering = this.hits < this.hitsMax * recoverThreshold;
		}
		this.memory.recovering = recovering;
		return recovering;
	}

	/**
	 * Lure enemies into optimal tower damage range (within 5 tiles of towers)
	 * This positions the creep to kite enemies while maximizing tower effectiveness
	 */
	lureToTowerRange(hostiles?: Creep[]): number | undefined {
		const towers = this.room.towers.filter(t => t.my && t.energy >= TOWER_ENERGY_COST);
		if (towers.length === 0) return;

		hostiles = hostiles || this.room.hostiles;
		if (hostiles.length === 0) return;

		// Find position that maximizes tower damage while staying safe
		const optimalPos = this.findOptimalTowerLurePosition(towers, hostiles);
		if (!optimalPos) return;

		// If we're at optimal position, kite to keep enemies chasing
		if (this.pos.isEqualTo(optimalPos)) {
			return this.kiteFromHostiles(hostiles, 3);
		}

		// Move toward optimal position
		return this.goTo(optimalPos, {range: 0});
	}

	/**
	 * Find the best position to lure enemies into tower fire
	 */
	private findOptimalTowerLurePosition(towers: StructureTower[], hostiles: Creep[]): RoomPosition | undefined {
		const room = this.room;

		// Calculate average tower position for optimal damage zone
		const avgTowerX = Math.round(_.sum(towers, t => t.pos.x) / towers.length);
		const avgTowerY = Math.round(_.sum(towers, t => t.pos.y) / towers.length);

		// Search for positions within range 5-7 of tower center (optimal damage zone)
		// that are also within range 4-6 of nearest hostile (keeps them chasing)
		let bestPos: RoomPosition | undefined;
		let bestScore = -Infinity;

		const searchRange = 8;
		for (let dx = -searchRange; dx <= searchRange; dx++) {
			for (let dy = -searchRange; dy <= searchRange; dy++) {
				const x = avgTowerX + dx;
				const y = avgTowerY + dy;

				if (x < 1 || x > 48 || y < 1 || y > 48) continue;

				const pos = new RoomPosition(x, y, room.name);

				// Skip blocked positions
				if (pos.lookFor(LOOK_TERRAIN)[0] === 'wall') continue;
				const structures = pos.lookFor(LOOK_STRUCTURES);
				if (structures.some(s => !s.isWalkable)) continue;

				// Calculate tower damage at this position
				let towerDamage = 0;
				for (const tower of towers) {
					const range = pos.getRangeTo(tower);
					if (range <= TOWER_OPTIMAL_RANGE) {
						towerDamage += TOWER_POWER_ATTACK;
					} else if (range <= TOWER_FALLOFF_RANGE) {
						const falloff = (range - TOWER_OPTIMAL_RANGE) / (TOWER_FALLOFF_RANGE - TOWER_OPTIMAL_RANGE);
						towerDamage += TOWER_POWER_ATTACK * (1 - TOWER_FALLOFF * falloff);
					}
				}

				// Calculate distance to nearest hostile
				const nearestHostile = pos.findClosestByRange(hostiles);
				if (!nearestHostile) continue;
				const hostileRange = pos.getRangeTo(nearestHostile);

				// Score: maximize tower damage, prefer positions that keep hostiles at range 3-4
				// (close enough to chase, far enough to avoid melee damage)
				let score = towerDamage;

				// Prefer positions at range 3-4 from hostiles
				if (hostileRange >= 3 && hostileRange <= 4) {
					score += 100;
				} else if (hostileRange < 3) {
					score -= (3 - hostileRange) * 50; // Penalty for being too close
				} else if (hostileRange > 6) {
					score -= (hostileRange - 6) * 20; // Penalty for being too far
				}

				// Prefer positions away from room edges
				const edgeDistance = Math.min(x, y, 49 - x, 49 - y);
				score += edgeDistance * 2;

				// Slight preference for closer to current position (less travel time)
				score -= this.pos.getRangeTo(pos) * 0.5;

				if (score > bestScore) {
					bestScore = score;
					bestPos = pos;
				}
			}
		}

		return bestPos;
	}

	/**
	 * Kite away from hostiles while staying in range
	 */
	kiteFromHostiles(hostiles: Creep[], desiredRange: number = 3): number {
		const avoid: PathFinderGoal[] = [];
		for (const hostile of hostiles) {
			const attackDamage = CombatIntel.getAttackDamage(hostile);
			const range = attackDamage > 0 ? desiredRange : desiredRange - 1;
			avoid.push({pos: hostile.pos, range: range});
		}

		// Stay in room, avoid edges
		const approach: PathFinderGoal[] = [];
		if (this.pos.rangeToEdge <= 2) {
			approach.push({pos: new RoomPosition(25, 25, this.room.name), range: 20});
		}

		return Movement.combatMove(this, approach, avoid);
	}

	/**
	 * Combined tower-assisted combat: lure, attack, and heal
	 */
	autoTowerAssistedCombat(roomName: string): void {
		// Do standard combat actions
		if (this.getActiveBodyparts(ATTACK) > 0) {
			this.autoMelee();
		}
		if (this.getActiveBodyparts(RANGED_ATTACK) > 0) {
			this.autoRanged();
		}
		if (this.canExecute('heal')) {
			this.autoHeal(this.canExecute('rangedHeal'));
		}

		// Check recovery with dynamic threshold
		if (this.needsToRecoverDynamic()) {
			this.debug(`Recovering with dynamic threshold!`);
			this.recover();
			return;
		}

		// Travel to target room
		if (!this.safelyInRoom(roomName)) {
			this.goToRoom(roomName, {ensurePath: true});
			return;
		}

		// If we have towers and hostiles, use tower luring strategy
		const myTowers = this.room.towers.filter(t => t.my && t.energy >= TOWER_ENERGY_COST);
		if (myTowers.length > 0 && this.room.hostiles.length > 0) {
			this.lureToTowerRange();
		} else {
			// Fall back to regular combat
			const target = CombatTargeting.findTarget(this);
			if (target) {
				const preferRanged = this.getActiveBodyparts(RANGED_ATTACK) > this.getActiveBodyparts(ATTACK);
				const targetRange = preferRanged ? 3 : 1;
				Movement.combatMove(this, [{pos: target.pos, range: targetRange}], []);
			}
		}
	}

}
