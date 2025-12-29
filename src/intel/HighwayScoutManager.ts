import {log} from '../console/log';
import {DirectiveDeposit} from '../directives/resource/deposit';
import {DirectivePowerBank} from '../directives/resource/powerBank';
import {profile} from '../profiler/decorator';
import {Cartographer, ROOMTYPE_ALLEY} from '../utilities/Cartographer';
import {CpuBudgetManager} from '../utilities/CpuBudgetManager';

/**
 * Highway memory structure
 */
interface HighwayMemory {
	lastScan: number;
	discoveredResources: {
		[roomName: string]: {
			type: 'powerBank' | 'deposit';
			tick: number;
		}
	};
}

const HighwayMemoryDefaults: HighwayMemory = {
	lastScan: 0,
	discoveredResources: {},
};

/**
 * Highway Scout Manager - discovers Power Banks and Deposits in highway rooms
 *
 * Strategies for discovering highway resources:
 * 1. Use observers to scan nearby highway rooms
 * 2. Use scouts to physically visit highway rooms
 * 3. Track discoveries and create appropriate directives
 */
@profile
export class HighwayScoutManager {

	static settings = {
		scanInterval: 50,                   // How often to scan highways (ticks)
		maxScanDistance: 6,                 // Maximum room distance to scan
		observerScanInterval: 10,           // How often observer scans (ticks)
		resourceExpiration: 5000,           // How long to track discovered resources
	};

	/**
	 * Get memory
	 */
	private static get memory(): HighwayMemory {
		if (!Memory.Overmind) {
			Memory.Overmind = {} as any;
		}
		if (!(Memory.Overmind as any).highway) {
			(Memory.Overmind as any).highway = HighwayMemoryDefaults;
		}
		return (Memory.Overmind as any).highway;
	}

	/**
	 * Get all highway rooms within range of colonies
	 */
	static getHighwayRoomsInRange(): string[] {
		const highwayRooms: Set<string> = new Set();

		for (const colonyName in Overmind.colonies) {
			const colony = Overmind.colonies[colonyName] as any;
			// Get rooms within scan distance
			const nearbyRooms = Cartographer.findRoomsInRange(colony.room.name,
				HighwayScoutManager.settings.maxScanDistance);

			for (const roomName of nearbyRooms) {
				const roomType = Cartographer.roomType(roomName);
				if (roomType === ROOMTYPE_ALLEY) {
					highwayRooms.add(roomName);
				}
			}
		}

		return Array.from(highwayRooms);
	}

	/**
	 * Find the nearest colony to a room
	 */
	static findNearestColony(roomName: string): any {
		let nearestColony: any = null;
		let minDistance = Infinity;

		for (const colony of _.values(Overmind.colonies) as any[]) {
			const distance = Game.map.getRoomLinearDistance(roomName, colony.room.name);
			if (distance < minDistance) {
				minDistance = distance;
				nearestColony = colony;
			}
		}

		return nearestColony;
	}

	/**
	 * Request observer scans for highway rooms
	 */
	static requestObserverScans(): void {
		if (Game.time % HighwayScoutManager.settings.observerScanInterval !== 0) {
			return;
		}

		const highwayRooms = this.getHighwayRoomsInRange();

		for (const roomName of highwayRooms) {
			// Skip if we already have vision
			if (Game.rooms[roomName]) continue;

			// Skip if recently discovered something there
			const cached = this.memory.discoveredResources[roomName];
			if (cached && Game.time - cached.tick < HighwayScoutManager.settings.resourceExpiration) {
				continue;
			}

			// Find nearest colony with observer
			const colony = this.findNearestColony(roomName);
			if (colony && colony.commandCenter && colony.commandCenter.observer) {
				colony.commandCenter.requestRoomObservation(roomName);
				break; // Only scan one room per tick per colony
			}
		}
	}

	/**
	 * Scan a visible room for resources
	 */
	static scanRoom(room: Room): void {
		const roomType = Cartographer.roomType(room.name);
		if (roomType !== ROOMTYPE_ALLEY) {
			return;
		}

		// Check for Power Banks
		const powerBanks = room.find(FIND_STRUCTURES, {
			filter: s => s.structureType === STRUCTURE_POWER_BANK
		}) as StructurePowerBank[];

		for (const powerBank of powerBanks) {
			this.handlePowerBankDiscovery(powerBank);
		}

		// Check for Deposits (FIND_DEPOSITS = 127 in newer API)
		const deposits = room.find(127 as any);

		for (const deposit of deposits) {
			this.handleDepositDiscovery(deposit);
		}
	}

	/**
	 * Handle power bank discovery
	 */
	private static handlePowerBankDiscovery(powerBank: StructurePowerBank): void {
		const roomName = powerBank.pos.roomName;

		// Check if already tracked
		const existing = this.memory.discoveredResources[roomName];
		if (existing && existing.type === 'powerBank') {
			return;
		}

		// Check if directive already exists
		const existingFlag = _.find(Game.flags, flag =>
			flag.pos.roomName === roomName && flag.color === COLOR_YELLOW && flag.secondaryColor === COLOR_RED
		);
		if (existingFlag) {
			return;
		}

		// Find nearest colony
		const colony = this.findNearestColony(roomName);
		if (!colony) {
			return;
		}

		// Check if worth harvesting
		if (!DirectivePowerBank.isWorthHarvesting(powerBank, colony.pos)) {
			return;
		}

		// Create directive
		const flagName = `powerBank_${roomName}_${Game.time}`;
		const result = powerBank.pos.createFlag(flagName, COLOR_YELLOW, COLOR_RED);

		if (result === flagName as any) {
			log.info(`Highway: Discovered Power Bank at ${powerBank.pos.print} with ${powerBank.power} power`);

			// Initialize flag memory
			const flag = Game.flags[flagName];
			if (flag) {
				flag.memory = {
					...flag.memory,
					power: powerBank.power,
					decay: powerBank.ticksToDecay,
				} as any;
			}

			// Track discovery
			this.memory.discoveredResources[roomName] = {
				type: 'powerBank',
				tick: Game.time,
			};
		}
	}

	/**
	 * Handle deposit discovery
	 */
	private static handleDepositDiscovery(deposit: any): void {
		const roomName = deposit.pos.roomName;

		// Check if already tracked
		const existingDeposit = this.memory.discoveredResources[roomName];
		if (existingDeposit && existingDeposit.type === 'deposit') {
			return;
		}

		// Check if directive already exists
		const existingFlag = _.find(Game.flags, flag =>
			flag.pos.roomName === roomName && flag.color === COLOR_YELLOW && flag.secondaryColor === COLOR_CYAN
		);
		if (existingFlag) {
			return;
		}

		// Find nearest colony
		const colony = this.findNearestColony(roomName);
		if (!colony) {
			return;
		}

		// Check if worth harvesting
		if (!DirectiveDeposit.isWorthHarvesting(deposit, colony.pos)) {
			return;
		}

		// Create directive
		const flagName = `deposit_${roomName}_${deposit.depositType}_${Game.time}`;
		const result = deposit.pos.createFlag(flagName, COLOR_YELLOW, COLOR_CYAN);

		if (result === flagName) {
			log.info(`Highway: Discovered ${deposit.depositType} Deposit at ${deposit.pos.print}`);

			// Initialize flag memory
			const flag = Game.flags[flagName];
			if (flag) {
				flag.memory = {
					...flag.memory,
					depositType: deposit.depositType,
					decay: deposit.ticksToDecay,
					cooldown: deposit.cooldown,
				} as any;
			}

			// Track discovery
			this.memory.discoveredResources[roomName] = {
				type: 'deposit',
				tick: Game.time,
			};
		}
	}

	/**
	 * Clean expired discoveries
	 */
	private static cleanExpiredDiscoveries(): void {
		for (const roomName in this.memory.discoveredResources) {
			const discovery = this.memory.discoveredResources[roomName];
			if (Game.time - discovery.tick > HighwayScoutManager.settings.resourceExpiration) {
				delete this.memory.discoveredResources[roomName];
			}
		}
	}

	/**
	 * Run highway scout manager
	 */
	static run(): void {
		// Only run when CPU budget allows
		if (!CpuBudgetManager.shouldRunOptionalTask(10)) {
			return;
		}

		// Clean up expired discoveries periodically
		if (Game.time % 1000 === 0) {
			this.cleanExpiredDiscoveries();
		}

		// Request observer scans
		this.requestObserverScans();

		// Scan visible highway rooms
		if (Game.time % HighwayScoutManager.settings.scanInterval === 0) {
			for (const roomName in Game.rooms) {
				this.scanRoom(Game.rooms[roomName]);
			}

			this.memory.lastScan = Game.time;
		}
	}
}
