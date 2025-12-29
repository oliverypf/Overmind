import {$} from '../../caching/GlobalCache';
import {log} from '../../console/log';
import {CombatSetups, Roles} from '../../creepSetups/setups';
import {DirectiveSwarmDestroy} from '../../directives/offense/swarmDestroy';
import {CombatIntel} from '../../intel/CombatIntel';
import {RoomIntel} from '../../intel/RoomIntel';
import {Mem} from '../../memory/Memory';
import {OverlordPriority} from '../../priorities/priorities_overlords';
import {profile} from '../../profiler/decorator';
import {boostResources} from '../../resources/map_resources';
import {Visualizer} from '../../visuals/Visualizer';
import {CombatZerg} from '../../zerg/CombatZerg';
import {Swarm} from '../../zerg/Swarm';
import {SwarmOverlord} from '../SwarmOverlord';

const DEBUG = false;

/**
 * Spawns squads of attackers and healers to siege a hostile room, moving with swarm logic in a coordinated fashion
 */
@profile
export class SwarmDestroyerOverlord extends SwarmOverlord {

	memory: any;
	directive: DirectiveSwarmDestroy;
	fallback: RoomPosition;
	assemblyPoints: RoomPosition[];
	intel: CombatIntel;
	zerglings: CombatZerg[];
	hydralisks: CombatZerg[];
	healers: CombatZerg[];
	swarms: { [ref: string]: Swarm };
	rangedSwarms: { [ref: string]: Swarm };

	static settings = {
		retreatHitsPercent : 0.85,
		reengageHitsPercent: 0.95,
		useRangedSwarms    : true,   // Enable ranged swarm support
	};

	constructor(directive: DirectiveSwarmDestroy, priority = OverlordPriority.offense.destroy) {
		super(directive, 'destroy', priority, 8);
		this.directive = directive;
		this.memory = Mem.wrap(this.directive.memory, this.name);
		this.intel = new CombatIntel(this.directive);
		this.zerglings = this.combatZerg(Roles.melee, {
			notifyWhenAttacked: false,
			boostWishlist     : [boostResources.attack[3], boostResources.tough[3], boostResources.move[3]]
		});
		this.hydralisks = this.combatZerg(Roles.ranged, {
			notifyWhenAttacked: false,
			boostWishlist     : [boostResources.ranged_attack[3], boostResources.tough[3], boostResources.move[3]]
		});
		this.healers = this.combatZerg(Roles.healer, {
			notifyWhenAttacked: false,
			boostWishlist     : [boostResources.heal[3], boostResources.tough[3], boostResources.move[3],]
		});
		// Make swarms
		this.makeSwarms();
		// Compute fallback positions and assembly points
		this.fallback = $.pos(this, 'fallback', () =>
			this.intel.findSwarmAssemblyPointInColony({width: 2, height: 2}), 200)!;
		this.assemblyPoints = [];
		for (let i = 0; i < _.keys(this.swarms).length + 1; i++) {
			this.assemblyPoints.push($.pos(this, `assemble_${i}`, () =>
				this.intel.findSwarmAssemblyPointInColony({width: 2, height: 2}, i + 1), 200)!);
		}
	}

	refresh() {
		super.refresh();
		this.memory = Mem.wrap(this.directive.memory, this.name);
		this.makeSwarms();
	}

	makeSwarms(): void {
		this.swarms = {};
		this.rangedSwarms = {};

		// Melee swarms (zerglings + healers)
		const meleeZerg: CombatZerg[] = [...this.zerglings, ...this.healers];
		const maxPerSwarm = {[Roles.melee]: 2, [Roles.healer]: 2, [Roles.ranged]: 4};
		const meleeZergBySwarm = _.groupBy(meleeZerg, zerg => zerg.findSwarm(meleeZerg, maxPerSwarm));

		for (const ref in meleeZergBySwarm) {
			if (ref != undefined) {
				if (DEBUG) log.debug(`Making melee swarm for ${_.map(meleeZergBySwarm[ref], z => z.name)}`);
				this.swarms[ref] = new Swarm(this, ref, meleeZergBySwarm[ref]);
			}
		}

		// Ranged swarms (hydralisks only - they self-heal)
		if (SwarmDestroyerOverlord.settings.useRangedSwarms && this.hydralisks.length > 0) {
			const rangedMaxPerSwarm = {[Roles.ranged]: 4};
			const rangedZergBySwarm = _.groupBy(this.hydralisks, zerg => zerg.findSwarm(this.hydralisks, rangedMaxPerSwarm));

			for (const ref in rangedZergBySwarm) {
				if (ref != undefined) {
					if (DEBUG) log.debug(`Making ranged swarm for ${_.map(rangedZergBySwarm[ref], z => z.name)}`);
					this.rangedSwarms[ref] = new Swarm(this, `ranged_${ref}`, rangedZergBySwarm[ref]);
				}
			}
		}
	}

	private handleSwarm(swarm: Swarm, index: number, waypoint = this.directive.pos) {
		// Swarm initially groups up at fallback location
		if (!swarm.memory.initialAssembly) {
			const assemblyPoint = this.assemblyPoints[index] || this.fallback;
			log.debug(`Assmbling at ${assemblyPoint.print}`);
			swarm.memory.initialAssembly = swarm.assemble(assemblyPoint);
			return;
		}

		// Swarm has now initially assembled with all members present
		// log.debug(`Done assmbling`);

		const room = swarm.rooms[0];
		if (!room) {
			log.warning(`${this.print} No room! (Why?)`);
		}
		// Siege the room
		const nearbyHostiles = _.filter(room.hostiles, creep => swarm.minRangeTo(creep) <= 3 + 1);
		const attack = _.sum(nearbyHostiles, creep => CombatIntel.getAttackDamage(creep));
		const rangedAttack = _.sum(nearbyHostiles, creep => CombatIntel.getRangedAttackDamage(creep));
		const myDamageMultiplier = CombatIntel.minimumDamageMultiplierForGroup(_.map(swarm.creeps, c => c.creep));

		const canPopShield = (attack + rangedAttack + CombatIntel.towerDamageAtPos(swarm.anchor)) * myDamageMultiplier
							 > _.min(_.map(swarm.creeps, creep => 100 * creep.getActiveBodyparts(TOUGH)));

		if (canPopShield || room.hostileStructures.length == 0 || _.values(this.swarms).length > 1) {
			swarm.autoCombat(this.pos.roomName, waypoint);
		} else {
			swarm.autoSiege(this.pos.roomName, waypoint);
		}
	}

	init() {
		let numSwarms = this.directive.memory.amount || 1;
		if (RoomIntel.inSafeMode(this.pos.roomName)) {
			numSwarms = 0;
		}

		const zerglingPriority = this.zerglings.length <= this.healers.length ? this.priority - 0.1 : this.priority + 0.1;
		const zerglingSetup = this.canBoostSetup(CombatSetups.zerglings.boosted_T3) ? CombatSetups.zerglings.boosted_T3
																					: CombatSetups.zerglings.default;

		const healerPriority = this.healers.length < this.zerglings.length ? this.priority - 0.1 : this.priority + 0.1;
		const healerSetup = this.canBoostSetup(CombatSetups.healers.boosted_T3) ? CombatSetups.healers.boosted_T3
																				: CombatSetups.healers.default;

		const hydraliskPriority = this.priority + 0.2; // Spawn hydralisks after main swarm
		const hydraliskSetup = this.canBoostSetup(CombatSetups.hydralisks.boosted_T3) ? CombatSetups.hydralisks.boosted_T3
																					  : CombatSetups.hydralisks.default;

		// Main melee swarm (zerglings + healers)
		const swarmConfig = [{setup: zerglingSetup, amount: 2, priority: zerglingPriority},
							 {setup: healerSetup, amount: 2, priority: healerPriority}];
		this.swarmWishlist(numSwarms, swarmConfig);

		// Ranged support swarm (hydralisks)
		if (SwarmDestroyerOverlord.settings.useRangedSwarms) {
			const rangedSwarmConfig = [{setup: hydraliskSetup, amount: 4, priority: hydraliskPriority}];
			this.swarmWishlist(numSwarms, rangedSwarmConfig);
		}
	}

	run() {
		this.autoRun(this.zerglings, zergling => undefined); // zergling => undefined is to handle boosting
		this.autoRun(this.healers, healer => undefined);
		this.autoRun(this.hydralisks, hydralisk => undefined);

		// Coordinate multiple swarms for synchronized attacks
		const allSwarms = [
			..._.values(this.swarms) as any[],
			..._.values(this.rangedSwarms) as any[]
		];

		if (allSwarms.length > 1) {
			this.coordinateSwarms(allSwarms);
		}

		// Run melee swarms in order
		const meleeRefs = _.keys(this.swarms).sort();
		let i = 0;
		for (const ref of meleeRefs) {
			this.handleSwarm(this.swarms[ref], i);
			i++;
		}

		// Run ranged swarms
		const rangedRefs = _.keys(this.rangedSwarms).sort();
		for (const ref of rangedRefs) {
			this.handleSwarm(this.rangedSwarms[ref], i);
			i++;
		}
	}

	/**
	 * Coordinate multiple swarms for synchronized attacks (pincer movement, target assignment, etc.)
	 */
	private coordinateSwarms(swarms: Swarm[]): void {
		if (swarms.length < 2) return;

		// Check if all swarms have completed initial assembly
		const allReady = _.all(swarms, s => s.memory.initialAssembly);

		if (!allReady) {
			// Wait for all swarms to assemble before coordinating attack
			if (DEBUG) log.debug(`Waiting for all swarms to assemble: ${_.filter(swarms, s => s.memory.initialAssembly).length}/${swarms.length}`);
			return;
		}

		// Get the target room
		const targetRoom = Game.rooms[this.pos.roomName];
		if (!targetRoom) return;

		// Strategy 1: Assign different targets to spread enemy response
		this.assignDistributedTargets(swarms, targetRoom);

		// Strategy 2: Focus fire coordination - all swarms attack same priority target
		this.coordinateFocusFire(swarms, targetRoom);
	}

	/**
	 * Assign different targets to spread enemy defenses thin
	 */
	private assignDistributedTargets(swarms: Swarm[], room: Room): void {
		// Only distribute when attacking structures (not creeps)
		if (room.hostiles.length > 0) return;

		// Find multiple entry points to attack
		const structures = room.hostileStructures;
		if (structures.length === 0) return;

		// Prioritize different structure types for different swarms
		const spawns = _.filter(structures, s => s.structureType === STRUCTURE_SPAWN);
		const towers = _.filter(structures, s => s.structureType === STRUCTURE_TOWER);
		const extensions = _.filter(structures, s => s.structureType === STRUCTURE_EXTENSION);

		const targetGroups = [spawns, towers, extensions].filter(g => g.length > 0);

		// Assign each swarm to attack a different structure group if possible
		for (let i = 0; i < swarms.length; i++) {
			const swarm = swarms[i];
			if (targetGroups.length > 0) {
				const targetGroup = targetGroups[i % targetGroups.length];
				const nearestTarget = swarm.anchor.findClosestByRange(targetGroup);
				if (nearestTarget) {
					swarm.target = nearestTarget;
				}
			}
		}
	}

	/**
	 * Coordinate focus fire - identify a single high-value target for all swarms
	 */
	private coordinateFocusFire(swarms: Swarm[], room: Room): void {
		if (room.hostiles.length === 0) return;

		// Calculate combined DPS of all swarms
		const totalDPS = _.sum(swarms, swarm => {
			return _.sum(swarm.creeps, c => {
				return CombatIntel.getAttackDamage(c.creep) + CombatIntel.getRangedAttackDamage(c.creep);
			});
		});

		// Find the best focus fire target
		let bestTarget: Creep | undefined;
		let bestScore = -Infinity;

		for (const hostile of room.hostiles) {
			if (hostile.pos.lookForStructure(STRUCTURE_RAMPART)) continue;

			const enemyHealRate = CombatIntel.maxHostileHealingTo(hostile);
			const healthPercent = hostile.hits / hostile.hitsMax;
			const healParts = hostile.getActiveBodyparts(HEAL);

			let score = 0;

			// High priority if we can overcome their healing
			if (totalDPS > enemyHealRate) {
				score += 1000;
			}

			// Healers are high value targets
			if (healParts > 0) {
				score += 500 + healParts * 30;
			}

			// Low health targets - easy kills
			if (healthPercent < 0.3) {
				score += 400;
			} else if (healthPercent < 0.5) {
				score += 200;
			}

			// Average distance from all swarms
			const avgDistance = _.sum(swarms, s => s.minRangeTo(hostile)) / swarms.length;
			score -= avgDistance * 15;

			if (score > bestScore) {
				bestScore = score;
				bestTarget = hostile;
			}
		}

		// Assign the focus target to all swarms
		if (bestTarget) {
			for (const swarm of swarms) {
				swarm.target = bestTarget;
			}
			if (DEBUG) log.debug(`Focus fire target: ${bestTarget.name} at ${bestTarget.pos.print}`);
		}
	}

	/**
	 * Check if swarms should retreat and regroup
	 */
	private shouldRegroup(swarms: Swarm[]): boolean {
		// Regroup if any swarm has taken heavy casualties
		for (const swarm of swarms) {
			const healthPercent = _.sum(swarm.creeps, c => c.hits) /
								  _.sum(swarm.creeps, c => c.hitsMax);
			if (healthPercent < 0.5) {
				return true;
			}

			// Regroup if swarm has lost members
			const expectedSize = swarm.creeps.length;
			if (expectedSize < 2) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Calculate pincer attack positions for multi-swarm assault
	 */
	private calculatePincerPositions(swarms: Swarm[], targetPos: RoomPosition): RoomPosition[] {
		const positions: RoomPosition[] = [];
		const numSwarms = swarms.length;

		if (numSwarms < 2) return [targetPos];

		// Calculate positions around target for pincer movement
		const angles = [];
		for (let i = 0; i < numSwarms; i++) {
			angles.push((2 * Math.PI * i) / numSwarms);
		}

		const attackRange = 5; // Distance from target to position swarms

		for (const angle of angles) {
			const dx = Math.round(Math.cos(angle) * attackRange);
			const dy = Math.round(Math.sin(angle) * attackRange);

			let x = targetPos.x + dx;
			let y = targetPos.y + dy;

			// Clamp to room bounds
			x = Math.max(2, Math.min(47, x));
			y = Math.max(2, Math.min(47, y));

			positions.push(new RoomPosition(x, y, targetPos.roomName));
		}

		return positions;
	}

	visuals() {
		Visualizer.marker(this.fallback, {color: 'green'});
		for (const ref in this.swarms) {
			const swarm = this.swarms[ref];
			Visualizer.marker(swarm.anchor, {color: 'blue'});
			if (swarm.target) {
				Visualizer.marker(swarm.target.pos, {color: 'orange'});
			}
		}
	}
}
