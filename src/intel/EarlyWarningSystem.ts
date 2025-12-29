import {log} from '../console/log';
import {profile} from '../profiler/decorator';
import {Cartographer} from '../utilities/Cartographer';

/**
 * Early Warning Memory
 */
interface EarlyWarningMemory {
	threats: {
		[roomName: string]: {
			detectedAt: number;
			hostileCount: number;
			combatPower: number;
			owner?: string;
			direction?: string;
		}
	};
	lastScan: number;
}

const EarlyWarningMemoryDefaults: EarlyWarningMemory = {
	threats: {},
	lastScan: 0,
};

/**
 * Threat assessment for a room
 */
interface ThreatAssessment {
	level: 'none' | 'low' | 'medium' | 'high' | 'critical';
	hostileCount: number;
	combatPower: number;
	healPower: number;
	primaryOwner?: string;
	hasBoosts: boolean;
}

/**
 * Early Warning System - monitors nearby rooms for incoming threats
 *
 * Features:
 * 1. Scan adjacent rooms for hostile activity
 * 2. Assess threat level based on hostile creep composition
 * 3. Trigger preemptive defensive measures
 * 4. Track hostile player patterns
 */
@profile
export class EarlyWarningSystem {

	static settings = {
		scanInterval: 10,                   // How often to scan adjacent rooms
		warningThreshold: 3,                // Hostile count to trigger warning
		threatDecay: 100,                   // Ticks before threat record decays
		highThreatCombatPower: 500,         // Combat power for high threat
		criticalThreatCombatPower: 1500,    // Combat power for critical threat
	};

	/**
	 * Get memory
	 */
	private static get memory(): EarlyWarningMemory {
		if (!Memory.Overmind) {
			Memory.Overmind = {} as any;
		}
		if (!(Memory.Overmind as any).earlyWarning) {
			(Memory.Overmind as any).earlyWarning = EarlyWarningMemoryDefaults;
		}
		return (Memory.Overmind as any).earlyWarning;
	}

	/**
	 * Calculate combat power of a creep
	 */
	static getCreepCombatPower(creep: Creep): number {
		let power = 0;

		// Attack power
		power += creep.getActiveBodyparts(ATTACK) * ATTACK_POWER;
		power += creep.getActiveBodyparts(RANGED_ATTACK) * RANGED_ATTACK_POWER;

		// Heal power (considered as defensive capability)
		power += creep.getActiveBodyparts(HEAL) * HEAL_POWER * 0.5;

		// Work power (for dismantlers)
		power += creep.getActiveBodyparts(WORK) * DISMANTLE_POWER * 0.3;

		// Check for boosts (multiply power)
		for (const bodyPart of creep.body) {
			if (bodyPart.boost) {
				power *= 1.5; // Boosted creeps are more dangerous
				break;
			}
		}

		return power;
	}

	/**
	 * Assess threat in a room
	 */
	static assessThreat(room: Room): ThreatAssessment {
		const hostiles = room.hostiles.filter(h =>
			h.owner.username !== 'Invader' &&
			h.owner.username !== 'Source Keeper'
		);

		if (hostiles.length === 0) {
			return {
				level: 'none',
				hostileCount: 0,
				combatPower: 0,
				healPower: 0,
				hasBoosts: false,
			};
		}

		let combatPower = 0;
		let healPower = 0;
		let hasBoosts = false;
		const owners: { [owner: string]: number } = {};

		for (const hostile of hostiles) {
			combatPower += this.getCreepCombatPower(hostile);
			healPower += hostile.getActiveBodyparts(HEAL) * HEAL_POWER;

			// Track owner
			owners[hostile.owner.username] = (owners[hostile.owner.username] || 0) + 1;

			// Check for boosts
			if (_.some(hostile.body, bp => bp.boost)) {
				hasBoosts = true;
			}
		}

		// Determine primary owner
		const primaryOwner = _.max(Object.keys(owners), o => owners[o]);

		// Determine threat level
		let level: 'none' | 'low' | 'medium' | 'high' | 'critical' = 'low';
		if (combatPower >= EarlyWarningSystem.settings.criticalThreatCombatPower) {
			level = 'critical';
		} else if (combatPower >= EarlyWarningSystem.settings.highThreatCombatPower) {
			level = 'high';
		} else if (hostiles.length >= EarlyWarningSystem.settings.warningThreshold) {
			level = 'medium';
		}

		// Boost presence elevates threat level
		if (hasBoosts && level !== 'critical') {
			level = level === 'high' ? 'critical' : level === 'medium' ? 'high' : 'medium';
		}

		return {
			level,
			hostileCount: hostiles.length,
			combatPower,
			healPower,
			primaryOwner: typeof primaryOwner === 'string' ? primaryOwner : undefined,
			hasBoosts,
		};
	}

	/**
	 * Get direction from one room to another
	 */
	static getRoomDirection(from: string, to: string): string {
		const fromCoord = Cartographer.getRoomCoordinates(from);
		const toCoord = Cartographer.getRoomCoordinates(to);

		if (!fromCoord || !toCoord) return 'unknown';

		const dx = toCoord.x - fromCoord.x;
		const dy = toCoord.y - fromCoord.y;

		if (Math.abs(dx) > Math.abs(dy)) {
			return dx > 0 ? 'east' : 'west';
		} else {
			return dy > 0 ? 'south' : 'north';
		}
	}

	/**
	 * Scan adjacent rooms for a colony
	 */
	static scanColony(colony: any): void {
		const adjacentRoomNames = _.values(Game.map.describeExits(colony.room.name)) as string[];

		for (const roomName of adjacentRoomNames) {
			const room = Game.rooms[roomName];
			if (!room) continue; // No vision

			const threat = this.assessThreat(room);

			if (threat.level !== 'none') {
				const direction = this.getRoomDirection(roomName, colony.room.name);

				// Record threat
				this.memory.threats[roomName] = {
					detectedAt: Game.time,
					hostileCount: threat.hostileCount,
					combatPower: threat.combatPower,
					owner: threat.primaryOwner,
					direction: direction,
				};

				// Trigger warning based on threat level
				this.triggerWarning(colony, roomName, threat, direction);
			}
		}
	}

	/**
	 * Trigger warning for a colony
	 */
	static triggerWarning(colony: any, threatRoom: string, threat: ThreatAssessment, direction: string): void {
		const threatInfo = `${threat.hostileCount} hostiles (power: ${threat.combatPower}) from ${direction}`;

		switch (threat.level) {
			case 'critical':
				log.alert(`🚨 CRITICAL THREAT to ${colony.print}: ${threatInfo}`);
				// Consider activating safemode preparation
				if (colony.room.controller && colony.room.controller.safeModeAvailable > 0) {
					log.info(`SafeMode available for ${colony.print} if needed`);
				}
				break;

			case 'high':
				log.alert(`⚠️ HIGH THREAT to ${colony.print}: ${threatInfo}`);
				break;

			case 'medium':
				log.warning(`⚡ MEDIUM THREAT to ${colony.print}: ${threatInfo}`);
				break;

			case 'low':
				log.info(`📍 Low threat detected near ${colony.print}: ${threatInfo}`);
				break;
		}

		// Record diplomacy if owner is known
		if (threat.primaryOwner) {
			// This would integrate with DiplomacyManager
			log.info(`Threat from player: ${threat.primaryOwner}`);
		}
	}

	/**
	 * Get active threats for a colony
	 */
	static getActiveThreats(colonyRoomName: string): EarlyWarningMemory['threats'] {
		const adjacentRooms = _.values(Game.map.describeExits(colonyRoomName)) as string[];
		const activeThreats: EarlyWarningMemory['threats'] = {};

		for (const roomName of adjacentRooms) {
			const threat = this.memory.threats[roomName];
			if (threat && Game.time - threat.detectedAt < EarlyWarningSystem.settings.threatDecay) {
				activeThreats[roomName] = threat;
			}
		}

		return activeThreats;
	}

	/**
	 * Get overall threat level for a colony
	 */
	static getColonyThreatLevel(colonyRoomName: string): 'safe' | 'alert' | 'danger' {
		const threats = this.getActiveThreats(colonyRoomName);
		const threatValues = _.values(threats) as any[];

		if (threatValues.length === 0) {
			return 'safe';
		}

		const maxThreat = _.max(threatValues, t => t.combatPower) as any;
		const maxCombatPower = maxThreat ? maxThreat.combatPower : 0;

		if (maxCombatPower >= EarlyWarningSystem.settings.criticalThreatCombatPower) {
			return 'danger';
		} else if (maxCombatPower >= EarlyWarningSystem.settings.highThreatCombatPower) {
			return 'alert';
		}

		return 'safe';
	}

	/**
	 * Clean expired threat records
	 */
	private static cleanExpiredThreats(): void {
		for (const roomName in this.memory.threats) {
			const threat = this.memory.threats[roomName];
			if (Game.time - threat.detectedAt > EarlyWarningSystem.settings.threatDecay) {
				delete this.memory.threats[roomName];
			}
		}
	}

	/**
	 * Run early warning system
	 */
	static run(): void {
		if (Game.time % EarlyWarningSystem.settings.scanInterval !== 0) {
			return;
		}

		// Clean expired threats
		this.cleanExpiredThreats();

		// Scan each colony
		for (const colony of _.values(Overmind.colonies)) {
			this.scanColony(colony);
		}

		this.memory.lastScan = Game.time;
	}
}
