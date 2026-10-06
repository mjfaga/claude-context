import { MilvusClient, DataType, MetricType, FunctionType, LoadState } from '@zilliz/milvus2-sdk-node';
import {
    VectorDocument,
    SearchOptions,
    VectorSearchResult,
    VectorDatabase,
    HybridSearchRequest,
    HybridSearchOptions,
    HybridSearchResult,
} from './types';
import { ClusterManager } from './zilliz-utils';

export interface MilvusConfig {
    address?: string;
    token?: string;
    username?: string;
    password?: string;
    ssl?: boolean;
}



export class MilvusVectorDatabase implements VectorDatabase {
    protected config: MilvusConfig;
    private client: MilvusClient | null = null;
    protected initializationPromise: Promise<void>;

    constructor(config: MilvusConfig) {
        this.config = config;

        this.initializationPromise = this.initialize();
    }

    private async initialize(): Promise<void> {
        const resolvedAddress = await this.resolveAddress();
        await this.initializeClient(resolvedAddress);
    }

    private async initializeClient(address: string): Promise<void> {
        const milvusConfig = this.config as MilvusConfig;
        console.log('🔌 Connecting to vector database at: ', address);
        this.client = new MilvusClient({
            address: address,
            username: milvusConfig.username,
            password: milvusConfig.password,
            token: milvusConfig.token,
            ssl: milvusConfig.ssl || false,
        });
    }

    protected async resolveAddress(): Promise<string> {
        let finalConfig = { ...this.config };

        if (!finalConfig.address && finalConfig.token) {
            finalConfig.address = await ClusterManager.getAddressFromToken(finalConfig.token);
        }

        if (!finalConfig.address) {
            throw new Error('Address is required and could not be resolved from token');
        }

        return finalConfig.address;
    }

    protected async ensureInitialized(): Promise<void> {
        await this.initializationPromise;
        if (!this.client) {
            throw new Error('Client not initialized');
        }
    }

    protected async ensureLoaded(collectionName: string): Promise<void> {
        if (!this.client) {
            throw new Error('MilvusClient is not initialized. Call ensureInitialized() first.');
        }

        try {
            const result = await this.client.getLoadState({
                collection_name: collectionName
            });

            if (result.state !== LoadState.LoadStateLoaded) {
                console.log(`[MilvusDB] 🔄 Loading collection '${collectionName}' to memory...`);
                await this.client.loadCollection({
                    collection_name: collectionName,
                });
            }
        } catch (error) {
            console.error(`[MilvusDB] ❌ Failed to ensure collection '${collectionName}' is loaded:`, error);
            throw error;
        }
    }

    protected async waitForIndexReady(
        collectionName: string,
        fieldName: string,
        maxWaitTime: number = 60000,
        initialInterval: number = 500,
        maxInterval: number = 5000,
        backoffMultiplier: number = 1.5
    ): Promise<void> {
        if (!this.client) {
            throw new Error('MilvusClient is not initialized. Call ensureInitialized() first.');
        }

        let interval = initialInterval;
        const startTime = Date.now();

        console.log(`[MilvusDB] ⏳ Waiting for index on field '${fieldName}' in collection '${collectionName}' to be ready...`);

        while (Date.now() - startTime < maxWaitTime) {
            try {
                const indexBuildProgress = await this.client.getIndexBuildProgress({
                    collection_name: collectionName,
                    field_name: fieldName
                });

                console.log(`[MilvusDB] 📊 Index build progress for '${fieldName}': indexed_rows=${indexBuildProgress.indexed_rows}, total_rows=${indexBuildProgress.total_rows}`);
                console.log(`[MilvusDB] 📊 Full response:`, JSON.stringify(indexBuildProgress));

                if (indexBuildProgress.indexed_rows === indexBuildProgress.total_rows) {
                    console.log(`[MilvusDB] ✅ Index on field '${fieldName}' is ready! (${indexBuildProgress.indexed_rows}/${indexBuildProgress.total_rows} rows indexed)`);
                    return;
                }

                if (indexBuildProgress.status && indexBuildProgress.status.error_code !== 'Success') {
                    // Some Milvus versions report a false "index duplicates" error for sparse vector index progress; treat the index as ready.
                    if (indexBuildProgress.status.reason && indexBuildProgress.status.reason.includes('index duplicates[indexName=]')) {
                        console.log(`[MilvusDB] ⚠️  Index progress check returned known older Milvus issue: ${indexBuildProgress.status.reason}`);
                        console.log(`[MilvusDB] ⚠️  This is a known issue with older Milvus versions - treating as index ready`);
                        return;
                    }
                    throw new Error(`Index creation failed for field '${fieldName}' in collection '${collectionName}': ${indexBuildProgress.status.reason}`);
                }

                console.log(`[MilvusDB] 📊 Index building in progress: ${indexBuildProgress.indexed_rows}/${indexBuildProgress.total_rows} rows indexed`);

                await new Promise(resolve => setTimeout(resolve, interval));
                interval = Math.min(interval * backoffMultiplier, maxInterval);

            } catch (error) {
                console.error(`[MilvusDB] ❌ Error checking index build progress for field '${fieldName}':`, error);
                throw error;
            }
        }

        throw new Error(`Timeout waiting for index on field '${fieldName}' in collection '${collectionName}' to be ready after ${maxWaitTime}ms`);
    }

    protected async loadCollectionWithRetry(
        collectionName: string,
        maxRetries: number = 5,
        initialInterval: number = 1000,
        backoffMultiplier: number = 2
    ): Promise<void> {
        if (!this.client) {
            throw new Error('MilvusClient is not initialized. Call ensureInitialized() first.');
        }

        let attempt = 1;
        let interval = initialInterval;

        while (attempt <= maxRetries) {
            try {
                console.log(`[MilvusDB] 🔄 Loading collection '${collectionName}' to memory (attempt ${attempt}/${maxRetries})...`);

                await this.client.loadCollection({
                    collection_name: collectionName,
                });

                console.log(`[MilvusDB] ✅ Collection '${collectionName}' loaded successfully!`);
                return;

            } catch (error) {
                console.error(`[MilvusDB] ❌ Failed to load collection '${collectionName}' on attempt ${attempt}:`, error);

                if (attempt === maxRetries) {
                    throw new Error(`Failed to load collection '${collectionName}' after ${maxRetries} attempts: ${error}`);
                }

                console.log(`[MilvusDB] ⏳ Retrying collection load in ${interval}ms...`);
                await new Promise(resolve => setTimeout(resolve, interval));
                interval *= backoffMultiplier;
                attempt++;
            }
        }
    }

    async createCollection(collectionName: string, dimension: number, description?: string): Promise<void> {
        await this.ensureInitialized();

        console.log('Beginning collection creation:', collectionName);
        console.log('Collection dimension:', dimension);
        const schema = [
            {
                name: 'id',
                description: 'Document ID',
                data_type: DataType.VarChar,
                max_length: 512,
                is_primary_key: true,
            },
            {
                name: 'vector',
                description: 'Embedding vector',
                data_type: DataType.FloatVector,
                dim: dimension,
            },
            {
                name: 'content',
                description: 'Document content',
                data_type: DataType.VarChar,
                max_length: 65535,
            },
            {
                name: 'relativePath',
                description: 'Relative path to the codebase',
                data_type: DataType.VarChar,
                max_length: 1024,
            },
            {
                name: 'startLine',
                description: 'Start line number of the chunk',
                data_type: DataType.Int64,
            },
            {
                name: 'endLine',
                description: 'End line number of the chunk',
                data_type: DataType.Int64,
            },
            {
                name: 'fileExtension',
                description: 'File extension',
                data_type: DataType.VarChar,
                max_length: 32,
            },
            {
                name: 'metadata',
                description: 'Additional document metadata as JSON string',
                data_type: DataType.VarChar,
                max_length: 65535,
            },
        ];

        const createCollectionParams = {
            collection_name: collectionName,
            description: description || `Claude Context collection: ${collectionName}`,
            fields: schema,
        };

        if (!this.client) {
            throw new Error('MilvusClient is not initialized. Call ensureInitialized() first.');
        }

        await this.client.createCollection(createCollectionParams);

        const indexParams = {
            collection_name: collectionName,
            field_name: 'vector',
            index_name: 'vector_index',
            index_type: 'AUTOINDEX',
            metric_type: MetricType.COSINE,
        };

        console.log(`[MilvusDB] 🔧 Creating index for field 'vector' in collection '${collectionName}'...`);
        await this.client.createIndex(indexParams);

        await this.waitForIndexReady(collectionName, 'vector');

        await this.loadCollectionWithRetry(collectionName);

        await this.client.describeCollection({
            collection_name: collectionName,
        });
    }

    async dropCollection(collectionName: string): Promise<void> {
        await this.ensureInitialized();

        if (!this.client) {
            throw new Error('MilvusClient is not initialized after ensureInitialized().');
        }

        await this.client.dropCollection({
            collection_name: collectionName,
        });
    }

    async hasCollection(collectionName: string): Promise<boolean> {
        await this.ensureInitialized();

        if (!this.client) {
            throw new Error('MilvusClient is not initialized after ensureInitialized().');
        }

        const result = await this.client.hasCollection({
            collection_name: collectionName,
        });

        return Boolean(result.value);
    }

    async listCollections(): Promise<string[]> {
        await this.ensureInitialized();

        if (!this.client) {
            throw new Error('MilvusClient is not initialized after ensureInitialized().');
        }

        const result = await this.client.showCollections();
        const collections = (result as any).collection_names || (result as any).collections || [];
        return Array.isArray(collections) ? collections : [];
    }

    async insert(collectionName: string, documents: VectorDocument[]): Promise<void> {
        await this.ensureInitialized();
        await this.ensureLoaded(collectionName);

        if (!this.client) {
            throw new Error('MilvusClient is not initialized after ensureInitialized().');
        }

        console.log('Inserting documents into collection:', collectionName);
        const data = documents.map(doc => ({
            id: doc.id,
            vector: doc.vector,
            content: doc.content,
            relativePath: doc.relativePath,
            startLine: doc.startLine,
            endLine: doc.endLine,
            fileExtension: doc.fileExtension,
            metadata: JSON.stringify(doc.metadata),
        }));

        await this.client.insert({
            collection_name: collectionName,
            data: data,
        });
    }

    async search(collectionName: string, queryVector: number[], options?: SearchOptions): Promise<VectorSearchResult[]> {
        await this.ensureInitialized();
        await this.ensureLoaded(collectionName);

        if (!this.client) {
            throw new Error('MilvusClient is not initialized after ensureInitialized().');
        }

        const searchParams: any = {
            collection_name: collectionName,
            data: [queryVector],
            limit: options?.topK || 10,
            output_fields: ['id', 'content', 'relativePath', 'startLine', 'endLine', 'fileExtension', 'metadata'],
        };

        if (options?.filterExpr && options.filterExpr.trim().length > 0) {
            searchParams.expr = options.filterExpr;
        }

        const searchResult = await this.client.search(searchParams);

        if (!searchResult.results || searchResult.results.length === 0) {
            return [];
        }

        return searchResult.results.map((result: any) => ({
            document: {
                id: result.id,
                vector: queryVector,
                content: result.content,
                relativePath: result.relativePath,
                startLine: result.startLine,
                endLine: result.endLine,
                fileExtension: result.fileExtension,
                metadata: JSON.parse(result.metadata || '{}'),
            },
            score: result.score,
        }));
    }

    async delete(collectionName: string, ids: string[]): Promise<void> {
        await this.ensureInitialized();
        await this.ensureLoaded(collectionName);

        if (!this.client) {
            throw new Error('MilvusClient is not initialized after ensureInitialized().');
        }

        await this.client.delete({
            collection_name: collectionName,
            filter: `id in [${ids.map(id => `"${id}"`).join(', ')}]`,
        });
    }

    async query(collectionName: string, filter: string, outputFields: string[], limit?: number): Promise<Record<string, any>[]> {
        await this.ensureInitialized();
        await this.ensureLoaded(collectionName);

        if (!this.client) {
            throw new Error('MilvusClient is not initialized after ensureInitialized().');
        }

        try {
            const queryParams: any = {
                collection_name: collectionName,
                filter: filter,
                output_fields: outputFields,
            };

            if (limit !== undefined) {
                queryParams.limit = limit;
            } else if (filter === '' || filter.trim() === '') {
                // Milvus requires a limit when the filter expression is empty.
                queryParams.limit = 16384;
            }

            const result = await this.client.query(queryParams);

            if (result.status.error_code !== 'Success') {
                throw new Error(`Failed to query Milvus: ${result.status.reason}`);
            }

            return result.data || [];
        } catch (error) {
            console.error(`[MilvusDB] ❌ Failed to query collection '${collectionName}':`, error);
            throw error;
        }
    }

    async createHybridCollection(collectionName: string, dimension: number, description?: string): Promise<void> {
        await this.ensureInitialized();

        console.log('Beginning hybrid collection creation:', collectionName);
        console.log('Collection dimension:', dimension);

        const schema = [
            {
                name: 'id',
                description: 'Document ID',
                data_type: DataType.VarChar,
                max_length: 512,
                is_primary_key: true,
            },
            {
                name: 'content',
                description: 'Full text content for BM25 and storage',
                data_type: DataType.VarChar,
                max_length: 65535,
                enable_analyzer: true,
            },
            {
                name: 'vector',
                description: 'Dense vector embedding',
                data_type: DataType.FloatVector,
                dim: dimension,
            },
            {
                name: 'sparse_vector',
                description: 'Sparse vector embedding from BM25',
                data_type: DataType.SparseFloatVector,
            },
            {
                name: 'relativePath',
                description: 'Relative path to the codebase',
                data_type: DataType.VarChar,
                max_length: 1024,
            },
            {
                name: 'startLine',
                description: 'Start line number of the chunk',
                data_type: DataType.Int64,
            },
            {
                name: 'endLine',
                description: 'End line number of the chunk',
                data_type: DataType.Int64,
            },
            {
                name: 'fileExtension',
                description: 'File extension',
                data_type: DataType.VarChar,
                max_length: 32,
            },
            {
                name: 'metadata',
                description: 'Additional document metadata as JSON string',
                data_type: DataType.VarChar,
                max_length: 65535,
            },
        ];

        const functions = [
            {
                name: "content_bm25_emb",
                description: "content bm25 function",
                type: FunctionType.BM25,
                input_field_names: ["content"],
                output_field_names: ["sparse_vector"],
                params: {},
            },
        ];

        const createCollectionParams = {
            collection_name: collectionName,
            description: description || `Hybrid code context collection: ${collectionName}`,
            fields: schema,
            functions: functions,
        };

        if (!this.client) {
            throw new Error('MilvusClient is not initialized. Call ensureInitialized() first.');
        }

        await this.client.createCollection(createCollectionParams);

        const denseIndexParams = {
            collection_name: collectionName,
            field_name: 'vector',
            index_name: 'vector_index',
            index_type: 'AUTOINDEX',
            metric_type: MetricType.COSINE,
        };
        console.log(`[MilvusDB] 🔧 Creating dense vector index for field 'vector' in collection '${collectionName}'...`);
        await this.client.createIndex(denseIndexParams);

        await this.waitForIndexReady(collectionName, 'vector');

        const sparseIndexParams = {
            collection_name: collectionName,
            field_name: 'sparse_vector',
            index_name: 'sparse_vector_index',
            index_type: 'SPARSE_INVERTED_INDEX',
            metric_type: MetricType.BM25,
        };
        console.log(`[MilvusDB] 🔧 Creating sparse vector index for field 'sparse_vector' in collection '${collectionName}'...`);

        await this.client.createIndex(sparseIndexParams);

        await this.waitForIndexReady(collectionName, 'sparse_vector');

        await this.loadCollectionWithRetry(collectionName);

        await this.client.describeCollection({
            collection_name: collectionName,
        });
    }

    async insertHybrid(collectionName: string, documents: VectorDocument[]): Promise<void> {
        await this.ensureInitialized();
        await this.ensureLoaded(collectionName);

        if (!this.client) {
            throw new Error('MilvusClient is not initialized after ensureInitialized().');
        }

        const data = documents.map(doc => ({
            id: doc.id,
            content: doc.content,
            vector: doc.vector,
            relativePath: doc.relativePath,
            startLine: doc.startLine,
            endLine: doc.endLine,
            fileExtension: doc.fileExtension,
            metadata: JSON.stringify(doc.metadata),
        }));

        await this.client.insert({
            collection_name: collectionName,
            data: data,
        });
    }

    async hybridSearch(collectionName: string, searchRequests: HybridSearchRequest[], options?: HybridSearchOptions): Promise<HybridSearchResult[]> {
        await this.ensureInitialized();
        await this.ensureLoaded(collectionName);

        if (!this.client) {
            throw new Error('MilvusClient is not initialized after ensureInitialized().');
        }

        try {
            console.log(`[MilvusDB] 🔍 Preparing hybrid search for collection: ${collectionName}`);

            const search_param_1 = {
                data: Array.isArray(searchRequests[0].data) ? searchRequests[0].data : [searchRequests[0].data],
                anns_field: searchRequests[0].anns_field,
                param: searchRequests[0].param,
                limit: searchRequests[0].limit
            };

            const search_param_2 = {
                data: searchRequests[1].data,
                anns_field: searchRequests[1].anns_field,
                param: searchRequests[1].param,
                limit: searchRequests[1].limit
            };

            const rerank_strategy = {
                strategy: "rrf",
                params: {
                    k: 100
                }
            };

            console.log(`[MilvusDB] 🔍 Dense search params:`, JSON.stringify({
                anns_field: search_param_1.anns_field,
                param: search_param_1.param,
                limit: search_param_1.limit,
                data_length: Array.isArray(search_param_1.data[0]) ? search_param_1.data[0].length : 'N/A'
            }, null, 2));
            console.log(`[MilvusDB] 🔍 Sparse search params:`, JSON.stringify({
                anns_field: search_param_2.anns_field,
                param: search_param_2.param,
                limit: search_param_2.limit,
                query_text: typeof search_param_2.data === 'string' ? search_param_2.data.substring(0, 50) + '...' : 'N/A'
            }, null, 2));
            console.log(`[MilvusDB] 🔍 Rerank strategy:`, JSON.stringify(rerank_strategy, null, 2));

            const searchParams: any = {
                collection_name: collectionName,
                data: [search_param_1, search_param_2],
                limit: options?.limit || searchRequests[0]?.limit || 10,
                rerank: rerank_strategy,
                output_fields: ['id', 'content', 'relativePath', 'startLine', 'endLine', 'fileExtension', 'metadata'],
            };

            if (options?.filterExpr && options.filterExpr.trim().length > 0) {
                searchParams.expr = options.filterExpr;
            }

            console.log(`[MilvusDB] 🔍 Complete search request:`, JSON.stringify({
                collection_name: searchParams.collection_name,
                data_count: searchParams.data.length,
                limit: searchParams.limit,
                rerank: searchParams.rerank,
                output_fields: searchParams.output_fields,
                expr: searchParams.expr
            }, null, 2));

            const searchResult = await this.client.search(searchParams);

            console.log(`[MilvusDB] 🔍 Search executed, processing results...`);

            if (!searchResult.results || searchResult.results.length === 0) {
                console.log(`[MilvusDB] ⚠️  No results returned from Milvus search`);
                return [];
            }

            console.log(`[MilvusDB] ✅ Found ${searchResult.results.length} results from hybrid search`);

            return searchResult.results.map((result: any) => ({
                document: {
                    id: result.id,
                    content: result.content,
                    vector: [],
                    sparse_vector: [],
                    relativePath: result.relativePath,
                    startLine: result.startLine,
                    endLine: result.endLine,
                    fileExtension: result.fileExtension,
                    metadata: JSON.parse(result.metadata || '{}'),
                },
                score: result.score,
            }));

        } catch (error) {
            console.error(`[MilvusDB] ❌ Failed to perform hybrid search on collection '${collectionName}':`, error);
            throw error;
        }
    }

    async checkCollectionLimit(): Promise<boolean> {
        if (!this.client) {
            throw new Error('MilvusClient is not initialized. Call ensureInitialized() first.');
        }

        const collectionName = `dummy_collection_${Date.now()}`;
        const createCollectionParams = {
            collection_name: collectionName,
            description: 'Test collection for limit check',
            fields: [
                {
                    name: 'id',
                    data_type: DataType.VarChar,
                    max_length: 512,
                    is_primary_key: true,
                },
                {
                    name: 'vector',
                    data_type: DataType.FloatVector,
                    dim: 128,
                }
            ]
        };

        try {
            await this.client.createCollection(createCollectionParams);
            if (await this.client.hasCollection({ collection_name: collectionName })) {
                await this.client.dropCollection({
                    collection_name: collectionName,
                });
            }
            return true;
        } catch (error: any) {
            const errorMessage = error.message || error.toString() || '';
            if (/exceeded the limit number of collections/i.test(errorMessage)) {
                return false;
            }
            throw error;
        }
    }
}