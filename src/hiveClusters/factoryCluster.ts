import {$} from '../caching/GlobalCache';
import {Colony} from '../Colony';
import {log} from '../console/log';
import {TransportRequestGroup} from '../logistics/TransportRequestGroup';
import {Mem} from '../memory/Memory';
import {Priority} from '../priorities/priorities';
import {profile} from '../profiler/decorator';
import {HiveCluster} from './_HiveCluster';

/**
 * Commodity recipes - defines what resources are needed to produce each commodity
 */
const COMMODITY_RECIPES: { [commodity: string]: { [ingredient: string]: number } } = {
	// Basic commodities (Level 0 factory)
	[RESOURCE_COMPOSITE]: {[RESOURCE_UTRIUM_BAR]: 20, [RESOURCE_ZYNTHIUM_BAR]: 20, [RESOURCE_ENERGY]: 20},
	[RESOURCE_CRYSTAL]: {[RESOURCE_LEMERGIUM_BAR]: 6, [RESOURCE_KEANIUM_BAR]: 6, [RESOURCE_PURIFIER]: 6, [RESOURCE_ENERGY]: 45},
	[RESOURCE_LIQUID]: {[RESOURCE_OXIDANT]: 12, [RESOURCE_REDUCTANT]: 12, [RESOURCE_GHODIUM_MELT]: 12, [RESOURCE_ENERGY]: 90},

	// Compression commodities
	[RESOURCE_UTRIUM_BAR]: {[RESOURCE_UTRIUM]: 500, [RESOURCE_ENERGY]: 200},
	[RESOURCE_LEMERGIUM_BAR]: {[RESOURCE_LEMERGIUM]: 500, [RESOURCE_ENERGY]: 200},
	[RESOURCE_ZYNTHIUM_BAR]: {[RESOURCE_ZYNTHIUM]: 500, [RESOURCE_ENERGY]: 200},
	[RESOURCE_KEANIUM_BAR]: {[RESOURCE_KEANIUM]: 500, [RESOURCE_ENERGY]: 200},
	[RESOURCE_GHODIUM_MELT]: {[RESOURCE_GHODIUM]: 500, [RESOURCE_ENERGY]: 200},
	[RESOURCE_OXIDANT]: {[RESOURCE_OXYGEN]: 500, [RESOURCE_ENERGY]: 200},
	[RESOURCE_REDUCTANT]: {[RESOURCE_HYDROGEN]: 500, [RESOURCE_ENERGY]: 200},
	[RESOURCE_PURIFIER]: {[RESOURCE_CATALYST]: 500, [RESOURCE_ENERGY]: 200},

	// Battery
	[RESOURCE_BATTERY]: {[RESOURCE_ENERGY]: 600},
};

/**
 * Production priorities - which commodities to produce first
 */
const PRODUCTION_PRIORITY: ResourceConstant[] = [
	RESOURCE_BATTERY,           // Energy storage
	RESOURCE_UTRIUM_BAR,        // Compression
	RESOURCE_LEMERGIUM_BAR,
	RESOURCE_ZYNTHIUM_BAR,
	RESOURCE_KEANIUM_BAR,
	RESOURCE_GHODIUM_MELT,
	RESOURCE_OXIDANT,
	RESOURCE_REDUCTANT,
	RESOURCE_PURIFIER,
	RESOURCE_COMPOSITE,         // Basic commodities
	RESOURCE_CRYSTAL,
	RESOURCE_LIQUID,
];

interface FactoryClusterMemory {
	producing?: ResourceConstant;
	lastProduction?: number;
	stats: {
		produced: { [resource: string]: number };
	};
}

const FactoryClusterMemoryDefaults: FactoryClusterMemory = {
	stats: {
		produced: {}
	}
};

/**
 * The factory cluster manages commodity production
 */
@profile
export class FactoryCluster extends HiveCluster {

	memory: FactoryClusterMemory;
	factory: StructureFactory;
	transportRequests: TransportRequestGroup;

	static settings = {
		minEnergyToOperate: 10000,      // Minimum energy in terminal to operate
		productionCooldown: 10,          // Ticks between production decisions
		minBatchSize: 100,               // Minimum amount to produce at once
	};

	constructor(colony: Colony, factory: StructureFactory) {
		super(colony, factory, 'factory');
		this.memory = Mem.wrap(this.colony.memory, 'factory', FactoryClusterMemoryDefaults);
		this.factory = factory;
		this.transportRequests = new TransportRequestGroup();
	}

	refresh(): void {
		this.memory = Mem.wrap(this.colony.memory, 'factory', FactoryClusterMemoryDefaults);
		$.refreshRoom(this);
		$.refresh(this, 'factory');
		this.transportRequests.refresh();
	}

	spawnMoarOverlords(): void {
		// Factory doesn't need its own overlord - uses the command center manager
	}

	/**
	 * Get the factory level (0-5)
	 */
	get level(): number {
		return this.factory.level || 0;
	}

	/**
	 * Check if we have enough ingredients to produce a commodity
	 */
	private canProduce(commodity: ResourceConstant): boolean {
		const recipe = COMMODITY_RECIPES[commodity];
		if (!recipe) return false;

		const store = this.factory.store;
		for (const ingredient in recipe) {
			const required = recipe[ingredient];
			const available = store[ingredient as ResourceConstant] || 0;
			if (available < required) {
				return false;
			}
		}
		return true;
	}

	/**
	 * Check if we should produce a commodity based on colony needs
	 */
	private shouldProduce(commodity: ResourceConstant): boolean {
		// Don't produce if terminal is low on energy
		if (!this.colony.terminal) return false;
		if (this.colony.terminal.store[RESOURCE_ENERGY] < FactoryCluster.settings.minEnergyToOperate) {
			return false;
		}

		// Special case: produce batteries when we have excess energy
		if (commodity === RESOURCE_BATTERY) {
			const storageEnergy = this.colony.storage ? this.colony.storage.store[RESOURCE_ENERGY] : 0;
			const terminalEnergy = this.colony.terminal ? this.colony.terminal.store[RESOURCE_ENERGY] : 0;
			const totalEnergy = storageEnergy + terminalEnergy;
			return totalEnergy > 500000; // Only produce batteries when energy-rich
		}

		// For compression bars, check if we have excess of the base mineral
		const compressionMap: { [bar: string]: ResourceConstant } = {
			[RESOURCE_UTRIUM_BAR]: RESOURCE_UTRIUM,
			[RESOURCE_LEMERGIUM_BAR]: RESOURCE_LEMERGIUM,
			[RESOURCE_ZYNTHIUM_BAR]: RESOURCE_ZYNTHIUM,
			[RESOURCE_KEANIUM_BAR]: RESOURCE_KEANIUM,
			[RESOURCE_GHODIUM_MELT]: RESOURCE_GHODIUM,
			[RESOURCE_OXIDANT]: RESOURCE_OXYGEN,
			[RESOURCE_REDUCTANT]: RESOURCE_HYDROGEN,
			[RESOURCE_PURIFIER]: RESOURCE_CATALYST,
		};

		if (compressionMap[commodity]) {
			const baseMineral = compressionMap[commodity];
			const available = this.colony.assets[baseMineral] || 0;
			return available > 10000; // Compress when we have excess
		}

		return this.canProduce(commodity);
	}

	/**
	 * Decide what to produce next
	 */
	private decideProduction(): ResourceConstant | undefined {
		for (const commodity of PRODUCTION_PRIORITY) {
			if (this.canProduce(commodity) && this.shouldProduce(commodity)) {
				return commodity;
			}
		}
		return undefined;
	}

	/**
	 * Request ingredients for a commodity
	 */
	private requestIngredients(commodity: ResourceConstant): void {
		const recipe = COMMODITY_RECIPES[commodity];
		if (!recipe) return;

		for (const ingredient in recipe) {
			const required = recipe[ingredient] * 5; // Request 5 batches worth
			const inFactory = this.factory.store[ingredient as ResourceConstant] || 0;
			if (inFactory < required) {
				const amount = required - inFactory;
				this.transportRequests.requestInput(this.factory, Priority.Normal, {
					resourceType: ingredient as ResourceConstant,
					amount: amount
				});
			}
		}
	}

	/**
	 * Request output to be taken from factory
	 */
	private requestOutput(): void {
		for (const resourceType in this.factory.store) {
			// Don't output ingredients we might need
			if (COMMODITY_RECIPES[resourceType]) {
				// This is a product - request output if we have enough
				const amount = this.factory.store[resourceType as ResourceConstant] || 0;
				if (amount > 100) {
					this.transportRequests.requestOutput(this.factory, Priority.Normal, {
						resourceType: resourceType as ResourceConstant,
						amount: amount
					});
				}
			}
		}
	}

	init(): void {
		// Decide what to produce
		if (Game.time % FactoryCluster.settings.productionCooldown === 0) {
			this.memory.producing = this.decideProduction();
		}

		// Request ingredients for current production
		if (this.memory.producing) {
			this.requestIngredients(this.memory.producing);
		}

		// Request output of finished products
		this.requestOutput();
	}

	run(): void {
		if (this.factory.cooldown > 0) return;

		// Try to produce the decided commodity
		if (this.memory.producing && this.canProduce(this.memory.producing)) {
			const result = this.factory.produce(this.memory.producing);
			if (result === OK) {
				this.memory.lastProduction = Game.time;
				// Track stats
				if (!this.memory.stats.produced[this.memory.producing]) {
					this.memory.stats.produced[this.memory.producing] = 0;
				}
				this.memory.stats.produced[this.memory.producing]++;
				log.debug(`${this.print}: Produced ${this.memory.producing}`);
			}
		}
	}
}
