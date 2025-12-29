import {assimilationLocked} from '../assimilation/decorator';
import {log} from '../console/log';
import {Mem} from '../memory/Memory';
import {profile} from '../profiler/decorator';
import {CpuBudgetManager} from '../utilities/CpuBudgetManager';
import {alignedNewline, bullet, leftArrow, rightArrow} from '../utilities/stringConstants';
import {maxBy, minBy, onPublicServer, printRoomName} from '../utilities/utils';

interface MarketCache {
	sell: { [resourceType: string]: { high: number, low: number } };
	buy: { [resourceType: string]: { high: number, low: number } };
	tick: number;
}

interface TraderMemory {
	cache: MarketCache;
	equalizeIndex: number;
}

interface TraderStats {
	credits: number;
	bought: {
		[resourceType: string]: {
			amount: number,
			credits: number,
		}
	};
	sold: {
		[resourceType: string]: {
			amount: number,
			credits: number,
		}
	};
}

const TraderMemoryDefaults: TraderMemory = {
	cache        : {
		sell: {},
		buy : {},
		tick: 0,
	},
	equalizeIndex: 0
};

const TraderStatsDefaults: TraderStats = {
	credits: 0,
	bought : {},
	sold   : {},
};

// Maximum prices I'm willing to pay to buy various resources - based on shard2 market data in June 2018
// (might not always be up to date)
export const maxMarketPrices: { [resourceType: string]: number } = {
	default             : 5.0,
	[RESOURCE_HYDROGEN] : 0.3,
	[RESOURCE_OXYGEN]   : 0.25,
	[RESOURCE_UTRIUM]   : 0.3,
	[RESOURCE_LEMERGIUM]: 0.25,
	[RESOURCE_KEANIUM]  : 0.25,
	[RESOURCE_ZYNTHIUM] : 0.25,
	[RESOURCE_CATALYST] : 0.5,
	[RESOURCE_ENERGY]   : 0.05,
};

export const MAX_ENERGY_SELL_ORDERS = 5;
export const MAX_ENERGY_BUY_ORDERS = 5;


/**
 * The trade network controls resource acquisition and disposal on the player market.
 */
@profile
@assimilationLocked
export class TraderJoe implements ITradeNetwork {

	static settings = {
		cache : {
			timeout: 25,
		},
		market: {
			reserveCredits: 10000,	// Always try to stay above this amount
			boostCredits  : 25000,	// You can buy boosts directly off market while above this amount
			energyCredits : 50000, 	// Can buy energy off market if above this amount
			orders        : {
				timeout      : 100000,	// Remove orders after this many ticks if remaining amount < cleanupAmount
				cleanupAmount: 10,		// RemainingAmount threshold to remove expiring orders
			}
		},
	};

	memory: TraderMemory;
	stats: TraderStats;
	private notifications: string[];

	constructor() {
		this.memory = Mem.wrap(Memory.Overmind, 'trader', TraderMemoryDefaults, true);
		this.stats = Mem.wrap(Memory.stats.persistent, 'trader', TraderStatsDefaults);
		this.notifications = [];
	}

	refresh() {
		this.memory = Mem.wrap(Memory.Overmind, 'trader', TraderMemoryDefaults, true);
		this.stats = Mem.wrap(Memory.stats.persistent, 'trader', TraderStatsDefaults);
		this.notifications = [];
	}

	private notify(msg: string): void {
		this.notifications.push(bullet + msg);
	}

	/**
	 * Builds a cache for market - this is very expensive; use infrequently
	 */
	private buildMarketCache(verbose = false, orderThreshold = 1000): void {
		this.invalidateMarketCache();
		const myActiveOrderIDs = _.map(_.filter(Game.market.orders, order => order.active), order => order.id);
		const allOrders = Game.market.getAllOrders(order => !myActiveOrderIDs.includes(order.id) &&
															order.amount >= orderThreshold); // don't include tiny orders
		const groupedBuyOrders = _.groupBy(_.filter(allOrders, o => o.type == ORDER_BUY), o => o.resourceType);
		const groupedSellOrders = _.groupBy(_.filter(allOrders, o => o.type == ORDER_SELL), o => o.resourceType);
		for (const resourceType in groupedBuyOrders) {
			// Store buy order with maximum price in cache
			const prices = _.map(groupedBuyOrders[resourceType], o => o.price);
			const high = _.max(prices);
			const low = _.min(prices);
			if (verbose) console.log(`${resourceType} BUY: high: ${high}  low: ${low}`);
			// this.memory.cache.buy[resourceType] = minBy(groupedBuyOrders[resourceType], (o:Order) => -1 * o.price);
			this.memory.cache.buy[resourceType] = {high: high, low: low};
		}
		for (const resourceType in groupedSellOrders) {
			// Store sell order with minimum price in cache
			const prices = _.map(groupedSellOrders[resourceType], o => o.price);
			const high = _.max(prices);
			const low = _.min(prices);
			if (verbose) console.log(`${resourceType} SELL: high: ${high}  low: ${low}`);
			// this.memory.cache.sell[resourceType] = minBy(groupedSellOrders[resourceType], (o:Order) => o.price);
			this.memory.cache.sell[resourceType] = {high: high, low: low};
		}
		this.memory.cache.tick = Game.time;
	}

	private invalidateMarketCache(): void {
		this.memory.cache = {
			sell: {},
			buy : {},
			tick: 0,
		};
	}

	/**
	 * Cost per unit including transfer price with energy converted to credits
	 */
	private effectivePrice(order: Order, terminal: StructureTerminal): number {
		if (order.roomName) {
			const transferCost = Game.market.calcTransactionCost(1000, order.roomName, terminal.room.name) / 1000;
			const energyToCreditMultiplier = this.getEnergyToCreditMultiplier();
			return order.price + transferCost * energyToCreditMultiplier;
		} else {
			return Infinity;
		}
	}

	/**
	 * Cost per unit for a buy order including transfer price with energy converted to credits
	 */
	private effectiveBuyPrice(order: Order, terminal: StructureTerminal): number {
		if (order.roomName) {
			const transferCost = Game.market.calcTransactionCost(1000, order.roomName, terminal.room.name) / 1000;
			const energyToCreditMultiplier = this.getEnergyToCreditMultiplier();
			return order.price - transferCost * energyToCreditMultiplier;
		} else {
			return Infinity;
		}
	}

	// private getBestOrder(mineralType: ResourceConstant, type: 'buy' | 'sell'): Order | undefined {
	// 	let cachedOrder = this.memory.cache[type][mineralType];
	// 	if (cachedOrder) {
	// 		let order = Game.market.getOrderById(cachedOrder.id);
	// 		if (order) {
	// 			// Update the order in memory
	// 			this.memory.cache[type][mineralType] = order;
	// 		}
	// 	}
	// }

	private cleanUpInactiveOrders() {
		// Clean up sell orders that have expired or orders belonging to rooms no longer owned
		const ordersToClean = _.filter(Game.market.orders, o =>
			(o.type == ORDER_SELL && o.active == false && o.remainingAmount == 0)		// if order is expired, or
			|| (Game.time - o.created > TraderJoe.settings.market.orders.timeout		// order is old and almost done
				&& o.remainingAmount < TraderJoe.settings.market.orders.cleanupAmount)
			|| (o.roomName && !Overmind.colonies[o.roomName]));							// order placed from dead colony
		for (const order of ordersToClean) {
			Game.market.cancelOrder(order.id);
		}
	}

	/**
	 * Opportunistically sells resources when the buy price is higher than current market sell low price
	 */
	lookForGoodDeals(terminal: StructureTerminal, resource: ResourceConstant, margin?: number): void {
		if (Game.market.credits < TraderJoe.settings.market.reserveCredits) {
			return;
		}
		// Use dynamic margin based on stock level if not provided
		const effectiveMargin = margin !== undefined ? margin : this.getDealMargin(resource, terminal);
		let amount = 5000;
		if (resource === RESOURCE_POWER) {
			amount = 100;
		}
		let ordersForMineral = Game.market.getAllOrders({resourceType: resource, type: ORDER_BUY});
		ordersForMineral = _.filter(ordersForMineral, order => order.amount >= amount);
		if (ordersForMineral === undefined) {
			return;
		}
		const marketLow = this.memory.cache.sell[resource] ? this.memory.cache.sell[resource].low : undefined;
		if (marketLow == undefined) {
			return;
		}
		const order = maxBy(ordersForMineral, order => this.effectiveBuyPrice(order, terminal));
		if (order && order.price > marketLow * effectiveMargin) {
			const amount = Math.min(order.amount, 10000);
			const cost = Game.market.calcTransactionCost(amount, terminal.room.name, order.roomName!);
			if (terminal.store[RESOURCE_ENERGY] > cost) {
				const response = Game.market.deal(order.id, amount, terminal.room.name);
				this.logTransaction(order, terminal.room.name, amount, response);
			}
		}
	}

	/**
	 * Buy a resource on the market
	 */
	buy(terminal: StructureTerminal, resource: ResourceConstant, amount: number): void {
		if (Game.market.credits < TraderJoe.settings.market.reserveCredits || terminal.cooldown > 0) {
			return;
		}
		amount = Math.max(amount, TERMINAL_MIN_SEND);
		if (terminal.store[RESOURCE_ENERGY] < 10000 || terminal.storeCapacity - _.sum(terminal.store) < amount) {
			return;
		}
		let ordersForMineral = Game.market.getAllOrders({resourceType: resource, type: ORDER_SELL});
		ordersForMineral = _.filter(ordersForMineral, order => order.amount >= amount);
		const bestOrder = minBy(ordersForMineral, (order: Order) => order.price);
		let maxPrice = this.getMaxBuyPrice(resource);
		if (!onPublicServer()) {
			maxPrice = Infinity; // don't care about price limits if on private server
		}
		if (bestOrder && bestOrder.price <= maxPrice) {
			const response = Game.market.deal(bestOrder.id, amount, terminal.room.name);
			this.logTransaction(bestOrder, terminal.room.name, amount, response);
		}
	}

	/**
	 * Sell a resource on the market, either through a sell order or directly
	 */
	sell(terminal: StructureTerminal, resource: ResourceConstant, amount: number,
		 maxOrdersOfType = Infinity): number | undefined {
		if (Game.market.credits < TraderJoe.settings.market.reserveCredits) {
			return this.sellDirectly(terminal, resource, amount);
		} else {
			this.maintainSellOrder(terminal, resource, amount, maxOrdersOfType);
		}
	}

	/**
	 * Sell resources directly to a buyer rather than making a sell order
	 */
	sellDirectly(terminal: StructureTerminal, resource: ResourceConstant, amount: number,
				 flexibleAmount = true): number | undefined {
		// If flexibleAmount is allowed, consider selling to orders which don't need the full amount
		const minAmount = flexibleAmount ? TERMINAL_MIN_SEND : amount;
		let ordersForMineral = Game.market.getAllOrders({resourceType: resource, type: ORDER_BUY});
		ordersForMineral = _.filter(ordersForMineral, order => order.amount >= minAmount);
		const order = maxBy(ordersForMineral, order => this.effectiveBuyPrice(order, terminal));
		if (order) {
			const sellAmount = Math.min(order.amount, amount);
			const cost = Game.market.calcTransactionCost(sellAmount, terminal.room.name, order.roomName!);
			if (terminal.store[RESOURCE_ENERGY] > cost) {
				const response = Game.market.deal(order.id, sellAmount, terminal.room.name);
				this.logTransaction(order, terminal.room.name, amount, response);
				return response;
			}
		}
	}

	/**
	 * Create or maintain a buy order
	 */
	maintainBuyOrder(terminal: StructureTerminal, resource: ResourceConstant, amount: number,
					 maxOrdersOfType = Infinity): void {
		const marketHigh = this.memory.cache.buy[resource] ? this.memory.cache.buy[resource].high : undefined;
		if (!marketHigh) {
			return;
		}
		const maxPrice = maxMarketPrices[resource] || maxMarketPrices.default;
		if (marketHigh > maxPrice) {
			return;
		}

		const order = _.find(Game.market.orders,
							 o => o.type == ORDER_BUY &&
								  o.resourceType == resource &&
								  o.roomName == terminal.room.name);
		if (order) {

			if (order.price < marketHigh || (order.price > marketHigh && order.remainingAmount == 0)) {
				const ret = Game.market.changeOrderPrice(order.id, marketHigh);
				this.notify(`${terminal.room.print}: updating buy order price for ${resource} from ` +
							`${order.price} to ${marketHigh}. Response: ${ret}`);
			}
			if (order.remainingAmount < 2000) {
				const addAmount = (amount - order.remainingAmount);
				const ret = Game.market.extendOrder(order.id, addAmount);
				this.notify(`${terminal.room.print}: extending buy order for ${resource} by ${addAmount}.` +
							` Response: ${ret}`);
			}

		} else {

			const ordersOfType = _.filter(Game.market.orders, o => o.type == ORDER_BUY && o.resourceType == resource);
			if (ordersOfType.length < maxOrdersOfType) {
				const ret = Game.market.createOrder(ORDER_BUY, resource, marketHigh, amount, terminal.room.name);
				this.notify(`${terminal.room.print}: creating buy order for ${resource} at price ${marketHigh}. ` +
							`Response: ${ret}`);
			}
			// else {
			// 	this.notify(`${terminal.room.print}: cannot create another buy order for ${resource}:` +
			// 				` too many (${ordersOfType.length})`);
			// }

		}
	}

	/**
	 * Create or maintain a sell order
	 */
	private maintainSellOrder(terminal: StructureTerminal, resource: ResourceConstant, amount: number,
							  maxOrdersOfType = Infinity): void {
		const marketLow = this.memory.cache.sell[resource] ? this.memory.cache.sell[resource].low : undefined;
		if (!marketLow) {
			return;
		}
		const order = _.find(Game.market.orders,
							 o => o.type == ORDER_SELL &&
								  o.resourceType == resource &&
								  o.roomName == terminal.room.name);
		if (order) {

			if (order.price > marketLow || (order.price < marketLow && order.remainingAmount == 0)) {
				const ret = Game.market.changeOrderPrice(order.id, marketLow);
				this.notify(`${terminal.room.print}: updating sell order price for ${resource} from ` +
							`${order.price} to ${marketLow}. Response: ${ret}`);
			}
			if (order.remainingAmount < 2000) {
				const addAmount = (amount - order.remainingAmount);
				const ret = Game.market.extendOrder(order.id, addAmount);
				this.notify(`${terminal.room.print}: extending sell order for ${resource} by ${addAmount}.` +
							` Response: ${ret}`);
			}

		} else {

			const ordersOfType = _.filter(Game.market.orders, o => o.type == ORDER_SELL && o.resourceType == resource);
			if (ordersOfType.length < maxOrdersOfType) {
				const ret = Game.market.createOrder(ORDER_SELL, resource, marketLow, amount, terminal.room.name);
				this.notify(`${terminal.room.print}: creating sell order for ${resource} at price ${marketLow}. ` +
							`Response: ${ret}`);
			}
			// else {
			// 	this.notify(`${terminal.room.print}: cannot create another sell order for ${resource}:` +
			// 				` too many (${ordersOfType.length})`);
			// }

		}
	}

	priceOf(mineralType: ResourceConstant): number {
		if (this.memory.cache.sell[mineralType]) {
			return this.memory.cache.sell[mineralType].low;
		} else {
			return Infinity;
		}
	}

	/**
	 * Get dynamic max buy price based on current market data
	 */
	private getMaxBuyPrice(resource: ResourceConstant): number {
		const cacheEntry = this.memory.cache.sell[resource];
		const marketPrice = cacheEntry ? cacheEntry.low : undefined;
		if (marketPrice && marketPrice !== Infinity && marketPrice > 0) {
			return marketPrice * 1.5; // Allow up to 50% above market low price
		}
		return maxMarketPrices[resource] || maxMarketPrices.default; // Fallback to hardcoded defaults
	}

	/**
	 * Get real-time energy to credit multiplier based on market data
	 */
	private getEnergyToCreditMultiplier(): number {
		const energyCacheEntry = this.memory.cache.sell[RESOURCE_ENERGY];
		const energyPrice = energyCacheEntry ? energyCacheEntry.low : undefined;
		// Use real-time price if available and reasonable, otherwise use conservative default
		if (energyPrice && energyPrice !== Infinity && energyPrice > 0 && energyPrice < 1) {
			return energyPrice;
		}
		return 0.01; // Conservative default
	}

	/**
	 * Get dynamic margin for deals based on current stock level
	 */
	private getDealMargin(resource: ResourceConstant, terminal: StructureTerminal): number {
		const stock = terminal.store[resource] || 0;
		if (stock > 50000) return 1.1;  // High stock - lower margin to sell faster
		if (stock > 25000) return 1.2;  // Medium stock
		return 1.25;  // Low stock - higher margin for better profits
	}

	/**
	 * Look for arbitrage opportunities where buy orders are higher than sell orders
	 * Buy from cheap sell order, sell to expensive buy order
	 */
	lookForArbitrageOpportunities(terminal: StructureTerminal): void {
		if (terminal.cooldown > 0) return;
		if (Game.market.credits < TraderJoe.settings.market.reserveCredits * 2) return;

		// Only check arbitrage occasionally to save CPU
		if (Game.time % 50 !== 0) return;

		for (const resourceType in this.memory.cache.sell) {
			const resource = resourceType as ResourceConstant;
			const sellEntry = this.memory.cache.sell[resource];
			const buyEntry = this.memory.cache.buy[resource];
			const sellLow = sellEntry ? sellEntry.low : undefined;
			const buyHigh = buyEntry ? buyEntry.high : undefined;

			if (!sellLow || !buyHigh || sellLow === Infinity || buyHigh === 0) continue;

			// Check if there's a profitable spread (buy price > sell price + costs)
			const minProfitMargin = 0.1; // 10% minimum profit
			if (buyHigh > sellLow * (1 + minProfitMargin)) {
				// Found arbitrage opportunity!
				const amount = 1000; // Small test amount

				// Find the actual orders
				const sellOrders = Game.market.getAllOrders({resourceType: resource, type: ORDER_SELL});
				const buyOrders = Game.market.getAllOrders({resourceType: resource, type: ORDER_BUY});

				const bestSellOrder = minBy(sellOrders, o => this.effectivePrice(o, terminal));
				const bestBuyOrder = maxBy(buyOrders, o => this.effectiveBuyPrice(o, terminal));

				if (!bestSellOrder || !bestBuyOrder) continue;

				// Calculate total costs
				const buyCost = bestSellOrder.price * amount;
				const sellRevenue = bestBuyOrder.price * amount;
				const transferCostBuy = bestSellOrder.roomName ?
					Game.market.calcTransactionCost(amount, bestSellOrder.roomName, terminal.room.name) : 0;
				const transferCostSell = bestBuyOrder.roomName ?
					Game.market.calcTransactionCost(amount, terminal.room.name, bestBuyOrder.roomName) : 0;

				const energyCost = (transferCostBuy + transferCostSell) * this.getEnergyToCreditMultiplier();
				const profit = sellRevenue - buyCost - energyCost;

				if (profit > 0 && terminal.store[RESOURCE_ENERGY] > transferCostBuy + transferCostSell + 1000) {
					// Execute arbitrage: buy from sell order
					const response = Game.market.deal(bestSellOrder.id, amount, terminal.room.name);
					if (response === OK) {
						this.notify(`Arbitrage ${resource}: bought at ${bestSellOrder.price}, will sell at ${bestBuyOrder.price}, profit: ${profit.toFixed(2)}`);
					}
					return; // One arbitrage per tick
				}
			}
		}
	}

	/**
	 * Pretty-prints transaction information in the console
	 */
	private logTransaction(order: Order, terminalRoomName: string, amount: number, response: number): void {
		const action = order.type == ORDER_SELL ? 'BOUGHT ' : 'SOLD   ';
		const cost = (order.price * amount).toFixed(2);
		const fee = order.roomName ? Game.market.calcTransactionCost(amount, order.roomName, terminalRoomName) : 0;
		const roomName = Game.rooms[terminalRoomName] ? Game.rooms[terminalRoomName].print : terminalRoomName;
		let msg: string;
		if (order.type == ORDER_SELL) {
			msg = `${roomName} ${leftArrow} ${amount} ${order.resourceType} ${leftArrow} ` +
				  `${printRoomName(order.roomName!)} (result: ${response})`;
		} else {
			msg = `${roomName} ${rightArrow} ${amount} ${order.resourceType} ${rightArrow} ` +
				  `${printRoomName(order.roomName!)} (result: ${response})`;
		}
		this.notify(msg);
	}

	/**
	 * Look through transactions happening on the previous tick and record stats
	 */
	private recordStats(): void {
		this.stats.credits = Game.market.credits;
		const time = Game.time - 1;
		// Incoming transactions
		for (const transaction of Game.market.incomingTransactions) {
			if (transaction.time < time) {
				break; // only look at things from last tick
			} else {
				if (transaction.order) {
					const resourceType = transaction.resourceType;
					const amount = transaction.amount;
					const price = transaction.order.price;
					if (!this.stats.bought[resourceType]) {
						this.stats.bought[resourceType] = {amount: 0, credits: 0};
					}
					this.stats.bought[resourceType].amount += amount;
					this.stats.bought[resourceType].credits += amount * price;
				}
			}
		}
		// Outgoing transactions
		for (const transaction of Game.market.outgoingTransactions) {
			if (transaction.time < time) {
				break; // only look at things from last tick
			} else {
				if (transaction.order) {
					const resourceType = transaction.resourceType;
					const amount = transaction.amount;
					const price = transaction.order.price;
					if (!this.stats.sold[resourceType]) {
						this.stats.sold[resourceType] = {amount: 0, credits: 0};
					}
					this.stats.sold[resourceType].amount += amount;
					this.stats.sold[resourceType].credits += amount * price;
				}
			}
		}
	}


	init(): void {
		const cacheTimeout = CpuBudgetManager.getCacheTimeout();
		if (Game.time - (this.memory.cache.tick || 0) > cacheTimeout) {
			this.buildMarketCache();
		}
	}

	run(): void {
		if (Game.time % 10 == 0) {
			this.cleanUpInactiveOrders();
		}
		if (this.notifications.length > 0) {
			log.info(`Trade network activity: ` + alignedNewline + this.notifications.join(alignedNewline));
		}
		this.recordStats();
	}

}
