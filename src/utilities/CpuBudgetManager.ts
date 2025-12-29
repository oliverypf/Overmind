/**
 * CPU Budget Manager - Dynamic CPU utilization based on bucket level
 *
 * This manager helps optimize CPU usage by:
 * - Enabling optional tasks when bucket is high
 * - Throttling OPTIONAL operations when bucket is low
 * - NEVER stopping core operations (mining, repair, upgrade controller)
 *
 * IMPORTANT: This only affects optional tasks. Core colony operations
 * always run to prevent building decay and controller downgrade.
 */

export type BudgetLevel = 'critical' | 'low' | 'normal' | 'high' | 'full';

export class CpuBudgetManager {

	/**
	 * Get current budget level based on CPU bucket
	 * Thresholds are set conservatively to keep colonies running
	 */
	static getBudgetLevel(): BudgetLevel {
		const bucket = Game.cpu.bucket;
		if (bucket < 1000) return 'critical';
		if (bucket < 3000) return 'low';
		if (bucket < 6000) return 'normal';
		if (bucket < 8500) return 'high';
		return 'full';
	}

	/**
	 * Check if we should run an optional task based on current budget
	 * Even at low bucket, we allow some optional tasks to run occasionally
	 * @param taskCost - Estimated CPU cost of the task (optional, for future use)
	 */
	static shouldRunOptionalTask(taskCost?: number): boolean {
		const level = this.getBudgetLevel();
		const used = Game.cpu.getUsed();
		const limit = Game.cpu.limit;

		switch (level) {
			case 'full':
				return used < limit * 1.5;  // Can exceed limit when bucket is full
			case 'high':
				return used < limit * 0.95;
			case 'normal':
				return used < limit * 0.85;
			case 'low':
				return used < limit * 0.7;  // Still allow some optional tasks
			case 'critical':
				return used < limit * 0.5 && Game.time % 5 === 0;  // Run occasionally
		}
	}

	/**
	 * Get dynamic cache timeout based on CPU budget
	 * Higher budget = more frequent cache refreshes
	 */
	static getCacheTimeout(): number {
		const level = this.getBudgetLevel();
		switch (level) {
			case 'full': return 10;
			case 'high': return 20;
			case 'normal': return 25;
			case 'low': return 50;
			case 'critical': return 100;
		}
	}

	/**
	 * Get dynamic mining range based on CPU budget
	 * Higher budget = can manage more distant remote mining
	 */
	static getMiningRange(): number {
		const level = this.getBudgetLevel();
		switch (level) {
			case 'full': return 5;
			case 'high': return 4;
			case 'normal': return 3;
			default: return 2;
		}
	}

	/**
	 * Get pathfinding ops limit based on CPU budget
	 * Higher budget = more thorough path search
	 */
	static getPathOps(): number {
		const level = this.getBudgetLevel();
		switch (level) {
			case 'full': return 10000;
			case 'high': return 5000;
			case 'normal': return 2000;
			default: return 1000;
		}
	}

	/**
	 * Check if visuals should be rendered based on CPU budget
	 * Only skip visuals at critical level - they're useful for debugging
	 */
	static shouldRenderVisuals(): boolean {
		const level = this.getBudgetLevel();
		if (level === 'critical') return false;
		if (level === 'low') return Game.time % 3 === 0;  // Render every 3 ticks
		return true;
	}

	/**
	 * Get the maximum number of colonies we can support based on CPU limit
	 * Estimated at 2.5 CPU per colony + 10 CPU overhead
	 */
	static get maxColonies(): number {
		const cpuPerColony = 2.5;
		const overhead = 10;
		return Math.floor(Math.max(0, Game.cpu.limit - overhead) / cpuPerColony);
	}
}
