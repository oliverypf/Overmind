import {log} from '../console/log';
import {CombatIntel} from '../intel/CombatIntel';
import {profile} from '../profiler/decorator';

/**
 * SafeMode trigger conditions
 */
interface SafeModeTrigger {
	type: 'spawn_threatened' | 'storage_threatened' | 'controller_threatened' | 'overwhelmed';
	severity: 'low' | 'medium' | 'high' | 'critical';
	timestamp: number;
	roomName: string;
}

/**
 * SafeMode decision memory
 */
interface SafeModeMemory {
	lastTriggered: {[roomName: string]: number};
	triggers: SafeModeTrigger[];
	cooldowns: {[roomName: string]: number};
}

const DEFAULT_SAFEMODE_MEMORY: SafeModeMemory = {
	lastTriggered: {},
	triggers: [],
	cooldowns: {},
};

/**
 * SafeModeManager: Intelligent safe mode triggering based on threat assessment.
 *
 * Triggers safe mode when:
 * - Spawns are being attacked and will be destroyed
 * - Storage/Terminal threatened with significant resources
 * - Controller under attack (downgrade risk)
 * - Defense is completely overwhelmed
 */
@profile
export class SafeModeManager {

	static settings = {
		// Minimum safe modes to keep in reserve
		minReserveSafeModes: 1,
		// Time threshold (ticks) to wait before triggering
		reactionTime: 3,
		// Minimum damage ratio (enemy DPS / our healing) to consider overwhelmed
		overwhelmedThreshold: 2.0,
		// Storage value threshold to protect
		minStorageValueToProtect: 100000,
		// Minimum ticks between safe mode considerations per room
		cooldownTicks: 1000,
	};

	/**
	 * Get safe mode memory
	 */
	static get memory(): SafeModeMemory {
		if (!Memory.safeMode) {
			Memory.safeMode = _.cloneDeep(DEFAULT_SAFEMODE_MEMORY);
		}
		return Memory.safeMode as SafeModeMemory;
	}

	/**
	 * Evaluate if safe mode should be triggered for a colony
	 */
	static evaluateRoom(room: Room): SafeModeTrigger | undefined {
		if (!room.controller || !room.controller.my) return undefined;
		if (!room.controller.safeModeAvailable) return undefined;
		if (room.controller.safeMode) return undefined;
		if (room.controller.safeModeCooldown) return undefined;

		// Check cooldown
		const cooldown = this.memory.cooldowns[room.name];
		if (cooldown && Game.time < cooldown) return undefined;

		const hostiles = room.hostiles;
		if (hostiles.length === 0) return undefined;

		// Assess threats
		const spawnThreat = this.assessSpawnThreat(room, hostiles);
		if (spawnThreat) return spawnThreat;

		const storageThreat = this.assessStorageThreat(room, hostiles);
		if (storageThreat) return storageThreat;

		const controllerThreat = this.assessControllerThreat(room, hostiles);
		if (controllerThreat) return controllerThreat;

		const overwhelmed = this.assessOverwhelmed(room, hostiles);
		if (overwhelmed) return overwhelmed;

		return undefined;
	}

	/**
	 * Check if spawns are threatened
	 */
	private static assessSpawnThreat(room: Room, hostiles: Creep[]): SafeModeTrigger | undefined {
		const spawns = room.find(FIND_MY_SPAWNS);
		if (spawns.length === 0) return undefined;

		for (const spawn of spawns) {
			// Check if hostiles are near spawn
			const nearbyHostiles = spawn.pos.findInRange(hostiles, 3);
			if (nearbyHostiles.length === 0) continue;

			// Calculate incoming damage
			let incomingDamage = 0;
			for (const hostile of nearbyHostiles) {
				const range = spawn.pos.getRangeTo(hostile);
				if (range <= 1) {
					incomingDamage += CombatIntel.getAttackDamage(hostile);
					incomingDamage += CombatIntel.getDismantleDamage(hostile);
				}
				if (range <= 3) {
					incomingDamage += CombatIntel.getRangedAttackDamage(hostile);
				}
			}

			// Check if spawn will be destroyed
			const ticksToDestroy = spawn.hits / Math.max(incomingDamage, 1);

			if (ticksToDestroy <= this.settings.reactionTime && incomingDamage > 0) {
				return {
					type: 'spawn_threatened',
					severity: ticksToDestroy <= 1 ? 'critical' : 'high',
					timestamp: Game.time,
					roomName: room.name,
				};
			}
		}

		return undefined;
	}

	/**
	 * Check if storage/terminal is threatened
	 */
	private static assessStorageThreat(room: Room, hostiles: Creep[]): SafeModeTrigger | undefined {
		const structures = [room.storage, room.terminal].filter(s => s != undefined) as (StructureStorage | StructureTerminal)[];

		for (const structure of structures) {
			// Calculate stored value
			let storedValue = 0;
			for (const resource in structure.store) {
				const amount = structure.store[resource as ResourceConstant];
				// Energy is worth less, other resources worth more
				if (resource === RESOURCE_ENERGY) {
					storedValue += amount * 0.01;
				} else {
					storedValue += amount * 0.1;
				}
			}

			if (storedValue < this.settings.minStorageValueToProtect) continue;

			// Check if hostiles are attacking
			const nearbyHostiles = structure.pos.findInRange(hostiles, 3);
			if (nearbyHostiles.length === 0) continue;

			let incomingDamage = 0;
			for (const hostile of nearbyHostiles) {
				const range = structure.pos.getRangeTo(hostile);
				if (range <= 1) {
					incomingDamage += CombatIntel.getAttackDamage(hostile);
					incomingDamage += CombatIntel.getDismantleDamage(hostile);
				}
				if (range <= 3) {
					incomingDamage += CombatIntel.getRangedAttackDamage(hostile);
				}
			}

			const ticksToDestroy = structure.hits / Math.max(incomingDamage, 1);

			if (ticksToDestroy <= this.settings.reactionTime * 2 && incomingDamage > 0) {
				return {
					type: 'storage_threatened',
					severity: ticksToDestroy <= this.settings.reactionTime ? 'high' : 'medium',
					timestamp: Game.time,
					roomName: room.name,
				};
			}
		}

		return undefined;
	}

	/**
	 * Check if controller is being attacked
	 */
	private static assessControllerThreat(room: Room, hostiles: Creep[]): SafeModeTrigger | undefined {
		const controller = room.controller;
		if (!controller) return undefined;

		// Check for claim attackers near controller
		const nearController = controller.pos.findInRange(hostiles, 1);
		const claimAttackers = _.filter(nearController, h => h.getActiveBodyparts(CLAIM) > 0);

		if (claimAttackers.length > 0) {
			// Calculate downgrade potential
			const attackPower = _.sum(claimAttackers, c => c.getActiveBodyparts(CLAIM)) * CONTROLLER_CLAIM_DOWNGRADE;
			const ticksToDowngrade = controller.ticksToDowngrade / Math.max(attackPower, 1);

			if (ticksToDowngrade <= 100) {
				return {
					type: 'controller_threatened',
					severity: ticksToDowngrade <= 20 ? 'critical' : 'high',
					timestamp: Game.time,
					roomName: room.name,
				};
			}
		}

		return undefined;
	}

	/**
	 * Check if defense is completely overwhelmed
	 */
	private static assessOverwhelmed(room: Room, hostiles: Creep[]): SafeModeTrigger | undefined {
		// Calculate enemy combat potential
		const enemyDPS = _.sum(hostiles, h =>
			CombatIntel.getAttackDamage(h) +
			CombatIntel.getRangedAttackDamage(h) +
			CombatIntel.getDismantleDamage(h)
		);

		const enemyHealing = _.sum(hostiles, h => CombatIntel.getHealAmount(h));

		// Calculate our combat potential
		const myCreeps = room.find(FIND_MY_CREEPS);
		const myDPS = _.sum(myCreeps, c =>
			CombatIntel.getAttackDamage(c) +
			CombatIntel.getRangedAttackDamage(c)
		);

		const myHealing = _.sum(myCreeps, c => CombatIntel.getHealAmount(c));

		// Add tower damage
		const towerRefPos = hostiles[0] ? hostiles[0].pos : room.controller!.pos;
		const towerDamage = room.towers.length > 0
			? (CombatIntel.towerDamageAtPos(towerRefPos) || 0) * room.towers.length
			: 0;

		const totalMyDPS = myDPS + towerDamage;

		// Calculate ratios
		const damageRatio = enemyDPS / Math.max(myHealing + 100, 1);
		const healingRatio = enemyHealing / Math.max(totalMyDPS, 1);

		// We're overwhelmed if enemy can out-damage our healing AND out-heal our damage
		if (damageRatio >= this.settings.overwhelmedThreshold &&
			healingRatio >= 1.0 &&
			enemyDPS > 500) {
			return {
				type: 'overwhelmed',
				severity: damageRatio >= 3.0 ? 'critical' : 'high',
				timestamp: Game.time,
				roomName: room.name,
			};
		}

		return undefined;
	}

	/**
	 * Trigger safe mode for a room
	 */
	static triggerSafeMode(room: Room, trigger: SafeModeTrigger): boolean {
		if (!room.controller || !room.controller.my) return false;
		if (!room.controller.safeModeAvailable) return false;
		if (room.controller.safeMode) return false;
		if (room.controller.safeModeCooldown) return false;

		// Check reserve safe modes
		if (room.controller.safeModeAvailable <= this.settings.minReserveSafeModes &&
			trigger.severity !== 'critical') {
			log.warning(`${room.name}: Not triggering safe mode (reserving ${this.settings.minReserveSafeModes} safe modes)`);
			return false;
		}

		// Trigger safe mode
		const result = room.controller.activateSafeMode();

		if (result === OK) {
			log.alert(`🛡️ SAFE MODE ACTIVATED in ${room.name}! Reason: ${trigger.type} (${trigger.severity})`);
			this.memory.lastTriggered[room.name] = Game.time;
			this.memory.triggers.push(trigger);

			// Set cooldown
			this.memory.cooldowns[room.name] = Game.time + this.settings.cooldownTicks;

			return true;
		} else {
			log.error(`Failed to activate safe mode in ${room.name}: ${result}`);
			return false;
		}
	}

	/**
	 * Run safe mode evaluation for all colonies
	 */
	static run(): void {
		for (const colonyName in Overmind.colonies) {
			const colony = Overmind.colonies[colonyName];
			const room = colony.room;

			const trigger = this.evaluateRoom(room);

			if (trigger) {
				// Only auto-trigger for critical and high severity
				if (trigger.severity === 'critical') {
					this.triggerSafeMode(room, trigger);
				} else if (trigger.severity === 'high') {
					log.warning(`${room.name}: Safe mode recommended - ${trigger.type}`);
					// Could auto-trigger here for high severity too
					// this.triggerSafeMode(room, trigger);
				}
			}
		}

		// Cleanup old triggers
		this.memory.triggers = _.filter(this.memory.triggers,
			t => Game.time - t.timestamp < 10000);
	}
}

// Extend Memory interface
declare global {
	interface Memory {
		safeMode?: SafeModeMemory;
	}
}
