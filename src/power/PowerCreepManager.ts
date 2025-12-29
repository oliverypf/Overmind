import {Colony} from '../Colony';
import {log} from '../console/log';
import {Mem} from '../memory/Memory';
import {profile} from '../profiler/decorator';

/**
 * Power priorities - which powers to use first
 */
const POWER_PRIORITIES = [
	PWR_OPERATE_SPAWN,          // +1-3 spawn speed
	PWR_OPERATE_EXTENSION,      // Fill extensions instantly
	PWR_REGEN_SOURCE,           // Regenerate source capacity
	PWR_OPERATE_TOWER,          // Increase tower effectiveness
	PWR_OPERATE_LAB,            // Speed up lab reactions
	PWR_OPERATE_STORAGE,        // Increase storage capacity
	PWR_OPERATE_TERMINAL,       // Increase terminal capacity
	PWR_REGEN_MINERAL,          // Regenerate mineral
	PWR_OPERATE_OBSERVER,       // Increase observer range
];

interface PowerCreepManagerMemory {
	assignments: { [powerCreepName: string]: string };  // PowerCreep name -> colony name
	lastRun: number;
}

const PowerCreepManagerMemoryDefaults: PowerCreepManagerMemory = {
	assignments: {},
	lastRun: 0,
};

interface PowerCreepTask {
	power: PowerConstant;
	target: RoomObject | RoomPosition;
	priority: number;
}

/**
 * Manages all PowerCreeps in the empire
 */
@profile
export class PowerCreepManager {

	static memory: PowerCreepManagerMemory;

	/**
	 * Initialize the PowerCreep manager
	 */
	static init(): void {
		this.memory = Mem.wrap(Memory.Overmind, 'powerCreeps', PowerCreepManagerMemoryDefaults);
	}

	/**
	 * Get all active (spawned) PowerCreeps
	 */
	static get activePowerCreeps(): PowerCreep[] {
		return _.filter(Game.powerCreeps, pc => pc.ticksToLive !== undefined);
	}

	/**
	 * Get the assigned colony for a PowerCreep
	 */
	static getAssignment(powerCreep: PowerCreep): Colony | undefined {
		const colonyName = this.memory.assignments[powerCreep.name];
		return colonyName ? Overmind.colonies[colonyName] : undefined;
	}

	/**
	 * Assign a PowerCreep to a colony
	 */
	static assignToColony(powerCreep: PowerCreep, colony: Colony): void {
		this.memory.assignments[powerCreep.name] = colony.name;
		log.info(`Assigned ${powerCreep.name} to colony ${colony.name}`);
	}

	/**
	 * Find the best colony for a PowerCreep to operate in
	 */
	static findBestColony(powerCreep: PowerCreep): Colony | undefined {
		const colonies = _.filter(Overmind.colonies, colony =>
			colony.level >= 8 && colony.powerSpawn !== undefined
		);

		if (colonies.length === 0) return undefined;

		// Prefer colonies without a PowerCreep
		const unassignedColonies = _.filter(colonies, colony => {
			const assigned = _.find(this.memory.assignments, colName => colName === colony.name);
			return !assigned;
		});

		if (unassignedColonies.length > 0) {
			return _.max(unassignedColonies, c => c.assets[RESOURCE_ENERGY] || 0);
		}

		return _.max(colonies, c => c.assets[RESOURCE_ENERGY] || 0);
	}

	/**
	 * Check if a power can be used on a target
	 */
	static canUsePower(powerCreep: PowerCreep, power: PowerConstant, target?: RoomObject): boolean {
		const powerInfo = powerCreep.powers[power];
		if (!powerInfo) return false;
		if ((powerInfo as any).cooldown > 0) return false;

		// Check if we have enough ops
		const powerSpec = POWER_INFO[power] as any;
		const ops = (powerCreep as any).store ? (powerCreep as any).store[RESOURCE_OPS] || 0 : 0;
		if (powerSpec.ops && ops < powerSpec.ops) {
			return false;
		}

		return true;
	}

	/**
	 * Get list of possible tasks for a PowerCreep in a colony
	 */
	static getTasks(powerCreep: PowerCreep, colony: Colony): PowerCreepTask[] {
		const tasks: PowerCreepTask[] = [];

		// PWR_OPERATE_SPAWN - Speed up spawning
		if (powerCreep.powers[PWR_OPERATE_SPAWN] && this.canUsePower(powerCreep, PWR_OPERATE_SPAWN)) {
			for (const spawn of colony.spawns) {
				const effects = (spawn as any).effects as any[] | undefined;
				const hasEffect = effects && effects.find((e: any) => e.effect === PWR_OPERATE_SPAWN);
				if (spawn.spawning && !hasEffect) {
					tasks.push({
						power: PWR_OPERATE_SPAWN,
						target: spawn,
						priority: 10
					});
				}
			}
		}

		// PWR_OPERATE_EXTENSION - Fill extensions
		if (powerCreep.powers[PWR_OPERATE_EXTENSION] && this.canUsePower(powerCreep, PWR_OPERATE_EXTENSION)) {
			if (colony.storage && colony.storage.store[RESOURCE_ENERGY] > 50000) {
				const emptyExtensions = _.filter(colony.extensions,
					ext => ext.energy < ext.energyCapacity);
				if (emptyExtensions.length > 5) {
					tasks.push({
						power: PWR_OPERATE_EXTENSION,
						target: colony.storage,
						priority: 8
					});
				}
			}
		}

		// PWR_REGEN_SOURCE - Regenerate sources
		if (powerCreep.powers[PWR_REGEN_SOURCE] && this.canUsePower(powerCreep, PWR_REGEN_SOURCE)) {
			for (const source of colony.sources) {
				const effects = (source as any).effects as any[] | undefined;
				const hasEffect = effects && effects.find((e: any) => e.effect === PWR_REGEN_SOURCE);
				if (!hasEffect) {
					tasks.push({
						power: PWR_REGEN_SOURCE,
						target: source,
						priority: 6
					});
				}
			}
		}

		// PWR_OPERATE_TOWER - Enhance towers during combat
		if (powerCreep.powers[PWR_OPERATE_TOWER] && this.canUsePower(powerCreep, PWR_OPERATE_TOWER)) {
			if (colony.room.hostiles.length > 0) {
				for (const tower of colony.towers) {
					const effects = (tower as any).effects as any[] | undefined;
					const hasEffect = effects && effects.find((e: any) => e.effect === PWR_OPERATE_TOWER);
					if (!hasEffect) {
						tasks.push({
							power: PWR_OPERATE_TOWER,
							target: tower,
							priority: 15 // High priority during combat
						});
					}
				}
			}
		}

		// PWR_OPERATE_LAB - Speed up reactions
		if (powerCreep.powers[PWR_OPERATE_LAB] && this.canUsePower(powerCreep, PWR_OPERATE_LAB)) {
			if (colony.evolutionChamber) {
				for (const lab of colony.evolutionChamber.productLabs || []) {
					const effects = (lab as any).effects as any[] | undefined;
					const hasEffect = effects && effects.find((e: any) => e.effect === PWR_OPERATE_LAB);
					if (!hasEffect) {
						tasks.push({
							power: PWR_OPERATE_LAB,
							target: lab,
							priority: 4
						});
					}
				}
			}
		}

		return _.sortBy(tasks, t => -t.priority);
	}

	/**
	 * Run a single PowerCreep
	 */
	static runPowerCreep(powerCreep: PowerCreep): void {
		// If not spawned, try to spawn
		if (powerCreep.ticksToLive === undefined) {
			const colony = this.getAssignment(powerCreep) || this.findBestColony(powerCreep);
			if (colony && colony.powerSpawn) {
				const result = powerCreep.spawn(colony.powerSpawn);
				if (result === OK) {
					this.assignToColony(powerCreep, colony);
				}
			}
			return;
		}

		// Get assigned colony
		let colony = this.getAssignment(powerCreep);
		if (!colony) {
			colony = this.findBestColony(powerCreep);
			if (colony) {
				this.assignToColony(powerCreep, colony);
			} else {
				return;
			}
		}

		// Make sure we're in the right room
		if (!powerCreep.room || powerCreep.room.name !== colony.room.name) {
			if (colony.room.controller) {
				powerCreep.moveTo(colony.room.controller);
			}
			return;
		}

		// Enable powers if not already
		const controller = powerCreep.room.controller;
		if (controller && !controller.isPowerEnabled) {
			if (powerCreep.pos.isNearTo(controller)) {
				powerCreep.enableRoom(controller);
			} else {
				powerCreep.moveTo(controller);
			}
			return;
		}

		// Get and execute tasks
		const tasks = this.getTasks(powerCreep, colony);
		if (tasks.length > 0) {
			const task = tasks[0];
			const target = task.target as RoomObject;

			// Check range for power
			const powerSpec = POWER_INFO[task.power] as any;
			const range = powerSpec.range || 1;

			if (powerCreep.pos.getRangeTo(target) <= range) {
				powerCreep.usePower(task.power, target);
			} else {
				powerCreep.moveTo(target);
			}
		} else {
			// Renew if low on ticks
			if (powerCreep.ticksToLive < 1000 && colony.powerSpawn) {
				if (powerCreep.pos.isNearTo(colony.powerSpawn)) {
					powerCreep.renew(colony.powerSpawn);
				} else {
					powerCreep.moveTo(colony.powerSpawn);
				}
			}
		}
	}

	/**
	 * Run all PowerCreeps
	 */
	static run(): void {
		this.init();

		for (const name in Game.powerCreeps) {
			const powerCreep = Game.powerCreeps[name];
			try {
				this.runPowerCreep(powerCreep);
			} catch (e) {
				log.error(`Error running PowerCreep ${name}: ${e}`);
			}
		}

		this.memory.lastRun = Game.time;
	}
}
