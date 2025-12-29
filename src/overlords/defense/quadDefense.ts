import {$} from '../../caching/GlobalCache';
import {log} from '../../console/log';
import {CombatSetups, Roles} from '../../creepSetups/setups';
import {DirectiveInvasionDefense} from '../../directives/defense/invasionDefense';
import {CombatIntel} from '../../intel/CombatIntel';
import {Mem} from '../../memory/Memory';
import {OverlordPriority} from '../../priorities/priorities_overlords';
import {profile} from '../../profiler/decorator';
import {boostResources} from '../../resources/map_resources';
import {CombatZerg} from '../../zerg/CombatZerg';
import {Swarm} from '../../zerg/Swarm';
import {SwarmOverlord} from '../SwarmOverlord';

const DEBUG = false;

/**
 * QuadDefenseOverlord: uses 2x2 Swarm formations for powerful defense against invasions.
 * This is the most powerful defense option, using coordinated quad formations
 * with healers and ranged attackers working together.
 */
@profile
export class QuadDefenseOverlord extends SwarmOverlord {

	memory: any;
	directive: DirectiveInvasionDefense;
	fallback: RoomPosition;
	hydralisks: CombatZerg[];
	healers: CombatZerg[];
	swarms: { [ref: string]: Swarm };

	static settings = {
		retreatHitsPercent : 0.75,
		reengageHitsPercent: 0.95,
		minThreatLevel     : 2000, // Minimum enemy combat potential to spawn quad
	};

	constructor(directive: DirectiveInvasionDefense,
				boosted  = true,
				priority = OverlordPriority.defense.rangedDefense) {
		super(directive, 'quadDefense', priority, 1);
		this.directive = directive;
		this.memory = Mem.wrap(this.directive.memory, this.name);

		// Combat zerg with boost preferences
		this.hydralisks = this.combatZerg(Roles.ranged, {
			notifyWhenAttacked: false,
			boostWishlist: boosted ? [
				boostResources.ranged_attack[3],
				boostResources.tough[3],
				boostResources.heal[3],
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

		// Build swarms
		this.makeSwarms();

		// Compute fallback position
		this.fallback = $.pos(this, 'fallback', () =>
			this.findDefenseFallbackPosition(), 200)!;
	}

	refresh() {
		super.refresh();
		this.memory = Mem.wrap(this.directive.memory, this.name);
		this.makeSwarms();
	}

	/**
	 * Find a safe fallback position within the colony for regrouping
	 */
	private findDefenseFallbackPosition(): RoomPosition {
		// Try to find a position near spawn that's safe
		const spawn = this.colony.spawns[0];
		if (spawn) {
			// Find open position near spawn
			const positions = spawn.pos.getPositionsInRange(3, false, true);
			const safePos = _.find(positions, pos => {
				const structures = pos.lookFor(LOOK_STRUCTURES);
				return !structures.some(s => !s.isWalkable);
			});
			if (safePos) return safePos;
		}

		// Fallback to colony position
		return this.colony.pos;
	}

	makeSwarms(): void {
		this.swarms = {};

		// Combine hydralisks and healers into defensive quads
		const combatZerg: CombatZerg[] = [...this.hydralisks, ...this.healers];
		const maxPerSwarm = {[Roles.ranged]: 2, [Roles.healer]: 2};
		const zergBySwarm = _.groupBy(combatZerg, zerg => zerg.findSwarm(combatZerg, maxPerSwarm));

		for (const ref in zergBySwarm) {
			if (ref != undefined && ref !== 'undefined') {
				if (DEBUG) log.debug(`Making defense swarm for ${_.map(zergBySwarm[ref], z => z.name)}`);
				this.swarms[ref] = new Swarm(this, ref, zergBySwarm[ref]);
			}
		}
	}

	/**
	 * Handle individual swarm combat behavior for defense
	 */
	private handleDefenseSwarm(swarm: Swarm): void {
		const room = swarm.rooms[0] || this.room;
		if (!room) return;

		// Check if swarm needs to recover
		const healthPercent = _.sum(swarm.creeps, c => c.hits) /
							  _.sum(swarm.creeps, c => c.hitsMax);

		if (healthPercent < QuadDefenseOverlord.settings.retreatHitsPercent) {
			// Retreat to fallback position
			if (DEBUG) log.debug(`Swarm ${swarm.ref} retreating, health: ${(healthPercent * 100).toFixed(0)}%`);
			swarm.goTo(this.fallback);
			return;
		}

		// If hostiles present, engage
		if (room.hostiles.length > 0) {
			// Use tower-assisted combat if we have towers
			const towers = room.towers.filter(t => t.my && t.store[RESOURCE_ENERGY] >= TOWER_ENERGY_COST);

			if (towers.length > 0) {
				// Position swarm to maximize tower effectiveness
				this.engageWithTowerSupport(swarm, room.hostiles, towers);
			} else {
				// Standard combat
				swarm.autoCombat(room.name);
			}
		} else {
			// No hostiles - return to fallback position
			if (swarm.minRangeTo(this.fallback) > 3) {
				swarm.goTo(this.fallback);
			}
		}
	}

	/**
	 * Position swarm to maximize combined tower + swarm damage
	 */
	private engageWithTowerSupport(swarm: Swarm, hostiles: Creep[], towers: StructureTower[]): void {
		// Calculate tower center
		const avgTowerX = Math.round(_.sum(towers, t => t.pos.x) / towers.length);
		const avgTowerY = Math.round(_.sum(towers, t => t.pos.y) / towers.length);
		const towerCenter = new RoomPosition(avgTowerX, avgTowerY, swarm.rooms[0].name);

		// Find the best target considering both swarm range and tower damage
		let bestTarget: Creep | undefined;
		let bestScore = -Infinity;

		for (const hostile of hostiles) {
			if (hostile.pos.lookForStructure(STRUCTURE_RAMPART)) continue;

			let score = 0;

			// Tower damage at hostile's position
			const towerDamage = CombatIntel.towerDamageAtPos(hostile.pos) || 0;
			score += towerDamage * 2;

			// Healer priority
			if (hostile.getActiveBodyparts(HEAL) > 0) {
				score += 500;
			}

			// Low health priority
			const healthPercent = hostile.hits / hostile.hitsMax;
			if (healthPercent < 0.3) {
				score += 300;
			}

			// Distance from swarm
			const distanceToSwarm = swarm.minRangeTo(hostile);
			score -= distanceToSwarm * 20;

			// Prefer hostiles closer to tower optimal range (5)
			const distanceToTowers = hostile.pos.getRangeTo(towerCenter);
			if (distanceToTowers <= 5) {
				score += 200;
			}

			if (score > bestScore) {
				bestScore = score;
				bestTarget = hostile;
			}
		}

		if (bestTarget) {
			swarm.target = bestTarget;
			// Move swarm to engage, preferring positions where towers deal max damage
			swarm.autoCombat(swarm.rooms[0].name);
		}
	}

	/**
	 * Calculate threat level of current hostiles
	 */
	private getThreatLevel(): number {
		if (!this.room || this.room.hostiles.length === 0) return 0;

		return _.sum(this.room.hostiles, hostile => {
			const attack = CombatIntel.getAttackDamage(hostile);
			const ranged = CombatIntel.getRangedAttackDamage(hostile);
			const heal = CombatIntel.getHealAmount(hostile);
			return attack + ranged + heal * 2;
		});
	}

	/**
	 * Calculate how many quads we need
	 */
	private computeNeededQuads(): number {
		const threatLevel = this.getThreatLevel();

		if (threatLevel < QuadDefenseOverlord.settings.minThreatLevel) {
			return 0; // Not enough threat to warrant quad
		}

		// Estimate our DPS per quad
		const firstHydralisk = this.hydralisks[0];
		const rangedDamage = CombatIntel.getRangedAttackDamage(firstHydralisk ? firstHydralisk.creep : undefined) || 30;
		const quadDPS = rangedDamage * 2; // 2 hydralisks per quad

		// Estimate enemy healing
		const enemyHealing = CombatIntel.maxHealingByCreeps(this.room ? this.room.hostiles : []);

		// We need enough DPS to overcome enemy healing
		const neededDPS = enemyHealing * 1.5 + 200; // Extra buffer for tower damage

		// Calculate needed quads (minimum 1 if threat exists)
		const neededQuads = Math.max(1, Math.ceil(neededDPS / quadDPS));

		// Cap at reasonable amount
		return Math.min(neededQuads, 3);
	}

	init() {
		this.reassignIdleCreeps(Roles.ranged);
		this.reassignIdleCreeps(Roles.healer);

		const neededQuads = this.computeNeededQuads();

		if (neededQuads === 0) {
			// No threat - don't spawn
			return;
		}

		// Determine setups based on boost availability
		const hydraliskSetup = this.canBoostSetup(CombatSetups.hydralisks.boosted_T3)
			? CombatSetups.hydralisks.boosted_T3
			: CombatSetups.hydralisks.default;

		const healerSetup = this.canBoostSetup(CombatSetups.healers.boosted_T3)
			? CombatSetups.healers.boosted_T3
			: CombatSetups.healers.default;

		// Request swarm composition: 2 hydralisks + 2 healers per quad
		const swarmConfig = [
			{setup: hydraliskSetup, amount: 2, priority: this.priority},
			{setup: healerSetup, amount: 2, priority: this.priority}
		];

		this.swarmWishlist(neededQuads, swarmConfig);
	}

	run() {
		// Handle individual creeps that aren't in swarms yet
		this.autoRun(this.hydralisks, hydralisk => {
			if (!hydralisk.memory.swarm) {
				// Solo hydralisk - do basic combat
				if (this.room.hostiles.length > 0) {
					hydralisk.autoCombat(this.room.name);
				}
			}
		});

		this.autoRun(this.healers, healer => {
			if (!healer.memory.swarm) {
				// Solo healer - heal nearby friendlies
				healer.doMedicActions(this.room.name);
			}
		});

		// Run swarms
		for (const ref in this.swarms) {
			const swarm = this.swarms[ref];

			// Wait for swarm to form up first
			if (!swarm.memory.initialAssembly) {
				swarm.memory.initialAssembly = swarm.assemble(this.fallback);
				continue;
			}

			this.handleDefenseSwarm(swarm);
		}
	}

	visuals() {
		if (this.fallback) {
			this.room.visual.circle(this.fallback, {fill: 'green', radius: 0.5, opacity: 0.3});
		}

		for (const ref in this.swarms) {
			const swarm = this.swarms[ref];
			this.room.visual.rect(
				swarm.anchor.x - 0.5,
				swarm.anchor.y - 0.5,
				2, 2,
				{fill: 'blue', opacity: 0.2}
			);

			if (swarm.target) {
				this.room.visual.line(swarm.anchor, swarm.target.pos, {color: 'red', lineStyle: 'dashed'});
			}
		}
	}
}
