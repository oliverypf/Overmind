import { log } from '../../console/log';
import { PowerBankMinerOverlord } from '../../overlords/mining/powerBankMiner';
import { OverlordPriority } from '../../priorities/priorities_overlords';
import { profile } from '../../profiler/decorator';
import { Directive } from '../Directive';

interface DirectivePowerBankMemory extends FlagMemory {
	power: number;
	decay: number;
	hits?: number;
	maxHits?: number;
	startTick?: number;
	haulersSent?: number;
}

/**
 * Power Bank mining directive - coordinates DPS + healers to break power banks and haul the power
 */
@profile
export class DirectivePowerBank extends Directive {

	static directiveName = 'powerBank';
	static color = COLOR_YELLOW;
	static secondaryColor = COLOR_RED;

	memory: DirectivePowerBankMemory;
	overlords: {
		mine: PowerBankMinerOverlord;
	};

	static settings = {
		minPower: 2000,                     // Minimum power to be worth harvesting
		maxRange: 6,                        // Maximum room range from colony
		minTicksRemaining: 3000,            // Minimum ticks before decay to start harvesting
	};

	constructor(flag: Flag) {
		super(flag, colony => colony.level >= 7);
		// Initialize memory if needed
		if (!this.memory.power) {
			this.memory.power = 0;
		}
		if (!this.memory.decay) {
			this.memory.decay = 0;
		}
		if (!this.memory.startTick) {
			this.memory.startTick = Game.time;
		}
	}

	spawnMoarOverlords() {
		// Only spawn overlord if power bank is worth it
		if (this.memory.power >= DirectivePowerBank.settings.minPower) {
			this.overlords.mine = new PowerBankMinerOverlord(this, OverlordPriority.remoteSKRoom.mine);
		}
	}

	/**
	 * Check if the power bank is worth harvesting
	 */
	static isWorthHarvesting(powerBank: StructurePowerBank, colonyPos: RoomPosition): boolean {
		// Check power amount
		if (powerBank.power < DirectivePowerBank.settings.minPower) {
			return false;
		}

		// Check decay time
		if (powerBank.ticksToDecay < DirectivePowerBank.settings.minTicksRemaining) {
			return false;
		}

		// Check range
		const range = Game.map.getRoomLinearDistance(powerBank.pos.roomName, colonyPos.roomName);
		if (range > DirectivePowerBank.settings.maxRange) {
			return false;
		}

		return true;
	}

	init(): void {
		// Update power bank status
		if (this.room) {
			const powerBank = _.first(this.room.find(FIND_STRUCTURES, {
				filter: s => s.structureType === STRUCTURE_POWER_BANK
			})) as StructurePowerBank | undefined;

			if (powerBank) {
				this.memory.power = powerBank.power;
				this.memory.decay = powerBank.ticksToDecay;
				this.memory.hits = powerBank.hits;
				this.memory.maxHits = powerBank.hitsMax;
			} else {
				// Power bank destroyed or missing
				if (this.memory.power > 0) {
					// Check if there's dropped power to collect
					const droppedPower = _.first(this.room.find(FIND_DROPPED_RESOURCES, {
						filter: r => r.resourceType === RESOURCE_POWER
					}));
					const ruins = _.first(this.room.find(117 as any, { // FIND_RUINS = 117
						filter: (r: any) => (r.store[RESOURCE_POWER] || 0) > 0
					}));

					if (!droppedPower && !ruins) {
						log.info(`PowerBank directive at ${this.pos.print} completed - power collected`);
						this.remove();
						return;
					}
				} else {
					log.info(`PowerBank directive at ${this.pos.print} - no power bank found`);
					this.remove();
					return;
				}
			}
		}

		// Check timeout - if too long without progress, abort
		const elapsed = Game.time - (this.memory.startTick || Game.time);
		if (elapsed > 10000 && this.memory.hits === this.memory.maxHits) {
			log.warning(`PowerBank directive at ${this.pos.print} timed out - aborting`);
			this.remove();
		}
	}

	run(): void {
		// Remove if decay is too low and we haven't made progress
		if (this.memory.decay < 500 && this.memory.hits === this.memory.maxHits) {
			log.warning(`PowerBank at ${this.pos.print} will decay before we can break it - aborting`);
			this.remove();
		}
	}
}
