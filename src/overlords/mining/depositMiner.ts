import {CreepSetup} from '../../creepSetups/CreepSetup';
import {Roles, Setups} from '../../creepSetups/setups';
import {Directive} from '../../directives/Directive';
import {DirectiveDeposit} from '../../directives/resource/deposit';
import {OverlordPriority} from '../../priorities/priorities_overlords';
import {profile} from '../../profiler/decorator';
import {Zerg} from '../../zerg/Zerg';
import {Overlord} from '../Overlord';

/**
 * Deposit miner setup - WORK heavy for harvesting deposits
 */
const DepositMinerSetup = new CreepSetup(Roles.drone, {
	pattern: [WORK, WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE, MOVE],
	sizeLimit: Infinity,
});

/**
 * Hauler setup for carrying deposit resources
 */
const DepositHaulerSetup = new CreepSetup(Roles.transport, {
	pattern: [CARRY, CARRY, CARRY, CARRY, MOVE, MOVE],
	sizeLimit: Infinity,
});

/**
 * Deposit Miner Overlord - harvests seasonal deposits (commodities)
 *
 * Strategy:
 * 1. Send WORK-heavy creeps to harvest the deposit
 * 2. Haulers transport resources back to colony terminal
 * 3. Monitor cooldown and abandon if it gets too high
 */
@profile
export class DepositMinerOverlord extends Overlord {

	directive: DirectiveDeposit;
	miners: Zerg[];
	haulers: Zerg[];
	container: StructureContainer | undefined;

	static settings = {
		minersPerDeposit: 2,                // Number of miners
		maxMinersPerDeposit: 4,             // Maximum miners if deposit is fresh
		haulerRatio: 2,                     // Haulers per miner
	};

	constructor(directive: DirectiveDeposit, priority = OverlordPriority.remoteSKRoom.mine) {
		super(directive, 'depositMine', priority);
		this.directive = directive;

		this.miners = this.zerg(Roles.drone);
		this.haulers = this.zerg(Roles.transport);

		// Find container near deposit
		if (this.room) {
			this.container = this.pos.findClosestByLimitedRange(this.room.containers, 2);
		}
	}

	/**
	 * Find the deposit in the target room
	 */
	private findDeposit(): any | undefined {
		if (!this.room) return undefined;
		return _.first(this.room.find(127 as any)); // FIND_DEPOSITS = 127
	}

	/**
	 * Calculate miners needed based on cooldown
	 */
	private getMinersNeeded(): number {
		const cooldown = this.directive.memory.cooldown || 0;
		if (cooldown > 50) {
			return 1; // Reduce miners if cooldown is high
		} else if (cooldown > 20) {
			return 2;
		} else {
			return Math.min(DepositMinerOverlord.settings.maxMinersPerDeposit,
							DepositMinerOverlord.settings.minersPerDeposit);
		}
	}

	init() {
		const minersNeeded = this.getMinersNeeded();
		this.wishlist(minersNeeded, DepositMinerSetup);

		// Spawn haulers to transport resources
		const haulersNeeded = Math.ceil(minersNeeded * DepositMinerOverlord.settings.haulerRatio);
		this.wishlist(haulersNeeded, DepositHaulerSetup);
	}

	/**
	 * Handle miner behavior
	 */
	private handleMiner(miner: Zerg): void {
		// Go to room if not there
		if (miner.room.name !== this.pos.roomName) {
			miner.goToRoom(this.pos.roomName);
			return;
		}

		const deposit = this.findDeposit();
		if (!deposit) {
			// No deposit - go home
			miner.goTo(this.colony.pos);
			return;
		}

		// If deposit is on cooldown, wait
		if (deposit.cooldown > 0) {
			if (!miner.pos.inRangeToPos(deposit.pos, 2)) {
				miner.goTo(deposit, {range: 2});
			}
			return;
		}

		// If full, transfer to container or drop
		if (_.sum(miner.carry) >= miner.carryCapacity * 0.9) {
			if (this.container && miner.pos.isNearTo(this.container)) {
				const resourceType = this.directive.memory.depositType || 'silicon';
				miner.transfer(this.container, resourceType as ResourceConstant);
			} else {
				// Drop resources for haulers
				const resourceType = this.directive.memory.depositType || 'silicon';
				miner.drop(resourceType as ResourceConstant);
			}
			return;
		}

		// Harvest the deposit
		if (miner.pos.isNearTo(deposit)) {
			miner.harvest(deposit);
		} else {
			miner.goTo(deposit, {range: 1});
		}
	}

	/**
	 * Handle hauler behavior
	 */
	private handleHauler(hauler: Zerg): void {
		const resourceType = (this.directive.memory.depositType || 'silicon') as ResourceConstant;

		// If full, return to colony
		if (_.sum(hauler.carry) >= hauler.carryCapacity * 0.9) {
			if (this.colony.terminal) {
				hauler.goTransfer(this.colony.terminal, resourceType);
			} else if (this.colony.storage) {
				hauler.goTransfer(this.colony.storage, resourceType);
			}
			return;
		}

		// Go to room if not there
		if (hauler.room.name !== this.pos.roomName) {
			hauler.goToRoom(this.pos.roomName);
			return;
		}

		// Pick up from container
		if (this.container && (this.container.store[resourceType] || 0) > 0) {
			hauler.goWithdraw(this.container, resourceType);
			return;
		}

		// Pick up dropped resources
		const dropped = _.first(hauler.room.find(FIND_DROPPED_RESOURCES, {
			filter: r => r.resourceType === resourceType
		}));
		if (dropped) {
			if (hauler.pos.isNearTo(dropped)) {
				hauler.pickup(dropped);
			} else {
				hauler.goTo(dropped);
			}
			return;
		}

		// Wait near deposit
		if (!hauler.pos.inRangeToPos(this.pos, 4)) {
			hauler.goTo(this.pos, {range: 4});
		}
	}

	run() {
		// Run miners
		for (const miner of this.miners) {
			// Flee from hostiles
			if (miner.flee(miner.room.fleeDefaults, {dropEnergy: true})) {
				continue;
			}
			this.handleMiner(miner);
		}

		// Run haulers
		for (const hauler of this.haulers) {
			// Flee from hostiles
			if (hauler.flee(hauler.room.fleeDefaults, {dropEnergy: true})) {
				continue;
			}
			this.handleHauler(hauler);
		}
	}
}
