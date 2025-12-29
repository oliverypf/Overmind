import {CreepSetup} from '../../creepSetups/CreepSetup';
import {Roles, Setups} from '../../creepSetups/setups';
import {Directive} from '../../directives/Directive';
import {DirectivePowerBank} from '../../directives/resource/powerBank';
import {OverlordPriority} from '../../priorities/priorities_overlords';
import {profile} from '../../profiler/decorator';
import {boostResources} from '../../resources/map_resources';
import {CombatZerg} from '../../zerg/CombatZerg';
import {Zerg} from '../../zerg/Zerg';
import {Overlord} from '../Overlord';

/**
 * DPS setup for breaking power banks
 */
const PowerBankAttackerSetup = new CreepSetup(Roles.melee, {
	pattern: [ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, MOVE, MOVE, MOVE, MOVE, MOVE],
	sizeLimit: Infinity,
});

const PowerBankAttackerBoostedSetup = new CreepSetup(Roles.melee, {
	pattern: [ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,
			  ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,
			  MOVE, MOVE, MOVE, MOVE, MOVE],
	sizeLimit: 2,
});

/**
 * Healer setup for supporting attackers
 */
const PowerBankHealerSetup = new CreepSetup(Roles.healer, {
	pattern: [HEAL, HEAL, HEAL, HEAL, HEAL, MOVE, MOVE, MOVE, MOVE, MOVE],
	sizeLimit: Infinity,
});

const PowerBankHealerBoostedSetup = new CreepSetup(Roles.healer, {
	pattern: [HEAL, HEAL, HEAL, HEAL, HEAL, HEAL, HEAL, HEAL, HEAL, HEAL,
			  HEAL, HEAL, HEAL, HEAL, HEAL, HEAL, HEAL, HEAL, HEAL, HEAL,
			  MOVE, MOVE, MOVE, MOVE, MOVE],
	sizeLimit: 2,
});

/**
 * Hauler setup for carrying power
 */
const PowerBankHaulerSetup = new CreepSetup(Roles.transport, {
	pattern: [CARRY, CARRY, CARRY, CARRY, MOVE, MOVE],
	sizeLimit: Infinity,
});

/**
 * Power Bank Miner Overlord - coordinates teams to break power banks and haul the power
 *
 * Strategy:
 * 1. Send DPS + healer pairs to attack the power bank
 * 2. Healers keep attackers alive against power bank reflect damage
 * 3. When power bank is almost dead, dispatch haulers to collect the power
 */
@profile
export class PowerBankMinerOverlord extends Overlord {

	directive: DirectivePowerBank;
	attackers: CombatZerg[];
	healers: CombatZerg[];
	haulers: Zerg[];

	static settings = {
		attackersPerBank: 2,                // Number of attackers
		healersPerAttacker: 1,              // Healers per attacker
		haulerDispatchThreshold: 0.15,      // Send haulers when power bank below this % HP
		boostThreshold: 3000,               // Boost if power >= this amount
	};

	constructor(directive: DirectivePowerBank, priority = OverlordPriority.remoteSKRoom.mine) {
		super(directive, 'powerBankMine', priority);
		this.directive = directive;

		// Initialize creep groups
		const useBoosted = this.shouldUseBoostedCreeps();

		this.attackers = this.combatZerg(Roles.melee, {
			boostWishlist: useBoosted ? [boostResources.attack[3]] : undefined,
			notifyWhenAttacked: false,
		});

		this.healers = this.combatZerg(Roles.healer, {
			boostWishlist: useBoosted ? [boostResources.heal[3]] : undefined,
			notifyWhenAttacked: false,
		});

		this.haulers = this.zerg(Roles.transport);
	}

	/**
	 * Determine if we should boost based on power amount
	 */
	private shouldUseBoostedCreeps(): boolean {
		return (this.directive.memory.power || 0) >= PowerBankMinerOverlord.settings.boostThreshold;
	}

	/**
	 * Calculate number of haulers needed
	 */
	private getHaulersNeeded(): number {
		const power = this.directive.memory.power || 0;
		const haulerCapacity = 300; // Approximate capacity per hauler
		return Math.ceil(power / haulerCapacity);
	}

	/**
	 * Check if we should send haulers
	 */
	private shouldSendHaulers(): boolean {
		const hits = this.directive.memory.hits || 0;
		const maxHits = this.directive.memory.maxHits || POWER_BANK_HITS;
		return hits < maxHits * PowerBankMinerOverlord.settings.haulerDispatchThreshold;
	}

	/**
	 * Find the power bank in the target room
	 */
	private findPowerBank(): StructurePowerBank | undefined {
		if (!this.room) return undefined;
		return _.first(this.room.find(FIND_STRUCTURES, {
			filter: s => s.structureType === STRUCTURE_POWER_BANK
		})) as StructurePowerBank | undefined;
	}

	init() {
		const useBoosted = this.shouldUseBoostedCreeps();
		const attackerSetup = useBoosted ? PowerBankAttackerBoostedSetup : PowerBankAttackerSetup;
		const healerSetup = useBoosted ? PowerBankHealerBoostedSetup : PowerBankHealerSetup;

		// Spawn attackers and healers
		this.wishlist(PowerBankMinerOverlord.settings.attackersPerBank, attackerSetup);
		this.wishlist(PowerBankMinerOverlord.settings.attackersPerBank *
					  PowerBankMinerOverlord.settings.healersPerAttacker, healerSetup);

		// Spawn haulers when power bank is almost dead
		if (this.shouldSendHaulers()) {
			this.wishlist(this.getHaulersNeeded(), PowerBankHaulerSetup);
		}
	}

	/**
	 * Handle attacker behavior
	 */
	private handleAttacker(attacker: CombatZerg): void {
		// Go to room if not there
		if (attacker.room.name !== this.pos.roomName) {
			attacker.goToRoom(this.pos.roomName);
			return;
		}

		const powerBank = this.findPowerBank();
		if (powerBank) {
			// Attack the power bank
			if (attacker.pos.isNearTo(powerBank)) {
				attacker.attack(powerBank);
			} else {
				attacker.goTo(powerBank, {range: 1});
			}
		} else {
			// Power bank destroyed - go to rally point
			attacker.goTo(this.pos);
		}
	}

	/**
	 * Handle healer behavior
	 */
	private handleHealer(healer: CombatZerg): void {
		// Go to room if not there
		if (healer.room.name !== this.pos.roomName) {
			healer.goToRoom(this.pos.roomName);
			return;
		}

		// Find attacker to heal
		const attacker = _.find(this.attackers, a =>
			a.room.name === this.pos.roomName && a.hits < a.hitsMax);
		const anyAttacker = _.first(_.filter(this.attackers, a =>
			a.room.name === this.pos.roomName));

		if (attacker) {
			// Heal damaged attacker
			if (healer.pos.isNearTo(attacker)) {
				healer.heal(attacker);
			} else {
				healer.goTo(attacker, {range: 1});
				healer.heal(attacker); // Ranged heal while moving
			}
		} else if (anyAttacker) {
			// Follow attacker
			if (!healer.pos.isNearTo(anyAttacker)) {
				healer.goTo(anyAttacker, {range: 1});
			}
			// Preheal
			healer.heal(anyAttacker);
		} else {
			// No attackers - go to rally
			healer.goTo(this.pos);
		}
	}

	/**
	 * Handle hauler behavior
	 */
	private handleHauler(hauler: Zerg): void {
		// Go to room if not there
		if (hauler.room.name !== this.pos.roomName) {
			hauler.goToRoom(this.pos.roomName);
			return;
		}

		// If full, return to colony
		if (_.sum(hauler.carry) >= hauler.carryCapacity * 0.9) {
			if (this.colony.terminal) {
				hauler.goTransfer(this.colony.terminal, RESOURCE_POWER);
			} else if (this.colony.storage) {
				hauler.goTransfer(this.colony.storage, RESOURCE_POWER);
			}
			return;
		}

		// Look for dropped power
		const droppedPower = _.first(hauler.room.find(FIND_DROPPED_RESOURCES, {
			filter: r => r.resourceType === RESOURCE_POWER
		}));
		if (droppedPower) {
			if (hauler.pos.isNearTo(droppedPower)) {
				hauler.pickup(droppedPower);
			} else {
				hauler.goTo(droppedPower);
			}
			return;
		}

		// Look for ruins with power (FIND_RUINS = 117)
		const ruins = _.first(hauler.room.find(117 as any, {
			filter: (r: any) => (r.store[RESOURCE_POWER] || 0) > 0
		})) as any;
		if (ruins) {
			hauler.goWithdraw(ruins, RESOURCE_POWER);
			return;
		}

		// Look for tombstones with power
		const tombstone = _.first(hauler.room.find(FIND_TOMBSTONES, {
			filter: t => (t.store[RESOURCE_POWER] || 0) > 0
		}));
		if (tombstone) {
			hauler.goWithdraw(tombstone, RESOURCE_POWER);
			return;
		}

		// Wait near the power bank location
		if (!hauler.pos.inRangeToPos(this.pos, 3)) {
			hauler.goTo(this.pos, {range: 3});
		}
	}

	run() {
		// Run attackers
		for (const attacker of this.attackers) {
			this.handleAttacker(attacker);
		}

		// Run healers
		for (const healer of this.healers) {
			this.handleHealer(healer);
		}

		// Run haulers
		for (const hauler of this.haulers) {
			this.handleHauler(hauler);
		}
	}
}
