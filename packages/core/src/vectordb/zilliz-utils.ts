import { envManager } from '../utils/env-manager';

export interface ZillizConfig {
    baseUrl?: string;
    token?: string;
}

export interface Project {
    projectId: string;
    projectName: string;
    instanceCount: number;
    createTime: string;
}

export interface Cluster {
    clusterId: string;
    clusterName: string;
    description: string;
    regionId: string;
    plan: string;
    cuType: string;
    cuSize: number;
    status: string;
    connectAddress: string;
    privateLinkAddress: string;
    projectId: string;
    createTime: string;
}

export interface CreateFreeClusterRequest {
    clusterName: string;
    projectId: string;
    regionId: string;
}

export interface CreateFreeClusterResponse {
    clusterId: string;
    username: string;
    password: string;
    prompt: string;
}

export interface CreateFreeClusterWithDetailsResponse extends CreateFreeClusterResponse {
    clusterDetails: DescribeClusterResponse;
}

export interface ListProjectsResponse {
    code: number;
    data: Project[];
}

export interface ListClustersResponse {
    code: number;
    data: {
        count: number;
        currentPage: number;
        pageSize: number;
        clusters: Cluster[];
    };
}

export interface CreateFreeClusterApiResponse {
    code: number;
    data: CreateFreeClusterResponse;
}

export interface DescribeClusterResponse {
    clusterId: string;
    clusterName: string;
    projectId: string;
    description: string;
    regionId: string;
    cuType: string;
    plan: string;
    status: string;
    connectAddress: string;
    privateLinkAddress: string;
    createTime: string;
    cuSize: number;
    storageSize: number;
    snapshotNumber: number;
    createProgress: number;
}

export interface DescribeClusterApiResponse {
    code: number;
    data: DescribeClusterResponse;
}

export interface ErrorResponse {
    code: number;
    message: string;
}

export class ClusterManager {
    private baseUrl: string;
    private token: string;

    constructor(config?: ZillizConfig) {
        this.baseUrl = envManager.get('ZILLIZ_BASE_URL') || config?.baseUrl || 'https://api.cloud.zilliz.com';
        this.token = envManager.get('MILVUS_TOKEN') || config?.token || '';

        if (!this.token) {
            throw new Error('Zilliz API token is required. Please provide it via MILVUS_TOKEN environment variable or config parameter.');
        }
    }

    private async makeRequest<T>(endpoint: string, method: 'GET' | 'POST' = 'GET', data?: any): Promise<T> {
        const url = `${this.baseUrl}${endpoint}`;

        const headers: Record<string, string> = {
            'Authorization': `Bearer ${this.token}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
        };

        const options: RequestInit = {
            method,
            headers,
        };

        if (data && method === 'POST') {
            options.body = JSON.stringify(data);
        }

        try {
            const response = await fetch(url, options);

            if (!response.ok) {
                const errorText = await response.text();
                let errorMessage: string;

                try {
                    const errorJson = JSON.parse(errorText);
                    errorMessage = errorJson.message || `HTTP ${response.status}: ${response.statusText}`;
                } catch {
                    errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                }

                throw new Error(errorMessage);
            }

            const result = await response.json();
            return result as T;
        } catch (error: any) {
            console.error('[ZillizUtils] ❌ Original error in makeRequest:', error);
            throw new Error(`Zilliz API request failed: ${error.message}`);
        }
    }

    async listProjects(): Promise<Project[]> {
        const response = await this.makeRequest<ListProjectsResponse>('/v2/projects');

        if (response.code !== 0) {
            throw new Error(`Failed to list projects: ${JSON.stringify(response)}`);
        }

        return response.data;
    }

    async listClusters(projectId?: string, pageSize: number = 10, currentPage: number = 1): Promise<{
        clusters: Cluster[];
        count: number;
        currentPage: number;
        pageSize: number;
    }> {
        let endpoint = `/v2/clusters?pageSize=${pageSize}&currentPage=${currentPage}`;
        if (projectId) {
            endpoint += `&projectId=${projectId}`;
        }

        const response = await this.makeRequest<ListClustersResponse>(endpoint);

        if (response.code !== 0) {
            throw new Error(`Failed to list clusters: ${JSON.stringify(response)}`);
        }

        return response.data;
    }

    async describeCluster(clusterId: string): Promise<DescribeClusterResponse> {
        const response = await this.makeRequest<DescribeClusterApiResponse>(`/v2/clusters/${clusterId}`);

        if (response.code !== 0) {
            throw new Error(`Failed to describe cluster: ${JSON.stringify(response)}`);
        }

        return response.data;
    }

    async createFreeCluster(
        request: CreateFreeClusterRequest,
        timeoutMs: number = 5 * 60 * 1000,
        pollIntervalMs: number = 5 * 1000
    ): Promise<CreateFreeClusterWithDetailsResponse> {
        const response = await this.makeRequest<CreateFreeClusterApiResponse>('/v2/clusters/createFree', 'POST', request);

        if (response.code !== 0) {
            throw new Error(`Failed to create free cluster: ${JSON.stringify(response)}`);
        }

        const { clusterId } = response.data;
        const startTime = Date.now();

        while (Date.now() - startTime < timeoutMs) {
            try {
                const clusterInfo = await this.describeCluster(clusterId);

                if (clusterInfo.status === 'RUNNING') {
                    return {
                        ...response.data,
                        clusterDetails: clusterInfo
                    };
                } else if (clusterInfo.status === 'DELETED' || clusterInfo.status === 'ABNORMAL') {
                    throw new Error(`Cluster creation failed with status: ${clusterInfo.status}`);
                }

                await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
            } catch (error: any) {
                // A describe error is not fatal: the cluster may not be available for describe yet.
                if (error.message.includes('Failed to describe cluster')) {
                    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
                    continue;
                }
                throw error;
            }
        }

        throw new Error(`Timeout waiting for cluster ${clusterId} to be ready after ${timeoutMs}ms`);
    }

    static async getAddressFromToken(token?: string): Promise<string> {
        if (!token) {
            throw new Error('Token is required when address is not provided');
        }

        try {
            const clusterManager = new ClusterManager({ token });

            const projects = await clusterManager.listProjects();
            const defaultProject = projects.find(p => p.projectName === 'Default Project');

            if (!defaultProject) {
                throw new Error('Default Project not found');
            }

            const clustersResponse = await clusterManager.listClusters(defaultProject.projectId);

            if (clustersResponse.clusters.length > 0) {
                const cluster = clustersResponse.clusters[0];
                console.log(`🎯 Using existing cluster: ${cluster.clusterName} (${cluster.clusterId})`);
                return cluster.connectAddress;
            } else {
                console.log('📝 No clusters found, creating a new free cluster...');
                const createResponse = await clusterManager.createFreeCluster({
                    clusterName: `auto-cluster-${Date.now()}`,
                    projectId: defaultProject.projectId,
                    regionId: 'gcp-us-west1'
                });

                console.log(`[ZillizUtils] ✅ Created new cluster: ${createResponse.clusterId}`);
                return createResponse.clusterDetails.connectAddress;
            }
        } catch (error: any) {
            throw new Error(`Failed to get address from token: ${error.message}`);
        }
    }
}