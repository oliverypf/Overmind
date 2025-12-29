import {CreepSetup} from '../../creepSetups/CreepSetup';
import {Roles} from '../../creepSetups/setups';
import {Directive} from '../../directives/Directive';
import {CombatIntel} from '../../intel/CombatIntel';
import {OverlordPriority} from '../../priorities/priorities_overlords';
import {profile} from '../../profiler/decorator';
import {boostResources} from '../../resources/map_resources';
import {CombatZerg} from '../../zerg/CombatZerg';
import {CombatOverlord} from '../CombatOverlord';

/**
 * Drainer setup - heavy TOUGH + HEAL for absorbing tower damage
 */
const DrainerSetups = {
	default: new CreepSetup(Roles.healer, {
		pattern: [TOUGH, TOUGH, MOVE, MOVE, MOVE, MOVE, HEAL, HEAL, HEAL, HEAL],
		sizeLimit: Infinity,
	}),
	boosted: new CreepSetup(Roles.healer, {
		pattern: [TOUGH, TOUGH, TOUGH, TOUGH, HEAL, HEAL, HEAL, HEAL, HEAL, MOVE],
		sizeLimit: Infinity,
	}),
};

/**
 * Drainer Overlord - spawns tanky heal creeps to drain enemy tower energy
 *
 * Strategy: Send heal-heavy creeps to sit at the edge of tower range and absorb damage.
 * Towers will waste energy attacking creeps that can out-heal the damage.
 * Once towers are drained, switch to main attack force.
 */
@profile
export class DrainerOverlord extends CombatOverlord {

	drainers: CombatZerg[];
	room: Room | undefined;

	static settings = {
		drainerCount: 2,                    // Number of drainers to spawn
		minTowerEnergy: 100,                // Consider drained when towers below this
		retreatHitsPercent: 0.5,            // Retreat when below 50% HP
		optimalTowerRange: 20,              // Stay at edge of tower range
		drainCheckInterval: 10,             // Check tower energy every N ticks
	};

	constructor(directive: Directive, priority = OverlordPriority.offense.destroy) {
		super(directive, 'drain', priority, 1);

		// Determine if we should use boosted drainers
		const useBoosted = this.shouldBoost();

		this.drainers = this.combatZerg(Roles.healer, {
			boostWishlist: useBoosted ? [
				boostResources.tough[3],  // XGHO2 - 70% damage reduction
				boostResources.heal[3],   // XLHO2 - 4x heal
				boostResources.move[3],   // XZHO2 - 4x fatigue reduction
			] : undefined,
			notifyWhenAttacked: false,
		});
	}

	/**
	 * Determine if we need boosted drainers based on tower count
	 */
	private shouldBoost(): boolean {
		if (!this.room) return true; // Assume worst case without vision

		const towerCount = this.room.towers.length;
		// Need boosts if more than 3 towers
		return towerCount > 3;
	}

	/**
	 * Calculate total tower energy remaining
	 */
	private getTotalTowerEnergy(): number {
		if (!this.room) return Infinity;

		return _.sum(this.room.towers, tower => tower.store[RESOURCE_ENERGY] || 0);
	}

	/**
	 * Check if towers are sufficiently drained
	 */
	isDrained(): boolean {
		if (!this.room) return false;

		const avgTowerEnergy = this.getTotalTowerEnergy() / Math.max(1, this.room.towers.length);
		return avgTowerEnergy < DrainerOverlord.settings.minTowerEnergy;
	}

	/**
	 * Find optimal position at tower range edge
	 */
	private findDrainPosition(drainer: CombatZerg): RoomPosition | undefined {
		if (!this.room) return undefined;

		const towers = this.room.towers;
		if (towers.length === 0) return undefined;

		// Find position that is at range 20 from nearest tower (edge of effective range)
		const targetRange = DrainerOverlord.settings.optimalTowerRange;

		// Get positions around the room edges near exits
		const exitPositions: RoomPosition[] = [];
		for (let x = 1; x < 49; x++) {
			for (let y = 1; y < 49; y++) {
				// Only consider positions near room edges
				if (x > 5 && x < 44 && y > 5 && y < 44) continue;

				const pos = new RoomPosition(x, y, this.room.name);
				const terrain = Game.map.getRoomTerrain(this.room.name);

				// Skip walls
				if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

				// Check if position is at optimal tower range
				const nearestTower = pos.findClosestByRange(towers);
				if (nearestTower) {
					const range = pos.getRangeTo(nearestTower);
					if (range >= targetRange - 2 && range <= targetRange + 2) {
						exitPositions.push(pos);
					}
				}
			}
		}

		// Return closest valid position to drainer
		if (exitPositions.length > 0) {
			return drainer.pos.findClosestByRange(exitPositions);
		}

		return undefined;
	}

	/**
	 * Handle drainer actions
	 */
	private handleDrainer(drainer: CombatZerg): void {
		// Always try to heal self
		if (drainer.hits < drainer.hitsMax) {
			drainer.heal(drainer);
		}

		// Check if we need to retreat
		if (drainer.hits < drainer.hitsMax * DrainerOverlord.settings.retreatHitsPercent) {
			// Retreat to safety
			drainer.kite(this.room ? this.room.hostiles : [], {range: 10});
			return;
		}

		// Move to drain position if not there
		if (!this.room) {
			drainer.goToRoom(this.pos.roomName);
			return;
		}

		const drainPos = this.findDrainPosition(drainer);
		if (drainPos && !drainer.pos.isEqualTo(drainPos)) {
			drainer.goTo(drainPos);
		}

		// Self heal
		drainer.heal(drainer);
	}

	init() {
		// Determine how many drainers we need
		let drainerCount = DrainerOverlord.settings.drainerCount;

		if (this.room) {
			const towerCount = this.room.towers.length;
			// More towers = more drainers needed
			drainerCount = Math.min(4, Math.ceil(towerCount / 2));
		}

		// Use appropriate setup
		const setup = this.shouldBoost() ? DrainerSetups.boosted : DrainerSetups.default;
		this.wishlist(drainerCount, setup);
	}

	run() {
		// Log drain progress periodically
		if (Game.time % DrainerOverlord.settings.drainCheckInterval === 0) {
			const totalEnergy = this.getTotalTowerEnergy();
			const towerCount = this.room ? this.room.towers.length : 0;
			if (towerCount > 0) {
				console.log(`Drain progress: ${totalEnergy} energy in ${towerCount} towers`);
			}
		}

		// Run drainer logic
		for (const drainer of this.drainers) {
			this.handleDrainer(drainer);
		}
	}
}
