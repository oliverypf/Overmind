import {$} from '../../caching/GlobalCache';
import {log} from '../../console/log';
import {CreepSetup} from '../../creepSetups/CreepSetup';
import {CombatSetups, Roles} from '../../creepSetups/setups';
import {DirectiveTargetSiege} from '../../directives/targeting/siegeTarget';
import {CombatIntel} from '../../intel/CombatIntel';
import {OverlordPriority} from '../../priorities/priorities_overlords';
import {profile} from '../../profiler/decorator';
import {boostResources} from '../../resources/map_resources';
import {CombatTargeting} from '../../targeting/CombatTargeting';
import {CombatZerg} from '../../zerg/CombatZerg';
import {CombatOverlord} from '../CombatOverlord';

const DEBUG = false;

/**
 * WallBreaker Overlord: Specialized for breaking through enemy walls and ramparts.
 * Uses dismantler creeps with healer support to breach enemy defenses.
 */
@profile
export class WallBreakerOverlord extends CombatOverlord {

	dismantlers: CombatZerg[];
	healers: CombatZerg[];
	targetWall: Structure | undefined;

	static settings = {
		retreatHitsPercent : 0.5,
		reengageHitsPercent: 0.8,
		maxWallHits        : 10000000, // Don't attempt walls over 10M hits
	};

	constructor(directive: DirectiveTargetSiege,
				boosted  = true,
				priority = OverlordPriority.offense.destroy) {
		super(directive, 'wallBreaker', priority, 1);

		this.dismantlers = this.combatZerg(Roles.dismantler, {
			notifyWhenAttacked: false,
			boostWishlist: boosted ? [
				boostResources.dismantle[3],
				boostResources.tough[3],
				boostResources.move[3]
			] : undefined
		});

		this.healers = this.combatZerg(Roles.healer, {
			notifyWhenAttacked: false,
			boostWishlist: boosted ? [
				boostResources.heal[3],
				boostResources.tough[3],
				boostResources.move[3]
			] : undefined
		});

		// Find target wall
		this.targetWall = this.findTargetWall();
	}

	/**
	 * Find the best wall/rampart to target for breaching
	 */
	private findTargetWall(): Structure | undefined {
		if (!this.room) return undefined;

		// Get all barriers (walls + ramparts)
		const barriers = this.room.barriers;
		if (barriers.length === 0) return undefined;

		// Filter out walls that are too strong
		const breakableBarriers = _.filter(barriers,
			b => b.hits <= WallBreakerOverlord.settings.maxWallHits);

		if (breakableBarriers.length === 0) {
			log.warning(`${this.print}: No breakable barriers found (all > ${WallBreakerOverlord.settings.maxWallHits} hits)`);
			return undefined;
		}

		// Find the barrier that gives best access to important structures
		return this.findStrategicBreachPoint(breakableBarriers);
	}

	/**
	 * Find the most strategic point to breach - one that leads to important structures
	 */
	private findStrategicBreachPoint(barriers: Structure[]): Structure | undefined {
		if (!this.room) return undefined;

		// Priority targets behind walls
		const priorityTargets = [
			...this.room.spawns,
			...this.room.towers,
			this.room.storage,
			this.room.terminal,
		].filter(s => s != undefined) as Structure[];

		if (priorityTargets.length === 0) {
			// No priority targets - just find weakest barrier
			return _.min(barriers, b => b.hits);
		}

		// Score each barrier based on:
		// 1. How weak it is (lower hits = better)
		// 2. How close it is to priority targets
		// 3. How many priority targets are accessible through it
		let bestBarrier: Structure | undefined;
		let bestScore = -Infinity;

		for (const barrier of barriers) {
			let score = 0;

			// Lower hits = higher score
			const hitsScore = (WallBreakerOverlord.settings.maxWallHits - barrier.hits) /
							  WallBreakerOverlord.settings.maxWallHits * 100;
			score += hitsScore;

			// Distance to priority targets
			const avgDistance = _.sum(priorityTargets, t => barrier.pos.getRangeTo(t)) / priorityTargets.length;
			score -= avgDistance * 5;

			// Count priority targets within range 10 of this breach point
			const nearbyTargets = _.filter(priorityTargets, t => barrier.pos.getRangeTo(t) <= 10);
			score += nearbyTargets.length * 20;

			// Prefer ramparts over walls (can walk on them after breaking)
			if (barrier.structureType === STRUCTURE_RAMPART) {
				score += 10;
			}

			if (score > bestScore) {
				bestScore = score;
				bestBarrier = barrier;
			}
		}

		return bestBarrier;
	}

	/**
	 * Handle dismantler behavior
	 */
	private handleDismantler(dismantler: CombatZerg): void {
		const healer = dismantler.findPartner(this.healers);

		// Wait for healer partner if not present
		if (!healer || healer.spawning) {
			if (DEBUG) log.debug(`${dismantler.print}: Waiting for healer partner`);
			dismantler.park();
			return;
		}

		// Check if we need to retreat
		if (dismantler.needsToRecover(WallBreakerOverlord.settings.retreatHitsPercent,
									   WallBreakerOverlord.settings.reengageHitsPercent) ||
			healer.needsToRecover(WallBreakerOverlord.settings.retreatHitsPercent,
								  WallBreakerOverlord.settings.reengageHitsPercent)) {
			if (DEBUG) log.debug(`${dismantler.print}: Retreating!`);
			dismantler.recover();
			return;
		}

		// Travel to target room
		if (!dismantler.safelyInRoom(this.pos.roomName)) {
			dismantler.goToRoom(this.pos.roomName, {ensurePath: true});
			return;
		}

		// If hostiles nearby, engage them first
		const nearbyHostiles = dismantler.pos.findInRange(this.room!.hostiles, 3);
		if (nearbyHostiles.length > 0) {
			// Attack if we have attack parts
			if (dismantler.getActiveBodyparts(ATTACK) > 0) {
				const target = CombatTargeting.findBestCreepTargetInRange(dismantler, 1, nearbyHostiles);
				if (target) {
					dismantler.attack(target);
				}
			}
			// Kite away from melee attackers
			const meleeHostiles = _.filter(nearbyHostiles, h => CombatIntel.getAttackDamage(h) > 0);
			if (meleeHostiles.length > 0) {
				dismantler.kite(meleeHostiles, {range: 2});
				return;
			}
		}

		// Find or update target wall
		if (!this.targetWall || this.targetWall.hits === 0) {
			this.targetWall = this.findTargetWall();
		}

		if (!this.targetWall) {
			if (DEBUG) log.debug(`${dismantler.print}: No target wall found`);
			// No walls left - look for other structures to dismantle
			const hostileStructure = CombatTargeting.findClosestPrioritizedStructure(dismantler);
			if (hostileStructure) {
				this.dismantleTarget(dismantler, hostileStructure);
			} else {
				dismantler.park();
			}
			return;
		}

		// Dismantle the target wall
		this.dismantleTarget(dismantler, this.targetWall);
	}

	/**
	 * Move to and dismantle a target structure
	 */
	private dismantleTarget(dismantler: CombatZerg, target: Structure): void {
		if (dismantler.pos.isNearTo(target)) {
			dismantler.dismantle(target);
		} else {
			dismantler.goTo(target, {range: 1});
		}
	}

	/**
	 * Handle healer behavior - follow and heal partner
	 */
	private handleHealer(healer: CombatZerg): void {
		const partner = healer.findPartner(this.dismantlers);

		if (!partner || partner.spawning) {
			// No partner - heal self and wait
			if (healer.hits < healer.hitsMax) {
				healer.heal(healer);
			}
			healer.park();
			return;
		}

		// Heal logic - prioritize partner if they need it more
		const partnerDamage = partner.hitsMax - partner.hits;
		const selfDamage = healer.hitsMax - healer.hits;

		if (partnerDamage > selfDamage) {
			if (healer.pos.isNearTo(partner)) {
				healer.heal(partner);
			} else if (healer.pos.getRangeTo(partner) <= 3) {
				healer.rangedHeal(partner);
			}
		} else if (selfDamage > 0) {
			healer.heal(healer);
		}

		// Follow partner
		if (!healer.pos.isNearTo(partner)) {
			healer.goTo(partner, {range: 1, movingTarget: true});
		}
	}

	/**
	 * Calculate how many dismantler pairs we need
	 */
	private computeNeededPairs(): number {
		if (!this.room) return 1;

		// Check if there are walls to break
		const barriers = this.room.barriers;
		if (barriers.length === 0) return 0;

		// Find the minimum barrier hits we need to break through
		const minBarrierHits = _.min(_.map(barriers, b => b.hits));

		// Check tower damage
		const towerDamage = this.room.towers.length > 0
			? CombatIntel.towerDamageAtPos(barriers[0].pos) || 0
			: 0;

		// Need more pairs if tower damage is high
		if (towerDamage > 1000) {
			return 2;
		}

		// Need more pairs for stronger walls
		if (minBarrierHits > 5000000) {
			return 2;
		}

		return 1;
	}

	init() {
		this.reassignIdleCreeps(Roles.dismantler);
		this.reassignIdleCreeps(Roles.healer);

		const neededPairs = this.computeNeededPairs();

		// Determine setups based on boost availability
		let dismantlerSetup: CreepSetup;
		let healerSetup: CreepSetup;

		if (this.canBoostSetup(CombatSetups.dismantlers.boosted_T3)) {
			dismantlerSetup = CombatSetups.dismantlers.boosted_T3;
		} else {
			dismantlerSetup = CombatSetups.dismantlers.default;
		}

		if (this.canBoostSetup(CombatSetups.healers.boosted_T3)) {
			healerSetup = CombatSetups.healers.boosted_T3;
		} else {
			healerSetup = CombatSetups.healers.default;
		}

		// Spawn dismantlers and healers in pairs
		const dismantlerPriority = this.dismantlers.length <= this.healers.length
			? this.priority - 0.1
			: this.priority + 0.1;
		const healerPriority = this.healers.length < this.dismantlers.length
			? this.priority - 0.1
			: this.priority + 0.1;

		this.wishlist(neededPairs, dismantlerSetup, {priority: dismantlerPriority});
		this.wishlist(neededPairs, healerSetup, {priority: healerPriority});
	}

	run() {
		this.autoRun(this.dismantlers, dismantler => this.handleDismantler(dismantler));
		this.autoRun(this.healers, healer => this.handleHealer(healer));
	}

	visuals() {
		if (this.targetWall && this.room) {
			this.room.visual.circle(this.targetWall.pos, {
				fill: 'red',
				radius: 0.5,
				opacity: 0.5
			});
			this.room.visual.text('TARGET', this.targetWall.pos.x, this.targetWall.pos.y - 1, {
				color: 'red',
				font: 0.5
			});
		}
	}
}
