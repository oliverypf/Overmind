import { log } from '../../console/log';
import { DepositMinerOverlord } from '../../overlords/mining/depositMiner';
import { OverlordPriority } from '../../priorities/priorities_overlords';
import { profile } from '../../profiler/decorator';
import { Directive } from '../Directive';

interface DirectiveDepositMemory extends FlagMemory {
	depositType?: string; // DepositConstant in newer API
	cooldown?: number;
	lastHarvested?: number;
	decay?: number;
	startTick?: number;
}

/**
 * Deposit mining directive - coordinates miners to harvest seasonal deposits
 */
@profile
export class DirectiveDeposit extends Directive {

	static directiveName = 'deposit';
	static color = COLOR_YELLOW;
	static secondaryColor = COLOR_PURPLE;

	memory: DirectiveDepositMemory;
	overlords: {
		mine: DepositMinerOverlord;
	};

	static settings = {
		maxCooldown: 100,                   // Max cooldown before abandoning
		maxRange: 5,                        // Maximum room range from colony
		minTicksRemaining: 2000,            // Minimum ticks before decay
	};

	constructor(flag: Flag) {
		super(flag);
		if (!this.memory.startTick) {
			this.memory.startTick = Game.time;
		}
	}

	spawnMoarOverlords() {
		// Only spawn overlord if deposit is viable
		if (this.memory.decay && this.memory.decay > DirectiveDeposit.settings.minTicksRemaining) {
			if (!this.memory.cooldown || this.memory.cooldown < DirectiveDeposit.settings.maxCooldown) {
				this.overlords.mine = new DepositMinerOverlord(this, OverlordPriority.remoteSKRoom.mine);
			}
		}
	}

	/**
	 * Check if a deposit is worth harvesting
	 */
	static isWorthHarvesting(deposit: any, colonyPos: RoomPosition): boolean {
		// Check range
		const range = Game.map.getRoomLinearDistance(deposit.pos.roomName, colonyPos.roomName);
		if (range > DirectiveDeposit.settings.maxRange) {
			return false;
		}

		// Check cooldown - high cooldown means it's been over-harvested
		if (deposit.cooldown > DirectiveDeposit.settings.maxCooldown) {
			return false;
		}

		// Check decay
		if (deposit.ticksToDecay < DirectiveDeposit.settings.minTicksRemaining) {
			return false;
		}

		return true;
	}

	init(): void {
		// Update deposit status
		if (this.room) {
			const deposit = _.first(this.room.find(127 as any)) as any; // FIND_DEPOSITS = 127

			if (deposit) {
				this.memory.depositType = deposit.depositType;
				this.memory.cooldown = deposit.cooldown;
				this.memory.decay = deposit.ticksToDecay;
				this.memory.lastHarvested = deposit.lastCooldown;
			} else {
				// Deposit missing (decayed or doesn't exist)
				log.info(`Deposit directive at ${this.pos.print} - deposit no longer exists`);
				this.remove();
				return;
			}
		}

		// Check if cooldown is too high - abandon this deposit
		if (this.memory.cooldown && this.memory.cooldown > DirectiveDeposit.settings.maxCooldown * 2) {
			log.info(`Deposit at ${this.pos.print} cooldown too high (${this.memory.cooldown}) - abandoning`);
			this.remove();
		}
	}

	run(): void {
		// Remove if decay is too low
		if (this.memory.decay && this.memory.decay < 500) {
			log.info(`Deposit at ${this.pos.print} will decay soon - removing directive`);
			this.remove();
		}
	}
}
