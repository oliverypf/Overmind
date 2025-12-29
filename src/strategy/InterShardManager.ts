import {log} from '../console/log';
import {profile} from '../profiler/decorator';

/**
 * Inter-shard resource transfer request
 */
interface ShardTransferRequest {
	resource: ResourceConstant;
	amount: number;
	fromShard: string;
	toShard: string;
	priority: number;
	timestamp: number;
}

/**
 * Portal information
 */
interface PortalInfo {
	roomName: string;
	pos: {x: number, y: number};
	destination: {shard: string, room: string};
	decayTime?: number;
	lastSeen: number;
}

/**
 * Inter-shard memory structure
 */
interface InterShardMemory {
	enabled: boolean;
	thisShardName: string;
	portals: {[roomName: string]: PortalInfo[]};
	pendingTransfers: ShardTransferRequest[];
	shardStatus: {
		[shardName: string]: {
			colonies: number;
			gcl: number;
			cpu: number;
			lastUpdate: number;
		}
	};
	creepMigrations: {
		[creepName: string]: {
			targetShard: string;
			targetRoom: string;
			role: string;
			timestamp: number;
		}
	};
}

const DEFAULT_INTERSHARD_MEMORY: InterShardMemory = {
	enabled: false,
	thisShardName: '',
	portals: {},
	pendingTransfers: [],
	shardStatus: {},
	creepMigrations: {},
};

/**
 * InterShardManager: Handles cross-shard coordination including:
 * - Portal monitoring and discovery
 * - Resource transfer planning between shards
 * - Creep migration coordination
 * - Shard status synchronization
 */
@profile
export class InterShardManager {

	static settings = {
		scanInterval: 100,           // Ticks between portal scans
		syncInterval: 50,            // Ticks between shard status syncs
		transferTimeout: 5000,       // Timeout for pending transfers
		portalDecayWarning: 10000,   // Warn when portal will decay soon
	};

	/**
	 * Get inter-shard memory
	 */
	static get memory(): InterShardMemory {
		if (!Memory.interShard) {
			Memory.interShard = _.cloneDeep(DEFAULT_INTERSHARD_MEMORY);
		}
		return Memory.interShard as InterShardMemory;
	}

	/**
	 * Initialize the inter-shard manager
	 */
	static init(): void {
		// Detect current shard name
		if (!this.memory.thisShardName) {
			this.memory.thisShardName = (Game.shard ? Game.shard.name : undefined) || 'shard0';
		}
	}

	/**
	 * Enable/disable inter-shard operations
	 */
	static setEnabled(enabled: boolean): void {
		this.memory.enabled = enabled;
		log.info(`InterShardManager ${enabled ? 'enabled' : 'disabled'}`);
	}

	/**
	 * Scan visible rooms for portals
	 */
	static scanForPortals(): void {
		for (const roomName in Game.rooms) {
			const room = Game.rooms[roomName];
			const portals = room.find(FIND_STRUCTURES, {
				filter: s => s.structureType === STRUCTURE_PORTAL
			}) as StructurePortal[];

			if (portals.length > 0) {
				this.memory.portals[roomName] = [];

				for (const portal of portals) {
					const destination = portal.destination;

					// Check if it's an inter-shard portal
					if ('shard' in destination) {
						const portalInfo: PortalInfo = {
							roomName: roomName,
							pos: {x: portal.pos.x, y: portal.pos.y},
							destination: {
								shard: destination.shard,
								room: destination.room
							},
							decayTime: portal.ticksToDecay,
							lastSeen: Game.time,
						};

						this.memory.portals[roomName].push(portalInfo);

						// Warn if portal is decaying soon
						if (portal.ticksToDecay &&
							portal.ticksToDecay < InterShardManager.settings.portalDecayWarning) {
							log.warning(`Portal in ${roomName} to ${destination.shard}/${destination.room} ` +
								`decaying in ${portal.ticksToDecay} ticks!`);
						}
					}
				}
			}
		}
	}

	/**
	 * Get all known portals to a specific shard
	 */
	static getPortalsToShard(targetShard: string): PortalInfo[] {
		const portals: PortalInfo[] = [];

		for (const roomName in this.memory.portals) {
			for (const portal of this.memory.portals[roomName]) {
				if (portal.destination.shard === targetShard) {
					portals.push(portal);
				}
			}
		}

		return portals;
	}

	/**
	 * Find the nearest portal to a target shard from a given position
	 */
	static findNearestPortal(fromPos: RoomPosition, targetShard: string): PortalInfo | undefined {
		const portals = this.getPortalsToShard(targetShard);
		if (portals.length === 0) return undefined;

		return _.min(portals, portal => {
			const portalPos = new RoomPosition(portal.pos.x, portal.pos.y, portal.roomName);
			return Game.map.getRoomLinearDistance(fromPos.roomName, portalPos.roomName);
		});
	}

	/**
	 * Update this shard's status for sharing with other shards
	 */
	static updateShardStatus(): void {
		const status = {
			colonies: _.keys(Overmind.colonies).length,
			gcl: Game.gcl.level,
			cpu: Game.cpu.bucket,
			lastUpdate: Game.time,
		};

		this.memory.shardStatus[this.memory.thisShardName] = status;

		// Write to inter-shard segment for other shards to read
		try {
			const segmentData = JSON.stringify({
				shard: this.memory.thisShardName,
				status: status,
				portals: this.memory.portals,
			});

			// Use segment 99 for inter-shard communication
			RawMemory.segments[99] = segmentData;
		} catch (e) {
			log.error(`Failed to write inter-shard segment: ${e}`);
		}
	}

	/**
	 * Request a resource transfer from another shard
	 */
	static requestTransfer(resource: ResourceConstant, amount: number,
						   fromShard: string, toShard: string, priority: number = 5): void {
		const request: ShardTransferRequest = {
			resource,
			amount,
			fromShard,
			toShard,
			priority,
			timestamp: Game.time,
		};

		this.memory.pendingTransfers.push(request);
		log.info(`Requested transfer: ${amount} ${resource} from ${fromShard} to ${toShard}`);
	}

	/**
	 * Process pending transfer requests
	 */
	static processTransfers(): void {
		const now = Game.time;

		// Remove expired transfers
		this.memory.pendingTransfers = _.filter(this.memory.pendingTransfers,
			t => now - t.timestamp < InterShardManager.settings.transferTimeout);

		// Process transfers where this shard is the source
		const outgoingTransfers = _.filter(this.memory.pendingTransfers,
			t => t.fromShard === this.memory.thisShardName);

		for (const transfer of outgoingTransfers) {
			this.executeOutgoingTransfer(transfer);
		}
	}

	/**
	 * Execute an outgoing transfer
	 */
	private static executeOutgoingTransfer(transfer: ShardTransferRequest): void {
		// Find portal to target shard
		const portal = this.findNearestPortal(
			new RoomPosition(25, 25, _.keys(Overmind.colonies)[0]),
			transfer.toShard
		);

		if (!portal) {
			log.warning(`No portal found to ${transfer.toShard} for transfer`);
			return;
		}

		// Find colony with the requested resource
		const sourceColony = _.find(Overmind.colonies, colony => {
			const terminal = colony.terminal;
			return terminal && terminal.store[transfer.resource] >= transfer.amount;
		});

		if (!sourceColony) {
			log.warning(`No colony has ${transfer.amount} ${transfer.resource} for transfer`);
			return;
		}

		log.info(`Found source colony ${sourceColony.name} for transfer to ${transfer.toShard}`);
		// TODO: Spawn hauler to carry resources to portal
	}

	/**
	 * Request a creep to migrate to another shard
	 */
	static requestCreepMigration(creepName: string, targetShard: string,
								 targetRoom: string, role: string): void {
		this.memory.creepMigrations[creepName] = {
			targetShard,
			targetRoom,
			role,
			timestamp: Game.time,
		};

		log.info(`Scheduled migration for ${creepName} to ${targetShard}/${targetRoom}`);
	}

	/**
	 * Check if a creep should migrate
	 */
	static shouldCreepMigrate(creepName: string): boolean {
		return this.memory.creepMigrations[creepName] !== undefined;
	}

	/**
	 * Get migration info for a creep
	 */
	static getMigrationInfo(creepName: string): {targetShard: string, targetRoom: string} | undefined {
		const migration = this.memory.creepMigrations[creepName];
		if (migration) {
			return {
				targetShard: migration.targetShard,
				targetRoom: migration.targetRoom,
			};
		}
		return undefined;
	}

	/**
	 * Clean up completed migrations
	 */
	static cleanupMigrations(): void {
		const toRemove: string[] = [];

		for (const creepName in this.memory.creepMigrations) {
			// Remove if creep no longer exists (migrated or died)
			if (!Game.creeps[creepName]) {
				toRemove.push(creepName);
			}
			// Remove if migration is too old
			const migration = this.memory.creepMigrations[creepName];
			if (Game.time - migration.timestamp > 5000) {
				toRemove.push(creepName);
			}
		}

		for (const name of toRemove) {
			delete this.memory.creepMigrations[name];
		}
	}

	/**
	 * Get summary of shard resources for planning
	 */
	static getShardResourceSummary(): {[resource: string]: number} {
		const summary: {[resource: string]: number} = {};

		for (const colonyName in Overmind.colonies) {
			const colony = Overmind.colonies[colonyName];
			if (colony.terminal) {
				for (const resource in colony.terminal.store) {
					if (!summary[resource]) {
						summary[resource] = 0;
					}
					summary[resource] += colony.terminal.store[resource as ResourceConstant];
				}
			}
			if (colony.storage) {
				for (const resource in colony.storage.store) {
					if (!summary[resource]) {
						summary[resource] = 0;
					}
					summary[resource] += colony.storage.store[resource as ResourceConstant];
				}
			}
		}

		return summary;
	}

	/**
	 * Main run method
	 */
	static run(): void {
		if (!this.memory.enabled) return;

		// Initialize
		this.init();

		// Periodic portal scanning
		if (Game.time % InterShardManager.settings.scanInterval === 0) {
			this.scanForPortals();
		}

		// Periodic status sync
		if (Game.time % InterShardManager.settings.syncInterval === 0) {
			this.updateShardStatus();
		}

		// Process transfers
		this.processTransfers();

		// Cleanup old migrations
		this.cleanupMigrations();
	}
}

// Extend Memory interface
declare global {
	interface Memory {
		interShard?: InterShardMemory;
	}
}
