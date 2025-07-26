import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Observable, Subject, interval } from "rxjs";
import { map, filter, debounceTime } from "rxjs/operators";
import { TelescopeEntry } from "../interfaces/telescope-entry.interface";
import { TelescopeConfig } from "../interfaces/telescope-config.interface";
import { Inject } from "@nestjs/common";

export interface ScalingNode {
  id: string;
  hostname: string;
  port: number;
  status: "active" | "inactive" | "unhealthy";
  load: number; // 0-100
  memoryUsage: number;
  cpuUsage: number;
  lastHeartbeat: Date;
  capabilities: string[];
  version: string;
}

export interface ScalingConfig {
  enabled: boolean;
  clusterMode: boolean;
  nodeId: string;
  discovery: {
    method: "redis" | "consul" | "kubernetes" | "manual";
    interval: number; // ms
    timeout: number; // ms
  };
  loadBalancing: {
    strategy: "round-robin" | "least-loaded" | "consistent-hash" | "random";
    healthCheckInterval: number; // ms
    failoverEnabled: boolean;
  };
  dataDistribution: {
    sharding: boolean;
    shardKey: string; // 'timestamp' | 'type' | 'hash'
    replicationFactor: number;
    consistencyLevel: "eventual" | "strong" | "quorum";
  };
  communication: {
    protocol: "http" | "grpc" | "redis-pubsub";
    timeout: number; // ms
    retries: number;
    compression: boolean;
  };
}

export interface LoadBalancingResult {
  targetNode: ScalingNode;
  strategy: string;
  loadFactor: number;
  latency: number;
}

export interface ClusterHealth {
  totalNodes: number;
  activeNodes: number;
  unhealthyNodes: number;
  averageLoad: number;
  dataDistribution: {
    balanced: boolean;
    variance: number;
    recommendations: string[];
  };
  performance: {
    averageResponseTime: number;
    throughput: number;
    errorRate: number;
  };
}

@Injectable()
export class HorizontalScalingService implements OnModuleInit {
  private readonly logger = new Logger(HorizontalScalingService.name);
  private readonly nodes = new Map<string, ScalingNode>();
  private readonly nodeSubject = new Subject<ScalingNode>();
  private readonly healthSubject = new Subject<ClusterHealth>();
  private readonly loadBalancer = new Map<string, ScalingNode[]>();
  private readonly nodeLoadHistory = new Map<string, number[]>();
  private readonly config: ScalingConfig;
  private readonly localNode: ScalingNode;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private discoveryInterval: NodeJS.Timeout | null = null;

  constructor(
    @Inject("TELESCOPE_CONFIG")
    private readonly telescopeConfig: TelescopeConfig
  ) {
    this.config =
      this.telescopeConfig.scaling || this.getDefaultScalingConfig();
    this.localNode = this.createLocalNode();
  }

  async onModuleInit(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.log("Horizontal scaling disabled");
      return;
    }

    await this.initializeScaling();
    this.startHeartbeat();
    this.startDiscovery();
    this.logger.log(
      `Horizontal scaling initialized for node: ${this.localNode.id}`
    );
  }

  private getDefaultScalingConfig(): ScalingConfig {
    return {
      enabled: false,
      clusterMode: false,
      nodeId: `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      discovery: {
        method: "redis",
        interval: 30000, // 30 seconds
        timeout: 5000, // 5 seconds
      },
      loadBalancing: {
        strategy: "least-loaded",
        healthCheckInterval: 10000, // 10 seconds
        failoverEnabled: true,
      },
      dataDistribution: {
        sharding: false,
        shardKey: "timestamp",
        replicationFactor: 1,
        consistencyLevel: "eventual",
      },
      communication: {
        protocol: "http",
        timeout: 5000,
        retries: 3,
        compression: true,
      },
    };
  }

  private createLocalNode(): ScalingNode {
    return {
      id: this.config.nodeId,
      hostname: process.env.HOSTNAME || "localhost",
      port: parseInt(process.env.PORT) || 3000,
      status: "active",
      load: 0,
      memoryUsage: 0,
      cpuUsage: 0,
      lastHeartbeat: new Date(),
      capabilities: ["telescope", "analytics", "ml", "alerting"],
      version: "10.0.0",
    };
  }

  private async initializeScaling(): Promise<void> {
    // Register local node
    this.nodes.set(this.localNode.id, this.localNode);
    this.nodeSubject.next(this.localNode);

    // Initialize load balancer
    this.initializeLoadBalancer();

    // Start cluster health monitoring
    this.startHealthMonitoring();
  }

  private initializeLoadBalancer(): void {
    // Initialize load balancer for different entry types
    const entryTypes = ["request", "query", "exception", "job", "cache"];
    entryTypes.forEach((type) => {
      this.loadBalancer.set(type, [this.localNode]);
    });
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = interval(10000).subscribe(async () => {
      await this.sendHeartbeat();
      await this.updateLocalNodeMetrics();
    });
  }

  private startDiscovery(): void {
    this.discoveryInterval = interval(this.config.discovery.interval).subscribe(
      async () => {
        await this.discoverNodes();
        await this.cleanupInactiveNodes();
      }
    );
  }

  private async sendHeartbeat(): Promise<void> {
    try {
      // Update local node metrics
      this.updateLocalNodeMetrics();

      // Broadcast heartbeat to other nodes
      if (this.config.clusterMode) {
        await this.broadcastHeartbeat();
      }

      this.logger.debug(`Heartbeat sent from node: ${this.localNode.id}`);
    } catch (error) {
      this.logger.error(`Failed to send heartbeat: ${error.message}`);
    }
  }

  private async updateLocalNodeMetrics(): Promise<void> {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = await this.getCpuUsage();

    this.localNode.memoryUsage = Math.round(memoryUsage.heapUsed / 1024 / 1024); // MB
    this.localNode.cpuUsage = cpuUsage;
    this.localNode.load = this.calculateLoad();
    this.localNode.lastHeartbeat = new Date();

    // Update load history
    const history = this.nodeLoadHistory.get(this.localNode.id) || [];
    history.push(this.localNode.load);
    if (history.length > 100) {
      history.shift();
    }
    this.nodeLoadHistory.set(this.localNode.id, history);

    // Update node in registry
    this.nodes.set(this.localNode.id, this.localNode);
    this.nodeSubject.next(this.localNode);
  }

  private async getCpuUsage(): Promise<number> {
    // Simple CPU usage calculation
    const startUsage = process.cpuUsage();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const endUsage = process.cpuUsage();

    const userCpu = endUsage.user - startUsage.user;
    const systemCpu = endUsage.system - startUsage.system;
    const totalCpu = userCpu + systemCpu;

    return Math.min(100, (totalCpu / 1000000) * 100); // Convert to percentage
  }

  private calculateLoad(): number {
    const memoryUsage = process.memoryUsage();
    const memoryLoad = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;

    // Combine memory and CPU load
    return Math.round((memoryLoad + this.localNode.cpuUsage) / 2);
  }

  private async broadcastHeartbeat(): Promise<void> {
    // Implementation depends on communication protocol
    switch (this.config.communication.protocol) {
      case "redis-pubsub":
        await this.broadcastViaRedis();
        break;
      case "http":
        await this.broadcastViaHttp();
        break;
      case "grpc":
        await this.broadcastViaGrpc();
        break;
    }
  }

  private async broadcastViaRedis(): Promise<void> {
    // Redis pub/sub implementation
    // This would use Redis to broadcast heartbeat to other nodes
    this.logger.debug("Broadcasting heartbeat via Redis");
  }

  private async broadcastViaHttp(): Promise<void> {
    // HTTP-based node discovery
    for (const node of this.nodes.values()) {
      if (node.id === this.localNode.id) continue;

      try {
        const response = await fetch(
          `http://${node.hostname}:${node.port}/telescope/health`,
          {
            method: "GET",
            timeout: this.config.communication.timeout,
          }
        );

        if (response.ok) {
          const healthData = await response.json();
          this.updateNodeHealth(node.id, healthData);
        } else {
          this.markNodeUnhealthy(node.id);
        }
      } catch (error) {
        this.logger.warn(`Failed to reach node ${node.id}: ${error.message}`);
        this.markNodeUnhealthy(node.id);
      }
    }
  }

  private async broadcastViaGrpc(): Promise<void> {
    // gRPC-based communication
    this.logger.debug("Broadcasting heartbeat via gRPC");
  }

  private async discoverNodes(): Promise<void> {
    switch (this.config.discovery.method) {
      case "redis":
        await this.discoverNodesViaRedis();
        break;
      case "consul":
        await this.discoverNodesViaConsul();
        break;
      case "kubernetes":
        await this.discoverNodesViaKubernetes();
        break;
      case "manual":
        // Manual node configuration
        break;
    }
  }

  private async discoverNodesViaRedis(): Promise<void> {
    // Redis-based service discovery
    this.logger.debug("Discovering nodes via Redis");
  }

  private async discoverNodesViaConsul(): Promise<void> {
    // Consul-based service discovery
    this.logger.debug("Discovering nodes via Consul");
  }

  private async discoverNodesViaKubernetes(): Promise<void> {
    // Kubernetes-based service discovery
    this.logger.debug("Discovering nodes via Kubernetes");
  }

  private updateNodeHealth(nodeId: string, healthData: any): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    node.status = "active";
    node.load = healthData.load || 0;
    node.memoryUsage = healthData.memoryUsage || 0;
    node.cpuUsage = healthData.cpuUsage || 0;
    node.lastHeartbeat = new Date();

    this.nodes.set(nodeId, node);
    this.nodeSubject.next(node);
  }

  private markNodeUnhealthy(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    node.status = "unhealthy";
    this.nodes.set(nodeId, node);
    this.nodeSubject.next(node);
  }

  private async cleanupInactiveNodes(): Promise<void> {
    const now = new Date();
    const timeout = this.config.discovery.timeout;

    for (const [nodeId, node] of this.nodes.entries()) {
      if (nodeId === this.localNode.id) continue;

      const timeSinceHeartbeat = now.getTime() - node.lastHeartbeat.getTime();
      if (timeSinceHeartbeat > timeout) {
        this.nodes.delete(nodeId);
        this.logger.warn(`Removed inactive node: ${nodeId}`);
      }
    }
  }

  private startHealthMonitoring(): void {
    interval(30000).subscribe(async () => {
      const health = await this.getClusterHealth();
      this.healthSubject.next(health);
    });
  }

  // Public API methods

  async routeEntry(entry: TelescopeEntry): Promise<LoadBalancingResult> {
    if (!this.config.enabled) {
      return {
        targetNode: this.localNode,
        strategy: "local",
        loadFactor: 0,
        latency: 0,
      };
    }

    const targetNode = await this.selectTargetNode(entry.type);
    const loadFactor = targetNode.load;
    const latency = await this.measureLatency(targetNode);

    return {
      targetNode,
      strategy: this.config.loadBalancing.strategy,
      loadFactor,
      latency,
    };
  }

  private async selectTargetNode(entryType: string): Promise<ScalingNode> {
    const availableNodes = this.loadBalancer.get(entryType) || [this.localNode];
    const activeNodes = availableNodes.filter(
      (node) => node.status === "active"
    );

    if (activeNodes.length === 0) {
      return this.localNode;
    }

    switch (this.config.loadBalancing.strategy) {
      case "round-robin":
        return this.roundRobinSelection(activeNodes, entryType);
      case "least-loaded":
        return this.leastLoadedSelection(activeNodes);
      case "consistent-hash":
        return this.consistentHashSelection(activeNodes, entryType);
      case "random":
        return this.randomSelection(activeNodes);
      default:
        return this.leastLoadedSelection(activeNodes);
    }
  }

  private roundRobinSelection(
    nodes: ScalingNode[],
    entryType: string
  ): ScalingNode {
    const index = (this.getRoundRobinIndex(entryType) || 0) % nodes.length;
    return nodes[index];
  }

  private getRoundRobinIndex(entryType: string): number {
    // Simple round-robin counter per entry type
    const counter = this.loadBalancer.get(`${entryType}_counter`) || 0;
    this.loadBalancer.set(`${entryType}_counter`, counter + 1);
    return counter;
  }

  private leastLoadedSelection(nodes: ScalingNode[]): ScalingNode {
    return nodes.reduce((min, node) => (node.load < min.load ? node : min));
  }

  private consistentHashSelection(
    nodes: ScalingNode[],
    entryType: string
  ): ScalingNode {
    // Simple hash-based selection
    const hash = this.hashString(entryType);
    const index = hash % nodes.length;
    return nodes[index];
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  private randomSelection(nodes: ScalingNode[]): ScalingNode {
    const index = Math.floor(Math.random() * nodes.length);
    return nodes[index];
  }

  private async measureLatency(node: ScalingNode): Promise<number> {
    if (node.id === this.localNode.id) {
      return 0;
    }

    const start = Date.now();
    try {
      await fetch(`http://${node.hostname}:${node.port}/telescope/health`, {
        method: "GET",
        timeout: 1000,
      });
      return Date.now() - start;
    } catch (error) {
      return 9999; // High latency for failed nodes
    }
  }

  async getClusterHealth(): Promise<ClusterHealth> {
    const allNodes = Array.from(this.nodes.values());
    const activeNodes = allNodes.filter((node) => node.status === "active");
    const unhealthyNodes = allNodes.filter(
      (node) => node.status === "unhealthy"
    );

    const averageLoad =
      activeNodes.length > 0
        ? activeNodes.reduce((sum, node) => sum + node.load, 0) /
          activeNodes.length
        : 0;

    const dataDistribution = this.analyzeDataDistribution();
    const performance = await this.measureClusterPerformance();

    return {
      totalNodes: allNodes.length,
      activeNodes: activeNodes.length,
      unhealthyNodes: unhealthyNodes.length,
      averageLoad,
      dataDistribution,
      performance,
    };
  }

  private analyzeDataDistribution(): ClusterHealth["dataDistribution"] {
    const loads = Array.from(this.nodes.values()).map((node) => node.load);
    const mean = loads.reduce((sum, load) => sum + load, 0) / loads.length;
    const variance =
      loads.reduce((sum, load) => sum + Math.pow(load - mean, 2), 0) /
      loads.length;
    const standardDeviation = Math.sqrt(variance);

    const balanced = standardDeviation < 20; // Less than 20% variance
    const recommendations: string[] = [];

    if (!balanced) {
      if (standardDeviation > 50) {
        recommendations.push(
          "High load variance detected. Consider rebalancing cluster."
        );
      }
      if (loads.some((load) => load > 80)) {
        recommendations.push(
          "Some nodes are heavily loaded. Consider adding more nodes."
        );
      }
    }

    return {
      balanced,
      variance: standardDeviation,
      recommendations,
    };
  }

  private async measureClusterPerformance(): Promise<
    ClusterHealth["performance"]
  > {
    // Measure cluster-wide performance metrics
    const responseTimes: number[] = [];
    const throughput = this.calculateThroughput();
    const errorRate = this.calculateErrorRate();

    return {
      averageResponseTime:
        responseTimes.length > 0
          ? responseTimes.reduce((sum, time) => sum + time, 0) /
            responseTimes.length
          : 0,
      throughput,
      errorRate,
    };
  }

  private calculateThroughput(): number {
    // Calculate requests per second across all nodes
    return 1000; // Placeholder
  }

  private calculateErrorRate(): number {
    // Calculate error rate across all nodes
    return 0.01; // 1% placeholder
  }

  // Observable streams
  getNodeUpdates(): Observable<ScalingNode> {
    return this.nodeSubject.asObservable();
  }

  getClusterHealthUpdates(): Observable<ClusterHealth> {
    return this.healthSubject.asObservable();
  }

  // Utility methods
  getNodes(): ScalingNode[] {
    return Array.from(this.nodes.values());
  }

  getActiveNodes(): ScalingNode[] {
    return Array.from(this.nodes.values()).filter(
      (node) => node.status === "active"
    );
  }

  getNodeById(nodeId: string): ScalingNode | undefined {
    return this.nodes.get(nodeId);
  }

  isLocalNode(nodeId: string): boolean {
    return nodeId === this.localNode.id;
  }

  getLocalNode(): ScalingNode {
    return this.localNode;
  }

  async shutdown(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval as any);
    }
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval as any);
    }

    // Notify other nodes about shutdown
    if (this.config.clusterMode) {
      await this.notifyShutdown();
    }

    this.logger.log("Horizontal scaling service shutdown");
  }

  private async notifyShutdown(): Promise<void> {
    // Notify other nodes that this node is shutting down
    this.logger.debug("Notifying other nodes about shutdown");
  }
}
