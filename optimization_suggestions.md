# Overmind AI 优化建议

## 优先级总结

| 优先级 | 优化项 | 位置 | 收益 | 状态 |
|--------|--------|------|------|------|
| 🔴 高 | **generatePixel() 转换多余 CPU** | main.ts:75-77 | 直接产生 Pixel 收入 | ✅ 已实现 |
| 🔴 高 | maxMarketPrices 动态化 | TradeNetwork.ts:388-394 | 避免被过时价格卡住 | ✅ 已实现 |
| 🔴 高 | energyToCreditMultiplier 实时化 | TradeNetwork.ts:396-406 | 选择最优交易订单 | ✅ 已实现 |
| 🟡 中 | lookForGoodDeals 动态 margin | TradeNetwork.ts:411-419 | 加速资金周转 | ✅ 已实现 |
| 🟡 中 | 均衡考虑运输成本 | TerminalNetwork.ts:216-260 | 减少能量浪费 | ✅ 已实现 |
| 🟡 中 | CPU budget 分级管理 | CpuBudgetManager.ts | 动态调整工作量 | ✅ 已实现 |
| 🟢 低 | 缓存刷新策略优化 | TradeNetwork.ts:533-537 | 节省 CPU | ✅ 已实现 |
| 🟢 低 | 套利机会检测 | TradeNetwork.ts:421-475 | 额外利润 | ✅ 已实现 |
| 🟢 低 | 可视化按需渲染 | main.ts:69-72 | 节省 CPU | ✅ 已实现 |
| 🔴 高 | Factory 系统 | factoryCluster.ts (新文件) | 商品收入 | ✅ 已实现 |
| 🔴 高 | PowerCreep 系统 | PowerCreepManager.ts (新文件) | 房间增益 | ✅ 已实现 |

### 战斗系统优化

| 优先级 | 优化项 | 状态 |
|--------|--------|------|
| P0 | avoid 数组 bug | ✅ 已修复 |
| P1 | 动态防御单位数量 | ✅ 已实现 |
| P1 | 降低 bunker 防御触发阈值 | ✅ 已实现 |
| P2 | 增强 hydralisk 配置 | ✅ 已实现 |
| P2 | Duo 编队 (ranged + healer) | ✅ 已实现 |
| P3 | Quad 战术用于防御 | ✅ 已实现 |
| P3 | 塔楼引导逻辑 | ✅ 已实现 |
| P3 | 预警系统 | ✅ 已实现 |

### 进攻系统优化

| 优先级 | 优化项 | 状态 |
|--------|--------|------|
| 🔴 高 | AutoSiege 空壳未实现 | ✅ 已实现 |
| 🔴 高 | CombatPlanner 核心功能 | ✅ 已实现 |
| 🟡 中 | SwarmDestroyer 恢复远程编队 | ✅ 已实现 |
| 🟡 中 | 目标选择战术优化 | ✅ 已实现 |
| 🟡 中 | 进攻前侦察阶段 | ✅ 已实现 (AutoSiege) |
| 🟡 中 | Drain 战术 | ✅ 已实现 |
| 🟢 低 | 动态撤退阈值 | ✅ 已实现 |
| 🟢 低 | 多 Swarm 协调 | ✅ 已实现 |

### 缺失功能实现状态

| 优先级 | 功能 | 类别 | 状态 |
|--------|------|------|------|
| 🔴 高 | AutoSiege | 进攻 | ✅ 已实现 |
| 🔴 高 | Drain 战术 | 进攻 | ✅ 已实现 |
| 🟡 中 | 外交系统 | 外交 | ✅ 已实现 |
| 🟡 中 | Highway 资源采集 | 经济 | ✅ 已实现 |
| 🟡 中 | 破墙编队 (WallBreaker) | 进攻 | ✅ 已实现 |
| 🟡 中 | 多 Shard 协调 | 经济 | ✅ 已实现 |
| 🟡 中 | SafeMode 自动触发增强 | 防御 | ✅ 已实现 |
| 🟡 中 | 动态 boost 策略 | 防御 | ✅ 已实现 |
| 🟡 中 | 能量危机应对 | 经济 | ✅ 已实现 |
| 🟢 低 | 预警系统 | 防御 | ✅ 已实现 |
| 🟢 低 | 入侵预测 | 防御 | ✅ 已实现 |

---

## 4. CPU 最大化利用

### 4.1 未使用 generatePixel() 将多余 CPU 转换为 Pixel

**问题**: 当 bucket 满 (10000) 时，多余的 CPU 被浪费。Screeps 提供了 `Game.cpu.generatePixel()` 可以将 bucket 中的 CPU 转换为 Pixel 资源。

**影响**: Pixel 可以在市场上出售换取 credits，直接损失收入。

**建议**: 在 `main.ts` 的主循环末尾添加：
```typescript
// 在 Stats.run() 之后添加
if (Game.cpu.bucket >= 10000) {
    Game.cpu.generatePixel();
}
```

或更保守的策略（保留一些 bucket 余量）：
```typescript
if (Game.cpu.bucket >= 9500 && Game.cpu.bucket === 10000) {
    Game.cpu.generatePixel();
}
```

### 4.2 bucket 高时未充分利用 CPU

**现状**: 代码只在 bucket 低时采取行动（暂停操作、清理缓存），但 bucket 高时没有做更多工作。

**核心问题**: 购买的 CPU 不应该只是换成 Pixel，而应该用来**做更多有价值的事情**！

**CPU 利用优先级** (从高到低):

| 优先级 | 用途 | 收益 |
|--------|------|------|
| 1 | 运行更多殖民地 | GCL/GPL 增长 |
| 2 | 更激进的远程采矿 | 资源收入 |
| 3 | Highway 资源巡逻 | Power/Deposit |
| 4 | 更复杂的计算 | 效率提升 |
| 5 | generatePixel() | Pixel 收入 |

**优化机会**: 当 bucket 充裕时，可以执行更多"可选"的 CPU 密集型任务：

```typescript
// 在 Memory.ts 或单独的 CpuManager 中
export class CpuBudgetManager {
    static getBudgetLevel(): 'critical' | 'low' | 'normal' | 'high' | 'full' {
        const bucket = Game.cpu.bucket;
        if (bucket < 1000) return 'critical';
        if (bucket < 4000) return 'low';
        if (bucket < 7000) return 'normal';
        if (bucket < 9500) return 'high';
        return 'full';
    }

    // 根据 budget 决定是否执行可选任务
    static shouldRunOptionalTask(taskCost: number): boolean {
        const level = this.getBudgetLevel();
        const used = Game.cpu.getUsed();
        const limit = Game.cpu.limit;

        switch (level) {
            case 'full':
                return used < limit * 1.5;  // 可以超限使用
            case 'high':
                return used < limit * 0.9;
            case 'normal':
                return used < limit * 0.7;
            default:
                return false;
        }
    }
}
```

**根据 budget 级别可以动态启用/禁用的功能**:

| Budget | 可执行的额外操作 |
|--------|-----------------|
| full   | generatePixel(), 完整房间规划, 路径预计算, Highway 巡逻 |
| high   | 更频繁的市场缓存刷新, 更多侦察, 远程采矿扩展 |
| normal | 正常操作 |
| low    | 减少视觉效果, 延长缓存时间, 减少远程操作 |
| critical | 暂停非必要操作 |

### 4.2.1 CPU 充裕时可以做的额外工作

**1. 扩展远程采矿范围**
```typescript
// 当 CPU 充裕时，采矿范围可以更远
private getMiningRange(): number {
    const level = CpuBudgetManager.getBudgetLevel();
    switch (level) {
        case 'full': return 5;   // 5 房间距离
        case 'high': return 4;
        case 'normal': return 3;
        default: return 2;
    }
}
```

**2. Highway 资源巡逻**
```typescript
// CPU 充裕时自动巡逻 Highway 寻找 Power Bank 和 Deposit
if (CpuBudgetManager.getBudgetLevel() === 'full') {
    this.patrolHighways();
}
```

**3. 更频繁的市场分析**
```typescript
// 缓存时间根据 CPU 调整
private getCacheTimeout(): number {
    const level = CpuBudgetManager.getBudgetLevel();
    if (level === 'full') return 5;    // 5 tick 刷新一次
    if (level === 'high') return 15;
    if (level === 'normal') return 25;
    return 50;
}
```

**4. 更深的路径搜索**
```typescript
// CPU 充裕时可以搜索更优路径
private getPathOps(): number {
    const level = CpuBudgetManager.getBudgetLevel();
    if (level === 'full') return 10000;
    if (level === 'high') return 5000;
    return 2000;
}
```

**5. 预计算常用路径**
```typescript
// 空闲时预热路径缓存
if (CpuBudgetManager.getBudgetLevel() === 'full') {
    this.precomputeFrequentPaths();
}
```

**6. 最后才是 generatePixel()**
```typescript
// 只有真正用不完的 CPU 才转成 Pixel
if (Game.cpu.bucket === 10000 && Game.cpu.getUsed() < Game.cpu.limit * 0.5) {
    Game.cpu.generatePixel();
}
```

### 4.3 市场缓存可根据 CPU 动态调整 (与 2.4 相关)

**建议**: 将 `TradeNetwork.ts` 的缓存超时与 CPU budget 联动：
```typescript
private getCacheTimeout(): number {
    const bucket = Game.cpu.bucket;
    if (bucket > 9000) return 10;   // bucket 高，更频繁刷新
    if (bucket > 7000) return 25;   // 正常
    if (bucket > 4000) return 50;   // bucket 低，减少刷新
    return 100;                      // 危急时极少刷新
}
```

### 4.4 可视化功能消耗 CPU 但无实际收益

**现状** (`~settings.ts:201`): `enableVisuals: true` 默认开启。

**问题**: `Overmind.visuals()` 每 tick 运行，消耗 CPU 但只在有人观看时有用。

**建议**: 根据 bucket 级别或是否有人观看来决定是否渲染：
```typescript
// 只在 bucket 充裕且有人查看时渲染
if (Game.cpu.bucket > 8000 || Game.rooms['你的房间名'].find(FIND_MY_CREEPS).length === 0) {
    Overmind.visuals();
}
```

或添加配置选项：
```typescript
// Memory.settings
visualsMode: 'always' | 'highCpu' | 'never'
```

---

## 1. 采矿效率 (`src/creepSetups/setups.ts`)

**分析结论**:
标准矿工配置为 6 个 WORK 部件，虽然理论上 5 个 WORK 部件足以饱和开采一个 Source，但多出的 1 个 WORK 部件是为了增加矿工的健壮性。即使矿工受到轻微伤害，损失了一个 WORK 部件，仍能保持 100% 的采矿效率。

---

## 2. 交易系统优化 (`src/logistics/TradeNetwork.ts`)

### 2.1 maxMarketPrices 严重过时 (第50-62行)

**问题**: 注释明确写着 "based on shard2 market data in June 2018"。这些价格限制已有7年历史，与当前市场严重脱节。

**影响**:
- 价格上涨的资源：即使市场价格合理也无法购买，导致生产瓶颈
- 价格下跌的资源：可能以过高的价格购买

**建议**: 删除硬编码价格限制，改用动态策略：
```typescript
// 使用市场缓存中的实时价格作为参考，设定合理倍数
private getMaxBuyPrice(resource: ResourceConstant): number {
    const marketPrice = this.memory.cache.sell[resource]?.low;
    if (marketPrice && marketPrice !== Infinity) {
        return marketPrice * 1.5; // 最多比市场低价高 50%
    }
    return maxMarketPrices[resource] || maxMarketPrices.default; // 回退到默认值
}
```

### 2.2 effectivePrice 能量成本计算不准确 (第155、168行)

**问题**: `energyToCreditMultiplier = 0.01` 是硬编码值，不反映能量真实市场价值。

**影响**: 长距离交易的实际利润评估失真，可能导致选择了更差的交易订单。

**建议**:
```typescript
private getEnergyMultiplier(): number {
    const energyPrice = this.memory.cache.sell[RESOURCE_ENERGY]?.low;
    // 如果缓存有值且不是 Infinity，使用实时价格；否则使用保守默认值
    return (energyPrice && energyPrice < 1) ? energyPrice : 0.01;
}
```

### 2.3 lookForGoodDeals margin 过于死板 (第201行)

**问题**: 固定使用 25% margin，没有考虑：
- 不同资源的波动性不同
- 市场供需状况变化

**建议**: 根据资源类型和库存情况动态调整 margin：
```typescript
private getDealMargin(resource: ResourceConstant, terminal: StructureTerminal): number {
    const stock = terminal.store[resource] || 0;
    if (stock > 50000) return 1.1;  // 库存高，降低 margin 加速出货
    if (stock > 25000) return 1.2;
    return 1.3;  // 库存低，提高 margin 确保利润
}
```

### 2.4 缓存刷新策略可优化 (第77行)

**现状**: `cache.timeout = 25` ticks 固定刷新。

**问题**:
- 市场活跃时，25 ticks 可能太长
- 市场平静时，频繁刷新浪费 CPU

**建议**: 根据交易频率动态调整：
- 刚完成交易后：缩短刷新间隔（如 10 ticks）
- 长时间无交易：延长刷新间隔（如 50 ticks）

### 2.5 缺少套利机会检测

**现状**: `lookForGoodDeals` 只比较买单价格和市场卖价低点。

**优化机会**: 同时检测是否存在价差套利：
- 买入订单 A 价格 > 卖出订单 B 价格 + 运输成本
- 可以从 B 购买并卖给 A 赚取差价

---

## 3. 资源均衡优化 (`src/logistics/TerminalNetwork.ts`)

### 3.1 均衡频率可能过高 (第77行)

**现状**: `frequency = 2 * (TERMINAL_COOLDOWN + 1) = 22` ticks。

**问题**: 如果殖民地数量多，每次均衡只能处理部分配对，但均衡计算每 22 ticks 运行一次，即使资源已经基本平衡。

**建议**: 在资源差异小于 tolerance 时，跳过该资源的均衡周期。

### 3.2 运输成本未纳入均衡决策

**现状**: `equalize()` 选择发送方和接收方时，没有考虑房间距离产生的运输成本。

**问题**: 可能选择了距离很远的配对，消耗大量能量运输。

**建议**: 加入运输成本权重：
```typescript
// 在选择配对时，考虑运输成本
const effectiveDeficit = receiverDeficit -
    Game.market.calcTransactionCost(receiverDeficit, sender.room.name, receiver.room.name) * 0.5;
```

---

## 5. 战斗系统优化

### 实现状态总结

| 优先级 | 优化项 | 状态 | 位置 |
|--------|--------|------|------|
| P0 | avoid 数组 bug | ✅ 已修复 | CombatZerg.ts:270 |
| P1 | 动态防御单位数量 | ✅ 已实现 | bunkerDefense.ts:50-51 |
| P1 | 降低 bunker 防御触发阈值 | ✅ 已实现 | invasionDefense.ts:58 |
| P2 | 增强 hydralisk 配置 | ✅ 已实现 | setups.ts:233-236 |
| P2 | Duo 编队 (ranged + healer) | ✅ 已实现 | rangedDefense.ts |
| P3 | Quad 战术 (2x2 编队) | ⚠️ 部分实现 | Swarm.ts (仅进攻) |
| P3 | 塔楼引导逻辑 | ❌ 未实现 | - |
| P3 | 预警系统 | ❌ 未实现 | - |

### 5.1 未完成: 塔楼引导逻辑

**现状**: `CombatIntel.towerDamageAtPos()` 可计算塔伤害，但没有主动引导敌人的逻辑。

**建议实现**:
```typescript
// 在 CombatZerg.ts 或新建 TowerKiting.ts
/**
 * 将敌人引导到塔楼最佳伤害范围 (5格内)
 */
lureToTowerRange(towers: StructureTower[], hostiles: Creep[]): void {
    // 1. 找到塔楼覆盖最佳的位置
    const optimalPositions = this.room.openPositions.filter(pos => {
        const avgDistance = _.sum(towers, t => pos.getRangeTo(t)) / towers.length;
        return avgDistance <= 5; // 塔楼最大伤害范围
    });

    // 2. 在该位置附近徘徊，吸引敌人追击
    const bestPos = _.min(optimalPositions, pos =>
        _.sum(hostiles, h => pos.getRangeTo(h))
    );

    // 3. 保持在敌人射程边缘
    if (this.pos.getRangeTo(bestPos) > 1) {
        this.goTo(bestPos);
    } else {
        this.kite(hostiles, {range: 3});
    }
}
```

### 5.2 未完成: 预警系统

**现状**: 没有监控相邻房间敌对活动的代码。

**建议实现**:
```typescript
// 新建 src/intel/EarlyWarning.ts
export class EarlyWarningSystem {

    static settings = {
        scanInterval: 10,         // 每 10 tick 扫描一次
        warningThreshold: 3,      // 发现 3+ 敌对单位触发警报
    };

    /**
     * 扫描相邻房间的敌对活动
     */
    static scanAdjacentRooms(colony: Colony): void {
        const adjacentRooms = _.values(Game.map.describeExits(colony.room.name));

        for (const roomName of adjacentRooms) {
            const room = Game.rooms[roomName];
            if (!room) continue; // 没有视野

            const hostiles = room.hostiles.filter(h =>
                !h.owner.username.includes('Invader') && // 排除 NPC
                h.owner.username !== 'Source Keeper'
            );

            if (hostiles.length >= this.settings.warningThreshold) {
                this.triggerWarning(colony, roomName, hostiles);
            }
        }
    }

    /**
     * 触发预警
     */
    static triggerWarning(colony: Colony, roomName: string, hostiles: Creep[]): void {
        log.alert(`⚠️ ${colony.print}: ${hostiles.length} hostiles detected in ${roomName}!`);

        // 预先生成防御单位
        // 提前激活 safeMode 准备
        // 将 creep 撤回安全区域
    }
}
```

**调用位置**: 在 `Overmind.run()` 或 Colony 的 run 阶段调用。

### 5.3 未完成: Quad 战术用于防御

**现状**: `Swarm.ts` 存在完整的 2x2 编队系统，但主要用于进攻 (`swarmDestroyer`)。

**建议**: 复用 Swarm 逻辑创建防御版本：
```typescript
// 新建 overlords/defense/swarmDefense.ts
export class SwarmDefenseOverlord extends CombatOverlord {
    swarm: Swarm;

    // 复用 Swarm 的移动和战斗逻辑
    // 但目标是保护 colony 而非攻击
}
```

---

## 6. 进攻系统优化

### 现状总结

| 功能 | 状态 | 位置 |
|------|------|------|
| PairDestroyer (双人进攻) | ✅ 可用 | pairDestroyer.ts |
| SwarmDestroyer (Quad进攻) | ⚠️ 部分可用 | swarmDestroyer.ts |
| ControllerAttacker | ✅ 可用 | controllerAttacker.ts |
| AutoSiege (自动围攻) | ❌ 空壳 | autoSiege.ts |
| CombatPlanner | ⚠️ 未完成 | CombatPlanner.ts |

### 6.1 AutoSiege 指令是空壳

**问题**: `autoSiege.ts:35-37` 的 `spawnMoarOverlords()` 被完全注释掉，功能不可用。

```typescript
spawnMoarOverlords() {
    // this.overlords.destroy = new SwarmDestroyerOverlord(this);  // 被注释
}
```

**建议**: 完成 AutoSiege 实现，根据 `siegeAnalysis` 自动选择攻击策略：
```typescript
spawnMoarOverlords() {
    if (!this.memory.siegeAnalysis) return;

    const analysis = this.memory.siegeAnalysis;

    // 根据房间布局选择攻击策略
    if (analysis.roomLayout === 'exposed') {
        // 暴露布局：使用 Pair 快速打击
        this.overlords.destroy = new PairDestroyerOverlord(this);
    } else if (analysis.minBarrierHits < 1000000) {
        // 低血墙：使用 Swarm 突破
        this.overlords.destroy = new SwarmDestroyerOverlord(this);
    } else {
        // 高血墙：需要 dismantler 编队
        // TODO: 实现 DismantlerOverlord
    }
}
```

### 6.2 SwarmDestroyer 的 Hydralisk 被禁用

**问题**: `swarmDestroyer.ts:48-51` 远程攻击编队被注释掉。

**影响**: Swarm 只有近战单位，缺乏远程火力支援。

**建议**: 启用 hydralisk 编队，或创建混合 Swarm：
```typescript
// 恢复 hydralisk
this.hydralisks = this.combatZerg(Roles.ranged, {
    notifyWhenAttacked: false,
    boostWishlist: [boostResources.ranged_attack[3], boostResources.tough[3], boostResources.move[3]]
});

// 混合编队配置
const swarmConfig = [
    {setup: zerglingSetup, amount: 1, priority: zerglingPriority},
    {setup: healerSetup, amount: 2, priority: healerPriority},
    {setup: hydraliskSetup, amount: 1, priority: hydraliskPriority}  // 加入远程
];
```

### 6.3 CombatPlanner 核心功能未实现

**问题**: `CombatPlanner.ts:99-102` 和 `109-131` 多处标记 TODO。

```typescript
private static computeHitsToSpawn(room: Room): number {
    // TODO
    return 0;  // 始终返回 0，无法计算需要的兵力
}
```

**建议**: 实现兵力计算：
```typescript
private static computeHitsToSpawn(room: Room): number {
    const enemyPotentials = CombatIntel.getCombatPotentials(room.hostiles);
    const towerDamage = CombatIntel.towerDamageAtPos(room.spawns[0]?.pos || room.controller?.pos);

    // 需要的 DPS = 敌人治疗量 + 安全余量
    const neededDPS = enemyPotentials.heal * 1.5;
    // 需要的 HPS = 敌人伤害 + 塔伤害
    const neededHPS = (enemyPotentials.attack + enemyPotentials.rangedAttack + towerDamage) * 1.2;

    return Math.ceil(neededDPS / RANGED_ATTACK_POWER) + Math.ceil(neededHPS / HEAL_POWER);
}
```

### 6.4 目标选择未考虑战术因素

**问题**: `CombatTargeting.ts` 选择目标时没有考虑：
- 正在治疗的敌人优先级
- 敌人 creep 的位置（避免被包围）
- 多目标集火效率

**建议**: 增强目标评分：
```typescript
static findTarget(zerg: Zerg, targets = zerg.room.hostiles): Creep | undefined {
    return maxBy(targets, function(hostile) {
        let score = hostile.hitsMax - hostile.hits;

        // 优先攻击治疗者
        if (hostile.getActiveBodyparts(HEAL) > 0) {
            score += 500;
        }

        // 优先攻击正在被治疗的目标（集火）
        const nearbyHealers = _.filter(targets, h =>
            h.getActiveBodyparts(HEAL) > 0 && h.pos.inRangeTo(hostile, 3)
        );
        if (nearbyHealers.length > 0) {
            score += 300 * nearbyHealers.length;
        }

        // 低血量目标加分（容易击杀）
        if (hostile.hits < hostile.hitsMax * 0.3) {
            score += 400;
        }

        return score - 10 * zerg.pos.getMultiRoomRangeTo(hostile.pos);
    });
}
```

### 6.5 缺少进攻前侦察

**问题**: 进攻指令直接派兵，没有先侦察敌人防御。

**建议**: 添加侦察阶段：
```typescript
// 在进攻 overlord 中添加
private scoutPhase(): boolean {
    if (!this.room) {
        // 请求 observer 观察
        if (this.colony.commandCenter?.observer) {
            this.colony.commandCenter.requestRoomObservation(this.pos.roomName);
        }
        return false; // 还在侦察
    }

    // 更新 siege analysis
    if (!this.memory.siegeAnalysis || Game.time > this.memory.siegeAnalysis.expiration) {
        this.memory.siegeAnalysis = CombatPlanner.getSiegeAnalysis(this.room);
    }

    return true; // 侦察完成
}
```

### 6.6 撤退条件过于简单

**现状**: 固定 `retreatHitsPercent = 0.85`。

**问题**: 不考虑敌人火力，可能过早或过晚撤退。

**建议**: 动态撤退阈值：
```typescript
private getRetreatThreshold(creep: CombatZerg): number {
    const incomingDamage = CombatIntel.getIncomingDamage(creep);
    const healingCapacity = CombatIntel.getHealPotential(creep.creep);

    // 如果伤害 > 治疗，提前撤退
    if (incomingDamage > healingCapacity * 1.5) {
        return 0.9; // 90% 血量就撤
    } else if (incomingDamage > healingCapacity) {
        return 0.85;
    } else {
        return 0.7; // 可以打得更激进
    }
}
```

### 6.7 多 Swarm 缺乏协调

**现状**: 每个 Swarm 独立作战。

**建议**: 添加协调逻辑：
```typescript
private coordinateSwarms(swarms: Swarm[]): void {
    if (swarms.length < 2) return;

    // 策略1: 同时进攻 (钳形攻势)
    const allReady = _.all(swarms, s => s.memory.initialAssembly);
    if (!allReady) {
        // 等待所有 swarm 就位
        return;
    }

    // 策略2: 分散敌人注意力
    const targets = _.unique(_.compact(_.map(swarms, s => s.target)));
    if (targets.length < swarms.length) {
        // 分配不同目标
        // ...
    }
}
```

---

## 7. 缺失功能分析 (对标优秀实践)

### 功能覆盖状态

| 类别 | 功能 | 状态 | 说明 |
|------|------|------|------|
| **高级资源** | PowerCreep | ✅ 已实现 | PowerCreepManager |
| | Factory (工厂) | ✅ 已实现 | FactoryCluster |
| | Power Bank 采集 | ✅ 已实现 | PowerBankMiner |
| | Deposit 采集 | ✅ 已实现 | DepositMiner |
| **外交系统** | 盟友白名单 | ✅ 已实现 | DiplomacyManager |
| | 外交策略 | ✅ 已实现 | DiplomacyManager |
| | 通信协议 | ⚠️ 基础 | LOaN 需自行配置 |
| **进攻策略** | Drain 战术 | ✅ 已实现 | DrainerOverlord |
| | 破墙编队 | ✅ 已实现 | WallBreakerOverlord |
| | Nuke 自动规划 | ⚠️ 部分 | NukePlanner 存在但不完整 |
| **防御策略** | SafeMode 自动触发 | ✅ 已实现 | SafeModeManager |
| | 动态 boost 策略 | ✅ 已实现 | DynamicBoostManager |
| | 入侵预测 | ✅ 已实现 | InvasionPredictor |
| **经济系统** | 多 shard 协调 | ✅ 已实现 | InterShardManager |
| | 市场套利 | ✅ 已实现 | TradeNetwork |
| | 能量危机应对 | ✅ 已实现 | EnergyCrisisManager |
| **自动化** | 自动扩张策略 | ✅ 有 | ExpansionPlanner |
| | 房间布局规划 | ✅ 有 | Bunker 布局 |
| | 道路自动规划 | ✅ 有 | RoadPlanner |

### 7.1 PowerCreep 系统 (完全缺失)

**影响**: PowerCreep 可以提供强大的房间增益，RCL8 玩家必备。

**需要实现的功能**:
```typescript
// 新建 src/power/PowerCreepManager.ts
export class PowerCreepManager {
    // 1. PowerCreep 生成和升级决策
    decidePowerCreepClass(): PowerClassConstant {
        // 根据需求选择: OPERATOR 最常用
    }

    // 2. Power 能力优先级
    static powerPriorities = {
        [PWR_OPERATE_SPAWN]: 1,      // 加速生产 (最重要)
        [PWR_OPERATE_EXTENSION]: 2,  // 加速扩展填充
        [PWR_REGEN_SOURCE]: 3,       // 再生矿源
        [PWR_OPERATE_TOWER]: 4,      // 增强塔伤害
        [PWR_OPERATE_LAB]: 5,        // 加速 lab
    };

    // 3. Power 使用逻辑
    operateRoom(pc: PowerCreep, room: Room): void {
        // 根据房间状态选择使用哪个 power
    }
}
```

**优先级**: 🔴 高 (RCL8 后的主要战力提升)

### 7.2 Factory 系统 (完全缺失)

**影响**: 无法生产商品 (commodities)，损失大量市场收入。

**需要实现**:
```typescript
// 新建 src/hiveClusters/factory.ts
export class FactoryCluster {
    // 1. 商品生产链规划
    // 2. 原料库存管理
    // 3. 产品市场定价
    // 4. 跨房间协调 (不同 level 工厂生产不同商品)
}
```

**优先级**: 🔴 高 (主要经济来源之一)

### 7.3 Highway 资源采集 (Power Bank / Deposit)

**影响**: 放弃大量免费资源。

**需要实现**:
- Power Bank 采集小队 (需要高 DPS + 快速治疗)
- Deposit 采集逻辑 (季节性资源)
- Highway 巡逻和发现机制

```typescript
// 新建 src/overlords/mining/powerBankMiner.ts
export class PowerBankMinerOverlord extends CombatOverlord {
    // 1. 评估 Power Bank 是否值得采集 (距离、Power 数量)
    // 2. 派遣 DPS + Healer 编队
    // 3. 召唤运输队在 bank 即将破碎时到达
}
```

**优先级**: 🟡 中 (额外资源，非必须)

### 7.4 外交系统 (基本缺失)

**现状**: `whitelist.ts` 只有 TODO 注释。

**需要实现**:
```typescript
// 完善 src/contracts/whitelist.ts
export class DiplomacyManager {
    // 1. 盟友/敌人名单管理
    private allies: Set<string> = new Set();
    private enemies: Set<string> = new Set();

    // 2. 自动识别威胁
    analyzePlayer(username: string): 'ally' | 'enemy' | 'neutral' {
        // 根据历史行为判断
    }

    // 3. Segment 通信协议 (LOaN 联盟协议兼容)
    sendMessage(player: string, message: object): void {
        // 使用 RawMemory.foreignSegment 实现跨玩家通信
    }
}
```

**优先级**: 🟡 中 (多人服务器重要)

### 7.5 Drain 战术 (进攻缺失)

**概念**: 派遣高治疗单位吸引敌方塔攻击，消耗其能量。

```typescript
// 新建 src/overlords/offense/drainer.ts
export class DrainerOverlord extends CombatOverlord {
    // 1. 评估目标房间塔数量和能量
    // 2. 派遣 TOUGH + HEAL 为主的 creep
    // 3. 在塔射程边缘徘徊，持续消耗塔能量
    // 4. 塔能量耗尽后，切换到主攻部队

    private drainLoop(drainer: CombatZerg): void {
        // 保持在塔 20 格范围边缘，持续自愈
    }
}
```

**优先级**: 🟡 中 (攻坚利器)

### 7.6 破墙编队 / Dismantler

**现状**: Dismantler 角色存在但没有专门的 overlord。

**需要实现**:
```typescript
// 新建 src/overlords/offense/wallBreaker.ts
export class WallBreakerOverlord extends CombatOverlord {
    // 1. 分析墙体血量，选择最弱点突破
    // 2. Dismantler + Healer 编队
    // 3. 配合主攻部队掩护
}
```

### 7.7 入侵预测系统

**概念**: 分析历史数据，预测敌人入侵时间和规模。

```typescript
// 新建 src/intel/ThreatPrediction.ts
export class ThreatPredictor {
    // 1. 记录每次入侵的时间、规模、来源
    // 2. 分析入侵模式 (定时骚扰? 大规模进攻?)
    // 3. 提前生成防御单位

    predictNextAttack(roomName: string): {
        probability: number,
        estimatedTime: number,
        estimatedSize: 'small' | 'medium' | 'large'
    } {
        // 基于历史数据预测
    }
}
```

### 7.8 多 Shard 协调 (缺失)

**影响**: 无法跨 shard 转移资源和部队。

```typescript
// 新建 src/strategy/InterShardManager.ts
export class InterShardManager {
    // 1. 跨 shard 资源转移决策
    // 2. Portal 监控
    // 3. 跨 shard creep 迁移
}
```

---

## 功能优先级总排序

| 优先级 | 功能 | 类别 | 收益 | 难度 | 状态 |
|--------|------|------|------|------|------|
| 🔴 1 | generatePixel() | CPU | 直接收入 | 极低 | ✅ 已实现 |
| 🔴 2 | Factory 系统 | 经济 | 商品收入 | 中 | ✅ 已实现 |
| 🔴 3 | PowerCreep | 战力 | 房间增益 | 高 | ✅ 已实现 |
| 🔴 4 | maxMarketPrices 动态化 | 交易 | 避免卡死 | 低 | ✅ 已实现 |
| 🟡 5 | AutoSiege 完成 | 进攻 | 自动作战 | 中 | ✅ 已实现 |
| 🟡 6 | Drain 战术 | 进攻 | 攻坚能力 | 低 | ✅ 已实现 |
| 🟡 7 | 外交系统 | 外交 | 生存能力 | 中 | ✅ 已实现 |
| 🟡 8 | Highway 资源采集 | 经济 | 额外资源 | 中 | ✅ 已实现 |
| 🟢 9 | 预警系统 | 防御 | 提前响应 | 中 | ✅ 已实现 |
| 🟢 10 | 入侵预测 | 防御 | 防御效率 | 高 | ✅ 已实现 |

---

## 实现记录

### 首批优化实现

**已完成的优化项:**

1. **generatePixel() CPU转换** - `main.ts:75-77`
   - 当 bucket 满 (10000) 时自动转换为 Pixel
   - 直接产生收入

2. **maxMarketPrices 动态化** - `TradeNetwork.ts:388-394`
   - 新增 `getMaxBuyPrice()` 方法
   - 基于实时市场价格的 1.5 倍作为上限
   - 保留原有硬编码值作为回退

3. **energyToCreditMultiplier 实时化** - `TradeNetwork.ts:396-406`
   - 新增 `getEnergyToCreditMultiplier()` 方法
   - 使用实时能量价格计算运输成本
   - 保守默认值 0.01 作为回退

4. **lookForGoodDeals 动态 margin** - `TradeNetwork.ts:411-419`
   - 新增 `getDealMargin()` 方法
   - 根据库存量动态调整 margin
   - 高库存时降低 margin 加速出货

5. **CPU budget 分级管理** - `CpuBudgetManager.ts`
   - 新建 `CpuBudgetManager` 类
   - 5级 bucket 分级: critical/low/normal/high/full
   - 动态缓存超时、采矿范围、路径搜索深度

6. **缓存刷新策略优化** - `TradeNetwork.ts:533-537`
   - 使用 `CpuBudgetManager.getCacheTimeout()` 动态调整
   - bucket 高时更频繁刷新 (10 tick)
   - bucket 低时减少刷新 (100 tick)

### 第二批优化实现

7. **TerminalNetwork 运输成本优化** - `TerminalNetwork.ts:216-260`
   - 新增 `effectiveTransferAmount()` 方法
   - 新增 `getTransportCostScore()` 方法
   - `requestResource()` 现在优先选择运输成本低的发送方
   - 综合考虑资源量和运输成本的平衡

8. **套利机会检测** - `TradeNetwork.ts:421-475`
   - 新增 `lookForArbitrageOpportunities()` 方法
   - 自动检测买卖价差套利机会
   - 计算运输成本后的实际利润
   - 每 50 tick 执行一次检测

9. **可视化按需渲染** - `main.ts:69-72`
   - 使用 `CpuBudgetManager.shouldRenderVisuals()` 判断
   - bucket 低于 4000 时自动跳过渲染
   - 节省 CPU 用于核心操作

10. **Factory 系统** - `src/hiveClusters/factoryCluster.ts` (新文件)
    - 完整的 FactoryCluster 类实现
    - 商品配方定义 (压缩条、基础商品、电池)
    - 生产优先级管理
    - 自动请求原料和输出成品
    - 根据殖民地资源状况决定生产内容

11. **PowerCreep 系统** - `src/power/PowerCreepManager.ts` (新文件)
    - 完整的 PowerCreepManager 类实现
    - 自动分配 PowerCreep 到殖民地
    - 能力使用优先级: OPERATE_SPAWN > OPERATE_EXTENSION > REGEN_SOURCE > OPERATE_TOWER > OPERATE_LAB
    - 自动续命和房间启用
    - 战斗时优先使用 OPERATE_TOWER

### 第三批优化实现

12. **AutoSiege 自动围攻系统** - `src/directives/offense/autoSiege.ts`
    - 完整实现自动围攻流程
    - 阶段管理: scouting → analyzing → sieging → cleanup
    - 根据房间布局自动选择攻击策略
    - 支持 PairDestroyer / SwarmDestroyer / ControllerAttacker
    - 根据防御墙血量和塔伤害选择最优攻击方式

13. **Drain 战术** - `src/overlords/offense/drainer.ts` (新文件)
    - 完整的 DrainerOverlord 实现
    - TOUGH + HEAL creep 配置吸收塔伤害
    - 自动定位塔楼射程边缘位置 (range 20)
    - 动态撤退阈值 (50% HP)
    - 支持 boosted 模式 (XGHO2/XLHO2/XZHO2)

14. **外交系统** - `src/diplomacy/DiplomacyManager.ts` (新文件)
    - 完整的外交管理系统
    - 关系类型: ally / neutral / enemy / nap
    - 自动记录敌对行为 (aggression score)
    - 自动记录友好行为 (trust score)
    - 分数衰减机制
    - 自动更新关系状态
    - 白名单功能 (isWhitelisted)

15. **Highway 资源采集系统**
    - `src/directives/resource/powerBank.ts` (新文件)
      - Power Bank 采集指令
      - 自动评估是否值得采集
      - 跟踪 power 数量、衰减时间、血量
    - `src/overlords/mining/powerBankMiner.ts` (新文件)
      - DPS + Healer 编队配置
      - 自动调度 haulers 收集 power
      - 支持 boosted 模式
    - `src/directives/resource/deposit.ts` (新文件)
      - Deposit 采集指令
      - 自动监控 cooldown
      - 根据 cooldown 调整采集策略
    - `src/overlords/mining/depositMiner.ts` (新文件)
      - WORK-heavy creep 配置
      - hauler 运输系统
      - cooldown 过高自动放弃
    - `src/intel/HighwayScoutManager.ts` (新文件)
      - 自动扫描 highway 房间
      - 使用 observer 远程侦察
      - 自动发现 Power Bank 和 Deposit
      - 自动创建采集指令

16. **预警系统** - `src/intel/EarlyWarningSystem.ts` (新文件)
    - 扫描相邻房间威胁
    - 威胁等级评估: none / low / medium / high / critical
    - 计算敌人战斗力 (combat power)
    - 检测 boost 状态
    - 自动触发警报
    - 记录威胁来源方向

17. **入侵预测系统** - `src/intel/InvasionPredictor.ts` (新文件)
    - 记录所有入侵历史
    - 分析攻击者模式 (间隔、规模、目标)
    - 预测下次攻击概率和时间
    - 识别频繁攻击者
    - 预测置信度评估 (low / medium / high)

### 第四批优化实现

18. **CombatPlanner 核心功能** - `src/strategy/CombatPlanner.ts`
    - 实现 `computeHitsToSpawn()` 计算需要的兵力
    - 实现 `getNeededPotentials()` 计算对抗威胁所需战力
    - 实现 `canHandleThreat()` 判断当前兵力是否足够
    - 实现 `getCreepCountsNeeded()` 计算各类型 creep 需求数量

19. **SwarmDestroyer 远程编队** - `src/overlords/offense/swarmDestroyer.ts`
    - 恢复 hydralisks (远程攻击) 编队
    - 新增 rangedSwarms 独立远程编队
    - 修复 hydraliskSetup 配置 bug
    - 远程编队使用 4 个 hydralisk 的 2x2 编队

20. **目标选择战术优化** - `src/targeting/CombatTargeting.ts`
    - 增强 `findTarget()` 评分系统
    - 优先攻击治疗者 (+500 分)
    - 集火有治疗支援的目标 (+200 * 治疗者数量)
    - 低血量目标加分 (30% 以下 +400, 50% 以下 +200)
    - 新增 `findFocusFireTarget()` 支持多单位协调集火

21. **塔楼引导逻辑** - `src/zerg/CombatZerg.ts`
    - 新增 `lureToTowerRange()` 将敌人引导到塔楼最佳伤害范围
    - 新增 `findOptimalTowerLurePosition()` 寻找最佳引导位置
    - 新增 `kiteFromHostiles()` 风筝走位
    - 新增 `autoTowerAssistedCombat()` 塔楼辅助战斗模式

22. **动态撤退阈值** - `src/zerg/CombatZerg.ts`
    - 新增 `getDynamicRetreatThreshold()` 根据伤害/治疗比动态计算
    - 新增 `getIncomingDamage()` 计算预期受到的伤害
    - 新增 `needsToRecoverDynamic()` 使用动态阈值判断撤退
    - 伤害 > 治疗 1.5 倍: 90% HP 撤退
    - 伤害 > 治疗: 85% HP 撤退
    - 伤害 < 治疗 0.5 倍: 60% HP 撤退 (更激进)

23. **多 Swarm 协调** - `src/overlords/offense/swarmDestroyer.ts`
    - 新增 `coordinateSwarms()` 协调多个 Swarm 同步攻击
    - 新增 `assignDistributedTargets()` 分散目标削弱敌人防御
    - 新增 `coordinateFocusFire()` 协调集火同一目标
    - 新增 `shouldRegroup()` 判断是否需要重组
    - 新增 `calculatePincerPositions()` 计算钳形攻击位置

24. **Quad 防御战术** - `src/overlords/defense/quadDefense.ts` (新文件)
    - 完整的 QuadDefenseOverlord 实现
    - 使用 2x2 Swarm 编队进行防御
    - 2 个 hydralisk + 2 个 healer 配置
    - 塔楼协同作战 (`engageWithTowerSupport()`)
    - 动态威胁评估和编队数量计算
    - 支持 T3 boost

### 第五批优化实现

25. **破墙编队 (WallBreaker)** - `src/overlords/offense/wallBreaker.ts` (新文件)
    - 完整的 WallBreakerOverlord 实现
    - Dismantler + Healer 编队配置
    - 战略突破点分析 (`findStrategicBreachPoint()`)
    - 根据优先目标 (spawns, towers, storage) 选择最佳突破位置
    - 墙体血量评估 (最大 10M hits)
    - 支持 T3 boost (dismantle/tough/move)

26. **多 Shard 协调** - `src/strategy/InterShardManager.ts` (新文件)
    - 完整的跨 Shard 管理系统
    - Portal 扫描和追踪 (`scanForPortals()`)
    - 跨 Shard 资源转移请求 (`requestTransfer()`)
    - Creep 迁移协调 (`requestCreepMigration()`)
    - Shard 状态同步 (使用 RawMemory.segments[99])
    - Portal 衰减警告
    - 最近 Portal 查找 (`findNearestPortal()`)

27. **SafeMode 自动触发增强** - `src/strategy/SafeModeManager.ts` (新文件)
    - 多因素威胁评估系统
    - Spawn 威胁检测 (`assessSpawnThreat()`)
    - Storage/Terminal 威胁检测 (`assessStorageThreat()`)
    - Controller 被攻击检测 (`assessControllerThreat()`)
    - 防御崩溃检测 (`assessOverwhelmed()`)
    - 威胁严重等级: low / medium / high / critical
    - 仅 critical 自动触发，high 发出警告
    - 冷却时间管理 (1000 ticks)
    - 预留 safe mode 机制

28. **动态 Boost 策略** - `src/strategy/DynamicBoostManager.ts` (新文件)
    - 完整的动态 boost 决策系统
    - 殖民地 boost 能力分析 (`analyzeColony()`)
    - 根据威胁等级推荐 boost tier (`getRecommendedTier()`)
    - 战斗角色 boost 清单 (`getCombatBoostWishlist()`)
    - 经济角色 boost 清单 (`getEconomicBoostWishlist()`)
    - 威胁阈值配置: low/medium/high (500/2000/5000)
    - 仅能量盈余时 boost 经济单位
    - 支持多种角色: ranged, melee, healer, dismantler, upgrader, miner, hauler, worker

29. **能量危机应对** - `src/strategy/EnergyCrisisManager.ts` (新文件)
    - 完整的能量危机管理系统
    - 危机等级: none / warning / critical / emergency
    - 能量阈值: 200k (健康) / 50k (警告) / 10k (危急) / 5k (紧急)
    - 殖民地能量状态分析 (`analyzeColony()`)
    - 收入/支出估算和耗尽预测
    - 危机应对建议 (`getRecommendedActions()`)
    - 自动跨殖民地能量转移 (`coordinateTransfers()`)
    - Spawn 数量修正 (`getSpawnModifier()`)
    - 升级/建造暂停判断
    - 远程采矿暂停判断

---

## 新增文件清单

| 文件 | 描述 |
|------|------|
| `src/utilities/CpuBudgetManager.ts` | CPU 预算分级管理器 |
| `src/hiveClusters/factoryCluster.ts` | Factory 商品生产系统 |
| `src/power/PowerCreepManager.ts` | PowerCreep 管理系统 |
| `src/overlords/offense/drainer.ts` | Drain 战术 overlord |
| `src/diplomacy/DiplomacyManager.ts` | 外交系统管理器 |
| `src/directives/resource/powerBank.ts` | Power Bank 采集指令 |
| `src/overlords/mining/powerBankMiner.ts` | Power Bank 采集 overlord |
| `src/directives/resource/deposit.ts` | Deposit 采集指令 |
| `src/overlords/mining/depositMiner.ts` | Deposit 采集 overlord |
| `src/intel/HighwayScoutManager.ts` | Highway 资源扫描系统 |
| `src/intel/EarlyWarningSystem.ts` | 预警系统 |
| `src/intel/InvasionPredictor.ts` | 入侵预测系统 |
| `src/overlords/defense/quadDefense.ts` | Quad 防御战术 overlord |
| `src/overlords/offense/wallBreaker.ts` | 破墙编队 overlord |
| `src/strategy/InterShardManager.ts` | 多 Shard 协调管理器 |
| `src/strategy/SafeModeManager.ts` | SafeMode 自动触发管理器 |
| `src/strategy/DynamicBoostManager.ts` | 动态 Boost 策略管理器 |
| `src/strategy/EnergyCrisisManager.ts` | 能量危机应对管理器 |

## 修改文件清单

| 文件 | 修改内容 |
|------|----------|
| `src/main.ts` | 添加 generatePixel()、条件渲染、PowerCreep/Diplomacy/Highway/EarlyWarning/InvasionPredictor 运行 |
| `src/logistics/TradeNetwork.ts` | 动态价格、能量乘数、套利检测、动态 margin |
| `src/logistics/TerminalNetwork.ts` | 运输成本优化 |
| `src/directives/offense/autoSiege.ts` | 完整实现自动围攻功能 |
| `src/strategy/CombatPlanner.ts` | 实现核心兵力计算功能 |
| `src/overlords/offense/swarmDestroyer.ts` | 恢复远程编队、多 Swarm 协调 |
| `src/targeting/CombatTargeting.ts` | 增强目标选择战术、集火支持 |
| `src/zerg/CombatZerg.ts` | 塔楼引导、动态撤退、风筝走位 |

